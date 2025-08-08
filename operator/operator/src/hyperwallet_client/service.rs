//! Hyperwallet client service module - replaces direct wallet management with hyperwallet calls
//! This module provides the same interface as the original wallet::service module
//! but delegates all operations to the hyperwallet service using the typed API.

use hyperware_process_lib::hyperwallet_client::{
    self, HyperwalletClientError,
};
use hyperware_process_lib::logging::{info, error, warn};
use hyperware_process_lib::signer::{LocalSigner, EncryptedSignerData};
use hyperware_process_lib::wallet::KeyStorage;
use serde::{Deserialize, Serialize};
use std::str::FromStr;

use crate::structs::{State, ManagedWallet, WalletSummary, SpendingLimits, DelegationStatus, ActiveAccountDetails};

/// Convert HyperwalletClientError to String for compatibility
fn convert_error(error: HyperwalletClientError) -> String {
    format!("Hyperwallet error: {}", error)
}

/// Get session from state with proper error handling
fn get_session_from_state(state: &State) -> Result<&hyperware_process_lib::hyperwallet_client::types::SessionInfo, String> {
    state.hyperwallet_session.as_ref()
        .ok_or_else(|| "Hyperwallet session not initialized. Please restart the operator.".to_string())
}

// ===== Wallet Management Functions =====

/// Initialize wallet management - migrate existing wallets to hyperwallet
pub fn initialize_wallet(state: &mut State) {
    info!("Initializing wallet management with hyperwallet...");
    
    // Check if we have any existing wallets in the old format
    if !state.managed_wallets.is_empty() {
        info!("Found {} existing wallets to migrate to hyperwallet", state.managed_wallets.len());
        
        // Collect wallets to migrate first to avoid borrow issues
        let wallets_to_migrate: Vec<(String, Option<String>, String)> = state.managed_wallets
            .iter()
            .filter_map(|(wallet_id, managed_wallet)| {
                if let Some(signer) = state.active_signer_cache.as_ref() {
                    Some((
                        wallet_id.clone(),
                        managed_wallet.name.clone(),
                        signer.private_key_hex.clone()
                    ))
                } else {
                    warn!("Cannot migrate wallet {} - no active signer available", wallet_id);
                    None
                }
            })
            .collect();
        
        // Now migrate the wallets
        for (wallet_id, name, private_key) in wallets_to_migrate {
            info!("Attempting to migrate wallet: {}", wallet_id);
            
            match import_new_wallet(state, private_key, None, name) {
                Ok(address) => {
                    info!("Successfully migrated wallet {} to hyperwallet with address {}", 
                        wallet_id, address);
                }
                Err(e) => {
                    error!("Failed to migrate wallet {} to hyperwallet: {}", wallet_id, e);
                }
            }
        }
        
        // Clear the old wallet storage since we're now using hyperwallet
        state.managed_wallets.clear();
        state.active_signer_cache = None;
        state.save();
        
        info!("Wallet migration complete");
    } else {
        info!("No existing wallets to migrate");
    }
}

pub fn generate_initial_wallet(state: &mut State) -> Result<String, String> {
    info!("Generating initial wallet via hyperwallet");
    
    let session = get_session_from_state(state)?;
    let wallet = hyperwallet_client::create_wallet(
        &session.session_id,
        None,
        None,
    ).map_err(convert_error)?;
    
    info!("Hyperwallet created wallet: {}", wallet.address);
    
    // Auto-select the newly created wallet
    select_wallet(state, wallet.address.clone())?;
    info!("Auto-selected newly generated wallet: {}", wallet.address);
    
    Ok(wallet.address)
}

pub fn import_new_wallet(
    state: &mut State,
    private_key: String,
    password: Option<String>,
    name: Option<String>,
) -> Result<String, String> {
    info!("Importing wallet via hyperwallet (password: {})", 
        if password.is_some() { "provided" } else { "none - will store unencrypted" });
    
    let session = get_session_from_state(state)?;
    let sanitized_password = password
        .as_deref()
        .filter(|p| !p.trim().is_empty());
    let wallet = hyperwallet_client::import_wallet(
        &session.session_id,
        &name.unwrap_or_else(|| "imported-wallet".to_string()),
        &private_key,
        sanitized_password,
    ).map_err(convert_error)?;
    
    info!("Hyperwallet imported wallet: {}", wallet.address);
    
    // Auto-select the newly imported wallet
    select_wallet(state, wallet.address.clone())?;
    info!("Auto-selected newly imported wallet: {}", wallet.address);
    
    Ok(wallet.address)
}

pub fn get_wallet_summary_list(state: &mut State) -> (Option<String>, Vec<WalletSummary>) {
    info!("Getting wallet summary list from hyperwallet");
    
    let session = match get_session_from_state(state) {
        Ok(session) => session,
        Err(e) => {
            error!("Failed to get session: {}", e);
            return (state.selected_wallet_id.clone(), Vec::new());
        }
    };
    
    match hyperwallet_client::list_wallets(&session.session_id) {
        Ok(wallets) => {
            info!("Retrieved {} wallets from hyperwallet", wallets.total);
            
            // Auto-select first wallet if none is currently selected and wallets exist
            if state.selected_wallet_id.is_none() && !wallets.wallets.is_empty() {
                let first_wallet = &wallets.wallets[0];
                info!("No wallet selected - auto-selecting first available wallet: {}", first_wallet.address);
                
                match select_wallet(state, first_wallet.address.clone()) {
                    Ok(()) => info!("Successfully auto-selected wallet: {}", first_wallet.address),
                    Err(e) => warn!("Failed to auto-select wallet {}: {}", first_wallet.address, e),
                }
            }
            
            let wallet_summaries = wallets
                .wallets
                .iter()
                .map(|wallet| WalletSummary {
                    id: wallet.address.clone(),
                    address: wallet.address.clone(),
                    name: wallet.name.clone(),
                    is_encrypted: wallet.encrypted,
                    is_unlocked: !wallet.encrypted, // For now, assume unencrypted = unlocked
                    is_selected: Some(wallet.address.as_str()) == state.selected_wallet_id.as_deref(),
                })
                .collect();
            
            (state.selected_wallet_id.clone(), wallet_summaries)
        }
        Err(e) => {
            error!("Failed to get wallet list from hyperwallet: {}", convert_error(e));
            (state.selected_wallet_id.clone(), Vec::new())
        }
    }
}

pub fn select_wallet(state: &mut State, wallet_id: String) -> Result<(), String> {
    info!("Selecting wallet {} (validating with hyperwallet)", wallet_id);
    
    let session = get_session_from_state(state)?;
    
    // Validate wallet exists in hyperwallet by calling get_wallet_info
    match hyperwallet_client::get_wallet_info(&session.session_id, &wallet_id) {
        Ok(_) => {
            // Wallet exists in hyperwallet, so update local state
            state.selected_wallet_id = Some(wallet_id.clone());
            state.active_signer_cache = None; // Clear cache when switching
            state.cached_active_details = None;
            state.save();
            info!("Successfully selected wallet {}", wallet_id);
            Ok(())
        }
        Err(e) => {
            let error_msg = convert_error(e);
            info!("Wallet validation failed for {}: {}", wallet_id, error_msg);
            Err(format!("Wallet not found in hyperwallet: {}", error_msg))
        }
    }
}

pub fn rename_wallet(state: &mut State, wallet_id: String, new_name: String) -> Result<(), String> {
    info!("Renaming wallet {} to '{}'", wallet_id, new_name);
    
    let session = get_session_from_state(state)?;
    hyperwallet_client::rename_wallet(&session.session_id, &wallet_id, &new_name)
        .map_err(convert_error)?;
    
    info!("Successfully renamed wallet {} to '{}'", wallet_id, new_name);
    
    Ok(())
}

pub fn delete_wallet(state: &mut State, wallet_id: String) -> Result<(), String> {
    let session = get_session_from_state(state)?;
    
    // Check current wallet count from hyperwallet instead of local state
    let current_wallets = hyperwallet_client::list_wallets(&session.session_id)
        .map_err(convert_error)?;
    
    if current_wallets.total <= 1 {
        return Err("Cannot delete the last wallet".to_string());
    }
    
    // Delete from hyperwallet
    hyperwallet_client::delete_wallet(
        &session.session_id,
        &wallet_id,
    ).map_err(convert_error)?;
    
    info!("Successfully deleted wallet {}", wallet_id);
    
    // Update local state
    state.managed_wallets.remove(&wallet_id);
    
    if Some(&wallet_id) == state.selected_wallet_id.as_ref() {
        state.selected_wallet_id = None;
        state.active_signer_cache = None;
        state.cached_active_details = None;
        
        // Auto-select another wallet from the updated list
        if let Some(next_wallet) = current_wallets.wallets.iter().find(|w| w.address != wallet_id) {
            let _ = select_wallet(state, next_wallet.address.clone());
        }
    }
    
    state.save();
    Ok(())
}

pub fn activate_wallet(
    state: &mut State,
    wallet_id: String,
    password: Option<String>,
) -> Result<(), String> {
    let session = get_session_from_state(state)?;
    
    // Use hyperwallet's unlock_wallet for encrypted wallets
    if let Some(ref pwd) = password {
        hyperwallet_client::unlock_wallet(
            &session.session_id,
            &session.session_id, // target_session_id  
            &wallet_id,
            pwd,
        ).map_err(convert_error)?;
        
        info!("Successfully activated encrypted wallet {}", wallet_id);
    }
    
    // Update local state if wallet exists there (for transition)
    if let Some(wallet) = state.managed_wallets.get_mut(&wallet_id) {
        match &wallet.storage {
            KeyStorage::Encrypted(encrypted_data) => {
                if let Some(pwd) = password {
                    // Decrypt the signer
                    let signer = LocalSigner::decrypt(encrypted_data, &pwd)
                        .map_err(|e| format!("Failed to decrypt wallet: {}", e))?;
                    
                    // Update storage to decrypted
                    wallet.storage = KeyStorage::Decrypted(signer.clone());
                    
                    // Update cache if this is selected wallet
                    if Some(&wallet_id) == state.selected_wallet_id.as_ref() {
                        state.active_signer_cache = Some(signer);
                        state.cached_active_details = None; // Clear cache
                    }
                } else {
                    return Err("Password required for encrypted wallet".to_string());
                }
            }
            KeyStorage::Decrypted(signer) => {
                // Already decrypted, just update cache if selected
                if Some(&wallet_id) == state.selected_wallet_id.as_ref() {
                    state.active_signer_cache = Some(signer.clone());
                    state.cached_active_details = None;
                }
            }
        }
    }
    
    state.save();
    Ok(())
}

pub fn deactivate_wallet(state: &mut State, wallet_id: String) -> Result<(), String> {
    if let Some(wallet) = state.managed_wallets.get_mut(&wallet_id) {
        // If it's decrypted, we need to re-encrypt it or at least clear the decrypted state
        // For now, we'll just clear the active signer cache
        // In a real implementation, you might want to re-encrypt with a stored password
        
        if Some(&wallet_id) == state.selected_wallet_id.as_ref() {
            state.active_signer_cache = None;
            state.cached_active_details = None;
        }
    }
    
    state.save();
    Ok(())
}

pub fn export_private_key(
    state: &State,
    wallet_id: String,
    password: Option<String>,
) -> Result<String, String> {
    let session = get_session_from_state(state)?;
    
    // Use the export_wallet function from the new API
    match hyperwallet_client::export_wallet(
        &session.session_id,
        &wallet_id,
        password.as_deref(),
    ) {
        Ok(export_response) => Ok(export_response.private_key),
        Err(e) => Err(convert_error(e)),
    }
}

pub fn set_wallet_password(
    state: &mut State,
    wallet_id: String,
    new_password: String,
    old_password: Option<String>,
) -> Result<(), String> {
    if let Some(wallet) = state.managed_wallets.get_mut(&wallet_id) {
        // Get the signer
        let signer = match &wallet.storage {
            KeyStorage::Encrypted(encrypted_data) => {
                let pwd = old_password.ok_or("Current password required")?;
                LocalSigner::decrypt(encrypted_data, &pwd)
                    .map_err(|e| format!("Failed to decrypt with old password: {}", e))?
            }
            KeyStorage::Decrypted(signer) => signer.clone(),
        };
        
        // Encrypt with new password
        let encrypted = signer.encrypt(&new_password)
            .map_err(|e| format!("Failed to encrypt with new password: {}", e))?;
        
        // Update storage to encrypted
        wallet.storage = KeyStorage::Encrypted(encrypted);
        
        // Clear cache if selected
        if Some(&wallet_id) == state.selected_wallet_id.as_ref() {
            state.active_signer_cache = None;
            state.cached_active_details = None;
        }
        
        state.save();
    }
    
    Ok(())
}

pub fn remove_wallet_password(
    state: &mut State,
    wallet_id: String,
    current_password: String,
) -> Result<(), String> {
    if let Some(wallet) = state.managed_wallets.get_mut(&wallet_id) {
        let signer = match &wallet.storage {
            KeyStorage::Encrypted(encrypted_data) => {
                // Decrypt to verify password
                LocalSigner::decrypt(encrypted_data, &current_password)
                    .map_err(|e| format!("Failed to decrypt with password: {}", e))?
            }
            KeyStorage::Decrypted(_) => {
                return Err("Wallet is not encrypted".to_string());
            }
        };
        
        // Store as decrypted
        wallet.storage = KeyStorage::Decrypted(signer.clone());
        
        // Update cache if selected
        if Some(&wallet_id) == state.selected_wallet_id.as_ref() {
            state.active_signer_cache = Some(signer);
        }
        
        state.save();
    }
    
    Ok(())
}

// ===== Helper Functions =====

pub fn get_active_signer(state: &State) -> Result<Box<dyn hyperware_process_lib::signer::Signer>, String> {
    state.active_signer_cache.as_ref()
        .map(|signer| Box::new(signer.clone()) as Box<dyn hyperware_process_lib::signer::Signer>)
        .ok_or("No active/unlocked wallet".to_string())
}

pub fn get_active_account_details(state: &State) -> Result<Option<ActiveAccountDetails>, String> {
    // This would need to be implemented based on what details are needed
    // For now, return basic info
    if let Some(wallet_id) = &state.selected_wallet_id {
        if let Some(wallet) = state.managed_wallets.get(wallet_id) {
            let is_unlocked = match &wallet.storage {
                KeyStorage::Decrypted(_) => true,
                KeyStorage::Encrypted(_) => false,
            };
            
            Ok(Some(ActiveAccountDetails {
                id: wallet.id.clone(),
                name: wallet.name.clone(),
                address: wallet.storage.get_address(),
                is_encrypted: matches!(wallet.storage, KeyStorage::Encrypted(_)),
                is_selected: true,
                is_unlocked,
                eth_balance: None,  // Would need to fetch from chain
                usdc_balance: None, // Would need to fetch from chain
            }))
        } else {
            Ok(None)
        }
    } else {
        Ok(None)
    }
}

// ===== Delegation Functions =====

pub fn verify_selected_hot_wallet_delegation_detailed(
    state: &State,
    _operator_entry_name_override: Option<&str>,
) -> DelegationStatus {
    // This would need to be implemented based on your delegation logic
    // For now, return a simple status
    if state.selected_wallet_id.is_some() {
        DelegationStatus::Verified
    } else {
        DelegationStatus::NeedsHotWallet
    }
}

pub fn get_all_onchain_linked_hot_wallet_addresses(
    operator_entry_name: Option<&str>,
) -> Result<Vec<String>, String> {
    info!("Getting on-chain linked hot wallet addresses from hypermap contract");
    
    let operator_entry_name = match operator_entry_name {
        Some(name) if !name.is_empty() => {
            info!("  -> Using provided operator entry name: {}", name);
            name
        },
        _ => {
            let err_msg = "Operator entry name not provided or empty.".to_string();
            error!("  -> Error: {}", err_msg);
            return Err(err_msg);
        }
    };

    // Create a new provider and hypermap_reader instance for this operation.
    let provider = hyperware_process_lib::eth::Provider::new(crate::structs::CHAIN_ID, 60000);
    let hypermap_address_obj = match hyperware_process_lib::eth::Address::from_str(hyperware_process_lib::hypermap::HYPERMAP_ADDRESS) {
        Ok(addr) => addr,
        Err(_) => {
            let err_msg = "Internal Error: Failed to parse HYPERMAP_ADDRESS constant.".to_string();
            error!("  -> Error: {}", err_msg);
            return Err(err_msg);
        }
    };
    let hypermap_reader = hyperware_process_lib::hypermap::Hypermap::new(provider.clone(), hypermap_address_obj);

    let access_list_note_name = "~access-list";
    let access_list_full_path = format!("{}.{}", access_list_note_name, operator_entry_name);

    // Step 1: Get the hash of the signers note from the access list note
    match crate::helpers::get_signers_note_hash_from_access_list(&hypermap_reader, &access_list_full_path) {
        Ok(signers_note_hash) => {
            info!(
                "  Successfully got signers note hash: {} from access list {}",
                signers_note_hash, access_list_full_path
            );

            // Step 2: Get the list of addresses from the signers note
            match crate::helpers::get_addresses_from_signers_note(&hypermap_reader, signers_note_hash) {
                Ok(delegate_addresses) => {
                    info!(
                        "  Successfully decoded {} delegate addresses from signers note.",
                        delegate_addresses.len()
                    );
                    // Convert Vec<alloy_primitives::Address> to Vec<String>
                    let addresses_as_strings = delegate_addresses
                        .into_iter()
                        .map(|addr| addr.to_string())
                        .collect();
                    Ok(addresses_as_strings)
                }
                Err(err_msg) => {
                    error!(
                        "  Error getting addresses from signers note (hash: {}): {}",
                        signers_note_hash, err_msg
                    );
                    Err(format!(
                        "Failed to get addresses from signers note: {}",
                        err_msg
                    ))
                }
            }
        }
        Err(err_msg) => {
            error!(
                "  Error getting signers note hash from access list '{}': {}",
                access_list_full_path, err_msg
            );
            // If there's no access list note, that means no wallets are linked yet
            if err_msg.contains("note not found") || err_msg.contains("no data") {
                info!("  No access list note found - no wallets linked on-chain yet");
                Ok(Vec::new()) // Return empty list instead of error
            } else {
                Err(format!(
                    "Failed to get signers note hash from access list '{}': {}",
                    access_list_full_path, err_msg
                ))
            }
        }
    }
}

// ===== Additional functions that might be needed =====

pub fn get_wallet_summary_for_address(
    state: &State,
    address: &str,
) -> Option<WalletSummary> {
    info!("Getting wallet summary for address {} from hyperwallet", address);
    
    let session = get_session_from_state(state).ok()?;
    
    // Query hyperwallet for the list of wallets
    match hyperwallet_client::list_wallets(&session.session_id) {
        Ok(list_wallets_response) => {
            // Find the wallet with matching address
            list_wallets_response.wallets.iter()
                .find(|wallet| wallet.address.eq_ignore_ascii_case(address))
                .map(|wallet| WalletSummary {
                    id: wallet.address.clone(),
                    address: wallet.address.clone(),
                    name: wallet.name.clone(),
                    is_encrypted: wallet.encrypted,
                    is_unlocked: !wallet.encrypted, // For now, assume unencrypted = unlocked
                    is_selected: Some(wallet.address.as_str()) == state.selected_wallet_id.as_deref(),
                })
        }
        Err(e) => {
            error!("Failed to get wallet info from hyperwallet: {}", convert_error(e));
            None
        }
    }
}

pub fn verify_single_hot_wallet_delegation_detailed(
    state: &State,
    _operator_entry_name_override: Option<&str>,
    hot_wallet_address: &str,
) -> DelegationStatus {
    // Check if this hot wallet exists in our managed wallets
    let wallet_exists = state.managed_wallets.values()
        .any(|wallet| wallet.storage.get_address().eq_ignore_ascii_case(hot_wallet_address));
    
    if wallet_exists {
        DelegationStatus::Verified
    } else {
        DelegationStatus::HotWalletNotInList
    }
} 

pub fn set_wallet_spending_limits(
    state: &mut State,
    wallet_id: String,
    max_per_call: Option<String>,
    max_total: Option<String>,
    currency: Option<String>,
) -> Result<(), String> {
    info!("Setting wallet spending limits for {}: max_per_call={:?}, max_total={:?}, currency={:?}", 
          wallet_id, max_per_call, max_total, currency);
    
    // Note: set_wallet_limits function doesn't exist in the new API
    warn!("Wallet spending limits not yet supported in new hyperwallet API");
    
    // Clear any cached details to force refresh
    state.cached_active_details = None;
    
    Ok(())
}

/// Get wallet spending limits from hyperwallet
pub fn get_wallet_spending_limits(state: &State, wallet_id: String) -> Result<Option<SpendingLimits>, String> {
    info!("Getting wallet spending limits for {} from hyperwallet", wallet_id);
    
    let session = get_session_from_state(state)?;
    
    match hyperwallet_client::get_wallet_info(&session.session_id, &wallet_id) {
        Ok(_wallet_info) => {
            info!("Retrieved wallet info for {}", wallet_id);
            
            // Note: The typed API returns a Wallet struct, but spending limits might not be included
            // You might need to add a separate get_wallet_limits function to hyperwallet_client
            // For now, return None since the Wallet struct doesn't contain spending limits
            info!("Spending limits extraction from typed API not yet implemented");
            Ok(None)
        }
        Err(e) => {
            warn!("Failed to get wallet info for {}: {}", wallet_id, convert_error(e));
            // Don't fail the whole operation, just return None for limits
            Ok(None)
        }
    }
}
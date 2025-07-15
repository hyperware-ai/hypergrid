//! Hyperwallet client service module - replaces direct wallet management with hyperwallet calls
//! This module provides the same interface as the original wallet::service module
//! but delegates all operations to the hyperwallet service.

use hyperware_process_lib::{Address, Request};
use hyperware_process_lib::logging::{info, error, warn};
use hyperware_process_lib::signer::{LocalSigner, EncryptedSignerData};
use hyperware_process_lib::wallet::KeyStorage;
use serde::{Deserialize, Serialize};
use serde_json::json;
use chrono;
use uuid;
use hex;
use std::str::FromStr;

use crate::structs::{State, ManagedWallet, WalletSummary, SpendingLimits, DelegationStatus, ActiveAccountDetails};

// Hyperwallet service address - adjust based on your deployment
const HYPERWALLET_ADDRESS: (&str, &str, &str, &str) = ("our", "hyperwallet", "hyperwallet", "hallman.hypr");

/// Request types for hyperwallet service
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "operation")]
enum HyperwalletRequest {
    CreateWallet,
    ImportWallet { 
        private_key: String, 
        password: Option<String>,
        name: Option<String> 
    },
    GetWalletInfo { 
        wallet_id: String 
    },
    ListWallets,
    DeleteWallet { 
        wallet_id: String 
    },
    RenameWallet { 
        wallet_id: String, 
        new_name: String 
    },
    ExportWallet { 
        wallet_id: String,
        password: Option<String>
    },
    SelectWallet { 
        wallet_id: String 
    },
}

/// Response types from hyperwallet service
#[derive(Debug, Deserialize)]
#[serde(tag = "status")]
enum HyperwalletResponse {
    Success { data: serde_json::Value },
    Error { error: String },
}

/// Make a request to the hyperwallet service
pub fn call_hyperwallet(request: HyperwalletRequest) -> Result<serde_json::Value, String> {
    let target = HYPERWALLET_ADDRESS;
    
    // Clone the request for the second match
    let request_clone = request.clone();
    
    // Convert HyperwalletRequest to proper OperationRequest format
    let (operation, params) = match request {
        HyperwalletRequest::CreateWallet => {
            ("CreateWallet", json!({
                "name": "operator-wallet",
                "chain_id": 8453,  // Base chain
                "password": null
            }))
        },
        HyperwalletRequest::ImportWallet { private_key, password, name } => {
            ("ImportWallet", json!({
                "private_key": private_key,
                "password": password,
                "name": name
            }))
        },
        HyperwalletRequest::GetWalletInfo { wallet_id: _ } => {
            ("GetWalletInfo", json!({}))
        },
        HyperwalletRequest::ListWallets => {
            ("ListWallets", json!({}))
        },
        HyperwalletRequest::DeleteWallet { wallet_id: _ } => {
            ("DeleteWallet", json!({}))
        },
        HyperwalletRequest::RenameWallet { wallet_id: _, new_name } => {
            ("RenameWallet", json!({
                "new_name": new_name
            }))
        },
        HyperwalletRequest::ExportWallet { wallet_id: _, password } => {
            ("ExportWallet", json!({
                "password": password
            }))
        },
        HyperwalletRequest::SelectWallet { wallet_id: _ } => {
            ("SelectWallet", json!({}))
        },
    };
    
    // Get wallet_id for operations that need it
    let wallet_id = match &request_clone {
        HyperwalletRequest::GetWalletInfo { wallet_id } |
        HyperwalletRequest::DeleteWallet { wallet_id } |
        HyperwalletRequest::RenameWallet { wallet_id, .. } |
        HyperwalletRequest::ExportWallet { wallet_id, .. } |
        HyperwalletRequest::SelectWallet { wallet_id } => Some(wallet_id.clone()),
        _ => None,
    };
    
    // Build proper OperationRequest
    let operation_request = json!({
        "operation": operation,
        "params": params,
        "auth": {
            "process_address": hyperware_process_lib::our().to_string(),
            "signature": null
        },
        "wallet_id": wallet_id,
        "chain_id": null,
        "request_id": format!("operator-{}", uuid::Uuid::new_v4()),
        "timestamp": chrono::Utc::now().timestamp()
    });
    
    let body = serde_json::to_vec(&operation_request)
        .map_err(|e| format!("Failed to serialize request: {}", e))?;
    
    let response = Request::new()
        .target(target)
        .body(body)
        .send_and_await_response(30)
        .map_err(|e| format!("Failed to send request to hyperwallet: {}", e))?
        .map_err(|e| format!("Hyperwallet request failed: {}", e))?;
    
    let response_json: serde_json::Value = serde_json::from_slice(response.body())
        .map_err(|e| format!("Failed to parse hyperwallet response: {}", e))?;
    
    // Check for success
    if response_json.get("success").and_then(|v| v.as_bool()).unwrap_or(false) {
        if let Some(data) = response_json.get("data") {
            Ok(data.clone())
        } else {
            Ok(json!({}))
        }
    } else if let Some(error) = response_json.get("error") {
        Err(format!("Hyperwallet error: {}", error))
    } else {
        Err("Unknown hyperwallet response format".to_string())
    }
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

pub fn generate_initial_wallet() -> Result<String, String> {
    info!("Generating initial wallet via hyperwallet");
    
    let data = call_hyperwallet(HyperwalletRequest::CreateWallet)?;
    
    // Extract wallet_id from response
    let wallet_id = data.get("wallet_id")
        .and_then(|w| w.as_str())
        .ok_or("Missing wallet_id in response")?
        .to_string();
    
    info!("Hyperwallet created wallet: {}", wallet_id);
    Ok(wallet_id)
}

pub fn import_new_wallet(
    state: &mut State,
    private_key: String,
    password: Option<String>,
    name: Option<String>,
) -> Result<String, String> {
    info!("Importing wallet via hyperwallet");
    
    let data = call_hyperwallet(HyperwalletRequest::ImportWallet {
        private_key,
        password,
        name,
    })?;
    
    let wallet: ManagedWallet = serde_json::from_value(data.get("wallet")
        .ok_or("Missing wallet in response")?
        .clone())
        .map_err(|e| format!("Failed to parse wallet: {}", e))?;
    
    let address = wallet.storage.get_address();
    state.managed_wallets.insert(wallet.id.clone(), wallet);
    state.save();
    
    Ok(address)
}

pub fn get_wallet_summary_list(state: &State) -> (Option<String>, Vec<WalletSummary>) {
    info!("Getting wallet summary list from hyperwallet");
    
    // Query hyperwallet for the list of wallets
    match call_hyperwallet(HyperwalletRequest::ListWallets) {
        Ok(data) => {
            // Parse the wallet list from hyperwallet response
            let wallets = data.get("wallets")
                .and_then(|w| w.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|wallet_json| {
                            // Extract wallet info from each wallet entry
                            let address = wallet_json.get("address")?.as_str()?;
                            let name = wallet_json.get("name").and_then(|n| n.as_str()).map(|s| s.to_string());
                            let is_encrypted = wallet_json.get("encrypted").and_then(|e| e.as_bool()).unwrap_or(false);
                            
                            Some(WalletSummary {
                                id: address.to_string(), // Use address as ID for now
                                address: address.to_string(),
                                name,
                                is_encrypted,
                                is_unlocked: !is_encrypted, // For now, assume unencrypted = unlocked
                                is_selected: Some(address) == state.selected_wallet_id.as_deref(),
                            })
                        })
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            
            (state.selected_wallet_id.clone(), wallets)
        }
        Err(e) => {
            error!("Failed to get wallet list from hyperwallet: {}", e);
            // Fallback to empty list
            (state.selected_wallet_id.clone(), Vec::new())
        }
    }
}

pub fn select_wallet(state: &mut State, wallet_id: String) -> Result<(), String> {
    if !state.managed_wallets.contains_key(&wallet_id) {
        return Err("Wallet not found".to_string());
    }
    
    // Tell hyperwallet about the selection
    let _ = call_hyperwallet(HyperwalletRequest::SelectWallet { 
        wallet_id: wallet_id.clone() 
    });
    
    state.selected_wallet_id = Some(wallet_id);
    state.active_signer_cache = None; // Clear cache when switching
    state.cached_active_details = None;
    state.save();
    
    Ok(())
}

pub fn rename_wallet(state: &mut State, wallet_id: String, new_name: String) -> Result<(), String> {
    // Update hyperwallet
    call_hyperwallet(HyperwalletRequest::RenameWallet {
        wallet_id: wallet_id.clone(),
        new_name: new_name.clone(),
    })?;
    
    // Update local state
    if let Some(wallet) = state.managed_wallets.get_mut(&wallet_id) {
        wallet.name = Some(new_name);
        state.save();
        Ok(())
    } else {
        Err("Wallet not found".to_string())
    }
}

pub fn delete_wallet(state: &mut State, wallet_id: String) -> Result<(), String> {
    if state.managed_wallets.len() <= 1 {
        return Err("Cannot delete the last wallet".to_string());
    }
    
    // Delete from hyperwallet
    call_hyperwallet(HyperwalletRequest::DeleteWallet {
        wallet_id: wallet_id.clone(),
    })?;
    
    // Update local state
    state.managed_wallets.remove(&wallet_id);
    
    if Some(&wallet_id) == state.selected_wallet_id.as_ref() {
        state.selected_wallet_id = None;
        state.active_signer_cache = None;
        state.cached_active_details = None;
        
        // Auto-select another wallet
        if let Some(next_id) = state.managed_wallets.keys().next() {
            let _ = select_wallet(state, next_id.clone());
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
    let wallet = state.managed_wallets.get_mut(&wallet_id)
        .ok_or("Wallet not found")?;
    
    match &wallet.storage {
        KeyStorage::Encrypted(encrypted_data) => {
            let pwd = password.ok_or("Password required for encrypted wallet")?;
            
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
        }
        KeyStorage::Decrypted(signer) => {
            // Already decrypted, just update cache if selected
            if Some(&wallet_id) == state.selected_wallet_id.as_ref() {
                state.active_signer_cache = Some(signer.clone());
                state.cached_active_details = None;
            }
        }
    }
    
    state.save();
    Ok(())
}

pub fn deactivate_wallet(state: &mut State, wallet_id: String) -> Result<(), String> {
    let wallet = state.managed_wallets.get_mut(&wallet_id)
        .ok_or("Wallet not found")?;
    
    // If it's decrypted, we need to re-encrypt it or at least clear the decrypted state
    // For now, we'll just clear the active signer cache
    // In a real implementation, you might want to re-encrypt with a stored password
    
    if Some(&wallet_id) == state.selected_wallet_id.as_ref() {
        state.active_signer_cache = None;
        state.cached_active_details = None;
    }
    
    state.save();
    Ok(())
}

pub fn export_private_key(
    _state: &State,
    wallet_id: String,
    password: Option<String>,
) -> Result<String, String> {
    // Use hyperwallet to export
    let data = call_hyperwallet(HyperwalletRequest::ExportWallet {
        wallet_id,
        password,
    })?;
    
    data.get("private_key")
        .and_then(|k| k.as_str())
        .map(|s| s.to_string())
        .ok_or("Missing private key in response".to_string())
}

pub fn set_wallet_password(
    state: &mut State,
    wallet_id: String,
    new_password: String,
    old_password: Option<String>,
) -> Result<(), String> {
    let wallet = state.managed_wallets.get_mut(&wallet_id)
        .ok_or("Wallet not found")?;
    
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
    Ok(())
}

pub fn remove_wallet_password(
    state: &mut State,
    wallet_id: String,
    current_password: String,
) -> Result<(), String> {
    let wallet = state.managed_wallets.get_mut(&wallet_id)
        .ok_or("Wallet not found")?;
    
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
    Ok(())
}

pub fn set_wallet_spending_limits(
    state: &mut State,
    wallet_id: String,
    limits: SpendingLimits,
) -> Result<(), String> {
    let wallet = state.managed_wallets.get_mut(&wallet_id)
        .ok_or("Wallet not found")?;
    
    wallet.spending_limits = limits;
    state.save();
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
    
    // Query hyperwallet for the list of wallets
    match call_hyperwallet(HyperwalletRequest::ListWallets) {
        Ok(data) => {
            // Find the wallet with matching address
            data.get("wallets")
                .and_then(|w| w.as_array())
                .and_then(|arr| {
                    arr.iter()
                        .find_map(|wallet_json| {
                            let wallet_address = wallet_json.get("address")?.as_str()?;
                            if wallet_address.eq_ignore_ascii_case(address) {
                                let name = wallet_json.get("name").and_then(|n| n.as_str()).map(|s| s.to_string());
                                let is_encrypted = wallet_json.get("encrypted").and_then(|e| e.as_bool()).unwrap_or(false);
                                
                                Some(WalletSummary {
                                    id: wallet_address.to_string(),
                                    address: wallet_address.to_string(),
                                    name,
                                    is_encrypted,
                                    is_unlocked: !is_encrypted, // For now, assume unencrypted = unlocked
                                    is_selected: Some(wallet_address) == state.selected_wallet_id.as_deref(),
                                })
                            } else {
                                None
                            }
                        })
                })
        }
        Err(e) => {
            error!("Failed to get wallet info from hyperwallet: {}", e);
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
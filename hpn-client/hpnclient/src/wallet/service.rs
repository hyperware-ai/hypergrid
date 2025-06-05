// High-level wallet management helpers.
//
// This module simply re-exports the logic that currently lives in
// `crate::wallet_manager`.  Splitting the file like this lets callers start
// using `crate::wallet::service::*` without needing to touch the old
// monolithic file.  Incremental refactors can now move the *actual*
// implementation over piece-by-piece.

//pub use crate::wallet_manager::{
//    AssetType,
//    verify_selected_hot_wallet_delegation_detailed,
//    verify_single_hot_wallet_delegation_detailed,
//    check_onchain_delegation_status,
//};

use crate::structs::{State, SpendingLimits, WalletSummary, ManagedWallet, ActiveAccountDetails, DelegationStatus};
use hyperware_process_lib::logging::{info, error};
use hyperware_process_lib::signer::{LocalSigner, Signer};
use hyperware_process_lib::wallet::{KeyStorage, get_eth_balance, get_token_details};
use hyperware_process_lib::{eth, hypermap};
use anyhow::Result as AnyResult;
use alloy_primitives::{Address, B256, Bytes};
use alloy_sol_types::SolValue;
use std::str::FromStr;
use hex;

// Re-export configuration constants
use crate::wallet::payments::{BASE_CHAIN_ID, BASE_USDC_ADDRESS};

/// Generates a new random ManagedWallet (unencrypted, active) but does not add it to state.
/// Returns Ok(ManagedWallet) or Err(error_message as String).
pub fn generate_initial_wallet() -> Result<ManagedWallet, String> {
    info!("Attempting to generate a new wallet...");
    match LocalSigner::new_random(8453) {
        Ok(new_signer) => {
            let address = new_signer.address().to_string();
            info!("Generated new signer with address: {}", address);

            let initial_limits = SpendingLimits::default();

            let managed_wallet = ManagedWallet {
                id: address.clone(),
                name: None,
                storage: KeyStorage::Decrypted(new_signer.clone()),
                is_active: true,
                spending_limits: initial_limits,
            };

            info!("Created ManagedWallet struct for ID: {}", address);
            Ok(managed_wallet)
        }
        Err(e) => {
            error!("Failed to generate new random signer: {:?}", e);
            Err(format!("Failed to generate new random signer: {}", e))
        }
    }
}

/// Ensures wallet state is initialized correctly on load.
/// If no wallets exist, generates a new one, adds it, and selects it.
/// Tries to populate active_signer_cache for the selected wallet if possible.
pub fn initialize_wallet(state: &mut State) {
    info!("Initializing wallet manager...");

    if state.managed_wallets.is_empty() {
        info!("No wallets found in state. Generating initial wallet...");
        match generate_initial_wallet() {
            Ok(initial_wallet) => {
                let wallet_id = initial_wallet.id.clone();
                let signer_option = match &initial_wallet.storage {
                    KeyStorage::Decrypted(signer) => Some(signer.clone()),
                    _ => None,
                };

                state.managed_wallets.insert(wallet_id.clone(), initial_wallet);
                state.selected_wallet_id = Some(wallet_id.clone());
                state.active_signer_cache = signer_option;

                info!("Successfully added and selected initial wallet: {}", wallet_id);
                state.save();
                info!("Initial wallet state generated and saved.");
            }
            Err(e) => {
                error!("Failed to generate initial wallet: {}", e);
                state.selected_wallet_id = None;
                state.active_signer_cache = None;
            }
        }
    } else {
        info!("Found {} existing wallets.", state.managed_wallets.len());
        if let Some(selected_id) = &state.selected_wallet_id {
            info!("Selected wallet ID: {}", selected_id);
            if let Some(wallet) = state.managed_wallets.get(selected_id) {
                if wallet.is_active {
                    if let KeyStorage::Decrypted(signer) = &wallet.storage {
                        info!("Activating selected wallet (stored decrypted).");
                        state.active_signer_cache = Some(signer.clone());
                    } else {
                        info!("Selected wallet is active but requires password for operations.");
                        state.active_signer_cache = None;
                    }
                } else {
                    info!("Selected wallet is not active.");
                    state.active_signer_cache = None;
                }
            } else {
                error!("Selected wallet ID {} not found in managed_wallets! Clearing selection.", selected_id);
                state.selected_wallet_id = None;
                state.active_signer_cache = None;
            }
        } else {
            info!("No wallet selected.");
            state.active_signer_cache = None;
        }

        if state.active_signer_cache.is_some() && state.selected_wallet_id.is_none() {
            state.active_signer_cache = None;
        }
    }
    info!("Wallet manager initialization complete.");
}

/// Returns a list of summaries for all managed wallets and the ID of the selected one.
pub fn get_wallet_summary_list(state: &State) -> (Option<String>, Vec<WalletSummary>) {
    info!("Getting wallet summary list...");
    let summaries = state
        .managed_wallets
        .iter()
        .map(|(id, wallet)| {
            let is_selected = state.selected_wallet_id.as_deref() == Some(id);
            let (is_encrypted, address) = match &wallet.storage {
                KeyStorage::Encrypted(data) => (true, data.address.clone()),
                KeyStorage::Decrypted(signer) => (false, signer.address().to_string()),
            };
            let is_unlocked = is_selected && state.active_signer_cache.is_some();

            WalletSummary {
                id: id.clone(),
                name: wallet.name.clone(),
                address,
                is_active: wallet.is_active,
                is_encrypted,
                is_selected,
                is_unlocked,
            }
        })
        .collect::<Vec<_>>();

    info!("Wallet summaries generated: {:#?}", summaries);
    info!("Selected wallet ID: {:?}", state.selected_wallet_id);

    (state.selected_wallet_id.clone(), summaries)
}

/// Selects a wallet by its ID, clears the active signer cache, and attempts to
/// populate the cache if the wallet is active and decrypted.
pub fn select_wallet(state: &mut State, wallet_id: String) -> Result<(), String> {
    info!("Attempting to select wallet ID: {}", &wallet_id);
    if !state.managed_wallets.contains_key(&wallet_id) {
        return Err(format!("Wallet ID {} not found.", wallet_id));
    }

    state.selected_wallet_id = Some(wallet_id.clone());
    state.active_signer_cache = None;
    info!("Cleared active signer cache.");

    if let Some(wallet) = state.managed_wallets.get(&wallet_id) {
        if wallet.is_active {
            if let KeyStorage::Decrypted(signer) = &wallet.storage {
                info!("Selected wallet is active and unencrypted. Populating signer cache.");
                state.active_signer_cache = Some(signer.clone());
            } else {
                info!("Selected wallet is active but encrypted. Needs activation for operations.");
            }
        } else {
            info!("Selected wallet is not active.");
        }
    }

    state.cached_active_details = None;
    state.save();
    info!("Selected wallet set to: {}", wallet_id);
    Ok(())
}

/// Sets the spending limits for a specific wallet.
pub fn set_wallet_spending_limits(state: &mut State, wallet_id: String, limits: SpendingLimits) -> Result<(), String> {
    info!("Setting spending limits for wallet ID: {}", wallet_id);
    let wallet = state
        .managed_wallets
        .get_mut(&wallet_id)
        .ok_or_else(|| format!("Wallet ID {} not found.", wallet_id))?;

    wallet.spending_limits = limits.clone();
    state.save();
    info!("Spending limits updated for wallet {}: {:?}", wallet_id, limits);
    Ok(())
}

/// Renames a wallet by its ID.
pub fn rename_wallet(state: &mut State, wallet_id: String, new_name: String) -> Result<(), String> {
    info!("Attempting to rename wallet ID: {} to '{}'", wallet_id, new_name);
    let wallet = state
        .managed_wallets
        .get_mut(&wallet_id)
        .ok_or_else(|| format!("Wallet ID {} not found for renaming.", wallet_id))?;

    wallet.name = Some(new_name.clone());
    state.save();
    info!("Wallet {} renamed successfully to '{}'.", wallet_id, new_name);
    Ok(())
}

/// Deletes a wallet by its ID.
pub fn delete_wallet(state: &mut State, wallet_id: String) -> Result<(), String> {
    info!("Attempting to delete wallet ID: {}", wallet_id);
    if state.managed_wallets.remove(&wallet_id).is_none() {
        return Err(format!("Wallet ID {} not found for deletion.", wallet_id));
    }

    info!("Removed wallet {} from managed wallets.", wallet_id);

    if state.selected_wallet_id.as_deref() == Some(&wallet_id) {
        info!("Deleted wallet was selected. Clearing selection and cache.");
        state.selected_wallet_id = None;
        state.active_signer_cache = None;
        state.cached_active_details = None;
    }

    state.save();
    Ok(())
}

/// Imports a private key, encrypts it, stores it as a new ManagedWallet.
pub fn import_new_wallet(
    state: &mut State,
    pk_hex: String,
    password: String,
    name: Option<String>,
) -> Result<String, String> {
    info!("Attempting to import new private key...");
    let pk_trimmed = pk_hex.trim_start_matches("0x");

    match LocalSigner::from_private_key(pk_trimmed, BASE_CHAIN_ID) {
        Ok(signer) => {
            let address = signer.address().to_string();
            // Check if wallet with this address already exists
            if state.managed_wallets.contains_key(&address) {
                error!("Wallet with address {} already exists.", address);
                return Err(format!("Wallet with address {} already exists.", address));
            }

            info!("PK valid, encrypting for address: {}", address);
            match signer.encrypt(&password) {
                Ok(encrypted_storage_data) => {
                    let limits = SpendingLimits::default();
                    
                    // Only set name if provided and not empty
                    let wallet_name = name.filter(|n| !n.trim().is_empty());
                    
                    let new_wallet = ManagedWallet {
                        id: address.clone(),
                        name: wallet_name,
                        storage: KeyStorage::Encrypted(encrypted_storage_data),
                        is_active: false, // Start inactive
                        spending_limits: limits,
                    };

                    state.managed_wallets.insert(address.clone(), new_wallet);
                    info!("New wallet {} added to managed wallets.", address);

                    // Select if nothing else is selected
                    if state.selected_wallet_id.is_none() {
                        state.selected_wallet_id = Some(address.clone());
                        state.active_signer_cache = None;
                        info!("Wallet {} automatically selected as it's the first one.", address);
                    }
                    
                    state.cached_active_details = None;
                    state.save();
                    info!("Wallet imported and saved (encrypted). Status: Inactive.");
                    Ok(address)
                }
                Err(e) => {
                    error!("Failed to encrypt new wallet {}: {:?}", address, e);
                    Err(format!("Failed to encrypt wallet: {}", e))
                }
            }
        }
        Err(e) => {
            error!("Failed to import private key: {:?}", e);
            Err(format!("Invalid private key format or value: {}", e))
        }
    }
}

/// Exports the private key for a specific wallet.
pub fn export_private_key(
    state: &State,
    wallet_id: String,
    password: Option<String>,
) -> Result<String, String> {
    info!("Attempting to export private key for wallet ID: {}", wallet_id);
    let wallet = state.managed_wallets.get(&wallet_id)
        .ok_or_else(|| format!("Wallet ID {} not found.", wallet_id))?;

    // Decide if we can use the cache or need decryption
    let use_cache = wallet.is_active 
                    && Some(wallet_id.clone()) == state.selected_wallet_id 
                    && state.active_signer_cache.is_some();

    if use_cache {
        info!("Exporting key from active signer cache for selected wallet {}.", wallet_id);
        return Ok(state.active_signer_cache.as_ref().unwrap().export_private_key());
    }

    // Need to get from storage
    match &wallet.storage {
        KeyStorage::Decrypted(signer) => {
            info!("Exporting key from unencrypted storage for wallet {}.", wallet_id);
            Ok(signer.export_private_key())
        }
        KeyStorage::Encrypted(encrypted_data) => {
            info!("Wallet {} is encrypted, attempting decryption for export...", wallet_id);
            match password {
                Some(pwd) => {
                    match LocalSigner::decrypt(encrypted_data, &pwd) {
                        Ok(signer) => {
                            info!("Decryption successful, exporting key for {}.", wallet_id);
                            Ok(signer.export_private_key())
                        }
                        Err(e) => {
                            error!("Failed to decrypt wallet {} for export: {:?}", wallet_id, e);
                            Err("Incorrect password or corrupt data".to_string())
                        }
                    }
                }
                None => {
                    error!("Password required to export private key from encrypted wallet {}.", wallet_id);
                    Err("Password required for export".to_string())
                }
            }
        }
    }
}

/// Sets or changes the password for a specific wallet.
pub fn set_wallet_password(
    state: &mut State,
    wallet_id: String,
    new_password: String,
    old_password: Option<String>,
) -> Result<(), String> {
    info!("Attempting to set/change password for wallet ID: {}", wallet_id);
    if new_password.is_empty() {
        return Err("New password cannot be empty".to_string());
    }

    // Get the storage owned to potentially replace it
    let current_storage = state.managed_wallets.get(&wallet_id)
        .ok_or_else(|| format!("Wallet ID {} not found.", wallet_id))?
        .storage.clone();

    let new_storage = match current_storage {
        KeyStorage::Decrypted(signer) => {
            info!("Encrypting existing unencrypted wallet {}...", wallet_id);
            signer.encrypt(&new_password)
                .map(KeyStorage::Encrypted)
                .map_err(|e| format!("Failed to encrypt wallet: {}", e))?
        }
        KeyStorage::Encrypted(encrypted_data) => {
            info!("Changing password for encrypted wallet {}...", wallet_id);
            let old_pwd = old_password.ok_or_else(|| {
                error!("Old password required to change password for encrypted wallet {}.", wallet_id);
                "Old password required".to_string()
            })?;

            // Decrypt with old
            let signer = LocalSigner::decrypt(&encrypted_data, &old_pwd)
                .map_err(|e| {
                    error!("Failed to decrypt wallet {} with old password: {:?}", wallet_id, e);
                    "Incorrect old password or corrupt data".to_string()
                })?;
            
            // Encrypt with new
            signer.encrypt(&new_password)
                .map(KeyStorage::Encrypted)
                .map_err(|e| {
                    error!("Failed to re-encrypt wallet {} with new password: {:?}", wallet_id, e);
                    format!("Failed to encrypt with new password: {}", e)
                })?
        }
    };

    // Update the actual wallet in the map
    if let Some(wallet) = state.managed_wallets.get_mut(&wallet_id) {
        wallet.storage = new_storage;
        wallet.is_active = false; // Deactivate after password change/set
        info!("Successfully updated storage and deactivated wallet {}.", wallet_id);

        // If this was the selected wallet, clear the cache
        if state.selected_wallet_id.as_deref() == Some(&wallet_id) {
            info!("Clearing active signer cache for {}.", wallet_id);
            state.active_signer_cache = None;
        }
        state.cached_active_details = None;
        state.save();
        Ok(())
    } else {
        Err(format!("Wallet {} disappeared during operation!", wallet_id))
    }
}

/// Removes the password from a specific encrypted wallet.
pub fn remove_wallet_password(
    state: &mut State,
    wallet_id: String,
    current_password: String,
) -> Result<(), String> {
    info!("Attempting to remove password for wallet ID: {}", wallet_id);
    if current_password.is_empty() {
        return Err("Current password cannot be empty".to_string());
    }

    // Get the storage owned to potentially replace it
    let current_storage = state.managed_wallets.get(&wallet_id)
        .ok_or_else(|| format!("Wallet ID {} not found.", wallet_id))?
        .storage.clone();

    let signer = match current_storage {
        KeyStorage::Encrypted(encrypted_data) => {
            LocalSigner::decrypt(&encrypted_data, &current_password)
                .map_err(|e| {
                    error!("Failed to decrypt wallet {} to remove password: {:?}", wallet_id, e);
                    "Incorrect password or corrupt data".to_string()
                })?
        }
        KeyStorage::Decrypted(_) => {
            info!("Wallet {} is already unencrypted.", wallet_id);
            return Err("Wallet is already unencrypted".to_string());
        }
    };

    // Update the actual wallet in the map
    if let Some(wallet) = state.managed_wallets.get_mut(&wallet_id) {
        wallet.storage = KeyStorage::Decrypted(signer.clone());
        wallet.is_active = true; // Activate after removing password
        info!("Password removed for wallet {}. Storing unencrypted.", wallet_id);

        // If this is the selected wallet, populate the cache
        if state.selected_wallet_id.as_deref() == Some(&wallet_id) {
            info!("Updating active signer cache for {}.", wallet_id);
            state.active_signer_cache = Some(signer);
        }
        state.cached_active_details = None;
        state.save();
        Ok(())
    } else {
        Err(format!("Wallet {} disappeared during operation!", wallet_id))
    }
}

/// Returns the full details for the currently selected AND unlocked account.
pub fn get_active_account_details(state: &State) -> AnyResult<Option<ActiveAccountDetails>> {
    info!("Attempting to get active account details...");
    
    // Check if an account is selected and its signer is cached (unlocked)
    if let Some(selected_id) = &state.selected_wallet_id {
        if state.active_signer_cache.is_some() {
            // Get the managed wallet data
            if let Some(wallet) = state.managed_wallets.get(selected_id) {
                info!("Found selected and unlocked account: {}", selected_id);
                
                // Fetch balances
                let provider = eth::Provider::new(BASE_CHAIN_ID, 60);
                let address_str = &wallet.storage.get_address();
                
                let eth_balance_res = get_eth_balance(address_str, BASE_CHAIN_ID, provider.clone());
                let usdc_details_res = get_token_details(BASE_USDC_ADDRESS, address_str, &provider);

                let eth_balance_str = match eth_balance_res {
                    Ok(bal) => Some(bal.to_display_string()),
                    Err(e) => {
                        error!("Failed to get ETH balance for {}: {:?}", address_str, e);
                        None
                    }
                };
                let usdc_balance_str = match usdc_details_res {
                    Ok(details) => Some(format!("{} {}", details.formatted_balance, details.symbol)),
                    Err(e) => {
                        error!("Failed to get USDC details for {}: {:?}", address_str, e);
                        None
                    }
                };

                // Construct the details object
                let details = ActiveAccountDetails {
                    id: wallet.id.clone(),
                    name: wallet.name.clone(),
                    address: address_str.clone(),
                    is_active: wallet.is_active,
                    is_encrypted: matches!(wallet.storage, KeyStorage::Encrypted(_)),
                    is_selected: true,
                    is_unlocked: true,
                    eth_balance: eth_balance_str,
                    usdc_balance: usdc_balance_str,
                };
                Ok(Some(details))

            } else {
                error!("Selected wallet ID {} not found in managed_wallets!", selected_id);
                Err(anyhow::anyhow!("Internal state inconsistency: selected wallet not found"))
            }
        } else {
            info!("No account unlocked (signer not cached).");
            Ok(None)
        }
    } else {
        info!("No account selected.");
        Ok(None)
    }
}

/// Activates a specific wallet, decrypting if necessary.
pub fn activate_wallet(
    state: &mut State,
    wallet_id: String,
    password: Option<String>,
) -> Result<(), String> {
    info!("Attempting to activate/unlock wallet ID: {}", wallet_id);

    let wallet = state
        .managed_wallets
        .get_mut(&wallet_id)
        .ok_or_else(|| format!("Wallet ID {} not found.", wallet_id))?;

    match (&wallet.storage, wallet.is_active) {
        (KeyStorage::Decrypted(signer), true) => {
            info!("Wallet {} already active and unlocked.", wallet_id);
            if Some(wallet_id.clone()) == state.selected_wallet_id && state.active_signer_cache.is_none() {
                info!("Updating active signer cache for {}.", wallet_id);
                state.active_signer_cache = Some(signer.clone());
            }
            Ok(())
        }
        (KeyStorage::Encrypted(enc), true) => {
            info!("Wallet {} is active but locked. Attempting unlock...", wallet_id);
            let pwd = password.ok_or_else(|| "Password required to unlock".to_string())?;
            let signer = LocalSigner::decrypt(enc, &pwd).map_err(|_| "Incorrect password or corrupt data".to_string())?;
            state.cached_active_details = None;
            if Some(wallet_id.clone()) == state.selected_wallet_id {
                state.active_signer_cache = Some(signer);
            }
            Ok(())
        }
        (KeyStorage::Decrypted(signer), false) => {
            info!("Activating unencrypted wallet {}.", wallet_id);
            wallet.is_active = true;
            if Some(wallet_id.clone()) == state.selected_wallet_id {
                state.active_signer_cache = Some(signer.clone());
            }
            state.save();
            Ok(())
        }
        (KeyStorage::Encrypted(enc), false) => {
            info!("Activating encrypted wallet {}. Requires password...", wallet_id);
            let pwd = password.ok_or_else(|| "Password required".to_string())?;
            let signer = LocalSigner::decrypt(enc, &pwd).map_err(|_| "Incorrect password or corrupt data".to_string())?;
            wallet.is_active = true;
            if Some(wallet_id.clone()) == state.selected_wallet_id {
                state.active_signer_cache = Some(signer);
            }
            state.save();
            Ok(())
        }
    }
}

/// Deactivates a specific wallet.
pub fn deactivate_wallet(state: &mut State, wallet_id: String) -> Result<(), String> {
    info!("Attempting to deactivate wallet ID: {}", wallet_id);
    let wallet = state
        .managed_wallets
        .get_mut(&wallet_id)
        .ok_or_else(|| format!("Wallet ID {} not found.", wallet_id))?;

    if !wallet.is_active {
        info!("Wallet {} is already inactive.", wallet_id);
        return Ok(());
    }

    wallet.is_active = false;
    info!("Deactivated wallet {}.", wallet_id);

    if Some(wallet_id) == state.selected_wallet_id {
        state.active_signer_cache = None;
    }

    state.cached_active_details = None;
    state.save();
    Ok(())
}

/// Returns a reference to the active signer from the cache.
pub fn get_active_signer(state: &State) -> anyhow::Result<&LocalSigner> {
    state
        .active_signer_cache
        .as_ref()
        .ok_or_else(|| anyhow::anyhow!("No active signer available. Wallet may be inactive, locked, or none selected."))
}

/// Attempts to get a LocalSigner for a specific wallet ID if it's stored decrypted.
pub fn get_decrypted_signer_for_wallet(state: &State, wallet_id: &str) -> Result<LocalSigner, String> {
    match state.managed_wallets.get(wallet_id) {
        Some(wallet) => match &wallet.storage {
            KeyStorage::Decrypted(signer) => Ok(signer.clone()),
            KeyStorage::Encrypted(_) => Err(format!("Wallet {} is encrypted and requires unlocking.", wallet_id)),
        },
        None => Err(format!("Wallet {} not found in managed wallets.", wallet_id)),
    }
}

/// Checks if a hot wallet is selected and active (unlocked).
pub fn check_hot_wallet_status(state: &State) -> Result<WalletSummary, String> {
    info!("Checking hot wallet status...");
    match &state.selected_wallet_id {
        Some(selected_id) => match state.managed_wallets.get(selected_id) {
            Some(wallet) => {
                if wallet.is_active {
                    if state.active_signer_cache.is_some() {
                        let summary = WalletSummary {
                            id: wallet.id.clone(),
                            name: wallet.name.clone(),
                            address: wallet.storage.get_address(),
                            is_active: wallet.is_active,
                            is_encrypted: matches!(wallet.storage, KeyStorage::Encrypted(_)),
                            is_selected: true,
                            is_unlocked: true,
                        };
                        Ok(summary)
                    } else {
                        Err(format!("Hot wallet '{}' is selected and active, but currently LOCKED.", selected_id))
                    }
                } else {
                    Err(format!("Hot wallet '{}' is selected but INACTIVE.", selected_id))
                }
            }
            None => Err(format!("Internal Error: Selected wallet ID '{}' not found.", selected_id)),
        },
        None => Err("No hot wallet is currently selected.".to_string()),
    }
}

/// Returns a WalletSummary for a given hot wallet address.
/// It checks if the wallet is managed by the client or is an external (on-chain linked only) wallet.
pub fn get_wallet_summary_for_address(state: &State, hot_wallet_address_str: &str) -> WalletSummary {
    info!("Getting wallet summary for address: {}", hot_wallet_address_str);

    if let Some(managed_wallet) = state.managed_wallets.get(hot_wallet_address_str) {
        // Wallet is managed by this HPN client
        let is_selected = state.selected_wallet_id.as_deref() == Some(hot_wallet_address_str);
        let is_unlocked = is_selected && managed_wallet.is_active && state.active_signer_cache.is_some();
        // For a managed wallet, address in summary should be derived from its storage to be canonical.
        let canonical_address = managed_wallet.storage.get_address();

        info!("  -> Found managed wallet: {}, Selected: {}, Unlocked: {}", hot_wallet_address_str, is_selected, is_unlocked);
        WalletSummary {
            id: managed_wallet.id.clone(), // Usually the same as hot_wallet_address_str
            name: managed_wallet.name.clone(),
            address: canonical_address, // Use canonical address from storage
            is_active: managed_wallet.is_active,
            is_encrypted: matches!(managed_wallet.storage, KeyStorage::Encrypted(_)),
            is_selected,
            is_unlocked,
        }
    } else {
        // Wallet is not managed by this HPN client (externally linked)
        info!("  -> Address {} not found in managed wallets. Treating as external.", hot_wallet_address_str);
        WalletSummary {
            id: hot_wallet_address_str.to_string(),
            name: Some("(External Hot Wallet)".to_string()), // Indicate it's external
            address: hot_wallet_address_str.to_string(),
            is_active: false,    // Cannot be active via this client if not managed
            is_encrypted: false, // Assume not encrypted or unknown, default to false for safety
            is_selected: false,  // Cannot be selected if not managed
            is_unlocked: false,  // Cannot be unlocked by this client if not managed
        }
    }
}

/// Gets all on-chain linked hot wallet addresses for a given operator entry name.
pub fn get_all_onchain_linked_hot_wallet_addresses(operator_entry_name_opt: Option<&str>) -> Result<Vec<String>, String> {
    let operator_entry_name = match operator_entry_name_opt {
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
    let provider = eth::Provider::new(BASE_CHAIN_ID, 60);
    let hypermap_address_obj = match Address::from_str(hypermap::HYPERMAP_ADDRESS) {
        Ok(addr) => addr,
        Err(_) => {
            let err_msg = "Internal Error: Failed to parse HYPERMAP_ADDRESS constant.".to_string();
            error!("  -> Error: {}", err_msg);
            return Err(err_msg);
        }
    };
    let hypermap_reader = hypermap::Hypermap::new(provider.clone(), hypermap_address_obj);

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
            Err(format!(
                "Failed to get signers note hash from access list '{}': {}",
                access_list_full_path, err_msg
            ))
        }
    }
}

/// Verifies that the currently selected hot wallet is listed as a delegate
/// in the Hypermap configuration for the Operator's primary entry.
/// Returns a detailed DelegationStatus enum.
pub fn verify_selected_hot_wallet_delegation_detailed(
    state: &State, 
    operator_entry_override: Option<&str> 
) -> DelegationStatus { 
    info!("Verifying hot wallet delegation (detailed)...",);

    let operator_sub_entry_name = match operator_entry_override {
        Some(name) => { info!("Using provided operator_entry_name: {}", name); name },
        None => match &state.operator_entry_name {
            Some(name) => { info!("Using state operator_entry_name: {}", name); name },
            None => { info!("Delegation check failed: Operator entry name not configured."); return DelegationStatus::NeedsIdentity; }
        }
    };

    let selected_wallet_id = match &state.selected_wallet_id {
        Some(id) => id,
        None => { info!("Delegation check failed: No hot wallet selected."); return DelegationStatus::NeedsHotWallet; }
    };
    let hot_wallet_address_str = match state.managed_wallets.get(selected_wallet_id) {
        Some(wallet) => wallet.storage.get_address(),
        None => { error!("Internal error: Selected wallet ID {} not found.", selected_wallet_id); return DelegationStatus::CheckError("Selected wallet data not found.".to_string()); }
    };
    let hot_wallet_address = match Address::from_str(&hot_wallet_address_str) {
        Ok(addr) => addr,
        Err(_) => { error!("Internal error: Failed to parse hot wallet address: {}", hot_wallet_address_str); return DelegationStatus::CheckError("Invalid hot wallet address format.".to_string()); }
    };
    if state.active_signer_cache.is_none() {
        info!("Delegation check info: Hot wallet {} selected but locked/inactive.", selected_wallet_id);
        return DelegationStatus::NeedsHotWallet; 
    }
    info!("Verifying delegation for Hot Wallet: {}", hot_wallet_address);

    let provider = eth::Provider::new(BASE_CHAIN_ID, 60); 
    let hypermap_address = match Address::from_str(hypermap::HYPERMAP_ADDRESS) {
        Ok(addr) => addr,
        Err(_) => return DelegationStatus::CheckError("Failed to parse HYPERMAP_ADDRESS constant.".to_string()),
    };
    let hypermap_reader = hypermap::Hypermap::new(provider.clone(), hypermap_address);

    let access_list_note_name = "~access-list";
    let access_list_full_path = format!("{}.{}", access_list_note_name, operator_sub_entry_name);
    info!("Step 4a: Reading access list note: {}", access_list_full_path);

    let perms_note_hash: B256 = match hypermap_reader.get(&access_list_full_path) {
        Ok((_tba, _owner, Some(data))) => {
            info!("Step 4b: Found access list data ({} bytes). Expecting 32-byte hash.", data.len());
            if data.len() == 32 {
                let hash = B256::from_slice(&data);
                info!("Step 4c: Successfully interpreted data as 32-byte namehash: {}", hash);
                hash
            } else {
                let reason = format!("Data in '{}' is not 32 bytes long (expected raw hash), length is {}.", access_list_full_path, data.len());
                error!("Delegation check failed: {}", reason);
                return DelegationStatus::AccessListNoteInvalidData(reason);
            }
        }
        Ok((_tba, _owner, None)) => {
            error!("Delegation check failed: Note '{}' exists but has no data.", access_list_full_path);
            return DelegationStatus::AccessListNoteInvalidData(format!("Note '{}' has no data.", access_list_full_path));
        }
        Err(e) => {
            error!("Delegation check failed: Error reading access list note '{}': {:?}", access_list_full_path, e);
            if format!("{:?}", e).contains("note not found") { 
                 return DelegationStatus::AccessListNoteMissing;
            } else {
                 return DelegationStatus::CheckError(format!("RPC/Read Error for '{}': {}", access_list_full_path, e));
            }
        }
    };

    let perms_note_hash_str = format!("0x{}", hex::encode(perms_note_hash));
    info!("Step 5a: Reading permissions note (signers note) using decoded hash: {}", perms_note_hash_str);

    let signers_note_data_bytes: Bytes = match hypermap_reader.get_hash(&perms_note_hash_str) { 
        Ok((_tba, _owner, Some(data))) => {
            info!("Step 5c: Found permissions data ({} bytes) for signers note. Expecting ABI-encoded Address[].", data.len());
            data
        }
        Ok((_tba, _owner, None)) => {
            error!("Delegation check failed: Signers note found by hash '{}' exists but has no data.", perms_note_hash_str);
            return DelegationStatus::SignersNoteMissing;
        }
        Err(e) => {
            error!("Delegation check failed: Error reading signers note by hash '{}': {:?}", perms_note_hash_str, e);
            if format!("{:?}", e).contains("note not found") { 
                return DelegationStatus::SignersNoteLookupError(format!("Signers note not found for hash {}", perms_note_hash_str));
             } else {
                return DelegationStatus::CheckError(format!("RPC/Read Error for signers note hash '{}': {}", perms_note_hash_str, e));
             }
        }
    };

    // --- Step 6: Revert to ABI-decoding Address[] for signers note value ---
    info!("Step 6: Verifying signers note data. Expecting ABI-encoded Address[] containing hot wallet {}", hot_wallet_address_str);
    match Vec::<Address>::abi_decode(&signers_note_data_bytes, true) { // true for lenient if padded
        Ok(decoded_delegates) => {
             info!("Step 6a: Successfully ABI-decoded signers note delegates: {:?}", decoded_delegates);
            if decoded_delegates.contains(&hot_wallet_address) {
                info!("Verification SUCCESS: Hot wallet {} IS in ABI-decoded delegate list from signers note.", hot_wallet_address_str);
                DelegationStatus::Verified
    } else {
                 info!("Verification FAILED: Hot wallet {} is NOT in ABI-decoded delegate list: {:?}", hot_wallet_address_str, decoded_delegates);
                 DelegationStatus::HotWalletNotInList
            }
        }
        Err(e) => {
            let reason = format!("Failed to ABI decode signers note data as Address[]: {}. Data(hex): 0x{}", e, hex::encode(signers_note_data_bytes));
            error!("Delegation check failed: {}", reason);
            DelegationStatus::SignersNoteInvalidData(reason)
        }
    }
    // --- End Step 6 ---
}

/// Verifies that a specific hot wallet is correctly delegated on-chain.
/// This function assumes `check_hot_wallet_status` has already passed (i.e., a hot wallet is selected and active).
/// Returns Ok(()) if delegation is verified, otherwise Err(String message).
pub fn check_onchain_delegation_status(state: &State) -> Result<(), String> {
    info!("Checking on-chain delegation status...");
    // verify_selected_hot_wallet_delegation_detailed already returns Result<DelegationStatus, String>
    // We just need to map its Ok(DelegationStatus::Verified) to Ok(()) and others to Err(String)
    match verify_selected_hot_wallet_delegation_detailed(state, None) {
        DelegationStatus::Verified => Ok(()),
        DelegationStatus::NeedsIdentity => Err("Delegation check FAILED: Operator identity not configured.".to_string()),
        DelegationStatus::NeedsHotWallet => Err("Delegation check FAILED: No hot wallet selected/active/unlocked.".to_string()),
        DelegationStatus::AccessListNoteMissing => Err("Delegation check FAILED: Access list note missing.".to_string()),
        DelegationStatus::AccessListNoteInvalidData(reason) => Err(format!("Delegation check FAILED: Access list note invalid data: {}", reason)),
        DelegationStatus::SignersNoteLookupError(reason) => Err(format!("Delegation check FAILED: Signers note lookup error: {}", reason)),
        DelegationStatus::SignersNoteMissing => Err("Delegation check FAILED: Signers note missing.".to_string()),
        DelegationStatus::SignersNoteInvalidData(reason) => Err(format!("Delegation check FAILED: Signers note invalid data: {}", reason)),
        DelegationStatus::HotWalletNotInList => Err("Delegation check FAILED: Hot wallet not in delegate list.".to_string()),
        DelegationStatus::CheckError(reason) => Err(format!("Delegation check FAILED: {}", reason)),
    }
}

/// Verifies delegation for a single hot wallet address
pub fn verify_single_hot_wallet_delegation_detailed(
    _state: &State, // state might be needed if we access managed wallet details, but not for pure on-chain check for now
    operator_entry_name: Option<&str>,
    hot_wallet_address_to_check_str: &str,
    // Consider passing eth_provider: &eth::Provider if managed centrally
) -> DelegationStatus {
    info!("Verifying single hot wallet delegation. Operator Entry: {:?}, Hot Wallet to Check: {}", 
        operator_entry_name, hot_wallet_address_to_check_str);

    let op_entry_name = match operator_entry_name {
        Some(name) => name,
        None => {
            error!("Delegation check failed: Operator entry name not provided.");
            return DelegationStatus::NeedsIdentity;
        }
    };

    let hot_wallet_to_check_addr = match Address::from_str(hot_wallet_address_to_check_str) {
        Ok(addr) => addr,
        Err(_) => {
            let reason = format!("Invalid hot wallet address format for checking: {}", hot_wallet_address_to_check_str);
            error!("Delegation check failed: {}", reason);
            return DelegationStatus::CheckError(reason);
        }
    };

    // Create a new provider instance for this check.
    // TODO: Consider passing this in if calls become frequent, to reuse the instance.
    let provider = eth::Provider::new(BASE_CHAIN_ID, 60); 
    let hypermap_address = match Address::from_str(hypermap::HYPERMAP_ADDRESS) {
        Ok(addr) => addr,
        Err(_) => {
            let reason = "Internal Error: Failed to parse HYPERMAP_ADDRESS constant.".to_string();
            error!("Delegation check failed: {}", reason);
            return DelegationStatus::CheckError(reason);
        }
    };
    let hypermap_reader = hypermap::Hypermap::new(provider.clone(), hypermap_address);

    let access_list_note_name = "~access-list";
    let access_list_full_path = format!("{}.{}", access_list_note_name, op_entry_name);
    info!("  Delegation Step 1: Reading access list note: {}", access_list_full_path);

    let signers_note_hash_b256: B256 = match hypermap_reader.get(&access_list_full_path) {
        Ok((_tba, _owner, Some(data))) => {
            info!("    Found access list data ({} bytes). Expecting 32-byte hash.", data.len());
            if data.len() == 32 {
                let hash = B256::from_slice(&data);
                info!("    Successfully interpreted data as 32-byte namehash: {}", hash);
                hash
            } else {
                let reason = format!("Data in '{}' is not 32 bytes long (expected raw hash), length is {}.", access_list_full_path, data.len());
                error!("Delegation check failed: {}", reason);
                return DelegationStatus::AccessListNoteInvalidData(reason);
            }
        }
        Ok((_tba, _owner, None)) => {
            error!("Delegation check failed: Note '{}' exists but has no data.", access_list_full_path);
            return DelegationStatus::AccessListNoteInvalidData(format!("Note '{}' has no data.", access_list_full_path));
        }
        Err(e) => {
            let err_msg = format!("{:?}", e);
            let reason = format!("Error reading access list note '{}': {}", access_list_full_path, err_msg);
            error!("Delegation check failed: {}", reason);
            if err_msg.contains("note not found") { 
                 return DelegationStatus::AccessListNoteMissing;
            } else {
                 return DelegationStatus::CheckError(format!("Hypermap Read Error for '{}': {}", access_list_full_path, err_msg));
        }
    }
    };

    let signers_note_hash_str = format!("0x{}", hex::encode(signers_note_hash_b256));
    info!("  Delegation Step 2: Reading signers note using decoded hash: {}", signers_note_hash_str);

    let signers_note_data_bytes: Bytes = match hypermap_reader.get_hash(&signers_note_hash_str) { 
        Ok((_tba, _owner, Some(data))) => {
            info!("    Found permissions data ({} bytes) for signers note. Expecting ABI-encoded Address[].", data.len());
            data
        }
        Ok((_tba, _owner, None)) => {
            let reason = format!("Signers note found by hash '{}' exists but has no data.", signers_note_hash_str);
            error!("Delegation check failed: {}", reason);
            // This implies the access-list note points to an empty/invalid signers note
            return DelegationStatus::SignersNoteMissing; 
        }
        Err(e) => {
            let err_msg = format!("{:?}", e);
            let reason = format!("Error reading signers note by hash '{}': {}", signers_note_hash_str, err_msg);
            error!("Delegation check failed: {}", reason);
            if err_msg.contains("note not found") { // Should be rare if hash came from access-list note
                return DelegationStatus::SignersNoteLookupError(format!(
                    "Signers note not found for hash {} (inconsistent with access-list note?)", 
                    signers_note_hash_str
                ));
             } else {
                return DelegationStatus::CheckError(format!(
                    "Hypermap Read Error for signers note hash '{}': {}", 
                    signers_note_hash_str, err_msg
                ));
        }
    }
    };

    info!("  Delegation Step 3: Verifying signers note data. Expecting ABI-encoded Address[] containing hot wallet {}", hot_wallet_to_check_addr);
    match Vec::<Address>::abi_decode(&signers_note_data_bytes, true) { // true for lenient if padded
        Ok(decoded_delegates) => {
             info!("    Successfully ABI-decoded signers note delegates: {:?}", decoded_delegates);
            if decoded_delegates.contains(&hot_wallet_to_check_addr) {
                info!("    Verification SUCCESS: Hot wallet {} IS in ABI-decoded delegate list from signers note.", hot_wallet_to_check_addr);
                DelegationStatus::Verified
            } else {
                 info!("    Verification FAILED: Hot wallet {} is NOT in ABI-decoded delegate list: {:?}", hot_wallet_to_check_addr, decoded_delegates);
                 DelegationStatus::HotWalletNotInList
            }
        }
        Err(e) => {
            let reason = format!(
                "Failed to ABI decode signers note data as Address[]: {}. Data(hex): 0x{}", 
                e, hex::encode(&signers_note_data_bytes)
            );
            error!("Delegation check failed: {}", reason);
            DelegationStatus::SignersNoteInvalidData(reason)
        }
    }
} 
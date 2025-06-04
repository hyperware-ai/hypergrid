// High-level wallet management helpers.
//
// This module simply re-exports the logic that currently lives in
// `crate::wallet_manager`.  Splitting the file like this lets callers start
// using `crate::wallet::service::*` without needing to touch the old
// monolithic file.  Incremental refactors can now move the *actual*
// implementation over piece-by-piece.

pub use crate::wallet_manager::{
    AssetType,
    activate_wallet,
    deactivate_wallet,
    //set_wallet_password,
    //remove_wallet_password,
    get_active_signer,
    check_hot_wallet_status,
    get_decrypted_signer_for_wallet,
    verify_selected_hot_wallet_delegation_detailed,
    verify_single_hot_wallet_delegation_detailed,
    check_onchain_delegation_status,
};

use crate::structs::{State, SpendingLimits, WalletSummary, ManagedWallet};
use hyperware_process_lib::logging::{info, error};
use hyperware_process_lib::signer::{LocalSigner, Signer};
use hyperware_process_lib::wallet::{KeyStorage};
use anyhow::Result as AnyResult;

/// Generates a new random ManagedWallet (unencrypted, active) but does not add it to state.
/// Returns Ok(ManagedWallet) or Err(error_message as String).
pub fn generate_initial_wallet() -> Result<ManagedWallet, String> {
    info!("Attempting to generate a new wallet...");
    match LocalSigner::new_random(crate::wallet_manager::BASE_CHAIN_ID) {
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

/// Forward to wallet_manager::import_new_wallet.
#[inline]
pub fn import_new_wallet(
    state: &mut State,
    pk_hex: String,
    password: String,
    name: Option<String>,
) -> Result<String, String> {
    crate::wallet_manager::import_new_wallet(state, pk_hex, password, name)
}

/// Forward to wallet_manager::export_private_key.
#[inline]
pub fn export_private_key(
    state: &State,
    wallet_id: String,
    password: Option<String>,
) -> Result<String, String> {
    crate::wallet_manager::export_private_key(state, wallet_id, password)
}

/// Forward to wallet_manager::set_wallet_password.
#[inline]
pub fn set_wallet_password(
    state: &mut State,
    wallet_id: String,
    new_password: String,
    old_password: Option<String>,
) -> Result<(), String> {
    crate::wallet_manager::set_wallet_password(state, wallet_id, new_password, old_password)
}

/// Forward to wallet_manager::remove_wallet_password.
#[inline]
pub fn remove_wallet_password(
    state: &mut State,
    wallet_id: String,
    current_password: String,
) -> Result<(), String> {
    crate::wallet_manager::remove_wallet_password(state, wallet_id, current_password)
}

/// Forward to wallet_manager::get_active_account_details.
#[inline]
pub fn get_active_account_details(state: &State) -> AnyResult<Option<crate::structs::ActiveAccountDetails>> {
    crate::wallet_manager::get_active_account_details(state)
} 
use crate::structs::{ActiveAccountDetails, ManagedWallet, SpendingLimits, State, WalletSummary};
use hyperware_process_lib::hyperwallet_client;
use hyperware_process_lib::logging::{error, info};
use hyperware_process_lib::wallet::KeyStorage;
use serde_json;

/// Build a wallet summary from wallet data
pub fn build_wallet_summary(
    wallet_id: &str,
    wallet: &ManagedWallet,
    selected_id: &Option<String>,
    active_signer_id: &Option<String>,
) -> WalletSummary {
    WalletSummary {
        id: wallet_id.to_string(),
        name: wallet.name.clone(),
        address: wallet_id.to_string(),
        is_encrypted: check_if_wallet_encrypted(wallet),
        is_selected: check_if_wallet_selected(wallet_id, selected_id),
        is_unlocked: check_if_wallet_unlocked(wallet_id, active_signer_id),
    }
}

/// Check if a wallet's storage is encrypted
fn check_if_wallet_encrypted(wallet: &ManagedWallet) -> bool {
    wallet
        .get_storage()
        .map(|s| matches!(s, KeyStorage::Encrypted(_)))
        .unwrap_or(true)
}

/// Check if a wallet is currently selected
fn check_if_wallet_selected(wallet_id: &str, selected_id: &Option<String>) -> bool {
    selected_id
        .as_ref()
        .map(|id| id == wallet_id)
        .unwrap_or(false)
}

/// Check if a wallet is currently unlocked (has active signer)
fn check_if_wallet_unlocked(wallet_id: &str, active_signer_id: &Option<String>) -> bool {
    active_signer_id.as_ref() == Some(&wallet_id.to_string())
}

/// Build a list of wallet summaries from state
pub fn build_wallet_summary_list(state: &State) -> Vec<WalletSummary> {
    state
        .managed_wallets
        .iter()
        .map(|(wallet_id, wallet)| {
            build_wallet_summary(
                wallet_id,
                wallet,
                &state.selected_wallet_id,
                &state.active_signer_wallet_id,
            )
        })
        .collect()
}

/// Select a wallet as the active wallet
pub async fn select_wallet(
    process: &mut crate::OperatorProcess,
    wallet_id: String,
) -> Result<(), String> {
    info!("Selecting wallet: {}", wallet_id);

    // Check if wallet exists
    if !process
        .state
        .managed_wallets
        .iter()
        .any(|(id, _)| id == &wallet_id)
    {
        return Err(format!("Wallet {} not found", wallet_id));
    }

    // Just update local state - hyperwallet doesn't have a select_wallet method
    process.state.selected_wallet_id = Some(wallet_id.clone());

    // Update active signer if we have the session
    if let Some(session) = &process.hyperwallet_session {
        // Check if we need to update active signer
        if let Some((_, wallet)) = process
            .state
            .managed_wallets
            .iter()
            .find(|(id, _)| id == &wallet_id)
        {
            // If wallet is not encrypted, set it as active signer
            if !check_if_wallet_encrypted(wallet) {
                process.state.active_signer_wallet_id = Some(wallet_id.clone());
                // Don't set active_signer here - that requires unlocking the wallet
            }
        }
        info!("Wallet {} selected successfully", wallet_id);
        Ok(())
    } else {
        Err("Hyperwallet session not available".to_string())
    }
}

/// Generate a new wallet
pub async fn generate_wallet(process: &mut crate::OperatorProcess) -> Result<String, String> {
    info!("Generating new wallet");

    if let Some(session) = &process.hyperwallet_session {
        match hyperwallet_client::create_wallet(&session.session_id, None, None) {
            Ok(wallet_info) => {
                let wallet_id = wallet_info.address.clone();
                info!("Generated wallet: {}", wallet_id);

                // Add to state
                let wallet = ManagedWallet {
                    id: wallet_id.clone(),
                    name: wallet_info.name.clone(),
                    storage_json: "{}".to_string(), // Will be populated later when wallet is unlocked
                    spending_limits: SpendingLimits {
                        max_per_call: None,
                        max_total: None,
                        currency: Some("USDC".to_string()),
                        total_spent: None,
                    },
                };

                process
                    .state
                    .managed_wallets
                    .push((wallet_id.clone(), wallet));
                process.state.selected_wallet_id = Some(wallet_id.clone());

                // Notify WebSocket clients
                process.notify_wallet_update();

                Ok(wallet_id)
            }
            Err(e) => {
                error!("Failed to generate wallet: {:?}", e);
                Err(format!("Failed to generate wallet: {:?}", e))
            }
        }
    } else {
        Err("Hyperwallet session not available".to_string())
    }
}

/// Delete a wallet
pub async fn delete_wallet(
    process: &mut crate::OperatorProcess,
    wallet_id: String,
) -> Result<(), String> {
    info!("Deleting wallet: {}", wallet_id);

    // Can't delete the selected wallet
    if process.state.selected_wallet_id.as_ref() == Some(&wallet_id) {
        return Err("Cannot delete the currently selected wallet".to_string());
    }

    if let Some(session) = &process.hyperwallet_session {
        match hyperwallet_client::delete_wallet(&session.session_id, &wallet_id) {
            Ok(_) => {
                // Remove from state
                process
                    .state
                    .managed_wallets
                    .retain(|(id, _)| id != &wallet_id);
                info!("Wallet {} deleted successfully", wallet_id);
                Ok(())
            }
            Err(e) => {
                error!("Failed to delete wallet {}: {:?}", wallet_id, e);
                Err(format!("Failed to delete wallet: {:?}", e))
            }
        }
    } else {
        Err("Hyperwallet session not available".to_string())
    }
}

/// Rename a wallet
pub async fn rename_wallet(
    process: &mut crate::OperatorProcess,
    wallet_id: String,
    new_name: String,
) -> Result<(), String> {
    info!("Renaming wallet {} to '{}'", wallet_id, new_name);

    // Find wallet in state
    if let Some(wallet) = process
        .state
        .managed_wallets
        .iter_mut()
        .find(|(id, _)| id == &wallet_id)
        .map(|(_, wallet)| wallet)
    {
        // Update name in hyperwallet service
        if let Some(session) = &process.hyperwallet_session {
            match hyperwallet_client::rename_wallet(&session.session_id, &wallet_id, &new_name) {
                Ok(_) => {
                    wallet.name = Some(new_name);
                    info!("Wallet {} renamed successfully", wallet_id);
                    Ok(())
                }
                Err(e) => {
                    error!("Failed to rename wallet {}: {:?}", wallet_id, e);
                    Err(format!("Failed to rename wallet: {:?}", e))
                }
            }
        } else {
            Err("Hyperwallet session not available".to_string())
        }
    } else {
        Err(format!("Wallet {} not found", wallet_id))
    }
}

/// Get active account details for the currently selected wallet
pub fn get_active_account_details(state: &State) -> Option<ActiveAccountDetails> {
    // Check if there's a selected wallet
    let selected_id = state.selected_wallet_id.as_ref()?;

    // Find the wallet in managed wallets
    let (wallet_id, wallet) = state
        .managed_wallets
        .iter()
        .find(|(id, _)| id == selected_id)?;

    // Check if wallet is unlocked (has active signer)
    let is_unlocked = state.active_signer_wallet_id.as_ref() == Some(wallet_id);

    // Check if wallet is encrypted
    let is_encrypted = check_if_wallet_encrypted(wallet);

    Some(ActiveAccountDetails {
        id: wallet_id.clone(),
        name: wallet.name.clone(),
        address: wallet_id.clone(), // The wallet ID is the address
        is_encrypted,
        is_selected: true, // Always true since we're returning the selected wallet
        is_unlocked,
        eth_balance: None,  // TODO: Fetch from chain
        usdc_balance: None, // TODO: Fetch from chain
    })
}

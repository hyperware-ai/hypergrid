use crate::structs::{
    State, 
    SpendingLimits, 
    WalletSummary, 
    PaymentAttemptResult, 
    ManagedWallet, 
    ActiveAccountDetails, 
    DelegationStatus, 
    TbaFundingDetails, 
    ProviderRequest
};
use crate::helpers; 
use crate::http_handlers::send_request_to_provider;

use anyhow::Result;
use hyperware_process_lib::logging::{info, error};
use hyperware_process_lib::{eth, signer, wallet, hypermap};
use hyperware_process_lib::Address as HyperwareAddress;
use hyperware_process_lib::wallet::{get_eth_balance, get_token_details};
use signer::{LocalSigner, Signer};
use wallet::KeyStorage;
use alloy_primitives::{Address, U256, B256, Bytes};
use alloy_sol_types::SolValue;
use std::str::FromStr;
use hex;
use std::thread;
use crate::wallet::WalletError;


// --- Configuration Constants ---
pub const BASE_CHAIN_ID: u64 = 8453; 
pub const BASE_USDC_ADDRESS: &str = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
pub const USDC_DECIMALS: u8 = 6; 

// New Enum for Asset Type
#[derive(Debug, Clone, Copy)]
pub enum AssetType {
    Eth,
    Usdc,
}

/// Generates a new random ManagedWallet (unencrypted, active) but does not add it to state.
/// Returns Ok(ManagedWallet) or Err(error_message as String).
pub fn generate_initial_wallet() -> Result<ManagedWallet, String> {
    info!("Attempting to generate a new wallet...");
    match LocalSigner::new_random(BASE_CHAIN_ID) {
        Ok(new_signer) => {
            let address = new_signer.address().to_string();
            info!("Generated new signer with address: {}", address);

            let initial_limits = SpendingLimits::default(); // Start with default limits

            let managed_wallet = ManagedWallet {
                id: address.clone(), // Use address as ID
                name: None, // No default name
                storage: KeyStorage::Decrypted(new_signer.clone()),
                is_active: true, // Start active
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
                     _ => None, // Should be Decrypted initially
                };
                
                state.managed_wallets.insert(wallet_id.clone(), initial_wallet);
                state.selected_wallet_id = Some(wallet_id.clone());
                state.active_signer_cache = signer_option; // Activate if decrypted
                
                info!("Successfully added and selected initial wallet: {}", wallet_id);
                // state.save(); // DEBUG: Saving disabled in indexer, enable here
                state.save(); 
                info!("Initial wallet state generated and saved.");
                }
                Err(e) => {
                error!("Failed to generate initial wallet: {}", e);
                // Ensure state is clean if generation failed
                state.selected_wallet_id = None;
                state.active_signer_cache = None;
            }
        }
    } else {
        info!("Found {} existing wallets.", state.managed_wallets.len());
        // Wallets exist, try to activate the selected one if possible
        if let Some(selected_id) = &state.selected_wallet_id {
            info!("Selected wallet ID: {}", selected_id);
            if let Some(wallet) = state.managed_wallets.get(selected_id) {
                 // Only populate cache if it's active and decrypted
                if wallet.is_active {
                    if let KeyStorage::Decrypted(signer) = &wallet.storage {
                         info!("Activating selected wallet (stored decrypted).");
                        state.active_signer_cache = Some(signer.clone());
                    } else {
                         info!("Selected wallet is active but requires password for operations.");
                        state.active_signer_cache = None; // Requires activation
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
        // Ensure runtime cache is cleared if no suitable wallet is selected/active/decrypted
        if state.active_signer_cache.is_some() && state.selected_wallet_id.is_none() {
             state.active_signer_cache = None;
        }
    }
    info!("Wallet manager initialization complete.");
}

/// Checks if a proposed spending amount is within the configured limits.
/// **Note:** This needs refactoring to use the selected wallet's limits.
pub fn check_spending_limit(state: &State, amount_to_spend_str: &str) -> Result<(), String> {
    // Get selected wallet's limits
    let limits = match &state.selected_wallet_id {
        Some(id) => state.managed_wallets.get(id).map(|w| &w.spending_limits),
        None => None,
    };

    match limits {
        Some(limits) => {
            // Check per-call limit
            if let Some(max_call_str) = &limits.max_per_call {
                if !max_call_str.trim().is_empty() { // Only check if limit is set
                    let amount_f64 = amount_to_spend_str.parse::<f64>()
                        .map_err(|_| format!("Invalid amount format: {}", amount_to_spend_str))?;
                    let max_call_f64 = max_call_str.parse::<f64>()
                        .map_err(|_| format!("Invalid max_per_call limit format: {}", max_call_str))?;
                    
                    if amount_f64 > max_call_f64 {
                        return Err(format!(
                            "Limit Exceeded (Max: {} {})",
                             max_call_str, limits.currency.as_deref().unwrap_or("USDC") // Default currency display
                        ));
                    }
                }
            }
            // TODO: Add checks for max_total and time-based limits when implemented
            Ok(())
        }
        None => Ok(()), // No limits set (or no wallet selected), always allow
    }
}


/// Sets the spending limits for a specific wallet.
pub fn set_wallet_spending_limits(state: &mut State, wallet_id: String, limits: SpendingLimits) -> Result<(), String> {
    info!("Setting spending limits for wallet ID: {}", wallet_id);
    let wallet = state.managed_wallets.get_mut(&wallet_id)
        .ok_or_else(|| format!("Wallet ID {} not found.", wallet_id))?;

    // TODO: Add validation for limit values
    wallet.spending_limits = limits.clone(); // Clone limits into the wallet
    state.save();
    info!("Spending limits updated for wallet {}: {:?}", wallet_id, limits);
    Ok(())
}

/// Exports the private key for a specific wallet.
/// Requires the password if the wallet is encrypted and inactive/not selected.
pub fn export_private_key(state: &State, wallet_id: String, password: Option<String>) -> Result<String, String> {
    info!("Attempting to export private key for wallet ID: {}", wallet_id);
    let wallet = state.managed_wallets.get(&wallet_id)
         .ok_or_else(|| format!("Wallet ID {} not found.", wallet_id))?;

    // Decide if we can use the cache or need decryption
    let use_cache = wallet.is_active 
                    && Some(wallet_id.clone()) == state.selected_wallet_id 
                    && state.active_signer_cache.is_some();

    if use_cache {
        info!("Exporting key from active signer cache for selected wallet {}.", wallet_id);
        // We can safely unwrap because we checked active_signer_cache.is_some()
        return Ok(state.active_signer_cache.as_ref().unwrap().export_private_key());
    }

    // Need to get from storage
    match &wallet.storage {
        KeyStorage::Decrypted(signer) => {
            info!("Exporting key from unencrypted storage for wallet {}.", wallet_id);
            Ok(signer.export_private_key())
        }
        KeyStorage::Encrypted(encrypted_data) => {
            // Wallet is encrypted, requires password for export
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
/// Always deactivates the wallet and clears the cache if it was selected.
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
        .storage.clone(); // Clone to work with, we'll replace later

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

    // If we got here, encryption/re-encryption was successful
    // Now update the actual wallet in the map
    if let Some(wallet) = state.managed_wallets.get_mut(&wallet_id) {
        wallet.storage = new_storage;
        wallet.is_active = false; // Deactivate after password change/set
        info!("Successfully updated storage and deactivated wallet {}.", wallet_id);

        // If this was the selected wallet, clear the cache
        if state.selected_wallet_id.as_deref() == Some(&wallet_id) {
            info!("Clearing active signer cache for {}.", wallet_id);
            state.active_signer_cache = None;
        }
        state.cached_active_details = None; // Clear cache if state potentially changed regarding unlocked status
        state.save();
        Ok(())
    } else {
        // This shouldn't happen because we checked at the start
        Err(format!("Wallet {} disappeared during operation!", wallet_id))
    }
}

/// Removes the password from a specific encrypted wallet, reverting it to an unencrypted state.
/// Activates the wallet and populates cache if selected.
pub fn remove_wallet_password(state: &mut State, wallet_id: String, current_password: String) -> Result<(), String> {
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
        state.cached_active_details = None; // Clear cache if state potentially changed regarding unlocked status
        state.save();
        Ok(())
    } else {
        Err(format!("Wallet {} disappeared during operation!", wallet_id))
    }
}

/// Private helper to perform the actual TBA payment execution and confirmation.
/// Assumes all prior checks (config, price, limits, signer, delegation) have passed.
fn perform_tba_payment_execution(
    from_account_address: &Address,
    to_account_address: &Address,
    hot_wallet_signer: &LocalSigner, // Takes reference
    price_f64: f64,
    price_to_check_str: &str, // For reporting
    currency: &str, // For reporting
) -> PaymentAttemptResult { // Directly returns the result

    //(TODO: get this from wallet.rs instead)
    // 1. Calculate amount_u256 for USDC 
    let decimals = USDC_DECIMALS;
    let scale_factor = 10u128.pow(decimals as u32);
    let amount_scaled = (price_f64 * scale_factor as f64) as u128;
    let amount_u256 = U256::from(amount_scaled);

    // 2. Resolve USDC address 
    let usdc_address = match wallet::resolve_token_symbol("USDC", BASE_CHAIN_ID) {
        Ok(addr) => addr,
        Err(e) => {
            error!("Failed to resolve USDC address for chain {}: {:?}", BASE_CHAIN_ID, e);
            return PaymentAttemptResult::Failed { 
                error: format!("Internal Configuration Error (Cannot resolve USDC address: {:?})", e),
                amount_attempted: price_to_check_str.to_string(), 
                currency: currency.to_string()
            };
        }
    };

    // 3. Create inner calldata for USDC transfer
    let inner_calldata = wallet::create_erc20_transfer_calldata(*to_account_address, amount_u256);

    // 4. Setup Provider
    let eth_provider = eth::Provider::new(BASE_CHAIN_ID, 10); // 10 sec timeout

    // 5. Call wallet::execute_via_tba_with_signer
    info!("Sending execute transaction via From Account Address {} to To Account Address {} (Inner call: transfer {} USDC to {})",
          from_account_address, to_account_address, price_f64, to_account_address);

    let execution_result = wallet::execute_via_tba_with_signer(
        &from_account_address.to_string(),
        hot_wallet_signer, 
        &usdc_address.to_string(),
        inner_calldata,
        U256::ZERO,
        &eth_provider,
        Some(0)
    );

    //thread::sleep(std::time::Duration::from_secs(3));

    // 6. Handle SUBMISSION result
    match execution_result {
        Ok(receipt) => {
            let tx_hash_raw = receipt.hash;
            let tx_hash = format!("{:?}", tx_hash_raw);
            info!("TBA Execute Transaction SUBMITTED successfully! Tx Hash: {}", tx_hash);

            // Exponential backoff for polling receipt
            const MAX_RETRIES: u32 = 10;
            const INITIAL_DELAY_MS: u64 = 500; // Start with 500ms
            const MAX_DELAY_MS: u64 = 8000;   // Max delay 8s
            const CONFIRMATIONS_NEEDED: u64 = 1;

            let mut current_retries = 0;
            let mut current_delay_ms = INITIAL_DELAY_MS;

            info!("Waiting for transaction confirmation with exponential backoff for Tx Hash: {}", tx_hash);

            loop {
                if current_retries >= MAX_RETRIES {
                    error!("Timeout waiting for TBA payment transaction confirmation for {:?} after {} retries.", tx_hash_raw, MAX_RETRIES);
                    return PaymentAttemptResult::Failed {
                        error: format!("Timeout waiting for transaction confirmation after {} retries", MAX_RETRIES),
                        amount_attempted: price_to_check_str.to_string(),
                        currency: currency.to_string(),
                    };
                }

                match eth_provider.get_transaction_receipt(tx_hash_raw) {
                    Ok(Some(final_receipt)) => {
                        if let Some(receipt_block_number_u64) = final_receipt.block_number {
                            // Transaction is mined
                            match eth_provider.get_block_number() {
                                Ok(latest_block_number_u64) => {
                                    if latest_block_number_u64 >= receipt_block_number_u64 + CONFIRMATIONS_NEEDED.saturating_sub(1) {
                                        // Sufficient confirmations
                                        let confirmations = latest_block_number_u64.saturating_sub(receipt_block_number_u64) + 1;
                                        info!("Transaction {:?} confirmed with {} confirmations (Latest: {}, Receipt: {}).", tx_hash_raw, confirmations, latest_block_number_u64, receipt_block_number_u64);
                                        info!("Received final receipt: {:#?}", final_receipt); // Log the raw receipt object

                                        if final_receipt.status() {
                                            info!("TBA Payment transaction successful! Tx Hash: {:?}", tx_hash_raw);
                                            return PaymentAttemptResult::Success {
                                                tx_hash: tx_hash.clone(),
                                                amount_paid: price_to_check_str.to_string(),
                                                currency: currency.to_string(),
                                            };
                                        } else {
                                            error!("TBA Payment transaction confirmed but FAILED (reverted) on-chain. Tx Hash: {:?}", tx_hash_raw);
                                            return PaymentAttemptResult::Failed {
                                                error: "Transaction failed on-chain (reverted)".to_string(),
                                                amount_attempted: price_to_check_str.to_string(),
                                                currency: currency.to_string(),
                                            };
                                        }
                                    } else {
                                        // Mined, but not enough confirmations yet
                                        let current_depth = latest_block_number_u64.saturating_sub(receipt_block_number_u64) + 1;
                                        info!("Transaction {:?} mined in block {}, but not enough confirmations (need {}, current depth {}). Retrying in {}ms...",
                                              tx_hash_raw, receipt_block_number_u64, CONFIRMATIONS_NEEDED, current_depth, current_delay_ms);
                                    }
                                }
                                Err(e) => {
                                    error!("Failed to get current block number for confirmation check for {:?}: {:?}. Retrying in {}ms...", tx_hash_raw, e, current_delay_ms);
                                }
                            }
                        } else {
                            // Receipt found, but transaction is not yet mined (block_number is None)
                            info!("Transaction receipt for {:?} found, but not yet mined (no block number). Retrying in {}ms...", tx_hash_raw, current_delay_ms);
                        }
                    }
                    Ok(None) => {
                        // Receipt not found yet
                        info!("Transaction receipt not yet available for {:?}. Retrying in {}ms... (Attempt {}/{})", tx_hash_raw, current_delay_ms, current_retries + 1, MAX_RETRIES);
                    }
                    Err(e) => {
                        // Error fetching receipt
                        error!("Error fetching transaction receipt for {:?}: {:?}. Retrying in {}ms... (Attempt {}/{})", tx_hash_raw, e, current_delay_ms, current_retries + 1, MAX_RETRIES);
                    }
                }

                // Retry logic
                thread::sleep(std::time::Duration::from_millis(current_delay_ms));
                current_retries += 1;
                current_delay_ms = std::cmp::min(current_delay_ms * 2, MAX_DELAY_MS);
            }
        }
        Err(e) => {
            let error_msg = format!("{:?}", e);
            error!("TBA Payment failed during submission: {}", error_msg);
            PaymentAttemptResult::Failed {
                 error: error_msg,
                 amount_attempted: price_to_check_str.to_string(),
                 currency: currency.to_string(),
            }
        }
    }
}

/// Checks limits and attempts ERC20 payment if conditions are met using the Operator TBA.
/// Returns Some(PaymentAttemptResult) describing the outcome, or None if checks indicate no attempt should be made (e.g., zero price).
pub fn execute_payment_if_needed(
    state: &mut State,
    provider_wallet_str: &str, 
    provider_price_str: &str,
    provider_id: String,
) -> Option<PaymentAttemptResult> { 
    info!("Attempting payment check. Provider Wallet: {}, Price: {}", provider_wallet_str, provider_price_str);

    match check_payment_prerequisites(state, provider_wallet_str, provider_price_str, provider_id) {
        Ok(prereqs) => {
            // All checks passed, proceed with payment execution
            info!(
                "All checks passed. Attempting payment of {} {} via Operator TBA {} (signed by {}) to Provider TBA {}",
                prereqs.price_f64,
                prereqs.currency,
                prereqs.operator_tba_address,
                prereqs.hot_wallet_signer.address(),
                prereqs.provider_tba_address 
            );

            // Call the execution helper
            Some(perform_tba_payment_execution(
                &prereqs.operator_tba_address,
                &prereqs.provider_tba_address,
                prereqs.hot_wallet_signer, // Pass reference
                prereqs.price_f64,
                &prereqs.price_str,
                &prereqs.currency,
            ))
        }
        Err(skip_or_fail_reason) => {
            // Prerequisite check failed, return the reason
            Some(skip_or_fail_reason)
        }
    }
}

/// Gets a reference to the active signer from the cache.
/// NOTE: Assumes the cache is correctly managed by select_wallet, activate_wallet, etc.
pub fn get_active_signer(state: &State) -> Result<&LocalSigner, anyhow::Error> {
    state.active_signer_cache.as_ref()
        .ok_or_else(|| anyhow::anyhow!("No active signer available. Wallet may be inactive, locked, or none selected."))
}

/// Imports a private key, encrypts it, stores it as a new ManagedWallet,
/// and potentially selects it if no other wallet is selected.
/// Imported wallets start inactive.
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
                    let limits = SpendingLimits::default(); // Default limits for new import
                    
                    // Only set name if provided and not empty
                    let wallet_name = name.filter(|n| !n.trim().is_empty());
                    
                    let new_wallet = ManagedWallet {
                        id: address.clone(),
                        name: wallet_name, // Use the potentially filtered name
                        storage: KeyStorage::Encrypted(encrypted_storage_data),
                        is_active: false, // Start inactive
                        spending_limits: limits,
                    };

                    state.managed_wallets.insert(address.clone(), new_wallet);
                    info!("New wallet {} added to managed wallets.", address);

                    // Select if nothing else is selected
                    if state.selected_wallet_id.is_none() {
                         state.selected_wallet_id = Some(address.clone());
                         state.active_signer_cache = None; // Ensure cache is clear for newly selected
                         info!("Wallet {} automatically selected as it's the first one.", address);
                    }
                    
                    state.cached_active_details = None; // Clear cache if new wallet was potentially selected
                    state.save(); // Save the state with the new wallet
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

/// Activates a specific wallet, decrypting if necessary.
/// Returns Ok(()) or Err(error_message).
pub fn activate_wallet(state: &mut State, wallet_id: String, password: Option<String>) -> Result<(), String> {
    info!("Attempting to activate/unlock wallet ID: {}", wallet_id);

    // Find the mutable wallet
    let wallet = state.managed_wallets.get_mut(&wallet_id)
        .ok_or_else(|| format!("Wallet ID {} not found.", wallet_id))?;

    // --- Revised Logic --- 
    match (&wallet.storage, wallet.is_active) {
        // Case 1: Already Active & Unencrypted -> No-op, ensure cache if selected
        (KeyStorage::Decrypted(signer), true) => {
            info!("Wallet {} already active and unlocked.", wallet_id);
            if Some(wallet_id.clone()) == state.selected_wallet_id && state.active_signer_cache.is_none() {
                info!("Updating active signer cache for {}.", wallet_id);
                state.active_signer_cache = Some(signer.clone());
            }
            Ok(())
        }
        // Case 2: Already Active & Encrypted -> Try to unlock (decrypt and cache)
        (KeyStorage::Encrypted(encrypted_data), true) => {
            info!("Wallet {} is active but locked. Attempting unlock...", wallet_id);
            match password {
                Some(pwd) => {
                    match LocalSigner::decrypt(encrypted_data, &pwd) {
                        Ok(signer) => {
                            info!("Decryption successful for {}. Wallet remains active.", wallet_id);
                            // Clear the details cache because is_unlocked status changed
                            state.cached_active_details = None; 
                            // If this is the selected wallet, update the signer cache
                            if Some(wallet_id.clone()) == state.selected_wallet_id {
                                 info!("Updating active signer cache for selected wallet {}.", wallet_id);
                                state.active_signer_cache = Some(signer);
                            } else {
                                info!("Unlocked non-selected wallet {}, cache not updated.", wallet_id);
                            }
                            // Don't save state here, as only the runtime caches changed
                            Ok(())
                        }
                        Err(e) => {
                            error!("Failed to decrypt wallet {} for unlock: {:?}", wallet_id, e);
                            Err("Incorrect password or corrupt data".to_string())
                        }
                    }
                }
                None => {
                    error!("Password required to unlock active encrypted wallet {}.", wallet_id);
                    Err("Password required to unlock".to_string())
                }
            }
        }
        // Case 3: Inactive & Unencrypted -> Activate
        (KeyStorage::Decrypted(signer), false) => {
            info!("Activating unencrypted wallet {}.", wallet_id);
            wallet.is_active = true;
            // If this is the selected wallet, update the cache
            if Some(wallet_id.clone()) == state.selected_wallet_id {
                 info!("Updating active signer cache for selected wallet {}.", wallet_id);
                 state.active_signer_cache = Some(signer.clone());
            }
            state.save(); // Save the state change (is_active)
            Ok(())
        }
        // Case 4: Inactive & Encrypted -> Activate (decrypt and cache)
        (KeyStorage::Encrypted(encrypted_data), false) => {
            info!("Activating encrypted wallet {}. Requires password...", wallet_id);
            match password {
                Some(pwd) => {
                    match LocalSigner::decrypt(encrypted_data, &pwd) {
                        Ok(signer) => {
                            wallet.is_active = true;
                            info!("Decrypted and activated wallet {}.", wallet_id);
                            // If this is the selected wallet, update the cache
                            if Some(wallet_id.clone()) == state.selected_wallet_id {
                                 info!("Updating active signer cache for selected wallet {}.", wallet_id);
                                state.active_signer_cache = Some(signer);
                            }
                            state.save(); // Save the state change (is_active)
                            Ok(())
                        }
                        Err(e) => {
                            error!("Failed to decrypt wallet {} for activation: {:?}", wallet_id, e);
                            Err("Incorrect password or corrupt data".to_string())
                        }
                    }
                }
                None => {
                    error!("Password required to activate encrypted wallet {}.", wallet_id);
                    Err("Password required".to_string())
                }
            }
        }
    }
}

/// Deactivates a specific wallet.
pub fn deactivate_wallet(state: &mut State, wallet_id: String) -> Result<(), String> {
     info!("Attempting to deactivate wallet ID: {}", wallet_id);
    // Find the mutable wallet
    let wallet = state.managed_wallets.get_mut(&wallet_id)
        .ok_or_else(|| format!("Wallet ID {} not found.", wallet_id))?;

    if !wallet.is_active {
        info!("Wallet {} is already inactive.", wallet_id);
        return Ok(());
    }

    wallet.is_active = false;
    info!("Deactivated wallet {}.", wallet_id);

    // If this was the selected wallet, clear the active signer cache
    if Some(wallet_id) == state.selected_wallet_id {
         info!("Clearing active signer cache as selected wallet was deactivated.");
         state.active_signer_cache = None;
    }

    state.cached_active_details = None; // Clear cache
    state.save();
    Ok(())
}

/// Returns a list of summaries for all managed wallets and the ID of the selected one.
pub fn get_wallet_summary_list(state: &State) -> (Option<String>, Vec<WalletSummary>) {
    info!("Getting wallet summary list...");
    let summaries = state.managed_wallets.iter().map(|(id, wallet)| {
        let is_selected = state.selected_wallet_id.as_deref() == Some(id);
        let (is_encrypted, address) = match &wallet.storage {
            KeyStorage::Encrypted(data) => (true, data.address.clone()),
            KeyStorage::Decrypted(signer) => (false, signer.address().to_string()),
        };
        // Determine unlocked status based on cache and selection
        let is_unlocked = is_selected && state.active_signer_cache.is_some();

        WalletSummary {
            id: id.clone(),
            name: wallet.name.clone(),
            address,
            is_active: wallet.is_active,
            is_encrypted,
            is_selected,
            is_unlocked, // Set the new field
        }
    }).collect::<Vec<_>>();

    info!("Wallet summaries generated: {:#?}", summaries);
    info!("Selected wallet ID: {:?}", state.selected_wallet_id);
    
    (state.selected_wallet_id.clone(), summaries)
}

/// Selects a wallet by its ID, clears the active signer cache, and attempts
/// to populate the cache if the wallet is active and decrypted.
pub fn select_wallet(state: &mut State, wallet_id: String) -> Result<(), String> {
     info!("Attempting to select wallet ID: {}", wallet_id);
     if !state.managed_wallets.contains_key(&wallet_id) {
         return Err(format!("Wallet ID {} not found.", wallet_id));
     }

    state.selected_wallet_id = Some(wallet_id.clone());
    state.active_signer_cache = None; // Clear cache on selection change
    info!("Cleared active signer cache.");

    // Try to pre-populate cache if possible
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
    
    state.cached_active_details = None; // Clear cache on selection change
    state.save(); // Persist the selection
    info!("Selected wallet set to: {}", wallet_id);
    Ok(())
}

/// Deletes a wallet by its ID.
pub fn delete_wallet(state: &mut State, wallet_id: String) -> Result<(), String> {
    info!("Attempting to delete wallet ID: {}", wallet_id);
    if state.managed_wallets.remove(&wallet_id).is_none() {
         return Err(format!("Wallet ID {} not found for deletion.", wallet_id));
    }

    info!("Removed wallet {} from managed wallets.", wallet_id);

    // If the deleted wallet was selected, clear selection and cache
    if state.selected_wallet_id.as_deref() == Some(&wallet_id) {
         info!("Deleted wallet was selected. Clearing selection and cache.");
         state.selected_wallet_id = None;
         state.active_signer_cache = None;
         state.cached_active_details = None; // Clear cache if selected was deleted
    }

    state.save();
    Ok(())
}

/// Renames a wallet by its ID.
pub fn rename_wallet(state: &mut State, wallet_id: String, new_name: String) -> Result<(), String> {
     info!("Attempting to rename wallet ID: {} to '{}'", wallet_id, new_name);
     let wallet = state.managed_wallets.get_mut(&wallet_id)
         .ok_or_else(|| format!("Wallet ID {} not found for renaming.", wallet_id))?;

    wallet.name = Some(new_name.clone());
    state.save();
    info!("Wallet {} renamed successfully to '{}'.", wallet_id, new_name);
    Ok(())
}

// TODO: reduce calls to provider by caching balances in state
/// Returns the full details (including balances) for the currently selected AND unlocked account.
/// Returns Ok(None) if no account is selected or unlocked.
/// Returns Err if there is an internal error fetching details.
pub fn get_active_account_details(state: &State) -> Result<Option<ActiveAccountDetails>> {
    info!("Attempting to get active account details...");
    
    // Check if an account is selected and its signer is cached (unlocked)
    if let Some(selected_id) = &state.selected_wallet_id {
        if state.active_signer_cache.is_some() {
            // Get the managed wallet data
            if let Some(wallet) = state.managed_wallets.get(selected_id) {
                info!("Found selected and unlocked account: {}", selected_id);
                
                // Fetch balances
                let provider = eth::Provider::new(BASE_CHAIN_ID, 60); // Create provider
                let address_str = &wallet.storage.get_address(); // Use getter for address
                
                let eth_balance_res = get_eth_balance(address_str, BASE_CHAIN_ID, provider.clone());
                let usdc_details_res = get_token_details(BASE_USDC_ADDRESS, address_str, &provider);

                let eth_balance_str = match eth_balance_res {
                    Ok(bal) => Some(bal.to_display_string()),
                    Err(e) => {
                        error!("Failed to get ETH balance for {}: {:?}", address_str, e);
                        None // Don't fail the whole request, just omit the balance
                    }
                };
                let usdc_balance_str = match usdc_details_res {
                    Ok(details) => Some(format!("{} {}", details.formatted_balance, details.symbol)),
                    Err(e) => {
                        error!("Failed to get USDC details for {}: {:?}", address_str, e);
                        None // Don't fail the whole request, just omit the balance
                    }
                };

                // Construct the details object
                let details = ActiveAccountDetails {
                    id: wallet.id.clone(),
                    name: wallet.name.clone(),
                    address: address_str.clone(),
                    is_active: wallet.is_active, // Should be true if unlocked
                    is_encrypted: matches!(wallet.storage, KeyStorage::Encrypted(_)),
                    is_selected: true, // Implicitly true
                    is_unlocked: true, // Implicitly true because active_signer_cache is Some
                    eth_balance: eth_balance_str,
                    usdc_balance: usdc_balance_str,
                };
                Ok(Some(details))

            } else {
                // Should not happen if selected_id exists
                error!("Selected wallet ID {} not found in managed_wallets!", selected_id);
                Err(anyhow::anyhow!("Internal state inconsistency: selected wallet not found"))
            }
        } else {
            info!("No account unlocked (signer not cached).");
            Ok(None) // Selected but locked
        }
    } else {
        info!("No account selected.");
        Ok(None) // Nothing selected
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

/// Checks if a hot wallet is selected and active (unlocked).
/// Returns Ok(WalletSummary) of the active wallet if ready, otherwise Err(String message).
pub fn check_hot_wallet_status(state: &State) -> Result<WalletSummary, String> {
    info!("Checking hot wallet status...");
    match &state.selected_wallet_id {
        Some(selected_id) => {
            match state.managed_wallets.get(selected_id) {
                Some(wallet) => {
                    if wallet.is_active {
                        if state.active_signer_cache.is_some() {
                            // Signer is cached, implies it was decrypted/unlocked if encrypted
                            // Construct WalletSummary from ManagedWallet
                            let summary = WalletSummary {
                                id: wallet.id.clone(),
                                name: wallet.name.clone(),
                                address: wallet.storage.get_address(), // Assumes KeyStorage has get_address()
                                is_active: wallet.is_active,
                                is_encrypted: matches!(wallet.storage, KeyStorage::Encrypted(_)),
                                is_selected: true, // Since it's the selected_wallet_id
                                is_unlocked: true, // Because active_signer_cache is Some
                            };
                            info!("Hot wallet '{}' is selected, active, and unlocked.", selected_id);
                            Ok(summary)
                        } else {
                            // Active but signer not cached - means it's encrypted and locked
                            let msg = format!("Hot wallet '{}' is selected and active, but currently LOCKED (requires password to unlock).", selected_id);
                            info!("Hot Wallet Check: {}", msg);
                            Err(msg)
                        }
                    } else {
                        let msg = format!("Hot wallet '{}' is selected but INACTIVE.", selected_id);
                        info!("Hot Wallet Check: {}", msg);
                        Err(msg)
                    }
                }
                None => {
                    // Should not happen if selected_wallet_id is valid
                    let msg = format!("Internal Error: Selected wallet ID '{}' not found in managed wallets.", selected_id);
                    error!("Hot Wallet Check: {}", msg);
                    Err(msg)
                }
            }
        }
        None => {
            let msg = "No hot wallet is currently selected.".to_string();
            info!("Hot Wallet Check: {}", msg);
            Err(msg)
        }
    }
}

/// Verifies that the currently selected hot wallet is correctly delegated on-chain.
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

// --- Helper Struct and Enum --- 

// Define a struct to hold the data needed after successful checks
struct PaymentPrerequisites<'a> {
    operator_tba_address: Address,
    provider_tba_address: Address,
    price_f64: f64,
    price_str: String,
    currency: String,
    hot_wallet_signer: &'a LocalSigner, // Borrowed signer
}

/// Performs all prerequisite checks before attempting a payment.
/// Returns Ok(PaymentPrerequisites) if all checks pass,
/// or Err(PaymentAttemptResult) describing why payment should not proceed.
fn check_payment_prerequisites<'a>(
    state: &'a State, 
    provider_wallet_str: &str,
    provider_price_str: &str,
    provider_id: String,
) -> Result<PaymentPrerequisites<'a>, PaymentAttemptResult> { 
    // Check 1: Operator TBA Configuration
    let operator_tba_address = match state.operator_tba_address.as_ref() {
        Some(addr_str) => match Address::from_str(addr_str) {
            Ok(addr) => addr,
            Err(_) => {
                error!("Operator TBA address in state is invalid: {}", addr_str);
                return Err(PaymentAttemptResult::Skipped { reason: "Invalid Operator TBA Configuration".to_string() });
            }
        },
        None => {
            info!("Payment prerequisites failed: Operator TBA address not configured.");
            return Err(PaymentAttemptResult::Skipped { reason: "Operator TBA Not Configured".to_string() });
        }
    };
    if state.operator_entry_name.is_none() { info!("Warning: Operator entry name not configured in state."); }

    // --- Check 2: Provider TBA Address ---
    let mut final_provider_tba_str = provider_wallet_str.to_string();
    if final_provider_tba_str == "0x0" || final_provider_tba_str.len() != 42 {
        info!("Provider wallet is placeholder or invalid ({}). Using test address instead.", final_provider_tba_str);
        final_provider_tba_str = "0x3dE425580de16348983d6D7F25618eDA18B359DF".to_string(); // Using a known valid address for testing
    }
    let provider_tba_address = match Address::from_str(&final_provider_tba_str) {
        Ok(addr) => addr,
        Err(_) => {
            error!("Invalid Provider TBA Address format: {}", final_provider_tba_str);
            return Err(PaymentAttemptResult::Skipped { reason: "Invalid Provider TBA Address".to_string() });
        }
    };

    // Check 3: Price Validity
    let price_f64 = match provider_price_str.parse::<f64>() {
        Ok(p) if p > 0.0 => p,
        _ => { 
             info!("Payment prerequisites failed (Price: {}).", provider_price_str);
             return Err(PaymentAttemptResult::Skipped { reason: "Zero or Invalid Price".to_string() });
        }
    };
    let price_str = price_f64.to_string();

    // Check 4: Spending Limits
    let currency = match &state.selected_wallet_id {
        Some(id) => state.managed_wallets.get(id)
            .and_then(|w| w.spending_limits.currency.clone())
            .unwrap_or_else(|| "USDC".to_string()),
        None => "USDC".to_string(), 
    };
    if let Err(limit_error) = check_spending_limit(state, &price_str) {
        info!("Payment prerequisites failed (spending limit exceeded): {}", limit_error);
        return Err(PaymentAttemptResult::LimitExceeded {
             limit: limit_error,
             amount_attempted: price_str,
             currency,
        });
    }

    // Check 5: Active Signer (Hot Wallet)
    let hot_wallet_signer = match get_active_signer(state) {
        Ok(signer) => signer, 
        Err(e) => {
            info!("Payment prerequisites failed (wallet locked/unavailable): {}", e);
            return Err(PaymentAttemptResult::Skipped { reason: "Wallet Locked or Unavailable".to_string() });
        }
    };

    // Check 6: Hot Wallet Delegation 
    match verify_selected_hot_wallet_delegation_detailed(state, None) { 
        DelegationStatus::Verified => info!("Hot wallet delegation verified."),
        DelegationStatus::NeedsIdentity => return Err(PaymentAttemptResult::Skipped { reason: "Operator Identity Not Configured".to_string() }),
        DelegationStatus::NeedsHotWallet => return Err(PaymentAttemptResult::Skipped { reason: "Hot Wallet Not Delegated/Ready".to_string() }),
        DelegationStatus::AccessListNoteMissing => return Err(PaymentAttemptResult::Skipped { reason: "Access List Note Missing".to_string() }),
        DelegationStatus::AccessListNoteInvalidData(reason) => return Err(PaymentAttemptResult::Skipped { reason: format!("Access List Note Invalid Data: {}", reason) }),
        DelegationStatus::SignersNoteLookupError(reason) => return Err(PaymentAttemptResult::Skipped { reason: format!("Signers Note Lookup Error: {}", reason) }),
        DelegationStatus::SignersNoteMissing => return Err(PaymentAttemptResult::Skipped { reason: "Signers Note Missing".to_string() }),
        DelegationStatus::SignersNoteInvalidData(reason) => return Err(PaymentAttemptResult::Skipped { reason: format!("Signers Note Invalid Data: {}", reason) }),
        DelegationStatus::HotWalletNotInList => return Err(PaymentAttemptResult::Skipped { reason: "Hot Wallet Not in Delegate List".to_string() }),
        DelegationStatus::CheckError(reason) => return Err(PaymentAttemptResult::Skipped { reason: format!("Delegation Check Error: {}", reason) }),
    }

    // Check 7: availability check for the provider we're paying
    match check_provider_availability(&provider_id) {
        Ok(()) => info!("Provider availability check passed for {}.", provider_id),
        Err(e) => return Err(PaymentAttemptResult::Skipped { reason: format!("Provider Availability Check Error for {}: {}", provider_id, e) }),
    }

    // All Checks Passed
    Ok(PaymentPrerequisites {
        operator_tba_address,
        provider_tba_address,
        price_f64,
        price_str,
        currency,
        hot_wallet_signer,
    })
}

/// Checks the availability of a provider by sending a test request.
fn check_provider_availability(provider_id: &str) -> Result<(), String> {
    info!("Checking provider availability for ID: {}", provider_id);

    let target_address = HyperwareAddress::new(
        provider_id,
        ("hpn-provider", "hpn-provider", "template.os")
    );
    // The specific provider_name and arguments for a "ping" or availability check
    // might need to be standardized. For now, using placeholder/minimal values.
    let provider_name = format!("{}", provider_id); 
    let arguments = vec![]; 
    let payment_tx_hash = None; 

    info!("Preparing availability check request for provider process at {}", target_address);
    let provider_request_data = ProviderRequest {
        provider_name,
        arguments,
        payment_tx_hash,
    };

    let wrapped_request = serde_json::json!({
        "CallProvider": provider_request_data 
    });
    let request_body_bytes = match serde_json::to_vec(&wrapped_request) {
        Ok(bytes) => bytes,
        Err(e) => {
            let err_msg = format!("Failed to serialize provider availability request: {}", e);
            error!("{}", err_msg);
            return Err(err_msg);
        }
    };

    match send_request_to_provider(target_address.clone(), request_body_bytes) {
        Ok(Ok(response)) => {
            info!("Provider at {} responded successfully to availability check: with response {:?}", target_address, response);
            Ok(())
        }
        Ok(Err(e)) => {
            let err_msg = format!("Provider at {} failed availability check (app-level error): {}", target_address, e);
            error!("{}", err_msg);
            Err(err_msg)
        }
        Err(e) => {
            let err_msg = format!("Error sending availability check to provider at {}: {}", target_address, e);
            error!("{}", err_msg);
            Err(err_msg)
        }
    }
}

/// Checks the ETH and USDC funding status specifically for the Operator TBA.
/// Returns TbaFundingDetails struct.
pub fn check_operator_tba_funding_detailed(
    operator_tba_address_str: Option<&str>,
    // Consider passing eth_provider: &eth::Provider if it's managed centrally
) -> TbaFundingDetails {
    info!("Checking Operator TBA funding (detailed)... Operator TBA: {:?}", operator_tba_address_str);

    let mut details = TbaFundingDetails::default();
    let mut errors: Vec<String> = Vec::new();

    // Define provider here, or accept as argument for efficiency if called in a loop elsewhere
    let provider = eth::Provider::new(BASE_CHAIN_ID, 60); 

    if let Some(tba_str) = operator_tba_address_str {
        if Address::from_str(tba_str).is_err() {
            errors.push(format!("Invalid Operator TBA address format: {}", tba_str));
            details.tba_needs_eth = true;
            details.tba_needs_usdc = true;
        } else {
            // Operator TBA ETH Balance
            match wallet::get_eth_balance(tba_str, BASE_CHAIN_ID, provider.clone()) {
                Ok(balance) => {
                    details.tba_eth_balance_str = Some(balance.to_display_string());
                    if balance.as_wei() == U256::ZERO { 
                        details.tba_needs_eth = true; 
                        info!("  -> Operator TBA {} needs ETH.", tba_str);
                    } else {
                        info!("  -> Operator TBA {} ETH balance: {}", tba_str, balance.to_display_string());
                    }
                }
                Err(e) => {
                    let err_msg = format!("Error checking Operator TBA ETH for {}: {:?}", tba_str, e);
                    error!("    {}", err_msg);
                    errors.push(err_msg);
                    details.tba_needs_eth = true;
                    details.tba_eth_balance_str = Some("Error".to_string());
                }
            }
            // Operator TBA USDC Balance
            match wallet::erc20_balance_of(BASE_USDC_ADDRESS, tba_str, &provider) {
                Ok(balance_f64) => {
                    details.tba_usdc_balance_str = Some(format!("{:.6} USDC", balance_f64));
                    if balance_f64 <= 0.0 { 
                        details.tba_needs_usdc = true; 
                        info!("  -> Operator TBA {} needs USDC.", tba_str);
                    } else {
                        info!("  -> Operator TBA {} USDC balance: {:.6}", tba_str, balance_f64);
                    }
                }
                Err(e) => {
                    let err_msg = format!("Error checking Operator TBA USDC for {}: {:?}", tba_str, e);
                    error!("    {}", err_msg);
                    errors.push(err_msg);
                    details.tba_needs_usdc = true;
                    details.tba_usdc_balance_str = Some("Error".to_string());
                }
            }
        }
    } else {
        let err_msg = "Operator TBA address not provided for funding check.".to_string();
        info!("  -> {}", err_msg);
        errors.push(err_msg);
        details.tba_needs_eth = true; // Assume needed if not configured/provided
        details.tba_needs_usdc = true;
    }

    if !errors.is_empty() {
        details.check_error = Some(errors.join("; "));
    }

    info!("Operator TBA Funding Details: NeedsETH={}, NeedsUSDC={}, ETHBal='{:?}', USDCBal='{:?}', Error='{:?}'", 
        details.tba_needs_eth, details.tba_needs_usdc, 
        details.tba_eth_balance_str, details.tba_usdc_balance_str,
        details.check_error
    );
    details
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

pub fn get_all_onchain_linked_hot_wallet_addresses(operator_entry_name_opt: Option<&str>,) -> Result<Vec<String>, String> {
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
    match helpers::get_signers_note_hash_from_access_list(&hypermap_reader, &access_list_full_path) {
        Ok(signers_note_hash) => {
            info!(
                "  Successfully got signers note hash: {} from access list {}",
                signers_note_hash, access_list_full_path
            );

            // Step 2: Get the list of addresses from the signers note
            match helpers::get_addresses_from_signers_note(&hypermap_reader, signers_note_hash) {
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

// Renamed from verify_single_hot_wallet_delegation_detailed
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

// Renamed from check_single_hot_wallet_funding_detailed_stub
pub fn check_single_hot_wallet_funding_detailed(
    _state: &State, // Not directly used, but kept for consistency with other similar functions
    hot_wallet_address_str: &str,
    // Consider passing eth_provider: &eth::Provider if managed centrally
) -> (bool, Option<String>, Option<String>) { // (needs_eth, eth_balance_str, check_error)
    info!("Checking single hot wallet ETH funding for address: {}", hot_wallet_address_str);

    if hot_wallet_address_str.is_empty() || Address::from_str(hot_wallet_address_str).is_err() {
        let err_msg = format!("Invalid or empty hot wallet address provided for funding check: '{}'", hot_wallet_address_str);
        error!("  -> {}", err_msg);
        return (true, Some("Invalid Address".to_string()), Some(err_msg));
        }

    // Create a new provider instance for this check.
    // TODO: Consider passing this in if calls become frequent, to reuse the instance.
    let provider = eth::Provider::new(BASE_CHAIN_ID, 60); 

    match wallet::get_eth_balance(hot_wallet_address_str, BASE_CHAIN_ID, provider) {
        Ok(balance) => {
            let balance_str = balance.to_display_string();
            if balance.as_wei() == U256::ZERO {
                info!("  -> Hot wallet {} needs ETH. Balance: {}", hot_wallet_address_str, balance_str);
                (true, Some(balance_str), None) // Needs ETH, balance string, no error
            } else {
                info!("  -> Hot wallet {} ETH balance: {}. Funding OK.", hot_wallet_address_str, balance_str);
                (false, Some(balance_str), None) // Does not need ETH, balance string, no error
            }
        }
        Err(e) => {
            let err_msg = format!("Error checking Hot Wallet ETH for {}: {:?}", hot_wallet_address_str, e);
            error!("  -> {}", err_msg);
            (true, Some("Error".to_string()), Some(err_msg)) // Needs ETH (due to error), error balance string, error message
        }
    }
} 

// Main handler for Operator TBA withdrawals
pub fn handle_operator_tba_withdrawal(
    state: &mut State, 
    asset: AssetType,
    to_address_str: String, 
    amount_str: String
) -> Result<(), String> {
    info!("Handling {:?} withdrawal from Operator TBA to {} for amount {}", asset, to_address_str, amount_str);

    let operator_tba_address_str = state.operator_tba_address.as_ref().ok_or_else(|| {
        error!("Operator TBA address not configured in state.");
        "Operator TBA address not configured".to_string()
    })?;
    let operator_tba = Address::from_str(operator_tba_address_str).map_err(|e| {
        error!("Invalid Operator TBA address format: {}", e);
        format!("Invalid Operator TBA address format: {}", e)
    })?;

    let hot_wallet_signer = get_active_signer(state).map_err(|e| {
        error!("Failed to get active hot wallet signer: {}", e);
        format!("Active hot wallet signer not available: {}", e)
    })?;

    let target_recipient_address = Address::from_str(&to_address_str).map_err(|e| {
        error!("Invalid recipient address format: {}", e);
        format!("Invalid recipient address format: {}", e)
    })?;

    // Create a new provider instance for this operation
    let eth_provider = eth::Provider::new(BASE_CHAIN_ID, 180); // 180s timeout for tx

    match asset {
        AssetType::Eth => {
            let amount_wei = U256::from_str(&amount_str).map_err(|e| {
                error!("Invalid ETH amount format (must be Wei string): {}", e);
                format!("Invalid ETH amount format (must be Wei string): {}", e)
            })?;
            if amount_wei == U256::ZERO {
                return Err("ETH withdrawal amount cannot be zero.".to_string());
            }
            info!("Initiating ETH transfer of {} wei from Operator TBA {} to {}", amount_wei, operator_tba, target_recipient_address);
            execute_eth_transfer_from_tba(operator_tba, target_recipient_address, amount_wei, hot_wallet_signer, &eth_provider)
                .map_err(|e| format!("ETH transfer execution failed: {:?}", e))
                .map(|receipt| {
                    info!("ETH withdrawal transaction submitted: {:?}", receipt.hash);
                    // Optionally, could wait for confirmation here or let frontend handle it
                })
        }
        AssetType::Usdc => {
            let amount_usdc_units = U256::from_str(&amount_str).map_err(|e| {
                error!("Invalid USDC amount format (must be smallest units string): {}", e);
                format!("Invalid USDC amount format (must be smallest units string): {}", e)
            })?;
            if amount_usdc_units == U256::ZERO {
                return Err("USDC withdrawal amount cannot be zero.".to_string());
            }
            info!("Initiating USDC transfer of {} units from Operator TBA {} to {}", amount_usdc_units, operator_tba, target_recipient_address);
            execute_usdc_transfer_from_tba(operator_tba, target_recipient_address, amount_usdc_units, hot_wallet_signer, &eth_provider)
                .map_err(|e| format!("USDC transfer execution failed: {:?}", e))
                .map(|receipt| {
                    info!("USDC withdrawal transaction submitted: {:?}", receipt.hash);
                })
        }
    }
}

// Executes ETH transfer from the Operator TBA
fn execute_eth_transfer_from_tba(
    operator_tba: Address,
    target_recipient: Address,
    amount_wei: U256,
    hot_wallet_signer: &LocalSigner, 
    provider: &eth::Provider
) -> Result<wallet::TxReceipt, wallet::WalletError> {
    info!("execute_eth_transfer_from_tba: OperatorTBA={}, Recipient={}, AmountWei={}", operator_tba, target_recipient, amount_wei);
    wallet::execute_via_tba_with_signer(
        &operator_tba.to_string(), 
        hot_wallet_signer, 
        &target_recipient.to_string(), 
        Vec::new(), // Empty calldata for native ETH transfer
        amount_wei, 
        provider, 
        Some(0) // Operation: CALL
    )
}

// Executes USDC transfer from the Operator TBA
fn execute_usdc_transfer_from_tba(
    operator_tba: Address,
    target_recipient: Address,
    amount_usdc_units: U256,
    hot_wallet_signer: &LocalSigner, 
    provider: &eth::Provider
) -> Result<wallet::TxReceipt, wallet::WalletError> {
    info!(
        "execute_usdc_transfer_from_tba: OperatorTBA={}, Recipient={}, AmountUnits={}", 
        operator_tba, target_recipient, amount_usdc_units
    );
    let usdc_contract_address = Address::from_str(BASE_USDC_ADDRESS).map_err(|_|
        wallet::WalletError::NameResolutionError("Invalid BASE_USDC_ADDRESS constant".to_string())
    )?;

    let inner_calldata = wallet::create_erc20_transfer_calldata(target_recipient, amount_usdc_units);

    wallet::execute_via_tba_with_signer(
        &operator_tba.to_string(), 
        hot_wallet_signer, 
        &usdc_contract_address.to_string(), 
        inner_calldata,
        U256::ZERO, // Value for the outer call to TBA is 0, actual transfer is USDC
        provider, 
        Some(0) // Operation: CALL
    )
} 
//! Payment-centric operations for hot wallets.
//!
//! This module contains all payment-related functionality including:
//! - Payment execution for providers
//! - TBA (Token Bound Account) operations
//! - ETH and USDC transfers
//! - Funding status checks
//! - Spending limit validation

use crate::structs::{State, PaymentAttemptResult, TbaFundingDetails, ProviderRequest, DelegationStatus};
use crate::http_handlers::send_request_to_provider;
use crate::wallet::service::{get_decrypted_signer_for_wallet};

use anyhow::Result;
use hyperware_process_lib::{
    logging::{info, error},
    eth, wallet,
    signer::{LocalSigner, Signer},
    Address as HyperwareAddress,
};
use alloy_primitives::{Address, U256, B256, Bytes};
use std::str::FromStr;
use std::thread;
// New Enum for Asset Type
#[derive(Debug, Clone, Copy)]
pub enum AssetType {
    Eth,
    Usdc,
}


// --- Configuration Constants ---
pub const BASE_CHAIN_ID: u64 = 8453; 
pub const BASE_USDC_ADDRESS: &str = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
pub const USDC_DECIMALS: u8 = 6;

// --- Helper Struct ---
struct PaymentPrerequisites {
    operator_tba_address: Address,
    provider_tba_address: Address,
    price_f64: f64,
    price_str: String,
    currency: String,
}

/// Checks if a proposed spending amount is within the configured limits.
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
                if !max_call_str.trim().is_empty() {
                    let amount_f64 = amount_to_spend_str.parse::<f64>()
                        .map_err(|_| format!("Invalid amount format: {}", amount_to_spend_str))?;
                    let max_call_f64 = max_call_str.parse::<f64>()
                        .map_err(|_| format!("Invalid max_per_call limit format: {}", max_call_str))?;
                    
                    if amount_f64 > max_call_f64 {
                        return Err(format!(
                            "Limit Exceeded (Max: {} {})",
                            max_call_str, limits.currency.as_deref().unwrap_or("USDC")
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

/// Checks limits and attempts ERC20 payment if conditions are met using the Operator TBA.
/// Returns Some(PaymentAttemptResult) describing the outcome, or None if checks indicate no attempt should be made.
pub fn execute_payment_if_needed(
    state: &mut State,
    provider_wallet_str: &str,
    provider_price_str: &str,
    provider_id: String,
    associated_hot_wallet_id: &str,
) -> Option<PaymentAttemptResult> {
    info!("Is this mf used?");
    info!("Attempting payment for provider {} using hot wallet {}. Provider Wallet: {}, Price: {}", 
        provider_id, associated_hot_wallet_id, provider_wallet_str, provider_price_str);

    match check_payment_prerequisites(state, provider_wallet_str, provider_price_str, provider_id, associated_hot_wallet_id) {
        Ok(prereqs) => {
            // Re-fetch the signer here now that checks have passed
            let hot_wallet_signer_instance = match get_decrypted_signer_for_wallet(state, associated_hot_wallet_id) {
                Ok(s) => s,
                Err(e) => return Some(PaymentAttemptResult::Skipped { 
                    reason: format!("Failed to retrieve signer for wallet {} post-checks: {}", associated_hot_wallet_id, e) 
                }),
            };

            info!(
                "All checks passed. Attempting payment of {} {} via Operator TBA {} (signed by {}) to Provider TBA {}",
                prereqs.price_f64,
                prereqs.currency,
                prereqs.operator_tba_address,
                hot_wallet_signer_instance.address(),
                prereqs.provider_tba_address 
            );

            Some(perform_tba_payment_execution(
                &prereqs.operator_tba_address,
                &prereqs.provider_tba_address,
                &hot_wallet_signer_instance,
                prereqs.price_f64,
                &prereqs.price_str,
                &prereqs.currency,
            ))
        }
        Err(skip_or_fail_reason) => {
            Some(skip_or_fail_reason)
        }
    }
}

/// Performs all prerequisite checks before attempting a payment.
fn check_payment_prerequisites(
    state: &State, 
    provider_wallet_str: &str,
    provider_price_str: &str,
    provider_id: String,
    associated_hot_wallet_id: &str,
) -> Result<PaymentPrerequisites, PaymentAttemptResult> {
    info!("Payment Prereqs: Using Hot Wallet ID: {} for payment", associated_hot_wallet_id);

    // Check 1: Operator TBA Configuration
    let operator_tba_address = state.operator_tba_address.as_ref().ok_or_else(|| {
        error!("Operator TBA address not configured in state.");
        PaymentAttemptResult::Skipped { reason: "Operator TBA Not Configured".to_string() }
    }).and_then(|addr_str| Address::from_str(addr_str).map_err(|_|
        PaymentAttemptResult::Skipped { reason: "Invalid Operator TBA Configuration".to_string() }
    ))?;
    if state.operator_entry_name.is_none() { info!("Warning: Operator entry name not configured in state."); }

    // Check 2: Provider TBA Address
    let mut final_provider_tba_str = provider_wallet_str.to_string();
    if final_provider_tba_str == "0x0" || final_provider_tba_str.len() != 42 {
        final_provider_tba_str = "0x3dE425580de16348983d6D7F25618eDA18B359DF".to_string();
    }
    let provider_tba_address = Address::from_str(&final_provider_tba_str).map_err(|_|
        PaymentAttemptResult::Skipped { reason: "Invalid Provider TBA Address".to_string() }
    )?;

    // Check 3: Price Validity
    let price_f64 = provider_price_str.parse::<f64>().map_err(|_|
        PaymentAttemptResult::Skipped { reason: "Invalid Price Format".to_string() }
    ).and_then(|p| if p > 0.0 { Ok(p) } else { 
        Err(PaymentAttemptResult::Skipped { reason: "Zero or Invalid Price".to_string() })
    })?;
    let price_str = price_f64.to_string();

    // Check 4: Get the specific Hot Wallet info
    let hot_wallet_managed_info = state.managed_wallets.get(associated_hot_wallet_id).ok_or_else(|| {
        error!("Payment Prereqs: Associated hot wallet {} not found in managed list.", associated_hot_wallet_id);
        PaymentAttemptResult::Skipped { reason: format!("Associated hot wallet {} not found", associated_hot_wallet_id) }
    })?;

    // Verify the wallet can be used (not necessarily getting the signer yet)
    if !matches!(&hot_wallet_managed_info.storage, hyperware_process_lib::wallet::KeyStorage::Decrypted(_)) {
        return Err(PaymentAttemptResult::Skipped { 
            reason: format!("Wallet {} is encrypted and requires unlocking.", associated_hot_wallet_id) 
        });
    }

    // Check 5: Spending Limits for the *associated* hot wallet
    let currency = hot_wallet_managed_info.spending_limits.currency.clone().unwrap_or_else(|| "USDC".to_string());
    if let Some(max_call_str) = &hot_wallet_managed_info.spending_limits.max_per_call {
        if !max_call_str.trim().is_empty() {
            let max_call_f64 = max_call_str.parse::<f64>().map_err(|_|
                PaymentAttemptResult::Failed { 
                    error: format!("Invalid max_per_call limit format on wallet {}: {}", associated_hot_wallet_id, max_call_str),
                    amount_attempted: price_str.clone(), 
                    currency: currency.clone() 
                }
            )?;
            if price_f64 > max_call_f64 {
                return Err(PaymentAttemptResult::LimitExceeded {
                    limit: format!("Max/Call {} {}", max_call_str, currency),
                    amount_attempted: price_str.clone(),
                    currency: currency.clone(),
                });
            }
        }
    }

    // Check 6: Hot Wallet Delegation
    match crate::wallet::service::verify_single_hot_wallet_delegation_detailed(state, state.operator_entry_name.as_deref(), associated_hot_wallet_id) { 
        DelegationStatus::Verified => info!("Hot wallet {} delegation verified.", associated_hot_wallet_id),
        status => return Err(PaymentAttemptResult::Skipped { 
            reason: format!("Delegation check failed for wallet {}: {:?}", associated_hot_wallet_id, status) 
        }),
    }

    // Check 7: Provider Availability
    check_provider_availability(&provider_id).map_err(|e|
        PaymentAttemptResult::Skipped { reason: format!("Provider Availability Check Error for {}: {}", provider_id, e) }
    )?;

    // All Checks Passed
    Ok(PaymentPrerequisites {
        operator_tba_address,
        provider_tba_address,
        price_f64,
        price_str,
        currency,
    })
}

/// Private helper to perform the actual TBA payment execution and confirmation.
fn perform_tba_payment_execution(
    from_account_address: &Address,
    to_account_address: &Address,
    hot_wallet_signer: &LocalSigner,
    price_f64: f64,
    price_to_check_str: &str,
    currency: &str,
) -> PaymentAttemptResult {
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
    let eth_provider = eth::Provider::new(BASE_CHAIN_ID, 10);

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

    // 6. Handle SUBMISSION result
    match execution_result {
        Ok(receipt) => {
            let tx_hash_raw = receipt.hash;
            let tx_hash = format!("{:?}", tx_hash_raw);
            info!("TBA Execute Transaction SUBMITTED successfully! Tx Hash: {}", tx_hash);

            // Exponential backoff for polling receipt
            const MAX_RETRIES: u32 = 10;
            const INITIAL_DELAY_MS: u64 = 500;
            const MAX_DELAY_MS: u64 = 8000;
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
                                        info!("Transaction {:?} confirmed with {} confirmations.", tx_hash_raw, confirmations);
                                        info!("Received final receipt: {:#?}", final_receipt);

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
                                        let current_depth = latest_block_number_u64.saturating_sub(receipt_block_number_u64) + 1;
                                        info!("Transaction {:?} mined but not enough confirmations (need {}, current depth {}).", 
                                              tx_hash_raw, CONFIRMATIONS_NEEDED, current_depth);
                                    }
                                }
                                Err(e) => {
                                    error!("Failed to get current block number: {:?}.", e);
                                }
                            }
                        } else {
                            info!("Transaction receipt found but not yet mined.");
                        }
                    }
                    Ok(None) => {
                        info!("Transaction receipt not yet available. Retrying... (Attempt {}/{})", current_retries + 1, MAX_RETRIES);
                    }
                    Err(e) => {
                        error!("Error fetching transaction receipt: {:?}. Retrying...", e);
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

/// Checks the availability of a provider by sending a test request.
fn check_provider_availability(provider_id: &str) -> Result<(), String> {
    info!("Checking provider availability for ID: {}", provider_id);

    let target_address = HyperwareAddress::new(
        provider_id,
        ("hypergrid-provider", "hypergrid-provider", "grid-beta.hypr")
    );
    //let provider_name = format!("{}", provider_id); 
    //let arguments = vec![]; 
    //let payment_tx_hash = None; 

    info!("Preparing availability check request for provider process at {}", target_address);
    //let provider_request_data = ProviderRequest {
    //    provider_name,
    //    arguments,
    //    payment_tx_hash,
    //};

    //let wrapped_request = serde_json::json!({
    //    "CallProvider": provider_request_data 
    //});

    let DummyArgument = serde_json::json!({
        "argument": "swag"
    });

    let wrapped_request = serde_json::json!({
        "HealthPing": DummyArgument
    });

    let request_body_bytes = match serde_json::to_vec(&wrapped_request) {
        Ok(bytes) => bytes,
        Err(e) => {
            let err_msg = format!("Failed to serialize provider availability request: {}", e);
            error!("{}", err_msg);
            return Err(err_msg);
        }
    };

    info!("Sending request body bytes to provider: {:?}", request_body_bytes);

    match send_request_to_provider(target_address.clone(), request_body_bytes) {
        Ok(Ok(response)) => {
            info!("Provider at {} responded successfully to availability check: {:?}", target_address, response);
            Ok(())
        }
        Ok(Err(e)) => {
            let err_msg = format!("Provider at {} failed availability check: {}", target_address, e);
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

/// Main handler for Operator TBA withdrawals.
pub fn handle_operator_tba_withdrawal(
    state: &mut State,
    asset: AssetType,
    to_address: String,
    amount: String,
) -> Result<(), String> {
    info!("Handling {:?} withdrawal from Operator TBA to {} for amount {}", asset, to_address, amount);

    let operator_tba_address_str = state.operator_tba_address.as_ref().ok_or_else(|| {
        error!("Operator TBA address not configured in state.");
        "Operator TBA address not configured".to_string()
    })?;
    let operator_tba = Address::from_str(operator_tba_address_str).map_err(|e| {
        error!("Invalid Operator TBA address format: {}", e);
        format!("Invalid Operator TBA address format: {}", e)
    })?;

    let hot_wallet_signer = crate::wallet::service::get_active_signer(state).map_err(|e| {
        error!("Failed to get active hot wallet signer: {}", e);
        format!("Active hot wallet signer not available: {}", e)
    })?;

    let target_recipient_address = Address::from_str(&to_address).map_err(|e| {
        error!("Invalid recipient address format: {}", e);
        format!("Invalid recipient address format: {}", e)
    })?;

    let eth_provider = eth::Provider::new(BASE_CHAIN_ID, 180);

    match asset {
        AssetType::Eth => {
            let amount_wei = U256::from_str(&amount).map_err(|e| {
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
                })
        }
        AssetType::Usdc => {
            let amount_usdc_units = U256::from_str(&amount).map_err(|e| {
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

/// Executes ETH transfer from the Operator TBA.
fn execute_eth_transfer_from_tba(
    operator_tba: Address,
    target_recipient: Address,
    amount_wei: U256,
    hot_wallet_signer: &LocalSigner, 
    provider: &eth::Provider
) -> Result<wallet::TxReceipt, wallet::WalletError> {
    info!("execute_eth_transfer_from_tba: OperatorTBA={}, Recipient={}, AmountWei={}", 
         operator_tba, target_recipient, amount_wei);
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

/// Executes USDC transfer from the Operator TBA.
fn execute_usdc_transfer_from_tba(
    operator_tba: Address,
    target_recipient: Address,
    amount_usdc_units: U256,
    hot_wallet_signer: &LocalSigner, 
    provider: &eth::Provider
) -> Result<wallet::TxReceipt, wallet::WalletError> {
    info!("execute_usdc_transfer_from_tba: OperatorTBA={}, Recipient={}, AmountUnits={}", 
         operator_tba, target_recipient, amount_usdc_units);
    let usdc_contract_address = Address::from_str(BASE_USDC_ADDRESS).map_err(|_|
        wallet::WalletError::NameResolutionError("Invalid BASE_USDC_ADDRESS constant".to_string())
    )?;

    let inner_calldata = wallet::create_erc20_transfer_calldata(target_recipient, amount_usdc_units);

    wallet::execute_via_tba_with_signer(
        &operator_tba.to_string(), 
        hot_wallet_signer, 
        &usdc_contract_address.to_string(), 
        inner_calldata,
        U256::ZERO, // Value for the outer call to TBA is 0
        provider, 
        Some(0) // Operation: CALL
    )
}

/// Checks the ETH and USDC funding status specifically for the Operator TBA.
pub fn check_operator_tba_funding_detailed(
    operator_tba_address: Option<&str>,
) -> TbaFundingDetails {
    info!("Checking Operator TBA funding (detailed)... Operator TBA: {:?}", operator_tba_address);

    let mut details = TbaFundingDetails::default();
    let mut errors: Vec<String> = Vec::new();

    let provider = eth::Provider::new(BASE_CHAIN_ID, 60); 

    if let Some(tba_str) = operator_tba_address {
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
        details.tba_needs_eth = true;
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

/// Checks single hot wallet funding status.
pub fn check_single_hot_wallet_funding_detailed(
    _state: &State,
    hot_wallet_addr: &str,
) -> (bool, Option<String>, Option<String>) {
    info!("Checking single hot wallet ETH funding for address: {}", hot_wallet_addr);

    if hot_wallet_addr.is_empty() || Address::from_str(hot_wallet_addr).is_err() {
        let err_msg = format!("Invalid or empty hot wallet address provided for funding check: '{}'", hot_wallet_addr);
        error!("  -> {}", err_msg);
        return (true, Some("Invalid Address".to_string()), Some(err_msg));
    }

    let provider = eth::Provider::new(BASE_CHAIN_ID, 60); 

    match wallet::get_eth_balance(hot_wallet_addr, BASE_CHAIN_ID, provider) {
        Ok(balance) => {
            let balance_str = balance.to_display_string();
            if balance.as_wei() == U256::ZERO {
                info!("  -> Hot wallet {} needs ETH. Balance: {}", hot_wallet_addr, balance_str);
                (true, Some(balance_str), None)
            } else {
                info!("  -> Hot wallet {} ETH balance: {}. Funding OK.", hot_wallet_addr, balance_str);
                (false, Some(balance_str), None)
            }
        }
        Err(e) => {
            let err_msg = format!("Error checking Hot Wallet ETH for {}: {:?}", hot_wallet_addr, e);
            error!("  -> {}", err_msg);
            (true, Some("Error".to_string()), Some(err_msg))
        }
    }
} 
//! Hyperwallet client payments module - replaces direct payment operations with hyperwallet calls
//! This module provides the same interface as the original wallet::payments module
//! but delegates all operations to the hyperwallet service.

use hyperware_process_lib::{
    logging::{info, error, warn}, 
    wallet,
    hyperwallet_client,
};
use alloy_primitives::Address as EthAddress;

use crate::structs::{State, PaymentAttemptResult};

/// Asset types for withdrawals
#[derive(Debug, Clone, Copy)]
pub enum AssetType {
    Eth,
    Usdc,
}

///// one-stop thing
//pub fn execute_payment(
//    state: &State,
//    provider_wallet_address: &str,
//    amount_usdc_str: &str,
//    _provider_id: String,
//    operator_wallet_id: &str,
//) -> Option<PaymentAttemptResult> {
//    info!("Executing payment via hyperwallet: {} USDC to {}", amount_usdc_str, provider_wallet_address);
//    
//    let session = match &state.hyperwallet_session {
//        Some(session) => session,
//        None => {
//            error!("No hyperwallet session available - not initialized");
//            return Some(PaymentAttemptResult::Failed {
//                error: "Hyperwallet session not initialized".to_string(),
//                amount_attempted: amount_usdc_str.to_string(),
//                currency: "USDC".to_string(),
//            });
//        }
//    };
//    
//    let (usdc_contract, operator_tba, recipient_addr, amount_units) = match validate_payment_setup(state, provider_wallet_address, amount_usdc_str) {
//        Ok(setup) => setup,
//        Err(result) => return Some(result),
//    };
//    
//    let tx_hash = match hyperwallet_client::execute_gasless_payment(
//        &session.session_id,
//        operator_wallet_id,
//        &operator_tba,
//        &recipient_addr.to_string(),
//        amount_units,
//    ) {
//        Ok(tx_hash) => {
//            info!("Gasless payment completed: tx_hash = {}", tx_hash);
//            tx_hash
//        }
//        Err(e) => {
//            error!("Failed to execute gasless payment: {}", e);
//            return Some(PaymentAttemptResult::Failed {
//                error: format!("Payment failed: {}", e),
//                amount_attempted: amount_usdc_str.to_string(),
//                currency: "USDC".to_string(),
//            });
//        }
//    };
//
//    Some(PaymentAttemptResult::Success {
//        tx_hash,
//        amount_paid: amount_usdc_str.to_string(),
//        currency: "USDC".to_string(),
//    })
//}

pub fn execute_payment(
    state: &State,
    provider_wallet_address: &str,
    amount_usdc_str: &str,
    _provider_id: String,
    eoa_wallet_id: &str,
) -> Option<PaymentAttemptResult> {
    info!("Executing payment via hyperwallet: {} USDC to {}", amount_usdc_str, provider_wallet_address);
    
    // Get the hyperwallet session from state
    let session = match &state.hyperwallet_session {
        Some(session) => session,
        None => {
            error!("No hyperwallet session available - not initialized");
            return Some(PaymentAttemptResult::Failed {
                error: "Hyperwallet session not initialized".to_string(),
                amount_attempted: amount_usdc_str.to_string(),
                currency: "USDC".to_string(),
            });
        }
    };
    
    // Step 1: Validate setup and get required addresses
    let (usdc_contract, operator_tba, recipient_addr, amount_units) = match validate_payment_setup(state, provider_wallet_address, amount_usdc_str) {
        Ok(setup) => setup,
        Err(result) => return Some(result),
    };
    
    // Step 2: Create TBA execute calldata using the new API
    let tba_calldata = match hyperwallet_client::create_tba_payment_calldata(&usdc_contract, &recipient_addr.to_string(), amount_units) {
        Ok(calldata) => calldata,
        Err(e) => {
            error!("Failed to create TBA calldata: {}", e);
            return Some(PaymentAttemptResult::Failed {
                error: format!("Calldata creation failed: {}", e),
                amount_attempted: amount_usdc_str.to_string(),
                currency: "USDC".to_string(),
            });
        }
    };
    
    // Step 3: Build and sign UserOperation using new API
    let build_response = match hyperwallet_client::build_and_sign_user_operation_for_payment(
        &session.session_id,
        eoa_wallet_id,
        &operator_tba,
        &operator_tba, // not used anyway
        &tba_calldata,
        true,
        Some(Default::default()),
        None,
    ) {
        Ok(response) => {
            info!("UserOperation built and signed: {:?}", response);
            response
        },
        Err(e) => {
            error!("Failed to build and sign user operation: {}", e);
            return Some(PaymentAttemptResult::Failed {
                error: format!("Build failed: {}", e),
                amount_attempted: amount_usdc_str.to_string(),
                currency: "USDC".to_string(),
            });
        }
    };

    // Step 4: Submit UserOperation using new API
    let user_op_hash = match hyperwallet_client::submit_user_operation(
        &session.session_id,
        build_response.signed_user_operation,
        &build_response.entry_point,
        None,
    ) {
        Ok(hash) => {
            info!("UserOperation submitted: user_op_hash = {}", hash);
            hash
        }
        Err(e) => {
            error!("Failed to submit user operation: {}", e);
            return Some(PaymentAttemptResult::Failed {
                error: format!("Submit failed: {}", e),
                amount_attempted: amount_usdc_str.to_string(),
                currency: "USDC".to_string(),
            });
        }
    };

    // Step 5: Get receipt using new API
    let tx_hash = match hyperwallet_client::get_user_operation_receipt(
        &session.session_id,
        &user_op_hash,
    ) {
        Ok(receipt_response) => {
            // Extract tx_hash from typed response
            let tx_hash = receipt_response
                .receipt
                .as_ref()
                .and_then(|r| r.get("transactionHash"))
                .and_then(|h| h.as_str())
                .map(String::from)
                .unwrap_or(user_op_hash.clone()); // Fallback to userOp hash
                
            info!("Payment receipt received: tx_hash = {}", tx_hash);
            tx_hash
        }
        Err(e) => {
            warn!("Receipt failed ({}), using userOp hash as fallback: {}", e, user_op_hash);
            user_op_hash // Fallback to userOp hash
        }
    };

    Some(PaymentAttemptResult::Success {
        tx_hash,
        amount_paid: amount_usdc_str.to_string(),
        currency: "USDC".to_string(),
    })
}



// Helper: Validate payment setup and get required addresses
fn validate_payment_setup(
    state: &State,
    provider_wallet_address: &str,
    amount_usdc_str: &str,
) -> Result<(String, String, EthAddress, u128), PaymentAttemptResult> {
    // Get USDC contract address for the chain
    let usdc_contract = match crate::structs::CHAIN_ID {
        8453 => "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // Base USDC
        _ => {
            return Err(PaymentAttemptResult::Failed {
                error: format!("Unsupported chain ID: {}", crate::structs::CHAIN_ID),
                amount_attempted: amount_usdc_str.to_string(),
                currency: "USDC".to_string(),
            });
        }
    };
    
    // Check if operator TBA is configured
    let operator_tba = match &state.operator_tba_address {
        Some(addr) => addr.clone(),
        None => {
            return Err(PaymentAttemptResult::Skipped {
                reason: "Operator TBA not configured".to_string(),
            });
        }
    };
    
    // Parse recipient address
    let recipient_addr = match provider_wallet_address.parse::<EthAddress>() {
        Ok(addr) => addr,
        Err(_) => {
            return Err(PaymentAttemptResult::Failed {
                error: "Invalid recipient address".to_string(),
                amount_attempted: amount_usdc_str.to_string(),
                currency: "USDC".to_string(),
            });
        }
    };
    
    // Parse USDC amount (assuming input is in USDC units with decimals, e.g., "0.005")
    let amount_f64 = amount_usdc_str.parse::<f64>().unwrap_or(0.0);
    let amount_units = (amount_f64 * 1_000_000.0) as u128; // Convert to 6 decimal units
    
    Ok((usdc_contract.to_string(), operator_tba, recipient_addr, amount_units))
}

///// Execute a regular (non-gasless) payment via TBA
//fn execute_regular_payment(
//    operator_tba: String,
//    usdc_contract: &str,
//    call_data: String,
//    operator_wallet_id: &str,
//    amount_usdc_str: &str,
//) -> Option<PaymentAttemptResult> {
//    let params = serde_json::json!({
//        "tba_address": operator_tba,
//        "target": usdc_contract,
//        "call_data": call_data,
//        "value": "0",
//        "operation": 0 // CALL operation
//    });
//    
//    match call_hyperwallet_payment("ExecuteViaTba", params, Some(operator_wallet_id.to_string())) {
//        Ok(data) => {
//            if let Some(tx_hash) = data.get("transaction_hash").and_then(|h| h.as_str()) {
//                info!("Payment successful: tx_hash = {}", tx_hash);
//                Some(PaymentAttemptResult::Success {
//                    tx_hash: tx_hash.to_string(),
//                    amount_paid: amount_usdc_str.to_string(),
//                    currency: "USDC".to_string(),
//                })
//            } else {
//                error!("Payment response missing transaction_hash");
//                Some(PaymentAttemptResult::Failed {
//                    error: "Payment response missing transaction hash".to_string(),
//                    amount_attempted: amount_usdc_str.to_string(),
//                    currency: "USDC".to_string(),
//                })
//            }
//        }
//        Err(e) => {
//            error!("Payment failed: {}", e);
//            Some(PaymentAttemptResult::Failed {
//                error: format!("Hyperwallet payment error: {}", e),
//                amount_attempted: amount_usdc_str.to_string(),
//                currency: "USDC".to_string(),
//            })
//        }
//    }
//}

// TODO, this needs to call the execute_gasless_payment function in hyperwallet_client
/// Handle operator TBA withdrawal
pub fn handle_operator_tba_withdrawal(
    state: &State,
    asset_type: AssetType,
    to_address: String,
    amount_str: String,
) -> Result<(), String> {
    info!("Handling {:?} withdrawal via hyperwallet: {} to {}", asset_type, amount_str, to_address);
    
    // Get the hyperwallet session from state
    let session = match &state.hyperwallet_session {
        Some(session) => session,
        None => {
            return Err("Hyperwallet session not initialized".to_string());
        }
    };
    
    let wallet_id = state.selected_wallet_id.as_ref()
        .ok_or("No wallet selected")?;

    info!("Selected wallet ID: {:?}", wallet_id);
    
    let tx_hash = match asset_type {
        AssetType::Usdc => {
            // Get operator TBA address
            let tba_address = state.operator_tba_address.as_ref()
                .ok_or("Operator TBA not configured")?;
            
            // Parse USDC amount (e.g., "1.5" -> 1,500,000 units)
            let amount_f64 = amount_str.parse::<f64>()
                .map_err(|_| "Invalid amount format")?;
            let amount_usdc_units = amount_f64  as u128;
            
            // Use execute_gasless_payment from hyperwallet_client
            hyperwallet_client::execute_gasless_payment(
                &session.session_id,
                wallet_id,
                tba_address,
                &to_address,
                amount_usdc_units,
            ).map_err(|e| format!("USDC gasless withdrawal failed: {}", e))?
        }
        _ => {
            return Err(format!("Unsupported asset type: {:?}", asset_type));
        }
    };
    
    info!("Withdrawal successful: tx_hash = {}", tx_hash);
                Ok(())
}

// ===== Additional functions that might be needed =====

pub fn check_operator_tba_funding_detailed(
    tba_address: Option<&String>,
) -> crate::structs::TbaFundingDetails {
    use hyperware_process_lib::{eth, logging::info};
    
    let tba_addr = match tba_address {
        Some(addr) => addr,
        None => {
            return crate::structs::TbaFundingDetails {
                tba_needs_eth: false,
                tba_needs_usdc: false,
                tba_eth_balance_str: None,
                tba_usdc_balance_str: None,
                check_error: Some("No TBA address provided".to_string()),
            };
        }
    };

    let provider = eth::Provider::new(crate::structs::CHAIN_ID, 30000);
    let usdc_addr = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // Base USDC
    
    // Check USDC balance
    let (usdc_balance_str, usdc_error) = match wallet::erc20_balance_of(usdc_addr, tba_addr, &provider) {
        Ok(balance) => {
            info!("TBA USDC Balance: {} USDC", balance);
            (Some(format!("{:.6}", balance)), None)
        }
        Err(e) => {
            info!("Failed to get TBA USDC balance: {:?}", e);
            (None, Some(format!("USDC balance check failed: {}", e)))
        }
    };
    
    // Check ETH balance (optional, since we removed ETH from UI)
    let (eth_balance_str, eth_error) = match provider.get_balance(
        tba_addr.parse().unwrap_or_default(), 
        None
    ) {
        Ok(balance) => {
            let eth_balance = balance.to::<u128>() as f64 / 1e18;
            info!("TBA ETH Balance: {:.6} ETH", eth_balance);
            (Some(format!("{:.6}", eth_balance)), None)
        }
        Err(e) => {
            info!("Failed to get TBA ETH balance: {:?}", e);
            (None, Some(format!("ETH balance check failed: {}", e)))
        }
    };
    
    // Combine errors if any
    let combined_error = match (usdc_error, eth_error) {
        (Some(usdc_err), Some(eth_err)) => Some(format!("{}, {}", usdc_err, eth_err)),
        (Some(err), None) | (None, Some(err)) => Some(err),
        (None, None) => None,
    };

    crate::structs::TbaFundingDetails {
        tba_needs_eth: false, // We don't really need ETH anymore for gasless
        tba_needs_usdc: usdc_balance_str.as_ref().map_or(true, |s| s.parse::<f64>().unwrap_or(0.0) < 1.0),
        tba_eth_balance_str: eth_balance_str,
        tba_usdc_balance_str: usdc_balance_str,
        check_error: combined_error,
    }
}

pub fn check_single_hot_wallet_funding_detailed(
    _state: &crate::structs::State,
    _hot_wallet_address: &str,
) -> (bool, Option<String>, Option<String>) {
    // This would need to query hyperwallet or the chain directly
    // For now, return dummy values: (needs_eth, eth_balance_str, error_message)
    (false, Some("0.0".to_string()), None)
} 

//! Hyperwallet client payments module - replaces direct payment operations with hyperwallet calls
//! This module provides the same interface as the original wallet::payments module
//! but delegates all operations to the hyperwallet service.

use hyperware_process_lib::{Address, Request};
use hyperware_process_lib::logging::{info, error};
use serde::{Deserialize, Serialize};
use alloy_primitives::U256;

use crate::structs::{State, PaymentAttemptResult};
use super::account_abstraction;

// Hyperwallet service address
const HYPERWALLET_ADDRESS: (&str, &str, &str, &str) = ("our", "hyperwallet", "hyperwallet", "hallman.hypr");

/// Asset types for withdrawals
#[derive(Debug, Clone, Copy)]
pub enum AssetType {
    Eth,
    Usdc,
}

/// Helper function to make payment requests to hyperwallet service
fn call_hyperwallet_payment(
    operation: &str,
    params: serde_json::Value,
    wallet_id: Option<String>,
) -> Result<serde_json::Value, String> {
    let target = HYPERWALLET_ADDRESS;
    
    // Build the proper OperationRequest format
    let request = serde_json::json!({
        "operation": operation,
        "params": params,
        "wallet_id": wallet_id,
        "chain_id": crate::structs::CHAIN_ID,
        "auth": {
            "process_address": format!("{}@operator:operator:grid-beta.hypr", hyperware_process_lib::our().node()),
            "signature": null
        },
        "request_id": null,
        "timestamp": std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs()
    });
    
    let body = serde_json::to_vec(&request)
        .map_err(|e| format!("Failed to serialize request: {}", e))?;
    
    let response = Request::new()
        .target(target)
        .body(body)
        .send_and_await_response(120) // Longer timeout for payment operations
        .map_err(|e| format!("Failed to send request to hyperwallet: {}", e))?
        .map_err(|e| format!("Hyperwallet payment request failed: {}", e))?;
    
    // Parse the OperationResponse
    let operation_response: serde_json::Value = serde_json::from_slice(response.body())
        .map_err(|e| format!("Failed to parse hyperwallet response: {}", e))?;
    
    // Check if the operation was successful
    if let Some(success) = operation_response.get("success").and_then(|s| s.as_bool()) {
        if success {
            if let Some(data) = operation_response.get("data") {
                Ok(data.clone())
            } else {
                Err("Success response missing data field".to_string())
            }
        } else {
            let error_msg = operation_response.get("error")
                .and_then(|e| e.get("message"))
                .and_then(|m| m.as_str())
                .unwrap_or("Unknown error");
            Err(error_msg.to_string())
        }
    } else {
        Err("Response missing success field".to_string())
    }
}

/// Check if gasless transactions should be used based on configuration
fn should_use_gasless(state: &State) -> bool {
    // Check if gasless is enabled in state configuration
    state.gasless_enabled.unwrap_or(false) && 
    // Check if we're on a supported chain (Base)
    crate::structs::CHAIN_ID == 8453
}

/// Execute a payment to a provider if needed
pub fn execute_payment_if_needed(
    state: &State,
    provider_wallet_address: &str,
    amount_usdc_str: &str,
    _provider_id: String,
    operator_wallet_id: &str,
) -> Option<PaymentAttemptResult> {
    info!("Executing payment via hyperwallet: {} USDC to {}", 
          amount_usdc_str, provider_wallet_address);
    
    // Get USDC contract address for the chain
    let usdc_contract = match crate::structs::CHAIN_ID {
        8453 => "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // Base USDC
        1 => "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",    // Mainnet USDC
        _ => {
            error!("Unsupported chain ID for USDC: {}", crate::structs::CHAIN_ID);
            return Some(PaymentAttemptResult::Failed {
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
            return Some(PaymentAttemptResult::Skipped {
                reason: "Operator TBA not configured".to_string(),
            });
        }
    };
    
    // Parse USDC amount (assuming input is in USDC units with decimals, e.g., "0.005")
    let amount_f64 = amount_usdc_str.parse::<f64>().unwrap_or(0.0);
    let amount_units = (amount_f64 * 1_000_000.0) as u128; // Convert to 6 decimal units
    
    // Properly encode the ERC20 transfer call
    // Function selector for transfer(address,uint256): 0xa9059cbb
    let recipient_address = provider_wallet_address.trim_start_matches("0x");
    let call_data = format!(
        "0xa9059cbb{:0>64}{:064x}",
        recipient_address,
        amount_units
    );
    
    // Check if we should use gasless transactions
    if should_use_gasless(state) && account_abstraction::is_gasless_available(operator_wallet_id, Some(crate::structs::CHAIN_ID as u64)) {
        info!("Using gasless transaction for payment");
        
        // Build and sign UserOperation for gasless payment
        match account_abstraction::prepare_gasless_payment(
            operator_wallet_id,
            usdc_contract,
            &call_data,
            Some("0"),
            None, // No password needed if wallet is unlocked
            Some(crate::structs::CHAIN_ID as u64),
        ) {
            Ok((signed_user_op, entry_point)) => {
                // Submit the UserOperation
                match account_abstraction::submit_user_operation(
                    signed_user_op,
                    &entry_point,
                    None, // Use default bundler
                    Some(crate::structs::CHAIN_ID as u64),
                ) {
                    Ok(user_op_hash) => {
                        info!("Gasless payment submitted: user_op_hash = {}", user_op_hash);
                        Some(PaymentAttemptResult::Success {
                            tx_hash: user_op_hash,
                            amount_paid: amount_usdc_str.to_string(),
                            currency: "USDC".to_string(),
                        })
                    }
                    Err(e) => {
                        error!("Failed to submit gasless payment: {}", e);
                        // Fall back to regular payment
                        execute_regular_payment(operator_tba, usdc_contract, call_data, operator_wallet_id, amount_usdc_str)
                    }
                }
            }
            Err(e) => {
                error!("Failed to prepare gasless payment: {}", e);
                // Fall back to regular payment
                execute_regular_payment(operator_tba, usdc_contract, call_data, operator_wallet_id, amount_usdc_str)
            }
        }
    } else {
        // Use regular TBA execution
        execute_regular_payment(operator_tba, usdc_contract, call_data, operator_wallet_id, amount_usdc_str)
    }
}

/// Execute a regular (non-gasless) payment via TBA
fn execute_regular_payment(
    operator_tba: String,
    usdc_contract: &str,
    call_data: String,
    operator_wallet_id: &str,
    amount_usdc_str: &str,
) -> Option<PaymentAttemptResult> {
    let params = serde_json::json!({
        "tba_address": operator_tba,
        "target": usdc_contract,
        "call_data": call_data,
        "value": "0",
        "operation": 0 // CALL operation
    });
    
    match call_hyperwallet_payment("ExecuteViaTba", params, Some(operator_wallet_id.to_string())) {
        Ok(data) => {
            if let Some(tx_hash) = data.get("transaction_hash").and_then(|h| h.as_str()) {
                info!("Payment successful: tx_hash = {}", tx_hash);
                Some(PaymentAttemptResult::Success {
                    tx_hash: tx_hash.to_string(),
                    amount_paid: amount_usdc_str.to_string(),
                    currency: "USDC".to_string(),
                })
            } else {
                error!("Payment response missing transaction_hash");
                Some(PaymentAttemptResult::Failed {
                    error: "Payment response missing transaction hash".to_string(),
                    amount_attempted: amount_usdc_str.to_string(),
                    currency: "USDC".to_string(),
                })
            }
        }
        Err(e) => {
            error!("Payment failed: {}", e);
            Some(PaymentAttemptResult::Failed {
                error: format!("Hyperwallet payment error: {}", e),
                amount_attempted: amount_usdc_str.to_string(),
                currency: "USDC".to_string(),
            })
        }
    }
}

/// Handle operator TBA withdrawal
pub fn handle_operator_tba_withdrawal(
    state: &State,
    asset_type: AssetType,
    to_address: String,
    amount_str: String,
) -> Result<(), String> {
    info!("Handling {:?} withdrawal via hyperwallet: {} to {}", asset_type, amount_str, to_address);
    
    // Get selected wallet ID
    let wallet_id = state.selected_wallet_id.as_ref()
        .ok_or("No wallet selected")?;
    
    // Get operator TBA address
    let operator_tba = state.operator_tba_address.as_ref()
        .ok_or("Operator TBA not configured")?;
    
    let (operation, params) = match asset_type {
        AssetType::Eth => {
            // For ETH, we need to execute via TBA with value
            ("ExecuteViaTba", serde_json::json!({
                "tba_address": operator_tba,
                "target": to_address,
                "call_data": "0x", // Empty call data for ETH transfer
                "value": amount_str,
                "operation": 0 // CALL operation
            }))
        }
        AssetType::Usdc => {
            // For USDC, we need to create the ERC20 transfer calldata
            let usdc_contract = match crate::structs::CHAIN_ID {
                8453 => "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // Base USDC
                1 => "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",    // Mainnet USDC
                _ => return Err(format!("Unsupported chain ID for USDC: {}", crate::structs::CHAIN_ID)),
            };
            
            // Parse amount and convert to USDC units
            let amount_f64 = amount_str.parse::<f64>().map_err(|e| format!("Invalid amount: {}", e))?;
            let amount_units = (amount_f64 * 1_000_000.0) as u128; // Convert to 6 decimal units
            
            // Encode ERC20 transfer call
            let recipient_address = to_address.trim_start_matches("0x");
            let call_data = format!(
                "0xa9059cbb{:0>64}{:064x}",
                recipient_address,
                amount_units
            );
            
            ("ExecuteViaTba", serde_json::json!({
                "tba_address": operator_tba,
                "target": usdc_contract,
                "call_data": call_data,
                "value": "0",
                "operation": 0 // CALL operation
            }))
        }
    };
    
    match call_hyperwallet_payment(operation, params, Some(wallet_id.clone())) {
        Ok(data) => {
            if let Some(tx_hash) = data.get("transaction_hash").and_then(|h| h.as_str()) {
                info!("Withdrawal successful: tx_hash = {}", tx_hash);
                Ok(())
            } else {
                Err("Withdrawal response missing transaction hash".to_string())
            }
        }
        Err(e) => Err(format!("Withdrawal failed: {}", e)),
    }
}

// ===== Additional functions that might be needed =====

pub fn check_operator_tba_funding_detailed(
    tba_address: Option<&String>,
) -> crate::structs::TbaFundingDetails {
    // This would need to query hyperwallet or the chain directly
    // For now, return dummy values
    crate::structs::TbaFundingDetails {
        tba_needs_eth: false,
        tba_needs_usdc: false,
        tba_eth_balance_str: Some("0.0".to_string()),
        tba_usdc_balance_str: Some("0.0".to_string()),
        check_error: None,
    }
}

pub fn check_single_hot_wallet_funding_detailed(
    _state: &crate::structs::State,
    hot_wallet_address: &str,
) -> (bool, Option<String>, Option<String>) {
    // This would need to query hyperwallet or the chain directly
    // For now, return dummy values: (needs_eth, eth_balance_str, error_message)
    (false, Some("0.0".to_string()), None)
} 
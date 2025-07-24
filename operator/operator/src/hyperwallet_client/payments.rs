//! Hyperwallet client payments module - replaces direct payment operations with hyperwallet calls
//! This module provides the same interface as the original wallet::payments module
//! but delegates all operations to the hyperwallet service.

use hyperware_process_lib::{Address, Request};
use hyperware_process_lib::{
    logging::{info, error}, 
    wallet};
use serde::{Deserialize, Serialize};
use alloy_primitives::U256;

use crate::structs::{State, PaymentAttemptResult};
use super::account_abstraction;

// Hyperwallet service address
const HYPERWALLET_ADDRESS: (&str, &str, &str, &str) = ("our", "hyperwallet", "hyperwallet", "hallman.hypr");

// Circle Paymaster configuration for Base chain
const CIRCLE_PAYMASTER_ADDRESS: &str = "0x0578cFB241215b77442a541325d6A4E6dFE700Ec";
const CIRCLE_PAYMASTER_VERIFICATION_GAS: u64 = 500_000; // 0x7a120 - Gas for paymaster validation
const CIRCLE_PAYMASTER_POST_OP_GAS: u64 = 300_000;     // 0x493e0 - Gas for paymaster post-operation

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
    execute_payment_with_metadata(state, provider_wallet_address, amount_usdc_str, _provider_id, operator_wallet_id, None)
}

/// Execute a payment with optional metadata (for testing paymaster formats)
pub fn execute_payment_with_metadata(
    state: &State,
    provider_wallet_address: &str,
    amount_usdc_str: &str,
    _provider_id: String,
    operator_wallet_id: &str,
    metadata: Option<serde_json::Map<String, serde_json::Value>>,
) -> Option<PaymentAttemptResult> {
    info!("Executing payment via hyperwallet: {} USDC to {}", 
          amount_usdc_str, provider_wallet_address);
    
    // Get USDC contract address for the chain
    let usdc_contract = match crate::structs::CHAIN_ID {
        8453 => "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // Base USDC
        //1 => "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",    // Mainnet USDC
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
        // Check if metadata explicitly disables paymaster
        let use_paymaster = if let Some(ref meta) = metadata {
            meta.get("use_paymaster")
                .and_then(|v| v.as_bool())
                .unwrap_or(true) // Default to true if not specified
        } else {
            true
        };
        
        if !use_paymaster {
            info!("Building UserOperation WITHOUT paymaster (using ETH for gas)");
        } else {
            info!("Using gasless transaction for payment (with paymaster)");
        }
        
        // For gasless transactions, we need to:
        // 1. Create the ERC20 transfer calldata
        // 2. Wrap it in a TBA execute call
        // 3. Build UserOperation with TBA as sender
        
        // The TBA execute calldata wraps the ERC20 transfer
        // We need to properly encode: execute(address target, uint256 value, bytes data, uint8 operation)
        use alloy_primitives::{Address as EthAddress, U256, Bytes};
        use alloy_sol_types::{SolCall, sol};
        
        sol! {
            function execute(address target, uint256 value, bytes data, uint8 operation) external returns (bytes memory);
        }
        
        // Parse the USDC contract address
        let usdc_addr = usdc_contract.parse::<EthAddress>()
            .map_err(|_| "Invalid USDC address".to_string());
        
        // Decode the ERC20 transfer calldata
        let erc20_data = hex::decode(call_data.trim_start_matches("0x"))
            .map_err(|_| "Invalid call data".to_string());
        
        match (usdc_addr, erc20_data) {
            (Ok(addr), Ok(data)) => {
                // Create the execute call
                let execute_call = executeCall {
                    target: addr,
                    value: U256::ZERO,
                    data: data.into(),
                    operation: 0, // CALL
                };
                
                let tba_calldata = format!("0x{}", hex::encode(execute_call.abi_encode()));
                
                // Add Circle paymaster info to metadata if using paymaster
                let mut final_metadata = metadata.unwrap_or_else(|| serde_json::Map::new());
                if use_paymaster {
                    // Circle Paymaster on Base - add all required metadata
                    final_metadata.insert("paymaster_address".to_string(), 
                        serde_json::json!(CIRCLE_PAYMASTER_ADDRESS));
                    final_metadata.insert("is_circle_paymaster".to_string(), serde_json::json!(true));
                    final_metadata.insert("paymaster_verification_gas".to_string(), 
                        serde_json::json!(format!("0x{:x}", CIRCLE_PAYMASTER_VERIFICATION_GAS)));
                    final_metadata.insert("paymaster_post_op_gas".to_string(), 
                        serde_json::json!(format!("0x{:x}", CIRCLE_PAYMASTER_POST_OP_GAS)));
                }
                
                // ✅ ADD TBA ADDRESS TO METADATA - This tells hyperwallet to use TBA as sender
                final_metadata.insert("tba_address".to_string(), 
                    serde_json::json!(operator_tba));
                
                match account_abstraction::build_and_sign_user_operation_with_metadata(
                    operator_wallet_id, // Hot wallet that will sign
                    &operator_tba, // Target is the TBA (self-call)
                    &tba_calldata,
                    Some("0"),
                    use_paymaster, // Pass the use_paymaster flag
                    Some(final_metadata), // Pass the metadata with Circle info
                    None, // No password needed if wallet is already unlocked
                    Some(crate::structs::CHAIN_ID as u64),
                ) {
                    Ok(signed_data) => {
                        // The response should contain the signed UserOperation
                        let signed_user_op = signed_data.get("signed_user_operation")
                            .ok_or("Missing signed_user_operation")
                            .map_err(|e| e.to_string());
                        
                        let entry_point = signed_data.get("entry_point")
                            .and_then(|e| e.as_str())
                            .ok_or("Missing entry_point")
                            .map_err(|e| e.to_string());
                        
                        match (signed_user_op, entry_point) {
                            (Ok(signed_op), Ok(ep)) => {
                                // Submit the UserOperation
                                match account_abstraction::submit_user_operation(
                                    signed_op.clone(),
                                    ep,
                                    None,
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
                                        execute_regular_payment(operator_tba, usdc_contract, call_data, operator_wallet_id, amount_usdc_str)
                                    }
                                }
                            }
                            _ => {
                                error!("Failed to get signed UserOperation data");
                                execute_regular_payment(operator_tba, usdc_contract, call_data, operator_wallet_id, amount_usdc_str)
                            }
                        }
                    }
                    Err(e) => {
                        error!("Failed to build and sign UserOperation: {}", e);
                        execute_regular_payment(operator_tba, usdc_contract, call_data, operator_wallet_id, amount_usdc_str)
                    }
                }
            }
            _ => {
                error!("Failed to parse USDC address or call data");
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
    hot_wallet_address: &str,
) -> (bool, Option<String>, Option<String>) {
    // This would need to query hyperwallet or the chain directly
    // For now, return dummy values: (needs_eth, eth_balance_str, error_message)
    (false, Some("0.0".to_string()), None)
} 
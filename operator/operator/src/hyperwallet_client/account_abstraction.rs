//! Account Abstraction (ERC-4337) operations for hyperwallet client
//! This module provides functions to build, sign, and submit UserOperations for gasless transactions

use hyperware_process_lib::logging::{info, error};
use serde::{Deserialize, Serialize};
use serde_json::json;
use chrono;
use uuid;

use super::send_hyperwallet_request;

/// Build a UserOperation for gasless transaction
pub fn build_user_operation(
    wallet_id: &str,
    target: &str,
    call_data: &str,
    value: Option<&str>,
    use_paymaster: bool,
    chain_id: Option<u64>,
) -> Result<serde_json::Value, String> {
    info!("Building UserOperation for wallet {}", wallet_id);
    
    let request = json!({
        "operation": "BuildUserOperation",
        "params": {
            "target": target,
            "call_data": call_data,
            "value": value.unwrap_or("0"),
            "use_paymaster": use_paymaster,
        },
        "auth": {
            "process_address": hyperware_process_lib::our().to_string(),
            "signature": null
        },
        "wallet_id": wallet_id,
        "chain_id": chain_id.unwrap_or(8453), // Default to Base
        "request_id": format!("operator-build-userop-{}", uuid::Uuid::new_v4()),
        "timestamp": chrono::Utc::now().timestamp()
    });
    
    match send_hyperwallet_request(request) {
        Ok(response) => {
            if response.get("success").and_then(|v| v.as_bool()).unwrap_or(false) {
                Ok(response.get("data").cloned().unwrap_or(json!({})))
            } else {
                let error_msg = response.get("error")
                    .and_then(|e| e.get("message"))
                    .and_then(|m| m.as_str())
                    .unwrap_or("Unknown error");
                Err(format!("Failed to build UserOperation: {}", error_msg))
            }
        }
        Err(e) => Err(format!("Failed to communicate with hyperwallet: {}", e))
    }
}

/// Sign a built UserOperation
pub fn sign_user_operation(
    wallet_id: &str,
    user_operation: serde_json::Value,
    entry_point: &str,
    password: Option<&str>,
    chain_id: Option<u64>,
) -> Result<serde_json::Value, String> {
    info!("Signing UserOperation with wallet {}", wallet_id);
    
    let mut params = json!({
        "user_operation": user_operation,
        "entry_point": entry_point,
    });
    
    if let Some(pwd) = password {
        params["password"] = json!(pwd);
    }
    
    let request = json!({
        "operation": "SignUserOperation",
        "params": params,
        "auth": {
            "process_address": hyperware_process_lib::our().to_string(),
            "signature": null
        },
        "wallet_id": wallet_id,
        "chain_id": chain_id.unwrap_or(8453),
        "request_id": format!("operator-sign-userop-{}", uuid::Uuid::new_v4()),
        "timestamp": chrono::Utc::now().timestamp()
    });
    
    match send_hyperwallet_request(request) {
        Ok(response) => {
            if response.get("success").and_then(|v| v.as_bool()).unwrap_or(false) {
                Ok(response.get("data").cloned().unwrap_or(json!({})))
            } else {
                let error_msg = response.get("error")
                    .and_then(|e| e.get("message"))
                    .and_then(|m| m.as_str())
                    .unwrap_or("Unknown error");
                Err(format!("Failed to sign UserOperation: {}", error_msg))
            }
        }
        Err(e) => Err(format!("Failed to communicate with hyperwallet: {}", e))
    }
}

/// Submit a signed UserOperation to a bundler
pub fn submit_user_operation(
    signed_user_operation: serde_json::Value,
    entry_point: &str,
    bundler_url: Option<&str>,
    chain_id: Option<u64>,
) -> Result<String, String> {
    info!("Submitting UserOperation to bundler");
    
    let request = json!({
        "operation": "SubmitUserOperation",
        "params": {
            "signed_user_operation": signed_user_operation,
            "entry_point": entry_point,
            "bundler_url": bundler_url,
        },
        "auth": {
            "process_address": hyperware_process_lib::our().to_string(),
            "signature": null
        },
        "wallet_id": null, // Not wallet-specific
        "chain_id": chain_id.unwrap_or(8453),
        "request_id": format!("operator-submit-userop-{}", uuid::Uuid::new_v4()),
        "timestamp": chrono::Utc::now().timestamp()
    });
    
    match send_hyperwallet_request(request) {
        Ok(response) => {
            if response.get("success").and_then(|v| v.as_bool()).unwrap_or(false) {
                response.get("data")
                    .and_then(|d| d.get("user_op_hash"))
                    .and_then(|h| h.as_str())
                    .map(|s| s.to_string())
                    .ok_or_else(|| "Missing UserOperation hash in response".to_string())
            } else {
                let error_msg = response.get("error")
                    .and_then(|e| e.get("message"))
                    .and_then(|m| m.as_str())
                    .unwrap_or("Unknown error");
                Err(format!("Failed to submit UserOperation: {}", error_msg))
            }
        }
        Err(e) => Err(format!("Failed to communicate with hyperwallet: {}", e))
    }
}

/// Estimate gas for a UserOperation
pub fn estimate_user_operation_gas(
    user_operation: serde_json::Value,
    entry_point: &str,
    chain_id: Option<u64>,
) -> Result<serde_json::Value, String> {
    info!("Estimating gas for UserOperation");
    
    let request = json!({
        "operation": "EstimateUserOperationGas",
        "params": {
            "user_operation": user_operation,
            "entry_point": entry_point,
        },
        "auth": {
            "process_address": hyperware_process_lib::our().to_string(),
            "signature": null
        },
        "wallet_id": null,
        "chain_id": chain_id.unwrap_or(8453),
        "request_id": format!("operator-estimate-gas-{}", uuid::Uuid::new_v4()),
        "timestamp": chrono::Utc::now().timestamp()
    });
    
    match send_hyperwallet_request(request) {
        Ok(response) => {
            if response.get("success").and_then(|v| v.as_bool()).unwrap_or(false) {
                Ok(response.get("data").cloned().unwrap_or(json!({})))
            } else {
                let error_msg = response.get("error")
                    .and_then(|e| e.get("message"))
                    .and_then(|m| m.as_str())
                    .unwrap_or("Unknown error");
                Err(format!("Failed to estimate gas: {}", error_msg))
            }
        }
        Err(e) => Err(format!("Failed to communicate with hyperwallet: {}", e))
    }
}

/// Get UserOperation receipt
pub fn get_user_operation_receipt(
    user_op_hash: &str,
    chain_id: Option<u64>,
) -> Result<serde_json::Value, String> {
    info!("Getting UserOperation receipt for hash {}", user_op_hash);
    
    let request = json!({
        "operation": "GetUserOperationReceipt",
        "params": {
            "user_op_hash": user_op_hash,
        },
        "auth": {
            "process_address": hyperware_process_lib::our().to_string(),
            "signature": null
        },
        "wallet_id": null,
        "chain_id": chain_id.unwrap_or(8453),
        "request_id": format!("operator-get-receipt-{}", uuid::Uuid::new_v4()),
        "timestamp": chrono::Utc::now().timestamp()
    });
    
    match send_hyperwallet_request(request) {
        Ok(response) => {
            if response.get("success").and_then(|v| v.as_bool()).unwrap_or(false) {
                Ok(response.get("data").cloned().unwrap_or(json!({})))
            } else {
                let error_msg = response.get("error")
                    .and_then(|e| e.get("message"))
                    .and_then(|m| m.as_str())
                    .unwrap_or("Unknown error");
                Err(format!("Failed to get receipt: {}", error_msg))
            }
        }
        Err(e) => Err(format!("Failed to communicate with hyperwallet: {}", e))
    }
}

/// Helper function to check if gasless transactions are available for a wallet
pub fn is_gasless_available(wallet_id: &str, chain_id: Option<u64>) -> bool {
    // For now, gasless is available on Base (chain 8453) with known paymasters
    let chain = chain_id.unwrap_or(8453);
    chain == 8453 // Base has Circle's USDC paymaster
}

/// Build and sign a UserOperation for gasless payment in one call
pub fn prepare_gasless_payment(
    wallet_id: &str,
    target: &str,
    call_data: &str,
    value: Option<&str>,
    password: Option<&str>,
    chain_id: Option<u64>,
) -> Result<(serde_json::Value, String), String> {
    // Step 1: Build the UserOperation
    let user_op_data = build_user_operation(
        wallet_id,
        target,
        call_data,
        value,
        true, // use_paymaster = true for gasless
        chain_id,
    )?;
    
    let user_operation = user_op_data.get("user_operation")
        .ok_or("Missing user_operation in build response")?
        .clone();
    
    let entry_point = user_op_data.get("entry_point")
        .and_then(|e| e.as_str())
        .ok_or("Missing entry_point in build response")?;
    
    // Step 2: Sign the UserOperation
    let signed_data = sign_user_operation(
        wallet_id,
        user_operation,
        entry_point,
        password,
        chain_id,
    )?;
    
    let signed_user_op = signed_data.get("signed_user_operation")
        .ok_or("Missing signed_user_operation in sign response")?
        .clone();
    
    Ok((signed_user_op, entry_point.to_string()))
} 
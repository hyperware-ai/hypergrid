pub mod service;
pub mod payments;
pub mod account_abstraction;

use hyperware_process_lib::{Request, Response, Address};
use hyperware_process_lib::logging::{info, error, warn};
use serde::{Deserialize, Serialize};
use serde_json::json;
use chrono;

// Hyperwallet service address
const HYPERWALLET_ADDRESS: (&str, &str, &str, &str) = ("our", "hyperwallet", "hyperwallet", "hallman.hypr");

/// Initialize the operator's relationship with hyperwallet
/// Returns true if successfully registered/verified, false otherwise
pub fn init_with_hyperwallet() -> bool {
    info!("Initializing operator with hyperwallet service...");
    
    let our_address = hyperware_process_lib::our().to_string();
    
    // First, try to register with hyperwallet
    let register_request = json!({
        "operation": "RegisterProcess",
        "params": {
            "operations": [
                "CreateWallet",
                "ImportWallet", 
                "ListWallets",
                "GetWalletInfo",
                "SetWalletLimits",
                "SendEth",
                "SendToken",
                "ExecuteViaTba",
                "GetBalance",
                "GetTokenBalance",
                "ResolveIdentity",
                "CreateNote",
                "ReadNote",
                "SetupDelegation",
                "VerifyDelegation",
                "GetTransactionHistory",
                "UpdateSpendingLimits",
                "RenameWallet",
                "BuildUserOperation",
                "BuildAndSignUserOperation",
                "BuildAndSignUserOperationForPayment",
                "SignUserOperation",
                "SubmitUserOperation",
                "EstimateUserOperationGas",
                "GetUserOperationReceipt",
                "ConfigurePaymaster"
            ],
            "spending_limits": {
                "per_tx_eth": "0.1",
                "daily_eth": "1.0",
                "per_tx_usdc": "10000.0",
                "daily_usdc": "100000.0"
            }
        },
        "auth": {
            "process_address": our_address,
            "signature": null
        },
        "wallet_id": null,
        "chain_id": null,
        "request_id": "operator-init-register",
        "timestamp": chrono::Utc::now().timestamp()
    });
    
    match send_hyperwallet_request(register_request) {
        Ok(response) => {
            if response.get("success").and_then(|v| v.as_bool()).unwrap_or(false) {
                if response.get("already_registered").and_then(|v| v.as_bool()).unwrap_or(false) {
                    info!("Operator already registered with hyperwallet, using existing permissions");
                } else {
                    info!("Successfully registered operator with hyperwallet");
                }
                return true;
            }
            
            error!("Failed to register with hyperwallet: {:?}", response);
            false
        }
        Err(e) => {
            error!("Failed to communicate with hyperwallet: {}", e);
            false
        }
    }
}

/// Send a request to the hyperwallet service
pub fn send_hyperwallet_request(request_body: serde_json::Value) -> Result<serde_json::Value, String> {
    let target = HYPERWALLET_ADDRESS;
    info!("Sending request to hyperwallet at {:?}", target);
    
    let request = Request::new()
        .target(target)
        .body(serde_json::to_vec(&request_body).map_err(|e| e.to_string())?);
    
    let response = request.send_and_await_response(30000)
        .map_err(|e| format!("Network error: {:?}", e))?
        .map_err(|e| format!("Send error: {:?}", e))?;
    
    let body = response.body();
    serde_json::from_slice(&body).map_err(|e| format!("Failed to parse response: {}", e))
} 
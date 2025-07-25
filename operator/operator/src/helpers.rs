use anyhow::{anyhow, Result};
use std::time::{SystemTime, UNIX_EPOCH};
use std::collections::HashMap;
use sha2::{Sha256, Digest};
use hyperware_process_lib::logging::{info, error, warn};
use hyperware_process_lib::Address as HyperAddress;
use hyperware_process_lib::sqlite::Sqlite;
use hyperware_process_lib::wallet::{self, KeyStorage, EthAmount, execute_via_tba_with_signer, wait_for_transaction, get_eth_balance, erc20_balance_of};
use hyperware_process_lib::eth::{Provider, TransactionRequest, TransactionInput, BlockNumberOrTag};
use alloy_primitives::{Address as EthAddress, Bytes as AlloyBytes};
use std::str::FromStr;
use hyperware_process_lib::hypermap;
use hyperware_process_lib::eth;
use hyperware_process_lib::http::{StatusCode, server::send_response};
use hyperware_process_lib::signer::Signer;
use alloy_primitives::{U256, B256};
use alloy_sol_types::{SolValue, SolCall};
use hex;

use crate::structs::{self, *};
use crate::db;
use crate::wallet::service;
use crate::chain;
use crate::authorized_services::{HotWalletAuthorizedClient, ServiceCapabilities};

pub fn make_json_timestamp() -> serde_json::Number {
    let systemtime = SystemTime::now();

    let duration_since_epoch = systemtime
        .duration_since(UNIX_EPOCH)
        .expect("Time went backwards");
    let secs = duration_since_epoch.as_secs();
    let now: serde_json::Number = secs.into();
    return now;
}

// Calculate provider ID based on SHA256 hash of provider name
pub fn get_provider_id(provider_name: &str) -> String {
    let digest = Sha256::digest(provider_name.as_bytes());
    format!("{:x}", digest)
} 

// Helper function to authenticate a shim client
pub fn authenticate_shim_client<'a>(
    state: &'a State,
    client_id: &str,
    raw_token: &str,
) -> Result<&'a HotWalletAuthorizedClient, AuthError> {
    // 1. Lookup Clien
    match state.authorized_clients.get(client_id) {
        Some(client_config) => {
            // 2. Verify Token
            let mut hasher = Sha256::new();
            hasher.update(raw_token.as_bytes());
            let hashed_received_token = format!("{:x}", hasher.finalize());

            if hashed_received_token != client_config.authentication_token {
                return Err(AuthError::InvalidToken);
            }

            // 3. Check Capabilities
            if client_config.capabilities != ServiceCapabilities::All {
                return Err(AuthError::InsufficientCapabilities);
            }
            
            // All checks passed
            Ok(client_config)
        }
        None => Err(AuthError::ClientNotFound),
    }
} 


// --- Hypermap Helper Functions for Delegation --- 

/// Reads an access list note and extracts the B256 hash of the signers note it points to.
/// 
/// # Arguments
/// * `hypermap_reader` - An initialized instance of `hypermap::Hypermap`.
/// * `access_list_full_path` - The full Hypermap path to the access list note
///
/// # Returns
/// * `Ok(B256)` - The hash of the signers note.
/// * `Err(String)` - An error message detailing what went wrong (note not found, invalid data format, etc.).
pub fn get_signers_note_hash_from_access_list(
    hypermap_reader: &hypermap::Hypermap,
    access_list_full_path: &str,
) -> Result<B256, String> {
    info!("Helper: Reading access list note: {}", access_list_full_path);

    match hypermap_reader.get(access_list_full_path) {
        Ok((_tba, _owner, Some(data))) => {
            // Expecting raw 32-byte hash directly
            info!("  Helper: Found access list data ({} bytes). Expecting raw 32-byte hash.", data.len());
            if data.len() == 32 { // Expect raw 32 bytes for the hash
                let hash = B256::from_slice(&data);
                info!("  Helper: Successfully interpreted raw data as 32-byte namehash for signers note: {}", hash);
                Ok(hash)
            } else {
                let reason = format!(
                    "Data in access list note '{}' is not 32 bytes long (expected raw hash), length is {}. Data (hex): 0x{}", 
                    access_list_full_path, data.len(), hex::encode(&data) // Log as hex for debugging
                );
                error!("  Helper: Error - {}", reason);
                Err(reason)
            }
        }
        Ok((_tba, _owner, None)) => {
            let reason = format!("Access list note '{}' exists but has no data.", access_list_full_path);
            error!("  Helper: Error - {}", reason);
            Err(reason)
        }
        Err(e) => {
            let err_msg = format!("{:?}", e);
            let reason = format!("Error reading access list note '{}': {}", access_list_full_path, err_msg);
            error!("  Helper: Error - {}", reason);
            if err_msg.contains("note not found") { 
                 Err(format!("AccessListNoteMissing: {}", reason)) // More specific error type if needed
            } else {
                 Err(format!("HypermapReadError: {}", reason))
            }
        }
    }
}

/// Reads a signers note (given its hash) and ABI-decodes its content as a Vec<Address>.
///
/// # Arguments
/// * `hypermap_reader` - An initialized instance of `hypermap::Hypermap`.
/// * `signers_note_hash_b256` - The B256 hash of the signers note.
///
/// # Returns
/// * `Ok(Vec<EthAddress>)` - A vector of delegate Ethereum addresses.
/// * `Err(String)` - An error message detailing what went wrong (note not found, invalid data format, etc.).
pub fn get_signers_note_from_hash(
    hypermap_reader: &hypermap::Hypermap,
    signers_note_hash_b256: &B256,
) -> Result<Vec<EthAddress>, String> {
    info!("Helper: Reading signers note: {}", signers_note_hash_b256);

    let note_hash_hex = format!("{:x}", signers_note_hash_b256);

    match hypermap_reader.get(&note_hash_hex) {
        Ok((_tba, _owner, Some(data))) => {
            // Expecting raw 32-byte hash directly
            info!("  Helper: Found signers note data ({} bytes). Expecting raw 32-byte hash.", data.len());
            if data.len() == 32 { // Expect raw 32 bytes for the hash
                let hash = B256::from_slice(&data);
                info!("  Helper: Successfully interpreted raw data as 32-byte namehash for signers note: {}", hash);
                Ok(vec![EthAddress::from_slice(&data)])
            } else {
                let reason = format!(
                    "Data in signers note '{}' is not 32 bytes long (expected raw hash), length is {}. Data (hex): 0x{}", 
                    signers_note_hash_b256, data.len(), hex::encode(&data) // Log as hex for debugging
                );
                error!("  Helper: Error - {}", reason);
                Err(reason)
            }
        }
        Ok((_tba, _owner, None)) => {
            let reason = format!("Signers note '{}' exists but has no data.", signers_note_hash_b256);
            error!("  Helper: Error - {}", reason);
            Err(reason)
        }
        Err(e) => {
            let err_msg = format!("{:?}", e);
            let reason = format!("Error reading signers note '{}': {}", signers_note_hash_b256, err_msg);
            error!("  Helper: Error - {}", reason);
            if err_msg.contains("note not found") { 
                 Err(format!("SignersNoteMissing: {}", reason)) // More specific error type if needed
            } else {
                 Err(format!("HypermapReadError: {}", reason))
            }
        }
    }
}

/// * `Err(String)` - An error message detailing what went wrong (note not found, invalid data format, etc.).
pub fn get_addresses_from_signers_note(
    hypermap_reader: &hypermap::Hypermap,
    signers_note_hash_b256: B256,
) -> Result<Vec<EthAddress>, String> {
    let signers_note_hash_str = format!("0x{}", hex::encode(signers_note_hash_b256));
    info!("Helper: Reading signers note using hash: {}", signers_note_hash_str);

    match hypermap_reader.get_hash(&signers_note_hash_str) { 
        Ok((_tba, _owner, Some(data))) => {
            info!("  Helper: Found signers note data ({} bytes). Expecting ABI-encoded Address[].", data.len());
            match Vec::<EthAddress>::abi_decode(&data, true) { // true for lenient if padded
                Ok(decoded_delegates) => {
                     info!("  Helper: Successfully ABI-decoded signers note delegates: {:?}", decoded_delegates);
                     Ok(decoded_delegates)
                }
                Err(e) => {
                    let reason = format!(
                        "Failed to ABI decode signers note (hash: {}) data as Address[]: {}. Data(hex): 0x{}", 
                        signers_note_hash_str, e, hex::encode(&data)
                    );
                    error!("  Helper: Error - {}", reason);
                    Err(reason)
                }
            }
        }
        Ok((_tba, _owner, None)) => {
            let reason = format!("Signers note found by hash '{}' exists but has no data.", signers_note_hash_str);
            error!("  Helper: Error - {}", reason);
            Err(reason)
        }
        Err(e) => {
            let err_msg = format!("{:?}", e);
            let reason = format!("Error reading signers note by hash '{}': {}", signers_note_hash_str, err_msg);
            error!("  Helper: Error - {}", reason);
            if err_msg.contains("note not found") { 
                Err(format!("SignersNoteNotFound: {}", reason))
             } else {
                Err(format!("HypermapReadError: {}", reason))
             }
        }
    }
}

/// Queries Hypermap for the TBA of a given node name.
/// Returns a descriptive string with the TBA or an error/not found message.
fn debug_get_tba_for_node(node_name: &str) -> Result<String> {
    info!("Debug: Querying TBA for node: {}", node_name);
    let provider = eth::Provider::new(structs::CHAIN_ID, 30000);
    let hypermap_contract_address = EthAddress::from_str(hypermap::HYPERMAP_ADDRESS)
        .map_err(|e| anyhow!("Invalid HYPERMAP_ADDRESS: {}", e))?;

    if hypermap_contract_address == EthAddress::ZERO {
        return Ok("HYPERMAP_ADDRESS is zero, cannot query.".to_string());
    }

    let hypermap_reader = hypermap::Hypermap::new(provider.clone(), hypermap_contract_address);
    match hypermap_reader.get(node_name) {
        Ok((tba, _owner, _data)) => {
            if tba != EthAddress::ZERO {
                Ok(format!("Found: {}", tba.to_string()))
            } else {
                Ok("Not found (TBA is zero address).".to_string())
            }
        }
        Err(e) => {
            Ok(format!("Error during lookup: {:?}", e))
        }
    }
}

/// Queries Hypermap for the owner EOA of a given node name.
/// Returns a descriptive string with the owner EOA or an error/not found message.
fn debug_get_owner_for_node(node_name: &str) -> Result<String> {
    info!("Debug: Querying owner for node: {}", node_name);
    let provider = eth::Provider::new(structs::CHAIN_ID, 30000);
    let hypermap_contract_address = EthAddress::from_str(hypermap::HYPERMAP_ADDRESS)
        .map_err(|e| anyhow!("Invalid HYPERMAP_ADDRESS: {}", e))?;

    if hypermap_contract_address == EthAddress::ZERO {
        return Ok("HYPERMAP_ADDRESS is zero, cannot query.".to_string());
    }

    let hypermap_reader = hypermap::Hypermap::new(provider.clone(), hypermap_contract_address);
    match hypermap_reader.get(node_name) {
        Ok((_tba, owner, _data)) => {
            Ok(format!("Found: {}", owner.to_string()))
        }
        Err(e) => {
            Ok(format!("Error during lookup: {:?}", e))
        }
    }
}

pub fn send_json_response<T: serde::Serialize>(status: StatusCode, data: &T) -> anyhow::Result<()> {
    let json_data = serde_json::to_vec(data)?;
    send_response(
        status,
        Some(std::collections::HashMap::from([(
            String::from("Content-Type"),
            String::from("application/json"),
        )])),
        json_data,
    );
    Ok(())
}

/// Helper functions for ERC-4337 UserOperation dynamic building
/// These functions extract the logic from test-dynamic-fetch for reuse in other commands

/// Fetch the current nonce for a sender from the EntryPoint contract
pub fn fetch_dynamic_nonce(
    provider: &Provider,
    sender: &str,
    entry_point: &str,
) -> Result<String> {
    use alloy_sol_types::*;
    sol! {
        function getNonce(address sender, uint192 key) external view returns (uint256 nonce);
    }
    
    let get_nonce_call = getNonceCall {
        sender: EthAddress::from_str(sender).map_err(|e| anyhow!("Invalid sender address: {}", e))?,
        key: alloy_primitives::U256::ZERO.to::<alloy_primitives::Uint<192, 3>>(), // Nonce key 0
    };
    
    let nonce_call_data = get_nonce_call.abi_encode();
    let nonce_tx_req = TransactionRequest::default()
        .input(TransactionInput::new(nonce_call_data.into()))
        .to(EthAddress::from_str(entry_point).map_err(|e| anyhow!("Invalid entry point address: {}", e))?);
    
    match provider.call(nonce_tx_req, None) {
        Ok(bytes) => {
            let decoded = U256::from_be_slice(&bytes);
            info!("Dynamic nonce fetched: {}", decoded);
            Ok(format!("0x{:x}", decoded))
        }
        Err(e) => {
            error!("❌ Failed to fetch nonce: {}", e);
            info!("Using fallback nonce: 0x1");
            Ok("0x1".to_string())
        }
    }
}

/// Fetch current gas prices from the latest block
pub fn fetch_dynamic_gas_prices(provider: &Provider) -> Result<(u128, u128)> {
    info!("Fetching dynamic gas prices");
    match provider.get_block_by_number(BlockNumberOrTag::Latest, false) {
        Ok(Some(block)) => {
            let base_fee = block.header.inner.base_fee_per_gas.unwrap_or(1_000_000_000) as u128;
            let base_fee_gwei = base_fee as f64 / 1_000_000_000.0;
            info!("Current base fee: {} wei ({:.2} gwei)", base_fee, base_fee_gwei);
            
            // Calculate dynamic gas prices based on current network conditions
            let max_fee = base_fee + (base_fee / 3); // Add 33% buffer
            let priority_fee = std::cmp::max(100_000_000u128, base_fee / 10); // At least 0.1 gwei
            
            let max_fee_gwei = max_fee as f64 / 1_000_000_000.0;
            let priority_fee_gwei = priority_fee as f64 / 1_000_000_000.0;
            info!("Calculated max fee: {} wei ({:.2} gwei)", max_fee, max_fee_gwei);
            info!("Calculated priority fee: {} wei ({:.2} gwei)", priority_fee, priority_fee_gwei);
            
            Ok((max_fee, priority_fee))
        }
        Ok(None) => {
            error!("❌ No latest block found");
            info!("Using fallback gas prices");
            Ok((3_000_000_000u128, 2_000_000_000u128))
        }
        Err(e) => {
            error!("❌ Failed to fetch block: {}", e);
            info!("Using fallback gas prices");
            Ok((3_000_000_000u128, 2_000_000_000u128))
        }
    }
}

/// Build USDC transfer calldata with TBA execute wrapper
pub fn build_usdc_transfer_calldata(
    usdc_contract: &str,
    recipient: &str,
    amount_units: u128,
) -> Result<Vec<u8>> {
    use alloy_sol_types::sol;
    
    // Build the USDC transfer calldata
    sol! {
        function transfer(address to, uint256 amount) external returns (bool);
    }
    
    let transfer_call = transferCall {
        to: EthAddress::from_str(recipient).map_err(|e| anyhow!("Invalid recipient address: {}", e))?,
        amount: U256::from(amount_units),
    };
    let transfer_data = transfer_call.abi_encode();
    
    // Build TBA execute calldata
    sol! {
        function execute(address to, uint256 value, bytes calldata data, uint8 operation) external payable returns (bytes memory result);
    }
    
    let execute_call = executeCall {
        to: EthAddress::from_str(usdc_contract).map_err(|e| anyhow!("Invalid USDC contract address: {}", e))?,
        value: U256::ZERO,
        data: AlloyBytes::from(transfer_data),
        operation: 0u8,
    };
    let execute_data = execute_call.abi_encode();
    
    info!("Built calldata: 0x{}", hex::encode(&execute_data));
    Ok(execute_data)
}

/// Estimate gas for a UserOperation via bundler API
pub fn estimate_userop_gas(
    user_op: &serde_json::Value,
    entry_point: &str,
    bundler_url: &str,
) -> Result<Option<serde_json::Value>> {
    use hyperware_process_lib::http::client::send_request_await_response;
    use hyperware_process_lib::http::Method;
    
    let gas_estimate_request = serde_json::json!({
        "jsonrpc": "2.0",
        "method": "eth_estimateUserOperationGas",
        "params": [user_op, entry_point],
        "id": 1
    });

    info!("Gas estimation request: {}", serde_json::to_string_pretty(&gas_estimate_request).unwrap());
    
    let url = url::Url::parse(bundler_url).map_err(|e| anyhow!("Invalid bundler URL: {}", e))?;
    let mut headers = std::collections::HashMap::new();
    headers.insert("Content-Type".to_string(), "application/json".to_string());
    
    match send_request_await_response(
        Method::POST,
        url,
        Some(headers),
        30000,
        serde_json::to_vec(&gas_estimate_request).map_err(|e| anyhow!("JSON serialization error: {}", e))?,
    ) {
        Ok(response) => {
            let response_str = String::from_utf8_lossy(&response.body());
            info!("Gas estimation response: {}", response_str);
            
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&response_str) {
                if let Some(result) = json.get("result") {
                    info!("Gas estimates received:");
                    if let Some(call_gas_est) = result.get("callGasLimit") {
                        info!("  - Call gas limit: {}", call_gas_est);
                    }
                    if let Some(verif_gas_est) = result.get("verificationGasLimit") {
                        info!("  - Verification gas limit: {}", verif_gas_est);
                    }
                    if let Some(preverif_gas_est) = result.get("preVerificationGas") {
                        info!("  - Pre-verification gas: {}", preverif_gas_est);
                    }
                    Ok(Some(result.clone()))
                } else if let Some(error) = json.get("error") {
                    error!("❌ Gas estimation error: {}", serde_json::to_string_pretty(error).unwrap());
                    
                    // Analyze AA33 errors specifically  
                    Ok(None)
                } else {
                    error!("❌ Unexpected gas estimation response format");
                    Ok(None)
                }
            } else {
                error!("❌ Failed to parse gas estimation response");
                Ok(None)
            }
        }
        Err(e) => {
            error!("❌ Gas estimation request failed: {}", e);
            Ok(None)
        }
    }
}

/// Calculate UserOperation hash using EntryPoint.getUserOpHash()
pub fn calculate_userop_hash(
    provider: &Provider,
    entry_point: &str,
    sender: &str,
    nonce: &str,
    call_data: &[u8],
    final_call_gas: u64,
    final_verif_gas: u64,
    final_preverif_gas: u64,
    dynamic_max_fee: u128,
    dynamic_priority_fee: u128,
    paymaster_data: &[u8],
) -> Result<Vec<u8>> {
    use alloy_sol_types::sol;
    
    // Pack gas values for v0.8 EntryPoint hash calculation
    let account_gas_limits: U256 = (U256::from(final_verif_gas) << 128) | U256::from(final_call_gas);
    let gas_fees: U256 = (U256::from(dynamic_priority_fee) << 128) | U256::from(dynamic_max_fee);
    
    sol! {
        struct PackedUserOperation {
            address sender;
            uint256 nonce;
            bytes initCode;
            bytes callData;
            bytes32 accountGasLimits;
            uint256 preVerificationGas;
            bytes32 gasFees;
            bytes paymasterAndData;
            bytes signature;
        }
        
        function getUserOpHash(PackedUserOperation userOp) external view returns (bytes32);
    }
    
    let packed_user_op = PackedUserOperation {
        sender: EthAddress::from_str(sender).map_err(|e| anyhow!("Invalid sender address: {}", e))?,
        nonce: alloy_primitives::U256::from_str_radix(nonce.trim_start_matches("0x"), 16)
            .map_err(|e| anyhow!("Invalid nonce format: {}", e))?,
        initCode: AlloyBytes::new(),
        callData: AlloyBytes::from(call_data.to_vec()),
        accountGasLimits: alloy_primitives::FixedBytes::from_slice(&account_gas_limits.to_be_bytes::<32>()),
        preVerificationGas: alloy_primitives::U256::from(final_preverif_gas),
        gasFees: alloy_primitives::FixedBytes::from_slice(&gas_fees.to_be_bytes::<32>()),
        paymasterAndData: AlloyBytes::from(paymaster_data.to_vec()),
        signature: AlloyBytes::new(),
    };
    
    let get_hash_call = getUserOpHashCall {
        userOp: packed_user_op,
    };
    
    let hash_call_data = get_hash_call.abi_encode();
    let hash_tx_req = TransactionRequest::default()
        .input(TransactionInput::new(hash_call_data.into()))
        .to(EthAddress::from_str(entry_point).map_err(|e| anyhow!("Invalid entry point address: {}", e))?);
    
    match provider.call(hash_tx_req, None) {
        Ok(bytes) => {
            let hash = if bytes.len() == 32 {
                bytes.to_vec()
            } else {
                match getUserOpHashCall::abi_decode_returns(&bytes, false) {
                    Ok(decoded_hash) => decoded_hash._0.to_vec(),
                    Err(_) => bytes.to_vec()
                }
            };
            info!("UserOp hash calculated: 0x{}", hex::encode(&hash));
            Ok(hash)
        }
        Err(e) => {
            Err(anyhow!("Failed to calculate UserOp hash: {}", e))
        }
    }
}

/// Sign a UserOperation hash
pub fn sign_userop_hash(user_op_hash: &[u8], private_key: &str, chain_id: u64) -> Result<String> {
    use hyperware_process_lib::signer::LocalSigner;
    
    let signer = LocalSigner::from_private_key(private_key, chain_id)
        .map_err(|e| anyhow!("Failed to create signer: {}", e))?;
    
    match signer.sign_hash(user_op_hash) {
        Ok(sig) => {
            info!("UserOperation signed successfully");
            Ok(hex::encode(&sig))
        }
        Err(e) => {
            Err(anyhow!("Failed to sign UserOperation: {}", e))
        }
    }
}

/// Build the final UserOperation JSON for submission
pub fn build_final_userop_json(
    sender: &str,
    nonce: &str,
    call_data_hex: &str,
    final_call_gas: u64,
    final_verif_gas: u64,
    final_preverif_gas: u64,
    dynamic_max_fee: u128,
    dynamic_priority_fee: u128,
    signature: &str,
    use_paymaster: bool,
) -> serde_json::Value {
    serde_json::json!({
        "sender": sender,
        "nonce": nonce,
        "callData": format!("0x{}", call_data_hex),
        "callGasLimit": format!("0x{:x}", final_call_gas),
        "verificationGasLimit": format!("0x{:x}", final_verif_gas),
        "preVerificationGas": format!("0x{:x}", final_preverif_gas),
        "maxFeePerGas": format!("0x{:x}", dynamic_max_fee),
        "maxPriorityFeePerGas": format!("0x{:x}", dynamic_priority_fee),
        "signature": format!("0x{}", signature),
        "factory": serde_json::Value::Null,
        "factoryData": serde_json::Value::Null,
        "paymaster": if use_paymaster { 
            serde_json::Value::String("0x0578cFB241215b77442a541325d6A4E6dFE700Ec".to_string()) 
        } else { 
            serde_json::Value::Null 
        },
        "paymasterVerificationGasLimit": if use_paymaster { 
            serde_json::Value::String(format!("0x{:x}", final_verif_gas)) 
        } else { 
            serde_json::Value::Null 
        },
        "paymasterPostOpGasLimit": if use_paymaster { 
            serde_json::Value::String(format!("0x{:x}", final_call_gas)) 
        } else { 
            serde_json::Value::Null 
        },
        "paymasterData": if use_paymaster { 
            serde_json::Value::String("0x000000000000000000000000000000000000000000000000000000000007a12000000000000000000000000000000000000000000000000000000000000493e0".to_string()) 
        } else { 
            serde_json::Value::Null 
        }
    })
}

/// Build final UserOperation JSON with custom paymaster data (v0.8 format)
pub fn build_final_userop_json_with_data(
    sender: &str,
    nonce: &str,
    call_data_hex: &str,
    final_call_gas: u64,
    final_verif_gas: u64,
    final_preverif_gas: u64,
    dynamic_max_fee: u128,
    dynamic_priority_fee: u128,
    signature: &str,
    paymaster_data: &[u8],
) -> serde_json::Value {
    // For Circle paymaster, always include the paymaster address and gas limits
    // Based on working example: verification gas = 500000, post-op gas = 300000
    let paymaster_val = serde_json::json!("0x0578cFB241215b77442a541325d6A4E6dFE700Ec");
    let paymaster_data_val = if paymaster_data.is_empty() {
        serde_json::json!("0x")
    } else {
        serde_json::json!(format!("0x{}", hex::encode(paymaster_data)))
    };
    
    serde_json::json!({
        "sender": sender,
        "nonce": nonce,
        "callData": format!("0x{}", call_data_hex),
        "callGasLimit": format!("0x{:x}", final_call_gas),
        "verificationGasLimit": format!("0x{:x}", final_verif_gas),
        "preVerificationGas": format!("0x{:x}", final_preverif_gas),
        "maxFeePerGas": format!("0x{:x}", dynamic_max_fee),
        "maxPriorityFeePerGas": format!("0x{:x}", dynamic_priority_fee),
        "signature": format!("0x{}", signature),
        "factory": serde_json::Value::Null,
        "factoryData": serde_json::Value::Null,
        "paymaster": paymaster_val,
        "paymasterVerificationGasLimit": serde_json::json!("0x7a120"), // 500000 - from working example
        "paymasterPostOpGasLimit": serde_json::json!("0x493e0"), // 300000 - from working example
        "paymasterData": paymaster_data_val
    })
}

/// Build a UserOperation for gas estimation with proper format
pub fn build_estimation_userop_json(
    sender: &str,
    nonce: &str,
    call_data_hex: &str,
    call_gas: u128,
    verification_gas: u128,
    pre_verification_gas: u64,
    dynamic_max_fee: u128,
    dynamic_priority_fee: u128,
    use_paymaster: bool,
) -> serde_json::Value {
    if use_paymaster {
        serde_json::json!({
            "sender": sender,
            "nonce": nonce,
            "callData": format!("0x{}", call_data_hex),
            "callGasLimit": format!("0x{:x}", call_gas),
            "verificationGasLimit": format!("0x{:x}", verification_gas),
            "preVerificationGas": format!("0x{:x}", pre_verification_gas),
            "maxFeePerGas": format!("0x{:x}", dynamic_max_fee),
            "maxPriorityFeePerGas": format!("0x{:x}", dynamic_priority_fee),
            "signature": "0x6631d932a459f079222e400c20f3cf05a4c0fe30ed22fcc311a5a22a37db61845ee7a42db22925e69e43e458b51b3c5cdd95e15ee9b90a15cf3ab520633c4c5b1b", // Dummy but valid signature for estimation
            "factory": serde_json::Value::Null,
            "factoryData": serde_json::Value::Null,
            "paymaster": "0x0578cFB241215b77442a541325d6A4E6dFE700Ec",
            "paymasterVerificationGasLimit": format!("0x{:x}", verification_gas),
            "paymasterPostOpGasLimit": format!("0x{:x}", call_gas),
            "paymasterData": "0x000000000000000000000000000000000000000000000000000000000007a12000000000000000000000000000000000000000000000000000000000000493e0"
        })
    } else {
        serde_json::json!({
            "sender": sender,
            "nonce": nonce,
            "callData": format!("0x{}", call_data_hex),
            "callGasLimit": format!("0x{:x}", call_gas),
            "verificationGasLimit": format!("0x{:x}", verification_gas),
            "preVerificationGas": format!("0x{:x}", pre_verification_gas),
            "maxFeePerGas": format!("0x{:x}", dynamic_max_fee),
            "maxPriorityFeePerGas": format!("0x{:x}", dynamic_priority_fee),
            "signature": "0x6631d932a459f079222e400c20f3cf05a4c0fe30ed22fcc311a5a22a37db61845ee7a42db22925e69e43e458b51b3c5cdd95e15ee9b90a15cf3ab520633c4c5b1b", // Dummy but valid signature for estimation
            "factory": serde_json::Value::Null,
            "factoryData": serde_json::Value::Null,
            "paymaster": serde_json::Value::Null,
            "paymasterVerificationGasLimit": serde_json::Value::Null,
            "paymasterPostOpGasLimit": serde_json::Value::Null,
            "paymasterData": serde_json::Value::Null
        })
    }
}

/// Calculate transaction cost in wei, ETH, and USD
pub fn calculate_transaction_cost(
    final_call_gas: u64,
    final_verif_gas: u64,
    final_preverif_gas: u64,
    dynamic_max_fee: u128,
) -> (u128, f64, f64) {
    let total_gas = final_call_gas + final_verif_gas + final_preverif_gas;
    let total_cost_wei = total_gas as u128 * dynamic_max_fee;
    let total_cost_eth = total_cost_wei as f64 / 1e18;
    let total_cost_usd = total_cost_eth * 3200.0; // Approximate ETH price
    
    info!("Transaction cost analysis:");
    info!("  - Total gas units: {}", total_gas);
    info!("  - Gas price: {:.2} gwei", dynamic_max_fee as f64 / 1_000_000_000.0);
    info!("  - Total cost: {} wei (~{:.6} ETH ~${:.2})", total_cost_wei, total_cost_eth, total_cost_usd);
    
    (total_cost_wei, total_cost_eth, total_cost_usd)
}

/// Check TBA ETH balance for gas payment (when not using paymaster)
pub fn check_tba_eth_balance(
    provider: &Provider,
    sender: &str,
    total_cost_wei: u128,
    total_cost_eth: f64,
) -> Result<()> {
    info!("🔍 Checking TBA ETH balance for gas payment...");
    match provider.get_balance(EthAddress::from_str(sender).map_err(|e| anyhow!("Invalid sender address: {}", e))?, None) {
        Ok(balance) => {
            let eth_balance = balance.to::<u128>() as f64 / 1e18;
            info!("  - TBA ETH balance: {:.6} ETH", eth_balance);
            if balance.to::<u128>() < total_cost_wei {
                error!("  ⚠️  INSUFFICIENT ETH! Need {:.6} ETH but only have {:.6} ETH", total_cost_eth, eth_balance);
                error!("     This may be why gas estimation failed with AA23");
            } else {
                info!("  Sufficient ETH for gas payment");
            }
            Ok(())
        }
        Err(e) => {
            error!("  ❌ Failed to check TBA balance: {}", e);
            Err(anyhow!("Failed to check TBA balance: {}", e))
        }
    }
}

/// Get UserOperation receipt directly from bundler (for manual testing)
pub fn get_user_op_receipt_manual(
    user_op_hash: &str,
    bundler_url: &str,
) -> Result<serde_json::Value> {
    use hyperware_process_lib::http::client::send_request_await_response;
    use hyperware_process_lib::http::Method;
    
    info!("Fetching UserOperation receipt from bundler...");
    info!("  UserOp Hash: {}", user_op_hash);
    info!("  Bundler URL: {}", bundler_url);
    
    let request_body = serde_json::json!({
        "jsonrpc": "2.0",
        "method": "eth_getUserOperationReceipt",
        "params": [user_op_hash],
        "id": 1
    });
    
    info!("Request body: {}", serde_json::to_string_pretty(&request_body)?);
    
    let url = url::Url::parse(bundler_url)?;
    let mut headers = std::collections::HashMap::new();
    headers.insert("Content-Type".to_string(), "application/json".to_string());
    
    match send_request_await_response(
        Method::POST,
        url,
        Some(headers),
        30000,
        serde_json::to_vec(&request_body)?,
    ) {
        Ok(response) => {
            let response_str = String::from_utf8_lossy(&response.body());
            info!("Raw bundler response: {}", response_str);
            
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&response_str) {
                if let Some(result) = json.get("result") {
                    if result.is_null() {
                        info!("⚠️  Receipt not yet available (result is null)");
                        info!("   This is normal if the UserOp was just submitted");
                        info!("   Try again in a few seconds");
                        return Ok(serde_json::json!({"status": "pending", "message": "Receipt not yet available"}));
                    } else {
                        info!("✅ Receipt found!");
                        return Ok(result.clone());
                    }
                } else if let Some(error) = json.get("error") {
                    error!("❌ Bundler error: {}", serde_json::to_string_pretty(error)?);
                    return Err(anyhow!("Bundler error: {}", error));
                } else {
                    error!("❌ Unexpected response format");
                    return Err(anyhow!("Unexpected response format: {}", response_str));
                }
            } else {
                error!("❌ Failed to parse JSON response");
                return Err(anyhow!("Failed to parse JSON: {}", response_str));
            }
        }
        Err(e) => {
            error!("❌ Network error: {}", e);
            return Err(anyhow!("Network error: {}", e));
        }
    }
}

/// Extract gas values from bundler estimation result
pub fn extract_gas_values_from_estimate(
    estimates: Option<serde_json::Value>,
    default_call_gas: u128,
    default_verification_gas: u128,
    default_pre_verification_gas: u64,
) -> (u64, u64, u64) {
    if let Some(estimates) = estimates {
        let estimated_call_gas = estimates.get("callGasLimit")
            .and_then(|v| v.as_str())
            .and_then(|s| u64::from_str_radix(s.trim_start_matches("0x"), 16).ok())
            .unwrap_or(default_call_gas as u64);
        let estimated_verif_gas = estimates.get("verificationGasLimit")
            .and_then(|v| v.as_str())
            .and_then(|s| u64::from_str_radix(s.trim_start_matches("0x"), 16).ok())
            .unwrap_or(default_verification_gas as u64);
        let estimated_preverif_gas = estimates.get("preVerificationGas")
            .and_then(|v| v.as_str())
            .and_then(|s| u64::from_str_radix(s.trim_start_matches("0x"), 16).ok())
            .unwrap_or(default_pre_verification_gas);
        
        info!("Using estimated gas values:");
        info!("  - Call gas: {} (estimated) vs {} (default)", estimated_call_gas, default_call_gas);
        info!("  - Verification gas: {} (estimated) vs {} (default)", estimated_verif_gas, default_verification_gas);
        info!("  - Pre-verification gas: {} (estimated) vs {} (default)", estimated_preverif_gas, default_pre_verification_gas);
        
        (estimated_call_gas, estimated_verif_gas, estimated_preverif_gas)
    } else {
        info!("⚠️  Using default gas values due to estimation failure");
        (default_call_gas as u64, default_verification_gas as u64, default_pre_verification_gas)
    }
}


/////////////////////////////
// for debugging purposes //
pub fn handle_terminal_debug(
    our: &HyperAddress,
    body: &[u8],
    state: &mut State,
    db: &Sqlite, 
) -> anyhow::Result<()> {
    let bod = String::from_utf8(body.to_vec())?;
    let command_parts: Vec<&str> = bod.splitn(2, ' ').collect();
    let command_verb = command_parts[0];
    let command_arg = command_parts.get(1).copied();

    match command_verb {
        "help" | "?" => {
            info!("--- Hypergrid Operator Debug Commands ---");
            info!("help or ?      : Show this help message.");
            info!("state          : Print current in-memory state.");
            info!("db             : Check local DB schema.");
            info!("reset          : Reset state and wipe/reinit DB (requires restart).");
            info!("resync-db      : Wipes and reinitializes the local DB, resets chain state (requires restart for full effect).");
            info!("verify         : Check on-chain delegation for selected hot wallet.");
            info!("namehash <path>: Calculate Hypermap namehash (e.g., namehash ~note.entry.hypr).");
            info!("pay <amount>   : Attempt test USDC payment from Operator TBA to test address.");
            info!("pay-eth <amount>: Attempt test ETH payment from Operator TBA to test address.");
            info!("check-prereqs  : Run a series of checks for Hypergrid operator setup.");
            info!("graph-test     : Trigger graph generation logic and log output.");
            info!("get-tba <node> : Query Hypermap for TBA of a given node.");
            info!("get-owner <node>: Query Hypermap for owner of a given node.");
            info!("query-provider <name>: Query the local DB for a provider by its exact name.");
            info!("list-providers : List all providers in the database.");
            info!("search-providers <query>: Search providers by name, provider_name, site, description, or provider_id.");
            info!("db-stats       : Show database statistics and the current root hash status.");
            info!("check-provider-id <provider_id>: Check for provider by provider_id.");
            info!("check-grid-root: Check the grid-beta.hypr entry status.");
            info!("\n--- ERC-4337 / Account Abstraction Commands ---");
            info!("check-aa       : Run ERC-4337 sanity checks (implementation, balances, approvals).");
            info!("approve-paymaster: Approve Circle paymaster to spend USDC from TBA.");
            info!("test-gasless <amount>: Test a gasless USDC transfer.");
            info!("test-paymaster-format <format>: Test different paymaster data formats.");
            info!("test-permit    : Generate EIP-2612 permit signature components.");
            info!("test-permit-data: Test full EIP-2612 permit paymaster data format.");
            info!("test-candide-gas-estimate <amount>: Test gas estimation with Candide bundler API.");
            info!("get-receipt <hash>: Get UserOperation receipt from bundler manually.");
            info!("decode-aa-error <hex>: Decode AA error codes and paymaster errors.");
            info!("decode-paymaster-error <code>: Decode common paymaster error codes.");
            info!("-----------------------------------");
        }
        "state" => {
            info!("Hypergrid operator merged state\n{:#?}", state);
        }
        "db" => {
            let db_up = db::check_schema(db);
            info!("Hypergrid operator merged db schema ok: {}", db_up);
        }
        "reset" => {
            info!("Performing reset...");
            let nstate = State::new(); 
            *state = nstate; 
            info!("State reset in memory. Wiping DB...");
            if let Err(e) = db::wipe_db(our) {
                error!("Error wiping DB: {:?}", e);
            } else {
                info!("DB wiped. Reinitializing schema...");
                 match db::load_db(our) {
                    Ok(_new_db) => {
                        // TODO: Need to update the db handle used by the main loop.
                        // This requires more complex state management (e.g., Arc<Mutex>) 
                        // or restarting the process. For now, log this limitation.
                        error!("DB reloaded, but process needs restart for changes to take effect.");
                        // Re-start chain fetch with potentially new (but inaccessible) db?
                        // let new_pending = chain::start_fetch(state, &new_db);
                        // Can't easily update pending_logs here either.
                        info!("Reset partially complete (State reset, DB wiped/recreated). Restart recommended.");
                    }
                    Err(e) => {
                        error!("Failed to reload DB after reset: {:?}", e);
                        // state.db = None; // Cannot modify db field here
                        info!("Reset complete, but DB failed to load.");
                    }
                }
            }
        }
        "resync-db" => {
            info!("--- Starting Database Resynchronization ---");
            info!("Wiping database...");
            if let Err(e) = db::wipe_db(our) {
                error!("Error wiping DB: {:?}. Aborting resync.", e);
                return Ok(());
            }
            info!("Database wiped. Re-initializing schema...");
            match db::load_db(our) {
                Ok(_new_db) => {
                    info!("New database schema initialized successfully.");
                    // new_db is local and doesn't replace the one in lib.rs main loop
                    // The main effect here is that the DB files are recreated cleanly.
                }
                Err(e) => {
                    error!("Failed to re-initialize DB schema: {:?}. State will be reset, but DB might be inconsistent until restart.", e);
                }
            }

            info!("Resetting chain-specific state variables...");
            state.names.clear();
            state.names.insert(String::new(), hypermap::HYPERMAP_ROOT_HASH.to_string());
            state.last_checkpoint_block = structs::HYPERMAP_FIRST_BLOCK;
            state.logging_started = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs();
            state.providers_cache.clear();

            state.save();
            info!("Chain-specific state reset and database re-initialized.");
            info!("--- Database Resynchronization Complete --- ");
            error!("RECOMMENDATION: Restart the operator process now to ensure the new database is used and a full chain resync begins.");
        }
        "verify" => {
            info!("Running hot wallet delegation verification (detailed)...");
            match service::verify_selected_hot_wallet_delegation_detailed(state, None) {
                DelegationStatus::Verified => {
                    info!("Verification SUCCESS: Selected hot wallet IS delegated.");
                }
                status => {
                    error!("Verification FAILED: {:?}", status);
                }
            }
        }
        "namehash" => {
            if let Some(name_to_hash) = command_arg {
                let hash = hypermap::namehash(name_to_hash);
                info!("Namehash for '{}': {}", name_to_hash, hash);
            } else {
                error!("Usage: namehash <full.path.name>");
            }
        }
        "pay-eth" => {
            if let Some(amount_str) = command_arg {
                info!("Attempting test ETH payment via hyperwallet: {} ETH", amount_str);
                
                let target_address_str = "0x62DFaDaBFd0b036c1C616aDa273856c514e65819"; // Test address
                
                // Get operator TBA address
                let operator_tba_addr_str = match &state.operator_tba_address {
                    Some(addr) => addr.clone(),
                    None => { 
                        error!("Operator TBA address not configured");
                        return Ok(()); 
                    }
                };
                
                //// Check if we have an active wallet
                //if state.selected_wallet_id.is_none() {
                //    error!("No wallet selected");
                //    return Ok(());
                //}
                
                // Parse amount string to f64, then to U256 wei
                let amount_eth_f64 = match amount_str.parse::<f64>() {
                    Ok(f) if f > 0.0 => f,
                    _ => { 
                        error!("Invalid ETH amount: {}", amount_str);
                        return Ok(()); 
                    }
                };
                let wei_value = EthAmount::from_eth(amount_eth_f64).as_wei();

                info!("Sending ETH via hyperwallet: {} ETH ({} wei) from Operator TBA {} to {}", 
                    amount_eth_f64, wei_value, operator_tba_addr_str, target_address_str);

                // Use hyperwallet to handle the ETH transfer
                match crate::wallet::payments::handle_operator_tba_withdrawal(
                    state,
                    crate::wallet::payments::AssetType::Eth,
                    target_address_str.to_string(),
                    wei_value.to_string(),
                ) {
                    Ok(_) => {
                        info!("ETH payment initiated successfully via hyperwallet");
                    }
                    Err(e) => {
                        error!("ETH payment failed: {}", e);
                    }
                }
            } else {
                 error!("Usage: pay-eth <amount_eth>");
            }
        }
        "check-prereqs" => {
            info!("--- Running Hypergrid Operator Prerequisite Check ---");
            let mut all_ok = true;

            // P1 & P2: Base Node and Sub-Entry Existence
            let base_node_name = our.node.clone();
            let sub_entry_name = format!("grid-beta-wallet-aa-final.{}", base_node_name);
            info!("[1/2] Checking base node '{}' and sub-entry '{}' existence...", base_node_name, sub_entry_name);
            let provider = eth::Provider::new(structs::CHAIN_ID, 30000);
            let hypermap_addr = EthAddress::from_str(hypermap::HYPERMAP_ADDRESS).expect("Bad Hypermap Addr");
            let hypermap_reader = hypermap::Hypermap::new(provider.clone(), hypermap_addr);
            let sub_entry_check = hypermap_reader.get(&sub_entry_name);
            match sub_entry_check {
                Ok((tba, owner, Some(data))) => {
                    let entry_name = sub_entry_name.clone();
                    info!("  -> Sub-entry '{}' FOUND. TBA: {}", entry_name, tba);

                    // P3: Correct Implementation
                    info!("[3] Checking sub-entry implementation...");
                    let old_impl_str = "0x000000000046886061414588bb9F63b6C53D8674";
                    //let new_impl_str = "0x19b89306e31D07426E886E3370E62555A0743D96";
                    let new_impl_str = "0x3950D18044D7DAA56BFd6740fE05B42C95201535";
                    match chain::get_implementation_address(&provider, tba) {
                        Ok(impl_addr) => {
                            let impl_str = impl_addr.to_string();
                            let impl_str_lower = impl_str.to_lowercase();
                            
                            if impl_str_lower == old_impl_str.to_lowercase() {
                                info!("Sub-entry uses OLD implementation - works but no gasless support");
                            } else if impl_str_lower == new_impl_str.to_lowercase() {
                                info!("Sub-entry uses NEW implementation - gasless transactions supported!");
                            } else {
                                error!("❌ Sub-entry uses UNSUPPORTED implementation: {}", impl_str);
                                error!("   Supported implementations:");
                                error!("   - {} (old - works but no gasless)", old_impl_str);
                                error!("   - {} (new - supports gasless)", new_impl_str);
                                all_ok = false;
                            }
                        }
                        Err(e) => {
                            error!("❌ Failed to get implementation address: {:?}", e);
                            all_ok = false;
                        }
                    }

                    // P6: Sub-Entry TBA Funding (Basic Check: ETH > 0)
                    info!("[6] Checking sub-entry TBA ETH balance...");
                     match get_eth_balance(&tba.to_string(), structs::CHAIN_ID, provider.clone()) {
                         Ok(balance) => {
                             if balance.as_wei() > U256::ZERO {
                                 info!("  -> ETH Balance OK: {}", balance.to_display_string());
                             } else {
                                 error!("  -> ETH Balance is ZERO for TBA {}", tba);
                                 all_ok = false;
                             }
                         }
                         Err(e) => {
                             error!("  -> FAILED to get ETH balance for TBA {}: {:?}", tba, e);
                             all_ok = false;
                         }
                     }
                     // TODO: Add USDC balance check similarly if needed

                }
                Ok((tba, owner, None)) => {
                    // Sub-entry exists but has no data
                    info!("  -> Sub-entry '{}' FOUND but has no data. TBA: {}", sub_entry_name, tba);
                    all_ok = false;
                }
                Err(e) => {
                    error!("  -> Sub-entry '{}' NOT FOUND or read error: {:?}", sub_entry_name, e);
                    all_ok = false;
                }
            }

            // P4/P5/P6: Delegation Notes & Hot Wallet Match
            info!("[4/5/6] Checking delegation notes for '{}' and selected hot wallet...", sub_entry_name);
            match service::verify_selected_hot_wallet_delegation_detailed(state, None) {
                 DelegationStatus::Verified => {
                     info!("  -> Delegation check PASSED for selected hot wallet.");
                 }
                 status => {
                     error!("  -> Delegation check FAILED: {:?}", status);
                     all_ok = false;
                 }
             }

            // P7: Client Hot Wallet Ready
            info!("[7] Checking client hot wallet status...");
            if state.selected_wallet_id.is_some() && state.active_signer_cache.is_some() {
                info!("  -> Hot wallet '{}' is selected and unlocked.", state.selected_wallet_id.as_deref().unwrap_or("N/A"));
            } else if state.selected_wallet_id.is_some() {
                error!("  -> Hot wallet '{}' is selected but LOCKED.", state.selected_wallet_id.as_deref().unwrap_or("N/A"));
                all_ok = false;
            } else {
                 error!("  -> No hot wallet is selected.");
                 all_ok = false;
            }

            info!("--- Prerequisite Check {} ---", if all_ok { "PASSED" } else { "FAILED" });
        }
        "graph-test" => {
            info!("--- Running Graph Generation Test ---");
            match crate::graph::build_hypergrid_graph_data(our, state) {
                Ok(graph_data) => {
                    info!("Successfully built graph data:");
                    info!("{:#?}", graph_data);
                }
                Err(e) => error!("Error building graph data: {:?}", e),
            }
            info!("--- Graph Generation Test Complete ---");
        }
        "get-tba" => {
            if let Some(node_name) = command_arg {
                match debug_get_tba_for_node(node_name) {
                    Ok(result) => info!("TBA for '{}': {}", node_name, result),
                    Err(e) => error!("Error getting TBA for '{}': {}", node_name, e),
                }
            } else {
                error!("Usage: get-tba <node.name>");
            }
        }
        "get-owner" => {
            if let Some(node_name) = command_arg {
                match debug_get_owner_for_node(node_name) {
                    Ok(result) => info!("Owner for '{}': {}", node_name, result),
                    Err(e) => error!("Error getting owner for '{}': {}", node_name, e),
                }
            } else {
                error!("Usage: get-owner <node.name>");
            }
        }
        "query-provider" => {
            if let Some(provider_name) = command_arg {
                info!("Querying DB for provider with name: '{}'", provider_name);
                let query_string = "SELECT * FROM providers WHERE name = ?1;".to_string();
                let params = vec![serde_json::Value::String(provider_name.to_string())];
                match db.read(query_string, params) {
                    Ok(results) => {
                        if results.is_empty() {
                            info!("No provider found with name: '{}'", provider_name);
                        } else {
                            info!("Found provider(s) with name '{}':", provider_name);
                            for row in results {
                                // Pretty print the JSON representation of the row
                                match serde_json::to_string_pretty(&row) {
                                    Ok(json_str) => info!("{}", json_str),
                                    Err(e) => error!("Error serializing row to JSON: {:?}", e),
                                }
                            }
                        }
                    }
                    Err(e) => {
                        error!("Error querying provider by name '{}': {:?}", provider_name, e);
                    }
                }
            } else {
                error!("Usage: query-provider <provider_name>");
            }
        }
        "list-providers" => {
            info!("--- Listing All Providers in Database ---");
            info!("Current root_hash: {:?}", state.root_hash);
            
            match db::get_all(db) {
                Ok(providers) => {
                    if providers.is_empty() {
                        warn!("No providers found in database!");
                        info!("This could mean:");
                        info!("  1. The database was recently reset");
                        info!("  2. Chain sync hasn't found obfusc-grid123.hypr yet"); 
                        info!("  3. No providers have been minted under obfusc-grid123.hypr");
                    } else {
                        info!("Found {} provider(s) in database:", providers.len());
                        for (idx, provider) in providers.iter().enumerate() {
                            info!("\n=== Provider {} ===", idx + 1);
                            if let Some(name) = provider.get("name") {
                                info!("Name: {}", name);
                            }
                            if let Some(hash) = provider.get("hash") {
                                info!("Hash: {}", hash);
                            }
                            if let Some(provider_id) = provider.get("provider_id") {
                                info!("Provider ID: {}", provider_id);
                            }
                            if let Some(parent_hash) = provider.get("parent_hash") {
                                info!("Parent Hash: {}", parent_hash);
                            }
                            if let Some(price) = provider.get("price") {
                                info!("Price: {}", price);
                            }
                            if let Some(wallet) = provider.get("wallet") {
                                info!("Wallet: {}", wallet);
                            }
                            // Show first 100 chars of description if present
                            if let Some(desc) = provider.get("description") {
                                if let Some(desc_str) = desc.as_str() {
                                    let truncated = if desc_str.len() > 100 {
                                        format!("{}...", &desc_str[..100])
                                    } else {
                                        desc_str.to_string()
                                    };
                                    info!("Description: {}", truncated);
                                }
                            }
                        }
                    }
                }
                Err(e) => {
                    error!("Error listing all providers: {:?}", e);
                }
            }
            info!("--- End Provider List ---");
        }
        "search-providers" => {
            if let Some(search_query) = command_arg {
                info!("Searching providers for query: '{}'", search_query);
                match db::search_provider(db, search_query.to_string()) {
                    Ok(results) => {
                        if results.is_empty() {
                            info!("No providers found matching: '{}'", search_query);
                        } else {
                            info!("Found {} provider(s) matching '{}':", results.len(), search_query);
                            for (idx, provider) in results.iter().enumerate() {
                                info!("\n=== Match {} ===", idx + 1);
                                match serde_json::to_string_pretty(&provider) {
                                    Ok(json_str) => info!("{}", json_str),
                                    Err(e) => error!("Error serializing provider: {:?}", e),
                                }
                            }
                        }
                    }
                    Err(e) => {
                        error!("Error searching providers: {:?}", e);
                    }
                }
            } else {
                error!("Usage: search-providers <search_query>");
                info!("Searches in: name, site, description, provider_id");
            }
        }
        "db-stats" => {
            info!("--- Database Statistics ---");
            
            // Check if root hash is set
            match &state.root_hash {
                Some(hash) => info!("Hypergrid root (obfusc-grid123.hypr) hash: {}", hash),
                None => warn!("Hypergrid root (obfusc-grid123.hypr) NOT SET - this prevents provider indexing!"),
            }
            
            // Count providers
            let count_query = "SELECT COUNT(*) as count FROM providers".to_string();
            match db.read(count_query, vec![]) {
                Ok(rows) => {
                    if let Some(count) = rows.get(0).and_then(|row| row.get("count")).and_then(|v| v.as_i64()) {
                        info!("Total providers in DB: {}", count);
                    }
                }
                Err(e) => error!("Error counting providers: {:?}", e),
            }
            
            // Show last checkpoint block
            info!("Last checkpoint block: {}", state.last_checkpoint_block);
            
            // Count providers by parent_hash to see distribution
            let parent_count_query = r#"
                SELECT parent_hash, COUNT(*) as count 
                FROM providers 
                GROUP BY parent_hash
                ORDER BY count DESC
            "#.to_string();
            
            match db.read(parent_count_query, vec![]) {
                Ok(rows) => {
                    if !rows.is_empty() {
                        info!("\nProvider distribution by parent:");
                        for row in rows.iter().take(5) { // Show top 5
                            if let (Some(parent), Some(count)) = 
                                (row.get("parent_hash").and_then(|v| v.as_str()), 
                                 row.get("count").and_then(|v| v.as_i64())) {
                                let parent_display = if parent == state.root_hash.as_deref().unwrap_or("") {
                                    format!("{} (obfusc-grid123.hypr)", parent)
                                } else {
                                    parent.to_string()
                                };
                                info!("  Parent {}: {} providers", parent_display, count);
                            }
                        }
                    }
                }
                Err(e) => error!("Error getting parent distribution: {:?}", e),
            }
            
            // Show sample of recent providers
            let recent_query = "SELECT name, provider_id, created FROM providers ORDER BY id DESC LIMIT 5".to_string();
            match db.read(recent_query, vec![]) {
                Ok(rows) => {
                    if !rows.is_empty() {
                        info!("\nMost recent providers:");
                        for row in rows {
                            if let (Some(name), Some(provider_id)) = 
                                (row.get("name").and_then(|v| v.as_str()),
                                 row.get("provider_id").and_then(|v| v.as_str())) {
                                info!("  - {} (ID: {})", name, provider_id);
                            }
                        }
                    }
                }
                Err(e) => error!("Error getting recent providers: {:?}", e),
            }
            
            info!("--- End Database Statistics ---");
        }
        "check-provider-id" => {
            if let Some(provider_id) = command_arg {
                info!("Checking for provider with provider_id: '{}'", provider_id);
                
                // First check by provider_id field
                let query_by_id = "SELECT * FROM providers WHERE provider_id = ?1".to_string();
                let params = vec![serde_json::Value::String(provider_id.to_string())];
                
                match db.read(query_by_id, params) {
                    Ok(results) => {
                        if results.is_empty() {
                            info!("No provider found with provider_id: '{}'", provider_id);
                            
                            // Try to find similar provider_ids
                            let similar_query = "SELECT provider_id, name FROM providers WHERE provider_id LIKE ?1 OR provider_id LIKE ?2".to_string();
                            let similar_params = vec![
                                serde_json::Value::String(format!("%{}%", provider_id)),
                                serde_json::Value::String(format!("{}%", provider_id)),
                            ];
                            
                            match db.read(similar_query, similar_params) {
                                Ok(similar_results) => {
                                    if !similar_results.is_empty() {
                                        info!("\nSimilar provider_ids found:");
                                        for result in similar_results {
                                            if let (Some(id), Some(name)) = 
                                                (result.get("provider_id").and_then(|v| v.as_str()),
                                                 result.get("name").and_then(|v| v.as_str())) {
                                                info!("  - {} (name: {})", id, name);
                                            }
                                        }
                                    }
                                }
                                Err(_) => {}
                            }
                            
                            // Also check if this might be a name instead
                            info!("\nChecking if '{}' might be a provider name instead...", provider_id);
                            let name_query = "SELECT * FROM providers WHERE name = ?1".to_string();
                            let name_params = vec![serde_json::Value::String(provider_id.to_string())];
                            
                            match db.read(name_query, name_params) {
                                Ok(name_results) => {
                                    if !name_results.is_empty() {
                                        info!("Found provider with NAME '{}' (not provider_id):", provider_id);
                                        for result in name_results {
                                            match serde_json::to_string_pretty(&result) {
                                                Ok(json_str) => info!("{}", json_str),
                                                Err(e) => error!("Error serializing: {:?}", e),
                                            }
                                        }
                                    }
                                }
                                Err(_) => {}
                            }
                            
                        } else {
                            info!("Found provider with provider_id '{}':", provider_id);
                            for result in results {
                                match serde_json::to_string_pretty(&result) {
                                    Ok(json_str) => info!("{}", json_str),
                                    Err(e) => error!("Error serializing provider: {:?}", e),
                                }
                            }
                        }
                    }
                    Err(e) => {
                        error!("Error querying provider by provider_id '{}': {:?}", provider_id, e);
                    }
                }
            } else {
                error!("Usage: check-provider-id <provider_id>");
            }
        }
        "check-grid-root" => {
            info!("--- Checking obfusc-grid123.hypr entry status ---");
            
            // Check current state
            match &state.root_hash {
                Some(hash) => {
                    info!("State root_hash is SET to: {}", hash);
                }
                None => {
                    warn!("State root_hash is NOT SET - provider indexing is disabled!");
                }
            }
            
            // Check on-chain for obfusc-grid123.hypr
            info!("\nChecking on-chain for obfusc-grid123.hypr...");
            let provider = eth::Provider::new(structs::CHAIN_ID, 30000);
            match debug_get_tba_for_node("obfusc-grid123.hypr") {
                Ok(result) => {
                    info!("On-chain lookup for obfusc-grid123.hypr: {}", result);
                    
                    // Calculate the expected hash
                    let expected_hash = hypermap::namehash("obfusc-grid123.hypr");
                    info!("Expected hash for obfusc-grid123.hypr: {}", expected_hash);
                    
                    // Check if it matches state
                    if let Some(state_hash) = &state.root_hash {
                        if *state_hash == expected_hash {
                            info!("✓ State root_hash matches expected hash");
                        } else {
                            error!("✗ State root_hash ({}) does NOT match expected hash ({})", state_hash, expected_hash);
                        }
                    }
                }
                Err(e) => {
                    error!("Failed to look up obfusc-grid123.hypr on-chain: {}", e);
                }
            }
            
            // Show hypr parent hash for reference
            let hypr_hash = "0x29575a1a0473dcc0e00d7137198ed715215de7bffd92911627d5e008410a5826";
            info!("\nFor reference:");
            info!("  hypr hash (parent of grid-beta): {}", hypr_hash);
            info!("  obfusc-grid123.hypr expected hash: {}", hypermap::namehash("obfusc-grid123.hypr"));
            
            // Check if any providers are waiting
            let pending_query = "SELECT COUNT(*) as count FROM providers WHERE parent_hash != ?1".to_string();
            let params = vec![serde_json::Value::String(state.root_hash.clone().unwrap_or_default())];
            match db.read(pending_query, params) {
                Ok(rows) => {
                    if let Some(count) = rows.get(0).and_then(|row| row.get("count")).and_then(|v| v.as_i64()) {
                        if count > 0 {
                            warn!("Found {} providers with different parent_hash - these may be waiting for correct root", count);
                        }
                    }
                }
                Err(_) => {}
            }
            
            info!("--- End obfusc-grid123.hypr check ---");
        }
        "check-aa" => {
            info!("--- ERC-4337 Account Abstraction Sanity Check ---");
            
            // 1. Check TBA implementation
            let operator_tba_addr_str = match &state.operator_tba_address {
                Some(addr) => addr.clone(),
                None => { 
                    error!("❌ Operator TBA address not configured");
                    return Ok(()); 
                }
            };
            
            info!("1. Checking TBA implementation for {}", operator_tba_addr_str);
            let provider = eth::Provider::new(structs::CHAIN_ID, 30000);
            let tba_addr = match EthAddress::from_str(&operator_tba_addr_str) {
                Ok(addr) => addr,
                Err(_) => {
                    error!("❌ Invalid TBA address format");
                    return Ok(());
                }
            };
            
            match chain::get_implementation_address(&provider, tba_addr) {
                Ok(impl_addr) => {
                    let impl_str = impl_addr.to_string();
                    let old_impl = "0x000000000046886061414588bb9F63b6C53D8674";
                    //let new_impl = "0x19b89306e31D07426E886E3370E62555A0743D96";
                    let new_impl = "0x3950D18044D7DAA56BFd6740fE05B42C95201535";
                    
                    if impl_str.to_lowercase() == old_impl.to_lowercase() {
                        warn!("⚠️  TBA uses OLD implementation - NO gasless support");
                        info!("   To enable gasless, TBA needs to be upgraded to: {}", new_impl);
                    } else if impl_str.to_lowercase() == new_impl.to_lowercase() {
                        info!("TBA uses NEW implementation - gasless ENABLED!");
                    } else {
                        error!("❌ TBA uses UNKNOWN implementation: {}", impl_str);
                    }
                }
                Err(e) => {
                    error!("❌ Failed to get TBA implementation: {:?}", e);
                }
            }
            
            // 2. Check USDC balance
            info!("\n2. Checking USDC balance for TBA");
            let usdc_addr = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // Base USDC
            match wallet::erc20_balance_of(usdc_addr, &operator_tba_addr_str, &provider) {
                Ok(balance) => {
                    if balance > 0.0 {
                        info!("USDC Balance: {} USDC", balance);
                    } else {
                        error!("❌ USDC Balance: 0 USDC - need USDC for gasless!");
                    }
                }
                Err(e) => {
                    error!("❌ Failed to get USDC balance: {:?}", e);
                }
            }
            
            // 3. Check paymaster approval
            info!("\n3. Checking paymaster USDC approval......");
            let paymaster = "0x0578cFB241215b77442a541325d6A4E6dFE700Ec"; // Circle paymaster on Base
            match wallet::erc20_allowance(usdc_addr, &operator_tba_addr_str, paymaster, &provider) {
                Ok(allowance) => {
                    if allowance > U256::ZERO {
                        let allowance_usdc = allowance.to::<u128>() as f64 / 1_000_000.0;
                        info!("Paymaster approved for: {} USDC", allowance_usdc);
                    } else {
                        error!("❌ Paymaster NOT approved to spend USDC!");
                        info!("   Run: approve-paymaster");
                    }
                }
                Err(e) => {
                    error!("❌ Failed to check approval: {:?}", e);
                }
            }
            
            // 4. Check entry point
            info!("\n4. Checking EntryPoint contract");
            let entry_point = "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108"; // v0.8 on Base
            info!("   EntryPoint v0.8: {}", entry_point);
            info!("   Chain ID: {} (Base)", structs::CHAIN_ID);
            
            // 5. Check hyperwallet service
            info!("\n5. Checking hyperwallet service");
            info!("   Hyperwallet manages all wallet operations");
            info!("   Hot wallets are unlocked/locked via hyperwallet API");
            info!("   Use hyperwallet's /wallets endpoint to check wallet status");
            
            // 6. Check gasless configuration
            info!("\n6. Checking gasless configuration");
            match state.gasless_enabled {
                Some(true) => info!("Gasless transactions ENABLED"),
                Some(false) => warn!("⚠️  Gasless transactions DISABLED"),
                None => info!("   Gasless setting not configured (defaults to disabled)"),
            }
            
            info!("\n--- End ERC-4337 Sanity Check ---");
        }
        "test-gasless" => {
            if let Some(amount_str) = command_arg {
                info!("--- Testing Gasless USDC Transfer ---");
                
                // Fixed target address for testing
                let target = "0x3138FE02bFc273bFF633E093Bd914F58930d111c";
                
                // Parse amount to USDC units
                let amount_f64: f64 = amount_str.parse().unwrap_or(0.0);
                info!("Sending {} USDC to {}", amount_f64, target);
                
                // Get the hot wallet ID from hyperwallet
                // For testing, we'll use a dummy wallet ID since hyperwallet manages it
                let test_wallet_id = "operator-wallet"; // This is what hyperwallet typically uses
                
                // Force gasless mode for testing
                let saved_gasless = state.gasless_enabled;
                state.gasless_enabled = Some(true);
                
                // Use the same function that the operator uses for real payments
                match crate::wallet::payments::execute_payment_if_needed(
                    state,
                    target,
                    &amount_f64.to_string(),
                    "test_provider".to_string(),
                    test_wallet_id,
                ) {
                    Some(result) => {
                        match result {
                            crate::structs::PaymentAttemptResult::Success { tx_hash, amount_paid, currency } => {
                                info!(" Gasless transfer successful!");
                                info!("   Transaction/UserOp hash: {}", tx_hash);
                                info!("   Amount: {} {}", amount_paid, currency);
                            }
                            crate::structs::PaymentAttemptResult::Failed { error, amount_attempted, currency } => {
                                error!("❌ Gasless transfer failed: {}", error);
                                info!("   Attempted: {} {}", amount_attempted, currency);
                            }
                            crate::structs::PaymentAttemptResult::Skipped { reason } => {
                                info!("⏭️  Transfer skipped: {}", reason);
                            }
                            crate::structs::PaymentAttemptResult::LimitExceeded { limit, amount_attempted, currency } => {
                                error!("❌ Transfer limit exceeded!");
                                info!("   Limit: {}", limit);
                                info!("   Attempted: {} {}", amount_attempted, currency);
                            }
                        }
                    }
                    None => {
                        error!("❌ No payment result returned");
                    }
                }
                
                // Restore gasless setting
                state.gasless_enabled = saved_gasless;
                
                info!("--- End Gasless Test ---");
            } else {
                error!("Usage: test-gasless <amount>");
                info!("Example: test-gasless 0.05");
            }
        }
        "test-submit-userop" => {
            // this one works with, but the gas estimation is not working. so if we get lucky with the gas estimation it goes through
            if let Some(command_args) = command_arg {
                info!("--- Submit UserOperation Test (ACTUAL SUBMISSION) ---");
                
                let args: Vec<&str> = command_args.split_whitespace().collect();
                if args.len() < 1 {
                    error!("Usage: test-submit-userop <amount>");
                    info!("Example: test-submit-userop 0.01");
                    info!("⚠️  WARNING: This ACTUALLY SUBMITS the UserOp to the bundler!");
                    return Ok(());
                }
                
                // Parse amount
                let amount_usdc = match args[0].parse::<f64>() {
                    Ok(a) if a > 0.0 => a,
                    _ => {
                        error!("Invalid amount. Please provide a positive number.");
                        return Ok(());
                    }
                };
                
                let amount_units = (amount_usdc * 1_000_000.0) as u128;
                
                // Configuration
                let sender = "0x62DFaDaBFd0b036c1C616aDa273856c514e65819";
                let usdc_contract = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
                let recipient = "0x3138FE02bFc273bFF633E093Bd914F58930d111c";
                let entry_point = "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108";
                let private_key = "0x0988b51979846798cb05ffaa241c6f8bd5538b16344c14343f5dfb6a4dbb2e9a";
                let chain_id = 8453u64;
                let bundler_url = "https://api.candide.dev/public/v3/8453";
                
                let provider = Provider::new(chain_id, 30000);
                
                info!("🚀 SUBMITTING {} USDC transfer using Circle Paymaster", amount_usdc);
                info!("⚠️  This will ACTUALLY execute the transaction!");
                
                
                // Step 2: Fetch dynamic nonce
                info!("=== STEP 2: FETCH DYNAMIC NONCE ===");
                let nonce = match fetch_dynamic_nonce(&provider, sender, entry_point) {
                    Ok(n) => n,
                    Err(e) => {
                        error!("Failed to fetch nonce: {}", e);
                        return Ok(());
                    }
                };
                
                // Step 3: Fetch dynamic gas prices
                info!("=== STEP 3: FETCH BASE GAS PRICES FROM PROVIDER ===");
                let (dynamic_max_fee, dynamic_priority_fee) = match fetch_dynamic_gas_prices(&provider) {
                    Ok(gas_data) => gas_data,
                    Err(e) => {
                        error!("Failed to fetch gas prices: {}", e);
                        return Ok(());
                    }
                };
                
                // Step 4: Build USDC transfer calldata
                info!("=== STEP 4: BUILD USDC TRANSFER CALLDATA ===");
                let call_data = match build_usdc_transfer_calldata(usdc_contract, recipient, amount_units) {
                    Ok(data) => data,
                    Err(e) => {
                        error!("Failed to build calldata: {}", e);
                        return Ok(());
                    }
                };
                let call_data_hex = hex::encode(&call_data);
                
                // Step 5: Try multiple gas estimation strategies
                info!("=== STEP 5: SMART GAS ESTIMATION ===");
                
                // Use conservative defaults that work reliably
                let mut final_call_gas = 150_000u64;        // Higher default
                let mut final_verif_gas = 250_000u64;       // Higher default  
                let mut final_preverif_gas = 60_000u64;     // Higher default for Base L1 costs
                
                info!("Starting with conservative gas defaults:");
                info!("  - callGas: {}", final_call_gas);
                info!("  - verificationGas: {}", final_verif_gas);
                info!("  - preVerificationGas: {}", final_preverif_gas);
                
                // Strategy 1: Try estimation without paymaster first
                info!("🔄 Strategy 1: Estimate without paymaster");
                let no_paymaster_userop = build_estimation_userop_json(
                    sender,
                    &nonce,
                    &call_data_hex,
                    final_call_gas as u128,
                    final_verif_gas as u128,
                    final_preverif_gas,
                    dynamic_max_fee,
                    dynamic_priority_fee,
                    false, // No paymaster
                );
                
                if let Ok(Some(estimates)) = estimate_userop_gas(&no_paymaster_userop, entry_point, bundler_url) {
                    info!("No-paymaster estimation succeeded");
                    let (call_est, verif_est, preverif_est) = extract_gas_values_from_estimate(
                        Some(estimates),
                        final_call_gas as u128,
                        final_verif_gas as u128,
                        final_preverif_gas,
                    );
                    final_call_gas = call_est;
                    final_verif_gas = verif_est;
                    final_preverif_gas = preverif_est;
                    info!("Updated gas estimates from bundler:");
                    info!("  - callGas: {}", final_call_gas);
                    info!("  - verificationGas: {}", final_verif_gas);
                    info!("  - preVerificationGas: {}", final_preverif_gas);
                    } else {
                    info!("⚠️  No-paymaster estimation failed, using defaults");
                }
                
                // Strategy 2: Try with paymaster (optional)
                info!("🔄 Strategy 2: Try estimation with paymaster (non-blocking)");
                let paymaster_userop = build_estimation_userop_json(
                    sender,
                    &nonce,
                    &call_data_hex,
                    final_call_gas as u128,
                    final_verif_gas as u128,
                    final_preverif_gas,
                    dynamic_max_fee,
                    dynamic_priority_fee,
                    true, // With paymaster
                );
                
                if let Ok(Some(estimates)) = estimate_userop_gas(&paymaster_userop, entry_point, bundler_url) {
                    info!("Paymaster estimation also succeeded - using those values");
                    let (call_est, verif_est, preverif_est) = extract_gas_values_from_estimate(
                        Some(estimates),
                        final_call_gas as u128,
                        final_verif_gas as u128,
                        final_preverif_gas,
                    );
                    final_call_gas = call_est;
                    final_verif_gas = verif_est;
                    final_preverif_gas = preverif_est;
            } else {
                    info!("⚠️  Paymaster estimation failed, but continuing with previous estimates");
                }
                
                // Step 6: Calculate transaction cost
                info!("=== STEP 6: FINALIZE GAS VALUES ===");
                info!("Final gas values to use:");
                info!("  - callGas: {}", final_call_gas);
                info!("  - verificationGas: {}", final_verif_gas);
                info!("  - preVerificationGas: {}", final_preverif_gas);
                
                let (total_cost_wei, total_cost_eth, total_cost_usd) = calculate_transaction_cost(
                    final_call_gas,
                    final_verif_gas,
                    final_preverif_gas,
                    dynamic_max_fee,
                );
                
                // Step 8: Prepare paymaster data
                info!("=== STEP 7: PREPARE PAYMASTER DATA ===");
                // For hash calculation, we need the full paymasterAndData format:
                // paymaster address (20 bytes) + verification gas (16 bytes padded) + post-op gas (16 bytes padded)
                let mut paymaster_and_data = Vec::new();
                
                // Paymaster address
                let paymaster_addr = hex::decode("0578cFB241215b77442a541325d6A4E6dFE700Ec").unwrap();
                paymaster_and_data.extend_from_slice(&paymaster_addr);
                
                // Paymaster verification gas limit (500000 = 0x7a120) - 16 bytes padded
                let verif_gas: u128 = 500000;
                paymaster_and_data.extend_from_slice(&verif_gas.to_be_bytes());
                
                // Paymaster post-op gas limit (300000 = 0x493e0) - 16 bytes padded
                let post_op_gas: u128 = 300000;
                paymaster_and_data.extend_from_slice(&post_op_gas.to_be_bytes());
                
                info!("PaymasterAndData for hash: 0x{}", hex::encode(&paymaster_and_data));
                
                // Step 9: Calculate UserOperation hash
                info!("=== STEP 8: CALCULATE USEROPERATION HASH ===");
                let user_op_hash = match calculate_userop_hash(
                    &provider,
                    entry_point,
                    sender,
                    &nonce,
                    &call_data,
                    final_call_gas,
                    final_verif_gas,
                    final_preverif_gas,
                    dynamic_max_fee,
                    dynamic_priority_fee,
                    &paymaster_and_data,
                ) {
                    Ok(hash) => hash,
                    Err(e) => {
                        error!("Failed to calculate UserOp hash: {}", e);
                        return Ok(());
                    }
                };
                
                // Step 10: Sign UserOperation
                info!("=== STEP 9: SIGN USEROPERATION ===");
                let signature = match sign_userop_hash(&user_op_hash, private_key, chain_id) {
                    Ok(sig) => sig,
                    Err(e) => {
                        error!("Failed to sign UserOp: {}", e);
                        return Ok(());
                    }
                };
                
                // Step 11: Build final UserOperation
                info!("=== STEP 10: BUILD FINAL USEROPERATION ===");
                let final_userop = build_final_userop_json_with_data(
                    sender,
                    &nonce,
                    &call_data_hex,
                    final_call_gas,
                    final_verif_gas,
                    final_preverif_gas,
                    dynamic_max_fee,
                    dynamic_priority_fee,
                    &signature,
                    &Vec::new(), // Empty paymaster data for Candide API format
                );
                
                info!("Final UserOperation ready for submission:");
                info!("{}", serde_json::to_string_pretty(&final_userop).unwrap());
                
                // Step 11: SUBMIT TO BUNDLER WITH RETRY
                info!("=== STEP 11: 🚀 SUBMIT TO BUNDLER ===");
                
                let mut retry_call_gas = final_call_gas;
                let mut retry_verif_gas = final_verif_gas;
                let mut retry_preverif_gas = final_preverif_gas;
                
                use hyperware_process_lib::http::client::send_request_await_response;
                use hyperware_process_lib::http::Method;
                
                for attempt in 1..=3 {
                    info!("Attempt {}/3: Submitting UserOperation...", attempt);
                    info!("Gas limits: call={}, verif={}, preverif={}", retry_call_gas, retry_verif_gas, retry_preverif_gas);
                    
                    // Use the same paymaster data that was used for hash calculation
                    let retry_paymaster_data = Vec::new(); // Empty for Candide API format
                    
                    let retry_userop = build_final_userop_json_with_data(
                        sender,
                        &nonce,
                        &call_data_hex,
                        retry_call_gas,
                        retry_verif_gas,
                        retry_preverif_gas,
                        dynamic_max_fee,
                        dynamic_priority_fee,
                        &signature,
                        &retry_paymaster_data,
                    );
                    
                    let submit_request = serde_json::json!({
                    "jsonrpc": "2.0",
                    "method": "eth_sendUserOperation",
                        "params": [retry_userop, entry_point],
                        "id": attempt
                    });
                    
                    let url = url::Url::parse(bundler_url).unwrap();
                let mut headers = std::collections::HashMap::new();
                headers.insert("Content-Type".to_string(), "application/json".to_string());
                
                match send_request_await_response(
                    Method::POST,
                    url,
                    Some(headers),
                    30000,
                        serde_json::to_vec(&submit_request).unwrap(),
                ) {
                    Ok(response) => {
                        let response_str = String::from_utf8_lossy(&response.body());
                        
                        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&response_str) {
                                if let Some(result) = json.get("result") {
                                    let user_op_hash = result.as_str().unwrap_or("unknown");
                                    info!("SUCCESS! UserOperation submitted on attempt {}!", attempt);
                                    info!("🔗 UserOperation Hash: {}", user_op_hash);
                                    info!("📊 Transaction details:");
                                    info!("   - Amount: {} USDC ({} units)", amount_usdc, amount_units);
                                    info!("   - From: {}", sender);
                                    info!("   - To: {}", recipient);
                                    info!("   - Final gas: call={}, verif={}, preverif={}", retry_call_gas, retry_verif_gas, retry_preverif_gas);
                    return Ok(());
                                    
                                } else if let Some(error) = json.get("error") {
                                    let error_message = error.get("message").and_then(|m| m.as_str()).unwrap_or("Unknown error");
                                    error!("❌ Attempt {} failed: {}", attempt, error_message);
                                    
                                    if (error_message.contains("AA33") || error_message.contains("AA21")) && attempt < 3 {
                                        info!("💡 Gas/paymaster issue - increasing limits and retrying in 2 seconds...");
                                        
                                        // Increase gas limits by 25%
                                        retry_call_gas = (retry_call_gas as f64 * 1.25) as u64;
                                        retry_verif_gas = (retry_verif_gas as f64 * 1.25) as u64;
                                        retry_preverif_gas = (retry_preverif_gas as f64 * 1.25) as u64;
                                        
                                        std::thread::sleep(std::time::Duration::from_secs(2));
                } else {
                                        error!("❌ Final failure: {}", serde_json::to_string_pretty(error).unwrap());
                                        break;
                                    }
                                }
                            } else {
                                error!("❌ Failed to parse bundler response: {}", response_str);
                                break;
                        }
                    }
                    Err(e) => {
                            error!("❌ Network error on attempt {}: {}", attempt, e);
                            if attempt < 3 {
                                std::thread::sleep(std::time::Duration::from_secs(2));
                            }
                        }
                    }
                }
                
                error!("❌ All submission attempts failed");
                
                info!("=== SUBMISSION TEST COMPLETE ===");
                
                        } else {
                error!("Usage: test-submit-userop <amount>");
                info!("Example: test-submit-userop 0.01");
                info!("⚠️  WARNING: This ACTUALLY SUBMITS the UserOp to the bundler!");
            }
        }
        "test-candide-gas-estimate" => {
            if let Some(command_args) = command_arg {
                info!("--- Candide Gas Estimation Test ---");
                
                let args: Vec<&str> = command_args.split_whitespace().collect();
                if args.len() < 1 {
                    error!("Usage: test-candide-gas-estimate <amount>");
                    info!("Example: test-candide-gas-estimate 0.01");
                    return Ok(());
                }
                
                // Parse amount
                let amount_usdc = match args[0].parse::<f64>() {
                    Ok(a) if a > 0.0 => a,
                    _ => {
                        error!("Invalid amount. Please provide a positive number.");
                        return Ok(());
                    }
                };
                
                let amount_units = (amount_usdc * 1_000_000.0) as u128;
                
                // Configuration
                let sender = "0x4FdF431523D25A0306eFBC0aEF3F13fdA9CE4a2c"; // TBA for spigot-fondler.os
                let usdc_contract = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
                let recipient = "0x3138FE02bFc273bFF633E093Bd914F58930d111c";
                let entry_point = "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108";
                let chain_id = 8453u64;
                let bundler_url = "https://api.candide.dev/public/v3/8453";
                
                let provider = Provider::new(chain_id, 30000);
                
                info!("Testing gas estimation for {} USDC transfer", amount_usdc);
                info!("💡 Note: TBA signature verification requires higher gas than EOA (uses implementation contract)");
                
                // Step 1: Get current nonce
                info!("=== STEP 1: FETCH NONCE ===");
                let nonce = match fetch_dynamic_nonce(&provider, sender, entry_point) {
                    Ok(n) => n,
                    Err(e) => {
                        error!("Failed to fetch nonce: {}", e);
                        return Ok(());
                    }
                };
                
                // Step 2: Get gas prices
                info!("=== STEP 2: FETCH GAS PRICES ===");
                let (dynamic_max_fee, dynamic_priority_fee) = match fetch_dynamic_gas_prices(&provider) {
                    Ok(gas_data) => gas_data,
                    Err(e) => {
                        error!("Failed to fetch gas prices: {}", e);
                        return Ok(());
                    }
                };
                
                // Step 3: Build calldata
                info!("=== STEP 3: BUILD CALLDATA ===");
                let call_data = match build_usdc_transfer_calldata(usdc_contract, recipient, amount_units) {
                    Ok(data) => data,
                    Err(e) => {
                        error!("Failed to build calldata: {}", e);
                        return Ok(());
                    }
                };
                let call_data_hex = hex::encode(&call_data);
                
                                // Step 4: Circle paymaster gas estimation with REAL SIGNATURE
                info!("=== STEP 4: CIRCLE PAYMASTER GAS ESTIMATION ===");
                info!("Note: Using REAL delegated signer signature for accurate gas estimation");
                
                // Conservative starting values (increased verification gas for TBA signature verification)
                let base_call_gas = 300000u128;
                let base_verif_gas = 250000u128;  // Increased from 150k to 250k for TBA signature verification
                let base_preverif_gas = 100000u64;
                
                // ✅ STEP 4a: Calculate UserOperation hash for estimation
                info!("Calculating UserOp hash for gas estimation signature...");
                let estimation_paymaster_data = Vec::new(); // Empty for estimation
                let estimation_hash = match calculate_userop_hash(
                    &provider,
                    entry_point,
                        sender,
                        &nonce,
                    &call_data,
                    base_call_gas as u64,
                    base_verif_gas as u64,
                    base_preverif_gas as u64,
                        dynamic_max_fee,
                        dynamic_priority_fee,
                    &estimation_paymaster_data,
                ) {
                    Ok(hash) => hash,
                        Err(e) => {
                        error!("Failed to calculate estimation hash: {}", e);
                        return Ok(());
                    }
                };
                
                // ✅ STEP 4b: Sign with real delegated private key
                let delegated_private_key = "0x59d79441a1fe5b80d4b5c64ce1ea0871283509162517a6e5bfe412b2d709c83e";
                let real_signature = match sign_userop_hash(&estimation_hash, delegated_private_key, chain_id) {
                    Ok(sig) => sig,
                        Err(e) => {
                        error!("Failed to sign estimation hash: {}", e);
                        return Ok(());
                    }
                };
                
                info!("✅ Real signature generated for gas estimation: 0x{}", real_signature);
                
                // Circle paymaster estimation with REAL SIGNATURE
                info!("\n🧪 Circle Paymaster Gas Estimation (with real signature)");
                let circle_pm_userop = serde_json::json!({
                    "sender": sender,
                    "nonce": nonce,
                    "callData": format!("0x{}", call_data_hex),
                    "callGasLimit": format!("0x{:x}", base_call_gas),
                    "verificationGasLimit": format!("0x{:x}", base_verif_gas),
                    "preVerificationGas": format!("0x{:x}", base_preverif_gas),
                    "maxFeePerGas": format!("0x{:x}", dynamic_max_fee),
                    "maxPriorityFeePerGas": format!("0x{:x}", dynamic_priority_fee),
                    "signature": format!("0x{}", real_signature), // ✅ REAL SIGNATURE from delegated signer!
                    "factory": serde_json::Value::Null,
                    "factoryData": serde_json::Value::Null,
                    "paymaster": "0x0578cFB241215b77442a541325d6A4E6dFE700Ec",
                    "paymasterVerificationGasLimit": "0x7a120", // 500000
                    "paymasterPostOpGasLimit": "0x493e0",       // 300000
                    "paymasterData": "0x" //  EMPTY for estimation!
                });
                
                match estimate_userop_gas(&circle_pm_userop, entry_point, bundler_url) {
                    Ok(Some(estimates)) => {
                        info!("Circle paymaster estimation succeeded!");
                        info!("Results: {}", serde_json::to_string_pretty(&estimates).unwrap());
                        
                        // Show what changed
                        if let Some(new_call_gas) = estimates.get("callGasLimit").and_then(|v| v.as_str()) {
                            info!("📊 Call gas: {} -> {}", format!("0x{:x}", base_call_gas), new_call_gas);
                        }
                        if let Some(new_verif_gas) = estimates.get("verificationGasLimit").and_then(|v| v.as_str()) {
                            info!("📊 Verification gas: {} -> {}", format!("0x{:x}", base_verif_gas), new_verif_gas);
                        }
                        if let Some(new_preverif_gas) = estimates.get("preVerificationGas").and_then(|v| v.as_str()) {
                            info!("📊 Pre-verification gas: {} -> {}", format!("0x{:x}", base_preverif_gas), new_preverif_gas);
                        }
                        if let Some(pm_verif_gas) = estimates.get("paymasterVerificationGasLimit").and_then(|v| v.as_str()) {
                            info!("📊 Paymaster verification gas: {}", pm_verif_gas);
                        }
                        }
                        Ok(None) => {
                        info!("❌ Circle paymaster estimation failed (no results)");
                        }
                    Err(e) => {
                        error!("❌ Circle paymaster estimation error: {}", e);
                    }
                }
                
                // Summary
                info!("\n📋 Circle Paymaster Format Summary:");
                info!("  paymaster: \"0x0578cFB241215b77442a541325d6A4E6dFE700Ec\"");
                info!("  paymasterData: \"0x\" (empty for estimation)");
                info!("  paymasterVerificationGasLimit: \"0x7a120\" (500000)");
                info!("  paymasterPostOpGasLimit: \"0x493e0\" (300000)");
                info!("  🚫 No-paymaster fails with AA23 (insufficient ETH in TBA)");
                
                info!("=== Gas Estimation Test Complete ===");
                
            } else {
                error!("Usage: test-candide-gas-estimate <amount>");
                info!("Example: test-candide-gas-estimate 0.01");
            }
        }
        "get-receipt" => {
            if let Some(user_op_hash) = command_arg {
                info!("--- Manual UserOperation Receipt Lookup ---");
                
                let bundler_url = "https://api.candide.dev/public/v3/8453";
                
                match get_user_op_receipt_manual(user_op_hash, bundler_url) {
                    Ok(receipt_data) => {
                        info!("Receipt data received:");
                        info!("{}", serde_json::to_string_pretty(&receipt_data).unwrap_or_else(|_| format!("{:?}", receipt_data)));
                        
                        // Try to extract transaction hash
                        if let Some(receipt) = receipt_data.get("receipt") {
                            if let Some(tx_hash) = receipt.get("transactionHash").and_then(|h| h.as_str()) {
                                info!("✅ Transaction hash found: {}", tx_hash);
                            } else {
                                info!("❌ No transactionHash found in receipt");
                            }
                        } else if let Some(tx_hash) = receipt_data.get("transactionHash").and_then(|h| h.as_str()) {
                            info!("✅ Transaction hash found at root level: {}", tx_hash);
                        } else {
                            info!("❌ No 'receipt' field or transactionHash found in response");
                            info!("Available fields: {:?}", receipt_data.as_object().map(|obj| obj.keys().collect::<Vec<_>>()));
                        }
                    }
                    Err(e) => {
                        error!("❌ Failed to get receipt: {}", e);
                    }
                }
                
                info!("--- End Receipt Lookup ---");
            } else {
                error!("Usage: get-receipt <user_op_hash>");
                info!("Example: get-receipt 0x25ca82108f7d91d18666ad8bbba48bcb7edd8432c0fb3492de7b1b20b9c2b51b");
            }
        }
        "test-gas-estimation" => {
            if let Some(command_args) = command_arg {
                info!("--- Gas Estimation Test ---");
                
                let args: Vec<&str> = command_args.split_whitespace().collect();
                if args.len() < 1 {
                    error!("Usage: test-submit-userop <amount>");
                    info!("Example: test-submit-userop 0.01");
                    info!("⚠️  WARNING: This ACTUALLY SUBMITS the UserOp to the bundler!");
                    return Ok(());
                }
                
                // Parse amount
                let amount_usdc = match args[0].parse::<f64>() {
                    Ok(a) if a > 0.0 => a,
                    _ => {
                        error!("Invalid amount. Please provide a positive number.");
                        return Ok(());
                    }
                };
                
                let amount_units = (amount_usdc * 1_000_000.0) as u128;
                
                // Configuration
                let sender = "0x62DFaDaBFd0b036c1C616aDa273856c514e65819";
                let usdc_contract = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
                let recipient = "0x3138FE02bFc273bFF633E093Bd914F58930d111c";
                let entry_point = "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108";
                let private_key = "0x0988b51979846798cb05ffaa241c6f8bd5538b16344c14343f5dfb6a4dbb2e9a";
                let chain_id = 8453u64;
                let bundler_url = "https://api.candide.dev/public/v3/8453";
                
                let provider = Provider::new(chain_id, 30000);
                
                info!("🚀 SUBMITTING {} USDC transfer using Circle Paymaster", amount_usdc);
                info!("⚠️  This will ACTUALLY execute the transaction!");
                
                
                // Step 2: Fetch dynamic nonce
                info!("=== STEP 2: FETCH DYNAMIC NONCE ===");
                let nonce = match fetch_dynamic_nonce(&provider, sender, entry_point) {
                    Ok(n) => n,
                    Err(e) => {
                        error!("Failed to fetch nonce: {}", e);
                        return Ok(());
                    }
                };
                
                // Step 3: Fetch dynamic gas prices
                info!("=== STEP 3: FETCH DYNAMIC GAS PRICES ===");
                let (dynamic_max_fee, dynamic_priority_fee) = match fetch_dynamic_gas_prices(&provider) {
                    Ok(gas_data) => gas_data,
                    Err(e) => {
                        error!("Failed to fetch gas prices: {}", e);
                        return Ok(());
                    }
                };
                
                // Step 4: Build USDC transfer calldata
                info!("=== STEP 4: BUILD USDC TRANSFER CALLDATA ===");
                let call_data = match build_usdc_transfer_calldata(usdc_contract, recipient, amount_units) {
                    Ok(data) => data,
                    Err(e) => {
                        error!("Failed to build calldata: {}", e);
                        return Ok(());
                    }
                };
                let call_data_hex = hex::encode(&call_data);
                
                // Step 5: Try multiple gas estimation strategies
                info!("=== STEP 5: SMART GAS ESTIMATION ===");
                
                // Use conservative defaults that work reliably
                let mut final_call_gas = 150_000u64;        // Higher default
                let mut final_verif_gas = 250_000u64;       // Higher default  
                let mut final_preverif_gas = 60_000u64;     // Higher default for Base L1 costs
                
                info!("Starting with conservative gas defaults:");
                info!("  - callGas: {}", final_call_gas);
                info!("  - verificationGas: {}", final_verif_gas);
                info!("  - preVerificationGas: {}", final_preverif_gas);
                
                // Strategy 1: Try estimation without paymaster first
                info!("🔄 Strategy 1: Estimate without paymaster");
                let no_paymaster_userop = build_estimation_userop_json(
                    sender,
                    &nonce,
                    &call_data_hex,
                    final_call_gas as u128,
                    final_verif_gas as u128,
                    final_preverif_gas,
                    dynamic_max_fee,
                    dynamic_priority_fee,
                    false, // No paymaster
                );
                
                if let Ok(Some(estimates)) = estimate_userop_gas(&no_paymaster_userop, entry_point, bundler_url) {
                    info!("No-paymaster estimation succeeded");
                    let (call_est, verif_est, preverif_est) = extract_gas_values_from_estimate(
                        Some(estimates),
                        final_call_gas as u128,
                        final_verif_gas as u128,
                        final_preverif_gas,
                    );
                    final_call_gas = call_est;
                    final_verif_gas = verif_est;
                    final_preverif_gas = preverif_est;
                    info!("Updated gas estimates from bundler:");
                    info!("  - callGas: {}", final_call_gas);
                    info!("  - verificationGas: {}", final_verif_gas);
                    info!("  - preVerificationGas: {}", final_preverif_gas);
                } else {
                    info!("⚠️  No-paymaster estimation failed, using defaults");
                }
                
                // Strategy 2: Try with paymaster (optional)
                info!("🔄 Strategy 2: Try estimation with paymaster (non-blocking)");
                let paymaster_userop = build_estimation_userop_json(
                    sender,
                    &nonce,
                    &call_data_hex,
                    final_call_gas as u128,
                    final_verif_gas as u128,
                    final_preverif_gas,
                    dynamic_max_fee,
                    dynamic_priority_fee,
                    true, // With paymaster
                );
                
                if let Ok(Some(estimates)) = estimate_userop_gas(&paymaster_userop, entry_point, bundler_url) {
                    info!("Paymaster estimation also succeeded - using those values");
                    let (call_est, verif_est, preverif_est) = extract_gas_values_from_estimate(
                        Some(estimates),
                        final_call_gas as u128,
                        final_verif_gas as u128,
                        final_preverif_gas,
                    );
                    final_call_gas = call_est;
                    final_verif_gas = verif_est;
                    final_preverif_gas = preverif_est;
                } else {
                    info!("⚠️  Paymaster estimation failed, but continuing with previous estimates");
                }
                
                // Step 6: Calculate transaction cost
                info!("=== STEP 6: FINALIZE GAS VALUES ===");
                info!("Final gas values to use:");
                info!("  - callGas: {}", final_call_gas);
                info!("  - verificationGas: {}", final_verif_gas);
                info!("  - preVerificationGas: {}", final_preverif_gas);
                
                let (total_cost_wei, total_cost_eth, total_cost_usd) = calculate_transaction_cost(
                    final_call_gas,
                    final_verif_gas,
                    final_preverif_gas,
                    dynamic_max_fee,
                );
                
                // Step 8: Prepare paymaster data
                info!("=== STEP 7: PREPARE PAYMASTER DATA ===");
                // For hash calculation, we need the full paymasterAndData format:
                // paymaster address (20 bytes) + verification gas (16 bytes padded) + post-op gas (16 bytes padded)
                let mut paymaster_and_data = Vec::new();
                
                // Paymaster address
                let paymaster_addr = hex::decode("0578cFB241215b77442a541325d6A4E6dFE700Ec").unwrap();
                paymaster_and_data.extend_from_slice(&paymaster_addr);
                
                // Paymaster verification gas limit (500000 = 0x7a120) - 16 bytes padded
                let verif_gas: u128 = 500000;
                paymaster_and_data.extend_from_slice(&verif_gas.to_be_bytes());
                
                // Paymaster post-op gas limit (300000 = 0x493e0) - 16 bytes padded
                let post_op_gas: u128 = 300000;
                paymaster_and_data.extend_from_slice(&post_op_gas.to_be_bytes());
                
                info!("PaymasterAndData for hash: 0x{}", hex::encode(&paymaster_and_data));
                
                // Step 9: Calculate UserOperation hash
                info!("=== STEP 8: CALCULATE USEROPERATION HASH ===");
                let user_op_hash = match calculate_userop_hash(
                    &provider,
                    entry_point,
                    sender,
                    &nonce,
                    &call_data,
                    final_call_gas,
                    final_verif_gas,
                    final_preverif_gas,
                    dynamic_max_fee,
                    dynamic_priority_fee,
                    &paymaster_and_data,
                ) {
                    Ok(hash) => hash,
                    Err(e) => {
                        error!("Failed to calculate UserOp hash: {}", e);
                        return Ok(());
                    }
                };
                
                // Step 10: Sign UserOperation
                info!("=== STEP 9: SIGN USEROPERATION ===");
                let signature = match sign_userop_hash(&user_op_hash, private_key, chain_id) {
                    Ok(sig) => sig,
                    Err(e) => {
                        error!("Failed to sign UserOp: {}", e);
                        return Ok(());
                    }
                };
                
                // Step 11: Build final UserOperation
                info!("=== STEP 10: BUILD FINAL USEROPERATION ===");
                let final_userop = build_final_userop_json_with_data(
                    sender,
                    &nonce,
                    &call_data_hex,
                    final_call_gas,
                    final_verif_gas,
                    final_preverif_gas,
                    dynamic_max_fee,
                    dynamic_priority_fee,
                    &signature,
                    &Vec::new(), // Empty paymaster data for Candide API format
                );
                
                
                let mut retry_call_gas = final_call_gas;
                let mut retry_verif_gas = final_verif_gas;
                let mut retry_preverif_gas = final_preverif_gas;

                info!("all gotten gas values: callGas: {}, verificationGas: {}, preVerificationGas: {}", retry_call_gas, retry_verif_gas, retry_preverif_gas);
                
                info!("=== GAS ESTIMATION TEST COMPLETE ===");
                
                            } else {
                error!("Usage: test-gas-estimation <amount>");
                info!("Example: test-gas-estimation 0.01");
            }
        }
        _ => info!("Unknown command: '{}'. Type 'help' for available commands.", command_verb),
    }
    Ok(())
}
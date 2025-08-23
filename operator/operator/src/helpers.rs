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
use crate::constants::{HYPR_HASH, USDC_BASE_ADDRESS};
use crate::ledger;
use alloy_primitives::{U256, B256, keccak256};
use alloy_sol_types::{SolValue, SolCall};
use hex;

use crate::structs::{self, *};
use crate::db;
use crate::hyperwallet_client::{service, payments::{handle_operator_tba_withdrawal, AssetType, execute_payment}};
use crate::chain;
use crate::authorized_services::{HotWalletAuthorizedClient, ServiceCapabilities};

// Fill this with your Basescan API key (or move to a secure config)

pub fn make_json_timestamp() -> serde_json::Number {
    let systemtime = SystemTime::now();

    let duration_since_epoch = systemtime
        .duration_since(UNIX_EPOCH)
        .expect("Time went backwards");
    let secs = duration_since_epoch.as_secs();
    let now: serde_json::Number = secs.into();
    return now;
}

// --- USDC event snapshot helpers ---
fn ensure_usdc_events_table(db: &Sqlite) -> anyhow::Result<()> { ledger::ensure_usdc_events_table(db) }

// --- USDC per-call ledger schema ---
fn ensure_usdc_call_ledger_table(db: &Sqlite) -> anyhow::Result<()> { crate::ledger::ensure_usdc_call_ledger_table(db) }

use crate::ledger::usdc_display_to_units;

use crate::ledger::build_usdc_ledger_for_tba;

// ensure_usdc_call_ledger_table re-exported above

// Historical ERC20 balanceOf at a specific block
fn erc20_balance_of_at(
    provider: &Provider,
    token: EthAddress,
    owner: EthAddress,
    block: u64,
) -> anyhow::Result<U256> {
    use alloy_sol_types::sol;
    sol! {
        function balanceOf(address owner) external view returns (uint256 balance);
    }
    let call = balanceOfCall { owner };
    let data = call.abi_encode();
    let tx = TransactionRequest::default()
        .input(TransactionInput::new(data.into()))
        .to(token);
    let res = provider.call(tx, Some(hyperware_process_lib::eth::BlockId::Number(BlockNumberOrTag::Number(block))))?;
    // decode returns or fallback to U256 from bytes
    if res.len() == 32 {
        Ok(U256::from_be_slice(res.as_ref()))
    } else {
        let decoded = balanceOfCall::abi_decode_returns(&res, false)
            .map_err(|e| anyhow!("decode error: {}", e))?;
        Ok(decoded.balance)
    }
}

fn bisect_change_ranges<F>(
    provider: &Provider,
    token: EthAddress,
    owner: EthAddress,
    start: u64,
    end: u64,
    window_cap: u64,
    get_balance: &mut F,
    ranges_out: &mut Vec<(u64,u64)>,
) -> anyhow::Result<()>
where F: FnMut(u64) -> anyhow::Result<U256> {
    if start >= end { return Ok(()); }

    let bal_start = get_balance(start)?;
    let bal_end = get_balance(end)?;
    if bal_start == bal_end {
        return Ok(()); // no net change in whole range
    }
    if end - start <= window_cap {
        ranges_out.push((start, end));
        return Ok(());
    }
    let mid = start + (end - start) / 2;
    let bal_mid = get_balance(mid)?;
    if bal_mid != bal_start {
        bisect_change_ranges(provider, token, owner, start, mid, window_cap, get_balance, ranges_out)?;
    }
    if bal_mid != bal_end {
        bisect_change_ranges(provider, token, owner, mid + 1, end, window_cap, get_balance, ranges_out)?;
    }
    Ok(())
}

fn insert_usdc_event(
    db: &Sqlite,
    address: &str,
    block: u64,
    time: Option<u64>,
    tx_hash: &str,
    log_index: Option<u64>,
    from_addr: &str,
    to_addr: &str,
    value_units: &str,
) -> anyhow::Result<()> {
    let stmt = r#"
        INSERT OR IGNORE INTO usdc_events
        (address, block, time, tx_hash, log_index, from_addr, to_addr, value_units)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8);
    "#.to_string();
    let params = vec![
        serde_json::Value::String(address.to_string()),
        serde_json::Value::Number(serde_json::Number::from(block)),
        time.map(|t| serde_json::Value::Number(serde_json::Number::from(t))).unwrap_or(serde_json::Value::Null),
        serde_json::Value::String(tx_hash.to_string()),
        log_index.map(|i| serde_json::Value::Number(serde_json::Number::from(i))).unwrap_or(serde_json::Value::Null),
        serde_json::Value::String(from_addr.to_string()),
        serde_json::Value::String(to_addr.to_string()),
        serde_json::Value::String(value_units.to_string()),
    ];
    db.write(stmt, params, None)?;
    Ok(())
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
            info!("check-grid-root: Check the grid.hypr entry status.");
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
            info!("usdc-history <address> [days=30] [limit=100]: List USDC transfers via Basescan without scanning blocks.");
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
                match handle_operator_tba_withdrawal(
                    state,
                    AssetType::Eth,
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
            let sub_entry_name = format!("grid-wallet.{}", base_node_name);
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
                        info!("  2. Chain sync hasn't found grid.hypr yet"); 
                        info!("  3. No providers have been minted under grid.hypr");
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
                Some(hash) => info!("Hypergrid root (grid.hypr) hash: {}", hash),
                None => warn!("Hypergrid root (grid.hypr) NOT SET - this prevents provider indexing!"),
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
                                    format!("{} (grid.hypr)", parent)
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
            info!("--- Checking grid.hypr entry status ---");
            
            // Check current state
            match &state.root_hash {
                Some(hash) => {
                    info!("State root_hash is SET to: {}", hash);
                }
                None => {
                    warn!("State root_hash is NOT SET - provider indexing is disabled!");
                }
            }
            
            // Check on-chain for grid.hypr
            info!("\nChecking on-chain for grid.hypr...");
            let provider = eth::Provider::new(structs::CHAIN_ID, 30000);
            match debug_get_tba_for_node("grid.hypr") {
                Ok(result) => {
                    info!("On-chain lookup for grid.hypr: {}", result);
                    
                    // Calculate the expected hash
                    let expected_hash = hypermap::namehash("grid.hypr");
                    info!("Expected hash for grid.hypr: {}", expected_hash);
                    
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
                    error!("Failed to look up grid.hypr on-chain: {}", e);
                }
            }
            
            // Show hypr parent hash for reference
            let hypr_hash = HYPR_HASH;
            info!("\nFor reference:");
            info!("  hypr hash (parent of grid): {}", hypr_hash);
            info!("  grid.hypr expected hash: {}", hypermap::namehash("grid.hypr"));
            
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
            
            info!("--- End grid.hypr check ---");
        }
        "addr-created" => {
            if let Some(args) = command_arg {
                let parts: Vec<&str> = args.split_whitespace().collect();
                if parts.is_empty() {
                    error!("Usage: addr-created <address> [from_block] [to_block]");
                    return Ok(());
                }
                let addr = match EthAddress::from_str(parts[0]) {
                    Ok(a) => a,
                    Err(e) => { error!("Invalid address: {}", e); return Ok(()); }
                };
                let from_block = parts.get(1).and_then(|v| v.parse::<u64>().ok());
                let to_block = parts.get(2).and_then(|v| v.parse::<u64>().ok());
                let provider = eth::Provider::new(structs::CHAIN_ID, 30000);

                // Try AA UserOperationEvent (EntryPoint 0.8.0 on Base)
                let entry_point = EthAddress::from_str("0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108").unwrap_or(EthAddress::ZERO);
                let userop_sig = "UserOperationEvent(bytes32,address,address,uint256,bool,uint256,uint256)";
                let topic0: B256 = alloy_primitives::keccak256(userop_sig.as_bytes()).into();
                let mut aa_filter = eth::Filter::new().address(entry_point).topic0(vec![topic0]);
                let mut padded = [0u8; 32];
                padded[12..].copy_from_slice(addr.as_slice());
                aa_filter = aa_filter.topic2(vec![B256::from(padded)]);
                if let Some(fb) = from_block { aa_filter = aa_filter.from_block(fb); }
                if let Some(tb) = to_block { aa_filter = aa_filter.to_block(tb); }

                // Respect provider range limits by chunking (<=500 blocks per query)
                let (start, end) = match (from_block, to_block) {
                    (Some(s), Some(e)) if s <= e => (s, e),
                    _ => (from_block.unwrap_or(0), to_block.unwrap_or(from_block.unwrap_or(0))),
                };
                let mut aa_found = false;
                if start > 0 && end >= start {
                    let step: u64 = 450;
                    let mut cur = start;
                    while cur <= end {
                        let hi = end.min(cur + step);
                        let window = aa_filter.clone().from_block(cur).to_block(hi);
                        match provider.get_logs(&window) {
                            Ok(logs) if !logs.is_empty() => {
                                info!("AA evidence found ({} logs) in [{}, {}]", logs.len(), cur, hi);
                                aa_found = true;
                                break;
                            }
                            Ok(_) => {}
                            Err(e) => { warn!("AA log query failed in [{}, {}]: {:?}", cur, hi, e); }
                        }
                        if hi == end { break; }
                        cur = hi + 1;
                    }
                } else {
                    // Single-shot if no valid range
                    match provider.get_logs(&aa_filter) {
                        Ok(logs) if !logs.is_empty() => { info!("AA evidence found ({} logs) for address.", logs.len()); aa_found = true; }
                        Ok(_) => {}
                        Err(e) => { warn!("AA log query failed: {:?}", e); }
                    }
                }
                if !aa_found { info!("No AA logs found in given range; trying USDC fallback..."); }

                // Fallback: USDC Transfer (from/to address)
                let usdc = EthAddress::from_str(USDC_BASE_ADDRESS).unwrap_or(EthAddress::ZERO);
                let transfer_sig = "Transfer(address,address,uint256)";
                let t0: B256 = alloy_primitives::keccak256(transfer_sig.as_bytes()).into();
                let mut from_f = eth::Filter::new().address(usdc).topic0(vec![t0]);
                let mut to_f = eth::Filter::new().address(usdc).topic0(vec![t0]);
                let mut pad = [0u8; 32]; pad[12..].copy_from_slice(addr.as_slice()); let topic_addr = B256::from(pad);
                from_f = from_f.topic1(vec![topic_addr]);
                to_f = to_f.topic2(vec![topic_addr]);
                if let Some(fb) = from_block { from_f = from_f.from_block(fb); to_f = to_f.from_block(fb); }
                if let Some(tb) = to_block { from_f = from_f.to_block(tb); to_f = to_f.to_block(tb); }
                let (start_u, end_u) = match (from_block, to_block) { (Some(s), Some(e)) if s <= e => (s, e), _ => (from_block.unwrap_or(0), to_block.unwrap_or(from_block.unwrap_or(0))) };
                let step: u64 = 450;
                let mut total = 0usize;
                if start_u > 0 && end_u >= start_u {
                    let mut cur = start_u;
                    while cur <= end_u {
                        let hi = end_u.min(cur + step);
                        let wf = from_f.clone().from_block(cur).to_block(hi);
                        let wt = to_f.clone().from_block(cur).to_block(hi);
                        if let Ok(l) = provider.get_logs(&wf) { total += l.len(); }
                        if let Ok(l) = provider.get_logs(&wt) { total += l.len(); }
                        if hi == end_u { break; }
                        cur = hi + 1;
                    }
                } else {
                    if let Ok(l) = provider.get_logs(&from_f) { total += l.len(); }
                    if let Ok(l) = provider.get_logs(&to_f) { total += l.len(); }
                }
                if total == 0 {
                    warn!("No USDC Transfer evidence in range.");
                } else {
                    info!("USDC evidence found: {} log(s) in range.", total);
                }
                
            } else {
                error!("Usage: addr-created <address> [from_block] [to_block]");
                
            }
        }
        "usdc-logs" => {
            if let Some(args) = command_arg {
                let parts: Vec<&str> = args.split_whitespace().collect();
                if parts.is_empty() { error!("Usage: usdc-logs <address> [from_block] [to_block] [limit]"); return Ok(()); }
                let addr = match EthAddress::from_str(parts[0]) { Ok(a) => a, Err(e) => { error!("Invalid address: {}", e); return Ok(()); } };
                let from_block = parts.get(1).and_then(|v| v.parse::<u64>().ok());
                let to_block = parts.get(2).and_then(|v| v.parse::<u64>().ok());
                let limit = parts.get(3).and_then(|v| v.parse::<usize>().ok()).unwrap_or(50);
                let provider = eth::Provider::new(structs::CHAIN_ID, 30000);
                let usdc = EthAddress::from_str(USDC_BASE_ADDRESS).unwrap_or(EthAddress::ZERO);
                let transfer_sig = "Transfer(address,address,uint256)";
                let t0: B256 = alloy_primitives::keccak256(transfer_sig.as_bytes()).into();

                let mut pad = [0u8; 32]; pad[12..].copy_from_slice(addr.as_slice()); let topic_addr = B256::from(pad);
                let mut from_f = eth::Filter::new().address(usdc).topic0(vec![t0]).topic1(vec![topic_addr]);
                let mut to_f = eth::Filter::new().address(usdc).topic0(vec![t0]).topic2(vec![topic_addr]);
                if let Some(fb) = from_block { from_f = from_f.from_block(fb); to_f = to_f.from_block(fb); }
                if let Some(tb) = to_block { from_f = from_f.to_block(tb); to_f = to_f.to_block(tb); }

                let mut rows = 0usize;
                let (start_u, end_u) = match (from_block, to_block) { (Some(s), Some(e)) if s <= e => (s, e), _ => (from_block.unwrap_or(0), to_block.unwrap_or(from_block.unwrap_or(0))) };
                let step: u64 = 450;
                if start_u > 0 && end_u >= start_u {
                    let mut cur = start_u;
                    'outer: while cur <= end_u {
                        let hi = end_u.min(cur + step);
                        let wf = from_f.clone().from_block(cur).to_block(hi);
                        let wt = to_f.clone().from_block(cur).to_block(hi);
                        if let Ok(logs) = provider.get_logs(&wf) {
                            for log in logs {
                                if rows >= limit { break 'outer; }
                                rows += 1;
                                let topics = log.topics();
                                let amount = "?".to_string();
                                let mut from_addr = [0u8;20]; from_addr.copy_from_slice(&topics[1].as_slice()[12..]);
                                let mut to_addr = [0u8;20]; to_addr.copy_from_slice(&topics[2].as_slice()[12..]);
                                info!("from=0x{} to=0x{} amount(units)={} (dir=OUT)", hex::encode(from_addr), hex::encode(to_addr), amount);
                            }
                        }
                        if rows < limit {
                            if let Ok(logs) = provider.get_logs(&wt) {
                                for log in logs {
                                    if rows >= limit { break 'outer; }
                                    rows += 1;
                                    let topics = log.topics();
                                    let amount = "?".to_string();
                                    let mut from_addr = [0u8;20]; from_addr.copy_from_slice(&topics[1].as_slice()[12..]);
                                    let mut to_addr = [0u8;20]; to_addr.copy_from_slice(&topics[2].as_slice()[12..]);
                                    info!("from=0x{} to=0x{} amount(units)={} (dir=IN)", hex::encode(from_addr), hex::encode(to_addr), amount);
                                }
                            }
                        }
                        if hi == end_u { break; }
                        cur = hi + 1;
                    }
                } else {
                    if let Ok(logs) = provider.get_logs(&from_f) {
                        for log in logs.into_iter().take(limit) {
                            rows += 1;
                            let topics = log.topics();
                            let amount = "?".to_string();
                            let mut from_addr = [0u8;20]; from_addr.copy_from_slice(&topics[1].as_slice()[12..]);
                            let mut to_addr = [0u8;20]; to_addr.copy_from_slice(&topics[2].as_slice()[12..]);
                            info!("from=0x{} to=0x{} amount(units)={} (dir=OUT)", hex::encode(from_addr), hex::encode(to_addr), amount);
                        }
                    }
                    if rows < limit {
                        if let Ok(logs) = provider.get_logs(&to_f) {
                            for log in logs.into_iter().take(limit - rows) {
                                let topics = log.topics();
                                let amount = "?".to_string();
                                let mut from_addr = [0u8;20]; from_addr.copy_from_slice(&topics[1].as_slice()[12..]);
                                let mut to_addr = [0u8;20]; to_addr.copy_from_slice(&topics[2].as_slice()[12..]);
                                info!("from=0x{} to=0x{} amount(units)={} (dir=IN)", hex::encode(from_addr), hex::encode(to_addr), amount);
                            }
                        }
                    }
                }
                if rows == 0 { info!("No USDC transfers found in range"); }
                
            } else {
                error!("Usage: usdc-logs <address> [from_block] [to_block] [limit]");
                
            }
        }
        "usdc-snapshot-hypermap" => {
            // Deprecated: Basescan removed. Use hypermap-entry-info/hypermap-created instead.
            error!("usdc-snapshot-hypermap is deprecated. Use 'hypermap-entry-info <tba|name|namehash>' or 'hypermap-created <tba|name|namehash>'");
        }
        "hypermap-entry-info" => {
            if let Some(args) = command_arg {
                let input = args.trim();
                let provider = eth::Provider::new(structs::CHAIN_ID, 30000);
                let hyper = hypermap::Hypermap::new(provider.clone(), EthAddress::from_str(hypermap::HYPERMAP_ADDRESS).unwrap());

                // Resolve to namehash
                let namehash_hex = if input.starts_with("0x") && input.len() == 66 {
                    input.to_string()
                } else if input.starts_with("0x") && input.len() == 42 {
                    let tba = match EthAddress::from_str(input) { Ok(a) => a, Err(e) => { error!("Invalid address: {}", e); return Ok(()); } };
                    match hyper.get_namehash_from_tba(tba) { Ok(nh) => nh, Err(e) => { error!("Failed to get namehash from TBA: {:?}", e); return Ok(()); } }
                } else {
                    hypermap::namehash(input)
                };
                info!("Resolved entry namehash: {}", namehash_hex);

                // Build filters: Mint by childhash; Notes by parenthash
                let mut nh_bytes = [0u8; 32];
                match hex::decode(namehash_hex.trim_start_matches("0x")) {
                    Ok(b) if b.len() == 32 => nh_bytes.copy_from_slice(&b),
                    _ => { error!("Bad namehash hex"); return Ok(()); }
                }
                let nh_b256 = B256::from(nh_bytes);
                let mint_f = hyper.mint_filter().topic2(vec![nh_b256]);
                let note_f = hyper.note_filter().topic1(vec![nh_b256]);

                // Bootstrap via local cacher
                let from_block = Some(hypermap::HYPERMAP_FIRST_BLOCK);
                let retry = Some((5, Some(5)));
                let (last_block, results) = match hyper.bootstrap(from_block, vec![mint_f, note_f], retry, None) {
                    Ok(v) => v,
                    Err(e) => { error!("Hypermap bootstrap failed: {:?}", e); return Ok(()); }
                };
                let mint_logs = results.get(0).cloned().unwrap_or_default();
                let note_logs = results.get(1).cloned().unwrap_or_default();

                // Created block = earliest Mint
                let created_block = mint_logs.iter().filter_map(|l| l.block_number).min();
                match created_block {
                    Some(cb) => {
                        let ts = provider.get_block_by_number(hyperware_process_lib::eth::BlockNumberOrTag::Number(cb), false)
                            .ok().flatten().map(|b| b.header.inner.timestamp).unwrap_or(0);
                        info!("Entry created at block {} (timestamp {}), last cached block {}", cb, ts, last_block);
                    }
                    None => warn!("No Mint logs found for this entry."),
                }

                // List notes
                if note_logs.is_empty() {
                    info!("No notes found for this entry.");
                } else {
                    info!("Found {} notes for this entry:", note_logs.len());
                    for lg in note_logs.iter().take(50) {
                        let topics = lg.topics();
                        let label = if topics.len() > 2 { format!("0x{}", hex::encode(topics[2].as_slice())) } else { "(no label)".to_string() };
                        let bn = lg.block_number.unwrap_or(0);
                        info!("  - block {} labelhash {} data_len {}", bn, label, lg.data().data.len());
                    }
                }
            } else {
                error!("Usage: hypermap-entry-info <tba|name|namehash>");
            }
        }
        "hypermap-created" => {
            if let Some(args) = command_arg {
                let input = args.trim();
                let provider = eth::Provider::new(structs::CHAIN_ID, 30000);
                let hyper = hypermap::Hypermap::new(provider.clone(), EthAddress::from_str(hypermap::HYPERMAP_ADDRESS).unwrap());
                let namehash_hex = if input.starts_with("0x") && input.len() == 66 {
                    input.to_string()
                } else if input.starts_with("0x") && input.len() == 42 {
                    let tba = match EthAddress::from_str(input) { Ok(a) => a, Err(e) => { error!("Invalid address: {}", e); return Ok(()); } };
                    match hyper.get_namehash_from_tba(tba) { Ok(nh) => nh, Err(e) => { error!("Failed to get namehash from TBA: {:?}", e); return Ok(()); } }
                } else { hypermap::namehash(input) };

                let mut nh_bytes = [0u8; 32];
                match hex::decode(namehash_hex.trim_start_matches("0x")) {
                    Ok(b) if b.len() == 32 => nh_bytes.copy_from_slice(&b),
                    _ => { error!("Bad namehash hex"); return Ok(()); }
                }
                let nh_b256 = B256::from(nh_bytes);
                let mint_f = hyper.mint_filter().topic2(vec![nh_b256]);
                let (last_block, results) = match hyper.bootstrap(Some(hypermap::HYPERMAP_FIRST_BLOCK), vec![mint_f], Some((5, Some(5))), None) {
                    Ok(v) => v,
                    Err(e) => { error!("Hypermap bootstrap failed: {:?}", e); return Ok(()); }
                };
                let mint_logs = results.get(0).cloned().unwrap_or_default();
                let created_block = mint_logs.iter().filter_map(|l| l.block_number).min();
                match created_block {
                    Some(cb) => {
                        let ts = provider.get_block_by_number(hyperware_process_lib::eth::BlockNumberOrTag::Number(cb), false)
                            .ok().flatten().map(|b| b.header.inner.timestamp).unwrap_or(0);
                        info!("Entry created at block {} (timestamp {}), last cached block {}", cb, ts, last_block);
                    }
                    None => warn!("No Mint logs found for this entry."),
                }
            } else {
                error!("Usage: hypermap-created <tba|name|namehash>");
            }
        }
        "entry-usdc-index" => {
            // Usage: entry-usdc-index <tba|name|namehash> [from_block]
            if let Some(args) = command_arg {
                let parts: Vec<&str> = args.split_whitespace().collect();
                if parts.is_empty() { error!("Usage: entry-usdc-index <tba|name|namehash> [from_block]"); return Ok(()); }
                let input = parts[0].trim();
                let from_block_override = parts.get(1).and_then(|v| v.parse::<u64>().ok());

                ensure_usdc_events_table(db)?;

                let provider = eth::Provider::new(structs::CHAIN_ID, 30000);
                let hyper = hypermap::Hypermap::new(provider.clone(), EthAddress::from_str(hypermap::HYPERMAP_ADDRESS).unwrap());

                // Resolve TBA and namehash
                let (tba_addr, namehash_hex) = if input.starts_with("0x") && input.len() == 42 {
                    (EthAddress::from_str(input).map_err(|e| anyhow!("Invalid address: {}", e))?, {
                        // Try to get namehash from tba for logging
                        match hyper.get_namehash_from_tba(EthAddress::from_str(input).unwrap()) { Ok(nh) => nh, Err(_) => String::from("") }
                    })
                } else if input.starts_with("0x") && input.len() == 66 {
                    let nh = input.to_string();
                    let (tba, _owner, _data) = match hyper.get_hash(&nh) { Ok(v) => v, Err(e) => { error!("Failed to get entry from namehash: {:?}", e); return Ok(()); } };
                    (tba, nh)
                } else {
                    let (tba, _owner, _data) = match hyper.get(input) { Ok(v) => v, Err(e) => { error!("Failed to get entry from name: {:?}", e); return Ok(()); } };
                    (tba, hypermap::namehash(input))
                };
                let tba_str = format!("0x{}", hex::encode(tba_addr));
                info!("Indexing USDC for entry TBA {} (namehash {})", tba_str, namehash_hex);

                // Determine start block via Mint bootstrap unless overridden
                let start_block = if let Some(fb) = from_block_override { fb } else {
                    let mut nh_bytes = [0u8; 32];
                    match hex::decode(namehash_hex.trim_start_matches("0x")) {
                        Ok(b) if b.len() == 32 => nh_bytes.copy_from_slice(&b),
                        _ => {}
                    }
                    let nh_b256 = B256::from(nh_bytes);
                    let mint_f = hyper.mint_filter().topic2(vec![nh_b256]);
                    match hyper.bootstrap(Some(hypermap::HYPERMAP_FIRST_BLOCK), vec![mint_f], Some((5, Some(5))), None) {
                        Ok((_lb, results)) => {
                            let mints = results.get(0).cloned().unwrap_or_default();
                            mints.iter().filter_map(|l| l.block_number).min().unwrap_or(hypermap::HYPERMAP_FIRST_BLOCK)
                        }
                        Err(_) => hypermap::HYPERMAP_FIRST_BLOCK,
                    }
                };
                let latest = provider.get_block_number().unwrap_or(start_block);
                info!("Scanning EntryPoint events from {} to {} (<=450/window)", start_block, latest);

                // EntryPoint UserOperationEvent filtered by sender
                let entry_point = EthAddress::from_str("0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108").unwrap();
                let userop_sig = keccak256("UserOperationEvent(bytes32,address,address,uint256,bool,uint256,uint256)".as_bytes());
                let mut pad = [0u8; 32]; pad[12..].copy_from_slice(tba_addr.as_slice()); let topic_sender = B256::from(pad);
                let base_filter = eth::Filter::new().address(entry_point).topic0(vec![userop_sig]).topic2(vec![topic_sender]);

                let step: u64 = 450;
                let mut cur = start_block;
                let mut total_receipts = 0usize;
                let mut total_transfers = 0usize;
                while cur <= latest {
                    let hi = latest.min(cur + step);
                    let window = base_filter.clone().from_block(cur).to_block(hi);
                    match provider.get_logs(&window) {
                        Ok(logs) => {
                            for lg in logs {
                                if let Some(txh) = lg.transaction_hash { 
                                    match provider.get_transaction_receipt(txh) {
                                        Ok(Some(rcpt)) => {
                                            total_receipts += 1;
                                            for rlog in rcpt.inner.logs().iter() {
                                                // Filter USDC Transfer logs in this tx pertaining to TBA
                                                if format!("0x{}", hex::encode(rlog.address())) != USDC_BASE_ADDRESS { continue; }
                                                let transfer_sig = keccak256("Transfer(address,address,uint256)".as_bytes());
                                                if rlog.topics().first().copied() != Some(transfer_sig.into()) { continue; }
                                                if rlog.topics().len() < 3 { continue; }
                                                let from_addr = &rlog.topics()[1].as_slice()[12..];
                                                let to_addr = &rlog.topics()[2].as_slice()[12..];
                                                let from_hex = format!("0x{}", hex::encode(from_addr));
                                                let to_hex = format!("0x{}", hex::encode(to_addr));
                                                if !from_hex.eq_ignore_ascii_case(&tba_str) && !to_hex.eq_ignore_ascii_case(&tba_str) { continue; }
                                                let amount = U256::from_be_slice(rlog.data().data.as_ref());
                                                let blk = rcpt.block_number.unwrap_or(cur);
                                                let log_index = rlog.log_index.map(|v| v.into());
                                                insert_usdc_event(db, &tba_str, blk, None, &format!("0x{}", hex::encode(txh)), log_index, &from_hex, &to_hex, &amount.to_string())?;
                                                total_transfers += 1;
                                            }
                                        }
                                        _ => {}
                                    }
                                }
                            }
                        }
                        Err(e) => { warn!("getLogs error in window [{}, {}]: {:?}", cur, hi, e); }
                    }
                    if hi == latest { break; }
                    cur = hi + 1;
                }
                info!("Completed index for {}: {} receipts scanned, {} USDC transfers recorded.", tba_str, total_receipts, total_transfers);
            } else {
                error!("Usage: entry-usdc-index <tba|name|namehash> [from_block]");
            }
        }
        "usdc-scan-direct" => {
            // Usage: usdc-scan-direct <tba|name|namehash> [from_block]
            if let Some(args) = command_arg {
                let parts: Vec<&str> = args.split_whitespace().collect();
                if parts.is_empty() { error!("Usage: usdc-scan-direct <tba|name|namehash> [from_block]"); return Ok(()); }
                let input = parts[0].trim();
                let from_block_override = parts.get(1).and_then(|v| v.parse::<u64>().ok());

                ensure_usdc_events_table(db)?;

                let provider = eth::Provider::new(structs::CHAIN_ID, 30000);
                let hyper = hypermap::Hypermap::new(provider.clone(), EthAddress::from_str(hypermap::HYPERMAP_ADDRESS).unwrap());

                // Resolve TBA
                let tba_addr = if input.starts_with("0x") && input.len() == 42 {
                    EthAddress::from_str(input).map_err(|e| anyhow!("Invalid address: {}", e))?
                } else if input.starts_with("0x") && input.len() == 66 {
                    let (tba, _owner, _data) = match hyper.get_hash(input) { Ok(v) => v, Err(e) => { error!("Failed to get entry from namehash: {:?}", e); return Ok(()); } };
                    tba
                } else {
                    let (tba, _owner, _data) = match hyper.get(input) { Ok(v) => v, Err(e) => { error!("Failed to get entry from name: {:?}", e); return Ok(()); } };
                    tba
                };
                let tba_str = format!("0x{}", hex::encode(tba_addr));

                // Determine start block via Mint bootstrap unless overridden
                let start_block = if let Some(fb) = from_block_override { fb } else {
                    let nh = match hyper.get_namehash_from_tba(tba_addr) { Ok(nh) => nh, Err(_) => String::new() };
                    let mut nh_bytes = [0u8; 32];
                    if let Ok(b) = hex::decode(nh.trim_start_matches("0x")) { if b.len() == 32 { nh_bytes.copy_from_slice(&b); } }
                    let nh_b256 = B256::from(nh_bytes);
                    let mint_f = hyper.mint_filter().topic2(vec![nh_b256]);
                    match hyper.bootstrap(Some(hypermap::HYPERMAP_FIRST_BLOCK), vec![mint_f], Some((5, Some(5))), None) {
                        Ok((_lb, results)) => {
                            let mints = results.get(0).cloned().unwrap_or_default();
                            mints.iter().filter_map(|l| l.block_number).min().unwrap_or(hypermap::HYPERMAP_FIRST_BLOCK)
                        }
                        Err(_) => hypermap::HYPERMAP_FIRST_BLOCK,
                    }
                };
                let latest = provider.get_block_number().unwrap_or(start_block);
                info!("Direct USDC scan for {} from {} to {} (<=450/window)", tba_str, start_block, latest);

                // Build USDC Transfer filters
                let usdc = EthAddress::from_str(USDC_BASE_ADDRESS).unwrap_or(EthAddress::ZERO);
                let transfer_sig = keccak256("Transfer(address,address,uint256)".as_bytes());
                let mut pad = [0u8; 32]; pad[12..].copy_from_slice(tba_addr.as_slice()); let topic_addr = B256::from(pad);
                let base_from = eth::Filter::new().address(usdc).topic0(vec![transfer_sig.into()]).topic1(vec![topic_addr]);
                let base_to   = eth::Filter::new().address(usdc).topic0(vec![transfer_sig.into()]).topic2(vec![topic_addr]);

                let step: u64 = 450;
                let mut cur = start_block;
                let mut rows = 0usize;
                while cur <= latest {
                    let hi = latest.min(cur + step);
                    let wf = base_from.clone().from_block(cur).to_block(hi);
                    let wt = base_to.clone().from_block(cur).to_block(hi);
                    for flt in [&wf, &wt] {
                        match provider.get_logs(flt) {
                            Ok(logs) => {
                                for lg in logs {
                                    let txh = match lg.transaction_hash { Some(h) => h, None => continue };
                                    if lg.topics().len() < 3 { continue; }
                                    let from_addr = &lg.topics()[1].as_slice()[12..];
                                    let to_addr = &lg.topics()[2].as_slice()[12..];
                                    let from_hex = format!("0x{}", hex::encode(from_addr));
                                    let to_hex = format!("0x{}", hex::encode(to_addr));
                                    if !from_hex.eq_ignore_ascii_case(&tba_str) && !to_hex.eq_ignore_ascii_case(&tba_str) { continue; }
                                    let amount = U256::from_be_slice(lg.data().data.as_ref());
                                    let blk = lg.block_number.unwrap_or(cur);
                                    let log_index = lg.log_index.map(|v| v.into());
                                    insert_usdc_event(db, &tba_str, blk, None, &format!("0x{}", hex::encode(txh)), log_index, &from_hex, &to_hex, &amount.to_string())?;
                                    rows += 1;
                                }
                            }
                            Err(e) => { warn!("getLogs error in window [{}, {}]: {:?}", cur, hi, e); }
                        }
                    }
                    if hi == latest { break; }
                    cur = hi + 1;
                }
                info!("Direct USDC scan complete for {}. Rows inserted: {}", tba_str, rows);
            } else {
                error!("Usage: usdc-scan-direct <tba|name|namehash> [from_block]");
            }
        }
        "usdc-scan-bisect" => {
            // Usage: usdc-scan-bisect <tba|name|namehash>
            if let Some(args) = command_arg {
                let input = args.trim();
                let provider = eth::Provider::new(structs::CHAIN_ID, 30000);
                let hyper = hypermap::Hypermap::new(provider.clone(), EthAddress::from_str(hypermap::HYPERMAP_ADDRESS).unwrap());

                // Resolve TBA and creation block via hypermap
                let (tba_addr, start_block) = {
                    let tba = if input.starts_with("0x") && input.len() == 42 {
                        EthAddress::from_str(input).map_err(|e| anyhow!("Invalid address: {}", e))?
                    } else if input.starts_with("0x") && input.len() == 66 {
                        let (t, _o, _d) = hyper.get_hash(input).map_err(|e| anyhow!("get_hash: {:?}", e))?; t
                    } else { let (t, _o, _d) = hyper.get(input).map_err(|e| anyhow!("get(name): {:?}", e))?; t };
                    // creation via Mint
                    let nh = hyper.get_namehash_from_tba(tba).unwrap_or_default();
                    let mut nh_bytes = [0u8; 32]; if let Ok(b) = hex::decode(nh.trim_start_matches("0x")) { if b.len()==32 { nh_bytes.copy_from_slice(&b); } }
                    let mint_f = hyper.mint_filter().topic2(vec![B256::from(nh_bytes)]);
                    let (_lb, res) = hyper.bootstrap(Some(hypermap::HYPERMAP_FIRST_BLOCK), vec![mint_f], Some((5, Some(5))), None).map_err(|e| anyhow!("bootstrap: {:?}", e))?;
                    let mints = res.get(0).cloned().unwrap_or_default();
                    let created = mints.iter().filter_map(|l| l.block_number).min().unwrap_or(hypermap::HYPERMAP_FIRST_BLOCK);
                    (tba, created)
                };
                let latest = provider.get_block_number().unwrap_or(start_block);
                info!("Bisect USDC scan for {} from {} to {}", format!("0x{}", hex::encode(tba_addr)), start_block, latest);

                let usdc = EthAddress::from_str(USDC_BASE_ADDRESS).unwrap_or(EthAddress::ZERO);
                let window_cap: u64 = 450; // switch to logs when ranges are small enough

                let mut cache: std::collections::HashMap<u64, U256> = std::collections::HashMap::new();
                let mut get_bal = |blk: u64| -> anyhow::Result<U256> {
                    if let Some(v) = cache.get(&blk) { return Ok(*v); }
                    let v = erc20_balance_of_at(&provider, usdc, tba_addr, blk)?;
                    cache.insert(blk, v);
                    Ok(v)
                };

                let mut ranges: Vec<(u64,u64)> = Vec::new();
                if start_block < latest {
                    bisect_change_ranges(&provider, usdc, tba_addr, start_block, latest, window_cap, &mut get_bal, &mut ranges).ok();
                }
                if ranges.is_empty() {
                    info!("No USDC balance changes detected across range. Nothing to fetch.");
                    return Ok(());
                }
                info!("{} change windows to fetch logs in", ranges.len());

                // For each small window, fetch both in/out logs and insert
                let transfer_sig = keccak256("Transfer(address,address,uint256)".as_bytes());
                let mut pad = [0u8; 32]; pad[12..].copy_from_slice(tba_addr.as_slice()); let topic_addr = B256::from(pad);
                let base_from = eth::Filter::new().address(usdc).topic0(vec![transfer_sig.into()]).topic1(vec![topic_addr]);
                let base_to   = eth::Filter::new().address(usdc).topic0(vec![transfer_sig.into()]).topic2(vec![topic_addr]);

                ensure_usdc_events_table(db)?;
                let mut inserted = 0usize;
                for (lo, hi) in ranges.into_iter() {
                    for flt in [base_from.clone().from_block(lo).to_block(hi), base_to.clone().from_block(lo).to_block(hi)] {
                        match provider.get_logs(&flt) {
                            Ok(logs) => {
                                for lg in logs {
                                    let txh = match lg.transaction_hash { Some(h) => h, None => continue };
                                    if lg.topics().len() < 3 { continue; }
                                    let from_addr = &lg.topics()[1].as_slice()[12..];
                                    let to_addr = &lg.topics()[2].as_slice()[12..];
                                    let from_hex = format!("0x{}", hex::encode(from_addr));
                                    let to_hex = format!("0x{}", hex::encode(to_addr));
                                    let amount = U256::from_be_slice(lg.data().data.as_ref());
                                    let blk = lg.block_number.unwrap_or(lo);
                                    let log_index = lg.log_index.map(|v| v.into());
                                    insert_usdc_event(db, &format!("0x{}", hex::encode(tba_addr)), blk, None, &format!("0x{}", hex::encode(txh)), log_index, &from_hex, &to_hex, &amount.to_string())?;
                                    inserted += 1;
                                }
                            }
                            Err(e) => warn!("getLogs error in bisect window [{}, {}]: {:?}", lo, hi, e),
                        }
                    }
                }
                info!("Bisect USDC scan complete. Rows inserted: {}", inserted);
            } else {
                error!("Usage: usdc-scan-bisect <tba|name|namehash>");
            }
        }
        "usdc-show" => {
            // Usage: usdc-show <tba_address> [limit=50]
            if let Some(args) = command_arg {
                let parts: Vec<&str> = args.split_whitespace().collect();
                if parts.is_empty() { error!("Usage: usdc-show <tba_address> [limit=50]"); return Ok(()); }
                let addr_norm = match EthAddress::from_str(parts[0]) {
                    Ok(a) => format!("0x{}", hex::encode(a)),
                    Err(e) => { error!("Invalid address: {}", e); return Ok(()); }
                };
                let limit = parts.get(1).and_then(|v| v.parse::<u64>().ok()).unwrap_or(50);

                ensure_usdc_events_table(db)?;
                let q = r#"
                    SELECT block, time, tx_hash, log_index, from_addr, to_addr, value_units
                    FROM usdc_events
                    WHERE address = ?1
                    ORDER BY block DESC, COALESCE(log_index, 0) DESC
                    LIMIT ?2
                "#.to_string();
                let params = vec![
                    serde_json::Value::String(addr_norm.clone()),
                    serde_json::Value::Number(serde_json::Number::from(limit)),
                ];
                match db.read(q, params) {
                    Ok(rows) => {
                        if rows.is_empty() {
                            info!("No USDC events for {}", addr_norm);
                        } else {
                            info!("USDC events for {} (showing {}):", addr_norm, rows.len());
                            for row in rows {
                                let blk = row.get("block").and_then(|v| v.as_i64()).unwrap_or(0);
                                let ts = row.get("time").and_then(|v| v.as_i64()).unwrap_or(0);
                                let tx = row.get("tx_hash").and_then(|v| v.as_str()).unwrap_or("");
                                let li = row.get("log_index").and_then(|v| v.as_i64()).unwrap_or(0);
                                let fa = row.get("from_addr").and_then(|v| v.as_str()).unwrap_or("");
                                let ta = row.get("to_addr").and_then(|v| v.as_str()).unwrap_or("");
                                let vu = row.get("value_units").and_then(|v| v.as_str()).unwrap_or("");
                                info!("block={} ts={} tx={} log_index={} from={} to={} value(units)={} ", blk, ts, tx, li, fa, ta, vu);
                            }
                        }
                    }
                    Err(e) => error!("DB read error for usdc_show: {:?}", e),
                }
            } else {
                error!("Usage: usdc-show <tba_address> [limit=50]");
            }
        }
        "ledger-build" => {
            // Usage: usdc-ledger-build <tba>
            if let Some(args) = command_arg {
                let parts: Vec<&str> = args.split_whitespace().collect();
                if parts.is_empty() { error!("Usage: usdc-ledger-build <tba>"); return Ok(()); }
                let tba = parts[0].to_lowercase();
                ledger::ensure_usdc_events_table(db)?;
                ledger::ensure_usdc_call_ledger_table(db)?;
                let n = ledger::build_usdc_ledger_for_tba(state, db, &tba)?;
                info!("ledger-build complete for {} ({} rows)", tba, n);
            } else { error!("Usage: usdc-ledger-build <tba>"); }
        }
        "ledger-show" => {
            // Usage: usdc-ledger-show <tba> [limit=20]
            if let Some(args) = command_arg {
                let parts: Vec<&str> = args.split_whitespace().collect();
                if parts.is_empty() { error!("Usage: usdc-ledger-show <tba> [limit=20]"); return Ok(()); }
                let tba = parts[0].to_lowercase();
                let limit = parts.get(1).and_then(|v| v.parse::<u64>().ok()).unwrap_or(20);
                ledger::show_ledger(db, &tba, limit)?;
            } else { error!("Usage: usdc-ledger-show <tba> [limit=20]"); }
        }
        "ledger-clients" => {
            // Usage: ledger-clients [tba]
            // Refresh totals from ledger and print client_id -> spent/limit mapping
            let tba = if let Some(arg) = command_arg {
                arg.trim().to_lowercase()
            } else if let Some(t) = state.operator_tba_address.clone() { t.to_lowercase() } else {
                error!("No TBA provided and operator_tba_address not set");
                return Ok(());
            };

            if let Err(e) = state.refresh_client_totals_from_ledger(db, &tba) {
                error!("Failed to refresh totals from ledger: {:?}", e);
            }

            info!("Client spend mapping for {}:", tba);
            // Build list of client ids to display (union of caches and authorized_clients)
            let mut ids: Vec<String> = Vec::new();
            for k in state.authorized_clients.keys() { if !ids.iter().any(|x| x == k) { ids.push(k.clone()); } }
            for k in state.client_limits_cache.keys() { if !ids.iter().any(|x| x == k) { ids.push(k.clone()); } }
            if ids.is_empty() { info!("(no clients)"); return Ok(()); }

            for cid in ids {
                let name = state.authorized_clients.get(&cid).map(|c| c.name.clone()).unwrap_or_default();
                let entry = state.client_limits_cache.get(&cid);
                let spent_str = entry.and_then(|e| e.total_spent.clone()).unwrap_or_else(|| "0.000000".to_string());
                let limit_str = entry.and_then(|e| e.max_total.clone());
                let currency = entry.and_then(|e| e.currency.clone()).unwrap_or_else(|| "USDC".to_string());

                let spent_val = spent_str.parse::<f64>().unwrap_or(0.0);
                let limit_val = limit_str.as_deref().and_then(|s| s.parse::<f64>().ok());
                let pct = limit_val.map(|lv| if lv > 0.0 { (spent_val / lv) * 100.0 } else { 0.0 });

                if let Some(lv) = limit_val {
                    info!(
                        "client={} name={} spent=${:.6} / ${:.3} ({:.2}%) {}",
                        cid, name, spent_val, lv, pct.unwrap_or(0.0), currency
                    );
                } else {
                    info!(
                        "client={} name={} spent=${:.6} {} (no limit)",
                        cid, name, spent_val, currency
                    );
                }
            }
        }
        "usdc-history" => {
            // Usage: usdc-history <tba_address> [limit=200]
            if let Some(args) = command_arg {
                let parts: Vec<&str> = args.split_whitespace().collect();
                if parts.is_empty() { error!("Usage: usdc-history <tba_address> [limit=200]"); return Ok(()); }
                let addr_norm = match EthAddress::from_str(parts[0]) {
                    Ok(a) => format!("0x{}", hex::encode(a)),
                    Err(e) => { error!("Invalid address: {}", e); return Ok(()); }
                };
                let limit = parts.get(1).and_then(|v| v.parse::<u64>().ok()).unwrap_or(200);

                ensure_usdc_events_table(db)?;

                // Fill missing timestamps for this address (cheap cache)
                let provider = eth::Provider::new(structs::CHAIN_ID, 30000);
                let q_missing = r#"
                    SELECT DISTINCT block FROM usdc_events
                    WHERE address = ?1 AND time IS NULL
                    ORDER BY block ASC
                    LIMIT 200
                "#.to_string();
                if let Ok(rows) = db.read(q_missing.clone(), vec![serde_json::Value::String(addr_norm.clone())]) {
                    for r in rows {
                        if let Some(bn) = r.get("block").and_then(|v| v.as_i64()).map(|v| v as u64) {
                            if let Ok(Some(b)) = provider.get_block_by_number(hyperware_process_lib::eth::BlockNumberOrTag::Number(bn), false) {
                                let ts = b.header.inner.timestamp;
                                let upd = "UPDATE usdc_events SET time = ?1 WHERE address = ?2 AND block = ?3 AND time IS NULL".to_string();
                                let p = vec![serde_json::Value::Number(ts.into()), serde_json::Value::String(addr_norm.clone()), serde_json::Value::Number((bn as i64).into())];
                                let _ = db.write(upd, p, None);
                            }
                        }
                    }
                }

                // Now read ordered ascending to compute running balance
                let q = r#"
                    SELECT block, time, tx_hash, log_index, from_addr, to_addr, value_units
                    FROM usdc_events
                    WHERE address = ?1
                    ORDER BY block ASC, COALESCE(log_index, 0) ASC
                    LIMIT ?2
                "#.to_string();
                let params = vec![serde_json::Value::String(addr_norm.clone()), serde_json::Value::Number(serde_json::Number::from(limit))];
                match db.read(q, params) {
                    Ok(rows) => {
                        if rows.is_empty() { info!("No USDC events for {}", addr_norm); return Ok(()); }
                        let mut balance = U256::from(0);
                        let decimals = U256::from(1_000_000u64);
                        info!("USDC history for {} ({} events):", addr_norm, rows.len());
                        for row in rows {
                            let blk = row.get("block").and_then(|v| v.as_i64()).unwrap_or(0) as u64;
                            let ts = row.get("time").and_then(|v| v.as_i64()).unwrap_or(0);
                            let tx = row.get("tx_hash").and_then(|v| v.as_str()).unwrap_or("");
                            let li = row.get("log_index").and_then(|v| v.as_i64()).unwrap_or(0);
                            let fa = row.get("from_addr").and_then(|v| v.as_str()).unwrap_or("");
                            let ta = row.get("to_addr").and_then(|v| v.as_str()).unwrap_or("");
                            let vu = row.get("value_units").and_then(|v| v.as_str()).unwrap_or("0");
                            let amt = U256::from_str_radix(vu, 10).unwrap_or(U256::from(0));
                            let incoming = ta.eq_ignore_ascii_case(&addr_norm);
                            if incoming { balance = balance.saturating_add(amt); } else { balance = balance.saturating_sub(amt); }
                            // format amount and balance with 6 decimals
                            let amt_whole = amt / decimals; let amt_frac = (amt % decimals).to::<u64>();
                            let bal_whole = balance / decimals; let bal_frac = (balance % decimals).to::<u64>();
                            let dir = if incoming { "IN" } else { "OUT" };
                            let counterparty = if incoming { fa } else { ta };
                            info!(
                                "blk={} ts={} tx={} idx={} dir={} cp={} amt={}{}.{} bal={}{}.{}",
                                blk,
                                ts,
                                tx,
                                li,
                                dir,
                                counterparty,
                                if incoming { "+" } else { "-" },
                                amt_whole.to_string(),
                                format!("{:06}", amt_frac),
                                bal_whole.to_string(),
                                ".",
                                format!("{:06}", bal_frac),
                            );
                        }
                    }
                    Err(e) => error!("DB read error for usdc-history: {:?}", e),
                }
            } else {
                error!("Usage: usdc-history <tba_address> [limit=200]");
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
        _ => info!("Unknown command: '{}'. Type 'help' for available commands.", command_verb),
    }
    Ok(())
}
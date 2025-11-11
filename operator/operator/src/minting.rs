//! Provider registration minting operations
//!
//! This module handles minting namespace entries and setting provider notes on-chain.

use anyhow::{anyhow, Result};
use hyperware_process_lib::{
    eth::{Provider, Address as EthAddress},
    logging::{info, warn},
    signer::LocalSigner,
    wallet::{self, TxReceipt, WalletError},
};
use alloy_primitives::{Address, U256, B256, Bytes};
use alloy_sol_types::SolCall;
use std::str::FromStr;
use crate::constants::{
    HYPERMAP_ADDRESS,
    HYPR_SUFFIX,
};
use hex;

// ERC6551AccountCreated event signature: 0x79f19b3655ee38b1ce526556b7731a20c8f218fbda4a3990b6cc4172fdf88722
const ERC6551_ACCOUNT_CREATED_SIG: &str = "0x79f19b3655ee38b1ce526556b7731a20c8f218fbda4a3990b6cc4172fdf88722";
const MULTICALL_ADDRESS: &str = "0xcA11bde05977b3631167028862bE2a173976CA11";

// Note keys matching frontend
const PROVIDER_NOTE_KEY_ID: &str = "~provider-id";
const PROVIDER_NOTE_KEY_WALLET: &str = "~wallet";
const PROVIDER_NOTE_KEY_DESCRIPTION: &str = "~description";
const PROVIDER_NOTE_KEY_INSTRUCTIONS: &str = "~instructions";
const PROVIDER_NOTE_KEY_PRICE: &str = "~price";

/// Build initialization data for minting (TBA.execute with multicall for notes)
/// This will be called on the newly minted TBA to set provider notes
pub fn build_provider_initialization_data(
    provider_id: &str,
    wallet: &str,
    description: &str,
    instructions: &str,
    price: &str,
) -> Result<Vec<u8>> {
    use alloy_sol_types::sol;
    
    // Build multicall for notes
    let multicall_data = build_provider_notes_multicall(provider_id, wallet, description, instructions, price)?;
    
    // Wrap in TBA.execute(MULTICALL, multicallData, 0, 1) - DELEGATECALL
    sol! {
        function execute(address to, uint256 value, bytes calldata data, uint8 operation) external payable returns (bytes memory);
    }
    
    let multicall_address = EthAddress::from_str(MULTICALL_ADDRESS)
        .map_err(|e| anyhow!("Invalid MULTICALL_ADDRESS: {}", e))?;
    
    let execute_call = executeCall {
        to: multicall_address,
        value: U256::ZERO,
        data: Bytes::from(multicall_data),
        operation: 1u8, // DELEGATECALL
    };
    
    Ok(execute_call.abi_encode())
}

/// Build calldata for minting a namespace entry with initialization
/// Function signature: mint(address who, bytes calldata label, bytes calldata initialization, bytes calldata erc721Data, address implementation) external returns (address)
pub fn build_mint_calldata(
    owner: Address,
    label: &str,
    initialization: Vec<u8>,
    implementation: Address,
) -> Result<Vec<u8>> {
    use alloy_sol_types::sol;
    
    sol! {
        function mint(address who, bytes calldata label, bytes calldata initialization, bytes calldata erc721Data, address implementation) external returns (address);
    }
    
    // Encode label as bytes
    let label_bytes = label.as_bytes().to_vec();
    
    let mint_call = mintCall {
        who: owner,
        label: Bytes::from(label_bytes),
        initialization: Bytes::from(initialization),
        erc721Data: Bytes::default(), // Empty ERC721 data
        implementation,
    };
    
    Ok(mint_call.abi_encode())
}

/// Mint namespace entry with provider notes in one transaction
/// Uses parent TBA (grid.hypr) to call Hypermap.mint with initialization data
/// The signer (hot wallet) must be authorized to execute on the parent TBA
pub fn mint_namespace_entry_with_notes(
    parent_tba_address: Address,
    owner: Address,
    label: &str,
    provider_id: &str,
    wallet: &str,
    description: &str,
    instructions: &str,
    price: &str,
    implementation: Address,
    signer: &LocalSigner,
    provider: &Provider,
) -> Result<TxReceipt, WalletError> {
    use hyperware_process_lib::hypermap;
    
    // Calculate namehash for logging
    let full_name = format!("{}{}", label, HYPR_SUFFIX);
    let namehash = hypermap::namehash(&full_name);
    info!("Minting namespace entry: name={}, namehash={}, owner={}", full_name, namehash, owner);
    
    // Build initialization data (TBA.execute with multicall for notes)
    let initialization = build_provider_initialization_data(provider_id, wallet, description, instructions, price)
        .map_err(|e| WalletError::NameResolutionError(format!("Failed to build initialization data: {}", e)))?;
    
    // Build mint calldata for Hypermap.mint
    let mint_calldata = build_mint_calldata(owner, label, initialization, implementation)
        .map_err(|e| WalletError::NameResolutionError(format!("Failed to build mint calldata: {}", e)))?;
    
    let hypermap_address = EthAddress::from_str(HYPERMAP_ADDRESS)
        .map_err(|e| WalletError::NameResolutionError(format!("Invalid HYPERMAP_ADDRESS: {}", e)))?;
    
    info!("Minting namespace entry via parent TBA: parent_tba={}, owner={}, label={}", 
          parent_tba_address, owner, label);
    
    // Execute via parent TBA (CALL operation) to Hypermap.mint
    // The signer (hot wallet) must be authorized (e.g., via delegation) to execute on parent TBA
    wallet::execute_via_tba_with_signer(
        &parent_tba_address.to_string(),
        signer,
        &hypermap_address.to_string(),
        mint_calldata,
        U256::ZERO,
        provider,
        Some(0), // CALL operation
    )
}

/// Extract TBA address from ERC6551AccountCreated event in transaction logs
pub fn extract_tba_from_logs(tx_hash: B256, provider: &Provider) -> Result<Address> {
    // Wait for transaction receipt (confirmations: 1, timeout: 60 seconds)
    let receipt = wallet::wait_for_transaction(tx_hash, provider.clone(), 1, 60)
        .map_err(|e| anyhow!("Failed to get transaction receipt: {}", e))?;
    
    let receipt_inner = receipt.inner;
    let logs = receipt_inner.logs();
    
    info!("Searching {} logs for ERC6551AccountCreated event", logs.len());
    
    // ERC6551AccountCreated event signature (keccak256 hash)
    let event_sig_bytes = hex::decode(ERC6551_ACCOUNT_CREATED_SIG.strip_prefix("0x").unwrap_or(ERC6551_ACCOUNT_CREATED_SIG))
        .map_err(|e| anyhow!("Failed to decode event signature: {}", e))?;
    let event_sig = B256::from_slice(&event_sig_bytes);
    
    for log in logs {
        // Check if this is the ERC6551AccountCreated event
        if let Some(first_topic) = log.topics().first() {
            if first_topic.as_slice() == event_sig.as_slice() {
                info!("Found ERC6551AccountCreated event");
                
                // Parse the data field
                // Data structure: account (32 bytes padded) + salt (32 bytes) + chainId (32 bytes)
                // Account is 20 bytes padded to 32 bytes, so we skip first 12 bytes
                let data = log.data().data.as_ref();
                if data.len() >= 32 {
                    // Extract account address (first 20 bytes, skipping 12 bytes of padding)
                    let account_bytes = &data[12..32];
                    let tba_address = Address::from_slice(account_bytes);
                    
                    info!("Extracted TBA address: {}", tba_address);
                    return Ok(tba_address);
                } else {
                    warn!("ERC6551AccountCreated event found but data field is too short");
                }
            }
        }
    }
    
    Err(anyhow!("Could not extract TBA address from transaction logs"))
}

/// Build calldata for setting a single note
/// Function signature: note(bytes calldata noteKey, bytes calldata noteValue) external returns (bytes32 labelhash)
pub fn build_note_calldata(note_key: &str, note_value: &str) -> Result<Vec<u8>> {
    use alloy_sol_types::sol;
    
    sol! {
        function note(bytes calldata noteKey, bytes calldata noteValue) external returns (bytes32 labelhash);
    }
    
    let key_bytes = note_key.as_bytes().to_vec();
    let value_bytes = note_value.as_bytes().to_vec();
    
    let note_call = noteCall {
        noteKey: Bytes::from(key_bytes),
        noteValue: Bytes::from(value_bytes),
    };
    
    Ok(note_call.abi_encode())
}

/// Build multicall calldata for setting multiple provider notes
pub fn build_provider_notes_multicall(
    provider_id: &str,
    wallet: &str,
    description: &str,
    instructions: &str,
    price: &str,
) -> Result<Vec<u8>> {
    use alloy_sol_types::sol;
    
    // Build individual note calls
    let note_calls = vec![
        build_note_calldata(PROVIDER_NOTE_KEY_ID, provider_id)?,
        build_note_calldata(PROVIDER_NOTE_KEY_WALLET, wallet)?,
        build_note_calldata(PROVIDER_NOTE_KEY_DESCRIPTION, description)?,
        build_note_calldata(PROVIDER_NOTE_KEY_INSTRUCTIONS, instructions)?,
        build_note_calldata(PROVIDER_NOTE_KEY_PRICE, price)?,
    ];
    
    // Build multicall aggregate
    sol! {
        struct Call {
            address target;
            bytes callData;
        }
        function aggregate(Call[] calls) external payable returns (uint256 blockNumber, bytes[] returnData);
    }
    
    let hypermap_address = EthAddress::from_str(HYPERMAP_ADDRESS)
        .map_err(|e| anyhow!("Invalid HYPERMAP_ADDRESS: {}", e))?;
    
    let calls: Vec<Call> = note_calls
        .into_iter()
        .map(|call_data| Call {
            target: hypermap_address,
            callData: Bytes::from(call_data),
        })
        .collect();
    
    let aggregate_call = aggregateCall {
        calls: calls.into(),
    };
    
    Ok(aggregate_call.abi_encode())
}

/// Set provider notes via TBA.execute with multicall (DELEGATECALL)
pub fn set_provider_notes(
    tba_address: Address,
    provider_id: &str,
    wallet: &str,
    description: &str,
    instructions: &str,
    price: &str,
    signer: &LocalSigner,
    provider: &Provider,
) -> Result<TxReceipt, WalletError> {
    info!("Setting provider notes via multicall for TBA: {}", tba_address);
    
    // Build multicall calldata
    let multicall_data = build_provider_notes_multicall(provider_id, wallet, description, instructions, price)
        .map_err(|e| WalletError::NameResolutionError(format!("Failed to build multicall: {}", e)))?;
    
    let multicall_address = EthAddress::from_str(MULTICALL_ADDRESS)
        .map_err(|e| WalletError::NameResolutionError(format!("Invalid MULTICALL_ADDRESS: {}", e)))?;
    
    // Execute via TBA with DELEGATECALL (operation 1)
    wallet::execute_via_tba_with_signer(
        &tba_address.to_string(),
        signer,
        &multicall_address.to_string(),
        multicall_data,
        U256::ZERO,
        provider,
        Some(1), // DELEGATECALL
    )
}


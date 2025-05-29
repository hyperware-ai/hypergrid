use alloy_sol_types::SolEvent;
use hyperware_process_lib::eth::Filter;
use hyperware_process_lib::logging::{debug, info, error};
use hyperware_process_lib::sqlite::Sqlite;
use hyperware_process_lib::{eth, hypermap, print_to_terminal, timer};
use hyperware_process_lib::eth::{Provider, EthError};
use alloy_primitives::{Bytes, Address, U256, B256};
use anyhow::Result;
use std::str::FromStr;

use crate::db as dbm;
use crate::structs::*;
use alloy_primitives::keccak256;

const MAX_PENDING_ATTEMPTS: u8 = 3;
// const SUBSCRIPTION_TIMEOUT: u64 = 60;
pub fn make_filters(state: &State) -> (eth::Filter, eth::Filter) {
    let address = state.hypermap.address().to_owned();
    let mint_filter = eth::Filter::new()
        .address(address.clone())
        .from_block(state.last_checkpoint_block)
        .to_block(eth::BlockNumberOrTag::Latest)
        .event(hypermap::contract::Mint::SIGNATURE);
    let notes_filter = eth::Filter::new()
        .address(address)
        .from_block(state.last_checkpoint_block)
        .to_block(eth::BlockNumberOrTag::Latest)
        .event(hypermap::contract::Note::SIGNATURE)
        .topic3(vec![
            keccak256("~description"),
            keccak256("~instructions"),
            keccak256("~price"),
            keccak256("~wallet"),
            keccak256("~provider-id"),
            keccak256("~provider-name"),
            keccak256("~site"),
        ]);
    (mint_filter, notes_filter)
}
pub fn start_fetch(state: &mut State, db: &Sqlite) -> PendingLogs {
    let (mints_filter, notes_filter) = make_filters(&state);

    // Restore subscribe_loop for mint events
    state
        .hypermap
        .provider
        .subscribe_loop(11, mints_filter.clone(), 0, 1); // verbosity 1 for error in loop
    info!("Initiated Mint event subscription loop (sub_id 11).");

    // Restore subscribe_loop for note events
    state
        .hypermap
        .provider
        .subscribe_loop(22, notes_filter.clone(), 0, 1); // verbosity 1 for error in loop
    info!("Initiated Note event subscription loop (sub_id 22).");

    let mut pending_logs: PendingLogs = Vec::new();
    timer::set_timer(DELAY_MS, None);
    timer::set_timer(CHECKPOINT_MS, Some(b"checkpoint".to_vec()));
    
    fetch_and_process_logs(state, db, &mut pending_logs, &mints_filter);
    fetch_and_process_logs(state, db, &mut pending_logs, &notes_filter);
    pending_logs
}

fn fetch_and_process_logs(
    state: &mut State,
    db: &Sqlite,
    pending: &mut PendingLogs,
    filter: &Filter,
) {
    let mut retries = 0;
    const MAX_FETCH_RETRIES: u32 = 5; // Max 5 retries for a given fetch attempt
    let mut current_delay_secs = 5; // Initial delay, can be made dynamic

    loop {
        if retries >= MAX_FETCH_RETRIES {
            error!(
                "Max retries ({}) reached for get_logs with filter: {:?}. Aborting fetch for this filter.",
                MAX_FETCH_RETRIES, filter
            );
            return; // Give up after max retries for this specific filter instance
        }
        match state.hypermap.provider.get_logs(filter) {
            Ok(logs) => {
                print_to_terminal(2, &format!("log len: {}", logs.len()));
                for log in logs {
                    if let Err(e) = handle_log(state, db, pending, &log, 0) {
                        print_to_terminal(1, &format!("log-handling error! {e:?}"));
                    }
                }
                return;
            }
            Err(e) => {
                retries += 1;
                error!( // Changed to error! and added more context
                    "Error fetching logs (attempt {}/{}) for filter {:?}: {:?}. Retrying in {}s...",
                    retries, MAX_FETCH_RETRIES, filter, e, current_delay_secs
                );
                std::thread::sleep(std::time::Duration::from_secs(current_delay_secs));
                // Optional: Implement exponential backoff or increase delay systematically
                // current_delay_secs = (current_delay_secs * 2).min(60); // Example: double delay, cap at 60s
            }
        }
    }
}

pub fn handle_log(
    state: &mut State,
    db: &Sqlite,
    pending: &mut PendingLogs,
    log: &eth::Log,
    attempt: u8,
) -> anyhow::Result<()> {
    let topics = log.topics();
    debug!("log topics len: {:?}", topics.len());
    let processed = match topics[0] {
        hypermap::contract::Mint::SIGNATURE_HASH => {
            let decoded = hypermap::contract::Mint::decode_log_data(log.data(), true).unwrap();
            let parent_hash = decoded.parenthash.to_string();
            let child_hash = decoded.childhash.to_string();
            let label = String::from_utf8(decoded.label.to_vec())?;

            add_mint(state, db, &parent_hash, child_hash, label)
        }
        hypermap::contract::Note::SIGNATURE_HASH => {
            let decoded = hypermap::contract::Note::decode_log_data(log.data(), true).unwrap();

            let parent_hash = decoded.parenthash.to_string();
            let note_label = String::from_utf8(decoded.label.to_vec())?;

            add_note(state, db, &parent_hash, note_label, decoded.data)
        }
        _ => Ok(()),
    };

    if let Some(block_number) = log.block_number {
        state.last_checkpoint_block = block_number;
    }

    match processed {
        Ok(_) => (),
        Err(_e) => {
            if attempt < MAX_PENDING_ATTEMPTS {
                pending.push((log.to_owned(), attempt + 1));
            } else {
                 info!("Max attempts reached for log processing: {:?}", log);
            }
        }
    };

    Ok(())
}

pub fn add_mint(
    state: &mut State,
    db: &Sqlite,
    parent_hash: &str,
    child_hash: String,
    name: String,
) -> anyhow::Result<()> {
    if name == "hpn-testing-beta" { // TODO: Make root configurable
        state.root_hash = Some(child_hash);
        return Ok(());
    }

    let root = state.root_hash.clone().unwrap_or_default();
    if parent_hash == root {
        state.categories.insert(child_hash.clone(), name.clone());
        dbm::insert_category(db, child_hash, name)?;
        Ok(())
    } else if state.categories.contains_key(parent_hash) { 
        dbm::insert_provider(db, parent_hash, child_hash.clone(), name.clone())?;
        Ok(())
    } else {
        // If parent is neither root nor a category, return error for pending logic
        Err(anyhow::anyhow!("Parent {} not found for mint {}", parent_hash, name))
    }
    // Removed implicit Ok(()) - now handled in branches
}

pub fn add_note(
    state: &mut State,
    db: &Sqlite,
    parent_hash: &str,
    note_label: String,
    data: eth::Bytes,
) -> anyhow::Result<()> {
    let key = note_label
        .chars()
        .skip(1) // Skip the leading '~'
        .collect::<String>()
        .replace("-", "_"); 

    // We assume the provider must exist if a note is emitted for its hash.
    // If insert_provider_facts fails due to FK constraint (provider not yet minted),
    // this note processing will error out and retry via pending mechanism.
    let decoded_value = match String::from_utf8(data.to_vec()) {
        Ok(s) => s,
        Err(_) => {
            format!("0x{}", hex::encode(data))
        }
    };
    dbm::insert_provider_facts(db, key, decoded_value, parent_hash.to_string())
        .map_err(|e| anyhow::anyhow!("DB Error inserting fact for {}: {}", parent_hash, e))
}

fn handle_pending(state: &mut State, db: &Sqlite, pending: &mut PendingLogs) {
    let mut newpending: PendingLogs = Vec::new();
    let current_len = pending.len();
    if current_len > 0 {
        info!("Processing {} pending logs...", current_len);
    }
    for (log, attempt) in pending.drain(..) {
        let _ = handle_log(state, db, &mut newpending, &log, attempt);
    }
    if !newpending.is_empty() {
         info!("{} logs remain pending.", newpending.len());
    }
    pending.extend(newpending);
}
pub fn handle_eth_message(
    state: &mut State,
    db: &Sqlite,
    pending: &mut PendingLogs,
    body: &[u8],
) -> anyhow::Result<()> {
    debug!("handling eth message");
    match serde_json::from_slice::<eth::EthSubResult>(body) {
        Ok(Ok(eth::EthSub { result, id })) => { 
            if let Ok(eth::SubscriptionResult::Log(log)) =
                serde_json::from_value::<eth::SubscriptionResult>(result)
            {
                if let Err(e) = handle_log(state, db, pending, &log, 0) {
                    print_to_terminal(1, &format!(" log-handling error! {e:?}"));
                }
            } else {
                debug!("Received non-log subscription result");
            }
        }
        Ok(Err(e)) => { // EthSubError from eth:distro:sys indicating a problem with the subscription itself
            error!( // Changed from info! to error! and logging e.error for more detail
                "Eth subscription error for sub_id {}: {}. Attempting to resubscribe.",
                e.id, e.error // e.error contains the specific error string from EthSubError
            );
            // Use subscription id (e.id) from error to resubscribe correctly
            let (mint_filter, note_filter) = make_filters(state);
            if e.id == 11 { // Assuming 11 was for mints
                state
                    .hypermap
                    .provider
                    .subscribe_loop(11, mint_filter, 2, 1); // verbosity 1 for error in loop
            } else if e.id == 22 { // Assuming 22 was for notes
                state
                    .hypermap
                    .provider
                    .subscribe_loop(22, note_filter, 2, 1); // verbosity 1 for error in loop
            } else {
                 error!("Unknown subscription ID {} received in EthSubError while attempting to resubscribe.", e.id);
            }
        }
        Err(e) => {
             info!("Failed to deserialize EthSubResult: {}", e);
        }
    }

    Ok(())
}

pub fn handle_timer(
    state: &mut State,
    db: &Sqlite,
    pending: &mut PendingLogs,
    is_checkpoint: bool,
) -> anyhow::Result<()> {
    debug!("handling timer - pending: {:?}", pending.len());
    let block_number = state.hypermap.provider.get_block_number();
    if let Ok(block_number) = block_number {
        debug!("Current block: {}", block_number);
        state.last_checkpoint_block = block_number;
        if is_checkpoint {
            info!("Checkpointing state at block {}", block_number);
            state.save();
            // Reset checkpoint timer
            timer::set_timer(CHECKPOINT_MS, Some(b"checkpoint".to_vec()));
        }
    }
    handle_pending(state, db, pending);
    debug!("new pending: {:?}", pending.len());

    // Always reset the delay timer
    timer::set_timer(DELAY_MS, None);
    Ok(())
}

/// Fetches the raw data bytes from a specific Hypermap note.
///
/// # Arguments
/// * `provider` - An Ethereum provider instance.
/// * `note_path` - The full path to the note (e.g., "~wallet.provider.hpn-beta.hypr").
///
/// # Returns
/// A `Result<Option<Bytes>>` containing the note data if found, None if the note
/// doesn't exist or has no data, or an `anyhow::Error` on RPC or other errors.
pub fn get_hypermap_note_data(provider: &Provider, note_path: &str) -> Result<Option<Bytes>> {
    info!("Attempting to fetch Hypermap note data for: {}", note_path);

    // Create a Hypermap instance using the provider's chain ID and a default timeout.
    // Parse the constant string address into the correct alloy_primitives::Address type.
    let hypermap_address = Address::from_str(hypermap::HYPERMAP_ADDRESS)
        .map_err(|e| anyhow::anyhow!("Failed to parse HYPERMAP_ADDRESS constant: {}", e))?;
    let hypermap_reader = hypermap::Hypermap::new(provider.clone(), hypermap_address);

    match hypermap_reader.get(note_path) {
        Ok((_tba, _owner, data_option)) => {
            info!("Successfully fetched note data for {}: data_present={}", note_path, data_option.is_some());
            Ok(data_option)
        }
        Err(EthError::RpcError(msg)) => {
            // Check if the error indicates the note likely doesn't exist.
            // This might need refinement based on actual RPC error messages.
            let msg_str = msg.to_string();
            if msg_str.contains("Execution reverted") || msg_str.contains("invalid opcode") || msg_str.contains("provided hex string was not a prefix of a hex sequence") || msg_str.contains("invalid length") {
                info!("Note {} likely not found or entry is invalid: {}", note_path, msg_str);
                Ok(None) // Treat as "not found"
            } else {
                // Propagate other RPC errors
                error!("RPC error fetching note {}: {}", note_path, msg_str);
                Err(anyhow::anyhow!("RPC error fetching note {}: {}", note_path, msg_str))
            }
        }
        Err(e) => {
            // Propagate other errors (like InvalidParams, etc.)
            error!("Error fetching note {}: {:?}", note_path, e);
            Err(anyhow::Error::from(e).context(format!("Failed to get Hypermap note data for {}", note_path)))
        }
    }
}

/// Reads the ERC-1967 proxy implementation slot for a given address.
///
/// # Arguments
/// * `provider` - An Ethereum provider instance.
/// * `proxy_address` - The address of the proxy contract (e.g., a TBA).
///
/// # Returns
/// A `Result<Address>` containing the implementation address if found,
/// or an `anyhow::Error` on RPC or parsing errors.
pub fn get_implementation_address(provider: &Provider, proxy_address: Address) -> Result<Address> {
    info!("Fetching implementation address for: {}", proxy_address);
    let slot_bytes = B256::from_str("0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc")
        .expect("ERC-1967 Slot Hash is valid"); // Use expect for constants
    let slot_u256 = U256::from_be_bytes(slot_bytes.0); // Convert B256 bytes to U256

    match provider.get_storage_at(proxy_address, slot_u256, None) { // None means latest block
        Ok(value_b256) => { // Return value is B256
            let value_bytes: &[u8] = &value_b256.0;
            if value_bytes.len() == 32 { // Should always be 32 for B256
                // Address is the last 20 bytes (index 12 to 31)
                let implementation_address = Address::from_slice(&value_bytes[12..32]);
                info!("Found implementation address: {}", implementation_address);
                Ok(implementation_address)
            } else {
                error!("Storage slot value B256 has unexpected length: {}", value_bytes.len());
                Err(anyhow::anyhow!("Invalid storage slot value length"))
            }
        }
        Err(e) => {
            error!("Failed to get storage slot for {}: {:?}", proxy_address, e);
            Err(anyhow::Error::from(e).context(format!("Failed to get implementation slot for {}", proxy_address)))
        }
    }
} 
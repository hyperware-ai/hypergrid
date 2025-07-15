use alloy_sol_types::SolEvent;
use hyperware_process_lib::eth::Filter;
use hyperware_process_lib::logging::{debug, info, error, warn};
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
        .event(hypermap::contract::Mint::SIGNATURE);
    let notes_filter = eth::Filter::new()
        .address(address)
        .event(hypermap::contract::Note::SIGNATURE)
        .topic3(vec![
            keccak256("~description"),
            keccak256("~instructions"),
            keccak256("~price"),
            keccak256("~wallet"),
            keccak256("~provider-id"),
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
    
    // Only initialize timers if they haven't been initialized yet
    if !state.timers_initialized {
        info!("Initializing chain sync timers...");
        timer::set_timer(DELAY_MS, None);
        timer::set_timer(CHECKPOINT_MS, Some(b"checkpoint".to_vec()));
        state.timers_initialized = true;
    } else {
        warn!("Timers already initialized, skipping timer initialization in start_fetch");
    }
    
    // --- Try to get historical logs from the local hypermap-cacher ---
    info!("Attempting to bootstrap historical Mint/Note logs from local hypermap cache");
    let filters_vec = vec![mints_filter.clone(), notes_filter.clone()];

    let bootstrap_block = match state
        .hypermap
        .bootstrap(
            Some(state.last_checkpoint_block), 
            filters_vec, 
            Some((5, None)), // (retry_delay_s, retry_count)
            None
        )
    {
        Ok((block, results_per_filter)) => {
            if results_per_filter.len() == 2 {
                let mint_logs = &results_per_filter[0];
                let note_logs = &results_per_filter[1];

                info!("Bootstrapped {} mint logs and {} note logs from cache up to block {}.", 
                      mint_logs.len(), note_logs.len(), block);

                for log in mint_logs {
                    if let Err(e) = handle_log(state, db, &mut pending_logs, log, 0) {
                        print_to_terminal(1, &format!("log-handling error! {e:?}"));
                    }
                }

                for log in note_logs {
                    if let Err(e) = handle_log(state, db, &mut pending_logs, log, 0) {
                        print_to_terminal(1, &format!("log-handling error! {e:?}"));
                    }
                }
                
                // Update the state's last checkpoint block to the returned block
                if block > state.last_checkpoint_block {
                    state.last_checkpoint_block = block;
                }
                
                Some(block)
            } else {
                error!("Unexpected bootstrap result length: {}, bootstrap failed", results_per_filter.len());
                None
            }
        }
        Err(e) => {
            error!("Bootstrap from cache failed: {:?}", e);
            None
        }
    };

    // If bootstrap succeeded, only fetch logs from the bootstrap block to current to fill any gap
    // If bootstrap failed, fetch all logs from last checkpoint
    if let Some(bootstrap_block) = bootstrap_block {
        // Only fetch logs newer than what bootstrap gave us
        if bootstrap_block < state.hypermap.provider.get_block_number().unwrap_or(bootstrap_block) {
            info!("Fetching gap logs from block {} to latest", bootstrap_block);
            let gap_mints_filter = mints_filter.from_block(bootstrap_block + 1);
            let gap_notes_filter = notes_filter.from_block(bootstrap_block + 1);
            fetch_and_process_logs(state, db, &mut pending_logs, &gap_mints_filter);
            fetch_and_process_logs(state, db, &mut pending_logs, &gap_notes_filter);
        }
    } else {
        // Bootstrap failed, fall back to full RPC fetch from last checkpoint
        info!("Bootstrap failed, falling back to full RPC log fetch from block {}", state.last_checkpoint_block);
        let fallback_mints_filter = mints_filter.from_block(state.last_checkpoint_block);
        let fallback_notes_filter = notes_filter.from_block(state.last_checkpoint_block);
        fetch_and_process_logs(state, db, &mut pending_logs, &fallback_mints_filter);
        fetch_and_process_logs(state, db, &mut pending_logs, &fallback_notes_filter);
    }

    pending_logs
}

fn fetch_and_process_logs(
    state: &mut State,
    db: &Sqlite,
    pending: &mut PendingLogs,
    filter: &Filter,
) {
    let mut retries = 0;
    const MAX_FETCH_RETRIES: u32 = 2; // Max 2 retries for a given fetch attempt
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
        Err(e) => {
            if attempt < MAX_PENDING_ATTEMPTS {
                pending.push((log.to_owned(), attempt + 1));
            } else {
                 info!("Max attempts reached for log processing: {:?}. Error: {:?}", log, e);
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
    // Log every mint we see
    info!("Processing mint: '{}' with hash {} and parent {}", name, child_hash, parent_hash);
    
    // Check if this is the Hypergrid root entry (grid-beta under hypr)
    // The parent hash 0x29575a1a0473dcc0e00d7137198ed715215de7bffd92911627d5e008410a5826 is 'hypr'
    if name == "grid-beta" {
        // We found a grid-beta entry, let's check if it's under hypr
        let hypr_hash = "0x29575a1a0473dcc0e00d7137198ed715215de7bffd92911627d5e008410a5826";
        if parent_hash == hypr_hash {
            info!("Found Grid root entry: {} with hash {} (parent: {} which is 'hypr')", name, child_hash, parent_hash);
            state.root_hash = Some(child_hash.clone());
            return Ok(());
        } else {
            // Log what parent this grid-beta has for debugging
            let parent_name = hyperware_process_lib::net::get_name(parent_hash, Some(state.last_checkpoint_block), Some(1))
                .unwrap_or_else(|| "unknown".to_string());
            info!("Found entry named 'grid-beta' under parent {} ({}), but we need grid-beta.hypr", parent_hash, parent_name);
            // This grid-beta is not ours, skip it
            return Ok(());
        }
    }

    let root = state.root_hash.clone().unwrap_or_default();
    if root.is_empty() {
        // Root not set yet, this mint needs to wait
        return Err(anyhow::anyhow!("Hypergrid root (grid-beta.hypr) not yet found, deferring mint {} with parent {}", name, parent_hash));
    }
    
    // Check if this mint is under our scope (parent should be grid-beta.hypr)
    if parent_hash != &root {
        // This mint is not directly under grid-beta.hypr
        // Try to resolve what the parent is to log it
        let parent_name = hyperware_process_lib::net::get_name(parent_hash, Some(state.last_checkpoint_block), Some(1))
            .unwrap_or_else(|| "unknown".to_string());
        
        debug!("Skipping mint '{}' with parent {} ({}) - not a direct child of grid-beta.hypr", 
              name, parent_hash, parent_name);
        
        // Return Ok so it won't retry
        return Ok(());
    }
    
    // This is a provider directly under grid-beta.hypr
    dbm::insert_provider(db, parent_hash, child_hash.clone(), name.clone())?;
    info!("Added provider: {} directly under grid-beta.hypr", name);
    Ok(())
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

    // Check if the Hypergrid root is set
    if state.root_hash.is_none() {
        return Err(anyhow::anyhow!("Hypergrid root (grid-beta.hypr) not yet found, deferring note {} for parent {}", note_label, parent_hash));
    }

    // First, check if this note is for something under our Hypergrid scope
    // We need to verify the parent exists in our database OR will be created under grid-beta.hypr
    let provider_check = db.read(
        "SELECT id FROM providers WHERE hash = ?1 LIMIT 1".to_string(),
        vec![serde_json::Value::String(parent_hash.to_string())]
    );
    
    match provider_check {
        Ok(rows) if !rows.is_empty() => {
            // Provider exists in our database, proceed with the note
        }
        _ => {
            // Provider doesn't exist in our database
            // Check if there's a pending mint for this provider under grid-beta.hypr
            // If not, this note is for a provider outside our scope
            debug!("Note {} for provider {} not in our database - checking if it's outside Hypergrid scope", note_label, parent_hash);
            
            // Try to resolve what this parent is
            let parent_name = hyperware_process_lib::net::get_name(parent_hash, Some(state.last_checkpoint_block), Some(2))
                .unwrap_or_else(|| "unresolved".to_string());
            
            if !parent_name.ends_with(".grid-beta.hypr") && parent_name != "unresolved" {
                // This provider is not under grid-beta.hypr, skip it
                debug!("Skipping note {} for provider {} ({}) - outside Hypergrid scope (not under grid-beta.hypr)", 
                      note_label, parent_hash, parent_name);
                return Ok(()); // Return Ok to avoid retrying
            }
            
            // If we can't resolve or it might be under grid-beta.hypr, defer it
            return Err(anyhow::anyhow!("Provider {} not found for note {} - deferring", parent_hash, note_label));
        }
    }

    // We assume the provider must exist if a note is emitted for its hash.
    // If insert_provider_facts fails due to FK constraint (provider not yet minted),
    // this note processing will error out and retry via pending mechanism.
    let decoded_value = match String::from_utf8(data.to_vec()) {
        Ok(s) => s,
        Err(_) => {
            format!("0x{}", hex::encode(data))
        }
    };
    
    // Try to resolve the parent hash to a name for better logging
    let parent_name = {
        // First try the hypermap indexer to resolve hash to name
        match hyperware_process_lib::net::get_name(parent_hash, Some(state.last_checkpoint_block), Some(2)) {
            Some(name) => format!("(resolved: {})", name),
            None => {
                // If indexer fails, check if this parent_hash exists in our database
                match db.read(
                    "SELECT name FROM providers WHERE hash = ?1 LIMIT 1".to_string(),
                    vec![serde_json::Value::String(parent_hash.to_string())]
                ) {
                    Ok(rows) if !rows.is_empty() => {
                        rows[0].get("name")
                            .and_then(|v| v.as_str())
                            .map(|s| format!("(known provider: {})", s))
                            .unwrap_or_else(|| "(provider exists but name unknown)".to_string())
                    }
                    _ => "(unknown/not-indexed)".to_string()
                }
            }
        }
    };
    
    // Log which note we're trying to insert with more context
    debug!("Attempting to insert note '{}' (key: '{}') for provider {} {}, value: '{}'", 
           note_label, key, parent_hash, parent_name, decoded_value);
    
    dbm::insert_provider_facts(db, key.clone(), decoded_value, parent_hash.to_string())
        .map_err(|e| anyhow::anyhow!("DB Error inserting note {} (key: {}) for provider {} {}: {}", 
                                      note_label, key, parent_hash, parent_name, e))
}

fn handle_pending(state: &mut State, db: &Sqlite, pending: &mut PendingLogs) {
    let mut newpending: PendingLogs = Vec::new();
    let current_len = pending.len();
    if current_len > 0 {
        info!("Processing {} pending logs...", current_len);
        
        // Log root status
        match &state.root_hash {
            Some(hash) => info!("Hypergrid root (grid-beta.hypr) is set to: {}", hash),
            None => warn!("Hypergrid root (grid-beta.hypr) not yet found! All provider mints and notes will be deferred."),
        }
    }
    
    let mut outside_scope_count = 0;
    
    for (log, attempt) in pending.drain(..) {
        match handle_log(state, db, &mut newpending, &log, attempt) {
            Ok(_) => {
                // Successfully processed (could mean it was skipped as outside scope)
            }
            Err(e) => {
                // Check if this is a note for a provider outside Hypergrid scope
                if e.to_string().contains("outside Hypergrid scope") {
                    outside_scope_count += 1;
                }
            }
        }
    }
    
    if outside_scope_count > 0 {
        info!("Filtered out {} logs that are outside Hypergrid scope (not under grid-beta.hypr)", outside_scope_count);
    }
    
    if !newpending.is_empty() {
        info!("{} logs remain pending.", newpending.len());
        
        // Count different types of pending logs
        let mut mint_count = 0;
        let mut note_count = 0;
        let mut provider_mints = Vec::new();
        
        for (log, _) in newpending.iter() {
            if let Some(topic) = log.topics().get(0) {
                match *topic {
                    hypermap::contract::Mint::SIGNATURE_HASH => {
                        mint_count += 1;
                        if let Ok(decoded) = hypermap::contract::Mint::decode_log_data(log.data(), true) {
                            let parent_hash = decoded.parenthash.to_string();
                            // Check if this might be a provider (parent is grid-beta.hypr)
                            if let Some(root) = &state.root_hash {
                                if parent_hash == *root {
                                    let label = String::from_utf8_lossy(&decoded.label);
                                    provider_mints.push((label.to_string(), decoded.childhash.to_string()));
                                }
                            }
                        }
                    }
                    hypermap::contract::Note::SIGNATURE_HASH => note_count += 1,
                    _ => {}
                }
            }
        }
        
        info!("Pending breakdown: {} mints, {} notes", mint_count, note_count);
        
        // Show provider mints that should be under grid-beta.hypr
        if !provider_mints.is_empty() {
            info!("Found {} provider mints waiting to be processed under grid-beta.hypr:", provider_mints.len());
            for (name, hash) in provider_mints.iter().take(10) {
                info!("  - Provider '{}' with hash {}", name, hash);
            }
        }
        
        // Sample first few pending logs to show what's stuck
        for (log, attempt) in newpending.iter().take(5) {
            if let Some(topic) = log.topics().get(0) {
                match *topic {
                    hypermap::contract::Mint::SIGNATURE_HASH => {
                        if let Ok(decoded) = hypermap::contract::Mint::decode_log_data(log.data(), true) {
                            let label = String::from_utf8_lossy(&decoded.label);
                            let parent_hash = decoded.parenthash.to_string();
                            let parent_name = hyperware_process_lib::net::get_name(&parent_hash, Some(state.last_checkpoint_block), Some(1))
                                .unwrap_or_else(|| "unresolved".to_string());
                            info!("Pending mint (attempt {}): '{}' with parent {} ({})", 
                                  attempt, label, parent_hash, parent_name);
                        }
                    }
                    hypermap::contract::Note::SIGNATURE_HASH => {
                        if let Ok(decoded) = hypermap::contract::Note::decode_log_data(log.data(), true) {
                            let label = String::from_utf8_lossy(&decoded.label);
                            let parent_hash = decoded.parenthash.to_string();
                            let parent_name = hyperware_process_lib::net::get_name(&parent_hash, Some(state.last_checkpoint_block), Some(1))
                                .unwrap_or_else(|| "unresolved".to_string());
                            info!("Pending note (attempt {}): '{}' for parent {} ({})", 
                                  attempt, label, parent_hash, parent_name);
                        }
                    }
                    _ => {}
                }
            }
        }
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
    let timer_type = if is_checkpoint { "CHECKPOINT" } else { "DELAY" };
    debug!("handling timer - pending: {:?}", pending.len());
    
    let block_number = state.hypermap.provider.get_block_number();
    if let Ok(block_number) = block_number {
        debug!("Current block: {}", block_number);
        state.last_checkpoint_block = block_number;
        if is_checkpoint {
            state.save();
            // Reset checkpoint timer
            timer::set_timer(CHECKPOINT_MS, Some(b"checkpoint".to_vec()));
        } else {
            // This is a regular DELAY_MS timer event
            // Reset the delay timer ONLY when handling a delay timer event
            timer::set_timer(DELAY_MS, None);
        }
    } else {
        error!("Failed to get block number in {} timer: {:?}", timer_type, block_number);
    }
    handle_pending(state, db, pending);
    debug!("new pending: {:?}", pending.len());

    Ok(())
}

/// Fetches the raw data bytes from a specific Hypermap note.
///
/// # Arguments
/// * `provider` - An Ethereum provider instance.
/// * `note_path` - The full path to the note (e.g., "~wallet.provider.grid-beta.hypr").
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
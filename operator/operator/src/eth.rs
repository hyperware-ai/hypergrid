use crate::structs::State;
use crate::OperatorProcess;
use alloy_primitives::{keccak256, Address as EthAddress, B256};
use alloy_sol_types::SolEvent;
use hyperware_process_lib::eth::{EthSub, EthSubError, Filter, Log, SubscriptionResult};
use hyperware_process_lib::hypermap::contract::{Mint, Note};
use hyperware_process_lib::logging::{error, info};
use std::str::FromStr;

/// Create ETH filters for Mint, Note and USDC Transfer events
pub fn make_filters(state: &State) -> Vec<Filter> {
    let mut filters = Vec::new();
    
    // Use the hypermap address constant directly to avoid parsing issues
    let hypermap_address = EthAddress::from_str(hyperware_process_lib::hypermap::HYPERMAP_ADDRESS)
        .expect("Invalid HYPERMAP_ADDRESS constant");

    // Filter for Mint events
    filters.push(Filter::new().address(hypermap_address).event(&Mint::SIGNATURE));

    // Filter for Note events with topic3 filter for relevant provider facts
    filters.push(Filter::new()
        .address(hypermap_address)
        .event(&Note::SIGNATURE)
        .topic3(vec![
            keccak256("~description".as_bytes()),
            keccak256("~instructions".as_bytes()),
            keccak256("~price".as_bytes()),
            keccak256("~wallet".as_bytes()),
            keccak256("~provider-id".as_bytes()),
            keccak256("~site".as_bytes()),
        ]));

    // Filter for USDC Transfer events TO the operator TBA (if configured)
    if let Some(tba_address) = &state.operator_tba_address {
        if let Ok(usdc_address) = EthAddress::from_str(crate::constants::USDC_BASE_ADDRESS) {
            if let Ok(tba_eth) = EthAddress::from_str(tba_address) {
                // Transfer event signature
                let transfer_sig = keccak256("Transfer(address,address,uint256)");
                
                // Create padded address for topic2 ("to" address in Transfer event)
                let mut padded_tba = [0u8; 32];
                padded_tba[12..].copy_from_slice(tba_eth.as_slice());
                
                // Filter for transfers TO our TBA
                filters.push(Filter::new()
                    .address(usdc_address)
                    .event_signature(B256::from(transfer_sig))
                    .topic2(B256::from(padded_tba)));
                    
                info!("Added USDC Transfer filter for TBA: {}", tba_address);
            }
        }
    }

    filters
}

/// Bootstrap historical logs only (no live resubscription)
pub async fn bootstrap_historical(process: &mut OperatorProcess) -> Result<(), String> {
    if let Some(hypermap) = &process.hypermap {
        let filters = make_filters(&process.state);

        let result = hypermap
            .bootstrap(
                Some(process.state.last_checkpoint_block),
                filters,
                Some((5, Some(5))),
                None,
            )
            .await;

        match result {
            Ok((last_block, results_per_filter)) => {
                process_bootstrap_results(process, last_block, results_per_filter).await;
                Ok(())
            }
            Err(e) => Err(format!("Bootstrap failed: {:?}", e)),
        }
    } else {
        Err("No hypermap instance available for bootstrap".to_string())
    }
}

/// Bootstrap historical logs and set up ETH subscriptions
pub async fn setup_subscriptions(process: &mut OperatorProcess) {
    info!("Setting up ETH subscriptions");

    // First, bootstrap historical logs
    let bootstrap_result = if let Some(hypermap) = &process.hypermap {
        info!("Bootstrapping historical logs from hypermap cache");

        let filters = make_filters(&process.state);

        // Bootstrap from local cache to get historical logs
        let result = hypermap
            .bootstrap(
                Some(process.state.last_checkpoint_block),
                filters.clone(),
                Some((5, Some(5))), // retry config
                None,
            )
            .await;

        Some((result, filters))
    } else {
        error!("No hypermap instance available for ETH setup");
        None
    };

    // Process bootstrap results
    if let Some((bootstrap_result, filters)) = bootstrap_result {
        match bootstrap_result {
            Ok((last_block, results_per_filter)) => {
                process_bootstrap_results(process, last_block, results_per_filter).await;
            }
            Err(e) => {
                error!("Bootstrap failed: {:?}, starting from last checkpoint", e);
            }
        }

        // Now subscribe for live events
        subscribe_to_live_events(process, filters);
    }
}

/// Process historical logs from bootstrap
async fn process_bootstrap_results(
    process: &mut OperatorProcess,
    last_block: u64,
    results_per_filter: Vec<Vec<Log>>,
) {
    info!("Bootstrap successful up to block {}", last_block);

    if results_per_filter.len() >= 2 {
        let mint_logs = results_per_filter[0].clone();
        let note_logs = results_per_filter[1].clone();

        info!("Processing {} historical mint logs", mint_logs.len());
        for log in mint_logs {
            if let Err(e) = process_log_event(process, &log).await {
                error!("Error processing historical mint log: {}", e);
            }
        }

        info!("Processing {} historical note logs", note_logs.len());
        for log in note_logs {
            if let Err(e) = process_log_event(process, &log).await {
                error!("Error processing historical note log: {}", e);
            }
        }

        // Process USDC Transfer logs if present (3rd filter)
        if results_per_filter.len() >= 3 {
            let transfer_logs = results_per_filter[2].clone();
            info!("Processing {} historical USDC transfer logs", transfer_logs.len());
            for log in transfer_logs {
                if let Err(e) = process_log_event(process, &log).await {
                    error!("Error processing historical transfer log: {}", e);
                }
            }
        }

        // Update checkpoint to bootstrap block
        process.state.last_checkpoint_block = last_block;
    }
}

/// Subscribe to live ETH events
fn subscribe_to_live_events(process: &OperatorProcess, filters: Vec<Filter>) {
    if let Some(hypermap) = &process.hypermap {
        info!("Setting up ETH subscriptions for live events");
        
        // Subscribe to Mint events (filter 0)
        if filters.len() > 0 {
            hypermap.provider.subscribe_loop(11, filters[0].clone(), 2, 0);
            info!("Subscribed to Mint events with ID: 11");
        }
        
        // Subscribe to Note events (filter 1)
        if filters.len() > 1 {
            hypermap.provider.subscribe_loop(22, filters[1].clone(), 2, 0);
            info!("Subscribed to Note events with ID: 22");
        }
        
        // Subscribe to USDC Transfer events (filter 2)
        if filters.len() > 2 {
            hypermap.provider.subscribe_loop(33, filters[2].clone(), 2, 0);
            info!("Subscribed to USDC Transfer events with ID: 33");
        }
    }
}

/// Extract log from subscription result
pub fn extract_log_from_subscription(eth_sub: &EthSub) -> Result<Option<Log>, String> {
    match serde_json::from_value::<SubscriptionResult>(eth_sub.result.clone()) {
        Ok(SubscriptionResult::Log(log)) => {
            info!(
                "Received log event: block_number={:?}, topics={:?}",
                log.block_number,
                log.topics()
            );
            Ok(Some(*log))
        }
        Ok(_) => {
            info!("Received non-log subscription result");
            Ok(None)
        }
        Err(e) => Err(format!("Failed to parse subscription result: {}", e)),
    }
}

/// Handle a subscription error by resubscribing
pub async fn handle_subscription_error(
    process: &mut OperatorProcess,
    error: &EthSubError,
) -> Result<(), String> {
    error!(
        "ETH subscription error for sub_id {}: {}. Attempting to resubscribe.",
        error.id, error.error
    );

    resubscribe_to_events(process, error.id)?;

    Ok(())
}

/// Resubscribe to specific event type based on subscription ID
pub fn resubscribe_to_events(
    process: &OperatorProcess,
    subscription_id: u64,
) -> Result<(), String> {
    let filters = make_filters(&process.state);
    
    if let Some(hypermap) = &process.hypermap {
        match subscription_id {
            11 => {
                if filters.len() > 0 {
                    info!("Resubscribing to Mint events (ID: 11)");
                    hypermap.provider.subscribe_loop(11, filters[0].clone(), 2, 1);
                    Ok(())
                } else {
                    Err("No Mint filter available".to_string())
                }
            }
            22 => {
                if filters.len() > 1 {
                    info!("Resubscribing to Note events (ID: 22)");
                    hypermap.provider.subscribe_loop(22, filters[1].clone(), 2, 1);
                    Ok(())
                } else {
                    Err("No Note filter available".to_string())
                }
            }
            33 => {
                if filters.len() > 2 {
                    info!("Resubscribing to USDC Transfer events (ID: 33)");
                    hypermap.provider.subscribe_loop(33, filters[2].clone(), 2, 1);
                    Ok(())
                } else {
                    Err("No USDC Transfer filter available".to_string())
                }
            }
            _ => {
                error!(
                    "Unknown subscription ID {} received in EthSubError",
                    subscription_id
                );
                Err(format!("Unknown subscription ID: {}", subscription_id))
            }
        }
    } else {
        Err("No hypermap instance available".to_string())
    }
}


/// Process a log event (Mint or Note)
pub async fn process_log_event(process: &mut OperatorProcess, log: &Log) -> Result<(), String> {
    let topics = log.topics();
    //info!("Processing log with {} topics", topics.len());

    if topics.is_empty() {
        return Err("Log has no topics".to_string());
    }

    // Match on the first topic (event signature)
    let transfer_sig = keccak256("Transfer(address,address,uint256)");
    match &topics[0] {
        sig if *sig == Mint::SIGNATURE_HASH => process_mint_event(process, log).await,
        sig if *sig == Note::SIGNATURE_HASH => process_note_event(process, log).await,
        sig if sig.0 == transfer_sig => process_transfer_event(process, log).await,
        _ => {
            info!("Unknown event signature: 0x{}", hex::encode(&topics[0]));
            Ok(())
        }
    }?;

    // Update last checkpoint block if available
    if let Some(block_number) = log.block_number {
        update_checkpoint_block(&mut process.state, block_number);
    }

    Ok(())
}

/// Process a Mint event
async fn process_mint_event(process: &mut OperatorProcess, log: &Log) -> Result<(), String> {
    //info!("Processing Mint event");
    let decoded = Mint::decode_log_data(log.data(), true)
        .map_err(|e| format!("Failed to decode Mint event: {:?}", e))?;

    let parent_hash = decoded.parenthash.to_string();
    let child_hash = decoded.childhash.to_string();
    let label = String::from_utf8(decoded.label.to_vec())
        .map_err(|e| format!("Invalid UTF8 in label: {:?}", e))?;

    //info!("Mint event: parent={}, child={}, label={}", parent_hash, child_hash, label);
    add_mint(process, &parent_hash, child_hash, label).await
}

/// Process a Note event
async fn process_note_event(process: &mut OperatorProcess, log: &Log) -> Result<(), String> {
    //info!("Processing Note event");
    let decoded = Note::decode_log_data(log.data(), true)
        .map_err(|e| format!("Failed to decode Note event: {:?}", e))?;

    let parent_hash = decoded.parenthash.to_string();
    let note_label = String::from_utf8(decoded.label.to_vec())
        .map_err(|e| format!("Invalid UTF8 in label: {:?}", e))?;

    //info!("Note event: parent={}, label={}, data_len={}",
    //parent_hash, note_label, decoded.data.len());
    add_note(process, &parent_hash, note_label, decoded.data.to_vec()).await
}

/// Add a mint (parent-child relationship) to the state
pub async fn add_mint(
    process: &mut crate::OperatorProcess,
    parent_hash: &str,
    child_hash: String,
    label: String,
) -> Result<(), String> {
    //info!("Adding mint: {} -> {} ({})", parent_hash, child_hash, label);

    // Insert into database if available
    // Note: We no longer maintain the in-memory names mapping - use database instead
    if let Some(db) = &process.db_conn {
        match crate::db::insert_provider(db, parent_hash, child_hash.clone(), label.clone()).await {
            Ok(_) => {
                //info!("Provider inserted into database: {} -> {}", parent_hash, child_hash);
            }
            Err(e) => {
                //error!("Failed to insert provider into database: {:?}", e);
                // Don't fail the whole operation if db insert fails
            }
        }
    } else {
        error!("No database connection available for mint insertion");
    }

    //info!("Mint added successfully");
    Ok(())
}

/// Add a note to the state
pub async fn add_note(
    process: &mut crate::OperatorProcess,
    parent_hash: &str,
    label: String,
    data: Vec<u8>,
) -> Result<(), String> {
    //info!("Adding note: {} -> {} ({} bytes)", parent_hash, label, data.len());

    // Decode the data as UTF-8 string for provider facts
    let decoded_value = String::from_utf8(data.clone()).unwrap_or_else(|_| hex::encode(&data));

    // Normalize note label to DB column name (strip '~', convert '-' to '_')
    let normalized_key = label.trim().trim_start_matches('~').replace("-", "_");

    // Insert into database if available
    if let Some(db) = &process.db_conn {
        match crate::db::insert_provider_facts(
            db,
            normalized_key.clone(),
            decoded_value.clone(),
            parent_hash.to_string(),
        )
        .await
        {
            Ok(_) => {
                //info!("Provider fact inserted into database: {} -> {} = {}",
                //parent_hash, label, decoded_value);
            }
            Err(e) => {
                //error!("Failed to insert provider fact into database: {:?}", e);
                // Don't fail the whole operation if db insert fails
                // This might happen if the provider doesn't exist yet
            }
        }
    } else {
        error!("No database connection available for note insertion");
    }

    //info!("Note added successfully");
    Ok(())
}

/// Process a USDC Transfer event (incoming transfers to TBA)
async fn process_transfer_event(process: &mut OperatorProcess, log: &Log) -> Result<(), String> {
    // Only process if we have a database connection
    if let Some(db) = &process.db_conn {
        // Get TBA address
        let tba = process.state.operator_tba_address.as_ref()
            .ok_or("No operator TBA configured")?;
        
        info!("Processing incoming USDC transfer to TBA {}", tba);
        
        // Use the existing ledger infrastructure to process this transfer
        let provider = hyperware_process_lib::eth::Provider::new(crate::structs::CHAIN_ID, 30000);
        
        // Ingest this specific block containing the transfer
        if let Some(block_number) = log.block_number {
            match crate::ledger::ingest_usdc_events_for_range(
                db,
                &provider,
                &tba.to_lowercase(),
                block_number,
                block_number,
            ).await {
                Ok(count) => {
                    if count > 0 {
                        info!("Ingested {} USDC events from transfer", count);
                        
                        // Rebuild the ledger to update balance
                        if let Err(e) = crate::ledger::build_usdc_ledger_for_tba(
                            &process.state,
                            db,
                            &tba.to_lowercase()
                        ).await {
                            error!("Failed to rebuild ledger after transfer: {:?}", e);
                        }
                        
                        // Notify WebSocket clients about balance change
                        info!("Notifying WebSocket clients about USDC transfer balance update");
                        info!("Active WebSocket connections: {}", process.ws_connections.len());
                        
                        // Send wallet balance update
                        process.notify_wallet_balance_update().await;
                        process.notify_graph_state_update();
                        
                        // Also send full state snapshots to ensure clients get the update
                        let connections: Vec<u32> = process.ws_connections.keys().cloned().collect();
                        for channel_id in connections {
                            info!("Sending state snapshot to WebSocket client {}", channel_id);
                            process.send_state_snapshot(channel_id).await;
                        }
                    }
                }
                Err(e) => {
                    error!("Failed to ingest USDC transfer event: {:?}", e);
                }
            }
        }
    }
    
    Ok(())
}

/// Update the last checkpoint block
fn update_checkpoint_block(state: &mut State, block_number: u64) {
    state.last_checkpoint_block = block_number;
    //info!("Updated last checkpoint block to {}", block_number);
}

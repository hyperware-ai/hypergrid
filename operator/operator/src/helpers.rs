use anyhow::{anyhow, Result};
use std::time::{SystemTime, UNIX_EPOCH};
use std::collections::HashMap;
use sha2::{Sha256, Digest};
use hyperware_process_lib::logging::{info, error, warn};
use hyperware_process_lib::Address as HyperAddress;
use hyperware_process_lib::sqlite::Sqlite;
use hyperware_process_lib::wallet::{self, KeyStorage, EthAmount, execute_via_tba_with_signer, wait_for_transaction, get_eth_balance};
use hyperware_process_lib::hypermap;
use hyperware_process_lib::eth;
use hyperware_process_lib::http::{StatusCode, server::send_response};
use alloy_primitives::{Address as EthAddress, U256, B256};
use alloy_sol_types::SolValue; // for decoding ABI-encoded data
use std::str::FromStr;
use hex;

use crate::structs::{self, *};
use crate::db;
use crate::wallet::service;
use crate::chain;
use crate::authorized_services::{HotWalletAuthorizedClient, ServiceCapabilities};

/// Decodes a hex string into a UTF-8 string.
/// Returns an error if the hex string is invalid or the decoded bytes aren't valid ASCII printable characters.
pub fn _decode_datakey(hex_string: &str) -> Result<String> {
    // Remove 0x prefix if present
    let clean_hex = if hex_string.starts_with("0x") {
        &hex_string[2..]
    } else {
        hex_string
    };

    // Validate hex string length
    if clean_hex.len() % 2 != 0 {
        return Err(anyhow!("datakey decoding failed: odd number of hex digits"));
    }

    // Decode hex to bytes
    let bytes = (0..clean_hex.len())
        .step_by(2)
        .map(|i| {
            u8::from_str_radix(&clean_hex[i..i + 2], 16)
                .map_err(|_| anyhow!("datakey decoding failed: invalid hex digit"))
        })
        .collect::<Result<Vec<u8>, _>>()?;

    // Decode bytes to UTF-8 string
    let decoded = String::from_utf8(bytes)
        .map_err(|_| anyhow!("datakey decoding failed: invalid UTF-8 sequence"))?;

    // Check if all characters are printable ASCII (range 0x20 to 0x7E)
    if decoded.chars().all(|c| c >= ' ' && c <= '~') {
        Ok(decoded)
    } else {
        Err(anyhow!(
            "datakey decoding failed: contains non-printable characters"
        ))
    }
}

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
            state.root_hash = None;
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
        //"pay" => { // Original USDC pay command
        //    if let Some(amount_str) = command_arg { 
        //        let provider_tba_str = "0xDEAF82e285c794a8091f95007A71403Ff3dbB21d"; // Hardcoded test address
        //        info!("Attempting debug USDC payment to TEST ADDRESS {} amount {}", provider_tba_str, amount_str);
        //        let result = wallet_manager::execute_payment_if_needed(state, provider_tba_str, amount_str);
        //        info!("USDC Payment Result: {:?}", result);
        //    } else {
        //         error!("Usage: pay <amount_usdc>"); 
        //    }
        //}
        "pay-eth" => { // New ETH pay command
            if let Some(amount_str) = command_arg { // Expects only amount
                let target_address_str = "0xDEAF82e285c794a8091f95007A71403Ff3dbB21d"; // Hardcoded test address
                info!("Attempting debug ETH payment to TEST ADDRESS {} amount {}", target_address_str, amount_str);
                
                // Get necessary state: Operator TBA and Hot Wallet Signer
                let operator_tba_addr_str = match state.operator_tba_address.as_ref() {
                    Some(addr) => addr.clone(),
                    None => { 
                        error!("Operator TBA address not configured in state."); 
                        return Ok(()); 
                    }
                };
                let hot_wallet_signer = match service::get_active_signer(state) {
                    Ok(signer) => signer,
                    Err(e) => { 
                        error!("Failed to get active hot wallet signer: {}", e);
                        return Ok(()); 
                    }
                };

                // Parse amount string to f64, then to U256 wei
                let amount_eth_f64 = match amount_str.parse::<f64>() {
                    Ok(f) if f > 0.0 => f,
                    _ => { 
                        error!("Invalid ETH amount: {}", amount_str);
                        return Ok(()); 
                    }
                };
                let wei_value = EthAmount::from_eth(amount_eth_f64).as_wei();

                // Create provider
                let eth_provider = eth::Provider::new(structs::CHAIN_ID, 300000); // 300s timeout

                info!("Sending ETH execute tx via Operator TBA {} to target {} (Value: {} ETH / {} wei)", 
                    operator_tba_addr_str, target_address_str, amount_eth_f64, wei_value);

                // Call execute_via_tba_with_signer directly for ETH transfer
                let execution_result = execute_via_tba_with_signer(
                    &operator_tba_addr_str,
                    hot_wallet_signer,
                    target_address_str,
                    Vec::new(), // Empty call data for ETH transfer
                    wei_value, // Value to send in ETH
                    &eth_provider,
                    Some(0) // CALL operation
                );

                // Handle result and wait for confirmation
                match execution_result {
                    Ok(receipt) => {
                        let tx_hash = receipt.hash;
                        info!("ETH Execute Transaction sent successfully! Tx Hash: {:?}. Waiting for confirmation...", tx_hash);
                        match wait_for_transaction(tx_hash, eth_provider.clone(), 1, 60) {
                            Ok(final_receipt) => {
                                info!("Received final ETH payment receipt: {:#?}", final_receipt);
                                if final_receipt.status() {
                                    info!("ETH Payment transaction confirmed successfully! Tx Hash: {:?}", tx_hash);
                                } else {
                                    error!("ETH Payment transaction confirmed but FAILED (reverted) on-chain. Tx Hash: {:?}", tx_hash);
                                }
                            }
                            Err(e) => {
                                error!("Error waiting for ETH payment transaction confirmation ({:?}): {:?}", tx_hash, e);
                            }
                        }
                    }
                    Err(e) => {
                         error!("ETH Payment failed during submission: {:?}", e);
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
            let sub_entry_name = format!("grid-beta-wallet.{}", base_node_name);
            info!("[1/2] Checking base node '{}' and sub-entry '{}' existence...", base_node_name, sub_entry_name);
            let provider = eth::Provider::new(structs::CHAIN_ID, 30000);
            let hypermap_addr = EthAddress::from_str(hypermap::HYPERMAP_ADDRESS).expect("Bad Hypermap Addr");
            let hypermap_reader = hypermap::Hypermap::new(provider.clone(), hypermap_addr);
            let sub_entry_check = hypermap_reader.get(&sub_entry_name);
            match sub_entry_check {
                Ok((tba, _, _)) => {
                    info!("  -> Sub-entry '{}' FOUND. TBA: {}", sub_entry_name, tba);

                    // P3: Correct Implementation
                    info!("[3] Checking sub-entry implementation...");
                    let expected_impl_str = "0x000000000046886061414588bb9F63b6C53D8674";
                    match chain::get_implementation_address(&provider, tba) {
                        Ok(impl_addr) => {
                            let expected_addr = EthAddress::from_str(expected_impl_str).unwrap();
                            if impl_addr == expected_addr {
                                info!("  -> Implementation CORRECT: {}", impl_addr);
                            } else {
                                error!("  -> Implementation MISMATCH: Found {}, Expected {}", impl_addr, expected_impl_str);
                                all_ok = false;
                            }
                        }
                        Err(e) => {
                            error!("  -> FAILED to get implementation address: {}", e);
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
        "help" | "?" => {
            info!("--- Hypergrid Operator Debug Commands ---");
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
            info!("help or ?      : Show this help message.");
            info!("-----------------------------------");
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
                        info!("  2. Chain sync hasn't found grid-beta.hypr yet"); 
                        info!("  3. No providers have been minted under grid-beta.hypr");
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
                info!("Searches in: name, provider_name, site, description, provider_id");
            }
        }
        "db-stats" => {
            info!("--- Database Statistics ---");
            
            // Check if root hash is set
            match &state.root_hash {
                Some(hash) => info!("Hypergrid root (grid-beta.hypr) hash: {}", hash),
                None => warn!("Hypergrid root (grid-beta.hypr) NOT SET - this prevents provider indexing!"),
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
                                    format!("{} (grid-beta.hypr)", parent)
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
            info!("--- Checking grid-beta.hypr entry status ---");
            
            // Check current state
            match &state.root_hash {
                Some(hash) => {
                    info!("State root_hash is SET to: {}", hash);
                }
                None => {
                    warn!("State root_hash is NOT SET - provider indexing is disabled!");
                }
            }
            
            // Check on-chain for grid-beta.hypr
            info!("\nChecking on-chain for grid-beta.hypr...");
            let provider = eth::Provider::new(structs::CHAIN_ID, 30000);
            match debug_get_tba_for_node("grid-beta.hypr") {
                Ok(result) => {
                    info!("On-chain lookup for grid-beta.hypr: {}", result);
                    
                    // Calculate the expected hash
                    let expected_hash = hypermap::namehash("grid-beta.hypr");
                    info!("Expected hash for grid-beta.hypr: {}", expected_hash);
                    
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
                    error!("Failed to look up grid-beta.hypr on-chain: {}", e);
                }
            }
            
            // Show hypr parent hash for reference
            let hypr_hash = "0x29575a1a0473dcc0e00d7137198ed715215de7bffd92911627d5e008410a5826";
            info!("\nFor reference:");
            info!("  hypr hash (parent of grid-beta): {}", hypr_hash);
            info!("  grid-beta.hypr expected hash: {}", hypermap::namehash("grid-beta.hypr"));
            
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
            
            info!("--- End grid-beta.hypr check ---");
        }
        _ => info!("Unknown command: '{}'. Type 'help' for available commands.", command_verb),
    }
    Ok(())
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
/// * `Err(String)` - An error message detailing what went wrong (note not found, ABI decoding error, etc.).
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

// --- New Debug Helper Functions for Hypermap Node Lookup ---

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
            // Owner EOA can be ZERO if the entry exists but has no specific owner set in some Hypermap versions/setups,
            // or if the 'get' function returns zero for owner when TBA is also zero.
            // For clarity, we report what we get.
            Ok(format!("Found: {}", owner.to_string()))
        }
        Err(e) => {
            Ok(format!("Error during lookup: {:?}", e))
        }
    }
}
// --- End New Debug Helper Functions ---

pub fn send_json_response<T: serde::Serialize>(status: StatusCode, data: &T) -> anyhow::Result<()> {
    let json_data = serde_json::to_vec(data)?;
    send_response(
        status,
        Some(HashMap::from([(
            String::from("Content-Type"),
            String::from("application/json"),
        )])),
        json_data,
    );
    Ok(())
}
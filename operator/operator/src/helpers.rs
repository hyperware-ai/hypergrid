use anyhow::{anyhow, Result};
use std::time::{SystemTime, UNIX_EPOCH};
use std::collections::HashMap;
use sha2::{Sha256, Digest};
use hyperware_process_lib::logging::{info, error, warn};
use hyperware_process_lib::Address as HyperAddress;
use hyperware_process_lib::sqlite::Sqlite;
use hyperware_process_lib::wallet::{self, KeyStorage, EthAmount, execute_via_tba_with_signer, wait_for_transaction, get_eth_balance, erc20_balance_of};
use hyperware_process_lib::eth::{Provider, TransactionRequest, TransactionInput};
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
        "pay-eth" => {
            if let Some(amount_str) = command_arg {
                info!("Attempting test ETH payment via hyperwallet: {} ETH", amount_str);
                
                let target_address_str = "0xDEAF82e285c794a8091f95007A71403Ff3dbB21d"; // Test address
                
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
            let sub_entry_name = format!("grid-beta-wallet.{}", base_node_name);
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
                    let new_impl_str = "0x19b89306e31D07426E886E3370E62555A0743D96";
                    match chain::get_implementation_address(&provider, tba) {
                        Ok(impl_addr) => {
                            let impl_str = impl_addr.to_string();
                            let impl_str_lower = impl_str.to_lowercase();
                            
                            if impl_str_lower == old_impl_str.to_lowercase() {
                                info!("✅ Sub-entry uses OLD implementation - works but no gasless support");
                            } else if impl_str_lower == new_impl_str.to_lowercase() {
                                info!("✅ Sub-entry uses NEW implementation - gasless transactions supported!");
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
            info!("\n--- ERC-4337 / Account Abstraction Commands ---");
            info!("check-aa       : Run ERC-4337 sanity checks (implementation, balances, approvals).");
            info!("approve-paymaster: Approve Circle paymaster to spend USDC from TBA.");
            info!("test-gasless <amount>: Test a gasless USDC transfer.");
            info!("test-paymaster-format <format>: Test different paymaster data formats.");
            info!("test-permit    : Generate EIP-2612 permit signature components.");
            info!("test-permit-data: Test full EIP-2612 permit paymaster data format.");
            info!("decode-aa-error <hex>: Decode AA error codes and paymaster errors.");
            info!("decode-paymaster-error <code>: Decode common paymaster error codes.");
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
                    let new_impl = "0x19b89306e31D07426E886E3370E62555A0743D96";
                    
                    if impl_str.to_lowercase() == old_impl.to_lowercase() {
                        warn!("⚠️  TBA uses OLD implementation - NO gasless support");
                        info!("   To enable gasless, TBA needs to be upgraded to: {}", new_impl);
                    } else if impl_str.to_lowercase() == new_impl.to_lowercase() {
                        info!("✅ TBA uses NEW implementation - gasless ENABLED!");
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
                        info!("✅ USDC Balance: {} USDC", balance);
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
                        info!("✅ Paymaster approved for: {} USDC", allowance_usdc);
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
                Some(true) => info!("✅ Gasless transactions ENABLED"),
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
                                info!("✅ Gasless transfer successful!");
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

        "debug-paymaster" => {
            if let Some(calldata_hex) = command_arg {
                info!("--- Systematic Paymaster Debug ---");
                info!("Analyzing actual calldata from failed transaction");
                
                // Get operator TBA address
                let operator_tba = match &state.operator_tba_address {
                    Some(addr) => addr.clone(),
                    None => {
                        error!("Operator TBA not configured");
                        return Ok(());
                    }
                };
                
                // Remove 0x prefix if present
                let calldata = calldata_hex.trim_start_matches("0x");
                
                info!("\n1. Decoding UserOperation callData...");
                
                // Decode the TBA execute call
                if calldata.len() < 8 {
                    error!("Calldata too short to contain function selector");
                    return Ok(());
                }
                
                let selector = &calldata[0..8];
                info!("   Function selector: 0x{}", selector);
                
                if selector == "51945447" {
                    info!("   ✓ This is TBA execute() function");
                    
                    // Decode execute parameters
                    // execute(address target, uint256 value, bytes data, uint8 operation)
                    if calldata.len() >= 136 { // Minimum for execute call
                        // Skip selector (8 chars) and decode target address (64 chars, but only last 40 are address)
                        let target_start = 8 + 24;
                        let target_end = target_start + 40;
                        let target = &calldata[target_start..target_end];
                        info!("   Target contract: 0x{}", target);
                        
                        // Check if it's USDC
                        if target.to_lowercase() == "833589fcd6edb6e08f4c7c32d4f71b54bda02913" {
                            info!("   ✓ Target is USDC contract on Base");
                        }
                        
                        // Decode value (should be 0 for ERC20)
                        let value_start = 8 + 64;
                        let value_end = value_start + 64;
                        let value_hex = &calldata[value_start..value_end];
                        let value = u128::from_str_radix(value_hex, 16).unwrap_or(0);
                        info!("   ETH value: {} (should be 0 for ERC20)", value);
                        
                        // Find the actual data payload
                        if calldata.len() >= 200 {
                            // The data offset is at position 8 + 64 + 64 = 136
                            let data_offset_start = 8 + 64 + 64;
                            let data_offset_hex = &calldata[data_offset_start..data_offset_start + 64];
                            let data_offset = usize::from_str_radix(data_offset_hex, 16).unwrap_or(0) * 2;
                            
                            // The actual data starts at 8 + data_offset
                            let data_start = 8 + data_offset;
                            if calldata.len() > data_start + 8 {
                                // Get the data length
                                let data_len_hex = &calldata[data_start..data_start + 64];
                                let data_len = usize::from_str_radix(data_len_hex, 16).unwrap_or(0) * 2;
                                
                                // Get the actual data
                                let actual_data_start = data_start + 64;
                                if calldata.len() >= actual_data_start + data_len {
                                    let inner_data = &calldata[actual_data_start..actual_data_start + data_len];
                                    
                                    // Decode the inner ERC20 transfer
                                    if inner_data.len() >= 8 {
                                        let inner_selector = &inner_data[0..8];
                                        info!("\n   Inner call selector: 0x{}", inner_selector);
                                        
                                        if inner_selector == "a9059cbb" {
                                            info!("   ✓ This is ERC20 transfer() function");
                                            
                                            // Decode transfer parameters
                                            if inner_data.len() >= 72 {
                                                let recipient_start = 8 + 24;
                                                let recipient = &inner_data[recipient_start..recipient_start + 40];
                                                info!("   Recipient: 0x{}", recipient);
                                                
                                                let amount_hex = &inner_data[72..136];
                                                if let Ok(amount) = u128::from_str_radix(amount_hex, 16) {
                                                    let usdc_amount = amount as f64 / 1_000_000.0;
                                                    info!("   Amount: {} USDC units ({} USDC)", amount, usdc_amount);
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                } else {
                    error!("   Unknown function selector - not a TBA execute call");
                }
                
                info!("\n2. Checking current paymaster configuration...");
                let paymaster = "0x0578cFB241215b77442a541325d6A4E6dFE700Ec";
                let usdc_addr = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
                info!("   Paymaster: {}", paymaster);
                info!("   USDC: {}", usdc_addr);
                info!("   Current paymaster data format: just USDC address");
                
                info!("\n3. Common error code explanations:");
                info!("   AA33 + 0x3a98: Paymaster validation failed");
                info!("   Possible reasons:");
                info!("   - Insufficient USDC balance");
                info!("   - Paymaster not approved for USDC");
                info!("   - Gas costs exceed paymaster limits");
                info!("   - Wrong paymaster data format");
                info!("   - TBA implementation not supported");
                
                info!("\n--- End Paymaster Debug ---");
            } else {
                error!("Usage: debug-paymaster <calldata_hex>");
                info!("Copy the callData from the failed transaction logs");
            }
        }
        
        "test-gasless-variations" => {
            info!("--- Testing Gasless Payment Variations ---");
            
            let operator_tba = match &state.operator_tba_address {
                Some(addr) => addr.clone(),
                None => {
                    error!("Operator TBA not configured");
                    return Ok(());
                }
            };
            
            // We'll need to modify the paymaster data in hyperwallet
            // For now, just log what we would test
            info!("\nVariation 1: Empty paymaster data");
            info!("   This tests if the paymaster works without any additional data");
            
            info!("\nVariation 2: Just USDC address (current implementation)");
            info!("   Format: 0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
            
            info!("\nVariation 3: USDC address + gas limit");
            info!("   Format: 0x833589fcd6edb6e08f4c7c32d4f71b54bda02913{:064x}", 100_000u64);
            
            info!("\nVariation 4: Different transfer amounts");
            info!("   Try: 0.01 USDC, 0.001 USDC, 0.1 USDC");
            
            info!("\nTo implement these tests, we need to modify hyperwallet's");
            info!("encode_usdc_paymaster_data function to accept a format parameter.");
            
            info!("--- End Variations Test ---");
        }
        
        "test-paymaster-format" => {
            if let Some(format) = command_arg {
                info!("--- Testing Paymaster Format: {} ---", format);
                
                let test_wallet_id = "operator-wallet";
                let target = "0x3138FE02bFc273bFF633E093Bd914F58930d111c";
                let amount = "0.01"; // Small test amount
                
                // Force gasless mode
                let saved_gasless = state.gasless_enabled;
                state.gasless_enabled = Some(true);
                
                // Build metadata for the test format
                let mut metadata = serde_json::Map::new();
                metadata.insert("paymaster_test_format".to_string(), serde_json::Value::String(format.to_string()));
                
                info!("Testing with format: {}", format);
                info!("Amount: {} USDC to {}", amount, target);
                
                match format {
                    "empty" => info!("Using empty paymaster data (just paymaster address)"),
                    "no_paymaster" => info!("Using NO paymaster at all (will require ETH in TBA)"),
                    "just_gas_limit" => info!("Using paymaster address + gas limit"),
                    "usdc_plus_gas" => info!("Using paymaster + USDC address + gas limit"),
                    "default" => info!("Using default format (paymaster + USDC address)"),
                    _ => {
                        error!("Unknown format. Use: empty, no_paymaster, just_gas_limit, usdc_plus_gas, or default");
                        state.gasless_enabled = saved_gasless;
                        return Ok(());
                    }
                }
                
                // Execute the test payment with metadata
                match crate::wallet::payments::execute_payment_with_metadata(
                    state,
                    target,
                    amount,
                    "test_provider".to_string(),
                    test_wallet_id,
                    Some(metadata),
                ) {
                    Some(result) => {
                        match result {
                            crate::structs::PaymentAttemptResult::Success { tx_hash, amount_paid, currency } => {
                                info!("✅ Success with format '{}'!", format);
                                info!("   UserOp hash: {}", tx_hash);
                            }
                            crate::structs::PaymentAttemptResult::Failed { error, .. } => {
                                error!("❌ Failed with format '{}': {}", format, error);
                            }
                            _ => {}
                        }
                    }
                    None => {
                        error!("No result returned");
                    }
                }
                
                state.gasless_enabled = saved_gasless;
                info!("--- End Format Test ---");
            } else {
                error!("Usage: test-paymaster-format <format>");
                info!("Formats: empty, no_paymaster, just_gas_limit, usdc_plus_gas, default");
            }
        }
        "test-no-paymaster" => {
            if let Some(amount_str) = command_arg {
                info!("--- Testing UserOperation WITHOUT Paymaster (ETH gas) ---");
                
                // Check if TBA has ETH
                let tba_address = match &state.operator_tba_address {
                    Some(addr) => addr.clone(),
                    None => {
                        error!("Operator TBA not configured");
                        return Ok(());
                    }
                };
                
                info!("Checking ETH balance for TBA: {}", tba_address);
                
                // Get ETH balance
                let provider = eth::Provider::new(structs::CHAIN_ID, 30000);
                match provider.get_balance(EthAddress::from_str(&tba_address).unwrap(), None) {
                    Ok(balance) => {
                        let eth_balance = balance.to::<u64>() as f64 / 1e18;
                        info!("TBA ETH balance: {} ETH", eth_balance);
                        
                        if eth_balance < 0.0001 {
                            error!("Insufficient ETH balance! Need at least 0.0001 ETH for gas");
                            info!("Please send some ETH to the TBA: {}", tba_address);
                            return Ok(());
                        }
                    }
                    Err(e) => {
                        error!("Failed to check ETH balance: {}", e);
                        return Ok(());
                    }
                }
                
                // Parse amount
                let amount_usdc = match amount_str.parse::<f64>() {
                    Ok(a) if a > 0.0 => a,
                    _ => {
                        error!("Invalid amount. Please provide a positive number.");
                        return Ok(());
                    }
                };
                
                info!("Preparing to transfer {} USDC without paymaster", amount_usdc);
                
                // Target address (same test address)
                let target = "0x3138FE02bFc273bFF633E093Bd914F58930d111c";
                info!("Target address: {}", target);
                
                // Keep gasless enabled but disable paymaster via metadata
                let saved_gasless = state.gasless_enabled;
                state.gasless_enabled = Some(true); // Keep gasless ENABLED for UserOperations
                
                // Create metadata to explicitly disable paymaster
                let mut metadata = serde_json::Map::new();
                metadata.insert("use_paymaster".to_string(), serde_json::Value::Bool(false));
                metadata.insert("no_paymaster_test".to_string(), serde_json::Value::Bool(true));
                
                info!("\nBuilding UserOperation without paymaster data...");
                info!("The TBA will pay for gas using its ETH balance");
                
                // Execute payment
                match crate::wallet::payments::execute_payment_with_metadata(
                    state,
                    target,
                    &amount_usdc.to_string(),
                    "test_provider".to_string(),
                    "operator-wallet",
                    Some(metadata),
                ) {
                    Some(result) => {
                        match result {
                            crate::structs::PaymentAttemptResult::Success { tx_hash, .. } => {
                                info!("✅ SUCCESS! UserOperation submitted without paymaster!");
                                info!("   UserOp hash: {}", tx_hash);
                                info!("");
                                info!("This proves:");
                                info!("  1. The TBA is properly configured");
                                info!("  2. The hot wallet can sign UserOps correctly");
                                info!("  3. The UserOp structure is valid");
                                info!("  4. The issue is specifically with paymaster validation");
                            }
                            crate::structs::PaymentAttemptResult::Failed { error, .. } => {
                                error!("❌ Failed: {}", error);
                                
                                if error.contains("AA21") {
                                    info!("AA21: TBA didn't pay prefund - insufficient ETH");
                                } else if error.contains("AA24") {
                                    info!("AA24: Signature error - check TBA implementation");
                                } else if error.contains("AA25") {
                                    info!("AA25: Invalid nonce - may need to fetch from EntryPoint");
                                }
                            }
                            _ => {}
                        }
                    }
                    None => {
                        error!("No result returned");
                    }
                }
                
                // Restore gasless state
                state.gasless_enabled = saved_gasless;
                
                info!("\n--- End No-Paymaster Test ---");
            } else {
                error!("Usage: test-no-paymaster <amount>");
                info!("Example: test-no-paymaster 0.01");
                info!("");
                info!("This command tests UserOperation without any paymaster.");
                info!("The TBA must have ETH to pay for gas.");
            }
        }
        "show-paymaster-encoding" => {
            // Show how Circle's paymaster data should be encoded
            let paymaster = "0x0578cFB241215b77442a541325d6A4E6dFE700Ec";
            let verification_gas = 500_000u128;
            let call_gas = 300_000u128;
            
            // Show the ABI encoding
            let mut encoded = Vec::new();
            
            // First parameter: address (padded to 32 bytes)
            let mut padded_address = vec![0u8; 12];
            padded_address.extend_from_slice(&hex::decode(&paymaster[2..]).unwrap());
            encoded.extend_from_slice(&padded_address);
            
            // Second parameter: uint256 verification gas
            let verification_bytes = U256::from(verification_gas).to_be_bytes::<32>();
            encoded.extend_from_slice(&verification_bytes);
            
            // Third parameter: uint256 call gas  
            let call_bytes = U256::from(call_gas).to_be_bytes::<32>();
            encoded.extend_from_slice(&call_bytes);
            
            let encoded_hex = hex::encode(&encoded);
            
            info!("Circle Paymaster Data Encoding:");
            info!("================================");
            info!("Format: abi.encode(address paymaster, uint256 verificationGasLimit, uint256 callGasLimit)");
            info!("\nParameters:");
            info!("  paymaster: {}", paymaster);
            info!("  verificationGasLimit: {} (0x{:x})", verification_gas, verification_gas);
            info!("  callGasLimit: {} (0x{:x})", call_gas, call_gas);
            info!("\nEncoded data (96 bytes total):");
            info!("  {}", encoded_hex);
            info!("\nBreakdown:");
            info!("  First 32 bytes (padded address): {}", &encoded_hex[0..64]);
            info!("  Next 32 bytes (verification gas): {}", &encoded_hex[64..128]);
            info!("  Last 32 bytes (call gas): {}", &encoded_hex[128..192]);
            info!("\nThis matches the developer's example:");
            info!("  0000000000000000000000000578cfb241215b77442a541325d6a4e6dfe700ec000000000000000000000000000000000000000000000000000000000007a12000000000000000000000000000000000000000000000000000000000000493e0");
        }
        "test-bundler-format" => {
            if let Some(format_type) = command_arg {
                info!("--- Testing Bundler Format Type: {} ---", format_type);
                
                let paymaster = "0x0578cFB241215b77442a541325d6A4E6dFE700Ec";
                let verification_gas = 500_000u128;
                let call_gas = 300_000u128;
                
                match format_type {
                    "split" => {
                        // Current approach - split paymaster and data
                        info!("Format: Split paymaster and paymasterData fields");
                        info!("  paymaster: {}", paymaster);
                        info!("  paymasterData: 0x000000000000000000000000000000000000000000000000000000000007a12000000000000000000000000000000000000000000000000000000000000493e0");
                        info!("\nThis is what we're currently sending (and failing)");
                    }
                    "combined" => {
                        // All in paymasterData field
                        info!("Format: Everything in paymasterData field");
                        info!("  paymaster: (not included)");
                        info!("  paymasterData: 0x0000000000000000000000000578cfb241215b77442a541325d6a4e6dfe700ec000000000000000000000000000000000000000000000000000000000007a12000000000000000000000000000000000000000000000000000000000000493e0");
                        info!("\nThis puts the full ABI encoding in paymasterData");
                    }
                    "paymaster-only" => {
                        // Just paymaster field, no data
                        info!("Format: Only paymaster field, no paymasterData");
                        info!("  paymaster: {}", paymaster);
                        info!("  paymasterData: (not included)");
                        info!("\nThis assumes paymaster doesn't need extra data");
                    }
                    _ => {
                        error!("Unknown format type. Use: split, combined, or paymaster-only");
                    }
                }
                
                info!("\nTo test these formats, we need to modify the bundler.rs");
                info!("or create a direct HTTP request to Pimlico");
                
                info!("--- End Bundler Format Test ---");
            } else {
                error!("Usage: test-bundler-format <type>");
                info!("Types: split, combined, paymaster-only");
            }
        }
        "test-pimlico-real" => {
            if let Some(amount_str) = command_arg {
                info!("--- Simple Direct UserOperation Test ---");
                
                // Parse amount
                let amount_usdc = match amount_str.parse::<f64>() {
                    Ok(a) if a > 0.0 => a,
                    _ => {
                        error!("Invalid amount. Please provide a positive number.");
                        return Ok(());
                    }
                };
                
                let amount_units = (amount_usdc * 1_000_000.0) as u128;
                info!("Sending {} USDC ({} units)", amount_usdc, amount_units);
                
                // FIXED VALUES - Easy to see and modify
                let sender = "0xAe35071C7f8e2F22071AFA40BdB03837F27DAd74";
                let usdc_contract = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
                let recipient = "0x3138FE02bFc273bFF633E093Bd914F58930d111c";
                let entry_point = "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108";
                
                // GAS VALUES - Budget-friendly for 0.0086 ETH balance
                let nonce = "0x0";
                let call_gas_limit = "0x186a0";        // 100,000 - reduced for budget
                let verification_gas_limit = "0x30d40"; // 200,000 - reduced for budget
                let pre_verification_gas = "0xc350";    // 50,000 - reduced for budget
                let max_fee_per_gas = "0xb2d05e00";     // 3,000,000,000 wei (3 gwei) - budget-friendly
                let max_priority_fee_per_gas = "0x77359400"; // 2,000,000,000 wei (2 gwei) - reasonable priority fee
                
                // PAYMASTER VALUES - Easy to modify
                let paymaster = "0x0578cFB241215b77442a541325d6A4E6dFE700Ec";
                //let paymaster = "0x888888888888Ec68A58AB8094Cc1AD20Ba3D2402";
                let paymaster_verification_gas = "0x186a0"; // 100,000
                let paymaster_post_op_gas = "0x0";          // 0
                
                info!("=== FIXED VALUES ===");
                info!("Sender (TBA): {}", sender);
                info!("USDC Contract: {}", usdc_contract);
                info!("Recipient: {}", recipient);
                info!("Paymaster: {}", paymaster);
                info!("Nonce: {}", nonce);
                info!("Call Gas: {}", call_gas_limit);
                info!("Verification Gas: {}", verification_gas_limit);
                info!("Pre-verification Gas: {}", pre_verification_gas);
                info!("Max Fee: {}", max_fee_per_gas);
                info!("Priority Fee: {}", max_priority_fee_per_gas);
                
                // USE SPECIFIC CALLDATA PROVIDED
                let specific_calldata = "51945447000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda029130000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000044a9059cbb0000000000000000000000003138fe02bfc273bff633e093bd914f58930d111c000000000000000000000000000000000000000000000000000000000000271000000000000000000000000000000000000000000000000000000000";
                let execute_data = hex::decode(specific_calldata).unwrap();
                
                let call_data_hex = hex::encode(&execute_data);
                info!("Using specific calldata: 0x{}", call_data_hex);
                
                // 3. BUILD PAYMASTER DATA
                let mut paymaster_data = Vec::new();
                paymaster_data.extend_from_slice(&hex::decode(&paymaster[2..]).unwrap()); // 20 bytes
                paymaster_data.extend_from_slice(&500_000u128.to_be_bytes()); // 16 bytes verification gas
                paymaster_data.extend_from_slice(&300_000u128.to_be_bytes()); // 16 bytes post-op gas
                
                let paymaster_data_hex = hex::encode(&paymaster_data);
                info!("Paymaster data: 0x{}", paymaster_data_hex);
                
                // SIGN THE USER OPERATION - Call EntryPoint.getUserOpHash() properly  
                use hyperware_process_lib::signer::LocalSigner;
                let private_key = "0x0988b51979846798cb05ffaa241c6f8bd5538b16344c14343f5dfb6a4dbb2e9a";
                let signer = LocalSigner::from_private_key(private_key, 8453).unwrap();
                info!("Signer address: {}", signer.address());
                
                // Use proper bit shifting for gas packing like Solidity example:
                // accountGasLimits: bytes32(uint256(verification_gas) << 128 | uint256(call_gas))
                // gasFees: bytes32(uint256(max_priority_fee) << 128 | uint256(max_fee))
                
                // Pack accountGasLimits: verification_gas << 128 | call_gas
                let verification_gas = 200_000u128; // Reduced for budget
                let call_gas = 100_000u128; // Reduced for budget
                let account_gas_limits: U256 = (U256::from(verification_gas) << 128) | U256::from(call_gas);
                
                // Pack gasFees: max_priority_fee << 128 | max_fee  
                let max_priority_fee = 2_000_000_000u128; // 2 gwei - matches JSON value
                let max_fee = 3_000_000_000u128; // 3 gwei - budget-friendly
                let gas_fees: U256 = (U256::from(max_priority_fee) << 128) | U256::from(max_fee);
                
                info!("Account gas limits: 0x{:064x}", account_gas_limits);
                info!("Gas fees: 0x{:064x}", gas_fees);
                
                // Call EntryPoint.getUserOpHash() to get the correct hash
                use hyperware_process_lib::eth::{Provider, TransactionRequest, TransactionInput};
                use alloy_primitives::{Address as EthAddress, Bytes as AlloyBytes};
                use std::str::FromStr;
                
                let provider = Provider::new(8453, 30); // Base chain with 30s timeout
                let entry_point_addr = EthAddress::from_str(&entry_point).unwrap();
                
                // Create PackedUserOperation ABI encoding for getUserOpHash call
                // getUserOpHash(PackedUserOperation userOp) -> bytes32
                // PackedUserOperation: (address,uint256,bytes,bytes32,uint256,bytes32,bytes)
                
                // Encode the PackedUserOperation struct fields
                use alloy_sol_types::*;
                
                // Define the PackedUserOperation type
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
                
                // Create the PackedUserOperation instance
                let packed_user_op = PackedUserOperation {
                    sender: EthAddress::from_str(&sender).unwrap(),
                    nonce: alloy_primitives::U256::from(0u64),
                    initCode: AlloyBytes::new(),  // Empty bytes
                    callData: AlloyBytes::from(execute_data.clone()),
                    accountGasLimits: alloy_primitives::FixedBytes::from_slice(&account_gas_limits.to_be_bytes::<32>()),
                    preVerificationGas: alloy_primitives::U256::from(50_000u128), // Must match JSON value 0xc350
                    gasFees: alloy_primitives::FixedBytes::from_slice(&gas_fees.to_be_bytes::<32>()),
                    paymasterAndData: AlloyBytes::from(paymaster_data.clone()), // Use actual paymaster data
                    signature: AlloyBytes::new(), // Empty for hash calculation
                };

                //info!("Packed user operation: {}", packed_user_op);
                
                // Create the function call
                let get_hash_call = getUserOpHashCall {
                    userOp: packed_user_op,
                };

                
                // Encode the call
                let call_data = get_hash_call.abi_encode();
                info!("get_hash_call.abi_encode: {:#?}", call_data);
                
                // Create transaction request to call EntryPoint.getUserOpHash()
                let tx_req = TransactionRequest::default()
                    .input(TransactionInput::new(call_data.into()))
                    .to(entry_point_addr);
                
                // Make the call to get the hash
                let result = match provider.call(tx_req, None) {
                    Ok(bytes) => {
                        info!("Result: {}", hex::encode(bytes.clone()));
                        bytes
                    },
                    Err(e) => {
                        error!("Failed to call EntryPoint.getUserOpHash(): {:?}", e);
                        // Fall back to manual calculation if contract call fails
                        // This is the same calculation but should match EntryPoint exactly
                        use sha3::{Digest, Keccak256};
                        let mut hash_data = Vec::new();
                        
                        // ABI encode the PackedUserOperation struct
                        // This follows Solidity's abi.encode() for the struct
                        
                        // sender (address -> 32 bytes, left-padded)
                        hash_data.extend_from_slice(&[0u8; 12]); 
                        hash_data.extend_from_slice(&hex::decode(&sender[2..]).unwrap());
                        
                        // nonce (uint256 -> 32 bytes)
                        hash_data.extend_from_slice(&U256::from(0u64).to_be_bytes::<32>());
                        
                        // initCode (bytes -> 32 bytes for offset + 32 bytes for length + data)
                        // For empty bytes, we get keccak256("") 
                        hash_data.extend_from_slice(&Keccak256::digest(&[]).as_slice());
                        
                        // callData (bytes -> hash of the data)
                        let calldata_hash = Keccak256::digest(&execute_data);
                        hash_data.extend_from_slice(&calldata_hash);
                        
                        // accountGasLimits (bytes32 -> 32 bytes)
                        hash_data.extend_from_slice(&account_gas_limits.to_be_bytes::<32>());
                        
                        // preVerificationGas (uint256 -> 32 bytes)
                        hash_data.extend_from_slice(&U256::from(50_000u128).to_be_bytes::<32>());
                        
                        // gasFees (bytes32 -> 32 bytes) 
                        hash_data.extend_from_slice(&gas_fees.to_be_bytes::<32>());
                        
                        // paymasterAndData (bytes -> hash, empty = keccak256(""))
                        hash_data.extend_from_slice(&Keccak256::digest(&[]).as_slice());
                        
                        // signature (bytes -> hash, empty = keccak256(""))
                        hash_data.extend_from_slice(&Keccak256::digest(&[]).as_slice());
                        
                        // Hash the ABI-encoded struct  
                        let struct_hash = Keccak256::digest(&hash_data);
                        
                        // Final EntryPoint hash: keccak256(abi.encode(struct_hash, entryPoint, chainId))
                        let mut final_data = Vec::new();
                        final_data.extend_from_slice(&struct_hash);
                        final_data.extend_from_slice(&hex::decode(&entry_point[2..]).unwrap());
                        final_data.extend_from_slice(&U256::from(8453u64).to_be_bytes::<32>());
                        
                        let final_hash = Keccak256::digest(&final_data);
                        AlloyBytes::from(final_hash.to_vec())
                    }
                };
                
                // Decode the result (should be 32 bytes - the hash)
                let user_op_hash = if result.len() == 32 {
                    result.to_vec()
                } else {
                    // If the result is longer, it might be ABI-encoded, try to decode
                    match getUserOpHashCall::abi_decode_returns(&result, false) {
                        Ok(decoded_hash) => decoded_hash._0.to_vec(),
                        Err(_) => {
                            error!("Failed to decode getUserOpHash result, using raw bytes");
                            result.to_vec()
                        }
                    }
                };
                
                info!("UserOp hash ..(from EntryPoint): 0x{}", hex::encode(&user_op_hash));
                
                // Sign the raw hash directly - EntryPoint v0.8 already uses EIP-712 toTypedDataHash
                // We need to sign without any additional prefixes since the hash is already properly formatted
                let signature = match signer.sign_hash(&user_op_hash) {
                    Ok(sig) => sig,
                    Err(e) => {
                        error!("Failed to sign hash: {}", e);
                        return Ok(());
                    }
                };
                let signature_hex = hex::encode(&signature);
                info!("Signature (raw EntryPoint hash): 0x{}", signature_hex);
                
                // 5. BUILD FINAL JSON (v0.6 format for Candide API)
                // Candide expects individual fields, not packed v0.8 format
                let user_op = serde_json::json!({
                    "sender": sender,
                    "nonce": nonce,
                    "callData": format!("0x{}", call_data_hex),
                    "callGasLimit": call_gas_limit,
                    "verificationGasLimit": verification_gas_limit,
                    "preVerificationGas": pre_verification_gas,
                    "maxFeePerGas": max_fee_per_gas,
                    "maxPriorityFeePerGas": max_priority_fee_per_gas,
                    "signature": format!("0x{}", signature_hex),
                    // Optional fields for existing accounts (set to null/None)
                    "factory": null,
                    "factoryData": null,
                    "paymaster": null,
                    "paymasterVerificationGasLimit": null,
                    "paymasterPostOpGasLimit": null,
                    "paymasterData": null
                    // Skipping eip7702auth as we're not using EIP-7702
                });
                
                info!("=== FINAL USER OPERATION ===");
                info!("{}", serde_json::to_string_pretty(&user_op).unwrap());
                
                // 6. SEND TO BUNDLER
                use hyperware_process_lib::http::client::send_request_await_response;
                use hyperware_process_lib::http::Method;
                
                let request = serde_json::json!({
                    "jsonrpc": "2.0",
                    "method": "eth_sendUserOperation",
                    "params": [user_op, entry_point],
                    "id": 1
                });
                
                let url = url::Url::parse(&format!(
                    "https://api.pimlico.io/v2/8453/rpc?apikey={}",
                    "pim_JV4vJ4B1zmf1vBvbdgsLXi"
                )).unwrap();
                
                let mut headers = std::collections::HashMap::new();
                headers.insert("Content-Type".to_string(), "application/json".to_string());
                
                info!("Sending to Pimlico...");
                match send_request_await_response(
                    Method::POST,
                    url,
                    Some(headers),
                    30000,
                    serde_json::to_vec(&request).unwrap(),
                ) {
                    Ok(response) => {
                        let response_str = String::from_utf8_lossy(&response.body());
                        info!("Response: {}", response_str);
                        
                        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&response_str) {
                            if let Some(error) = json.get("error") {
                                error!("❌ Pimlico Error: {}", serde_json::to_string_pretty(error).unwrap());
                            } else if let Some(result) = json.get("result") {
                                info!("✅ SUCCESS! UserOp hash: {}", result);
                            }
                        }
                    }
                    Err(e) => error!("Request failed: {}", e),
                }
                
            } else {
                error!("Usage: test-pimlico-real <amount>");
                info!("Example: test-pimlico-real 0.01");
            }
        }
        "test-pimlico-real-no-pm" => {
            if let Some(amount_str) = command_arg {
                info!("--- Simple Direct UserOperation Test (NO PAYMASTER) ---");
                
                // Parse amount
                let amount_usdc = match amount_str.parse::<f64>() {
                    Ok(a) if a > 0.0 => a,
                    _ => {
                        error!("Invalid amount. Please provide a positive number.");
                        return Ok(());
                    }
                };
                
                let amount_units = (amount_usdc * 1_000_000.0) as u128;
                info!("Sending {} USDC ({} units) WITHOUT PAYMASTER", amount_usdc, amount_units);
                info!("⚠️  TBA must have ETH to pay for gas!");
                
                // FIXED VALUES - Easy to see and modify
                let sender = "0xAe35071C7f8e2F22071AFA40BdB03837F27DAd74";
                let usdc_contract = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
                let recipient = "0x3138FE02bFc273bFF633E093Bd914F58930d111c";
                let entry_point = "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108";
                let nonce = "0x0";
                let call_gas_limit = "0x186a0";        // 100,000 
                let verification_gas_limit = "0x30d40"; // 200,000 
                let pre_verification_gas = "0xD6EC";    // 55,020
                let max_fee_per_gas = "0xb2d05e00";     // 3,000,000,000 wei (3 gwei) 
                let max_priority_fee_per_gas = "0x77359400"; // 2,000,000,000 wei (2 gwei) 
                
                info!("Sender (TBA): {}", sender);
                info!("USDC Contract: {}", usdc_contract);
                info!("Recipient: {}", recipient);
                info!("Entry Point: {}", entry_point);
                info!("Nonce: {}", nonce);
                info!("Call Gas: {}", call_gas_limit);
                info!("Verification Gas: {}", verification_gas_limit);
                info!("Pre-verification Gas: {}", pre_verification_gas);
                info!("Max Fee Per Gas: {}", max_fee_per_gas);
                info!("Max Priority Fee Per Gas: {}", max_priority_fee_per_gas);
                
                // USE SPECIFIC CALLDATA PROVIDED
                let specific_calldata = "51945447000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda029130000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000044a9059cbb0000000000000000000000003138fe02bfc273bff633e093bd914f58930d111c000000000000000000000000000000000000000000000000000000000000271000000000000000000000000000000000000000000000000000000000";
                let execute_data = hex::decode(specific_calldata).unwrap();
                let call_data_hex = hex::encode(&execute_data);
                info!("Using specific calldata: 0x{}", call_data_hex);
                
                // NO PAYMASTER DATA - Empty bytes for JSON
                info!("PaymasterAndData: EMPTY (no paymaster)");
                
                
                // Pack accountGasLimits: verification_gas << 128 | call_gas
                let verification_gas = 200_000u128; // Reduced for budget
                let call_gas = 100_000u128; // Reduced for budget
                let account_gas_limits: U256 = (U256::from(verification_gas) << 128) | U256::from(call_gas);
                
                // Pack gasFees: max_priority_fee << 128 | max_fee  
                let max_priority_fee = 2_000_000_000u128; // 2 gwei - matches JSON value
                let max_fee = 3_000_000_000u128; // 3 gwei - budget-friendly
                let gas_fees: U256 = (U256::from(max_priority_fee) << 128) | U256::from(max_fee);
                
                info!("Account gas limits: 0x{:064x}", account_gas_limits);
                info!("Gas fees: 0x{:064x}", gas_fees);
                
                // Call EntryPoint.getUserOpHash() to get the correct hash
                
                let provider = Provider::new(8453, 30); // Base chain with 30s timeout
                let entry_point_addr = EthAddress::from_str(&entry_point).unwrap();
                
                // Encode the PackedUserOperation struct fields
                use alloy_sol_types::*;
                
                // Define the PackedUserOperation type
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
                
                // Create the PackedUserOperation instance (NO PAYMASTER)
                let packed_user_op = PackedUserOperation {
                    sender: EthAddress::from_str(&sender).unwrap(),
                    nonce: alloy_primitives::U256::from(0u64),
                    initCode: AlloyBytes::new(),  // Empty bytes
                    callData: AlloyBytes::from(execute_data.clone()),
                    accountGasLimits: alloy_primitives::FixedBytes::from_slice(&account_gas_limits.to_be_bytes::<32>()),
                    preVerificationGas: alloy_primitives::U256::from(50_000u128), // Must match JSON value 0xc350
                    gasFees: alloy_primitives::FixedBytes::from_slice(&gas_fees.to_be_bytes::<32>()),
                    paymasterAndData: AlloyBytes::new(), // Empty for no paymaster
                    signature: AlloyBytes::new(), // Empty for hash calculation
                };
                
                // Create the function call
                let get_hash_call = getUserOpHashCall {
                    userOp: packed_user_op,
                };
                
                // Encode the call
                let call_data = get_hash_call.abi_encode();
                
                // Create transaction request to call EntryPoint.getUserOpHash()
                let tx_req = TransactionRequest::default()
                    .input(TransactionInput::new(call_data.into()))
                    .to(entry_point_addr);
                
                // Make the call to get the hash
                let result = match provider.call(tx_req, None) {
                    Ok(bytes) => { 
                        info!("Result (no-pm): {}", hex::encode(bytes.clone()));
                        bytes
                    },
                    Err(e) => {
                        error!("Failed to call EntryPoint.getUserOpHash(): {:?}", e);
                        return Err(anyhow!("Failed to retrieve UserOp hash from EntryPoint"));
                    }
                };
                
                // Decode the result (should be 32 bytes - the hash)
                let user_op_hash = if result.len() == 32 {
                    result.to_vec()
                } else {
                    // If the result is longer, it might be ABI-encoded, try to decode
                    match getUserOpHashCall::abi_decode_returns(&result, false) {
                        Ok(decoded_hash) => decoded_hash._0.to_vec(),
                        Err(_) => {
                            error!("Failed to decode getUserOpHash result, using raw bytes");
                            result.to_vec()
                        }
                    }
                };
                info!("UserOp hash (from EntryPoint, no-pm): 0x{}", hex::encode(&user_op_hash));
                
                // SIGN THE USER OPERATION 
                use hyperware_process_lib::signer::LocalSigner;
                let private_key = "0x0988b51979846798cb05ffaa241c6f8bd5538b16344c14343f5dfb6a4dbb2e9a";
                let signer = LocalSigner::from_private_key(private_key, 8453).unwrap();
                info!("Signer address: {}", signer.address());
                
                // Sign the raw hash directly - EntryPoint v0.8 already uses EIP-712 toTypedDataHash
                // We need to sign without any additional prefixes since the hash is already properly formatted
                let signature = match signer.sign_hash(&user_op_hash) {
                    Ok(sig) => sig,
                    Err(e) => {
                        error!("Failed to sign hash: {}", e);
                        return Ok(());
                    }
                };
                let signature_hex = hex::encode(&signature);
                info!("Signature (raw EntryPoint hash, no prefix): 0x{}", signature_hex);
                
                // 6. BUILD FINAL JSON (v0.6 format for Candide API)
                // Candide expects individual fields, not packed v0.8 format
                let user_op = serde_json::json!({
                    "sender": sender,
                    "nonce": nonce,
                    "callData": format!("0x{}", call_data_hex),
                    "callGasLimit": call_gas_limit,
                    "verificationGasLimit": verification_gas_limit,
                    "preVerificationGas": pre_verification_gas,
                    "maxFeePerGas": max_fee_per_gas,
                    "maxPriorityFeePerGas": max_priority_fee_per_gas,
                    "signature": format!("0x{}", signature_hex),
                    // Optional fields for existing accounts (set to null/None)
                    "factory": null,
                    "factoryData": null,
                    "paymaster": null,
                    "paymasterVerificationGasLimit": null,
                    "paymasterPostOpGasLimit": null,
                    "paymasterData": null
                    // Skipping eip7702auth as we're not using EIP-7702
                });
                
                info!("=== FINAL USER OPERATION (NO PAYMASTER) ===");
                info!("{}", serde_json::to_string_pretty(&user_op).unwrap());
                
                // SEND TO PIMLICO
                use hyperware_process_lib::http::client::send_request_await_response;
                use hyperware_process_lib::http::Method;
                
                let request = serde_json::json!({
                    "jsonrpc": "2.0",
                    "method": "eth_sendUserOperation",
                    "params": [user_op, entry_point],
                    "id": 1
                });

                let candide_url = "https://api.candide.dev/public/v3/8453";
                //let pimlico_url = "https://api.pimlico.io/v2/8453/rpc?apikey=pim_JV4vJ4B1zmf1vBvbdgsLXi";
                
                let url = url::Url::parse(&candide_url).unwrap();
                //let url = url::Url::parse(&format!(
                //    "https://api.pimlico.io/v2/8453/rpc?apikey={}",
                //    "pim_JV4vJ4B1zmf1vBvbdgsLXi"
                //)).unwrap();
                
                let mut headers = std::collections::HashMap::new();
                headers.insert("Content-Type".to_string(), "application/json".to_string());
                
                info!("Sending to Bundler (no paymaster)...");
                match send_request_await_response(
                    Method::POST,
                    url,
                    Some(headers),
                    30000,
                    serde_json::to_vec(&request).unwrap(),
                ) {
                    Ok(response) => {
                        let response_str = String::from_utf8_lossy(&response.body());
                        info!("Response: {}", response_str);
                        
                        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&response_str) {
                            if let Some(error) = json.get("error") {
                                error!("❌ Error: {}", serde_json::to_string_pretty(error).unwrap());
                            } else if let Some(result) = json.get("result") {
                                info!("✅ SUCCESS! UserOp hash: {}", result);
                            }
                        }
                    }
                    Err(e) => error!("Request failed: {}", e),
                }
                
            } else {
                error!("Usage: test-pimlico-real-no-pm <amount>");
                info!("Example: test-pimlico-real-no-pm 0.01");
                info!("Sends UserOperation WITHOUT paymaster - TBA must have ETH for gas!");
            }
        }
        "test-paymaster-formats" => {
            info!("--- Testing Different Paymaster Data Formats ---");
            
            let paymaster = "0x0578cFB241215b77442a541325d6A4E6dFE700Ec";
            let verification_gas = 500_000u128;
            let call_gas = 300_000u128;
            
            info!("Testing different encoding formats for Circle's paymaster:");
            info!("Paymaster: {}", paymaster);
            info!("Verification Gas: {}", verification_gas);
            info!("Call Gas: {}", call_gas);
            
            // Format 1: abi.encodePacked(address, uint128, uint128)
            info!("\n1. abi.encodePacked(address, uint128, uint128):");
            let mut packed_data = Vec::new();
            packed_data.extend_from_slice(&hex::decode(&paymaster[2..]).unwrap());
            // uint128 is 16 bytes
            packed_data.extend_from_slice(&verification_gas.to_be_bytes());
            packed_data.extend_from_slice(&call_gas.to_be_bytes());
            info!("   Length: {} bytes", packed_data.len());
            info!("   Hex: 0x{}", hex::encode(&packed_data));
            
            // Format 2: Just paymaster address (20 bytes)
            info!("\n2. Just paymaster address:");
            let just_address = hex::decode(&paymaster[2..]).unwrap();
            info!("   Length: {} bytes", just_address.len());
            info!("   Hex: 0x{}", hex::encode(&just_address));
            
            // Format 3: abi.encode(address, uint256, uint256) - what we currently use
            info!("\n3. abi.encode(address, uint256, uint256) - current:");
            let mut abi_encoded = Vec::new();
            // Padded address (32 bytes)
            abi_encoded.extend_from_slice(&[0u8; 12]);
            abi_encoded.extend_from_slice(&hex::decode(&paymaster[2..]).unwrap());
            // uint256 values (32 bytes each)
            abi_encoded.extend_from_slice(&U256::from(verification_gas).to_be_bytes::<32>());
            abi_encoded.extend_from_slice(&U256::from(call_gas).to_be_bytes::<32>());
            info!("   Length: {} bytes", abi_encoded.len());
            info!("   Hex: 0x{}", hex::encode(&abi_encoded));
            
            // Format 4: Packed with mode byte
            info!("\n4. Packed with mode byte (0x00 + address + uint128 + uint128):");
            let mut mode_packed = Vec::new();
            mode_packed.push(0x00); // Mode byte
            mode_packed.extend_from_slice(&hex::decode(&paymaster[2..]).unwrap());
            mode_packed.extend_from_slice(&verification_gas.to_be_bytes());
            mode_packed.extend_from_slice(&call_gas.to_be_bytes());
            info!("   Length: {} bytes", mode_packed.len());
            info!("   Hex: 0x{}", hex::encode(&mode_packed));
            
            // Format 5: Empty paymaster data
            info!("\n5. Empty paymaster data:");
            info!("   Just set paymaster field, no paymasterData");
            
            info!("\nThe developer said to use abi.encodePacked with uint128 values");
            info!("So format #1 is most likely correct: {} bytes total", packed_data.len());
        }
        "test-both-formats" => {
            if let Some(amount_str) = command_arg {
                info!("--- Testing Both Paymaster Formats ---");
                
                let amount_usdc = match amount_str.parse::<f64>() {
                    Ok(a) if a > 0.0 => a,
                    _ => {
                        error!("Invalid amount. Please provide a positive number.");
                        return Ok(());
                    }
                };
                
                // Convert to USDC units (6 decimals)
                let amount_units = (amount_usdc * 1_000_000.0) as u128;
                info!("Testing {} USDC ({} units)", amount_usdc, amount_units);
                
                // Test Format 1: abi.encodePacked (William's format)
                info!("\n=== Testing Format 1: abi.encodePacked ===");
                let mut packed_data = Vec::new();
                packed_data.extend_from_slice(&hex::decode("0578cFB241215b77442a541325d6A4E6dFE700Ec").unwrap());
                packed_data.extend_from_slice(&500_000u128.to_be_bytes());
                packed_data.extend_from_slice(&300_000u128.to_be_bytes());
                info!("Packed format: {} bytes", packed_data.len());
                info!("Hex: 0x{}", hex::encode(&packed_data));
                
                // Test Format 2: abi.encode (pax.hyper's format)
                info!("\n=== Testing Format 2: abi.encode ===");
                let mut abi_data = Vec::new();
                // Address padded to 32 bytes
                abi_data.extend_from_slice(&[0u8; 12]);
                abi_data.extend_from_slice(&hex::decode("0578cFB241215b77442a541325d6A4E6dFE700Ec").unwrap());
                // uint256 values
                abi_data.extend_from_slice(&U256::from(500_000u128).to_be_bytes::<32>());
                abi_data.extend_from_slice(&U256::from(300_000u128).to_be_bytes::<32>());
                info!("ABI format: {} bytes", abi_data.len());
                info!("Hex: 0x{}", hex::encode(&abi_data));
                
                info!("\nExpected from pax.hyper:");
                info!("0000000000000000000000000578cfb241215b77442a541325d6a4e6dfe700ec000000000000000000000000000000000000000000000000000000000007a12000000000000000000000000000000000000000000000000000000000000493e0");
                
                let expected_hex = "0000000000000000000000000578cfb241215b77442a541325d6a4e6dfe700ec000000000000000000000000000000000000000000000000000000000007a12000000000000000000000000000000000000000000000000000000000000493e0";
                let our_hex = hex::encode(&abi_data);
                
                if our_hex == expected_hex {
                    info!("✅ Our ABI encoding matches pax.hyper's example!");
                } else {
                    info!("❌ Our ABI encoding doesn't match");
                    info!("Expected: {}", expected_hex);
                    info!("Our:      {}", our_hex);
                }
            } else {
                error!("Usage: test-both-formats <amount>");
                info!("Example: test-both-formats 0.001");
            }
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
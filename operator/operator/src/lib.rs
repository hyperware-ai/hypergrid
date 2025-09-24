#![allow(ambiguous_associated_items)]

use chrono::Utc;
use hyperprocess_macro::hyperprocess;
use serde::{Deserialize, Serialize};
use serde_json;

mod app_api_types;
pub mod constants;
mod db;
mod eth;
mod identity;
mod init;
mod ledger;
mod shim;
mod structs;
mod terminal;
mod wallet;
mod websocket;

use crate::app_api_types::{AuthorizeResult, ProviderInfo, ProviderSearchResult, TerminalCommand};
use crate::structs::{
    generate_shim_client_id, ConfigureAuthorizedClientDto, ConfigureAuthorizedClientResult, State,
    WalletSummary,
};
use crate::websocket::{StateUpdateTopic, WsClientMessage, WsConnection, WsServerMessage};
use hyperware_process_lib::eth::EthSubResult;
use hyperware_process_lib::homepage;
use hyperware_process_lib::http::server::WsMessageType;
use hyperware_process_lib::hypermap;
use hyperware_process_lib::logging::{error, info};
use hyperware_process_lib::LazyLoadBlob;
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Serialize, Deserialize)]
pub struct OperatorProcess {
    // Make state private to prevent WIT generation
    pub(crate) state: State,
    // not serialized, not exposed to WIT
    #[serde(skip)]
    pub(crate) hypermap: Option<hyperware_process_lib::hypermap::Hypermap>,
    #[serde(skip)]
    pub(crate) providers_cache: HashMap<u64, hyperware_process_lib::eth::Provider>,
    #[serde(skip)]
    pub(crate) active_signer: Option<hyperware_process_lib::signer::LocalSigner>,
    #[serde(skip)]
    pub(crate) ws_connections: HashMap<u32, WsConnection>,
    #[serde(skip)]
    pub(crate) db_conn: Option<hyperware_process_lib::sqlite::Sqlite>,
    #[serde(skip)]
    pub(crate) hyperwallet_session: Option<hyperware_process_lib::hyperwallet_client::SessionInfo>,
}

impl Default for OperatorProcess {
    fn default() -> Self {
        // Always start with fresh state in hyperapp framework
        // The framework handles persistence separately from the old MessagePack format
        Self {
            state: State::new(),
            hypermap: None,
            providers_cache: HashMap::new(),
            active_signer: None,
            ws_connections: HashMap::new(),
            db_conn: None,
            hyperwallet_session: None,
        }
    }
}

#[hyperprocess(
    name = "operator",
    ui = Some(HttpBindingConfig::default()),
    endpoints = vec![
        Binding::Http {
            path: "/api",
            config: HttpBindingConfig::default()
        },
        Binding::Http {
            path: "/mcp-authorize",
            config: HttpBindingConfig::new(false, false, false, None)
        },
        Binding::Http {
            path: "/mcp-configure-authorized-client",
            config: HttpBindingConfig::new(false, false, false, None)
        },
        Binding::Http {
            path: "/mcp-search-registry",
            config: HttpBindingConfig::new(false, false, false, None)
        },
        Binding::Http {
            path: "/mcp-call-provider",
            config: HttpBindingConfig::new(false, false, false, None)
        },
        Binding::Ws {
            path: "/ws",
            config: WsBindingConfig::new(false, false, false)
        },
    ],
    save_config = hyperware_process_lib::hyperapp::SaveOptions::EveryMessage,
    wit_world = "operator-sortugdev-dot-os-v0"
)]
impl OperatorProcess {
    #[init]
    async fn init(&mut self) {
        homepage::add_to_homepage("Hypergrid", Some(include_str!("./icon")), Some("/"), None);
        self.hypermap = Some(hyperware_process_lib::hypermap::Hypermap::default(60));

        init::initialize_hyperwallet(self).await;

        init::initialize_database(self).await;

        eth::setup_subscriptions(self).await;

        init::initialize_identity(self).await;

        init::initialize_ledger(self).await;
    }

    #[local]
    #[http]
    async fn recheck_identity(&mut self) -> Result<(), String> {
        info!("Rechecking operator identity...");

        let our = hyperware_process_lib::our();
        match crate::identity::initialize_operator_identity(&our, &mut self.state) {
            Ok(_) => {
                info!("Identity recheck completed successfully");

                // If we found an identity, reinitialize ledger if needed
                if self.state.operator_tba_address.is_some() {
                    if let Some(db) = &self.db_conn {
                        init::initialize_ledger_if_ready(
                            &mut self.state,
                            db,
                            self.hypermap.as_ref(),
                        )
                        .await;

                        // Also notify clients if we have authorized clients
                        if !self.state.authorized_clients.is_empty() {
                            init::notify_authorization_after_ledger_init(self).await;
                        }
                    }
                }

                // Send state update to WebSocket clients
                let connections: Vec<u32> = self.ws_connections.keys().cloned().collect();
                for channel_id in connections {
                    self.send_state_snapshot(channel_id).await;
                }

                Ok(())
            }
            Err(e) => {
                error!("Failed to recheck identity: {:?}", e);
                Err(format!("Identity recheck failed: {}", e))
            }
        }
    }

    #[local]
    #[http]
    async fn recheck_paymaster_approval(&mut self) -> Result<(), String> {
        info!("Rechecking paymaster approval status...");

        // Only check if we have an operator TBA and gasless is enabled
        if let (Some(tba_address), Some(true)) =
            (&self.state.operator_tba_address, self.state.gasless_enabled)
        {
            let provider = hyperware_process_lib::eth::Provider::new(structs::CHAIN_ID, 30000);
            let paymaster = crate::constants::CIRCLE_PAYMASTER;

            match hyperware_process_lib::wallet::erc20_allowance(
                crate::constants::USDC_BASE_ADDRESS,
                tba_address,
                paymaster,
                &provider,
            ) {
                Ok(allowance) => {
                    let approved = allowance > alloy_primitives::U256::ZERO;
                    info!(
                        "Paymaster approval recheck: {} (allowance: {})",
                        if approved { "APPROVED" } else { "NOT APPROVED" },
                        allowance
                    );
                    self.state.paymaster_approved = Some(approved);

                    // Send state update to WebSocket clients
                    let connections: Vec<u32> = self.ws_connections.keys().cloned().collect();
                    for channel_id in connections {
                        self.send_state_snapshot(channel_id).await;
                    }

                    Ok(())
                }
                Err(e) => {
                    error!("Failed to check paymaster approval: {:?}", e);
                    Err(format!("Paymaster approval check failed: {}", e))
                }
            }
        } else {
            Ok(())
        }
    }

    // ===== MCP Endpoints =====

    // Authorize endpoint - returns configuration for shim to save locally
    #[http(path = "/mcp-authorize")]
    async fn authorize(
        &mut self,
        node: String,
        token: String,
        client_id: String,
        name: Option<String>,
    ) -> Result<AuthorizeResult, String> {
        info!(
            "Handling authorize request for node: {} with client_id: {}",
            node, client_id
        );

        let hashed_token = shim::hash_authentication_token(&token);

        // Check if client already exists
        let client_exists = self
            .state
            .authorized_clients
            .iter()
            .any(|(id, _)| id == &client_id);

        if client_exists {
            // Client already exists, update the token and optionally the name
            info!(
                "Client {} already exists, updating token and name",
                client_id
            );
            // Find and update the client's token and name
            for (id, client) in &mut self.state.authorized_clients {
                if id == &client_id {
                    client.authentication_token = hashed_token;
                    if let Some(new_name) = name {
                        client.name = new_name;
                    }
                    break;
                }
            }
        } else {
            // Create new client
            info!("Creating new client {} with name: {:?}", client_id, name);
            let client = shim::create_authorization_client(&node, &client_id, &hashed_token, name);
            shim::store_client(&mut self.state, client_id.clone(), client);
        }

        Ok(shim::build_authorization_response(client_id, token, node))
    }

    // this can be hit from anywhere
    #[http(path = "/mcp-configure-authorized-client")]
    async fn configure_authorized_client(
        &mut self,
        req: ConfigureAuthorizedClientDto,
    ) -> Result<ConfigureAuthorizedClientResult, String> {
        info!("Handling configure authorized client request");

        let hashed_token = shim::hash_authentication_token(&req.raw_token);

        let (client_id, is_update) = if let Some(existing_id) = &req.client_id {
            shim::update_existing_client(&mut self.state, existing_id, &hashed_token, &req)?
        } else {
            shim::create_new_client(&mut self.state, &req, &hashed_token)?
        };

        shim::log_client_operation(&client_id, is_update);

        let our = hyperware_process_lib::our();
        Ok(shim::build_configuration_response(
            client_id,
            req.raw_token,
            our.node().to_string(),
        ))
    }

    // Search registry endpoint for shim
    #[http(path = "/mcp-search-registry")]
    async fn search_registry(
        &mut self,
        query: String,
        client_id: String,
        token: String,
    ) -> Result<Vec<ProviderSearchResult>, String> {
        info!("Handling search_registry request for query: {}", query);

        shim::authenticate_client(&self.state, &client_id, &token)?;

        let db = self
            .db_conn
            .as_ref()
            .ok_or("Database connection not available")?;

        shim::perform_registry_search(db, &query).await
    }

    // Call provider endpoint for shim
    #[http(path = "/mcp-call-provider")]
    async fn call_provider(
        &mut self,
        provider_id: String,
        provider_name: String,
        args: Vec<app_api_types::KeyValue>,
        client_id: String,
        token: String,
    ) -> Result<String, String> {
        info!(
            "Handling call_provider request for provider: {}",
            provider_id
        );

        shim::authenticate_client(&self.state, &client_id, &token)?;

        let client_config = shim::get_client_config(&self.state, &client_id)?;
        info!("Client config: {:#?}", client_config);

        let timestamp_start_ms = Utc::now().timestamp_millis() as u128;
        let call_args_json = serde_json::to_string(&args).unwrap_or_else(|_| "{}".to_string());

        let db = self
            .db_conn
            .as_ref()
            .ok_or("Database connection not available")?;
        let provider_details = shim::fetch_provider_from_db(db, &provider_id).await?;
        info!("Provider details: {:#?}", provider_details);

        shim::perform_health_check(&provider_details)?;

        shim::enforce_client_spending_limits(&self.state, db, &client_config, &provider_details)
            .await?;

        let payment_result =
            shim::process_payment_if_required(self, &provider_details, Some(&client_config))
                .await?;

        shim::execute_provider_call_with_metrics(
            self,
            provider_details,
            provider_name.clone(),
            args,
            timestamp_start_ms,
            call_args_json,
            payment_result,
            Some(client_config),
        )
        .await
    }

    #[local]
    #[http]
    async fn remove_authorized_client(&mut self, client_id: String) -> Result<(), String> {
        self.state
            .authorized_clients
            .retain(|(id, _)| id != &client_id);
        Ok(())
    }

    #[local]
    #[http]
    async fn rename_authorized_client(
        &mut self,
        client_id: String,
        new_name: String,
    ) -> Result<(), String> {
        // Find and update the client's name
        for (id, client) in &mut self.state.authorized_clients {
            if id == &client_id {
                client.name = new_name;
                return Ok(());
            }
        }
        Err(format!("Client {} not found", client_id))
    }

    #[local]
    #[http]
    async fn toggle_client_status(&mut self, client_id: String) -> Result<(), String> {
        // Find and toggle the client's status
        for (id, client) in &mut self.state.authorized_clients {
            if id == &client_id {
                client.status = match client.status {
                    structs::ClientStatus::Active => structs::ClientStatus::Halted,
                    structs::ClientStatus::Halted => structs::ClientStatus::Active,
                };
                info!("Toggled client {} status to {:?}", client_id, client.status);

                // Notify WebSocket clients about the status change
                self.notify_authorization_update();

                return Ok(());
            }
        }
        Err(format!("Client {} not found", client_id))
    }

    #[local]
    #[http]
    async fn set_client_limits(
        &mut self,
        client_id: String,
        limits: structs::SpendingLimits,
    ) -> Result<(), String> {
        info!("Setting client spending limits for {}", client_id);
        info!("Received limits: {:?}", limits);

        // Check if client exists
        let client_exists = self
            .state
            .authorized_clients
            .iter()
            .any(|(id, _)| id == &client_id);

        if !client_exists {
            return Err(format!("Client {} not found", client_id));
        }

        // Update or insert limits in the cache
        let mut found = false;
        for (id, existing_limits) in &mut self.state.client_limits_cache {
            if id == &client_id {
                *existing_limits = limits.clone();
                found = true;
                break;
            }
        }

        if !found {
            self.state
                .client_limits_cache
                .push((client_id.clone(), limits));
        }

        // Notify WebSocket clients about the updated limits
        self.notify_authorization_update();

        Ok(())
    }

    // Search providers without authentication
    #[local]
    #[http]
    async fn search_providers_public(&self, query: String) -> Result<Vec<ProviderInfo>, String> {
        info!("Public search for providers with query: {}", query);

        let db = self
            .db_conn
            .as_ref()
            .ok_or("Database connection not available")?;

        let providers = crate::db::search_provider(db, query)
            .await
            .map_err(|e| format!("Failed to search providers: {:?}", e))?;

        let provider_infos: Vec<ProviderInfo> = providers
            .into_iter()
            .map(|p| ProviderInfo {
                id: p.get("id").and_then(|v| v.as_i64()),
                provider_id: p
                    .get("provider_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                name: p
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                description: p
                    .get("description")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
                site: p
                    .get("site")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
                wallet: p
                    .get("wallet")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
                price: p
                    .get("price")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
                instructions: p
                    .get("instructions")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
                hash: p
                    .get("hash")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
            })
            .collect();

        info!("Found {} providers matching query", provider_infos.len());
        Ok(provider_infos)
    }

    #[local]
    async fn terminal_command(&mut self, command: TerminalCommand) -> Result<String, String> {
        match command {
            TerminalCommand::GetState => {
                info!("Getting current operator state");
                info!("Current state:\n{:#?}", self.state);
                let state_json = terminal::serialize_state_to_json(&self.state)?;
                Ok(format!("Current state:\n{}", state_json))
            }
            TerminalCommand::ResetState => {
                info!("Resetting operator state to fresh state");

                let resources = terminal::extract_runtime_resources(self);

                self.state = terminal::create_fresh_state();

                terminal::restore_runtime_resources(self, resources);

                let current_resources = terminal::extract_runtime_resources(self);
                terminal::update_state_flags(&mut self.state, &current_resources);

                info!("State reset complete");
                Ok("State has been reset to fresh state".to_string())
            }
            TerminalCommand::CheckDbSchema => {
                info!("Checking database schema");

                let db = self
                    .db_conn
                    .as_ref()
                    .ok_or("No database connection available")?;

                let rows = terminal::query_database_schema(db).await?;

                let (tables, indexes) = terminal::parse_schema_rows(rows);

                let mut output = terminal::format_schema_output(tables, indexes);

                match terminal::query_provider_count(db).await {
                    Ok(count) => {
                        output.push_str(&format!("\n\nProvider count: {}\n", count));
                    }
                    Err(e) => {
                        info!("Failed to get provider count: {}", e);
                    }
                }
                info!("output: {:#?}", output);
                info!("Database schema check complete");
                Ok(output)
            }
            TerminalCommand::SearchProviders(query) => {
                info!("Searching providers for query: {}", query);

                let db = self
                    .db_conn
                    .as_ref()
                    .ok_or("No database connection available")?;

                let providers = crate::db::search_provider(db, query.clone())
                    .await
                    .map_err(|e| format!("Failed to search providers: {:?}", e))?;

                info!("providers: {:#?}", providers);

                let output = terminal::format_search_results(&query, providers);

                info!("output: {:#?}", output);
                Ok(output)
            }
            TerminalCommand::WipeDbAndReindex => {
                info!("Wiping operator database and reindexing from chain");

                self.state.last_checkpoint_block = 0;

                let resources = terminal::extract_runtime_resources(self);

                let our = hyperware_process_lib::our();
                crate::db::wipe_db(&our)
                    .await
                    .map_err(|e| format!("Failed to wipe DB: {:?}", e))?;

                let db = crate::db::load_db(&our)
                    .await
                    .map_err(|e| format!("Failed to reload DB: {:?}", e))?;
                self.db_conn = Some(db);
                self.state.db_initialized = true;

                terminal::restore_runtime_resources(self, resources);

                eth::bootstrap_historical(self).await?;

                Ok("Database wiped and reindexed".to_string())
            }

            TerminalCommand::PrintLedger(tba_address) => {
                info!("Printing ledger for TBA: {}", tba_address);

                let db = self
                    .db_conn
                    .as_ref()
                    .ok_or("No database connection available")?;

                let tba_lower = tba_address.to_lowercase();

                info!("=== USDC EVENTS TABLE ===");
                let events_query = r#"
                    SELECT * FROM usdc_events 
                    WHERE address = ?1 
                    ORDER BY block DESC
                "#
                .to_string();
                let events = db
                    .read(
                        events_query,
                        vec![serde_json::Value::String(tba_lower.clone())],
                    )
                    .await
                    .map_err(|e| format!("Failed to read usdc_events: {:?}", e))?;

                info!("Total events: {}", events.len());
                for event in events {
                    info!("{:?}", event);
                }

                info!("\n=== USDC CALL LEDGER TABLE ===");
                let ledger_query = r#"
                    SELECT * FROM usdc_call_ledger 
                    WHERE tba_address = ?1 
                    ORDER BY block DESC
                "#
                .to_string();
                let ledger_rows = db
                    .read(
                        ledger_query,
                        vec![serde_json::Value::String(tba_lower.clone())],
                    )
                    .await
                    .map_err(|e| format!("Failed to read usdc_call_ledger: {:?}", e))?;

                info!("Total ledger rows: {}", ledger_rows.len());
                for row in ledger_rows {
                    info!("{:?}", row);
                }

                let balance = crate::ledger::get_tba_usdc_balance(db, &tba_lower)
                    .await
                    .map_err(|e| format!("Failed to get balance: {:?}", e))?;
                info!("\nCurrent USDC balance: {} USDC", balance);

                Ok(format!("Ledger printed for {} (check logs)", tba_address))
            }
        }
    }

    #[eth]
    async fn eth_subscription_result(
        &mut self,
        eth_sub_result: EthSubResult,
    ) -> Result<(), String> {
        info!("Handling eth subscription result");

        match eth_sub_result {
            Ok(eth_sub) => {
                if let Some(log) = eth::extract_log_from_subscription(&eth_sub)? {
                    eth::process_log_event(self, &log).await?;
                }
            }
            Err(error) => eth::handle_subscription_error(self, &error).await?,
        }

        Ok(())
    }

    #[ws]
    async fn handle_websocket(
        &mut self,
        channel_id: u32,
        message_type: WsMessageType,
        blob: LazyLoadBlob,
    ) {
        info!("Handling WebSocket message: {:?}", message_type);
        match message_type {
            WsMessageType::Text | WsMessageType::Binary => {
                let message_bytes = blob.bytes.clone();
                let message_str = String::from_utf8(message_bytes).unwrap_or_default();

                // Parse the incoming message
                match serde_json::from_str::<WsClientMessage>(&message_str) {
                    Ok(msg) => {
                        info!("Parsed WebSocket message: {:?}", msg);
                        match msg {
                            WsClientMessage::Subscribe { topics } => {
                                info!("subscribe");
                                let topics = topics.unwrap_or_else(|| vec![StateUpdateTopic::All]);

                                // Add connection
                                let conn = WsConnection {
                                    channel_id,
                                    subscribed_topics: topics.clone(),
                                    connected_at: SystemTime::now()
                                        .duration_since(UNIX_EPOCH)
                                        .unwrap()
                                        .as_secs(),
                                };
                                self.ws_connections.insert(channel_id, conn);

                                // Send subscription confirmation
                                let response = WsServerMessage::Subscribed {
                                    topics: topics.clone(),
                                };
                                self.send_ws_message(channel_id, response);

                                info!("topics: {:#?}", topics.clone());

                                // Send initial state snapshot
                                self.send_state_snapshot(channel_id).await;
                            }
                            WsClientMessage::Unsubscribe { topics } => {
                                if let Some(topics) = topics {
                                    if let Some(conn) = self.ws_connections.get_mut(&channel_id) {
                                        conn.subscribed_topics.retain(|t| !topics.contains(t));
                                    }
                                }
                            }
                            WsClientMessage::Ping => {
                                info!("ping!");
                                let response = WsServerMessage::Pong;
                                self.send_ws_message(channel_id, response);
                            }
                        }
                    }
                    Err(e) => {
                        error!("Failed to parse WebSocket message: {}", e);
                        let error_response = WsServerMessage::Error {
                            error: format!("Invalid message format: {}", e),
                        };
                        self.send_ws_message(channel_id, error_response);
                    }
                }
            }
            WsMessageType::Close => {
                self.ws_connections.remove(&channel_id);
                info!("WebSocket client {} disconnected", channel_id);
            }
            WsMessageType::Ping | WsMessageType::Pong => {
                info!("ping/pong");
            }
        }
    }
}

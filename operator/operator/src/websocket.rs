use crate::structs::{ActiveAccountDetails, CallRecord, HotWalletAuthorizedClient, WalletSummary};
use crate::wallet;
use crate::OperatorProcess;
use hyperware_process_lib::http::server::{send_ws_push, WsMessageType};
use hyperware_process_lib::logging::error;
use hyperware_process_lib::LazyLoadBlob;
use serde::{Deserialize, Serialize};

// Client -> Server messages
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum WsClientMessage {
    // Subscribe to state updates (no auth needed for read-only)
    Subscribe {
        // Optional: specific topics to subscribe to
        topics: Option<Vec<StateUpdateTopic>>,
    },
    // Unsubscribe from updates
    Unsubscribe {
        topics: Option<Vec<StateUpdateTopic>>,
    },
    // Ping for keepalive
    Ping,
}

// Server -> Client messages
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum WsServerMessage {
    // Subscription confirmed
    Subscribed {
        topics: Vec<StateUpdateTopic>,
    },
    // State update notification
    StateUpdate {
        topic: StateUpdateTopic,
        data: StateUpdateData,
    },
    // Full state snapshot (sent on initial connection)
    StateSnapshot {
        state: StateSnapshotData,
    },
    // Error message
    Error {
        error: String,
    },
    // Pong response
    Pong,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum StateUpdateTopic {
    Wallets,       // Wallet creation/deletion/selection
    Transactions,  // New calls/transactions
    Providers,     // Provider updates
    Authorization, // Client authorization changes
    GraphState,    // Coarse state changes
    All,           // Subscribe to everything
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "update_type", rename_all = "snake_case")]
pub enum StateUpdateData {
    // Wallet was created, deleted, or selected
    WalletUpdate {
        wallets: Vec<WalletSummary>,
        selected_wallet_id: Option<String>,
        active_signer_wallet_id: Option<String>,
        active_account: Option<ActiveAccountDetails>,
    },
    // New transaction/call record
    NewTransaction {
        record: CallRecord,
    },
    // Provider search results updated
    ProviderUpdate {
        // For now, just notify that providers changed
        // Client should re-fetch if needed
        update_info: String,
    },
    // Authorization client added/removed
    AuthorizationUpdate {
        clients: Vec<(String, serde_json::Value)>,
    },
    // Graph coarse state changed
    GraphStateUpdate {
        coarse_state: String,
        operator_tba_address: Option<String>,
        operator_entry_name: Option<String>,
        paymaster_approved: Option<bool>,
    },
    // Balance update
    BalanceUpdate {
        wallet_id: String,
        eth_balance: Option<String>,
        usdc_balance: Option<String>,
    },
}

// Snapshot of current state for initial connection
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StateSnapshotData {
    pub wallets: Vec<WalletSummary>,
    pub selected_wallet_id: Option<String>,
    pub active_account: Option<ActiveAccountDetails>,
    pub recent_transactions: Vec<CallRecord>, // Last 50
    pub authorized_clients: Vec<(String, serde_json::Value)>, // Now includes spending data
    pub coarse_state: String,
    pub operator_tba_address: Option<String>,
    pub operator_entry_name: Option<String>,
    pub gasless_enabled: Option<bool>, // Indicates if operator is fully set up
    pub paymaster_approved: Option<bool>, // Indicates if paymaster is approved for USDC spending
    pub client_limits_cache: Vec<(String, crate::structs::SpendingLimits)>,
}

// WebSocket connection info
#[derive(Debug, Clone)]
pub struct WsConnection {
    pub channel_id: u32,
    pub subscribed_topics: Vec<StateUpdateTopic>,
    pub connected_at: u64,
}

impl OperatorProcess {
    /// Send a WebSocket message to a specific client
    pub(crate) fn send_ws_message(&self, channel_id: u32, message: WsServerMessage) {
        match serde_json::to_string(&message) {
            Ok(json) => {
                send_ws_push(
                    channel_id,
                    WsMessageType::Text,
                    LazyLoadBlob::new(Some("application/json"), json),
                );
            }
            Err(e) => {
                error!("Failed to serialize WebSocket message: {}", e);
            }
        }
    }

    /// Send initial state snapshot to a newly connected client
    pub(crate) async fn send_state_snapshot(&self, channel_id: u32) {
        // Build wallet summaries
        let wallets = wallet::build_wallet_summary_list(&self.state);

        // Get active account details
        let mut active_account = wallet::get_active_account_details(&self.state);

        // Fetch USDC balance from ledger if we have an operator TBA
        if let (Some(account), Some(db), Some(tba)) = (
            active_account.as_mut(),
            self.db_conn.as_ref(),
            self.state.operator_tba_address.as_ref(),
        ) {
            match crate::ledger::get_tba_usdc_balance(db, &tba).await {
                Ok(balance) => {
                    account.usdc_balance = Some(format!("{:.6}", balance));
                }
                Err(e) => {
                    error!("Failed to get USDC balance from ledger: {:?}", e);
                }
            }
        }

        // Get recent transactions from ledger (last 50)
        let recent_transactions = if let (Some(db), Some(tba)) = (
            self.db_conn.as_ref(),
            self.state.operator_tba_address.as_ref(),
        ) {
            match crate::ledger::load_recent_call_history(db, tba, 50, Some(&self.state)).await {
                Ok(ledger_records) => {
                    // If we have ledger records, use them
                    if !ledger_records.is_empty() {
                        ledger_records
                    } else {
                        // Fall back to in-memory state if ledger is empty
                        self.state
                            .call_history
                            .iter()
                            .rev()
                            .take(50)
                            .cloned()
                            .collect()
                    }
                }
                Err(e) => {
                    error!("Failed to load call history from ledger: {:?}", e);
                    // Fall back to in-memory state on error
                    self.state
                        .call_history
                        .iter()
                        .rev()
                        .take(50)
                        .cloned()
                        .collect()
                }
            }
        } else {
            // No DB or TBA, use in-memory state
            self.state
                .call_history
                .iter()
                .rev()
                .take(50)
                .cloned()
                .collect()
        };

        // Get graph coarse state
        let coarse_state = self.determine_coarse_state();

        // Merge authorized clients with their spending limits
        let authorized_clients_with_spending = self
            .state
            .authorized_clients
            .iter()
            .map(|(id, client)| {
                // Find spending limits for this client
                let spending_info = self
                    .state
                    .client_limits_cache
                    .iter()
                    .find(|(cache_id, _)| cache_id == id)
                    .map(|(_, limits)| limits);

                // Create a merged representation
                let mut client_data =
                    serde_json::to_value(client).unwrap_or(serde_json::Value::Null);
                if let serde_json::Value::Object(ref mut obj) = client_data {
                    // Add spending data with UI-expected field names
                    if let Some(limits) = spending_info {
                        if let Some(total_spent) = &limits.total_spent {
                            // Parse the string to a number for the UI
                            if let Ok(spent_num) = total_spent.parse::<f64>() {
                                obj.insert(
                                    "monthlySpent".to_string(),
                                    serde_json::json!(spent_num),
                                );
                            }
                        }
                        if let Some(max_total) = &limits.max_total {
                            if let Ok(limit_num) = max_total.parse::<f64>() {
                                obj.insert(
                                    "monthlyLimit".to_string(),
                                    serde_json::json!(limit_num),
                                );
                            }
                        }
                    }
                }

                (id.clone(), client_data)
            })
            .collect::<Vec<_>>();

        let snapshot = StateSnapshotData {
            wallets,
            selected_wallet_id: self.state.selected_wallet_id.clone(),
            active_account,
            recent_transactions,
            authorized_clients: authorized_clients_with_spending,
            coarse_state,
            operator_tba_address: self.state.operator_tba_address.clone(),
            operator_entry_name: self.state.operator_entry_name.clone(),
            gasless_enabled: self.state.gasless_enabled,
            paymaster_approved: self.state.paymaster_approved,
            client_limits_cache: self.state.client_limits_cache.clone(),
        };

        let message = WsServerMessage::StateSnapshot { state: snapshot };
        self.send_ws_message(channel_id, message);
    }

    /// Broadcast a state update to all connected clients that are subscribed to the topic
    pub(crate) fn broadcast_state_update(&self, topic: StateUpdateTopic, data: StateUpdateData) {
        let connections: Vec<_> = self.ws_connections.iter().collect();

        for (channel_id, conn) in connections {
            // Check if client is subscribed to this topic or to "All"
            if conn.subscribed_topics.contains(&topic)
                || conn.subscribed_topics.contains(&StateUpdateTopic::All)
            {
                let message = WsServerMessage::StateUpdate {
                    topic: topic.clone(),
                    data: data.clone(),
                };
                self.send_ws_message(*channel_id, message);
            }
        }
    }

    /// Helper to determine current coarse state
    fn determine_coarse_state(&self) -> String {
        if self.state.operator_entry_name.is_none() || self.state.operator_tba_address.is_none() {
            "beforeWallet".to_string()
        } else if !self.state.paymaster_approved.unwrap_or(false)
            || !self.state.gasless_enabled.unwrap_or(false)
        {
            // If paymaster not approved or gasless not enabled, still in setup phase
            "afterWalletNoClients".to_string()
        } else if self.state.authorized_clients.is_empty() {
            "afterWalletNoClients".to_string()
        } else {
            "afterWalletWithClients".to_string()
        }
    }

    /// Notify clients about wallet changes
    pub(crate) fn notify_wallet_update(&self) {
        let wallets = wallet::build_wallet_summary_list(&self.state);
        let active_account = wallet::get_active_account_details(&self.state);
        let data = StateUpdateData::WalletUpdate {
            wallets,
            selected_wallet_id: self.state.selected_wallet_id.clone(),
            active_signer_wallet_id: self.state.active_signer_wallet_id.clone(),
            active_account,
        };
        self.broadcast_state_update(StateUpdateTopic::Wallets, data);
    }

    /// Notify clients about new transaction
    pub(crate) fn notify_new_transaction(&self, record: &crate::structs::CallRecord) {
        let data = StateUpdateData::NewTransaction {
            record: record.clone(),
        };
        self.broadcast_state_update(StateUpdateTopic::Transactions, data);
    }

    /// Notify clients about authorization changes
    pub(crate) fn notify_authorization_update(&self) {
        // Merge authorized clients with their spending limits
        let authorized_clients_with_spending = self
            .state
            .authorized_clients
            .iter()
            .map(|(id, client)| {
                // Find spending limits for this client
                let spending_info = self
                    .state
                    .client_limits_cache
                    .iter()
                    .find(|(cache_id, _)| cache_id == id)
                    .map(|(_, limits)| limits);

                // Create a merged representation
                let mut client_data =
                    serde_json::to_value(client).unwrap_or(serde_json::Value::Null);
                if let serde_json::Value::Object(ref mut obj) = client_data {
                    // Add spending data with UI-expected field names
                    if let Some(limits) = spending_info {
                        if let Some(total_spent) = &limits.total_spent {
                            // Parse the string to a number for the UI
                            if let Ok(spent_num) = total_spent.parse::<f64>() {
                                obj.insert(
                                    "monthlySpent".to_string(),
                                    serde_json::json!(spent_num),
                                );
                            }
                        }
                        if let Some(max_total) = &limits.max_total {
                            if let Ok(limit_num) = max_total.parse::<f64>() {
                                obj.insert(
                                    "monthlyLimit".to_string(),
                                    serde_json::json!(limit_num),
                                );
                            }
                        }
                    }
                }

                (id.clone(), client_data)
            })
            .collect::<Vec<_>>();

        let data = StateUpdateData::AuthorizationUpdate {
            clients: authorized_clients_with_spending,
        };
        self.broadcast_state_update(StateUpdateTopic::Authorization, data);
    }

    /// Notify clients about graph state changes
    pub(crate) fn notify_graph_state_update(&self) {
        let coarse_state = self.determine_coarse_state();
        let data = StateUpdateData::GraphStateUpdate {
            coarse_state,
            operator_tba_address: self.state.operator_tba_address.clone(),
            operator_entry_name: self.state.operator_entry_name.clone(),
            paymaster_approved: self.state.paymaster_approved,
        };
        self.broadcast_state_update(StateUpdateTopic::GraphState, data);
    }

    /// Notify clients about wallet/balance updates
    pub(crate) async fn notify_wallet_balance_update(&self) {
        // Get active account details with updated balance
        let mut active_account = wallet::get_active_account_details(&self.state);

        // Fetch USDC balance from ledger if we have an operator TBA
        if let (Some(account), Some(db), Some(tba)) = (
            active_account.as_mut(),
            self.db_conn.as_ref(),
            self.state.operator_tba_address.as_ref(),
        ) {
            match crate::ledger::get_tba_usdc_balance(db, &tba).await {
                Ok(balance) => {
                    account.usdc_balance = Some(format!("{:.6}", balance));
                }
                Err(e) => {
                    error!("Failed to get USDC balance from ledger: {:?}", e);
                }
            }
        }

        // Send wallet update with balance
        let data = StateUpdateData::WalletUpdate {
            wallets: wallet::build_wallet_summary_list(&self.state),
            selected_wallet_id: self.state.selected_wallet_id.clone(),
            active_signer_wallet_id: self.state.active_signer_wallet_id.clone(),
            active_account,
        };
        self.broadcast_state_update(StateUpdateTopic::Wallets, data);
    }
}

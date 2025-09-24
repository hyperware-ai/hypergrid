use crate::app_api_types::{AuthorizeResult, KeyValue, ProviderSearchResult};
use crate::structs::{
    generate_shim_client_id, operator_api_base_path, operator_base_path, CallRecord, ClientStatus,
    ConfigureAuthorizedClientDto, ConfigureAuthorizedClientResult, HotWalletAuthorizedClient,
    PaymentAttemptResult, ServiceCapabilities, State, DEFAULT_NODE_NAME,
};
// use crate::ledger; // TODO: Enable when ledger is async
use alloy_primitives::Address as EthAddress;
use hex;
use hyperware_process_lib::{
    hyperwallet_client,
    logging::{error, info, warn},
    sqlite::Sqlite,
    Request as ProcessRequest,
};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::HashMap;

/// Details about a provider fetched from the database
#[derive(Debug)]
pub struct ProviderDetails {
    pub wallet_address: String,
    pub price_str: String,
    pub provider_id: String,
    pub provider_name: String,
}

/// Hash an authentication token using SHA-256
pub fn hash_authentication_token(token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    format!("{:x}", hasher.finalize())
}

/// Create a new authorization client for a shim
pub fn create_authorization_client(
    node: &str,
    client_id: &str,
    hashed_token: &str,
    name: Option<String>,
) -> HotWalletAuthorizedClient {
    // Use provided name or generate a default
    let client_name = name.unwrap_or_else(|| generate_default_client_name("", client_id));

    HotWalletAuthorizedClient {
        id: client_id.to_string(),
        name: client_name,
        associated_hot_wallet_address: String::new(), // Will be set later if needed
        authentication_token: hashed_token.to_string(),
        capabilities: ServiceCapabilities::All,
        status: ClientStatus::Active,
    }
}

/// Store a client in the operator state
pub fn store_client(state: &mut State, client_id: String, client: HotWalletAuthorizedClient) {
    state.authorized_clients.push((client_id.clone(), client));
    info!("Created new shim client: {}", client_id);
}

/// Build the authorization response for the shim to save
pub fn build_authorization_response(
    client_id: String,
    token: String,
    node: String,
) -> AuthorizeResult {
    AuthorizeResult {
        url: operator_base_path(),
        token, // Return raw token for shim to save
        client_id,
        node,
    }
}

/// Verify owner authentication (TODO: implement when auth is ready)
pub fn verify_owner_authentication(_req: &ConfigureAuthorizedClientDto) -> Result<(), String> {
    // TODO:
    Ok(())
}

/// Update an existing client's configuration
pub fn update_existing_client(
    state: &mut State,
    client_id: &str,
    hashed_token: &str,
    req: &ConfigureAuthorizedClientDto,
) -> Result<(String, bool), String> {
    if let Some((_, existing_client)) = state
        .authorized_clients
        .iter_mut()
        .find(|(id, _)| id == client_id)
    {
        info!("Configure Client: Updating existing client {}", client_id);
        existing_client.authentication_token = hashed_token.to_string();
        if let Some(new_name) = &req.client_name {
            existing_client.name = new_name.clone();
        }
        // Note: We don't update the hot wallet address for existing clients
        Ok((client_id.to_string(), true))
    } else {
        Err("Client not found".to_string())
    }
}

/// Create a new client with configuration
pub fn create_new_client(
    state: &mut State,
    req: &ConfigureAuthorizedClientDto,
    hashed_token: &str,
) -> Result<(String, bool), String> {
    let new_client_id = generate_shim_client_id();
    info!("Configure Client: Creating new client {}", new_client_id);

    let default_name =
        generate_default_client_name(&req.hot_wallet_address_to_associate, &new_client_id);

    let new_client = HotWalletAuthorizedClient {
        id: new_client_id.clone(),
        name: req.client_name.clone().unwrap_or(default_name),
        associated_hot_wallet_address: req.hot_wallet_address_to_associate.clone(),
        authentication_token: hashed_token.to_string(),
        capabilities: ServiceCapabilities::All,
        status: ClientStatus::Active,
    };

    state
        .authorized_clients
        .push((new_client_id.clone(), new_client));

    Ok((new_client_id, false))
}

/// Generate a default client name based on wallet address or client ID
pub fn generate_default_client_name(wallet_address: &str, client_id: &str) -> String {
    format!(
        "Hypergrid Client: {}",
        client_id.chars().take(8).collect::<String>()
    )
}

/// Log client operation for debugging
pub fn log_client_operation(client_id: &str, is_update: bool) {
    info!(
        "Configure Client: {} client with ID: {}",
        if is_update { "Updated" } else { "Created" },
        client_id
    );
}

/// Build the configuration response
pub fn build_configuration_response(
    client_id: String,
    raw_token: String,
    node_name: String,
) -> ConfigureAuthorizedClientResult {
    ConfigureAuthorizedClientResult {
        client_id,
        raw_token, // Echo back the raw token
        api_base_path: operator_api_base_path(),
        node_name,
    }
}

/// Authenticate a shim client using client ID and raw token
pub fn authenticate_client<'a>(
    state: &'a State,
    client_id: &str,
    raw_token: &str,
) -> Result<&'a HotWalletAuthorizedClient, String> {
    info!("Authenticating shim client: {}", client_id);

    // Look up the client
    let client = state
        .authorized_clients
        .iter()
        .find(|(id, _)| id == client_id)
        .map(|(_, client)| client)
        .ok_or_else(|| format!("Client not found: {}", client_id))?;

    // Check if client is halted
    if client.status == ClientStatus::Halted {
        return Err("Client is halted".to_string());
    }

    // Hash the provided token and compare
    let hashed_token = hash_authentication_token(raw_token);

    if hashed_token != client.authentication_token {
        return Err("Invalid authentication token".to_string());
    }

    Ok(client)
}

/// Get the full client configuration
pub fn get_client_config(
    state: &State,
    client_id: &str,
) -> Result<HotWalletAuthorizedClient, String> {
    state
        .authorized_clients
        .iter()
        .find(|(id, _)| id == client_id)
        .map(|(_, client)| client.clone())
        .ok_or_else(|| "Client configuration not found".to_string())
}

/// Perform a registry search using the database
pub async fn perform_registry_search(
    db: &hyperware_process_lib::sqlite::Sqlite,
    query: &str,
) -> Result<Vec<ProviderSearchResult>, String> {
    info!("Performing registry search for: {}", query);

    // Search providers in the database
    match crate::db::search_provider(db, query.to_string()).await {
        Ok(providers) => {
            // Convert database results to ProviderSearchResult
            let results = providers
                .into_iter()
                .filter_map(|mut provider| {
                    let provider_id = provider
                        .remove("provider_id")
                        .and_then(|v| v.as_str().map(String::from))
                        .unwrap_or_default();
                    let name = provider
                        .remove("name")
                        .and_then(|v| v.as_str().map(String::from))
                        .unwrap_or_default();
                    let description = provider
                        .remove("description")
                        .and_then(|v| v.as_str().map(String::from))
                        .unwrap_or_default();

                    if !provider_id.is_empty() || !name.is_empty() {
                        Some(ProviderSearchResult {
                            provider_id,
                            name,
                            description,
                        })
                    } else {
                        None
                    }
                })
                .collect();

            info!("Registry search results: {:#?}", results);
            Ok(results)
        }
        Err(e) => {
            error!("Database search failed: {:?}", e);
            Err(format!("Registry search failed: {:?}", e))
        }
    }
}

/// Fetch provider details from the database
pub async fn fetch_provider_from_db(
    db: &Sqlite,
    provider_id: &str,
) -> Result<ProviderDetails, String> {
    info!("Fetching provider details for: {}", provider_id);

    match crate::db::get_provider_details(db, provider_id).await {
        Ok(Some(details_map)) => {
            let provider_id = details_map
                .get("provider_id")
                .and_then(|v| v.as_str())
                .ok_or("Provider has no ID")?
                .to_string();

            let provider_name = details_map
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("Unknown")
                .to_string();

            let wallet_address = details_map
                .get("wallet")
                .and_then(|v| v.as_str())
                .unwrap_or("0x0")
                .to_string();

            let price_str = details_map
                .get("price")
                .and_then(|v| v.as_str())
                .unwrap_or("0.0")
                .to_string();

            Ok(ProviderDetails {
                provider_id,
                provider_name,
                wallet_address,
                price_str,
            })
        }
        Ok(None) => Err(format!("Provider '{}' not found", provider_id)),
        Err(e) => Err(format!("Database error looking up provider: {:?}", e)),
    }
}

/// Perform a health check on the provider
pub fn perform_health_check(provider_details: &ProviderDetails) -> Result<(), String> {
    info!(
        "Performing health check for provider {}",
        provider_details.provider_id
    );

    let target_address = hyperware_process_lib::Address::new(
        &provider_details.provider_id,
        ("provider", "hypergrid", crate::constants::PUBLISHER),
    );

    // Updated to match the new HealthCheckRequest format
    let health_check_request = serde_json::json!({
        "provider_name": provider_details.provider_name
    });

    let wrapped_request = serde_json::json!({
        "HealthPing": health_check_request
    });

    let request_body_bytes = serde_json::to_vec(&wrapped_request)
        .map_err(|e| format!("Failed to serialize health check request: {}", e))?;

    info!(
        "Sending health check ping to provider at {}",
        target_address
    );
    match ProcessRequest::new()
        .target(target_address.clone())
        .body(request_body_bytes)
        .send_and_await_response(7)
    {
        Ok(Ok(response)) => {
            info!(
                "Provider {} responded to health check",
                provider_details.provider_id
            );
            Ok(())
        }
        Ok(Err(e)) => {
            error!(
                "Provider {} health check failed: {:?}",
                provider_details.provider_id, e
            );
            Err(format!("Provider health check failed: {:?}", e))
        }
        Err(e) => {
            error!(
                "Provider {} health check timed out: {:?}",
                provider_details.provider_id, e
            );
            Err(format!("Provider health check timed out: {:?}", e))
        }
    }
}

/// Check and enforce client spending limits
pub async fn enforce_client_spending_limits(
    state: &State,
    db: &Sqlite,
    client_config: &HotWalletAuthorizedClient,
    provider_details: &ProviderDetails,
) -> Result<(), String> {
    // Parse the provider price
    let price_float = provider_details
        .price_str
        .parse::<f64>()
        .map_err(|_| format!("Invalid price format: {}", provider_details.price_str))?;

    // No check needed if price is zero
    if price_float <= 0.0 {
        return Ok(());
    }

    // Check if client has spending limits configured
    if let Some((_, limits)) = state
        .client_limits_cache
        .iter()
        .find(|(id, _)| id == &client_config.id)
    {
        if let Some(max_total_str) = &limits.max_total {
            // Get the operator TBA address
            let tba_address = state
                .operator_tba_address
                .as_ref()
                .ok_or("Operator TBA not configured")?;

            // Query total spending for this client
            let query = r#"SELECT COALESCE(SUM(CAST(total_cost_units AS INTEGER)), 0) AS total FROM usdc_call_ledger WHERE tba_address = ?1 AND client_id = ?2"#;
            let rows = db
                .read(
                    query.to_string(),
                    vec![
                        serde_json::Value::String(tba_address.to_lowercase()),
                        serde_json::Value::String(client_config.id.clone()),
                    ],
                )
                .await
                .map_err(|e| format!("Failed to query spending: {:?}", e))?;

            let spent_units = rows
                .get(0)
                .and_then(|r| r.get("total"))
                .and_then(|v| v.as_i64())
                .unwrap_or(0) as i128;

            // Convert price to units (USDC has 6 decimals)
            let price_units = (price_float * 1_000_000.0) as i128;
            let projected_total = spent_units.saturating_add(price_units);

            // Parse limit
            let limit_float = max_total_str
                .parse::<f64>()
                .map_err(|_| format!("Invalid limit format: {}", max_total_str))?;
            let limit_units = (limit_float * 1_000_000.0) as i128;

            if projected_total > limit_units {
                return Err(format!(
                    "Client spending limit exceeded. Limit: {} USDC, Current + Requested: {} USDC",
                    limit_float,
                    projected_total as f64 / 1_000_000.0
                ));
            }
        }
    }

    Ok(())
}

/// Result of payment processing
pub enum PaymentProcessingResult {
    Success { tx_hash: String },
    NotRequired,
    Failed(PaymentAttemptResult),
}

impl PaymentProcessingResult {
    pub fn tx_hash(&self) -> Option<String> {
        match self {
            PaymentProcessingResult::Success { tx_hash } => Some(tx_hash.clone()),
            _ => None,
        }
    }

    pub fn is_success(&self) -> bool {
        matches!(self, PaymentProcessingResult::Success { .. })
    }

    pub fn to_payment_attempt_result(&self, price: &str) -> Option<PaymentAttemptResult> {
        match self {
            PaymentProcessingResult::Success { tx_hash } => Some(PaymentAttemptResult::Success {
                tx_hash: tx_hash.clone(),
                amount_paid: price.to_string(),
                currency: "USDC".to_string(),
            }),
            PaymentProcessingResult::NotRequired => Some(PaymentAttemptResult::Skipped {
                reason: "Zero price or no payment required".to_string(),
            }),
            PaymentProcessingResult::Failed(result) => Some(result.clone()),
        }
    }
}

/// Process payment if required
pub async fn process_payment_if_required(
    process: &mut crate::OperatorProcess,
    provider_details: &ProviderDetails,
    client_config_opt: Option<&HotWalletAuthorizedClient>,
) -> Result<PaymentProcessingResult, String> {
    // Parse price
    let price_float = provider_details.price_str.parse::<f64>().unwrap_or(0.0);
    if price_float <= 0.0 {
        info!(
            "No payment required (price: {})",
            provider_details.price_str
        );
        return Ok(PaymentProcessingResult::NotRequired);
    }

    // Determine which wallet to use
    let signer_wallet_id = if let Some(client_config) = client_config_opt {
        // Use client's associated wallet
        info!(
            "Payment via shim client {} wallet {}",
            client_config.id, client_config.associated_hot_wallet_address
        );
        client_config.associated_hot_wallet_address.clone()
    } else {
        // Use selected wallet (UI flow)
        process
            .state
            .selected_wallet_id
            .as_ref()
            .ok_or("No wallet selected for payment")?
            .clone()
    };

    info!(
        "Processing payment of {} USDC to {} for provider {} using wallet {}",
        provider_details.price_str,
        provider_details.wallet_address,
        provider_details.provider_id,
        signer_wallet_id
    );

    // Validate hyperwallet session
    let session = process
        .hyperwallet_session
        .as_ref()
        .ok_or("Hyperwallet session not initialized")?;

    // Validate operator TBA
    let operator_tba = process
        .state
        .operator_tba_address
        .as_ref()
        .ok_or("Operator TBA not configured")?;

    // Parse recipient address
    let recipient_addr = provider_details
        .wallet_address
        .parse::<EthAddress>()
        .map_err(|_| {
            format!(
                "Invalid recipient address: {}",
                provider_details.wallet_address
            )
        })?;

    // Convert amount to units (USDC has 6 decimals)
    let amount_units = (price_float * 1_000_000.0) as u128;

    // Execute gasless payment
    match hyperwallet_client::execute_gasless_payment(
        &session.session_id,
        &signer_wallet_id,
        operator_tba,
        &recipient_addr.to_string(),
        amount_units,
    ) {
        Ok(tx_hash) => {
            info!("Payment successful: tx_hash = {}", tx_hash);
            Ok(PaymentProcessingResult::Success { tx_hash })
        }
        Err(e) => {
            error!("Payment failed: {}", e);
            let payment_result = PaymentAttemptResult::Failed {
                error: format!("Payment failed: {}", e),
                amount_attempted: provider_details.price_str.clone(),
                currency: "USDC".to_string(),
            };
            Err(format!("Payment failed: {}", e))
        }
    }
}

/// Execute provider call with comprehensive metrics and call history recording
pub async fn execute_provider_call_with_metrics(
    process: &mut crate::OperatorProcess,
    provider_details: ProviderDetails,
    provider_name: String,
    args: Vec<KeyValue>,
    timestamp_start_ms: u128,
    call_args_json: String,
    payment_result: PaymentProcessingResult,
    client_config_opt: Option<HotWalletAuthorizedClient>,
) -> Result<String, String> {
    // Parse provider address
    //let provider_address = provider_details.provider_id.parse::<hyperware_process_lib::Address>()
    //    .map_err(|_| format!("Invalid provider address: {}", provider_details.provider_id))?;

    let provider_address = hyperware_process_lib::Address::new(
        &provider_details.provider_id,
        ("provider", "hypergrid", crate::constants::PUBLISHER),
    );

    // Prepare provider request in the expected format
    let provider_request_data = serde_json::json!({
        "provider_name": provider_name.clone(),
        "arguments": args.iter().map(|kv| vec![kv.key.clone(), kv.value.clone()]).collect::<Vec<_>>(),
        "payment_tx_hash": match &payment_result {
            PaymentProcessingResult::Success { tx_hash } => Some(tx_hash.clone()),
            _ => None,
        }
    });

    // Wrap in the expected enum variant format
    let provider_request = serde_json::json!({
        "CallProvider": provider_request_data
    });

    let request_bytes = serde_json::to_vec(&provider_request)
        .map_err(|e| format!("Failed to serialize provider request: {}", e))?;

    info!(
        "Calling provider {} at address {}",
        provider_name, provider_address
    );

    // Make the provider call
    let (call_success, response_json) = match ProcessRequest::new()
        .target(provider_address.clone())
        .body(request_bytes)
        .send_and_await_response(60) // call provider timeout. increase if necessary whomstdgth'ever takes over this. 
    {
        Ok(Ok(response_message)) => {
            let response_bytes = response_message.body();
            let json_response = match serde_json::from_slice::<serde_json::Value>(response_bytes) {
                Ok(json) => json,
                Err(_) => serde_json::json!({
                                "raw_response": String::from_utf8_lossy(response_bytes)
                }),
            };
            (true, json_response)
        }
        Ok(Err(e)) => {
            error!("Provider returned error: {:?}", e);
            (
                false,
                serde_json::json!({
                        "error": format!("Provider error: {:?}", e)
                }),
            )
        }
        Err(e) => {
            error!("Failed to call provider: {}", e);
            (
                false,
                serde_json::json!({
                        "error": format!("Failed to call provider: {}", e)
                }),
            )
        }
    };

    let response_timestamp_ms = chrono::Utc::now().timestamp_millis() as u128;

    // Build the wrapped response
    let wrapped_response = serde_json::json!({
                "provider": {
            "id": provider_details.provider_id,
            "name": provider_name.clone(),
        },
        "response": response_json,
        "payment": match &payment_result {
            PaymentProcessingResult::Success { tx_hash } => {
                        serde_json::json!({"status": "success", "tx_hash": tx_hash})
                    },
            _ => serde_json::json!({"status": "skipped"})
        }
    });

    // Record in call history
    let call_record = CallRecord {
        timestamp_start_ms: timestamp_start_ms as u64,
        provider_lookup_key: provider_details.provider_id.clone(),
        target_provider_id: provider_details.provider_id.clone(),
        call_args_json,
        response_json: Some(serde_json::to_string(&wrapped_response).unwrap_or_default()),
        call_success,
        response_timestamp_ms: response_timestamp_ms as u64,
        payment_result: payment_result
            .to_payment_attempt_result(&provider_details.price_str)
            .map(|pr| serde_json::to_string(&pr).unwrap_or_default()),
        duration_ms: (response_timestamp_ms - timestamp_start_ms) as u64,
        operator_wallet_id: client_config_opt
            .as_ref()
            .map(|c| c.associated_hot_wallet_address.clone())
            .or(process.state.selected_wallet_id.clone()),
        client_id: client_config_opt.as_ref().map(|c| c.id.clone()),
        provider_name: Some(provider_name),
    };

    process.state.call_history.push(call_record);

    // Limit call history size
    const MAX_HISTORY: usize = 500;
    if process.state.call_history.len() > MAX_HISTORY {
        process
            .state
            .call_history
            .drain(..process.state.call_history.len() - MAX_HISTORY);
    }

    // Update ledger if payment succeeded
    if let PaymentProcessingResult::Success { tx_hash } = &payment_result {
        if let Some(tba) = process.state.operator_tba_address.clone() {
            if let Some(db) = &process.db_conn {
                // Ensure ledger is updated
                let provider =
                    hyperware_process_lib::eth::Provider::new(crate::structs::CHAIN_ID, 30000);
                let _ = crate::ledger::ensure_usdc_events_table(db).await;
                let _ = crate::ledger::ensure_usdc_call_ledger_table(db).await;
                let _ = crate::ledger::ensure_call_tx_covered(
                    &process.state,
                    db,
                    &provider,
                    &tba.to_lowercase(),
                    tx_hash,
                )
                .await;
                if client_config_opt.is_some() {
                    let _ = process
                        .state
                        .refresh_client_totals_from_ledger(db, &tba)
                        .await;
                    // Notify WebSocket clients about the updated spending
                    process.notify_authorization_update();
                }
            }
        }
    }

    //process.state.save();

    // Notify WebSocket clients
    process.notify_graph_state_update();
    process.notify_wallet_balance_update().await;
    if payment_result.is_success() {
        if let Some(last_record) = process.state.call_history.last() {
            process.notify_new_transaction(last_record);
        }
    }

    // Return the wrapped response
    serde_json::to_string(&wrapped_response).map_err(|e| e.to_string())
}

use std::collections::HashMap;

use chrono::{Utc};
use hyperware_process_lib::{
    last_blob,
    http::{
        Method, 
        StatusCode,
        Response as HttpResponse,
        server::{send_response, HttpServerRequest, IncomingHttpRequest},
    },
    logging::{error, info, warn},
    signer::Signer,
    sqlite::Sqlite,
    vfs,
    Address, 
    Request as ProcessRequest,
};
use serde_json::{json, Value};
use sha2::{Sha256, Digest};
use uuid::Uuid;
use crate::constants::PUBLISHER;

use crate::{
    authorized_services::{HotWalletAuthorizedClient, ServiceCapabilities},
    db as dbm,
    helpers::send_json_response,
    structs::{*, ConfigureAuthorizedClientRequest, ConfigureAuthorizedClientResponse, McpRequest, ApiRequest},
    hyperwallet_client::{service as hyperwallet_service, payments as hyperwallet_payments},
    graph::handle_get_hypergrid_graph_layout,
};

// ===========================================================================================
// TYPE DEFINITIONS - Domain models for HTTP handling
// ===========================================================================================

/// Details about a provider fetched from the database
pub struct ProviderDetails {
    wallet_address: String,
    price_str: String,
    provider_id: String,
}

/// Result of attempting to fetch provider details
enum FetchProviderResult {
    Success(ProviderDetails),
    NotFound(String),
}

/// Result of attempting a payment
enum PaymentResult {
    NotRequired,
    Success(String), // tx hash
    Failed(PaymentAttemptResult),
}

/// Result of calling a provider
enum ProviderCallResult {
    Success(Vec<u8>),
    Failed(anyhow::Error),
}

// ===========================================================================================
// MAIN ENTRY POINT - Routes all HTTP requests from http-server
// ===========================================================================================

/// Main HTTP request handler - receives all requests from http-server:distro:sys
/// Deserializes the request and routes to appropriate handler based on path/method
pub fn handle_frontend(our: &Address, body: &[u8], state: &mut State, db: &Sqlite) -> anyhow::Result<()> {
    info!("handle_frontend received request");
    
    let server_request = deserialize_request(body)?;
    let HttpServerRequest::Http(req) = server_request else {
        info!("Ignoring non-HTTP ServerRequest");
            return Ok(());
    };

    route_http_request(our, &req, state, db)
}

// ===========================================================================================
// REQUEST ROUTING - Maps HTTP paths to handler functions
// ===========================================================================================

fn deserialize_request(body: &[u8]) -> anyhow::Result<HttpServerRequest> {
    serde_json::from_slice(body).map_err(|e| {
        error!("Failed to deserialize HttpServerRequest: {}", e);
        send_response(StatusCode::BAD_REQUEST, None, b"Invalid request format".to_vec());
        anyhow::anyhow!("Deserialization failed: {}", e)
    })
}

fn route_http_request(
    our: &Address,
    req: &IncomingHttpRequest,
    state: &mut State,
    db: &Sqlite,
) -> anyhow::Result<()> {
            let method = req.method()?;
    let path = req.path()?;
    
    info!("Processing HTTP request: {} {}", method, path);

    match (method.clone(), path.as_str()) {
        // Shim authentication endpoints
        (Method::POST, "/api/authorize-shim") => handle_authorize_shim_route(our, req, state, db),
        (Method::POST, "/api/configure-authorized-client") => handle_configure_client_route(our, req, state, db),
        
        // MCP endpoints (actual Model Context Provider operations)
        (Method::POST, "/api/mcp") => handle_mcp_route(our, state, db, None),
        (Method::POST, "/shim/mcp") => handle_shim_mcp_route(our, req, state, db),
        
        // Regular API endpoints (wallet, history, etc)
        (Method::POST, "/api/actions") => handle_api_actions_route(our, state, db),
        
        // GET endpoints
        (Method::GET, path) => handle_get(our, path, req.query_params(), state, db),
        
        // Unhandled routes
        _ => {
            warn!("Unhandled route: {:?} {:?}", method, path);
            send_response(StatusCode::NOT_FOUND, None, b"Not Found".to_vec());
            Ok(())
        }
    }
}

// ===========================================================================================
// ROUTE HANDLERS - Individual endpoint implementations
// ===========================================================================================

fn handle_authorize_shim_route(
    our: &Address,
    req: &IncomingHttpRequest,
    state: &mut State,
    db: &Sqlite,
) -> anyhow::Result<()> {
    info!("Routing to handle_authorize_shim_request");
    match handle_authorize_shim_request(our, req, state, db) {
        Ok(response) => {
            let mut headers = HashMap::new();

            if let Some(content_type) = response.headers().get("Content-Type") {
                if let Ok(ct_str) = content_type.to_str() {
                     headers.insert("Content-Type".to_string(), ct_str.to_string());
                }
            }
            send_response(response.status(), Some(headers), response.body().clone());
            Ok(())
        }
        Err(e) => {
            error!("Error in handle_authorize_shim_request: {:?}", e);
            send_json_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                &json!({ "error": format!("Internal Server Error: {}", e) })
            )
        }
    }
}

fn handle_configure_client_route(
    our: &Address,
    req: &IncomingHttpRequest,
    state: &mut State,
    db: &Sqlite,
) -> anyhow::Result<()> {
    info!("Routing to handle_configure_authorized_client");
    match handle_configure_authorized_client(our, req, state, db) {
        Ok(response) => {
            let mut headers = HashMap::new();

            if let Some(content_type) = response.headers().get("Content-Type") {
                if let Ok(ct_str) = content_type.to_str() {
                     headers.insert("Content-Type".to_string(), ct_str.to_string());
                }
            }
            send_response(response.status(), Some(headers), response.body().clone());
            Ok(())
        }
        Err(e) => {
            error!("Error in handle_configure_authorized_client: {:?}", e);
            send_json_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                &json!({ "error": format!("Internal Server Error: {}", e) })
            )
        }
    }
}

fn handle_mcp_route(
    our: &Address,
    state: &mut State,
    db: &Sqlite,
    client_config: Option<HotWalletAuthorizedClient>,
) -> anyhow::Result<()> {
    info!("Routing to handle_post (for UI MCP)");
    handle_post(our, state, db, client_config)
}

fn handle_shim_mcp_route(
    our: &Address,
    req: &IncomingHttpRequest,
    state: &mut State,
    db: &Sqlite,
) -> anyhow::Result<()> {
    info!("Routing to handle_post (for Shim MCP) - Performing new Client Auth...");
                    
    // Extract authentication headers
    let client_id = req.headers().get("X-Client-ID")
        .and_then(|v| v.to_str().ok())
        .map(String::from);

    let token = req.headers().get("X-Token")
        .and_then(|v| v.to_str().ok())
        .map(String::from);

    let client_name = req.headers().get("X-Client-Name")
        .and_then(|v| v.to_str().ok())
        .map(String::from);

    // Authenticate shim client
    match authenticate_shim_with_headers(state, client_id.clone(), token) {
        Ok(client_config) => {
            info!(
                "Shim Client Auth: Validated successfully for Client ID: {}. Associated Hot Wallet: {}", 
                client_config.id, 
                client_config.associated_hot_wallet_address
            );

            // Update client name if provided and different from current
            if let Some(new_name) = client_name {
                if let Some(client_id_str) = &client_id {
                    if let Some(mut_client) = state.authorized_clients.get_mut(client_id_str) {
                        if mut_client.name != new_name {
                            info!("Updating client name from {} to {}", mut_client.name, new_name);
                            mut_client.name = new_name;
                            state.save();
                        }
                    }
                }
            }

            // Get fresh reference after potential mutation
            let updated_client_config = state.authorized_clients.get(client_id.as_ref().unwrap())
                .cloned()
                .unwrap();

            handle_post(our, state, db, Some(updated_client_config))
        }
        Err(auth_error) => {
            handle_shim_auth_error(auth_error)
        }
    }
}

fn handle_api_actions_route(
    _our: &Address,
    state: &mut State,
    _db: &Sqlite,
) -> anyhow::Result<()> {
    info!("Routing to handle_api_actions (for UI API operations)");
    handle_api_actions(state)
}

fn authenticate_shim_with_headers(
    state: &State,
    client_id: Option<String>,
    token: Option<String>,
) -> Result<&HotWalletAuthorizedClient, AuthError> {
    let id = client_id.ok_or(AuthError::MissingClientId)?;
    let tok = token.ok_or(AuthError::MissingToken)?;
    authenticate_shim_client(state, &id, &tok)
}

fn handle_shim_auth_error(auth_error: AuthError) -> anyhow::Result<()> {
    let (status, message) = match auth_error {
        AuthError::MissingClientId => (StatusCode::UNAUTHORIZED, "Missing X-Client-ID header"),
        AuthError::MissingToken => (StatusCode::UNAUTHORIZED, "Missing X-Token header"),
        AuthError::ClientNotFound => (StatusCode::UNAUTHORIZED, "Client ID not found"),
        AuthError::InvalidToken => (StatusCode::FORBIDDEN, "Invalid token"),
        AuthError::InsufficientCapabilities => (StatusCode::FORBIDDEN, "Client lacks necessary capabilities")
    };
    
    send_json_response(status, &json!({ "error": message }))
}

// ===========================================================================================
// MCP REQUEST HANDLING - Core business logic dispatcher
// ===========================================================================================

/// Main MCP request dispatcher - routes Model Context Provider operations
/// Only handles SearchRegistry and CallProvider - the actual MCP operations
fn handle_mcp(
    our: &Address, 
    req: McpRequest, 
    state: &mut State, 
    db: &Sqlite, 
    client_config_opt: Option<HotWalletAuthorizedClient>
) -> anyhow::Result<()> {
    info!("MCP request: {:?}", req);
    match req {
        // Registry operations
        McpRequest::SearchRegistry(query) => handle_search_registry(db, query),
        
        // Provider operations
        McpRequest::CallProvider {
            provider_id,
            provider_name,
            arguments,
        } => handle_provider_call_request(our, state, db, provider_id, provider_name, arguments, client_config_opt),
    }
}

/// API request dispatcher - routes regular frontend application operations
/// Handles wallet management, history, withdrawals, etc.
fn handle_api_actions(state: &mut State) -> anyhow::Result<()> {
    let blob = last_blob().ok_or(anyhow::anyhow!("Request body is missing for API request"))?;
    
    match serde_json::from_slice::<ApiRequest>(blob.bytes()) {
        Ok(req) => {
            info!("API request: {:?}", req);
            match req {
                ApiRequest::GetCallHistory {} => handle_get_call_history(state),
                ApiRequest::GetActiveAccountDetails {} => handle_get_active_account_details(state),
                ApiRequest::GetWalletSummaryList {} => handle_get_wallet_summary_list(state),
                ApiRequest::SelectWallet { wallet_id } => handle_select_wallet(state, wallet_id),
                ApiRequest::RenameWallet { wallet_id, new_name } => handle_rename_wallet(state, wallet_id, new_name),
                ApiRequest::DeleteWallet { wallet_id } => handle_delete_wallet(state, wallet_id),
                ApiRequest::GenerateWallet {} => handle_generate_wallet(state),
                ApiRequest::ImportWallet { private_key, password, name } => handle_import_wallet(state, private_key, password, name),
                ApiRequest::ActivateWallet { password } => handle_activate_wallet(state, password),
                ApiRequest::DeactivateWallet {} => handle_deactivate_wallet(state),
                ApiRequest::SetWalletLimits { limits } => handle_set_wallet_limits(state, limits),
                ApiRequest::SetClientLimits { client_id, limits } => handle_set_client_limits(state, client_id, limits),
                ApiRequest::ExportSelectedPrivateKey { password } => handle_export_private_key(state, password),
                ApiRequest::SetSelectedWalletPassword { new_password, old_password } => handle_set_wallet_password(state, new_password, old_password),
                ApiRequest::RemoveSelectedWalletPassword { current_password } => handle_remove_wallet_password(state, current_password),
                
                // Withdrawal from ui
                ApiRequest::WithdrawEthFromOperatorTba { to_address, amount_wei_str } => handle_withdraw_eth(state, to_address, amount_wei_str),
                ApiRequest::WithdrawUsdcFromOperatorTba { to_address, amount_usdc_units_str } => handle_withdraw_usdc(state, to_address, amount_usdc_units_str),
                
                // Authorized client management
        ApiRequest::RenameAuthorizedClient { client_id, new_name } => handle_rename_authorized_client(state, client_id, new_name),
        ApiRequest::DeleteAuthorizedClient { client_id } => handle_delete_authorized_client(state, client_id),
                
                // ERC-4337 configuration
                ApiRequest::SetGaslessEnabled { enabled } => handle_set_gasless_enabled(state, enabled),
            }
        }
        Err(e) if e.is_syntax() || e.is_data() => {
            error!("Failed to deserialize API request JSON: {}", e);
            send_json_response(
                StatusCode::BAD_REQUEST,
                &json!({ "error": format!("Invalid API request body: {}", e) })
            )?;
            Ok(())
        }
        Err(e) => {
            error!("Unexpected error reading API request blob: {}", e);
            Err(anyhow::anyhow!("Error reading API request body: {}", e))
        }
    }
}

// DEPRECATED: This function handles the old combined HttpMcpRequest format
// It remains for backwards compatibility but should be phased out
fn handle_legacy_mcp(
    our: &Address, 
    req: HttpMcpRequest, 
    state: &mut State, 
    db: &Sqlite, 
    client_config_opt: Option<HotWalletAuthorizedClient>
) -> anyhow::Result<()> {
    info!("mcp request: {:?}", req);
    match req {
        // Registry operations
        HttpMcpRequest::SearchRegistry(query) => {
            handle_search_registry(db, query)
        }
        
        // Provider operations
        HttpMcpRequest::CallProvider {
            provider_id,
            provider_name,
            arguments,
        } => {
            handle_provider_call_request(our, state, db, provider_id, provider_name, arguments, client_config_opt)
        }
        
        // History operations
        HttpMcpRequest::GetCallHistory {} => {
            handle_get_call_history(state)
        }
        
        // Wallet operations - grouped by function
        HttpMcpRequest::GetWalletSummaryList {} => {
            handle_get_wallet_summary_list(state)
        }
        HttpMcpRequest::SelectWallet { wallet_id } => {
            handle_select_wallet(state, wallet_id)
        }
        HttpMcpRequest::RenameWallet { wallet_id, new_name } => {
            handle_rename_wallet(state, wallet_id, new_name)
        }
        HttpMcpRequest::DeleteWallet { wallet_id } => {
            handle_delete_wallet(state, wallet_id)
        }
        HttpMcpRequest::GenerateWallet {} => {
            handle_generate_wallet(state)
        }
        HttpMcpRequest::ImportWallet { private_key, password, name } => {
            handle_import_wallet(state, private_key, password, name)
        }
        HttpMcpRequest::ActivateWallet { password } => {
            handle_activate_wallet(state, password)
        }
        HttpMcpRequest::DeactivateWallet {} => {
            handle_deactivate_wallet(state)
        }
        HttpMcpRequest::SetWalletLimits { limits } => {
            handle_set_wallet_limits(state, limits)
        }
        HttpMcpRequest::ExportSelectedPrivateKey { password } => {
            handle_export_private_key(state, password)
        }
        HttpMcpRequest::SetSelectedWalletPassword { new_password, old_password } => {
            handle_set_wallet_password(state, new_password, old_password)
        }
        HttpMcpRequest::RemoveSelectedWalletPassword { current_password } => {
            handle_remove_wallet_password(state, current_password)
        }
        HttpMcpRequest::GetActiveAccountDetails {} => {
            handle_get_active_account_details(state)
        }
        
        // Withdrawal operations
        HttpMcpRequest::WithdrawEthFromOperatorTba { to_address, amount_wei_str } => {
            handle_withdraw_eth(state, to_address, amount_wei_str)
        }
        HttpMcpRequest::WithdrawUsdcFromOperatorTba { to_address, amount_usdc_units_str } => {
            handle_withdraw_usdc(state, to_address, amount_usdc_units_str)
        }
    }
}

// ===========================================================================================
// GET REQUEST HANDLING - REST API endpoints
// ===========================================================================================

/// Routes GET requests to appropriate handlers based on path
fn handle_get(
    our: &Address,
    path_str: &str,
    params: &HashMap<String, String>,
    state: &mut State,
    db: &Sqlite,
) -> anyhow::Result<()> {
    info!("GET {} with params: {:?}", path_str, params);
    
    match path_str {
        // Status endpoints
        "/api/setup-status" | "setup-status" => handle_get_setup_status(state),
        
        // Graph visualization
        "/api/hypergrid-graph" | "/hypergrid-graph" => handle_get_hypergrid_graph_layout(our, state),
        
        // State inspection (debug)
        "/api/state" | "state" => handle_get_state(state),
        
        // Provider registry queries
        "/api/all" | "all" => handle_get_all_providers(db),
        "/api/search" | "search" => handle_search_providers(db, params),
        
        // Wallet endpoints
        "/api/managed-wallets" => handle_get_managed_wallets(state),
        "/api/linked-wallets" => handle_get_linked_wallets(state),
        
        // Unknown endpoint
        _ => {
            warn!("Unknown GET endpoint: {}", path_str);
            send_json_response(
                StatusCode::NOT_FOUND,
                &json!({ "error": "API endpoint not found" }),
            )
        }
    }
}

// --- GET Handler Functions ---

fn handle_get_setup_status(state: &State) -> anyhow::Result<()> {
    let is_configured = state.operator_tba_address.is_some();
    info!("Setup status check: configured={}", is_configured);
    send_json_response(StatusCode::OK, &json!({ "configured": is_configured }))
}

fn handle_get_state(state: &State) -> anyhow::Result<()> {
    info!("Returning full application state (enriched)");
    // Start with a JSON view of state
    let out = match serde_json::to_value(state) {
        Ok(v) => v,
        Err(_) => json!(state),
    };

    // Try to enrich call_history with ledger totals, same as in handle_get_call_history
    if let Some(db) = &state.db_conn {
        let mut rows = state.call_history.clone();
        for rec in &mut rows {
            let tx_opt = match &rec.payment_result {
                Some(crate::structs::PaymentAttemptResult::Success { tx_hash, .. }) => Some(tx_hash.clone()),
                _ => None,
            };
            if let Some(tx) = tx_opt {
                let q = r#"SELECT total_cost_units FROM usdc_call_ledger WHERE lower(tx_hash) = lower(?1) LIMIT 1"#.to_string();
                if let Ok(rs) = db.read(q, vec![serde_json::Value::String(tx.clone())]) {
                    if let Some(row) = rs.get(0) {
                        if let Some(units_str) = row.get("total_cost_units").and_then(|v| v.as_str()) {
                            if let Ok(units_i) = units_str.parse::<i128>() {
                                let whole = units_i / 1_000_000;
                                let frac = (units_i % 1_000_000).abs();
                                let formatted = format!("{}.{}", whole, format!("{:06}", frac));
                                // attach helper blob
                                let mut extra = serde_json::json!({});
                                if let Some(existing) = &rec.response_json { if let Ok(e) = serde_json::from_str::<serde_json::Value>(existing) { if e.is_object() { extra = e; } } }
                                extra["total_cost_usdc"] = serde_json::Value::String(formatted);
                                rec.response_json = Some(extra.to_string());
                                if let Some(crate::structs::PaymentAttemptResult::Success { amount_paid, .. }) = &mut rec.payment_result {
                                    *amount_paid = format!("{}", whole as f64 + (frac as f64)/1_000_000.0);
                                }
                            }
                        }
                    }
                }
            }
        }
        // Replace call_history in the outgoing state JSON
        if let Ok(v) = serde_json::to_value(&rows) {
            let mut out_obj = out.as_object().cloned().unwrap_or_default();
            out_obj.insert("call_history".to_string(), v);
            return send_json_response(StatusCode::OK, &serde_json::Value::Object(out_obj));
        }
    }
    send_json_response(StatusCode::OK, &out)
}

fn handle_get_all_providers(db: &Sqlite) -> anyhow::Result<()> {
    info!("Getting all providers");
    let data = dbm::get_all(db)?;
    send_json_response(StatusCode::OK, &json!(data))
}

fn handle_search_providers(db: &Sqlite, params: &HashMap<String, String>) -> anyhow::Result<()> {
            let query = params
                .get("q")
                .ok_or(anyhow::anyhow!("Missing 'q' query parameter"))?;
    
    info!("Searching providers with query: {}", query);
            let data = dbm::search_provider(db, query.to_string())?;
    send_json_response(StatusCode::OK, &json!(data))
}

fn handle_get_managed_wallets(state: &mut State) -> anyhow::Result<()> {
    info!("Getting managed wallets");
    let (selected_id, summaries) = hyperwallet_service::get_wallet_summary_list(state);
    
    send_json_response(StatusCode::OK, &json!({ 
        "selected_wallet_id": selected_id,
        "managed_wallets": summaries 
    }))
}

fn handle_get_linked_wallets(state: &mut State) -> anyhow::Result<()> {
    info!("Getting linked wallets");
    
    // Get on-chain linked wallets if operator is configured
    let on_chain_wallets = if let Some(operator_entry_name) = &state.operator_entry_name {
        match hyperwallet_service::get_all_onchain_linked_hot_wallet_addresses(Some(operator_entry_name)) {
            Ok(addresses) => addresses,
            Err(e) => {
                warn!("Failed to get on-chain linked wallets: {}", e);
                Vec::new()
            }
        }
    } else {
        Vec::new()
    };
    
    // Get managed wallet summaries
    let (selected_id, managed_summaries) = hyperwallet_service::get_wallet_summary_list(state);
    
    // Create a unified view
    let mut linked_wallets = Vec::new();
    
    // Add all managed wallets first
    for summary in &managed_summaries {
        linked_wallets.push(json!({
            "address": summary.address,
            "name": summary.name,
            "is_managed": true,
            "is_linked_on_chain": on_chain_wallets.contains(&summary.address),
            "is_active": !summary.is_encrypted || summary.is_unlocked,
            "is_encrypted": summary.is_encrypted,
            "is_selected": summary.is_selected,
            "is_unlocked": summary.is_unlocked,
        }));
    }
    
    // Add external wallets (on-chain but not managed)
    for on_chain_address in &on_chain_wallets {
        let is_managed = managed_summaries.iter().any(|s| &s.address == on_chain_address);
        if !is_managed {
            linked_wallets.push(json!({
                "address": on_chain_address,
                "name": null,
                "is_managed": false,
                "is_linked_on_chain": true,
                "is_active": false,
                "is_encrypted": false,
                "is_selected": false,
                "is_unlocked": false,
            }));
        }
    }
    
    send_json_response(StatusCode::OK, &json!({ 
        "selected_wallet_id": selected_id,
        "linked_wallets": linked_wallets,
        "operator_configured": state.operator_entry_name.is_some(),
    }))
}

// ===========================================================================================
// PROVIDER CALL HANDLING - payment & provider interaction flow
// ===========================================================================================

/// Main entry point for provider calls - orchestrates payment and execution
fn handle_provider_call_request(
    our: &Address, 
    state: &mut State, 
    db: &Sqlite, 
    provider_id: String,
    provider_name: String,
    arguments: Vec<(String, String)>,
    client_config_opt: Option<HotWalletAuthorizedClient>
) -> anyhow::Result<()> {
    info!("Handling call request for provider ID='{}', Name='{}'", provider_id, provider_name);
    
    let timestamp_start_ms = Utc::now().timestamp_millis() as u128;
    let call_args_json = serde_json::to_string(&arguments).unwrap_or_else(|_| "{}".to_string());
    let lookup_key_for_db = if !provider_id.is_empty() { provider_id.clone() } else { provider_name.clone() };

    // Fetch provider details from database
    match fetch_provider_details(db, &lookup_key_for_db) {
        FetchProviderResult::Success(provider_details) => {
            execute_provider_flow(
                our,
                state,
                provider_details,
                provider_name,
                arguments,
                timestamp_start_ms,
                call_args_json,
                client_config_opt
            )
        }
        FetchProviderResult::NotFound(returned_lookup_key) => {
            error!("Provider '{}' not found in local DB.", returned_lookup_key);
            let wallet_id_for_failure = client_config_opt.as_ref()
                .map(|config| config.associated_hot_wallet_address.clone())
                .or_else(|| state.selected_wallet_id.clone());
            record_call_failure(
                state,
                timestamp_start_ms,
                returned_lookup_key.clone(),
                if provider_id.is_empty() { "".to_string() } else { provider_id.clone() },
                call_args_json,
                PaymentAttemptResult::Skipped {
                    reason: format!("DB Lookup Failed: Key '{}' not found", returned_lookup_key)
                },
                wallet_id_for_failure,
                Some(provider_name.clone()),
                client_config_opt.as_ref()
            );
            send_json_response(StatusCode::NOT_FOUND, &json!({ 
                "error": format!("Provider '{}' not found", returned_lookup_key) 
            }))
        }
    }
}

/// Execute the full provider flow: health check, payment (if needed), then provider call
fn execute_provider_flow(
    our: &Address,
    state: &mut State,
    provider_details: ProviderDetails,
    provider_name: String,
    arguments: Vec<(String, String)>,
    timestamp_start_ms: u128,
    call_args_json: String,
    client_config_opt: Option<HotWalletAuthorizedClient>
) -> anyhow::Result<()> {
    // First, do a health check ping to see if the provider is responsive
    match perform_provider_health_check(&provider_details, Some(&provider_name)) {
        Ok(()) => {
            info!("Provider {} health check passed", provider_details.provider_id);
        }
        Err(health_error) => {
            error!("Provider {} health check failed: {:?}", provider_details.provider_id, health_error);
            let wallet_id_for_failure = client_config_opt.as_ref()
                .map(|config| config.associated_hot_wallet_address.clone())
                .or_else(|| state.selected_wallet_id.clone());
            record_call_failure(
                state, 
                timestamp_start_ms, 
                provider_details.provider_id.clone(),
                provider_details.provider_id.clone(),
                call_args_json, 
                PaymentAttemptResult::Skipped {
                    reason: format!("Provider health check failed: {}", health_error)
                },
                wallet_id_for_failure,
                Some(provider_name.clone()),
                client_config_opt.as_ref()
            );
            return send_json_response(StatusCode::SERVICE_UNAVAILABLE, &json!({ 
                "error": "Provider is not responding", 
                "details": format!("Health check failed: {}", health_error)
            }));
        }
    }

    // Provider is responsive, proceed with payment if required
    match handle_payment(state, &provider_details, client_config_opt.as_ref()) {
        PaymentResult::NotRequired => {
            info!("No payment required for provider {}", provider_details.provider_id);
            execute_provider_call(our, state, &provider_details, provider_name, arguments, 
                                timestamp_start_ms, call_args_json, None, client_config_opt)
        }
        PaymentResult::Success(tx_hash) => {
            info!("Payment successful for provider {}: tx={}", provider_details.provider_id, tx_hash);
            execute_provider_call(our, state, &provider_details, provider_name, arguments, 
                                timestamp_start_ms, call_args_json, Some(tx_hash), client_config_opt)
        }
        PaymentResult::Failed(payment_result) => {
            error!("Payment failed for provider {}: {:?}", provider_details.provider_id, payment_result);
            let wallet_id_for_failure = client_config_opt.as_ref()
                .map(|config| config.associated_hot_wallet_address.clone())
                .or_else(|| state.selected_wallet_id.clone());
            record_call_failure(
                state, 
                timestamp_start_ms, 
                provider_details.provider_id.clone(),
                provider_details.provider_id.clone(),
                call_args_json, 
                payment_result.clone(),
                wallet_id_for_failure,
                Some(provider_name.clone()),
                client_config_opt.as_ref()
            );
            send_json_response(StatusCode::PAYMENT_REQUIRED, &json!({ 
                "error": "Pre-payment failed or was skipped.", 
                "details": payment_result 
            }))
        }
    }
}

// --- Registry Operations ---

fn handle_search_registry(db: &Sqlite, query: String) -> anyhow::Result<()> {
    info!("Searching registry for: {}", query);
    let data = dbm::search_provider(db, query)?;
    send_json_response(StatusCode::OK, &json!(data))
}

// --- History Operations ---

fn handle_get_call_history(state: &State) -> anyhow::Result<()> {
    info!("Getting call history");
    // Enrich with ledger totals if available
    let mut rows = state.call_history.clone();
    let db = match &state.db_conn {
        Some(db) => db.clone(),
        None => {
            send_json_response(StatusCode::OK, &rows)?;
            return Ok(());
        }
    };
    // Build a map of tx_hash -> total_cost_units and overwrite amount_paid so UI shows real ledger cost
    // We query per record; small list keeps this simple and fast.
    for rec in &mut rows {
        let tx_opt = match &rec.payment_result {
            Some(crate::structs::PaymentAttemptResult::Success { tx_hash, .. }) => Some(tx_hash.clone()),
            _ => None,
        };
        if let Some(tx) = tx_opt {
            let q = r#"SELECT total_cost_units FROM usdc_call_ledger WHERE lower(tx_hash) = lower(?1) LIMIT 1"#.to_string();
            if let Ok(rs) = db.read(q, vec![serde_json::Value::String(tx.clone())]) {
                if let Some(row) = rs.get(0) {
                    if let Some(units_str) = row.get("total_cost_units").and_then(|v| v.as_str()) {
                        // convert base units (6 dp) to display string and set as event cost
                        if let Ok(units_i) = units_str.parse::<i128>() {
                            let whole = units_i / 1_000_000;
                            let frac = (units_i % 1_000_000).abs();
                            let formatted = format!("{}.{}", whole, format!("{:06}", frac));
                            // Attach detail blob
                            let mut extra = serde_json::json!({});
                            if let Some(existing) = &rec.response_json { if let Ok(e) = serde_json::from_str::<serde_json::Value>(existing) { if e.is_object() { extra = e; } } }
                            extra["total_cost_usdc"] = serde_json::Value::String(formatted);
                            rec.response_json = Some(extra.to_string());
                            // Overwrite the displayed price used by UI to the ledger total
                            if let Some(crate::structs::PaymentAttemptResult::Success { amount_paid, .. }) = &mut rec.payment_result {
                                *amount_paid = format!("{}", whole as f64 + (frac as f64)/1_000_000.0);
                            }
                        }
                    }
                }
            }
        }
    }
    send_json_response(StatusCode::OK, &rows)
}

// --- Wallet Management Operations ---

fn handle_get_wallet_summary_list(state: &mut State) -> anyhow::Result<()> {
    info!("Getting wallet summary list");
    let (selected_id, summaries) = hyperwallet_service::get_wallet_summary_list(state);
    send_json_response(StatusCode::OK, &json!({ 
        "selected_id": selected_id, 
        "wallets": summaries 
    }))
}

fn handle_select_wallet(state: &mut State, wallet_id: String) -> anyhow::Result<()> {
    info!("Selecting wallet: {}", wallet_id);
    match hyperwallet_service::select_wallet(state, wallet_id) {
                Ok(_) => send_json_response(StatusCode::OK, &json!({ "success": true })),
                Err(e) => send_json_response(StatusCode::BAD_REQUEST, &json!({ "success": false, "error": e })),
            }
        }

fn handle_rename_wallet(state: &mut State, wallet_id: String, new_name: String) -> anyhow::Result<()> {
    info!("Renaming wallet {} to '{}'", wallet_id, new_name);
    match hyperwallet_service::rename_wallet(state, wallet_id, new_name) {
                 Ok(_) => send_json_response(StatusCode::OK, &json!({ "success": true })),
                 Err(e) => send_json_response(StatusCode::BAD_REQUEST, &json!({ "success": false, "error": e })),
             }
        }

fn handle_delete_wallet(state: &mut State, wallet_id: String) -> anyhow::Result<()> {
    info!("Deleting wallet: {}", wallet_id);
    match hyperwallet_service::delete_wallet(state, wallet_id) {
                 Ok(_) => send_json_response(StatusCode::OK, &json!({ "success": true })),
                 Err(e) => send_json_response(StatusCode::BAD_REQUEST, &json!({ "success": false, "error": e })),
             }
        }

fn handle_generate_wallet(state: &mut State) -> anyhow::Result<()> {
    info!("Generating new wallet");
    match hyperwallet_service::generate_initial_wallet(state) {
        Ok(wallet_id) => {
            info!("Generated wallet via hyperwallet: {}", wallet_id);
            send_json_response(StatusCode::OK, &json!({ "success": true, "id": wallet_id }))
        },
        Err(e) => send_json_response(StatusCode::INTERNAL_SERVER_ERROR, &json!({ 
            "success": false, 
            "error": e 
        }))
    }
}

fn handle_import_wallet(
    state: &mut State, 
    private_key: String, 
    password: Option<String>, 
    name: Option<String>
) -> anyhow::Result<()> {
    info!("Importing wallet");
    match hyperwallet_service::import_new_wallet(state, private_key, password, name) {
        Ok(address) => send_json_response(StatusCode::OK, &json!({ 
            "success": true, 
            "address": address 
        })),
        Err(e) => send_json_response(StatusCode::BAD_REQUEST, &json!({ 
            "success": false, 
            "error": e 
        })),
    }
}

// --- Wallet State Operations ---

fn get_selected_wallet_id(state: &State) -> anyhow::Result<String> {
    state.selected_wallet_id.clone()
        .ok_or_else(|| anyhow::anyhow!("No wallet selected"))
}

fn handle_activate_wallet(state: &mut State, password: Option<String>) -> anyhow::Result<()> {
    info!("Activating wallet");
    let wallet_id = get_selected_wallet_id(state)?;
    
    match hyperwallet_service::activate_wallet(state, wallet_id, password) {
        Ok(_) => send_json_response(StatusCode::OK, &json!({ "success": true })),
        Err(e) => send_json_response(StatusCode::BAD_REQUEST, &json!({ 
            "success": false, 
            "error": e 
        })),
    }
}

fn handle_deactivate_wallet(state: &mut State) -> anyhow::Result<()> {
    info!("Deactivating wallet");
    let wallet_id = get_selected_wallet_id(state)?;
    
    match hyperwallet_service::deactivate_wallet(state, wallet_id) {
        Ok(_) => send_json_response(StatusCode::OK, &json!({ "success": true })),
        Err(e) => send_json_response(StatusCode::BAD_REQUEST, &json!({ 
            "success": false, 
            "error": e 
        })),
    }
}

fn handle_set_wallet_limits(state: &mut State, limits: SpendingLimits) -> anyhow::Result<()> {
    info!("Setting wallet spending limits");
    let wallet_id = get_selected_wallet_id(state)?;
    
    // Convert SpendingLimits to hyperwallet format
    let max_per_call = limits.max_per_call;
    let max_total = limits.max_total;
    let currency = limits.currency.or_else(|| Some("USDC".to_string()));
    
    match hyperwallet_service::set_wallet_spending_limits(state, wallet_id, max_per_call, max_total, currency) {
        Ok(_) => send_json_response(StatusCode::OK, &json!({ "success": true })),
        Err(e) => send_json_response(StatusCode::BAD_REQUEST, &json!({ 
            "success": false, 
            "error": e 
        })),
    }
}

fn handle_set_client_limits(state: &mut State, client_id: String, limits: SpendingLimits) -> anyhow::Result<()> {
    info!("Setting client spending limits for {}", client_id);
    // Persist to state cache immediately for UI readback
    state.client_limits_cache.insert(client_id.clone(), limits.clone());
    state.save();
    // No hyperwallet call needed; client limits are enforced in our payment pipeline
    send_json_response(StatusCode::OK, &json!({ "success": true }))
}

// Similar pattern for other wallet operations...
fn handle_export_private_key(state: &State, password: Option<String>) -> anyhow::Result<()> {
    info!("Exporting private key");
    let wallet_id = state.selected_wallet_id.clone()
        .ok_or_else(|| anyhow::anyhow!("No wallet selected"))?;
    
    match hyperwallet_service::export_private_key(state, wallet_id, password) {
        Ok(private_key) => send_json_response(StatusCode::OK, &json!({ 
            "success": true, 
            "private_key": private_key 
        })),
        Err(e) => send_json_response(StatusCode::BAD_REQUEST, &json!({ 
            "success": false, 
            "error": e 
        })),
    }
}

fn handle_set_wallet_password(
    state: &mut State, 
    new_password: String, 
    old_password: Option<String>
) -> anyhow::Result<()> {
    info!("Setting wallet password");
    let wallet_id = get_selected_wallet_id(state)?;
    
    match hyperwallet_service::set_wallet_password(state, wallet_id, new_password, old_password) {
                Ok(_) => send_json_response(StatusCode::OK, &json!({ "success": true })),
        Err(e) => send_json_response(StatusCode::BAD_REQUEST, &json!({ 
            "success": false, 
            "error": e 
        })),
    }
}

fn handle_remove_wallet_password(state: &mut State, current_password: String) -> anyhow::Result<()> {
    info!("Removing wallet password");
    let wallet_id = get_selected_wallet_id(state)?;
    
    match hyperwallet_service::remove_wallet_password(state, wallet_id, current_password) {
                Ok(_) => send_json_response(StatusCode::OK, &json!({ "success": true })),
        Err(e) => send_json_response(StatusCode::BAD_REQUEST, &json!({ 
            "success": false, 
            "error": e 
        })),
            }
        }

fn handle_get_active_account_details(state: &mut State) -> anyhow::Result<()> {
            // Check cache first
            if let Some(cached_details) = state.cached_active_details.clone() {
        info!("Returning cached active account details");
                return send_json_response(StatusCode::OK, &cached_details);
            }

    // Cache miss, fetch fresh
    info!("Active account details cache miss, fetching...");
    match hyperwallet_service::get_active_account_details(state) {
                Ok(Some(details)) => {
            info!("Fetched details successfully, caching...");
                    state.cached_active_details = Some(details.clone());
                    send_json_response(StatusCode::OK, &details)
                }
                Ok(None) => {
            info!("No active/unlocked account found");
                    state.cached_active_details = None;
                    send_json_response(StatusCode::OK, &json!(null))
                }
                Err(e) => {
                    error!("Error getting active account details: {:?}", e);
                    state.cached_active_details = None; 
            send_json_response(StatusCode::INTERNAL_SERVER_ERROR, &json!({ 
                "error": "Failed to retrieve account details" 
            }))
        }
    }
}

// --- Withdrawal Operations ---

fn handle_withdraw_eth(state: &mut State, to_address: String, amount_wei_str: String) -> anyhow::Result<()> {
    info!("Withdrawing ETH to: {}, amount: {} wei", to_address, amount_wei_str);
    match hyperwallet_payments::handle_operator_tba_withdrawal(
                state, 
        hyperwallet_payments::AssetType::Eth,
                to_address, 
                amount_wei_str
            ) {
        Ok(_) => send_json_response(StatusCode::OK, &json!({ 
            "success": true, 
            "message": "ETH withdrawal initiated." 
        })),
        Err(e) => send_json_response(StatusCode::BAD_REQUEST, &json!({ 
            "success": false, 
            "error": e.to_string() 
        })),
    }
}

fn handle_withdraw_usdc(state: &mut State, to_address: String, amount_usdc_units_str: String) -> anyhow::Result<()> {
    info!("Withdrawing USDC to: {}, amount: {} units", to_address, amount_usdc_units_str);
    match hyperwallet_payments::handle_operator_tba_withdrawal(
        state,
        hyperwallet_payments::AssetType::Usdc,
        to_address,
        amount_usdc_units_str
    ) {
        Ok(_) => send_json_response(StatusCode::OK, &json!({ 
            "success": true,
            "message": "USDC withdrawal initiated." 
        })),
        Err(e) => send_json_response(StatusCode::BAD_REQUEST, &json!({ 
            "success": false, 
            "error": e.to_string() 
        })),
    }
}

// Helper function to fetch provider details from the database
fn fetch_provider_details(db: &Sqlite, lookup_key: &str) -> FetchProviderResult {
    info!("Fetching provider details for lookup key: {}", lookup_key);
    
    match dbm::get_provider_details(db, lookup_key) {
        Ok(Some(details_map)) => {
            extract_provider_from_json(details_map, lookup_key)
        }
        _ => FetchProviderResult::NotFound(lookup_key.to_string()),
    }
}

fn extract_provider_from_json(details_map: HashMap<String, Value>, lookup_key: &str) -> FetchProviderResult {
    let provider_id = match details_map.get("provider_id").and_then(Value::as_str) {
        Some(id) => id.to_string(),
                None => return FetchProviderResult::NotFound(lookup_key.to_string()),
            };
            
    let wallet = details_map.get("wallet")
        .and_then(Value::as_str)
                .map(String::from)
                .unwrap_or_else(|| "0x0".to_string());
            
    let price = details_map.get("price")
        .and_then(Value::as_str)
                .map(String::from)
                .unwrap_or_else(|| "0.0".to_string());
            
    info!("Provider details: ID={}, Wallet={}, Price={}", provider_id, wallet, price);
            
            FetchProviderResult::Success(ProviderDetails {
                wallet_address: wallet,
                price_str: price,
                provider_id,
            })
}

// Helper function to authenticate a shim client
fn authenticate_shim_client<'a>(
    state: &'a State,
    client_id: &str,
    raw_token: &str,
) -> Result<&'a HotWalletAuthorizedClient, AuthError> {
    // 1. Lookup Client
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

// Helper function to determine which wallet to sign the userOp with
fn determine_signer_wallet(
    state: &State,
    client_config_opt: Option<&HotWalletAuthorizedClient>
) -> Result<String, PaymentAttemptResult> {
    if let Some(client_config) = client_config_opt {
        // Shim-initiated: use client's associated wallet
        info!("Payment via shim client {}", client_config.id);
        Ok(client_config.associated_hot_wallet_address.clone())
    } else {
        // UI-initiated: use selected & unlocked wallet
        determine_ui_payment_wallet(state)
    }
}

fn determine_ui_payment_wallet(state: &State) -> Result<String, PaymentAttemptResult> {
    let selected_id = state.selected_wallet_id.as_ref()
        .ok_or_else(|| PaymentAttemptResult::Skipped {
            reason: "No wallet selected for payment".to_string()
        })?;

    // Verify wallet is unlocked
    let signer = state.active_signer_cache.as_ref()
        .ok_or_else(|| PaymentAttemptResult::Skipped {
            reason: "Selected wallet is locked. Please unlock for payment".to_string()
        })?;

    // Verify signer matches selected wallet
    if !signer.address().to_string().eq_ignore_ascii_case(selected_id) {
        error!("Selected wallet {} doesn't match active signer {}", 
               selected_id, signer.address());
        return Err(PaymentAttemptResult::Skipped {
            reason: "Wallet state mismatch. Please re-select/unlock".to_string()
        });
    }

    info!("Using selected wallet {} for UI payment", selected_id);
    Ok(selected_id.clone())
}

// Helper function to execute provider call (no payment)
fn execute_provider_call(
    _our: &Address,
    state: &mut State,
    provider_details: &ProviderDetails,
    provider_name: String,
    arguments: Vec<(String, String)>,
    timestamp_start_ms: u128,
    call_args_json: String,
    payment_tx_hash: Option<String>,
    client_config_opt: Option<HotWalletAuthorizedClient>,
) -> anyhow::Result<()> {
    // Prepare target address
    let target_address = Address::new(
        &provider_details.provider_id,
        ("provider", "hypergrid", PUBLISHER)
    );
    
    let payment_tx_hash_clone = payment_tx_hash.clone();
    
    // Prepare request
    info!("Preparing request for provider process at {}", target_address);
    let provider_request_data = ProviderRequest {
        provider_name: provider_name.clone(),
        arguments,
        payment_tx_hash: payment_tx_hash_clone,
    };
    // Wrap the ProviderRequest data in a JSON structure that mimics the enum variant
    let wrapped_request = serde_json::json!({
        "CallProvider": provider_request_data
    });
    let request_body_bytes = serde_json::to_vec(&wrapped_request)?;
    
    // Send request
    info!("Sending ping to provider at {}", target_address);
    let provider_call_result = match send_request_to_provider(target_address.clone(), request_body_bytes) {
        Ok(Ok(response)) => ProviderCallResult::Success(response),
        Ok(Err(e)) => ProviderCallResult::Failed(e),
        Err(e) => ProviderCallResult::Failed(e),
    };
    
    // Record call outcome
    let response_timestamp_ms = Utc::now().timestamp_millis() as u128;
    let call_success = matches!(provider_call_result, ProviderCallResult::Success(_));
    
    let payment_result = if let Some(tx) = payment_tx_hash {
        Some(PaymentAttemptResult::Success {
            tx_hash: tx,
            amount_paid: provider_details.price_str.clone(),
            currency: "USDC".to_string(),
        })
    } else {
        Some(PaymentAttemptResult::Skipped { 
            reason: "Zero Price".to_string() 
        })
    };

    // Determine the correct operator_wallet_id based on the call context
    let actual_operator_wallet_id = client_config_opt.as_ref()
        .map(|config| config.associated_hot_wallet_address.clone())
        .or_else(|| state.selected_wallet_id.clone());
    
    let record = CallRecord {
        timestamp_start_ms,
        provider_lookup_key: provider_details.provider_id.clone(),
        target_provider_id: provider_details.provider_id.clone(),
        call_args_json,
        response_json: match &provider_call_result {
            ProviderCallResult::Success(body) => Some(String::from_utf8_lossy(body).to_string()),
            _ => None,
        },
        call_success,
        response_timestamp_ms,
        payment_result,
        duration_ms: response_timestamp_ms - timestamp_start_ms,
        operator_wallet_id: actual_operator_wallet_id,
        client_id: client_config_opt.as_ref().map(|c| c.id.clone()),
        provider_name: Some(provider_name.clone()),
    };
    
    state.call_history.push(record);
    limit_call_history(state);
    // Live-cover the new call via single-receipt fetch if needed
    if let Some(tba) = &state.operator_tba_address {
        if let Some(db) = &state.db_conn {
            if let Some(crate::structs::PaymentAttemptResult::Success { .. }) = &state.call_history.last().and_then(|r| r.payment_result.clone()) {
                let provider = state.hypermap.provider.clone();
                let _ = crate::ledger::verify_calls_covering(state, db, &provider, &tba.to_lowercase());
            }
        }
    }
    state.save();
    
    // Handle final response
    match provider_call_result {
        ProviderCallResult::Success(provider_response_body) => {
            info!("Provider call successful. Preparing final HTTP response.");
            send_response(
                StatusCode::OK,
                Some(HashMap::from([(
                    String::from("Content-Type"),
                    String::from("application/json"),
                )])),
                provider_response_body,
            );
            info!("Final HTTP response sent to http-server.");
            Ok(())
        },
        ProviderCallResult::Failed(provider_comm_error) => {
            error!("Provider failed to respond: {:?}", provider_comm_error);
            send_json_response(
                StatusCode::BAD_GATEWAY, 
                &json!({ 
                    "error": format!("Provider {} failed to respond: {:?}", 
                    target_address, provider_comm_error) 
                })
            )
        }
    }
}
///// Checks the availability of a provider by sending a test request.
//fn check_provider_availability(provider_id: &str) -> Result<(), String> {
//    info!("Checking provider availability for ID: {}", provider_id);
//
//    let target_address = HyperwareAddress::new(
//        provider_id,
//        ("hypergrid-provider", "hypergrid-provider", "grid.hypr")
//    );
//
//    let dummy_argument = serde_json::json!({
//        "argument": "swag"
//    });
//
//    let wrapped_request = serde_json::json!({
//        "HealthPing": dummy_argument
//    });
//
//    let request_body_bytes = match serde_json::to_vec(&wrapped_request) {
//        Ok(bytes) => bytes,
//        Err(e) => {
//            let err_msg = format!("Failed to serialize provider availability request: {}", e);
//            error!("{}", err_msg);
//            return Err(err_msg);
//        }
//    };
//
//    info!("Sending request body bytes to provider: {:?}", request_body_bytes);
//
//    match send_request_to_provider(target_address.clone(), request_body_bytes) {
//        Ok(Ok(response)) => {
//            info!("Provider at {} responded successfully to availability check: {:?}", target_address, response);
//            Ok(())
//        }
//        Ok(Err(e)) => {
//            let err_msg = format!("Provider at {} failed availability check: {}", target_address, e);
//            error!("{}", err_msg);
//            Err(err_msg)
//        }
//        Err(e) => {
//            let err_msg = format!("Error sending availability check to provider at {}: {}", target_address, e);
//            error!("{}", err_msg);
//            Err(err_msg)
//        }
//    }
//}

/// Perform a lightweight health check on a provider before payment
fn perform_provider_health_check(provider_details: &ProviderDetails, provider_name: Option<&str>) -> anyhow::Result<()> {
    info!("Performing health check for provider {}", provider_details.provider_id);
    
    let target_address = Address::new(
        &provider_details.provider_id,
        ("provider", "hypergrid", PUBLISHER)
    );
    
    let health_check_request = serde_json::json!({
        "provider_name": provider_name.unwrap_or(&provider_details.provider_id)
    });
    
    let wrapped_request = serde_json::json!({
        "HealthPing": health_check_request
    });
    
    let request_body_bytes = match serde_json::to_vec(&wrapped_request) {
        Ok(bytes) => bytes,
        Err(e) => {
            let err_msg = format!("Failed to serialize provider availability request: {}", e);
            error!("{}", err_msg);
            return Err(anyhow::anyhow!("{}", err_msg));
        }
    };
    
    info!("Sending health check ping to provider at {}", target_address);
    match ProcessRequest::new()
        .target(target_address.clone())
        .body(request_body_bytes)
        .send_and_await_response(3) {
        Ok(Ok(response)) => {
            // Try to parse the response as DummyResponse
            match serde_json::from_slice::<serde_json::Value>(&response.body()) {
                Ok(response_json) => {
                    info!("Provider {} responded to health check: {:?}", provider_details.provider_id, response_json);
                }
                Err(_) => {
                    info!("Provider {} responded to health check (non-JSON response)", provider_details.provider_id);
                }
            }
            Ok(())
        }
        Ok(Err(send_error)) => {
            error!("Provider {} health check failed: {:?}", provider_details.provider_id, send_error);
            Err(anyhow::anyhow!("Provider communication error: {}", send_error))
        }
        Err(timeout_error) => {
            error!("Provider {} health check timed out: {:?}", provider_details.provider_id, timeout_error);
            Err(anyhow::anyhow!("Provider timeout: {}", timeout_error))
        }
    }
}

pub fn send_request_to_provider(
    target: Address,
    body: Vec<u8>,
) -> anyhow::Result<Result<Vec<u8>, anyhow::Error>> {
    info!("Sending request to provider: {}", target);
    let res = ProcessRequest::new()
        .target(target.clone())
        .body(body)
        .send_and_await_response(10)?;

    match res {
        Ok(response_message) => {
            info!("Received successful response from {}", target);
            Ok(Ok(response_message.body().to_vec()))
        }
        Err(send_error) => {
            error!("Error receiving response from {}: {:?}", target, send_error);
            Ok(Err::<Vec<u8>, anyhow::Error>(anyhow::anyhow!(send_error)))
        }
    }
}

fn limit_call_history(state: &mut State) {
    let max_history = 100;
    if state.call_history.len() > max_history {
        state.call_history.drain(..state.call_history.len() - max_history);
    }
}

/// Handles POST request to /api/authorize-shim
/// Verifies user is authenticated, then writes their node name and auth token
/// to a configuration file for the hypergrid-shim to read.
/// 
pub fn handle_authorize_shim_request(
    our: &Address,
    req: &IncomingHttpRequest,
    _state: &mut State,
    _db: &Sqlite,
) -> anyhow::Result<HttpResponse<Vec<u8>>> {
    info!("Handling /api/authorize-shim request");

    // Log headers to find auth info
    info!("Request Headers: {:?}", req.headers());

    // Attempt to extract relevant cookie (adjust cookie name if needed)
    // Convert to Option<String> to avoid borrow checker issues with temporary &str
    let cookies_header_str: Option<String> = req.headers().get("cookie")
        .and_then(|h| h.to_str().ok())
        .map(|s| s.to_string()); // Convert &str to owned String
        
    info!("Cookie Header: {:?}", cookies_header_str);

    let mut extracted_node_name: Option<String> = None;
    let mut extracted_token_value: Option<String> = None;

    if let Some(cookies) = cookies_header_str.as_deref() { 
        for cookie_pair in cookies.split(';') {
            let parts: Vec<&str> = cookie_pair.trim().splitn(2, '=').collect();
            if parts.len() == 2 {
                let name = parts[0];
                let value = parts[1];
                // TODO: Refine this logic - we need the *specific* cookie for *this* node
                // For now, just grab the first hyperware-auth cookie found
                if name.starts_with("hyperware-auth_") {
                    // Assuming name format is hyperware-auth_NODE.os
                    if let Some(node) = name.strip_prefix("hyperware-auth_") {
                        extracted_node_name = Some(node.to_string());
                        extracted_token_value = Some(value.to_string());
                        info!("Extracted from cookie: Node={}, Token=[REDACTED]", node);
                        break; // Take the first one for now
                    }
                }
            }
        }
    }

    // **TODO**: How to reliably get authenticated node name and token?
    // Assumes hyperware_process_lib populates context or similar after
    // successful authentication via the .authenticated(true) binding.
    // This part needs verification based on hyperware_process_lib capabilities.
    // Using extracted values if found, otherwise placeholders
    let node_name = extracted_node_name.unwrap_or_else(|| "PLACEHOLDER_NODE_NAME.os".to_string()); 
    let token_value = extracted_token_value.unwrap_or_else(|| "PLACEHOLDER_TOKEN_VALUE".to_string());

    if node_name.starts_with("PLACEHOLDER") || token_value.starts_with("PLACEHOLDER") {
        error!("Could not extract node name or token from authenticated request context! Check logs for headers.");
        // Return an internal server error if we couldn't get the necessary info
        return Ok(HttpResponse::builder()
            .status(StatusCode::INTERNAL_SERVER_ERROR)
            .header("Content-Type", "application/json")
            .body(r#"{"error": "Internal server error: Could not retrieve authentication details."}"#
                .to_string()
                .into_bytes(),
            )?);
    }

    // Prepare the configuration data
    let config_data = ShimAuthConfig {
        node: node_name.clone(),
        token: token_value.clone(),
    };

    // Serialize data BEFORE filesystem operations
    let json_string = match serde_json::to_string_pretty(&config_data) {
        Ok(s) => s,
        Err(e) => {
            error!("Failed to serialize shim config data: {:?}", e);
            return Ok(HttpResponse::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .header("Content-Type", "application/json")
                .body(r#"{"error": "Failed to serialize configuration data."}"#
                    .to_string()
                    .into_bytes(),
                )?);
        }
    };

    // Define VFS path within the package's tmp/ drive
    let vfs_file_path = format!("/{}/tmp/grid-shim-config.json", our.package_id());
    info!("Attempting to write shim config to VFS tmp path: {}", vfs_file_path);

    // Create/Open the file in VFS tmp and write
    match vfs::create_file(&vfs_file_path, None) {
        Ok(file) => {
            match file.write(json_string.as_bytes()) {
                Ok(_) => {
                    info!("Successfully wrote shim config file to VFS tmp.");
                    Ok(HttpResponse::builder()
                        .status(StatusCode::OK)
                        .header("Content-Type", "application/json")
                        .body(r#"{"status": "success"}"#
                            .to_string()
                            .into_bytes(),
                        )?)
                }
                Err(e) => {
                    error!("Failed to write to VFS tmp file {}: {:?}", vfs_file_path, e);
                    Ok(HttpResponse::builder()
                        .status(StatusCode::INTERNAL_SERVER_ERROR)
                        .header("Content-Type", "application/json")
                        .body(r#"{"error": "Failed to write configuration file to VFS."}"#
                            .to_string()
                            .into_bytes(),
                        )?)
                }
            }
        }
        Err(e) => {
            error!("Failed to create/open VFS tmp file {}: {:?}", vfs_file_path, e);
            Ok(HttpResponse::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .header("Content-Type", "application/json")
                .body(r#"{"error": "Failed to create/open configuration file in VFS."}"#
                    .to_string()
                    .into_bytes(),
                )?)
        }
    }
}

/// Handles POST request to /api/configure-authorized-client
/// Verifies user is authenticated via cookie, receives client configuration details,
/// generates a unique client ID, hashes the raw token, and stores the new
/// HotWalletAuthorizedClient in state. If client_id is provided in request, updates that client.
pub fn handle_configure_authorized_client(
    our: &Address,
    req: &IncomingHttpRequest, 
    state: &mut State, // Needs mutable state
    _db: &Sqlite,
) -> anyhow::Result<HttpResponse<Vec<u8>>> { 
    info!("Handling /api/configure-authorized-client request");

    // --- Authentication Check (ensure request is from the node owner) --- 
    let cookies_header_str: Option<String> = req.headers().get("cookie")
        .and_then(|h| h.to_str().ok())
        .map(|s| s.to_string()); 

    let mut is_authenticated_owner = false;
    if let Some(cookies) = cookies_header_str.as_deref() { 
        for cookie_pair in cookies.split(';') {
            let parts: Vec<&str> = cookie_pair.trim().splitn(2, '=').collect();
            if parts.len() == 2 {
                let name = parts[0];
                let expected_cookie_name = format!("hyperware-auth_{}", our.node());
                if name == expected_cookie_name {
                    is_authenticated_owner = true;
                    info!("Configure Client: Request authenticated for node owner: {}", our.node());
                    break; 
                }
            }
        }
    }
    
    if !is_authenticated_owner {
        error!("Configure Client: Request not authenticated as node owner. Cookie header: {:?}", cookies_header_str);
            return Ok(HttpResponse::builder()
            .status(StatusCode::UNAUTHORIZED)
                .header("Content-Type", "application/json")
            .body(r#"{"error": "Authentication error: Not authorized as node owner."}"#
                    .to_string()
                    .into_bytes(),
                )?);
        }
    // --- End Authentication Check --- 

    // Deserialize the request body
    let blob = last_blob().ok_or(anyhow::anyhow!("Request body is missing for configure client request"))?; 
    let request_data: ConfigureAuthorizedClientRequest = match serde_json::from_slice(blob.bytes()) {
        Ok(data) => data,
        Err(e) => {
             error!("Configure Client: Failed to deserialize request body: {}", e);
             return Ok(HttpResponse::builder()
                .status(StatusCode::BAD_REQUEST)
                .header("Content-Type", "application/json")
                .body(r#"{"error": "Invalid request body."}"#.to_string().into_bytes())?);
        }
    };
    
    // Hash the received raw token (SHA-256 hex)
    let mut hasher = Sha256::new();
    hasher.update(request_data.raw_token.as_bytes());
    let hashed_token_hex = format!("{:x}", hasher.finalize());
    
    // Check if we're updating an existing client or creating a new one
    let (client_id, is_update) = if let Some(existing_id) = request_data.client_id {
        // Update existing client
        if let Some(existing_client) = state.authorized_clients.get_mut(&existing_id) {
            info!("Configure Client: Updating existing client {}", existing_id);
            existing_client.authentication_token = hashed_token_hex.clone();
            if let Some(new_name) = request_data.client_name {
                existing_client.name = new_name;
            }
            // Note: We don't update the hot wallet address for existing clients
            (existing_id, true)
        } else {
            error!("Configure Client: Client ID {} not found for update", existing_id);
            return Ok(HttpResponse::builder()
                .status(StatusCode::NOT_FOUND)
                .header("Content-Type", "application/json")
                .body(r#"{"error": "Client not found"}"#.to_string().into_bytes())?);
        }
    } else {
        // Create new client
        let new_client_id = format!("hypergrid-beta-mcp-shim-{}", Uuid::new_v4().to_string());
        info!("Configure Client: Creating new client {}", new_client_id);
        
        let default_name = if request_data.hot_wallet_address_to_associate.len() >= 10 {
            format!(
                "Shim for {}...{}", 
                &request_data.hot_wallet_address_to_associate[..6],
                &request_data.hot_wallet_address_to_associate[request_data.hot_wallet_address_to_associate.len()-4..]
            )
        } else {
            format!("Shim Client {}", new_client_id.chars().take(8).collect::<String>())
        };
        
        let new_client = HotWalletAuthorizedClient {
            id: new_client_id.clone(),
            name: request_data.client_name.unwrap_or(default_name),
            associated_hot_wallet_address: request_data.hot_wallet_address_to_associate,
            authentication_token: hashed_token_hex,
            capabilities: ServiceCapabilities::All,
        };
        
        state.authorized_clients.insert(new_client_id.clone(), new_client);
        (new_client_id, false)
    };
    
    state.save(); // Persist the state change
    info!("Configure Client: {} client with ID: {}", if is_update { "Updated" } else { "Created" }, client_id);

    // Prepare response
    let api_base_path = format!("/{}/api", our.package_id().to_string()); // Use package_id for base path

    let response_data = ConfigureAuthorizedClientResponse {
        client_id,
        raw_token: request_data.raw_token, // Echo back the raw token
        api_base_path,
        node_name: our.node().to_string(),
    };

    // Send success response
    let response_body_bytes = serde_json::to_vec(&response_data)?;
    Ok(HttpResponse::builder()
        .status(StatusCode::OK)
        .header("Content-Type", "application/json")
        .body(response_body_bytes)?)
}

// Helper function to record call failure before returning error
fn record_call_failure(
    state: &mut State, 
    timestamp_start_ms: u128, 
    lookup_key: String, 
    target_provider_id: String, 
    call_args_json: String, 
    payment_result: PaymentAttemptResult,
    operator_wallet_id: Option<String>,
    provider_name_opt: Option<String>,
    client_config_opt: Option<&HotWalletAuthorizedClient>,
) {
    let record = CallRecord {
        timestamp_start_ms,
        provider_lookup_key: lookup_key,
        target_provider_id, // Use best guess ID passed in
        call_args_json,
        response_json: None,
        call_success: false, // Indicate call failed
        response_timestamp_ms: Utc::now().timestamp_millis() as u128,
        payment_result: Some(payment_result),
        duration_ms: Utc::now().timestamp_millis() as u128 - timestamp_start_ms,
        operator_wallet_id, // Use passed-in operator_wallet_id
        client_id: client_config_opt.map(|c| c.id.clone()),
        provider_name: provider_name_opt,
    };
    state.call_history.push(record);
    limit_call_history(state);
    if let Some(tba) = &state.operator_tba_address {
        if let Some(db) = &state.db_conn {
            if let Some(crate::structs::PaymentAttemptResult::Success { .. }) = &state.call_history.last().and_then(|r| r.payment_result.clone()) {
                let provider = state.hypermap.provider.clone();
                let _ = crate::ledger::verify_calls_covering(state, db, &provider, &tba.to_lowercase());
            }
        }
    }
    state.save(); 
}

// --- Payment Handling ---

fn handle_payment(
    state: &mut State, 
    provider_details: &ProviderDetails, 
    client_config_opt: Option<&HotWalletAuthorizedClient>
) -> PaymentResult {
    let price_f64 = provider_details.price_str.parse::<f64>().unwrap_or(0.0);
    if price_f64 <= 0.0 {
        info!("No payment required (Price: {} is zero or invalid).", provider_details.price_str);
        return PaymentResult::NotRequired;
    }

    // Determine which wallet to use for payment
    let signer_wallet_id = match determine_signer_wallet(state, client_config_opt) {
        Ok(id) => id,
        Err(payment_result) => return PaymentResult::Failed(payment_result),
    };
    
    // Enforce client limit BEFORE attempting payment
    if let Some(cfg) = client_config_opt {
        // Sum from ledger: total_cost_units for this client
        if let (Some(db), Some(tba)) = (state.db_conn.as_ref(), state.operator_tba_address.as_ref()) {
            let q = r#"SELECT COALESCE(SUM(CAST(total_cost_units AS INTEGER)),0) AS total FROM usdc_call_ledger WHERE tba_address = ?1 AND client_id = ?2"#.to_string();
            if let Ok(rows) = db.read(q, vec![serde_json::Value::String(tba.to_lowercase()), serde_json::Value::String(cfg.id.clone())]) {
                let spent_units = rows.get(0).and_then(|r| r.get("total")).and_then(|v| v.as_i64()).unwrap_or(0) as i128;
                // incoming price in USDC units
                let price_units = (price_f64 * 1_000_000.0) as i128;
                let projected = spent_units.saturating_add(price_units);
                // client limit in USDC (string dollars)
                let limit_units = state.client_limits_cache.get(&cfg.id)
                    .and_then(|lim| lim.max_total.as_deref())
                    .and_then(|s| s.parse::<f64>().ok())
                    .map(|f| (f * 1_000_000.0) as i128);
                if let Some(lim_u) = limit_units {
                    if projected > lim_u {
                        return PaymentResult::Failed(PaymentAttemptResult::LimitExceeded {
                            limit: (lim_u as f64 / 1_000_000.0).to_string(),
                            amount_attempted: provider_details.price_str.clone(),
                            currency: "USDC".to_string(),
                        });
                    }
                }
            }
        }
    }

    info!("Attempting payment of {} to {} for provider {} using wallet {}", 
          provider_details.price_str, 
          provider_details.wallet_address, 
          provider_details.provider_id, 
          signer_wallet_id
        );
    
    let payment_result = hyperwallet_payments::execute_payment(
        state,
        &provider_details.wallet_address,
        &provider_details.price_str,
        provider_details.provider_id.clone(),
        &signer_wallet_id
    );
    
    match payment_result {
        Some(PaymentAttemptResult::Success { tx_hash, .. }) => PaymentResult::Success(tx_hash),
        Some(result) => PaymentResult::Failed(result),
        None => PaymentResult::Failed(PaymentAttemptResult::Skipped { reason: "Internal payment logic error".to_string() })
    }
}

fn handle_post(
    our: &Address,
    state: &mut State,
    db: &Sqlite,
    client_config_opt: Option<HotWalletAuthorizedClient>,
) -> anyhow::Result<()> {
    let blob = last_blob().ok_or(anyhow::anyhow!("Request body is missing for MCP request"))?;
    
    // Try to parse as new McpRequest format first
    match serde_json::from_slice::<McpRequest>(blob.bytes()) {
        Ok(body) => handle_mcp(our, body, state, db, client_config_opt),
        Err(_) => {
            // Fall back to legacy HttpMcpRequest format for backwards compatibility
            match serde_json::from_slice::<HttpMcpRequest>(blob.bytes()) {
                Ok(body) => {
                    warn!("Received deprecated HttpMcpRequest format. Please update to use McpRequest for MCP operations or ApiRequest for other operations.\n\n{:?}", body);
                    handle_legacy_mcp(our, body, state, db, client_config_opt)
                }
                Err(e) if e.is_syntax() || e.is_data() => {
                    error!("Failed to deserialize MCP request JSON: {}", e);
                    send_json_response(
                        StatusCode::BAD_REQUEST,
                        &json!({ "error": format!("Invalid MCP request body: {}", e) })
                    )?;
                    Ok(())
                }
                Err(e) => {
                    error!("Unexpected error reading MCP request blob: {}", e);
                    Err(anyhow::anyhow!("Error reading MCP request body: {}", e))
                }
            }
        }
    }
}

fn handle_delete_authorized_client(state: &mut State, client_id: String) -> anyhow::Result<()> {
    info!("Deleting authorized client: {}", client_id);
    
    if state.authorized_clients.remove(&client_id).is_some() {
        state.save();
        send_json_response(StatusCode::OK, &json!({ "success": true }))
    } else {
        send_json_response(StatusCode::NOT_FOUND, &json!({ 
            "success": false, 
            "error": "Client not found" 
        }))
    }
}

fn handle_rename_authorized_client(state: &mut State, client_id: String, new_name: String) -> anyhow::Result<()> {
    info!("Renaming authorized client {} to '{}'", client_id, new_name);

    match state.authorized_clients.get_mut(&client_id) {
        Some(client) => {
            client.name = new_name;
            state.save();
            send_json_response(StatusCode::OK, &json!({ "success": true }))
        }
        None => {
            send_json_response(StatusCode::NOT_FOUND, &json!({
                "success": false,
                "error": "Client not found"
            }))
        }
    }
}

fn handle_set_gasless_enabled(state: &mut State, enabled: bool) -> anyhow::Result<()> {
    info!("Setting gasless transactions enabled: {}", enabled);
    
    state.gasless_enabled = Some(enabled);
    state.save();
    
    send_json_response(StatusCode::OK, &json!({ 
        "success": true,
        "gasless_enabled": enabled,
        "message": if enabled {
            "Gasless transactions enabled. Payments will use ERC-4337 UserOperations when possible."
        } else {
            "Gasless transactions disabled. Payments will use regular transactions."
        }
    }))
}

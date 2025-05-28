use std::collections::HashMap;
use std::str::FromStr;

use alloy_primitives::{Address as EthAddress, U256};

use chrono::Utc;
use hyperware_process_lib::{
    last_blob,
    http::{
        Method, 
        StatusCode,
        Response as HttpResponse,
        server::{send_response, HttpServerRequest, HttpBindingConfig, HttpServerError, IncomingHttpRequest},
    },
    logging::{error, info, warn},
    signer::Signer,
    wallet, signer,
    sqlite::Sqlite,
    vfs,
    Address, eth, hypermap,
    ProcessId, PackageId, Request as ProcessRequest, SendErrorKind,
};
use rand::{distributions::Alphanumeric, Rng};
use serde::{Serialize, Deserialize};
use serde_json::{json, Value};
use sha2::{Sha256, Digest};
use uuid::Uuid;

use crate::{
    authorized_services::{HotWalletAuthorizedClient, ServiceCapabilities},
    chain,
    db as dbm,
    helpers::{send_json_response},
    identity,
    structs::{self, *, ConfigureAuthorizedClientRequest, ConfigureAuthorizedClientResponse},
    wallet_manager::{self, BASE_CHAIN_ID, BASE_USDC_ADDRESS},
    graph::handle_get_hpn_graph_layout,
};

// ------------------------------------------------------------------------------------------------
// Hallman: here there be misnomers and uglyness
// ------------------------------------------------------------------------------------------------
// TODO: refactor
pub fn handle_frontend(our: &Address, body: &[u8], state: &mut State, db: &Sqlite) -> anyhow::Result<()> {
    info!("handle_frontend received request");
    let server_request: HttpServerRequest = match serde_json::from_slice(body) {
        Ok(req) => req,
        Err(e) => {
            error!("Failed to deserialize HttpServerRequest: {}", e);
            send_response(StatusCode::BAD_REQUEST, None, b"Invalid request format".to_vec());
            return Ok(());
        }
    };

    info!("Deserialized HttpServerRequest: {:?}", server_request);

    match server_request {
        HttpServerRequest::Http(req) => {
            let method = req.method()?;
            let url_path_result = req.path(); // Result<String, _>
            info!("Processing HTTP request: Method={}, Path={:?}", method, url_path_result);

            // Refined Routing Logic
            match (method.clone(), url_path_result) {
                (Method::POST, Ok(path)) if path.as_str() == "/api/authorize-shim" => {
                    info!("Routing to handle_authorize_shim_request");
                    match handle_authorize_shim_request(our, &req, state, db) {
                        Ok(response) => {
                            // Manually create headers HashMap for send_response
                            let mut headers = HashMap::new();
                            if let Some(content_type) = response.headers().get("Content-Type") {
                                // Convert HeaderValue to String - handle potential errors
                                if let Ok(ct_str) = content_type.to_str() {
                                     headers.insert("Content-Type".to_string(), ct_str.to_string());
                                }
                            }
                            
                            send_response(
                                response.status(),
                                Some(headers),
                                response.body().clone(),
                            );
                        }
                        Err(e) => {
                            error!("Error in handle_authorize_shim_request: {:?}", e);
                            send_json_response(
                                StatusCode::INTERNAL_SERVER_ERROR,
                                &json!({ "error": format!("Internal Server Error: {}", e) })
                            )?;
                        }
                    }
                }
                (Method::POST, Ok(path)) if path.as_str() == "/api/configure-authorized-client" => {
                    info!("Routing to handle_configure_authorized_client");
                    match handle_configure_authorized_client(our, &req, state, db) {
                        Ok(response) => {
                            let mut headers = HashMap::new();
                            if let Some(content_type) = response.headers().get("Content-Type") {
                                if let Ok(ct_str) = content_type.to_str() {
                                     headers.insert("Content-Type".to_string(), ct_str.to_string());
                                }
                            }
                            
                            send_response(
                                response.status(),
                                Some(headers),
                                response.body().clone(),
                            );
                        }
                        Err(e) => {
                            error!("Error in handle_configure_authorized_client: {:?}", e);
                            send_json_response(
                                StatusCode::INTERNAL_SERVER_ERROR,
                                &json!({ "error": format!("Internal Server Error: {}", e) })
                            )?;
                        }
                    }
                }
                (Method::POST, Ok(path)) if path.as_str() == "/api/mcp" => {
                    // This path is now for the UI (cookie authenticated by binding)
                    info!("Routing to handle_post (for UI MCP)");
                    
                    // Directly call handle_post to process the body for UI
                    if let Err(e) = handle_post(our, state, db) { 
                        error!("Error in handle_post: {:?}", e);
                        let _ = send_json_response(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            &json!({ "error": format!("Failed to handle POST request: {}", e) })
                        );
                    }
                }
                (Method::POST, Ok(path)) if path.as_str() == "/shim/mcp" => {
                    info!("Routing to handle_post (for Shim MCP) - Performing new Client Auth...");
                    
                    let client_id_header_opt: Option<String> = req.headers().get("X-Client-ID")
                        .and_then(|v| v.to_str().ok())
                        .map(String::from);
                    let token_header_opt: Option<String> = req.headers().get("X-Token")
                        .and_then(|v| v.to_str().ok())
                        .map(String::from);

                    let auth_result = match (&client_id_header_opt, &token_header_opt) {
                        (Some(id), Some(token)) => authenticate_shim_client(state, id, token),
                        (None, _) => Err(AuthError::MissingClientId),
                        (_, None) => Err(AuthError::MissingToken),
                    };

                    match auth_result {
                        Ok(client_config) => {
                            info!(
                                "Shim Client Auth: Validated successfully for Client ID: {}. Associated Hot Wallet: {}", 
                                client_config.id, 
                                client_config.associated_hot_wallet_address
                            );
                            // Proceed to handle the actual MCP request
                    if let Err(e) = handle_post(our, state, db) { 
                        error!("Error in handle_post after shim auth: {:?}", e);
                        let _ = send_json_response(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            &json!({ "error": format!("Failed to handle POST request: {}", e) })
                        );
                            }
                        }
                        Err(auth_error) => {
                            match auth_error {
                                AuthError::MissingClientId => {
                                    error!("Shim Client Auth: Missing X-Client-ID header.");
                                    send_json_response(StatusCode::UNAUTHORIZED, &json!({ "error": "Missing X-Client-ID header" }))?;
                                }
                                AuthError::MissingToken => {
                                    error!("Shim Client Auth: Missing X-Token header.");
                                    send_json_response(StatusCode::UNAUTHORIZED, &json!({ "error": "Missing X-Token header" }))?;
                                }
                                AuthError::ClientNotFound => {
                                    // Use client_id_header_opt.as_deref() to safely get an &str for logging
                                    error!("Shim Client Auth: Client ID: {} not found.", client_id_header_opt.as_deref().unwrap_or("UNKNOWN"));
                                    send_json_response(StatusCode::UNAUTHORIZED, &json!({ "error": "Client ID not found" }))?;
                                }
                                AuthError::InvalidToken => {
                                    error!("Shim Client Auth: Invalid token for Client ID: {}.", client_id_header_opt.as_deref().unwrap_or("UNKNOWN"));
                                    send_json_response(StatusCode::FORBIDDEN, &json!({ "error": "Invalid token" }))?;
                                }
                                AuthError::InsufficientCapabilities => {
                                    error!("Shim Client Auth: Client ID: {} does not have required capabilities.", client_id_header_opt.as_deref().unwrap_or("UNKNOWN"));
                                    send_json_response(StatusCode::FORBIDDEN, &json!({ "error": "Client lacks necessary capabilities" }))?;
                                }
                            }
                        }
                    }
                }
                (Method::GET, Ok(path_str)) => {
                    info!("Routing to handle_get");
                    // Use &path_str in unwrap_or
                    if let Err(e) = handle_get(our, &path_str, req.query_params(), state, db) {
                        error!("Error in handle_get: {:?}", e);
                        send_json_response(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            &json!({ "error": format!("Internal Server Error: {}", e) })
                        )?;
                    }
                }
                (Method::POST, Ok(path)) if {
                        let path_str = path.as_str();
                        let comparison_result = path_str == "/api/generate-api-config";
                        info!("Path comparison: '{}' == '{}' -> {}", path_str, "/api/generate-api-config", comparison_result);
                        comparison_result
                    } => 
                {
                    info!("Routing to handle_generate_api_config");
                    // ... rest of handler call ...
                }
                // Add cases for other paths or return 404/405
                (_, Ok(unknown_path)) => {
                    warn!("Unhandled path: {} {}", method, unknown_path);
                    send_response(StatusCode::NOT_FOUND, None, b"Not Found".to_vec());
                }
                 (_, Err(path_err)) => { // Handle error getting path
                    error!("Error parsing request path: {:?}", path_err);
                    send_response(StatusCode::BAD_REQUEST, None, b"Invalid request path".to_vec());
                 }
            }
        }
        _ => { 
             // Handle non-HTTP requests if necessary, otherwise ignore
             info!("Ignoring non-HTTP ServerRequest");
        },
    };
    Ok(())
}

// handle_post now only needs to deal with MCP requests
fn handle_post(our: &Address, state: &mut State, db: &Sqlite) -> anyhow::Result<()> {
    // Proceed with original MCP body parsing and handling
    let blob = last_blob().ok_or(anyhow::anyhow!("Request body is missing for MCP request"))?; 
    match serde_json::from_slice::<HttpMcpRequest>(blob.bytes()) {
        Ok(body) => handle_mcp(our, body, state, db), // Pass our if handle_mcp needs it
        Err(e) => {
            if e.is_syntax() || e.is_data() {
                error!("Failed to deserialize MCP request JSON: {}", e);
                send_json_response(
                    StatusCode::BAD_REQUEST,
                    &json!({ "error": format!("Invalid MCP request body: {}", e) })
                )?;
                Ok(()) 
            } else {
                 error!("Unexpected error reading MCP request blob: {}", e);
                 Err(anyhow::anyhow!("Error reading MCP request body: {}", e))
            }
        }
    }
}

/// Handles GET requests to /api/setup-status
fn handle_get_setup_status(state: &State) -> anyhow::Result<()> {
    info!("Checking setup status...");
    let is_configured = state.operator_tba_address.is_some();
    info!("Operator identity configured: {}", is_configured);
    send_json_response(StatusCode::OK, &json!({ "configured": is_configured }))
}

/// Determines the current onboarding status by performing necessary checks.
/// Uses the new detailed check functions.
fn handle_get_onboarding_status(state: &State, our: &Address) -> anyhow::Result<()> {
    info!("Handling GET /onboarding-status for node {}...", our.node);
    
    let mut response = OnboardingStatusResponse {
        status: OnboardingStatus::Loading, // Start with Loading, will be updated
        checks: OnboardingCheckDetails::default(),
        errors: Vec::new(),
    };
    let mut first_failure_status: Option<OnboardingStatus> = None;

    // --- 1. Identity Check (Operator General) ---
    info!("Onboarding Check 1: Identity...");
    let identity_status = identity::check_operator_identity_detailed(our);
    response.checks.identity_status = Some(identity_status.clone());
    match &identity_status {
        IdentityStatus::Verified { entry_name, tba_address, .. } => {
            response.checks.identity_configured = true;
            response.checks.operator_entry = Some(entry_name.clone());
            response.checks.operator_tba = Some(tba_address.clone());
            info!("  -> Identity OK (Verified). Entry: {}, TBA: {}", entry_name, tba_address);
        }
        status => {
            response.checks.identity_configured = false;
            response.errors.push(format!("Identity Check Failed: {:?}", status));
            first_failure_status.get_or_insert(OnboardingStatus::NeedsOnChainSetup);
            info!("  -> Identity FAILED.");
        }
    }

    // --- 2. Operator TBA Funding Check ---
    // Only run if identity is configured (TBA exists to be funded).
    if response.checks.identity_configured {
        info!("Onboarding Check 2: Operator TBA Funding...");
        // This function call needs to be adapted or replaced if it also checks hot wallet funding.
        // For now, assuming wallet_manager::check_funding_status_detailed can be called
        // and we only use its TBA-related fields.
        // OR, we might need a new function wallet_manager::check_tba_funding_detailed(...)
        let tba_funding_details = wallet_manager::check_operator_tba_funding_detailed(
            response.checks.operator_tba.as_deref() // Pass the TBA verified in *this* request
        );

        response.checks.tba_eth_funded = Some(!tba_funding_details.tba_needs_eth);
        response.checks.tba_usdc_funded = Some(!tba_funding_details.tba_needs_usdc);
        response.checks.tba_eth_balance_str = tba_funding_details.tba_eth_balance_str;
        response.checks.tba_usdc_balance_str = tba_funding_details.tba_usdc_balance_str;
        response.checks.tba_funding_check_error = tba_funding_details.check_error.clone();

        if let Some(err_msg) = &tba_funding_details.check_error {
            response.errors.push(format!("Operator TBA Funding Check Error: {}", err_msg));
            first_failure_status.get_or_insert(OnboardingStatus::NeedsFunding);
            info!("  -> Operator TBA Funding CHECK ERROR.");
        }
        if tba_funding_details.tba_needs_eth || tba_funding_details.tba_needs_usdc {
            first_failure_status.get_or_insert(OnboardingStatus::NeedsFunding);
            if tba_funding_details.tba_needs_eth { response.errors.push("Warning: Operator TBA requires ETH for gas.".to_string()); }
            if tba_funding_details.tba_needs_usdc { response.errors.push("Warning: Operator TBA requires USDC for payments.".to_string()); }
            info!("  -> Operator TBA Funding NEEDED.");
        } else if tba_funding_details.check_error.is_none() {
            info!("  -> Operator TBA Funding OK.");
        }
    } else {
        info!("Skipping Operator TBA Funding check due to Identity failure.");
        response.checks.tba_eth_funded = Some(false);
        response.checks.tba_usdc_funded = Some(false);
        response.checks.tba_funding_check_error = Some("Skipped due to identity failure".to_string());
        // If identity failed, NeedsOnChainSetup is already set.
    }

    // --- 3. Linked Hot Wallets Checks (Delegation & Funding) ---
    info!("Onboarding Check 3: Linked Hot Wallets...");
    if response.checks.identity_configured {
        // Fetch all on-chain linked hot wallet addresses
        match wallet_manager::get_all_onchain_linked_hot_wallet_addresses(
            response.checks.operator_entry.as_deref(),
            // TODO: Consider how to best provide eth_provider if it's managed centrally
            // For now, get_all_onchain_linked_hot_wallet_addresses creates its own.
        ) {
            Ok(linked_addresses) => {
                info!("  -> Successfully fetched {} on-chain linked hot wallet addresses.", linked_addresses.len());

                if linked_addresses.is_empty() {
                    response.errors.push("No hot wallets appear to be linked on-chain to the operator identity.".to_string());
                    first_failure_status.get_or_insert(OnboardingStatus::NeedsHotWallet);
                    info!("  -> No linked hot wallets found for operator: {:?}", response.checks.operator_entry);
        }

                for hot_wallet_address_str in linked_addresses {
                    info!("  Checking Hot Wallet: {}...", hot_wallet_address_str);

                    // 3a. Get WalletSummary for this address
                    let summary = wallet_manager::get_wallet_summary_for_address(state, &hot_wallet_address_str);

                    // 3b. Delegation Check for this specific hot wallet
                    let delegation_status = wallet_manager::verify_single_hot_wallet_delegation_detailed(
                        state, // Though _state is unused in current verify_single_hot_wallet_delegation_detailed
                        response.checks.operator_entry.as_deref(),
                        &hot_wallet_address_str
                    );

                    if delegation_status != DelegationStatus::Verified {
                        response.errors.push(format!(
                            "Hot Wallet {} Delegation Issue: {:?}",
                            hot_wallet_address_str, delegation_status
                        ));
                        match delegation_status {
                            DelegationStatus::NeedsIdentity => first_failure_status.get_or_insert(OnboardingStatus::NeedsOnChainSetup),
                            _ => first_failure_status.get_or_insert(OnboardingStatus::NeedsHotWallet),
                        };
                        info!("    -> Delegation FAILED for {}: {:?}", hot_wallet_address_str, delegation_status);
                    } else {
                        info!("    -> Delegation OK for {}.", hot_wallet_address_str);
                    }

                    // 3c. Funding Check for this specific hot wallet
                    let (hw_needs_eth, hw_eth_balance_str, hw_funding_check_error) =
                        wallet_manager::check_single_hot_wallet_funding_detailed(state, &hot_wallet_address_str);

                    if let Some(err_msg) = &hw_funding_check_error {
                        response.errors.push(format!("Hot Wallet {} Funding Check Error: {}", hot_wallet_address_str, err_msg));
                        first_failure_status.get_or_insert(OnboardingStatus::NeedsFunding);
                        info!("    -> Hot Wallet {} Funding CHECK ERROR.", hot_wallet_address_str);
                    }
                    if hw_needs_eth {
                        response.errors.push(format!("Warning: Hot Wallet {} requires ETH for gas.", hot_wallet_address_str));
                        first_failure_status.get_or_insert(OnboardingStatus::NeedsFunding);
                        info!("    -> Hot Wallet {} Funding NEEDED.", hot_wallet_address_str);
                    } else if hw_funding_check_error.is_none() {
                        info!("    -> Hot Wallet {} Funding OK.", hot_wallet_address_str);
                    }

                    response.checks.linked_hot_wallets_info.push(LinkedHotWalletInfo {
                        summary,
                        delegation_status: Some(delegation_status),
                        needs_eth_funding: hw_needs_eth,
                        eth_balance_str: hw_eth_balance_str,
                        funding_check_error: hw_funding_check_error,
                    });
                }
        }
        Err(e) => {
                response.errors.push(format!("Failed to retrieve linked hot wallets: {}", e));
                first_failure_status.get_or_insert(OnboardingStatus::Error); // Or NeedsOnChainSetup if appropriate
                info!("  -> Failed to retrieve linked hot wallets: {}", e);
            }
        }
    } else {
        info!("Skipping Linked Hot Wallets check due to Identity failure.");
        // No explicit error message here for skipping, as the identity failure is already primary.
    }


    // Determine final status
    response.status = first_failure_status.unwrap_or(OnboardingStatus::Ready);
    // If all checks passed but no hot wallets are linked, and identity IS configured,
    // then status should probably be NeedsHotWallet.
    if response.status == OnboardingStatus::Ready && response.checks.identity_configured && response.checks.linked_hot_wallets_info.is_empty() {
        info!("All checks initially Ready, but no linked hot wallets found. Setting status to NeedsHotWallet.");
        response.status = OnboardingStatus::NeedsHotWallet;
        // Add a general error if not already present from the loop above.
        if !response.errors.iter().any(|e| e.contains("No hot wallets appear to be linked")) {
             response.errors.push("Operator identity is configured, but no hot wallets are linked on-chain.".to_string());
        }
    }


    info!("Final Onboarding Status: {:?}, Linked Wallets: {}, Errors: {:?}",
        response.status,
        response.checks.linked_hot_wallets_info.len(),
        response.errors
    );
    send_json_response(StatusCode::OK, &response)
}

/// Handles GET requests to /api/managed-wallets
fn handle_get_managed_wallets(state: &State) -> anyhow::Result<()> {
    info!("Handling GET /api/managed-wallets...");
    let (selected_id, summaries) = wallet_manager::get_wallet_summary_list(state);
    // The frontend will primarily use the summaries (Vec<WalletSummary>).
    // We can decide if selected_id is also useful for this specific endpoint or if summaries alone suffice.
    // For now, returning both as per get_wallet_summary_list structure.
    let response_data = json!({ 
        "selected_wallet_id": selected_id,
        "managed_wallets": summaries 
    });
    send_json_response(StatusCode::OK, &response_data)
}

fn handle_get(
    our: &Address,
    path_str: &str,
    params: &HashMap<String, String>,
    state: &State,
    db: &Sqlite,
) -> anyhow::Result<()> {
    info!(
        "handle_get, our: {}, path_str: {:?}, params: {:?}",
        our.node,
        path_str,
        params
    );
    match path_str {
        "/api/setup-status" | "setup-status" => handle_get_setup_status(state)?,
        "/api/onboarding-status" | "onboarding-status" => {
            handle_get_onboarding_status(state, our)?
        }
        "/api/hpn-graph" | "/hpn-graph" => {
            info!("DEBUG: Handling GET /api/hpn-graph");
            handle_get_hpn_graph_layout(our, state, db)?
        }
        "/api/state" | "state" => send_json_response(StatusCode::OK, &json!(state))?,
        "/api/all" | "all" => {
            let data = dbm::get_all(db)?;
            send_json_response(StatusCode::OK, &json!(data))?
        }
        "/api/cat" | "cat" => {
            let query = params
                .get("cat")
                .ok_or(anyhow::anyhow!("Missing 'cat' query parameter"))?;
            let data = dbm::get_by_category(db, query.to_string())?;
            send_json_response(StatusCode::OK, &json!(data))?
        }
        "/api/search" | "search" => {
            let query = params
                .get("q")
                .ok_or(anyhow::anyhow!("Missing 'q' query parameter"))?;
            let data = dbm::search_provider(db, query.to_string())?;
            send_json_response(StatusCode::OK, &json!(data))?
        }
        "/api/managed-wallets" => {
            handle_get_managed_wallets(state)?
        }
        _ => send_json_response(
            StatusCode::NOT_FOUND,
            &json!({ "error": "API endpoint not found" }),
        )?,
    };
    Ok(())
}

// TODO b4 beta: move everything NOT mcp to a new handler
fn handle_mcp(our: &Address, req: HttpMcpRequest, state: &mut State, db: &Sqlite) -> anyhow::Result<()> {
    info!("mcp request: {:?}", req);
    match req {
        HttpMcpRequest::SearchRegistry(query) => {
            let data = dbm::search_provider(db, query)?;
            send_json_response(StatusCode::OK, &json!(data))?;
            Ok(())
        }
        HttpMcpRequest::CallProvider {
            provider_id,
            provider_name,
            arguments,
        } => {
            handle_provider_call_request(our, state, db, provider_id, provider_name, arguments)
        }

        // History
        HttpMcpRequest::GetCallHistory {} => {
            info!("DEBUG: Handling McpRequest::GetCallHistory");
            // Return a clone of the history from state
            let history_clone = state.call_history.clone(); 
            send_json_response(StatusCode::OK, &history_clone)
        }

        // Wallet Summary/Selection Actions
        HttpMcpRequest::GetWalletSummaryList {} => {
            info!("DEBUG: Handling McpRequest::GetWalletSummaryList");
            let (selected_id, summaries) = wallet_manager::get_wallet_summary_list(state);
            send_json_response(StatusCode::OK, &json!({ "selected_id": selected_id, "wallets": summaries }))
        }
        HttpMcpRequest::SelectWallet { wallet_id } => {
            info!("DEBUG: Handling McpRequest::SelectWallet");
            match wallet_manager::select_wallet(state, wallet_id) {
                Ok(_) => send_json_response(StatusCode::OK, &json!({ "success": true })),
                Err(e) => send_json_response(StatusCode::BAD_REQUEST, &json!({ "success": false, "error": e })),
            }
        }
        HttpMcpRequest::RenameWallet { wallet_id, new_name } => {
             info!("DEBUG: Handling McpRequest::RenameWallet");
             match wallet_manager::rename_wallet(state, wallet_id, new_name) {
                 Ok(_) => send_json_response(StatusCode::OK, &json!({ "success": true })),
                 Err(e) => send_json_response(StatusCode::BAD_REQUEST, &json!({ "success": false, "error": e })),
             }
        }
         HttpMcpRequest::DeleteWallet { wallet_id } => {
             info!("DEBUG: Handling McpRequest::DeleteWallet");
             match wallet_manager::delete_wallet(state, wallet_id) {
                 Ok(_) => send_json_response(StatusCode::OK, &json!({ "success": true })),
                 Err(e) => send_json_response(StatusCode::BAD_REQUEST, &json!({ "success": false, "error": e })),
             }
        }

         // Wallet Creation/Import
         HttpMcpRequest::GenerateWallet {} => {
             info!("DEBUG: Handling McpRequest::GenerateWallet");
             // generate_initial_wallet returns the wallet, we need to add it to state
             match wallet_manager::generate_initial_wallet() { 
                 Ok(wallet) => {
                     let wallet_id = wallet.id.clone();
                     state.managed_wallets.insert(wallet_id.clone(), wallet);
                     // Automatically select if none selected?
                     if state.selected_wallet_id.is_none() {
                          // Use the select function which handles cache etc.
                          let _ = wallet_manager::select_wallet(state, wallet_id.clone());
                     } else {
                         state.save(); // Save state if not selecting
                     }
                     send_json_response(StatusCode::OK, &json!({ "success": true, "id": wallet_id }))
                 }
                 Err(e) => send_json_response(StatusCode::INTERNAL_SERVER_ERROR, &json!({ "success": false, "error": e }))
             }
         }
        HttpMcpRequest::ImportWallet { private_key, password, name } => {
            info!("DEBUG: Handling McpRequest::ImportWallet");
            match wallet_manager::import_new_wallet(state, private_key, password, name) {
                Ok(address) => send_json_response(StatusCode::OK, &json!({ "success": true, "address": address })),
                Err(e) => send_json_response(StatusCode::BAD_REQUEST, &json!({ "success": false, "error": e })),
            }
        }

        // Wallet State & Config (Operate on SELECTED wallet implicitly)
        HttpMcpRequest::ActivateWallet { password } => {
             info!("DEBUG: Handling McpRequest::ActivateWallet");
             let selected_id = match state.selected_wallet_id.clone() {
                 Some(id) => id,
                 None => return send_json_response(StatusCode::BAD_REQUEST, &json!({ "success": false, "error": "No wallet selected" }))
             };
             match wallet_manager::activate_wallet(state, selected_id, password) {
                Ok(()) => send_json_response(StatusCode::OK, &json!({ "success": true })),
                Err(e) => send_json_response(StatusCode::BAD_REQUEST, &json!({ "success": false, "error": e })), 
            }
        }
        HttpMcpRequest::DeactivateWallet {} => {
             info!("DEBUG: Handling McpRequest::DeactivateWallet");
             let selected_id = match state.selected_wallet_id.clone() {
                 Some(id) => id,
                 None => return send_json_response(StatusCode::BAD_REQUEST, &json!({ "success": false, "error": "No wallet selected" }))
             };
             match wallet_manager::deactivate_wallet(state, selected_id) {
                 Ok(()) => send_json_response(StatusCode::OK, &json!({ "success": true })),
                 Err(e) => send_json_response(StatusCode::BAD_REQUEST, &json!({ "success": false, "error": e })),
             }
        }
        HttpMcpRequest::SetWalletLimits { limits } => {
            info!("DEBUG: Handling McpRequest::SetWalletLimits");
            let selected_id = match state.selected_wallet_id.clone() {
                 Some(id) => id,
                 None => return send_json_response(StatusCode::BAD_REQUEST, &json!({ "success": false, "error": "No wallet selected" }))
             };
             match wallet_manager::set_wallet_spending_limits(state, selected_id, limits) {
                Ok(_) => send_json_response(StatusCode::OK, &json!({ "success": true })),
                Err(e) => send_json_response(StatusCode::BAD_REQUEST, &json!({ "success": false, "error": e })), 
            }
        }
        HttpMcpRequest::ExportSelectedPrivateKey { password } => {
            info!("DEBUG: Handling McpRequest::ExportSelectedPrivateKey");
             let selected_id = match state.selected_wallet_id.clone() {
                 Some(id) => id,
                 None => return send_json_response(StatusCode::BAD_REQUEST, &json!({ "success": false, "error": "No wallet selected" }))
             };
            match wallet_manager::export_private_key(state, selected_id, password) {
                Ok(private_key) => send_json_response(StatusCode::OK, &json!({ "success": true, "private_key": private_key })),
                Err(e) => send_json_response(StatusCode::BAD_REQUEST, &json!({ "success": false, "error": e })), 
            }
        }
        HttpMcpRequest::SetSelectedWalletPassword { new_password, old_password } => {
            info!("DEBUG: Handling McpRequest::SetSelectedWalletPassword");
             let selected_id = match state.selected_wallet_id.clone() {
                 Some(id) => id,
                 None => return send_json_response(StatusCode::BAD_REQUEST, &json!({ "success": false, "error": "No wallet selected" }))
             };
             match wallet_manager::set_wallet_password(state, selected_id, new_password, old_password) {
                Ok(_) => send_json_response(StatusCode::OK, &json!({ "success": true })),
                Err(e) => send_json_response(StatusCode::BAD_REQUEST, &json!({ "success": false, "error": e })), 
            }
        }
        HttpMcpRequest::RemoveSelectedWalletPassword { current_password } => {
            info!("DEBUG: Handling McpRequest::RemoveSelectedWalletPassword");
             let selected_id = match state.selected_wallet_id.clone() {
                 Some(id) => id,
                 None => return send_json_response(StatusCode::BAD_REQUEST, &json!({ "success": false, "error": "No wallet selected" }))
             };
             match wallet_manager::remove_wallet_password(state, selected_id, current_password) {
                Ok(_) => send_json_response(StatusCode::OK, &json!({ "success": true })),
                Err(e) => send_json_response(StatusCode::BAD_REQUEST, &json!({ "success": false, "error": e })), 
            }
        }

        HttpMcpRequest::GetActiveAccountDetails {} => {
            // Check cache first
            if let Some(cached_details) = state.cached_active_details.clone() {
                info!("Returning cached active account details.");
                return send_json_response(StatusCode::OK, &cached_details);
            }

            // Cache miss, proceed to fetch
            info!("Active account details cache miss. Fetching...");
            match wallet_manager::get_active_account_details(state) {
                Ok(Some(details)) => {
                    // Store in cache before returning
                    info!("Fetched details successfully. Caching and returning.");
                    state.cached_active_details = Some(details.clone());
                    send_json_response(StatusCode::OK, &details)
                }
                Ok(None) => {
                    // No active/unlocked account found, ensure cache is clear
                    info!("No active/unlocked account found. Clearing cache and returning null.");
                    state.cached_active_details = None;
                    send_json_response(StatusCode::OK, &json!(null))
                }
                Err(e) => {
                    // Error fetching details, ensure cache is clear
                    error!("Error getting active account details: {:?}", e);
                    state.cached_active_details = None; 
                    send_json_response(StatusCode::INTERNAL_SERVER_ERROR, &json!({ "error": "Failed to retrieve account details" }))
                }
            }
        }
        // --- End NEW Handler ---
    }
}

// Structure to hold provider details from the database
pub struct ProviderDetails {
    wallet_address: String,  // Provider's wallet address
    price_str: String,       // Price as string (e.g., "0.001")
    provider_id: String,     // The actual provider ID (e.g., "node.os")
}

// Result of fetching provider details
enum FetchProviderResult {
    Success(ProviderDetails),
    NotFound(String), // Contains lookup key that wasn't found
}

// Result of payment attempt
enum PaymentResult {
    NotRequired,
    Success(String), // Contains transaction hash
    Failed(PaymentAttemptResult),
}

// Result of provider call
enum ProviderCallResult {
    Success(Vec<u8>),
    Failed(anyhow::Error),
}

fn handle_provider_call_request(
    our: &Address,
    state: &mut State,
    db: &Sqlite, 
    provider_id: String,
    provider_name: String,
    arguments: Vec<(String, String)>,
) -> anyhow::Result<()> {
    info!("Handling call request for provider ID='{}', Name='{}'", provider_id, provider_name);
    let timestamp_start_ms = Utc::now().timestamp_millis() as u128;
    let call_args_json = serde_json::to_string(&arguments).unwrap_or_else(|_| "{}".to_string());
    let lookup_key = if !provider_id.is_empty() { provider_id.clone() } else { provider_name.clone() };

    // Step 1: Fetch provider details
    match fetch_provider_details(db, &lookup_key) {
        FetchProviderResult::Success(provider_details) => {
            // Step 2: Handle payment if required
            match handle_payment(state, &provider_details) {
                PaymentResult::NotRequired => {
                    info!("No payment required for this provider");
                    execute_provider_call(our, state, &provider_details, provider_name, arguments, timestamp_start_ms, call_args_json)
                },
                PaymentResult::Success(tx_hash) => {
                    info!("Payment successful with tx hash: {}", tx_hash);
                    execute_provider_call_with_payment(our, state, &provider_details, provider_name, arguments, timestamp_start_ms, call_args_json, tx_hash)
                },
                PaymentResult::Failed(payment_result) => {
                    error!("Payment failed: {:?}", payment_result);
                    let payment_result_clone = payment_result.clone(); // Clone to avoid move error
                    record_call_failure(
                        state, 
                        timestamp_start_ms, 
                        lookup_key, 
                        provider_details.provider_id, 
                        call_args_json, 
                        payment_result
                    );
                    send_json_response(StatusCode::PAYMENT_REQUIRED, &json!({ 
                        "error": "Pre-payment failed or was skipped.", 
                        "details": payment_result_clone 
                    }))
                }
            }
        },
        FetchProviderResult::NotFound(lookup_key) => {
            error!("Provider '{}' not found in local DB.", lookup_key);
            record_call_failure(
                state, 
                timestamp_start_ms, 
                lookup_key.clone(), 
                provider_id, 
                call_args_json, 
                PaymentAttemptResult::Skipped { reason: format!("DB Lookup Failed: Key '{}' not found", lookup_key) }
            );
            send_json_response(StatusCode::NOT_FOUND, &json!({ "error": format!("Provider '{}' not found", lookup_key) }))
        }
    }
}

// Helper function to fetch provider details from the database
fn fetch_provider_details(db: &Sqlite, lookup_key: &str) -> FetchProviderResult {
    info!("Fetching provider details for lookup key: {}", lookup_key);
    
    // Special case for hpn-provider-beta.os
    //if lookup_key == "hpn-provider-beta.os" {
    //    info!("Returning hardcoded details for hpn-provider-beta.os");
    //    return FetchProviderResult::Success(ProviderDetails {
    //        wallet_address: "0xDEAF82e285c794a8091f95007A71403Ff3dbB21d".to_string(),
    //        price_str: "0.0002".to_string(),
    //        provider_id: "hpn-provider-beta.os".to_string(),
    //    });
    //}
    
    match dbm::get_provider_details(db, lookup_key) {
        Ok(Some(details_map)) => {
            // Extract the provider ID
            let provider_id = match details_map.get("provider_id").and_then(Value::as_str).map(String::from) {
                Some(id) => id,
                None => return FetchProviderResult::NotFound(lookup_key.to_string()),
            };
            
            // Extract wallet address (default to "0x0" if not found)
            let wallet = details_map.get("wallet").and_then(Value::as_str)
                .map(String::from)
                .unwrap_or_else(|| "0x0".to_string());
            
            // Extract price (default to "0.0" if not found)
            let price = details_map.get("price").and_then(Value::as_str)
                .map(String::from)
                .unwrap_or_else(|| "0.0".to_string());
            
            info!("Found provider details in DB: ID={}, Wallet={}, Price={}", provider_id, wallet, price);
            
            FetchProviderResult::Success(ProviderDetails {
                wallet_address: wallet,
                price_str: price,
                provider_id,
            })
        },
        _ => FetchProviderResult::NotFound(lookup_key.to_string()),
    }
}

// Helper function to handle payment logic
fn handle_payment(state: &mut State, provider_details: &ProviderDetails) -> PaymentResult {
    let price_f64 = provider_details.price_str.parse::<f64>().unwrap_or(0.0);
    
    if price_f64 <= 0.0 {
        info!("No payment required (Price: {}).", provider_details.price_str);
        return PaymentResult::NotRequired;
    }
    
    info!("Payment required: Attempting pre-payment of {} to {}", 
          provider_details.price_str, provider_details.wallet_address);
    
    let payment_result = wallet_manager::execute_payment_if_needed(
        state,
        &provider_details.wallet_address,
        &provider_details.price_str,
        provider_details.provider_id.clone(),
    );
    
    match payment_result {
        Some(PaymentAttemptResult::Success { tx_hash, .. }) => {
            info!("Pre-payment successful with tx hash: {}", tx_hash);
            PaymentResult::Success(tx_hash)
        },
        Some(result @ PaymentAttemptResult::Failed { .. }) |
        Some(result @ PaymentAttemptResult::Skipped { .. }) |
        Some(result @ PaymentAttemptResult::LimitExceeded { .. }) => {
            error!("Payment failed: {:?}", result);
            PaymentResult::Failed(result)
        },
        None => {
            error!("execute_payment_if_needed returned None unexpectedly for non-zero price.");
            PaymentResult::Failed(PaymentAttemptResult::Skipped { 
                reason: "Internal payment logic error".to_string() 
            })
        }
    }
}

// Helper function to execute provider call (no payment)
fn execute_provider_call(
    our: &Address,
    state: &mut State,
    provider_details: &ProviderDetails,
    provider_name: String,
    arguments: Vec<(String, String)>,
    timestamp_start_ms: u128,
    call_args_json: String,
) -> anyhow::Result<()> {
    call_provider_and_handle_response(
        our,
        state,
        provider_details,
        provider_name,
        arguments,
        timestamp_start_ms,
        call_args_json,
        None, // No payment
    )
}

// Helper function to execute provider call with payment
fn execute_provider_call_with_payment(
    our: &Address,
    state: &mut State,
    provider_details: &ProviderDetails,
    provider_name: String,
    arguments: Vec<(String, String)>,
    timestamp_start_ms: u128,
    call_args_json: String,
    tx_hash: String,
) -> anyhow::Result<()> {
    call_provider_and_handle_response(
        our,
        state,
        provider_details,
        provider_name,
        arguments,
        timestamp_start_ms,
        call_args_json,
        Some(tx_hash),
    )
}

// Core function to call provider and handle response
fn call_provider_and_handle_response(
    our: &Address,
    state: &mut State,
    provider_details: &ProviderDetails,
    provider_name: String,
    arguments: Vec<(String, String)>,
    timestamp_start_ms: u128,
    call_args_json: String,
    payment_tx_hash: Option<String>,
) -> anyhow::Result<()> {
    // Prepare target address
    let target_address = Address::new(
        &provider_details.provider_id,
        ("hpn-provider", "hpn-provider", "template.os")
    );
    
    let payment_tx_hash_clone = payment_tx_hash.clone();
    
    // Prepare request
    info!("Preparing request for provider process at {}", target_address);
    let provider_request_data = ProviderRequest {
        provider_name,
        arguments,
        payment_tx_hash: payment_tx_hash_clone,
    };
    // Wrap the ProviderRequest data in a JSON structure that mimics the enum variant
    let wrapped_request = serde_json::json!({
        "CallProvider": provider_request_data
    });
    let request_body_bytes = serde_json::to_vec(&wrapped_request)?;
    
    // Send request
    info!("Sending request to provider at {}", target_address);
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
    
    let record = CallRecord {
        timestamp_start_ms,
        provider_lookup_key: provider_details.provider_id.clone(),
        target_provider_id: provider_details.provider_id.clone(),
        call_args_json,
        call_success,
        response_timestamp_ms,
        payment_result,
        duration_ms: response_timestamp_ms - timestamp_start_ms,
        operator_wallet_id: state.selected_wallet_id.clone(),
    };
    
    state.call_history.push(record);
    limit_call_history(state);
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



//
/// Handles POST request to /api/authorize-shim
/// Verifies user is authenticated, then writes their node name and auth token
/// to a configuration file for the hpn-shim to read.
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

    // Use .as_deref() to borrow &str from Option<String>
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

    info!("Using Node: {}, Token: [REDACTED] for config", node_name);

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
    let vfs_file_path = format!("/{}/tmp/hpn-shim-config.json", our.package_id());
    info!("Attempting to write shim config to VFS tmp path: {}", vfs_file_path);

    // Create/Open the file in VFS tmp and write
    match vfs::create_file(&vfs_file_path, None) {
        Ok(mut file) => {
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
/// HotWalletAuthorizedClient in state.
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
    
    // Generate Client ID
    let client_id = format!("hpn-beta-mcp-shim-{}", Uuid::new_v4().to_string());
    
    // Hash the received raw token (SHA-256 hex)
    let mut hasher = Sha256::new();
    hasher.update(request_data.raw_token.as_bytes());
    let hashed_token_hex = format!("{:x}", hasher.finalize());
    
    info!("Configure Client: Received raw token (hashed): {} for client ID: {}", hashed_token_hex, client_id);

    // Create HotWalletAuthorizedClient instance
    let new_client = HotWalletAuthorizedClient {
        id: client_id.clone(),
        name: request_data.client_name.unwrap_or_else(|| format!("Shim Client {}", client_id.chars().take(8).collect::<String>())),
        associated_hot_wallet_address: request_data.hot_wallet_address_to_associate,
        authentication_token: hashed_token_hex,
        capabilities: ServiceCapabilities::All, // Default to All capabilities for now
    };

    // Store the new client in state
    state.authorized_clients.insert(client_id.clone(), new_client);
    state.save(); // Persist the state change
    info!("Configure Client: Saved new authorized client to state. Client ID: {}", client_id);

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
    payment_result: PaymentAttemptResult
) {
    let record = CallRecord {
        timestamp_start_ms,
        provider_lookup_key: lookup_key,
        target_provider_id, // Use best guess ID passed in
        call_args_json,
        call_success: false, // Indicate call failed
        response_timestamp_ms: Utc::now().timestamp_millis() as u128,
        payment_result: Some(payment_result),
        duration_ms: Utc::now().timestamp_millis() as u128 - timestamp_start_ms,
        operator_wallet_id: state.selected_wallet_id.clone(),
    };
    state.call_history.push(record);
    limit_call_history(state);
    state.save(); 
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

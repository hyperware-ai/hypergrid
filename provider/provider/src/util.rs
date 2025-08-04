use crate::{EndpointDefinition, HttpMethod, ProviderRequest};
use crate::constants::USDC_BASE_ADDRESS;
use hyperware_app_common::hyperware_process_lib::kiprintln;
use hyperware_app_common::hyperware_process_lib::{
    eth::{Address as EthAddress, EthError, TransactionReceipt, TxHash, U256},
    get_blob,
    http::{
        client::{HttpClientAction, HttpClientError, HttpClientResponse, OutgoingHttpRequest},
        HeaderName, HeaderValue, Method as HyperwareHttpMethod, Response as HyperwareHttpResponse,
        StatusCode,
    },
    hypermap, Request,
};
use hyperware_app_common::{send, sleep};
use serde_json;
use std::collections::HashMap;
use std::str::FromStr;
use url::Url;

/// Make an HTTP request using http-client and await its response.
///
/// Returns HTTP response from the `http` crate if successful, with the body type as bytes.
pub async fn send_async_http_request(
    method: HyperwareHttpMethod,
    url: url::Url,
    headers: Option<HashMap<String, String>>,
    timeout: u64,
    body: Vec<u8>,
) -> std::result::Result<HyperwareHttpResponse<Vec<u8>>, HttpClientError> {
    let req = Request::to(("our", "http-client", "distro", "sys"))
        .expects_response(timeout)
        .body(
            serde_json::to_vec(&HttpClientAction::Http(OutgoingHttpRequest {
                method: method.to_string(),
                version: None,
                url: url.to_string(),
                headers: headers.unwrap_or_default(),
            }))
            .map_err(|_| HttpClientError::MalformedRequest)?,
        )
        .blob_bytes(body);

    let result_from_http_client =
        send::<std::result::Result<HttpClientResponse, HttpClientError>>(req).await;

    match result_from_http_client {
        Ok(Ok(HttpClientResponse::Http(resp_data))) => {
            let mut http_response = HyperwareHttpResponse::builder()
                .status(StatusCode::from_u16(resp_data.status).unwrap_or_default());
            let headers_map = http_response.headers_mut().unwrap();
            for (key, value) in &resp_data.headers {
                let Ok(key) = HeaderName::from_str(key) else {
                    continue;
                };
                let Ok(value) = HeaderValue::from_str(value) else {
                    continue;
                };
                headers_map.insert(key, value);
            }
            Ok(http_response
                .body(get_blob().unwrap_or_default().bytes)
                .unwrap())
        }
        Ok(Ok(HttpClientResponse::WebSocketAck)) => Err(HttpClientError::ExecuteRequestFailed(
            "http-client gave unexpected response".to_string(),
        )),
        Ok(Err(http_client_err)) => Err(http_client_err),
        Err(app_send_err) => Err(HttpClientError::ExecuteRequestFailed(format!(
            "http-client gave invalid response: {app_send_err:?}"
        ))),
    }
}

/// Retrieves the logs for a specific transaction hash on a given chain.
///
/// # Arguments
/// * `tx_hash_str` - The transaction hash as a hexadecimal string (e.g., "0x...").
/// * `state` - The state of the provider, containing the RPC provider.
pub async fn get_logs_for_tx(
    tx_hash_str: &String,
    state: &super::HypergridProviderState, // Use super:: to refer to HypergridProviderState from lib.rs
) -> Result<TransactionReceipt, EthError> {
    // 1. Instantiate the provider for the target chain
    let provider = &state.rpc_provider;

    // 2. Parse the transaction hash string into a TxHash type
    //    Ensure the input string starts with "0x" if required by FromStr implementation
    let tx_hash = TxHash::from_str(tx_hash_str.trim_start_matches("0x"))
        .map_err(|_| EthError::InvalidParams)?; // Return InvalidParams if hash format is wrong

    // 3. Retry mechanism for get_transaction_receipt
    const MAX_RETRIES: u32 = 3;
    const INITIAL_DELAY_MS: u64 = 500; // Start with 500ms
    
    for attempt in 1..=MAX_RETRIES {
        match provider.get_transaction_receipt(tx_hash) {
            Ok(Some(receipt)) => {
                kiprintln!(
                    "Found receipt for tx {} on attempt {}: Receipt: {:?}",
                    tx_hash_str,
                    attempt,
                    receipt
                );
                return Ok(receipt);
            }
            Ok(None) => {
                kiprintln!(
                    "Transaction receipt not found for tx {} on attempt {}/{}",
                    tx_hash_str,
                    attempt,
                    MAX_RETRIES
                );
                if attempt < MAX_RETRIES {
                    // Exponential backoff: 500ms, 1000ms, 2000ms, 4000ms
                    let delay_ms = INITIAL_DELAY_MS * (1 << (attempt - 1));
                    kiprintln!("Retrying in {}ms...", delay_ms);
                    // Sleep before retrying (using thread sleep as async sleep not available)
                    let _ = sleep(delay_ms).await;
                } else {
                    kiprintln!("Max retries reached for tx {}", tx_hash_str);
                    return Err(EthError::RpcTimeout);
                }
            }
            Err(e) => {
                eprintln!("Error fetching receipt for tx {} on attempt {}: {:?}", tx_hash_str, attempt, e);
                if attempt < MAX_RETRIES {
                    // Exponential backoff: 500ms, 1000ms, 2000ms, 4000ms
                    let delay_ms = INITIAL_DELAY_MS * (1 << (attempt - 1));
                    kiprintln!("Retrying in {}ms...", delay_ms);
                    // Sleep before retrying (using thread sleep as async sleep not available)
                    let _ = sleep(delay_ms).await;
                } else {
                    return Err(e); // Propagate the error after max retries
                }
            }
        }
    }
    
    // This should never be reached, but just in case
    Err(EthError::RpcTimeout)
}

// Moved call_provider function
pub async fn call_provider(
    provider_id_for_log: String,
    endpoint_def: EndpointDefinition, // This type needs to be available here
    dynamic_args: &Vec<(String, String)>,
    source: String,
) -> Result<String, String> {
    kiprintln!(
        "Calling provider via util: {}, endpoint: {}, structure: {:?}",
        provider_id_for_log,
        endpoint_def.name,
        endpoint_def.request_structure
    );

    let args_map: HashMap<String, String> = dynamic_args.iter().cloned().collect();

    // --- 1. Prepare Headers (API Key + General) ---
    let mut http_headers = HashMap::new();
    let mut api_key_in_header = false;
    if let (Some(header_name), Some(api_key_value)) =
        (&endpoint_def.api_key_header_name, &endpoint_def.api_key)
    {
        if !api_key_value.is_empty() && !header_name.is_empty() {
            http_headers.insert(header_name.clone(), api_key_value.clone());
            kiprintln!("API Key added to header: {}", header_name);
            api_key_in_header = true;
        }
    }
    if let Some(header_keys) = &endpoint_def.header_keys {
        for key in header_keys {
            if let Some(value) = args_map.get(key) {
                if !(api_key_in_header && endpoint_def.api_key_header_name.as_deref() == Some(key))
                {
                    http_headers.insert(key.clone(), value.clone());
                }
            } else {
                kiprintln!(
                    "Warning: Missing dynamic argument for header key: '{}'",
                    key
                );
            }
        }
    }

    http_headers.insert("X-Insecure-HPN-Client-Node-Id".to_string(), source);

    kiprintln!(
        "Prepared headers (before body processing): {:?}",
        http_headers
    );

    // --- 2. Process URL (Path Params, Query Params based on structure) ---
    let mut processed_url_template = endpoint_def.base_url_template.clone();
    let mut query_params_to_add: Vec<(String, String)> = Vec::new();
    let mut body_data = HashMap::new();

    match endpoint_def.request_structure {
        // Assuming RequestStructureType is also available via super:: or globally
        super::RequestStructureType::GetWithPath => {
            kiprintln!("Structure: GetWithPath - Processing path parameters.");
            if let Some(path_keys) = &endpoint_def.path_param_keys {
                for path_key in path_keys {
                    if let Some(value) = args_map.get(path_key) {
                        processed_url_template =
                            processed_url_template.replace(&format!("{{{}}}", path_key), value);
                    } else {
                        kiprintln!(
                            "Warning: Missing path parameter '{}' for URL template",
                            path_key
                        );
                    }
                }
            }
        }
        super::RequestStructureType::GetWithQuery => {
            kiprintln!("Structure: GetWithQuery - Processing query parameters.");
            if let Some(query_keys) = &endpoint_def.query_param_keys {
                for key in query_keys {
                    if let Some(value) = args_map.get(key) {
                        query_params_to_add.push((key.clone(), value.clone()));
                    } else {
                        kiprintln!("Warning: Missing dynamic argument for query key: '{}'", key);
                    }
                }
            }
        }
        super::RequestStructureType::PostWithJson => {
            kiprintln!("Structure: PostWithJson - Processing path, query, and body parameters.");
            if let Some(path_keys) = &endpoint_def.path_param_keys {
                for path_key in path_keys {
                    if let Some(value) = args_map.get(path_key) {
                        processed_url_template =
                            processed_url_template.replace(&format!("{{{}}}", path_key), value);
                    } else {
                        kiprintln!(
                            "Warning: Missing optional path parameter '{}' for POST URL template",
                            path_key
                        );
                    }
                }
            }
            if let Some(query_keys) = &endpoint_def.query_param_keys {
                for key in query_keys {
                    if let Some(value) = args_map.get(key) {
                        query_params_to_add.push((key.clone(), value.clone()));
                    } else {
                        kiprintln!(
                            "Warning: Missing optional dynamic argument for query key: '{}'",
                            key
                        );
                    }
                }
            }
            if let Some(body_keys) = &endpoint_def.body_param_keys {
                if !body_keys.is_empty() {
                    for key in body_keys {
                        if let Some(value) = args_map.get(key) {
                            body_data.insert(key.clone(), value.clone());
                        } else {
                            kiprintln!("Warning: Missing dynamic argument for body key: '{}'", key);
                        }
                    }
                    kiprintln!("Collected body data: {:?}", body_data.keys());
                } else {
                    kiprintln!("POST request configured with explicitly empty body_param_keys. No body generated from dynamic args.");
                }
            } else {
                kiprintln!("POST request configured without body_param_keys specified (Option is None). Body will be empty.");
            }
        }
    }

    // --- 3. Finalize URL with Query Params (including API Key if needed) ---
    let mut final_url = Url::parse(&processed_url_template).map_err(|e| {
        format!(
            "Invalid base URL template after path substitution: {} -> {}: {}",
            endpoint_def.base_url_template, processed_url_template, e
        )
    })?;

    {
        let mut query_pairs = final_url.query_pairs_mut();
        for (key, value) in query_params_to_add {
            query_pairs.append_pair(&key, &value);
        }
        if !api_key_in_header {
            if let (Some(param_name), Some(api_key_value)) = (
                &endpoint_def.api_key_query_param_name,
                &endpoint_def.api_key,
            ) {
                if !api_key_value.is_empty() && !param_name.is_empty() {
                    query_pairs.append_pair(param_name, api_key_value);
                    kiprintln!("API Key added to query parameter: {}", param_name);
                }
            }
        }
    }

    let final_url_str = final_url.to_string();
    kiprintln!("Final URL for call: {}", final_url_str);

    // --- 4. Finalize Body and Headers for POST ---
    let mut body_bytes: Vec<u8> = Vec::new();
    if endpoint_def.method == HttpMethod::POST {
        // HttpMethod also needs to be available
        if !body_data.is_empty() {
            http_headers.insert("Content-Type".to_string(), "application/json".to_string());
            kiprintln!("Added Content-Type: application/json header because POST body is present.");

            body_bytes = serde_json::to_vec(&body_data).map_err(|e| {
                format!(
                    "Failed to serialize POST body: {}. Data: {:?}",
                    e, body_data
                )
            })?;
            kiprintln!("POST Body Bytes Length: {}", body_bytes.len());
        } else {
            kiprintln!("POST request proceeding with empty body.");
        }
    }
    kiprintln!("Final Headers being sent: {:?}", http_headers);

    // --- 5. Determine HTTP Method ---
    let http_client_method = match endpoint_def.method {
        // HttpMethod
        HttpMethod::GET => HyperwareHttpMethod::GET,
        HttpMethod::POST => HyperwareHttpMethod::POST,
    };
    kiprintln!("HTTP Method for call: {:?}", http_client_method);

    // --- 6. Execute HTTP Request --- Reuses send_async_http_request from this file
    let timeout_seconds = 60;
    match send_async_http_request(
        http_client_method,
        final_url,
        Some(http_headers),
        timeout_seconds,
        body_bytes,
    )
    .await
    {
        Ok(response) => {
            let status = response.status().as_u16();
            let response_body_bytes = response.body().to_vec();
            let body_result = String::from_utf8(response_body_bytes)
                .map_err(|e| format!("Failed to parse response body as UTF-8: {}", e))?;
            
            // Try to parse the body as JSON to avoid double-encoding
            let body_json = match serde_json::from_str::<serde_json::Value>(&body_result) {
                Ok(json_value) => json_value,
                Err(_) => serde_json::Value::String(body_result), // If not JSON, wrap as string
            };
            
            let response_wrapper = serde_json::json!({
                "status": status,
                "body": body_json
            });
            
            Ok(response_wrapper.to_string())
        }
        Err(e) => {
            eprintln!(
                "API call failed for {}: {} - Error: {:?}",
                provider_id_for_log, endpoint_def.name, e
            );
            Err(format!("API call failed: {:?}", e))
        }
    }
}

// --- Function to Validate Transaction Payment ---
pub async fn validate_transaction_payment(
    mcp_request: &ProviderRequest,
    state: &mut super::HypergridProviderState, // Now mutable
    source_node_id: String,                    // Pass source node string directly
) -> Result<(), String> {
    // --- 0. Check if provider exists at all ---
    if !state
        .registered_providers
        .iter()
        .any(|p| p.provider_name == mcp_request.provider_name)
    {
        // we double-check for safety, but this validation already happened in the top-level function (call_provider)
        return Err(format!("Provider '{}' not found. This should never happen, contact Hyperware Discord for help.", mcp_request.provider_name));
    }

    // --- 1. Transaction Hash and Initial Validation ---
    let tx_hash_str_ref = mcp_request.payment_tx_hash.as_ref().ok_or_else(|| {
        format!(
            "No payment transaction hash provided for provider call to '{}'. Please make sure to provide a valid transaction hash.",
            mcp_request.provider_name
        )
    })?;

    // --- 2. Check if Transaction Hash has already been used ---
    if state.spent_tx_hashes.contains(tx_hash_str_ref) {
        return Err(format!(
            "Transaction hash {} has already been used. You request has been rejected.",
            tx_hash_str_ref
        ));
    }

    // --- 3. Fetch Transaction Receipt ---
    let transaction_receipt = match get_logs_for_tx(tx_hash_str_ref, state).await {
        Ok(r) => r,
        Err(e) => {
            return Err(format!(
                "Error fetching transaction receipt for {}: {:?}",
                tx_hash_str_ref, e
            ));
        }
    };

    // --- 4. Initial Transaction Validation (Recipient is Token Contract) ---
    let expected_token_contract_address = EthAddress::from_str(
        USDC_BASE_ADDRESS, // Example: USDC on Base
    )
    .map_err(|e| format!("Invalid expected token contract address format: {}", e))?;

    // let actual_tx_recipient = transaction_receipt.to.ok_or_else(|| {
    //     String::from("Transaction receipt does not contain a 'to' (recipient) address, expected token contract.")
    // })?;

    // if actual_tx_recipient != expected_token_contract_address {
    //     return Err(format!(
    //         "Transaction 'to' address is not the expected token contract. Got: {:?}, Expected: {:?}",
    //         actual_tx_recipient, expected_token_contract_address
    //     ));
    // }

    kiprintln!(
        "Transaction to field confirmed to be token contract {} for tx: {}",
        expected_token_contract_address,
        tx_hash_str_ref
    );

    // --- 5. Validate Event Log Data (Sender, Recipient, Amount) ---
    let registered_provider = state
        .registered_providers
        .iter()
        .find(|p| p.provider_name == mcp_request.provider_name)
        .ok_or_else(|| {
            format!(
                "Provider with name '{}' not found for payment validation.",
                mcp_request.provider_name
            )
        })?;

    let expected_provider_wallet_str = &registered_provider.registered_provider_wallet;
    let expected_provider_wallet = EthAddress::from_str(
        expected_provider_wallet_str.trim_start_matches("0x"),
    )
    .map_err(|e| {
        format!(
            "Invalid registered provider wallet address format '{}': {}",
            expected_provider_wallet_str, e
        )
    })?;

    let service_price_u256 = U256::from(registered_provider.price);
    let hypermap_instance = &state.hypermap;

    let mut payment_validated = false;
    let mut claimed_sender_address_from_log: Option<EthAddress> = None;
    let mut usdc_transfer_count = 0;

    // Access logs via transaction_receipt.inner (which is ReceiptEnvelope)
    for log in transaction_receipt.inner.logs() {
        // Check if the log is from the expected token contract
        if log.address() != expected_token_contract_address {
            kiprintln!(
                "Log from contract {:?} does not match expected token contract {:?}, skipping. Tx: {}",
                log.address(),
                expected_token_contract_address,
                tx_hash_str_ref
            );
            continue;
        }

        // Check if this is a Transfer event (topic 0 should be the Transfer event signature)
        let transfer_event_signature = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
        if log.topics().is_empty() || log.topics()[0].to_string() != transfer_event_signature {
            kiprintln!(
                "Log is not a Transfer event, skipping. Tx: {}",
                tx_hash_str_ref
            );
            continue;
        }

        usdc_transfer_count += 1;
        kiprintln!(
            "Found ERC20 Transfer event #{} for tx {}",
            usdc_transfer_count,
            tx_hash_str_ref
        );

        if log.topics().len() < 3 {
            kiprintln!(
                "Transfer event log does not have enough topics (expected 3, got {}). Tx: {}",
                log.topics().len(),
                tx_hash_str_ref
            );
            continue;
        }

        // Extract sender from topic 1
        let tx_sender: &[u8] = log.topics()[1].as_slice();
        // Topics representing addresses are 32 bytes, address is last 20 bytes.
        if tx_sender.len() != 32 {
            kiprintln!(
                "Sender topic (topic 1) has unexpected length: {}, expected 32. Tx: {}",
                tx_sender.len(),
                tx_hash_str_ref
            );
            continue;
        }
        let tx_sender_address = EthAddress::from_slice(&tx_sender[12..]);

        // Extract recipient from topic 2
        let tx_recipient: &[u8] = log.topics()[2].as_slice();
        if tx_recipient.len() != 32 {
            kiprintln!(
                "Recipient topic (topic 2) has unexpected length: {}, expected 32. Tx: {}",
                tx_recipient.len(),
                tx_hash_str_ref
            );
            continue;
        }
        let tx_recipient_address = EthAddress::from_slice(&tx_recipient[12..]);

        // We're looking for the second USDC Transfer log specifically
        if usdc_transfer_count == 2 {
            kiprintln!(
                "Processing second USDC Transfer event for tx {}: from={:?}, to={:?}",
                tx_hash_str_ref,
                tx_sender_address,
                tx_recipient_address
            );

            // Validate recipient is the provider's wallet
            if tx_recipient_address != expected_provider_wallet {
                kiprintln!(
                    "Second Transfer event recipient mismatch for tx {}. Expected: {:?}, Got: {:?}",
                    tx_hash_str_ref,
                    expected_provider_wallet,
                    tx_recipient_address
                );
                continue;
            }

            // Validate amount from log data
            if log.data().data.len() == 32 {
                let transferred_amount = U256::from_be_slice(log.data().data.as_ref());
                kiprintln!(
                    "Second Transfer event: from={:?}, to={:?}, amount={}",
                    tx_sender_address,
                    tx_recipient_address,
                    transferred_amount
                );

                if transferred_amount >= service_price_u256 {
                    kiprintln!(
                        "Payment amount validated via second ERC20 Transfer: {} tokens to {:?} from {:?} in tx {}",
                        transferred_amount,
                        tx_recipient_address,
                        tx_sender_address,
                        tx_hash_str_ref
                    );
                    // Sender address and recipient confirmed, amount is sufficient.
                    // Now store the sender for Hypermap check and mark payment as potentially valid.
                    claimed_sender_address_from_log = Some(tx_sender_address);
                    payment_validated = true; // Provisional validation, Hypermap check still pending
                    break; // Found the second valid transfer, no need to check other logs
                } else {
                    kiprintln!(
                        "Second Transfer event amount insufficient for tx {}. Expected >= {}, Got: {}",
                        tx_hash_str_ref,
                        service_price_u256,
                        transferred_amount
                    );
                    // Amount is insufficient, this is the wrong transfer
                    continue;
                }
            } else {
                kiprintln!(
                    "Second Transfer event data field has unexpected length for tx {}. Expected 32 bytes for U256, got {}.",
                    tx_hash_str_ref, log.data().data.len()
                );
            }
        } else {
            kiprintln!(
                "Skipping USDC Transfer event #{} (not the second one) for tx {}",
                usdc_transfer_count,
                tx_hash_str_ref
            );
        }
    }

    if !payment_validated || claimed_sender_address_from_log.is_none() {
        return Err(format!(
            "Failed to find a valid second ERC20 transfer event to provider wallet {:?} for at least {} tokens from contract {:?} in tx {}. Please ensure the transaction sent the correct amount of USDC to the provider's wallet from your Hypermap-linked TBA.",
            expected_provider_wallet, service_price_u256, expected_token_contract_address, tx_hash_str_ref
        ));
    }

    let final_claimed_sender_address = claimed_sender_address_from_log.unwrap(); // Safe due to check above

    // --- 6. Verify Request Sender against Transaction Sender (from log) via Hypermap TBA ---
    let namehash_from_claimed_sender_tba = match hypermap_instance.get_namehash_from_tba(final_claimed_sender_address) {
        Ok(namehash) => namehash,
        Err(e) => return Err(format!("Error fetching namehash for transaction sender ({} from log). Ensure it's a valid HNS entry TBA. Error: {:?}", final_claimed_sender_address, e)),
    };

    let full_name_for_tba_lookup = format!("grid-wallet.{}", source_node_id);
    let expected_namehash_for_requester = hypermap::namehash(&full_name_for_tba_lookup);

    if namehash_from_claimed_sender_tba != expected_namehash_for_requester {
        return Err(format!("Namehash mismatch for TBA: sender identified from log as {} (namehash: {}), but request came from {} (expected namehash: {}). Sender identity could not be verified.", 
                          final_claimed_sender_address, namehash_from_claimed_sender_tba,
                          source_node_id, expected_namehash_for_requester));
    }
    kiprintln!(
        "Hypermap TBA sender verification passed for tx {}: Log sender {} matches requester {}",
        tx_hash_str_ref,
        final_claimed_sender_address,
        source_node_id
    );

    // --- 7. Mark Transaction as Spent ---
    // This must be the last step after all validations pass.

    state.spent_tx_hashes.push(tx_hash_str_ref.to_string());
    
    kiprintln!(
        "Successfully validated payment and marked tx {} as spent.",
        tx_hash_str_ref
    );

    Ok(())
}

pub fn default_provider() -> hyperware_app_common::hyperware_process_lib::eth::Provider {
    let hypermap_timeout = 60;
    hyperware_app_common::hyperware_process_lib::eth::Provider::new(
        hypermap::HYPERMAP_CHAIN_ID,
        hypermap_timeout,
    )
}

pub fn default_hypermap() -> hypermap::Hypermap {
    let hypermap_timeout = 60;
    let provider = hyperware_app_common::hyperware_process_lib::eth::Provider::new(
        hypermap::HYPERMAP_CHAIN_ID,
        hypermap_timeout,
    );
    let hypermap_contract_address = EthAddress::from_str(hypermap::HYPERMAP_ADDRESS)
        .expect("HYPERMAP_ADDRESS const should be a valid Ethereum address");
    hypermap::Hypermap::new(provider, hypermap_contract_address)
}

pub fn validate_response_status(response: &str) -> Result<(), String> {
    let parsed = serde_json::from_str::<serde_json::Value>(response)
        .map_err(|e| format!("Failed to parse response: {}", e))?;
    if let Some(status) = parsed.get("status").and_then(|s| s.as_u64()) {
        if status == 200 {
            Ok(())
        } else {
            Err(format!("Invalid status code in response: {}", status))
        }
    } else {
        Err(format!("No status code found in response"))
    }
}

//use crate::{EndpointDefinition, HttpMethod, ProviderRequest};
//use hyperware_app_common::hyperware_process_lib::kiprintln;
//use hyperware_app_common::hyperware_process_lib::{
//    eth::{Address as EthAddress, EthError, TransactionReceipt, TxHash, U256},
//    get_blob,
//    http::{
//        client::{HttpClientAction, HttpClientError, HttpClientResponse, OutgoingHttpRequest},
//        HeaderName, HeaderValue, Method as HyperwareHttpMethod, Response as HyperwareHttpResponse,
//        StatusCode,
//    },
//    hypermap, Message, Request,
//};
//use hyperware_app_common::send;
//use serde_json;
//use std::collections::HashMap;
//use std::str::FromStr;
//use url::Url;
//
///// Make an HTTP request using http-client and await its response.
/////
///// Returns HTTP response from the `http` crate if successful, with the body type as bytes.
//pub async fn send_async_http_request(
//    method: HyperwareHttpMethod,
//    url: url::Url,
//    headers: Option<HashMap<String, String>>,
//    timeout: u64,
//    body: Vec<u8>,
//) -> std::result::Result<HyperwareHttpResponse<Vec<u8>>, HttpClientError> {
//    let req = Request::to(("our", "http-client", "distro", "sys"))
//        .expects_response(timeout)
//        .body(
//            serde_json::to_vec(&HttpClientAction::Http(OutgoingHttpRequest {
//                method: method.to_string(),
//                version: None,
//                url: url.to_string(),
//                headers: headers.unwrap_or_default(),
//            }))
//            .map_err(|_| HttpClientError::MalformedRequest)?,
//        )
//        .blob_bytes(body);
//
//    let result_from_http_client = send::<std::result::Result<HttpClientResponse, HttpClientError>>(req).await;
//
//    match result_from_http_client {
//        Ok(Ok(HttpClientResponse::Http(resp_data))) => {
//            let mut http_response = HyperwareHttpResponse::builder()
//                .status(StatusCode::from_u16(resp_data.status).unwrap_or_default());
//            let headers_map = http_response.headers_mut().unwrap();
//            for (key, value) in &resp_data.headers {
//                let Ok(key) = HeaderName::from_str(key) else {
//                    continue;
//                };
//                let Ok(value) = HeaderValue::from_str(value) else {
//                    continue;
//                };
//                headers_map.insert(key, value);
//            }
//            Ok(http_response
//                .body(get_blob().unwrap_or_default().bytes)
//                .unwrap())
//        }
//        Ok(Ok(HttpClientResponse::WebSocketAck)) => {
//            Err(HttpClientError::ExecuteRequestFailed(
//                "http-client gave unexpected response".to_string(),
//            ))
//        }
//        Ok(Err(http_client_err)) => Err(http_client_err),
//        Err(app_send_err) => {
//            Err(HttpClientError::ExecuteRequestFailed(format!(
//                "http-client gave invalid response: {app_send_err:?}"
//            )))
//        }
//    }
//}
//
///// Retrieves the logs for a specific transaction hash on a given chain.
/////
///// # Arguments
///// * `tx_hash_str` - The transaction hash as a hexadecimal string (e.g., "0x...").
///// * `state` - The state of the provider, containing the RPC provider.
//pub async fn get_logs_for_tx(
//    tx_hash_str: &String,
//    state: &super::HypergridProviderState, // Use super:: to refer to HypergridProviderState from lib.rs
//) -> Result<TransactionReceipt, EthError> {
//    // 1. Instantiate the provider for the target chain
//    let provider = &state.rpc_provider;
//
//    // 2. Parse the transaction hash string into a TxHash type
//    //    Ensure the input string starts with "0x" if required by FromStr implementation
//    let tx_hash = TxHash::from_str(tx_hash_str.trim_start_matches("0x"))
//        .map_err(|_| EthError::InvalidParams)?; // Return InvalidParams if hash format is wrong
//
//    // 3. Call get_transaction_receipt
//    match provider.get_transaction_receipt(tx_hash) {
//        Ok(Some(receipt)) => {
//            kiprintln!(
//                "Found receipt for tx {}: Receipt: {:?}",
//                tx_hash_str,
//                receipt
//            );
//            Ok(receipt)
//        }
//        Ok(None) => {
//            kiprintln!("Transaction receipt not found for tx {}", tx_hash_str);
//            Err(EthError::RpcTimeout) // Consider a more specific error or Option<TransactionReceipt>
//        }
//        Err(e) => {
//            eprintln!("Error fetching receipt for tx {}: {:?}", tx_hash_str, e);
//            Err(e) // Propagate the error
//        }
//    }
//}
//
//// Moved call_provider function
//pub async fn call_provider(
//    provider_id_for_log: String,
//    endpoint_def: EndpointDefinition, // This type needs to be available here
//    dynamic_args: &Vec<(String, String)>,
//    source: String,
//) -> Result<String, String> {
//    kiprintln!(
//        "Calling provider via util: {}, endpoint: {}, structure: {:?}",
//        provider_id_for_log,
//        endpoint_def.name,
//        endpoint_def.request_structure
//    );
//
//    let args_map: HashMap<String, String> = dynamic_args.iter().cloned().collect();
//
//    // --- 1. Prepare Headers (API Key + General) ---
//    let mut http_headers = HashMap::new();
//    let mut api_key_in_header = false;
//    if let (Some(header_name), Some(api_key_value)) =
//        (&endpoint_def.api_key_header_name, &endpoint_def.api_key)
//    {
//        if !api_key_value.is_empty() && !header_name.is_empty() {
//            http_headers.insert(header_name.clone(), api_key_value.clone());
//            kiprintln!("API Key added to header: {}", header_name);
//            api_key_in_header = true;
//        }
//    }
//    if let Some(header_keys) = &endpoint_def.header_keys {
//        for key in header_keys {
//            if let Some(value) = args_map.get(key) {
//                if !(api_key_in_header && endpoint_def.api_key_header_name.as_deref() == Some(key))
//                {
//                    http_headers.insert(key.clone(), value.clone());
//                }
//            } else {
//                kiprintln!(
//                    "Warning: Missing dynamic argument for header key: '{}'",
//                    key
//                );
//            }
//        }
//    }
//
//    http_headers.insert("X-Insecure-HPN-Client-Node-Id".to_string(), source);
//
//
//    kiprintln!(
//        "Prepared headers (before body processing): {:?}",
//        http_headers
//    );
//
//    // --- 2. Process URL (Path Params, Query Params based on structure) ---
//    let mut processed_url_template = endpoint_def.base_url_template.clone();
//    let mut query_params_to_add: Vec<(String, String)> = Vec::new();
//    let mut body_data = HashMap::new();
//
//    match endpoint_def.request_structure {
//        // Assuming RequestStructureType is also available via super:: or globally
//        super::RequestStructureType::GetWithPath => {
//            kiprintln!("Structure: GetWithPath - Processing path parameters.");
//            if let Some(path_keys) = &endpoint_def.path_param_keys {
//                for path_key in path_keys {
//                    if let Some(value) = args_map.get(path_key) {
//                        processed_url_template =
//                            processed_url_template.replace(&format!("{{{}}}", path_key), value);
//                    } else {
//                        kiprintln!(
//                            "Warning: Missing path parameter '{}' for URL template",
//                            path_key
//                        );
//                    }
//                }
//            }
//        }
//        super::RequestStructureType::GetWithQuery => {
//            kiprintln!("Structure: GetWithQuery - Processing query parameters.");
//            if let Some(query_keys) = &endpoint_def.query_param_keys {
//                for key in query_keys {
//                    if let Some(value) = args_map.get(key) {
//                        query_params_to_add.push((key.clone(), value.clone()));
//                    } else {
//                        kiprintln!("Warning: Missing dynamic argument for query key: '{}'", key);
//                    }
//                }
//            }
//        }
//        super::RequestStructureType::PostWithJson => {
//            kiprintln!("Structure: PostWithJson - Processing path, query, and body parameters.");
//            if let Some(path_keys) = &endpoint_def.path_param_keys {
//                for path_key in path_keys {
//                    if let Some(value) = args_map.get(path_key) {
//                        processed_url_template =
//                            processed_url_template.replace(&format!("{{{}}}", path_key), value);
//                    } else {
//                        kiprintln!(
//                            "Warning: Missing optional path parameter '{}' for POST URL template",
//                            path_key
//                        );
//                    }
//                }
//            }
//            if let Some(query_keys) = &endpoint_def.query_param_keys {
//                for key in query_keys {
//                    if let Some(value) = args_map.get(key) {
//                        query_params_to_add.push((key.clone(), value.clone()));
//                    } else {
//                        kiprintln!(
//                            "Warning: Missing optional dynamic argument for query key: '{}'",
//                            key
//                        );
//                    }
//                }
//            }
//            if let Some(body_keys) = &endpoint_def.body_param_keys {
//                if !body_keys.is_empty() {
//                    for key in body_keys {
//                        if let Some(value) = args_map.get(key) {
//                            body_data.insert(key.clone(), value.clone());
//                        } else {
//                            kiprintln!("Warning: Missing dynamic argument for body key: '{}'", key);
//                        }
//                    }
//                    kiprintln!("Collected body data: {:?}", body_data.keys());
//                } else {
//                    kiprintln!("POST request configured with explicitly empty body_param_keys. No body generated from dynamic args.");
//                }
//            } else {
//                kiprintln!("POST request configured without body_param_keys specified (Option is None). Body will be empty.");
//            }
//        }
//    }
//
//    // --- 3. Finalize URL with Query Params (including API Key if needed) ---
//    let mut final_url = Url::parse(&processed_url_template).map_err(|e| {
//        format!(
//            "Invalid base URL template after path substitution: {} -> {}: {}",
//            endpoint_def.base_url_template, processed_url_template, e
//        )
//    })?;
//
//    {
//        let mut query_pairs = final_url.query_pairs_mut();
//        for (key, value) in query_params_to_add {
//            query_pairs.append_pair(&key, &value);
//        }
//        if !api_key_in_header {
//            if let (Some(param_name), Some(api_key_value)) = (
//                &endpoint_def.api_key_query_param_name,
//                &endpoint_def.api_key,
//            ) {
//                if !api_key_value.is_empty() && !param_name.is_empty() {
//                    query_pairs.append_pair(param_name, api_key_value);
//                    kiprintln!("API Key added to query parameter: {}", param_name);
//                }
//            }
//        }
//    }
//
//    let final_url_str = final_url.to_string();
//    kiprintln!("Final URL for call: {}", final_url_str);
//
//    // --- 4. Finalize Body and Headers for POST ---
//    let mut body_bytes: Vec<u8> = Vec::new();
//    if endpoint_def.method == HttpMethod::POST {
//        // HttpMethod also needs to be available
//        if !body_data.is_empty() {
//            http_headers.insert("Content-Type".to_string(), "application/json".to_string());
//            kiprintln!("Added Content-Type: application/json header because POST body is present.");
//
//            body_bytes = serde_json::to_vec(&body_data).map_err(|e| {
//                format!(
//                    "Failed to serialize POST body: {}. Data: {:?}",
//                    e, body_data
//                )
//            })?;
//            kiprintln!("POST Body Bytes Length: {}", body_bytes.len());
//        } else {
//            kiprintln!("POST request proceeding with empty body.");
//        }
//    }
//    kiprintln!("Final Headers being sent: {:?}", http_headers);
//
//    // --- 5. Determine HTTP Method ---
//    let http_client_method = match endpoint_def.method {
//        // HttpMethod
//        HttpMethod::GET => HyperwareHttpMethod::GET,
//        HttpMethod::POST => HyperwareHttpMethod::POST,
//    };
//    kiprintln!("HTTP Method for call: {:?}", http_client_method);
//
//    // --- 6. Execute HTTP Request --- Reuses send_async_http_request from this file
//    let timeout_seconds = 60;
//    match send_async_http_request(
//        http_client_method,
//        final_url,
//        Some(http_headers),
//        timeout_seconds,
//        body_bytes,
//    )
//    .await
//    {
//        Ok(response) => {
//            let status = response.status();
//            let response_body_bytes = response.body().to_vec();
//            let body_result = String::from_utf8(response_body_bytes)
//                .map_err(|e| format!("Failed to parse response body as UTF-8: {}", e))?;
//            Ok(format!(
//                "{{\"status\":{},\"body\":{}}}",
//                status,
//                serde_json::to_string(&body_result)
//                    .unwrap_or_else(|_| format!("\"{}\"", body_result))
//            ))
//        }
//        Err(e) => {
//            eprintln!(
//                "API call failed for {}: {} - Error: {:?}",
//                provider_id_for_log, endpoint_def.name, e
//            );
//            Err(format!("API call failed: {:?}", e))
//        }
//    }
//}
//
//// --- Function to Validate Transaction Payment ---
//pub async fn validate_transaction_payment(
//    mcp_request: &ProviderRequest,
//    state: &mut super::HypergridProviderState, // Now mutable
//    source_node_id: String,              // Pass source node string directly
//) -> Result<(), String> {
//    // --- 0. Check if provider exists at all ---
//    if !state
//        .registered_providers
//        .iter()
//        .any(|p| p.provider_name == mcp_request.provider_name)
//    {
//        // we double-check for safety, but this validation already happened in the top-level function (call_provider)
//        return Err(format!("Provider '{}' not found. This should never happen, contact Hyperware Discord for help.", mcp_request.provider_name));
//    }
//
//    // --- 1. Transaction Hash and Initial Validation ---
//    let tx_hash_str_ref = mcp_request.payment_tx_hash.as_ref().ok_or_else(|| {
//        format!(
//            "No payment transaction hash provided for provider call to '{}'. Please make sure to provide a valid transaction hash.",
//            mcp_request.provider_name
//        )
//    })?;
//
//    // --- 2. Check if Transaction Hash has already been used ---
//    if state.spent_tx_hashes.contains(tx_hash_str_ref) {
//        return Err(format!(
//            "Transaction hash {} has already been used. You request has been rejected.",
//            tx_hash_str_ref
//        ));
//    }
//
//    // --- 3. Fetch Transaction Receipt ---
//    let transaction_receipt = match get_logs_for_tx(tx_hash_str_ref, state).await {
//        Ok(r) => r,
//        Err(e) => {
//            return Err(format!(
//                "Error fetching transaction receipt for {}: {:?}",
//                tx_hash_str_ref, e
//            ));
//        }
//    };
//
//    // --- 4. Initial Transaction Validation (Recipient is Token Contract) ---
//    let expected_token_contract_address = EthAddress::from_str(
//        "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", // Example: USDC on Base
//    )
//    .map_err(|e| format!("Invalid expected token contract address format: {}", e))?;
//
//    // let actual_tx_recipient = transaction_receipt.to.ok_or_else(|| {
//    //     String::from("Transaction receipt does not contain a 'to' (recipient) address, expected token contract.")
//    // })?;
//
//    // if actual_tx_recipient != expected_token_contract_address {
//    //     return Err(format!(
//    //         "Transaction 'to' address is not the expected token contract. Got: {:?}, Expected: {:?}",
//    //         actual_tx_recipient, expected_token_contract_address
//    //     ));
//    // }
//
//    kiprintln!(
//        "Transaction to field confirmed to be token contract {} for tx: {}",
//        expected_token_contract_address,
//        tx_hash_str_ref
//    );
//
//    // --- 5. Validate Event Log Data (Sender, Recipient, Amount) ---
//    let registered_provider = state
//        .registered_providers
//        .iter()
//        .find(|p| p.provider_name == mcp_request.provider_name)
//        .ok_or_else(|| {
//            format!(
//                "Provider with name '{}' not found for payment validation.",
//                mcp_request.provider_name
//            )
//        })?;
//
//    let expected_provider_wallet_str = &registered_provider.registered_provider_wallet;
//    let expected_provider_wallet = EthAddress::from_str(
//        expected_provider_wallet_str.trim_start_matches("0x"),
//    )
//    .map_err(|e| {
//        format!(
//            "Invalid registered provider wallet address format '{}': {}",
//            expected_provider_wallet_str, e
//        )
//    })?;
//
//    let service_price_u256 = U256::from(registered_provider.price);
//    let hypermap_instance = &state.hypermap;
//
//    let mut payment_validated = false;
//    let mut claimed_sender_address_from_log: Option<EthAddress> = None;
//
//    // Access logs via transaction_receipt.inner (which is ReceiptEnvelope)
//    for log in transaction_receipt.inner.logs() {
//        // Check if the log is from the expected token contract
//        if log.address() != expected_token_contract_address {
//            kiprintln!(
//                "Log from contract {:?} does not match expected token contract {:?}, skipping. Tx: {}",
//                log.address(),
//                expected_token_contract_address,
//                tx_hash_str_ref
//            );
//            continue;
//        }
//
//        if log.topics().len() < 3 {
//            kiprintln!(
//                "Transfer event log does not have enough topics (expected 3, got {}). Tx: {}",
//                log.topics().len(),
//                tx_hash_str_ref
//            );
//            continue;
//        }
//
//        // Extract sender from topic 1
//        let tx_sender: &[u8] = log.topics()[1].as_slice();
//        // Topics representing addresses are 32 bytes, address is last 20 bytes.
//        if tx_sender.len() != 32 {
//            kiprintln!("Sender topic (topic 1) has unexpected length: {}, expected 32. Tx: {}", tx_sender.len(), tx_hash_str_ref);
//            continue;
//        }
//        let tx_sender_address = EthAddress::from_slice(&tx_sender[12..]);
//
//        // Extract recipient from topic 2
//        let tx_recipient: &[u8] = log.topics()[2].as_slice();
//        if tx_recipient.len() != 32 {
//            kiprintln!("Recipient topic (topic 2) has unexpected length: {}, expected 32. Tx: {}", tx_recipient.len(), tx_hash_str_ref);
//            continue;
//        }
//        let tx_recipient_address = EthAddress::from_slice(&tx_recipient[12..]);
//
//        // Validate recipient is the provider's wallet
//        if tx_recipient_address != expected_provider_wallet {
//            kiprintln!(
//                "Transfer event recipient mismatch for tx {}. Expected: {:?}, Got from log topic 2: {:?}",
//                tx_hash_str_ref,
//                expected_provider_wallet,
//                tx_recipient_address
//            );
//            continue;
//        }
//
//        // Validate amount from log data
//        if log.data().data.len() == 32 {
//            let transferred_amount = U256::from_be_slice(log.data().data.as_ref());
//            kiprintln!(
//                "Found Transfer event: from={:?}, to={:?}, amount={}",
//                tx_sender_address,
//                tx_recipient_address,
//                transferred_amount
//            );
//
//            if transferred_amount >= service_price_u256 {
//                kiprintln!(
//                    "Payment amount validated via ERC20 Transfer: {} tokens to {:?} from {:?} in tx {}",
//                    transferred_amount, // Use actual transferred amount for logging
//                    tx_recipient_address,
//                    tx_sender_address,
//                    tx_hash_str_ref
//                );
//                // Sender address and recipient confirmed, amount is sufficient.
//                // Now store the sender for Hypermap check and mark payment as potentially valid.
//                    claimed_sender_address_from_log = Some(tx_sender_address);
//                payment_validated = true; // Provisional validation, Hypermap check still pending
//                break; // Found a valid transfer, no need to check other logs
//            } else {
//                kiprintln!(
//                    "Transfer event amount insufficient for tx {}. Expected >= {}, Got: {}",
//                    tx_hash_str_ref,
//                    service_price_u256,
//                    transferred_amount
//                );
//                // If amount is insufficient, continue to check other logs, maybe there's another transfer.
//                // However, usually there's only one relevant transfer. If this one is insufficient,
//                // it's likely the payment is invalid. For now, we'll let it try other logs.
//            }
//        } else {
//            kiprintln!(
//                "Transfer event data field has unexpected length for tx {}. Expected 32 bytes for U256, got {}.",
//                tx_hash_str_ref, log.data().data.len()
//            );
//        }
//    }
//
//    if !payment_validated || claimed_sender_address_from_log.is_none() {
//        return Err(format!(
//            "Failed to find a valid ERC20 transfer event to provider wallet {:?} for at least {} tokens from contract {:?} in tx {}. Please ensure the transaction sent the correct amount of USDC to the provider's wallet from your HNS-linked TBA.",
//            expected_provider_wallet, service_price_u256, expected_token_contract_address, tx_hash_str_ref
//        ));
//    }
//
//    let final_claimed_sender_address = claimed_sender_address_from_log.unwrap(); // Safe due to check above
//
//    // --- 6. Verify Request Sender against Transaction Sender (from log) via Hypermap TBA ---
//    let namehash_from_claimed_sender_tba = match hypermap_instance.get_namehash_from_tba(final_claimed_sender_address) {
//        Ok(namehash) => namehash,
//        Err(e) => return Err(format!("Error fetching namehash for transaction sender ({} from log). Ensure it's a valid HNS entry TBA. Error: {:?}", final_claimed_sender_address, e)),
//    };
//
//    let full_name_for_tba_lookup = format!("grid-beta-wallet.{}", source_node_id);
//    let expected_namehash_for_requester = hypermap::namehash(&full_name_for_tba_lookup);
//
//    if namehash_from_claimed_sender_tba != expected_namehash_for_requester {
//        return Err(format!("Namehash mismatch for TBA: sender identified from log as {} (namehash: {}), but request came from {} (expected namehash: {}). Sender identity could not be verified.",
//                          final_claimed_sender_address, namehash_from_claimed_sender_tba,
//                          source_node_id, expected_namehash_for_requester));
//    }
//    kiprintln!(
//        "Hypermap TBA sender verification passed for tx {}: Log sender {} matches requester {}",
//        tx_hash_str_ref,
//        final_claimed_sender_address,
//        source_node_id
//    );
//
//    // --- 7. Mark Transaction as Spent ---
//    // This must be the last step after all validations pass.
//    state.spent_tx_hashes.push(tx_hash_str_ref.to_string());
//    kiprintln!("Successfully validated payment and marked tx {} as spent.", tx_hash_str_ref);
//
//    Ok(())
//}
//

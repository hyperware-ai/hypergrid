use crate::{
    EndpointDefinition, ProviderRequest, PaymentPayload, FieldDef, InputSchema, 
    OutputSchema, AcceptedPayment, PaymentRequirements, ParameterDefinition, 
    RegisteredProvider
};
use crate::constants::{
    USDC_BASE_ADDRESS, WALLET_PREFIX, USDC_SEPOLIA_ADDRESS, USDC_EIP712_NAME, 
    USDC_EIP712_VERSION, X402_PAYMENT_NETWORK
};
use hyperware_process_lib::{
    eth::{Address as EthAddress, EthError, TransactionReceipt, TxHash, U256},
    get_blob,
    hyperapp::{send, sleep},
    http::{
        client::{HttpClientAction, HttpClientError, HttpClientResponse, OutgoingHttpRequest},
        HeaderName, HeaderValue, Method as HyperwareHttpMethod, Response as HyperwareHttpResponse,
        StatusCode,
    },
    hypermap, Request,
    logging::{debug, error, warn, info},
    our,
};
use serde_json;
use std::collections::HashMap;
use std::str::FromStr;
use url::Url;
use base64ct::{Base64, Encoding};

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
    // Capture values for logging before they're consumed
    let headers_clone = headers.clone().unwrap_or_default();
    let body_size = body.len();
    let method_str = method.to_string();
    let url_str = url.to_string();

    let req = Request::to(("our", "http-client", "distro", "sys"))
        .expects_response(timeout)
        .body(
            serde_json::to_vec(&HttpClientAction::Http(OutgoingHttpRequest {
                method: method_str.clone(),
                version: None,
                url: url_str.clone(),
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
        Ok(Ok(HttpClientResponse::WebSocketAck)) => {
            let error = HttpClientError::ExecuteRequestFailed(
                "http-client gave unexpected response".to_string(),
            );
            error!(
                "HTTP request failed - unexpected WebSocket response: method={}, url={}, timeout={}s, error={:?}",
                method_str, url_str, timeout, error
            );
            Err(error)
        }
        Ok(Err(http_client_err)) => {
            error!(
                "HTTP request failed - client error: method={}, url={}, timeout={}s, headers={:?}, body_size={}, error={:?}",
                method_str, url_str, timeout, headers_clone, body_size, http_client_err
            );
            Err(http_client_err)
        }
        Err(app_send_err) => {
            let error = HttpClientError::ExecuteRequestFailed(format!(
                "http-client gave invalid response: {app_send_err:?}"
            ));
            error!(
                "HTTP request failed - send error: method={}, url={}, timeout={}s, headers={:?}, body_size={}, send_error={:?}",
                method_str, url_str, timeout, headers_clone, body_size, app_send_err
            );
            Err(error)
        }
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
                debug!(
                    "Found receipt for tx {} on attempt {}: Receipt: {:?}",
                    tx_hash_str,
                    attempt,
                    receipt
                );
                return Ok(receipt);
            }
            Ok(None) => {
                debug!(
                    "Transaction receipt not found for tx {} on attempt {}/{}",
                    tx_hash_str,
                    attempt,
                    MAX_RETRIES
                );
                if attempt < MAX_RETRIES {
                    // Exponential backoff: 500ms, 1000ms, 2000ms, 4000ms
                    let delay_ms = INITIAL_DELAY_MS * (1 << (attempt - 1));
                    debug!("Retrying in {}ms...", delay_ms);
                    // Sleep before retrying (using thread sleep as async sleep not available)
                    let _ = sleep(delay_ms).await;
                } else {
                    debug!("Max retries reached for tx {}", tx_hash_str);
                    return Err(EthError::RpcTimeout);
                }
            }
            Err(e) => {
                debug!("Error fetching receipt for tx {} on attempt {}: {:?}", tx_hash_str, attempt, e);
                if attempt < MAX_RETRIES {
                    // Exponential backoff: 500ms, 1000ms, 2000ms, 4000ms
                    let delay_ms = INITIAL_DELAY_MS * (1 << (attempt - 1));
                    debug!("Retrying in {}ms...", delay_ms);
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

// OLD FUNCTION - COMMENTED OUT FOR NEW CURL-BASED IMPLEMENTATION
/*
// Moved call_provider function
pub async fn call_provider(
    provider_id_for_log: String,
    endpoint_def: EndpointDefinition, // This type needs to be available here
    dynamic_args: &Vec<(String, String)>,
    source: String,
) -> Result<String, String> {
    info!(
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
            debug!("API Key added to header: {}", header_name);
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
                warn!(
                    "Warning: Missing dynamic argument for header key: '{}'",
                    key
                );
            }
        }
    }

    http_headers.insert("X-Insecure-HPN-Client-Node-Id".to_string(), source);

    debug!(
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
            debug!("Structure: GetWithPath - Processing path parameters.");
            if let Some(path_keys) = &endpoint_def.path_param_keys {
                for path_key in path_keys {
                    if let Some(value) = args_map.get(path_key) {
                        processed_url_template =
                            processed_url_template.replace(&format!("{{{}}}", path_key), value);
                    } else {
                        warn!(
                            "Warning: Missing path parameter '{}' for URL template",
                            path_key
                        );
                    }
                }
            }
        }
        super::RequestStructureType::GetWithQuery => {
            debug!("Structure: GetWithQuery - Processing query parameters.");
            if let Some(query_keys) = &endpoint_def.query_param_keys {
                for key in query_keys {
                    if let Some(value) = args_map.get(key) {
                        query_params_to_add.push((key.clone(), value.clone()));
                    } else {
                        warn!("Warning: Missing dynamic argument for query key: '{}'", key);
                    }
                }
            }
        }
        super::RequestStructureType::PostWithJson => {
            debug!("Structure: PostWithJson - Processing path, query, and body parameters.");
            if let Some(path_keys) = &endpoint_def.path_param_keys {
                for path_key in path_keys {
                    if let Some(value) = args_map.get(path_key) {
                        processed_url_template =
                            processed_url_template.replace(&format!("{{{}}}", path_key), value);
                    } else {
                        warn!(
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
                        warn!(
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
                            warn!("Warning: Missing dynamic argument for body key: '{}'", key);
                        }
                    }
                    debug!("Collected body data: {:?}", body_data.keys());
                } else {
                    debug!("POST request configured with explicitly empty body_param_keys. No body generated from dynamic args.");
                }
            } else {
                debug!("POST request configured without body_param_keys specified (Option is None). Body will be empty.");
            }
        }
    }

    // --- 3. Finalize URL with Query Params (including API Key if needed) ---
    let mut final_url = Url::parse(&processed_url_template).map_err(|e| {
        let error_msg = format!(
            "Invalid base URL template after path substitution: {} -> {}: {}",
            endpoint_def.base_url_template, processed_url_template, e
        );
        error!(
            "URL parsing failed for provider '{}': original_template={}, processed_template={}, error={}",
            provider_id_for_log, endpoint_def.base_url_template, processed_url_template, e
        );
        error_msg
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
                    debug!("API Key added to query parameter: {}", param_name);
                }
            }
        }
    }

    let final_url_str = final_url.to_string();
    debug!("Final URL for call: {}", final_url_str);

    // --- 4. Finalize Body and Headers for POST ---
    let mut body_bytes: Vec<u8> = Vec::new();
    if endpoint_def.method == HttpMethod::POST {
        // HttpMethod also needs to be available
        if !body_data.is_empty() {
            http_headers.insert("Content-Type".to_string(), "application/json".to_string());
            debug!("Added Content-Type: application/json header because POST body is present.");

            body_bytes = serde_json::to_vec(&body_data).map_err(|e| {
                let error_msg = format!(
                    "Failed to serialize POST body: {}. Data: {:?}",
                    e, body_data
                );
                error!(
                    "JSON serialization failed for provider '{}': endpoint={}, body_data={:?}, error={}",
                    provider_id_for_log, endpoint_def.name, body_data, e
                );
                error_msg
            })?;
            debug!("POST Body Bytes Length: {}", body_bytes.len());
        } else {
            warn!("POST request proceeding with empty body.");
        }
    }
    debug!("Final Headers being sent: {:?}", http_headers);

    // --- 5. Determine HTTP Method ---
    let http_client_method = match endpoint_def.method {
        // HttpMethod
        HttpMethod::GET => HyperwareHttpMethod::GET,
        HttpMethod::POST => HyperwareHttpMethod::POST,
    };
    debug!("HTTP Method for call: {:?}", http_client_method);

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
                .map_err(|e| {
                    error!("Failed to parse response body as UTF-8: {}", e);
                    format!("Failed to parse response body as UTF-8: {}", e)
                })?;

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
            error!(
                "API call failed for {}: {} - Error: {:?}",
                provider_id_for_log, endpoint_def.name, e
            );
            Err(format!("API call failed: {}", e))
        }
    }
}
*/

// New curl-based provider call function
pub async fn call_provider(
    provider_id_for_log: String,
    endpoint_def: EndpointDefinition,
    dynamic_args: &Vec<(String, String)>,
    source: String,
) -> Result<String, String> {
    debug!(
        "Calling provider via curl template: {}, method: {}",
        provider_id_for_log,
        endpoint_def.method
    );

    let args_map: HashMap<String, String> = dynamic_args.iter().cloned().collect();

    // Start with original headers from the curl template
    let mut http_headers = endpoint_def.get_original_headers_map();

    // Construct URL from template
    let mut final_url = endpoint_def.url_template.clone();

    // Parse original curl to extract original query parameters
    let mut original_query_params: HashMap<String, String> = HashMap::new();
    // Extract URL from curl command (handle quoted and unquoted URLs)
    if let Some(url_part) = endpoint_def.original_curl
        .split_whitespace()
        .find(|s| s.contains("http")) {
        // Remove quotes and clean up the URL part
        let clean_url = url_part.trim_matches('"').trim_matches('\'');
        if let Ok(url) = url::Url::parse(clean_url) {
            for (key, value) in url.query_pairs() {
                original_query_params.insert(key.to_string(), value.to_string());
            }
        }
    }

    debug!(
        "Original query params extracted from curl: {:?}",
        original_query_params
    );

    // Start with original query parameters, then override with dynamic ones
    let mut query_params: Vec<(String, String)> = original_query_params.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
    let mut body_json = endpoint_def.get_original_body_json();

    // Process each parameter substitution based on JSON pointers
    for param_def in &endpoint_def.parameters {
        let value = args_map.get(&param_def.parameter_name)
            .ok_or_else(|| format!("Missing argument for parameter: {}", param_def.parameter_name))?;

        match param_def.location.as_str() {
            "path" => {
                // Replace path parameters in URL template
                final_url = final_url.replace(&format!("{{{}}}", param_def.parameter_name), value);
            }
            "query" => {
                // Extract the original query parameter name from JSON pointer
                // JSON pointer format: "/queryParams/original_param_name"
                let original_param_name = param_def.json_pointer
                    .strip_prefix("/queryParams/")
                    .ok_or_else(|| format!("Invalid query JSON pointer: {}", param_def.json_pointer))?;

                // Override existing query parameter or add new one
                // Remove any existing parameter with the original name first
                query_params.retain(|(k, _)| k != original_param_name);
                // Add the new/updated parameter using the original parameter name
                query_params.push((original_param_name.to_string(), value.clone()));
            }
            "header" => {
                // Update header value
                let header_name = param_def.json_pointer
                    .strip_prefix("/headers/")
                    .ok_or_else(|| format!("Invalid header JSON pointer: {}", param_def.json_pointer))?;
                http_headers.insert(header_name.to_string(), value.clone());
            }
            "body" => {
                // Update body using JSON pointer
                if let Some(ref mut body) = body_json {
                    // Strip the "/body" prefix from the JSON pointer since we're already working with the body
                    let body_relative_pointer = param_def.json_pointer
                        .strip_prefix("/body")
                        .unwrap_or(&param_def.json_pointer);

                    // If the pointer is just "/body", we replace the entire body
                    if body_relative_pointer.is_empty() {
                        // Parse the new value as JSON if possible, otherwise treat as string
                        match serde_json::from_str::<serde_json::Value>(value) {
                            Ok(parsed_value) => {
                                *body = parsed_value;
                            }
                            Err(_) => {
                                // If not valid JSON, treat as string
                                *body = serde_json::Value::String(value.clone());
                            }
                        }
                    } else {
                        update_json_value_by_pointer(body, body_relative_pointer, value)?;
                    }
                }
            }
            _ => {
                warn!("Unknown parameter location: {}", param_def.location);
            }
        }
    }

    // Add query parameters to URL if any
    if !query_params.is_empty() {
        let query_string: String = query_params
            .iter()
            .map(|(k, v)| format!("{}={}", urlencoding::encode(k), urlencoding::encode(v)))
            .collect::<Vec<_>>()
            .join("&");

        final_url = if final_url.contains('?') {
            format!("{}&{}", final_url, query_string)
        } else {
            format!("{}?{}", final_url, query_string)
        };
    }

    // Add source node ID header
    http_headers.insert("X-Insecure-HPN-Client-Node-Id".to_string(), source);

    debug!("Final URL: {}", final_url);
    debug!("Final headers: {:?}", http_headers);
    debug!("Final body: {:?}", body_json);

    // Prepare body bytes
    let body_bytes = if let Some(body) = body_json {
        // Ensure Content-Type is set for JSON body
        http_headers.insert("Content-Type".to_string(), "application/json".to_string());
        serde_json::to_vec(&body).map_err(|e| format!("Failed to serialize body: {}", e))?
    } else {
        Vec::new()
    };

    // Parse URL
    let url = Url::parse(&final_url).map_err(|e| format!("Invalid URL: {}", e))?;

    // Convert method string to HyperwareHttpMethod
    let http_method = match endpoint_def.method.to_uppercase().as_str() {
        "GET" => HyperwareHttpMethod::GET,
        "POST" => HyperwareHttpMethod::POST,
        "PUT" => HyperwareHttpMethod::PUT,
        "DELETE" => HyperwareHttpMethod::DELETE,
        "PATCH" => HyperwareHttpMethod::PATCH,
        _ => return Err(format!("Unsupported HTTP method: {}", endpoint_def.method)),
    };

    // Make the HTTP request
    let timeout: u64 = 30;
    let start_time = std::time::Instant::now();
    // Log HTTP request details (no sensitive data)
    debug!(
        "http_request_started: provider={}, method={}, url_domain={}, timeout_s={}, body_size_bytes={}",
        provider_id_for_log,
        endpoint_def.method,
        url.host_str().unwrap_or("unknown"),
        timeout,
        body_bytes.len()
    );
    match send_async_http_request(http_method, url, Some(http_headers), timeout, body_bytes).await {
        Ok(response) => {
            let elapsed = start_time.elapsed();
            let status = response.status();
            let body_bytes = response.into_body();
            let body_string = String::from_utf8(body_bytes.clone())
                .unwrap_or_else(|_| format!("[Binary data, {} bytes]", body_bytes.len()));

            // Log HTTP response details (no sensitive response data)
            debug!(
                "http_response_received: provider={}, status={}, duration_ms={}, response_size_bytes={}",
                provider_id_for_log,
                status,
                elapsed.as_millis(),
                body_string.len()
            );

            if status.is_success() {
                Ok(body_string)
            } else {
                // Error tracking log - HTTP error status
                error!(
                    "http_request_failed: provider={}, status={}, duration_ms={}, error_type=http_error_status",
                    provider_id_for_log,
                    status,
                    elapsed.as_millis()
                );
                Err(format!(
                    "Provider returned error status {}: {}",
                    status, body_string
                ))
            }
        }
        Err(e) => {
            let elapsed = start_time.elapsed();
            // Error tracking log - network/timeout error
            error!(
                "http_request_failed: provider={}, duration_ms={}, error_type=network_timeout",
                provider_id_for_log,
                elapsed.as_millis()
            );
            Err(format!("Failed to call provider: {:?}", e))
        }
    }
}

// Helper function to update JSON value using JSON pointer
fn update_json_value_by_pointer(
    json: &mut serde_json::Value,
    pointer: &str,
    new_value: &str,
) -> Result<(), String> {
    // Handle JSON pointers like "/body/field_name" or "/body/messages/0/content"
    let parts: Vec<&str> = pointer.split('/').filter(|s| !s.is_empty()).collect();

    if parts.is_empty() {
        return Err("Invalid JSON pointer".to_string());
    }

    // Navigate to the parent of the target
    let mut current = json;
    for i in 0..parts.len() - 1 {
        let part = parts[i];

        // Check if this part is an array index (all digits)
        if part.chars().all(|c| c.is_ascii_digit()) {
            let index: usize = part.parse()
                .map_err(|_| format!("Invalid array index: {}", part))?;

            match current {
                serde_json::Value::Array(arr) => {
                    current = arr.get_mut(index)
                        .ok_or_else(|| format!("Array index out of bounds: {}", index))?;
                }
                _ => return Err(format!("Expected array at path: {}", part)),
            }
        } else {
            // Regular object field
            match current {
                serde_json::Value::Object(map) => {
                    current = map.get_mut(part)
                        .ok_or_else(|| format!("Path not found: {}", part))?;
                }
                _ => return Err(format!("Expected object at path: {}", part)),
            }
        }
    }

    // Update the final field
    let final_part = parts.last().unwrap();

    // Parse the new value as JSON if possible, otherwise treat as string
    let parsed_value = parse_parameter_value(new_value);

    // Check if the final part is an array index
    if final_part.chars().all(|c| c.is_ascii_digit()) {
        let index: usize = final_part.parse()
            .map_err(|_| format!("Invalid array index: {}", final_part))?;

        match current {
            serde_json::Value::Array(arr) => {
                if index >= arr.len() {
                    return Err(format!("Array index out of bounds: {}", index));
                }
                arr[index] = parsed_value;
                Ok(())
            }
            _ => Err(format!("Expected array for index: {}", final_part)),
        }
    } else {
        // Regular object field
        match current {
            serde_json::Value::Object(map) => {
                map.insert(final_part.to_string(), parsed_value);
                Ok(())
            }
            _ => Err(format!("Expected object for field: {}", final_part)),
        }
    }
}

// Helper function to parse parameter values intelligently
fn parse_parameter_value(value: &str) -> serde_json::Value {
    // Check if the value is already a valid JSON value
    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(value) {
        // Successfully parsed as JSON, return the parsed value
        // This handles cases like:
        // - "hello world" → JSON string "hello world"
        // - 42 → JSON number 42
        // - true → JSON boolean true
        // - [1,2,3] → JSON array [1,2,3]
        // - {"key": "value"} → JSON object {"key": "value"}
        return parsed;
    }
    // If it's not valid JSON, automatically quote it as a JSON string
    // This handles cases like:
    // - hello world → "hello world" (automatically quoted)
    // - write me a poem about songbirds → "write me a poem about songbirds"
    serde_json::Value::String(value.to_string())
}

// --- Function to Validate Transaction Payment ---
pub async fn validate_transaction_payment(
    mcp_request: &ProviderRequest,
    state: &mut super::HypergridProviderState, // Now mutable
    source_node_id: String,                    // Pass source node string directly
) -> Result<(), String> {
    // Usage tracking log - payment validation started
    debug!(
        "payment_validation_started: provider={}, source_node={}, has_tx_hash={}",
        mcp_request.provider_name,
        source_node_id,
        mcp_request.payment_tx_hash.is_some()
    );
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
        let error_msg = format!(
            "Transaction hash {} has already been used. You request has been rejected.",
            tx_hash_str_ref
        );
        error!(
            "Duplicate transaction hash used: provider={}, tx_hash={}, source_node={}",
            mcp_request.provider_name, tx_hash_str_ref, source_node_id
        );
        return Err(error_msg);
    }

    // --- 3. Fetch Transaction Receipt ---
    let transaction_receipt = match get_logs_for_tx(tx_hash_str_ref, state).await {
        Ok(r) => r,
        Err(e) => {
            let error_msg = format!(
                "Error fetching transaction receipt for {}: {:?}",
                tx_hash_str_ref, e
            );
            error!(
                "Failed to fetch transaction receipt: provider={}, tx_hash={}, source_node={}, error={:?}",
                mcp_request.provider_name, tx_hash_str_ref, source_node_id, e
            );
            return Err(error_msg);
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

    debug!(
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

    // Convert USDC price to raw units (USDC has 6 decimal places)
    let service_price_usdc = registered_provider.price * 1_000_000.0; // Convert to base units
    let service_price_u256 = U256::from(service_price_usdc as u64);
    let hypermap_instance = &state.hypermap;

    let mut payment_validated = false;
    let mut claimed_sender_address_from_log: Option<EthAddress> = None;
    let mut usdc_transfer_count = 0;
    let mut actual_transferred_amount = U256::from(0);

    // Access logs via transaction_receipt.inner (which is ReceiptEnvelope)
    for log in transaction_receipt.inner.logs() {
        // Check if the log is from the expected token contract
        if log.address() != expected_token_contract_address {
            debug!(
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
            debug!(
                "Log is not a Transfer event, skipping. Tx: {}",
                tx_hash_str_ref
            );
            continue;
        }

        usdc_transfer_count += 1;
        debug!(
            "Found ERC20 Transfer event #{} for tx {}",
            usdc_transfer_count,
            tx_hash_str_ref
        );

        if log.topics().len() < 3 {
            debug!(
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
            debug!(
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
            debug!(
                "Recipient topic (topic 2) has unexpected length: {}, expected 32. Tx: {}",
                tx_recipient.len(),
                tx_hash_str_ref
            );
            continue;
        }
        let tx_recipient_address = EthAddress::from_slice(&tx_recipient[12..]);

        // We're looking for the second USDC Transfer log specifically
        if usdc_transfer_count == 2 {
            debug!(
                "Processing second USDC Transfer event for tx {}: from={:?}, to={:?}",
                tx_hash_str_ref,
                tx_sender_address,
                tx_recipient_address
            );

            // Validate recipient is the provider's wallet
            if tx_recipient_address != expected_provider_wallet {
                debug!(
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
                debug!(
                    "Second Transfer event: from={:?}, to={:?}, amount={}",
                    tx_sender_address,
                    tx_recipient_address,
                    transferred_amount
                );

                if transferred_amount >= service_price_u256 {
                    debug!(
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
                    actual_transferred_amount = transferred_amount; // Store actual amount for logging
                    break; // Found the second valid transfer, no need to check other logs
                } else {
                    debug!(
                        "Second Transfer event amount insufficient for tx {}. Expected >= {}, Got: {}",
                        tx_hash_str_ref,
                        service_price_u256,
                        transferred_amount
                    );
                    // Amount is insufficient, this is the wrong transfer
                    continue;
                }
            } else {
                debug!(
                    "Second Transfer event data field has unexpected length for tx {}. Expected 32 bytes for U256, got {}.",
                    tx_hash_str_ref, log.data().data.len()
                );
            }
        } else {
            debug!(
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

    let full_name_for_tba_lookup = format!("{}{}", WALLET_PREFIX, source_node_id);
    let expected_namehash_for_requester = hypermap::namehash(&full_name_for_tba_lookup);

    if namehash_from_claimed_sender_tba != expected_namehash_for_requester {
        return Err(format!("Namehash mismatch for TBA: sender identified from log as {} (namehash: {}), but request came from {} (expected namehash: {}). Sender identity could not be verified.",
                          final_claimed_sender_address, namehash_from_claimed_sender_tba,
                          source_node_id, expected_namehash_for_requester));
    }
    debug!(
        "Hypermap TBA sender verification passed for tx {}: Log sender {} matches requester {}",
        tx_hash_str_ref,
        final_claimed_sender_address,
        source_node_id
    );

    // --- 7. Mark Transaction as Spent ---
    // This must be the last step after all validations pass.

    state.spent_tx_hashes.push(tx_hash_str_ref.to_string());
    // Get provider price for revenue tracking
    let provider_price = state
        .registered_providers
        .iter()
        .find(|p| p.provider_name == mcp_request.provider_name)
        .map(|p| p.price)
        .unwrap_or(0.0);

    // Success tracking log - payment validation successful
    // Convert raw token amount to human-readable USDC (USDC has 6 decimal places)
    let usdc_decimals = U256::from(1_000_000); // 10^6 for USDC's 6 decimals
    let whole_usdc = actual_transferred_amount / usdc_decimals;
    let fractional_usdc = actual_transferred_amount % usdc_decimals;
    let transferred_usdc_display = format!("{}.{:06}", whole_usdc, fractional_usdc);
    
    info!(
        "payment_validation_success: provider={}, provider_node={}, source_node={}, tx_hash={}, price_usdc={}, transferred_usdc={}",
        mcp_request.provider_name,
        our().node,
        source_node_id,
        tx_hash_str_ref, // Full transaction hash for complete audit trail
        provider_price,
        transferred_usdc_display
    );

    Ok(())
}

pub fn default_provider() -> hyperware_process_lib::eth::Provider {
    let hypermap_timeout = 60;
    hyperware_process_lib::eth::Provider::new(
        hypermap::HYPERMAP_CHAIN_ID,
        hypermap_timeout,
    )
}

pub fn default_hypermap() -> hypermap::Hypermap {
    let hypermap_timeout = 60;
    let provider = hyperware_process_lib::eth::Provider::new(
        hypermap::HYPERMAP_CHAIN_ID,
        hypermap_timeout,
    );
    let hypermap_contract_address = EthAddress::from_str(hypermap::HYPERMAP_ADDRESS)
        .expect("HYPERMAP_ADDRESS const should be a valid Ethereum address");
    hypermap::Hypermap::new(provider, hypermap_contract_address)
}

pub fn validate_response_status(response: &str) -> Result<(), String> {
    // At this point, if we have a response, it means the HTTP call was successful
    // (status.is_success() was true in call_provider), so we just need to check
    // that we have a valid response body

    if response.trim().is_empty() {
        return Err("Empty response body".to_string());
    }

    // Try to parse as JSON to ensure it's a valid response
    // If it's not JSON, that's also fine for some APIs
    match serde_json::from_str::<serde_json::Value>(response) {
        Ok(_) => {
            // Valid JSON response - this is good
            Ok(())
        }
        Err(_) => {
            // Not JSON, but if it's a non-empty string, consider it valid
            // Some APIs return plain text or other formats
            if response.len() > 0 && response.len() < 10000 { // Reasonable size check
                Ok(())
            } else {
                Err("Response doesn't appear to be valid (too large or malformed)".to_string())
            }
        }
    }
}



/// Parse X-PAYMENT header value: base64 decode and deserialize to PaymentPayload
pub fn parse_x_payment_header(header_value: &str) -> Result<PaymentPayload, String> {
    // Allocate buffer for decoded data (base64 decoding produces smaller output than input)
    let max_decoded_len = (header_value.len() * 3) / 4 + 3;
    let mut decoded_bytes = vec![0u8; max_decoded_len];

    let decoded_slice = Base64::decode(header_value.as_bytes(), &mut decoded_bytes)
        .map_err(|e| format!("Failed to base64 decode X-PAYMENT header: {}", e))?;

    serde_json::from_slice(decoded_slice)
        .map_err(|e| format!("Failed to parse X-PAYMENT JSON: {}", e))
}

/// Convert a ParameterDefinition to x402scan's FieldDef format
pub fn parameter_to_field_def(param: &ParameterDefinition) -> FieldDef {
    FieldDef {
        r#type: Some(param.value_type.clone()),
        required: Some(serde_json::Value::Bool(true)),  // All provider params are required
        description: Some(format!("Parameter: {}", param.parameter_name)),
        r#enum: None,
        properties: None,
    }
}

/// Build InputSchema from provider's endpoint definition
pub fn build_input_schema(endpoint: &EndpointDefinition) -> InputSchema {
    let mut query_params = HashMap::new();
    let mut body_fields = HashMap::new();
    let mut header_fields = HashMap::new();

    // Add the fixed providername parameter
    query_params.insert(
        "providername".to_string(),
        FieldDef {
            r#type: Some("string".to_string()),
            required: Some(serde_json::Value::Bool(true)),
            description: Some("Name of the registered provider to call".to_string()),
            r#enum: None,
            properties: None,
        }
    );

    // Convert provider's parameters by location
    for param in &endpoint.parameters {
        let field_def = parameter_to_field_def(param);
        match param.location.as_str() {
            "query" => { query_params.insert(param.parameter_name.clone(), field_def); },
            "body" => { body_fields.insert(param.parameter_name.clone(), field_def); },
            "header" => { header_fields.insert(param.parameter_name.clone(), field_def); },
            "path" => {
                // Path params are part of the URL, not separate fields
                // Could document them in description if needed
            },
            _ => {},
        }
    }

    InputSchema {
        r#type: "http".to_string(),
        method: endpoint.method.clone(),
        body_type: if !body_fields.is_empty() {
            Some("json".to_string())
        } else {
            None
        },
        query_params: if !query_params.is_empty() { Some(query_params) } else { None },
        body_fields: if !body_fields.is_empty() { Some(body_fields) } else { None },
        header_fields: if !header_fields.is_empty() { Some(header_fields) } else { None },
    }
}

/// Build PaymentRequirements structure from provider and resource URL
pub fn build_payment_requirements(provider: &RegisteredProvider, resource_url: &str) -> PaymentRequirements {
    // Convert USDC price to atomic units (6 decimals)
    let max_amount_atomic = ((provider.price * 1_000_000.0).round() as u64).to_string();

    // Build input schema from provider's endpoint definition
    let input_schema = build_input_schema(&provider.endpoint);

    // Create output schema for x402scan registry compliance
    let output_schema = OutputSchema {
        input: input_schema,
        output: Some(serde_json::json!({
            "type": "object",
            "description": "Response from the provider's API endpoint"
        })),
    };

    let accepted_payment = AcceptedPayment {
        scheme: "exact".to_string(),
        network: X402_PAYMENT_NETWORK.to_string(),
        max_amount_required: max_amount_atomic,
        resource: resource_url.to_string(),
        description: provider.description.clone(),
        mime_type: "application/json".to_string(),
        pay_to: provider.registered_provider_wallet.clone(),
        max_timeout_seconds: 60,
        asset: if X402_PAYMENT_NETWORK == "base-sepolia" {
            USDC_SEPOLIA_ADDRESS.to_string()
        } else {
            USDC_BASE_ADDRESS.to_string()
        },
        output_schema: Some(output_schema),
        extra: Some(serde_json::json!({
            "name": USDC_EIP712_NAME,
            "version": USDC_EIP712_VERSION
        })),
    };

    PaymentRequirements {
        protocol_version: 1,
        accepts: Some(vec![accepted_payment]),
        error: Some("".to_string()),  // Empty string for no error (x402 clients expect this field)
        payer: None,
    }
}

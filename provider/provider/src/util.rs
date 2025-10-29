use crate::{
<<<<<<< HEAD
    EndpointDefinition, PaymentPayload, FieldDef, InputSchema, 
=======
    EndpointDefinition, ProviderCall, PaymentPayload, FieldDef, InputSchema, 
>>>>>>> ef91391 (fixed some kit WIT-ification errors)
    OutputSchema, AcceptedPayment, PaymentRequirements, ParameterDefinition, 
    RegisteredProvider
};
use crate::constants::{
    USDC_BASE_ADDRESS, USDC_SEPOLIA_ADDRESS, USDC_EIP712_NAME, 
    USDC_EIP712_VERSION, X402_PAYMENT_NETWORK
};
use hyperware_process_lib::{
    eth::{Address as EthAddress},
    get_blob,
    hyperapp::send,
    http::{
        client::{HttpClientAction, HttpClientError, HttpClientResponse, OutgoingHttpRequest},
        HeaderName, HeaderValue, Method as HyperwareHttpMethod, Response as HyperwareHttpResponse,
        StatusCode,
    },
    hypermap, Request,
    logging::{debug, error, warn},
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

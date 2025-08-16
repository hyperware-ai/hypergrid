use hyperware_app_common::hyperware_process_lib::{
    http::{
        client::{HttpClientError},
        Method as HyperwareHttpMethod,
        Response as HyperwareHttpResponse,
    },
    logging::{debug, error, info},
};
use regex::Regex;
use std::collections::HashMap;
use url::Url;

use crate::util::send_async_http_request;

#[derive(Debug, Clone)]
pub struct ParsedCurl {
    pub method: HyperwareHttpMethod,
    pub url: Url,
    pub headers: HashMap<String, String>,
    pub body: Vec<u8>,
}

/// Parse a curl command into its components
pub fn parse_curl_command(curl_command: &str) -> Result<ParsedCurl, String> {
    debug!("Parsing curl command: {}", curl_command);
    
    // Extract method (-X or --request)
    let method_regex = Regex::new(r"(?i)-X\s+([A-Z]+)|--request\s+([A-Z]+)")
        .map_err(|e| format!("Failed to compile method regex: {}", e))?;
    
    let method = if let Some(captures) = method_regex.captures(curl_command) {
        let method_str = captures.get(1)
            .or(captures.get(2))
            .map(|m| m.as_str())
            .unwrap_or("GET");
        
        match method_str.to_uppercase().as_str() {
            "GET" => HyperwareHttpMethod::GET,
            "POST" => HyperwareHttpMethod::POST,
            "PUT" => HyperwareHttpMethod::PUT,
            "DELETE" => HyperwareHttpMethod::DELETE,
            "PATCH" => HyperwareHttpMethod::PATCH,
            "HEAD" => HyperwareHttpMethod::HEAD,
            _ => return Err(format!("Unsupported HTTP method: {}", method_str)),
        }
    } else if curl_command.contains("-d ") || curl_command.contains("--data") {
        // If no explicit method but has data, assume POST
        HyperwareHttpMethod::POST
    } else {
        HyperwareHttpMethod::GET
    };
    
    // Extract headers (-H or --header)
    let header_regex = Regex::new(r#"(?i)(?:-H|--header)\s+["']([^"']+)["']"#)
        .map_err(|e| format!("Failed to compile header regex: {}", e))?;
    
    let mut headers = HashMap::new();
    for captures in header_regex.captures_iter(curl_command) {
        if let Some(header_str) = captures.get(1) {
            let header_content = header_str.as_str();
            if let Some(colon_pos) = header_content.find(':') {
                let key = header_content[..colon_pos].trim().to_string();
                let value = header_content[colon_pos + 1..].trim().to_string();
                headers.insert(key, value);
            }
        }
    }
    
    // Extract body/data (-d or --data)
    let data_regex = Regex::new(r#"(?i)(?:-d|--data)\s+(?:["']([^"']+)["']|([^\s]+))"#)
        .map_err(|e| format!("Failed to compile data regex: {}", e))?;
    
    let body = if let Some(captures) = data_regex.captures(curl_command) {
        let data_str = captures.get(1)
            .or(captures.get(2))
            .map(|m| m.as_str())
            .unwrap_or("");
        data_str.as_bytes().to_vec()
    } else {
        Vec::new()
    };
    
    // Extract URL (typically the last non-flag argument)
    // First try to find URL in quotes
    let url_quoted_regex = Regex::new(r#"["']([^"']*(?:https?://|/)[^"']*)["']"#)
        .map_err(|e| format!("Failed to compile URL quoted regex: {}", e))?;
    
    // Then try without quotes
    let url_unquoted_regex = Regex::new(r"(https?://[^\s]+)")
        .map_err(|e| format!("Failed to compile URL unquoted regex: {}", e))?;
    
    let url_str = if let Some(captures) = url_quoted_regex.captures(curl_command) {
        captures.get(1).map(|m| m.as_str()).unwrap_or("")
    } else if let Some(captures) = url_unquoted_regex.captures(curl_command) {
        captures.get(1).map(|m| m.as_str()).unwrap_or("")
    } else {
        return Err("No URL found in curl command".to_string());
    };
    
    let url = Url::parse(url_str)
        .map_err(|e| format!("Failed to parse URL '{}': {}", url_str, e))?;
    
    Ok(ParsedCurl {
        method,
        url,
        headers,
        body,
    })
}

/// Execute a curl template with variable substitution
pub async fn execute_curl_template(
    template: &str,
    arguments: &Vec<(String, String)>,
) -> Result<String, String> {
    info!("Executing curl template with {} arguments", arguments.len());
    
    // Step 1: Variable substitution
    let mut curl_command = template.to_string();
    for (key, value) in arguments {
        let placeholder = format!("{{{{{}}}}}", key);
        debug!("Replacing {} with value", placeholder);
        curl_command = curl_command.replace(&placeholder, value);
    }
    
    // Check for any remaining placeholders
    let remaining_placeholder_regex = Regex::new(r"\{\{[^}]+\}\}")
        .map_err(|e| format!("Failed to compile placeholder regex: {}", e))?;
    
    if remaining_placeholder_regex.is_match(&curl_command) {
        let missing_vars: Vec<String> = remaining_placeholder_regex
            .find_iter(&curl_command)
            .map(|m| m.as_str().to_string())
            .collect();
        return Err(format!(
            "Missing values for variables: {}",
            missing_vars.join(", ")
        ));
    }
    
    // Step 2: Parse curl command
    let parsed = parse_curl_command(&curl_command)?;
    
    debug!(
        "Parsed curl - Method: {:?}, URL: {}, Headers: {:?}, Body size: {}",
        parsed.method,
        parsed.url,
        parsed.headers,
        parsed.body.len()
    );
    
    // Step 3: Execute using existing HTTP client
    let response = send_async_http_request(
        parsed.method,
        parsed.url,
        Some(parsed.headers),
        60,
        parsed.body,
    )
    .await
    .map_err(|e| format!("HTTP request failed: {:?}", e))?;
    
    // Step 4: Format response
    format_response(response)
}

/// Format HTTP response into a string
pub fn format_response(response: HyperwareHttpResponse<Vec<u8>>) -> Result<String, String> {
    let status = response.status();
    let body_bytes = response.into_body();
    
    // Try to convert body to string
    let body_str = String::from_utf8(body_bytes.clone())
        .unwrap_or_else(|_| {
            // If not valid UTF-8, return base64 encoded
            format!("[Binary data, {} bytes]", body_bytes.len())
        });
    
    if status.is_success() {
        Ok(body_str)
    } else {
        Err(format!(
            "HTTP request failed with status {}: {}",
            status.as_u16(),
            body_str
        ))
    }
}
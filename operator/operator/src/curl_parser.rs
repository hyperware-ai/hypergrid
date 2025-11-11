// === cURL Parsing Helper Functions ===

use serde_json;
use url;

#[derive(Debug, Clone)]
pub struct ParsedCurlRequest {
    pub method: String,
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: Option<serde_json::Value>,
    pub base_url: String,
    pub path_segments: Vec<String>,
    pub query_params: Vec<(String, String)>,
}

#[derive(Debug, Clone)]
pub struct ModifiableField {
    pub parameter_name: String,
    pub json_pointer: String,
    pub location: String, // "path", "query", "header", "body"
    pub example_value: String,
    pub value_type: String,
}

/// Simple cURL parser - extracts method, URL, headers, and body
pub fn parse_curl_command(curl: &str) -> Result<ParsedCurlRequest, String> {
    let curl = curl.trim();
    
    // Extract method (default to GET if not specified)
    let method = if curl.contains("-X POST") || curl.contains("--request POST") {
        "POST".to_string()
    } else if curl.contains("-X PUT") || curl.contains("--request PUT") {
        "PUT".to_string()
    } else if curl.contains("-X DELETE") || curl.contains("--request DELETE") {
        "DELETE".to_string()
    } else if curl.contains("-X PATCH") || curl.contains("--request PATCH") {
        "PATCH".to_string()
    } else {
        "GET".to_string()
    };
    
    // Extract URL - find first occurrence of http:// or https://
    let url_start = curl.find("http://").or_else(|| curl.find("https://"))
        .ok_or_else(|| "No URL found in cURL command".to_string())?;
    
    let url_part = &curl[url_start..];
    let url_end = url_part.find(|c: char| c == '\'' || c == '"' || c == ' ')
        .unwrap_or(url_part.len());
    let url = url_part[..url_end].trim_matches(|c| c == '\'' || c == '"').to_string();
    
    // Parse URL components
    let parsed_url = url::Url::parse(&url).map_err(|e| format!("Invalid URL: {}", e))?;
    let base_url = format!("{}://{}", parsed_url.scheme(), parsed_url.host_str().unwrap_or(""));
    let path_segments: Vec<String> = parsed_url.path()
        .split('/')
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect();
    let query_params: Vec<(String, String)> = parsed_url.query_pairs()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();
    
    // Extract headers - simple pattern matching
    let mut headers = Vec::new();
    for line in curl.lines() {
        let line = line.trim();
        if line.starts_with("-H ") || line.starts_with("--header ") {
            // Extract header from patterns like: -H 'Key: Value' or -H "Key: Value"
            if let Some(header_start) = line.find('\'').or_else(|| line.find('"')) {
                let quote_char = line.chars().nth(header_start).unwrap();
                if let Some(header_end) = line[header_start + 1..].find(quote_char) {
                    let header_content = &line[header_start + 1..header_start + 1 + header_end];
                    if let Some(colon_pos) = header_content.find(':') {
                        let key = header_content[..colon_pos].trim().to_string();
                        let value = header_content[colon_pos + 1..].trim().to_string();
                        headers.push((key, value));
                    }
                }
            }
        }
    }
    
    // Extract body (look for -d or --data)
    let body = if let Some(data_start) = curl.find("-d ").or_else(|| curl.find("--data ")) {
        let body_part = &curl[data_start + 3..];
        let body_str = if body_part.starts_with('\'') {
            // Single-quoted body
            let end = body_part[1..].find('\'').unwrap_or(body_part.len() - 1);
            &body_part[1..end + 1]
        } else if body_part.starts_with('"') {
            // Double-quoted body
            let end = body_part[1..].find('"').unwrap_or(body_part.len() - 1);
            &body_part[1..end + 1]
        } else {
            // Unquoted - take until next space or flag
            let end = body_part.find(' ').unwrap_or(body_part.len());
            &body_part[..end]
        };
        
        // Try to parse as JSON
        serde_json::from_str(body_str).ok()
    } else {
        None
    };
    
    Ok(ParsedCurlRequest {
        method,
        url: url.clone(),
        headers,
        body,
        base_url,
        path_segments,
        query_params,
    })
}

/// Identify which fields should be modifiable based on the parsed request
/// Returns a simplified list of modifiable elements with their positions
pub fn identify_modifiable_fields(
    parsed: &ParsedCurlRequest,
    _suggested_params: Option<&Vec<String>>,
) -> Vec<ModifiableField> {
    let mut fields = Vec::new();
    
    // Add path segments that look like parameters
    for (index, segment) in parsed.path_segments.iter().enumerate() {
        if is_likely_parameter(segment) {
            fields.push(ModifiableField {
                parameter_name: format!("path{}", index),
                json_pointer: format!("/path/{}", index),
                location: "path".to_string(),
                example_value: segment.clone(),
                value_type: infer_type(segment),
            });
        }
    }
    
    // Add all query parameters
    for (key, value) in &parsed.query_params {
        fields.push(ModifiableField {
            parameter_name: key.clone(),
            json_pointer: format!("/query/{}", key),
            location: "query".to_string(),
            example_value: value.clone(),
            value_type: infer_type(value),
        });
    }
    
    // Add non-standard headers (skip common ones)
    for (key, value) in &parsed.headers {
        if !is_standard_header(key) {
            fields.push(ModifiableField {
                parameter_name: key.clone(),
                json_pointer: format!("/headers/{}", key),
                location: "header".to_string(),
                example_value: value.clone(),
                value_type: "string".to_string(),
            });
        }
    }
    
    // Add body fields if body exists
    if let Some(body) = &parsed.body {
        add_body_fields(body, "/body", &mut fields, None);
    }
    
    fields
}

/// Recursively add body fields
fn add_body_fields(
    value: &serde_json::Value,
    path: &str,
    fields: &mut Vec<ModifiableField>,
    suggested_params: Option<&Vec<String>>,
) {
    match value {
        serde_json::Value::Object(map) => {
            for (key, val) in map {
                let pointer = format!("{}/{}", path, key);
                
                // Check if this field is in suggested parameters
                let is_suggested = suggested_params
                    .map(|params| params.contains(key))
                    .unwrap_or(true); // If no suggestions, include all
                
                if is_suggested {
                    match val {
                        serde_json::Value::Object(_) | serde_json::Value::Array(_) => {
                            // For complex types, add the whole object/array
                            fields.push(ModifiableField {
                                parameter_name: key.clone(),
                                json_pointer: pointer.clone(),
                                location: "body".to_string(),
                                example_value: val.to_string(),
                                value_type: if val.is_array() { "array" } else { "object" }.to_string(),
                            });
                        }
                        _ => {
                            // For primitives, add directly
                            fields.push(ModifiableField {
                                parameter_name: key.clone(),
                                json_pointer: pointer,
                                location: "body".to_string(),
                                example_value: val.as_str().unwrap_or(&val.to_string()).to_string(),
                                value_type: infer_type_from_json(val),
                            });
                        }
                    }
                }
            }
        }
        _ => {}
    }
}

/// Build the endpoint object from parsed cURL and identified fields
pub fn build_endpoint_from_parsed(
    parsed: &ParsedCurlRequest,
    fields: &[ModifiableField],
) -> Result<serde_json::Value, String> {
    // Build URL template with parameter placeholders
    let mut url_template = parsed.base_url.clone();
    if !parsed.path_segments.is_empty() {
        url_template.push('/');
        for (index, segment) in parsed.path_segments.iter().enumerate() {
            if index > 0 {
                url_template.push('/');
            }
            // Check if this segment is a modifiable field
            let json_ptr = format!("/path/{}", index);
            if let Some(field) = fields.iter().find(|f| f.json_pointer == json_ptr) {
                url_template.push_str(&format!("{{{}}}", field.parameter_name));
            } else {
                url_template.push_str(segment);
            }
        }
    }
    
    // Convert fields to ParameterDefinition format matching provider's structure
    let parameters: Vec<serde_json::Value> = fields
        .iter()
        .map(|field| {
            serde_json::json!({
                "parameter_name": field.parameter_name,
                "json_pointer": field.json_pointer,
                "location": field.location,
                "example_value": field.example_value,
                "value_type": field.value_type,
            })
        })
        .collect();
    
    let parameter_names: Vec<String> = fields.iter()
        .map(|f| f.parameter_name.clone())
        .collect();
    
    // Return EndpointDefinition structure matching provider's expected format
    // This matches: original_curl, method, base_url, url_template, original_headers, original_body, parameters, parameter_names
    Ok(serde_json::json!({
        "original_curl": parsed.url,
        "method": parsed.method,
        "base_url": parsed.base_url,
        "url_template": url_template,
        "original_headers": parsed.headers,
        "original_body": parsed.body.as_ref().and_then(|b| serde_json::to_string(b).ok()),
        "parameters": parameters,
        "parameter_names": parameter_names,
    }))
}

fn is_likely_parameter(segment: &str) -> bool {
    // Numeric ID
    if segment.chars().all(|c| c.is_numeric()) && !segment.is_empty() {
        return true;
    }
    
    // UUID pattern (simple check)
    if segment.len() == 36 && segment.chars().filter(|c| *c == '-').count() == 4 {
        return true;
    }
    
    // Long alphanumeric strings (likely IDs)
    if segment.len() >= 8 && segment.chars().all(|c| c.is_alphanumeric()) {
        return true;
    }
    
    false
}

fn is_standard_header(key: &str) -> bool {
    let lower = key.to_lowercase();
    matches!(
        lower.as_str(),
        "content-type" | "accept" | "user-agent" | "host" | "connection" | 
        "cache-control" | "accept-encoding" | "accept-language" | "content-length"
    )
}

fn infer_type(value: &str) -> String {
    if value.parse::<i64>().is_ok() {
        "number".to_string()
    } else if value == "true" || value == "false" {
        "boolean".to_string()
    } else {
        "string".to_string()
    }
}

fn infer_type_from_json(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Number(_) => "number".to_string(),
        serde_json::Value::Bool(_) => "boolean".to_string(),
        serde_json::Value::Array(_) => "array".to_string(),
        serde_json::Value::Object(_) => "object".to_string(),
        _ => "string".to_string(),
    }
}


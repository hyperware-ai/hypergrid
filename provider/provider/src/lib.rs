use hyperprocess_macro::*;

use hyperware_process_lib::logging::RemoteLogSettings;
use hyperware_process_lib::{
    eth::{Provider, Address as EthAddress},
    get_state,
    http::{
        StatusCode,
        Method as HyperwareHttpMethod,
    },
    hypermap,
    logging::{debug, error, info, warn, init_logging, Level},
    our,
    vfs::{create_drive, create_file, open_file},
    Address,
    hyperapp::{source, SaveOptions, sleep, get_server, set_response_status, set_response_body, add_response_header, get_request_header, get_request_url, get_parsed_query_params},
};
use crate::constants::{
    HYPR_SUFFIX,
    USDC_BASE_ADDRESS,
    USDC_SEPOLIA_ADDRESS,
    USDC_EIP712_NAME,
    USDC_EIP712_VERSION,
    X402_PAYMENT_NETWORK,
    X402_FACILITATOR_BASE_URL,
};
use base64ct::{Base64, Encoding};
use rmp_serde;
use serde::{Deserialize, Serialize};
use serde_json;
use std::str::FromStr; // Needed for EthAddress::from_str
use std::collections::HashMap;

pub const CHAIN_ID: u64 = hypermap::HYPERMAP_CHAIN_ID;

mod util; // Declare the util module
use util::*; // Use its public items
pub use util::call_provider;

mod db; // Declare the db module  
use db::*; // Use its public items

pub mod constants; // Declare the constants module
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ProviderRequest {
    pub provider_name: String,
    pub arguments: Vec<(String, String)>,
    pub payment_tx_hash: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct HealthCheckRequest {
    pub provider_name: String, // Provider name for availability checking
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DummyResponse {
    pub response: String,
}

// New structure for validation request
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ValidateAndRegisterRequest {
    pub provider: RegisteredProvider,
    pub validation_arguments: Vec<(String, String)>,
}

// x402 payment protocol structures
// These use camelCase field names per x402 spec (not Rust's snake_case convention)
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentRequirements {
    #[serde(rename = "x402Version")]
    pub protocol_version: u8,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub accepts: Option<Vec<AcceptedPayment>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub payer: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcceptedPayment {
    pub scheme: String,
    pub network: String,
    pub max_amount_required: String,  // USDC in atomic units (6 decimals)
    pub resource: String,
    pub description: String,
    pub mime_type: String,
    pub pay_to: String,  // Ethereum address
    pub max_timeout_seconds: u64,
    pub asset: String,   // USDC contract address

    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_schema: Option<OutputSchema>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub extra: Option<serde_json::Value>,
}

// x402scan registry schema types
// FieldDef describes individual field requirements (type, required, enum, nested properties)
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldDef {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub r#type: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub required: Option<serde_json::Value>,  // Can be bool or string[]

    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none", rename = "enum")]
    pub r#enum: Option<Vec<String>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub properties: Option<HashMap<String, FieldDef>>,  // Recursive for nested objects
}

// InputSchema describes HTTP request requirements (method, params, body structure)
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InputSchema {
    pub r#type: String,  // Always "http" for our use case

    pub method: String,  // "GET", "POST", etc

    #[serde(skip_serializing_if = "Option::is_none")]
    pub body_type: Option<String>,  // "json", "form-data", "multipart-form-data", "text", "binary"

    #[serde(skip_serializing_if = "Option::is_none")]
    pub query_params: Option<HashMap<String, FieldDef>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub body_fields: Option<HashMap<String, FieldDef>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub header_fields: Option<HashMap<String, FieldDef>>,
}

// OutputSchema is the top-level schema wrapper for x402scan registry
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputSchema {
    pub input: InputSchema,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<serde_json::Value>,  // Flexible JSON for response format
}

// X-PAYMENT header payload structures (from x402 client)
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentPayload {
    #[serde(rename = "x402Version")]
    pub protocol_version: u8,
    pub scheme: String,
    pub network: String,
    pub payload: ExactPayload,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ExactPayload {
    pub signature: String,
    pub authorization: Authorization,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Authorization {
    pub from: String,
    pub to: String,
    pub value: String,
    pub valid_after: String,
    pub valid_before: String,
    pub nonce: String,
}

// Facilitator API request/response structures
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FacilitatorVerifyRequest {
    #[serde(rename = "x402Version")]
    pub protocol_version: u8,
    pub payment_payload: PaymentPayload,  // Decoded payment object
    pub payment_requirements: AcceptedPayment,  // Single payment method, not the full PaymentRequirements wrapper
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyResponse {
    pub is_valid: bool,
    pub payer: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub invalid_reason: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettleResponse {
    pub success: bool,
    pub payer: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transaction: Option<String>,
    pub network: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_reason: Option<String>,
}

// Type system for API endpoints
#[derive(PartialEq, Clone, Debug, Serialize, Deserialize)]
pub enum HttpMethod {
    GET,
    POST,
}

// --- Added Enum for Request Structure ---
#[derive(PartialEq, Clone, Debug, Serialize, Deserialize)]
pub enum RequestStructureType {
    GetWithPath,
    GetWithQuery,
    PostWithJson,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum TerminalCommand {
    ListProviders,
    RegisterProvider(RegisteredProvider),
    UnregisterProvider(String),
    TestProvider(ProviderRequest),
    ExportProviders,
    ViewDatabase,
}

// --- Modified EndpointDefinition ---
// OLD STRUCTURE - KEPT FOR REFERENCE
// #[derive(PartialEq, Clone, Debug, Serialize, Deserialize)]
// pub struct EndpointDefinition {
//     pub name: String,                            // Operation name, e.g., "getUserById"
//     pub method: HttpMethod,                      // GET, POST
//     pub request_structure: RequestStructureType, // Explicitly define the structure
//     pub base_url_template: String, // e.g., "https://api.example.com/users/{id}" or "https://api.example.com/v{apiVersion}/users"
//     pub path_param_keys: Option<Vec<String>>, // Keys for placeholders in base_url_template, relevant for GetWithPath, PostWithJson
//     pub query_param_keys: Option<Vec<String>>, // Keys for dynamic query params, relevant for GetWithQuery, PostWithJson
//     pub header_keys: Option<Vec<String>>, // Keys for dynamic headers (always potentially relevant)
//     pub body_param_keys: Option<Vec<String>>, // Keys for dynamic body params, relevant for PostWithJson
//     pub api_key: Option<String>, // The actual secret key
//     pub api_key_query_param_name: Option<String>, // e.g., "api_key"
//     pub api_key_header_name: Option<String>,      // e.g., "X-API-Key"
// }

// NEW CURL-BASED STRUCTURE
#[derive(PartialEq, Clone, Debug, Serialize)]
pub struct EndpointDefinition {
    // Core curl template data
    pub original_curl: String,
    pub method: String,  // "GET", "POST", etc
    pub base_url: String,
    pub url_template: String,
    pub original_headers: Vec<(String, String)>,
    pub original_body: Option<String>,

    // Parameter definitions for substitution
    pub parameters: Vec<ParameterDefinition>,
    pub parameter_names: Vec<String>,
}

// Custom Deserialize implementation for EndpointDefinition to handle migration
impl<'de> Deserialize<'de> for EndpointDefinition {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        // Use an untagged enum to try different deserialization strategies
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum EndpointDefinitionVariant {
            New(NewEndpointDefinition),
            Old(OldEndpointDefinition),
        }

        match EndpointDefinitionVariant::deserialize(deserializer) {
            Ok(EndpointDefinitionVariant::New(new_endpoint)) => {
                Ok(EndpointDefinition {
                    original_curl: new_endpoint.original_curl,
                    method: new_endpoint.method,
                    base_url: new_endpoint.base_url,
                    url_template: new_endpoint.url_template,
                    original_headers: new_endpoint.original_headers,
                    original_body: new_endpoint.original_body,
                    parameters: new_endpoint.parameters,
                    parameter_names: new_endpoint.parameter_names,
                })
            },
            Ok(EndpointDefinitionVariant::Old(_old_endpoint)) => {
                debug!("Migrating old EndpointDefinition to new structure - creating empty endpoint definition");
                // Create an empty endpoint definition for migration
                Ok(EndpointDefinition::empty())
            },
            Err(_) => {
                // If both fail, create an empty endpoint definition
                debug!("Failed to deserialize EndpointDefinition as old or new format - creating empty definition");
                Ok(EndpointDefinition::empty())
            }
        }
    }
}

// Helper structs for deserialization
#[derive(Deserialize)]
struct NewEndpointDefinition {
    original_curl: String,
    method: String,
    base_url: String,
    url_template: String,
    original_headers: Vec<(String, String)>,
    original_body: Option<String>,
    parameters: Vec<ParameterDefinition>,
    parameter_names: Vec<String>,
}

#[derive(Deserialize)]
#[allow(dead_code)] // Fields are used for deserialization pattern matching but not directly accessed
struct OldEndpointDefinition {
    name: String,
    method: HttpMethod,
    request_structure: RequestStructureType,
    base_url_template: String,
    path_param_keys: Option<Vec<String>>,
    query_param_keys: Option<Vec<String>>,
    header_keys: Option<Vec<String>>,
    body_param_keys: Option<Vec<String>>,
    api_key: Option<String>,
    api_key_query_param_name: Option<String>,
    api_key_header_name: Option<String>,
}

#[derive(PartialEq, Clone, Debug, Serialize, Deserialize)]
pub struct ParameterDefinition {
    pub parameter_name: String,
    pub json_pointer: String,  // e.g., "/body/user_id", "/headers/X-API-Key"
    pub location: String,      // "body", "query", "path", "header"
    pub example_value: String,
    pub value_type: String,    // "string", "number", etc
}

// --- New Provider Struct ---
#[derive(PartialEq, Clone, Debug, Serialize, Deserialize)]
pub struct RegisteredProvider {
    pub provider_name: String,
    // Provide Node Identity (HNS entry (Node Identity) of the the process serving as the provider)
    pub provider_id: String,
    pub description: String,
    // TODO: This should be an EthAddress, but that is not supported by WIT parser (yet)
    pub instructions: String,
    // We should validate this is a valid address before storing it
    pub registered_provider_wallet: String,
    // Price per call in USDC, should be clear in HNS entry
    pub price: f64,
    pub endpoint: EndpointDefinition,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct HypergridProviderState {
    pub registered_providers: Vec<RegisteredProvider>,
    pub spent_tx_hashes: Vec<String>,
    #[serde(skip, default = "util::default_provider")]
    pub rpc_provider: Provider,
    #[serde(skip, default = "util::default_hypermap")]
    pub hypermap: hypermap::Hypermap,
    #[serde(skip)]
    pub vfs_drive_path: Option<String>,
}

impl HypergridProviderState {
    /// Helper to convert any error to String for consistent error handling
    fn to_err<E: std::fmt::Display>(e: E) -> String {
        e.to_string()
    }

    /// Creates a new instance of the state (always fresh/empty)
    pub fn new() -> Self {
        let hypermap_timeout = 60; // RPC Provider timeout

        // Provider specifically for Hypermap, using its defined chain and address
        let provider = Provider::new(hypermap::HYPERMAP_CHAIN_ID, hypermap_timeout);
        let hypermap_contract_address = EthAddress::from_str(hypermap::HYPERMAP_ADDRESS)
            .expect("HYPERMAP_ADDRESS const should be a valid Ethereum address");

        Self {
            registered_providers: Vec::new(),
            spent_tx_hashes: Vec::new(),
            rpc_provider: provider.clone(),
            hypermap: hypermap::Hypermap::new(provider.clone(), hypermap_contract_address),
            vfs_drive_path: None,
        }
    }


    /// Initialize VFS drive for storing provider data
    pub fn init_vfs_drive(&mut self) -> Result<(), String> {
        match create_drive(our().package_id(), "providers", None) {
            Ok(drive_path) => {
                debug!("Created VFS drive for providers at: {}", drive_path);
                self.vfs_drive_path = Some(drive_path);

                // Try to load existing providers from VFS
                if let Err(e) = self.load_providers_from_vfs() {
                    debug!("No existing providers in VFS or error loading: {}", e);
                    // Create empty providers file
                    self.save_providers_to_vfs()?;
                }

                Ok(())
            }
            Err(e) => {
                error!("Failed to create VFS drive: {}", e);
                Err(format!("Failed to create VFS drive: {}", e))
            }
        }
    }

    /// Save all providers to VFS as JSON
    pub fn save_providers_to_vfs(&self) -> Result<(), String> {
        let drive_path = self
            .vfs_drive_path
            .as_ref()
            .ok_or("VFS drive not initialized")?;
        let file_path = format!("{}/providers.json", drive_path);
        // Possible inneficieny here since we are pulling all providers from memory to serialize them
        let json_data =
            serde_json::to_string_pretty(&self.registered_providers).map_err(Self::to_err)?;

        let file = create_file(&file_path, None).map_err(Self::to_err)?;

        file.write(json_data.as_bytes()).map_err(Self::to_err)?;

        debug!("Saved {} providers to VFS", self.registered_providers.len());
        Ok(())
    }

    /// Load providers from VFS JSON file
    pub fn load_providers_from_vfs(&mut self) -> Result<(), String> {
        let drive_path = self
            .vfs_drive_path
            .as_ref()
            .ok_or("VFS drive not initialized")?;
        let file_path = format!("{}/providers.json", drive_path);

        let file = open_file(&file_path, false, None).map_err(Self::to_err)?;

        let bytes = file.read().map_err(Self::to_err)?;

        let json_data = String::from_utf8(bytes).map_err(Self::to_err)?;

        let providers =
            serde_json::from_str::<Vec<RegisteredProvider>>(&json_data).map_err(Self::to_err)?;

        self.registered_providers = providers;
        debug!(
            "Loaded {} providers from VFS",
            self.registered_providers.len()
        );
        Ok(())
    }

    /// Export providers as JSON string (for easy export functionality)
    pub fn export_providers_json(&self) -> Result<String, String> {
        let json_data =
            serde_json::to_string_pretty(&self.registered_providers).map_err(Self::to_err)?;

        debug!(
            "Exported {} providers as JSON",
            self.registered_providers.len()
        );
        Ok(json_data)
    }

    /// Loads old state from disk, falls back to new() if none exists
    pub fn load() -> Self {
        match get_state() {
            Some(bytes) => match rmp_serde::from_slice::<Self>(&bytes) {
                Ok(state) => {
                    debug!("Successfully loaded HypergridProviderState from checkpoint.");
                    state
                }
                Err(e) => {
                    error!("Failed to deserialize HypergridProviderState with rmp_serde: {}, creating new state", e);
                    Self::new()
                }
            },
            None => {
                debug!("No saved state found. Creating new state.");
                Self::new()
            }
        }
    }
}

impl Default for HypergridProviderState {
    fn default() -> Self {
        Self::new()
    }
}

// x402 helper functions (standalone, not in impl block to avoid WIT export requirements)

/// Parse X-PAYMENT header value: base64 decode and deserialize to PaymentPayload
fn parse_x_payment_header(header_value: &str) -> Result<PaymentPayload, String> {
    // Allocate buffer for decoded data (base64 decoding produces smaller output than input)
    let max_decoded_len = (header_value.len() * 3) / 4 + 3;
    let mut decoded_bytes = vec![0u8; max_decoded_len];

    let decoded_slice = Base64::decode(header_value.as_bytes(), &mut decoded_bytes)
        .map_err(|e| format!("Failed to base64 decode X-PAYMENT header: {}", e))?;

    serde_json::from_slice(decoded_slice)
        .map_err(|e| format!("Failed to parse X-PAYMENT JSON: {}", e))
}

/// Convert a ParameterDefinition to x402scan's FieldDef format
fn parameter_to_field_def(param: &ParameterDefinition) -> FieldDef {
    FieldDef {
        r#type: Some(param.value_type.clone()),
        required: Some(serde_json::Value::Bool(true)),  // All provider params are required
        description: Some(format!("Parameter: {}", param.parameter_name)),
        r#enum: None,
        properties: None,
    }
}

/// Build InputSchema from provider's endpoint definition
fn build_input_schema(endpoint: &EndpointDefinition) -> InputSchema {
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
fn build_payment_requirements(provider: &RegisteredProvider, resource_url: &str) -> PaymentRequirements {
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

// --- Hyperware Process ---
#[hyperprocess(
    name = "provider",
    ui = None,
    endpoints = vec![
        Binding::Http {
            path: "/api",
            config: HttpBindingConfig::new(false, false, false, None),
        },
        Binding::Http {
            path: "/xfour",
            config: HttpBindingConfig::new(false, false, false, None),
        },
        Binding::Ws {
            path: "/ws",
            config: WsBindingConfig::new(false, false, false),
        }
    ],
    save_config = SaveOptions::EveryMessage,
    wit_world = "provider-template-dot-os-v0"
)]

// --- Hyperware Process API definitions ---
impl HypergridProviderState {
    #[init]
    async fn initialize(&mut self) {
        let remote_logger: RemoteLogSettings = RemoteLogSettings { 
            target: Address::new("hypergrid-logger.hypr", ("logging", "logging", "nick.hypr")), 
            level: Level::INFO 
        };
        // Initialize tracing-based logging for the provider process
        init_logging(Level::DEBUG, Level::INFO, Some(remote_logger), None, Some(250 * 1024 * 1024)).expect("Failed to initialize logging"); // 250MB log files
        debug!("Initializing Hypergrid on node {}", our().node.to_string());
        *self = HypergridProviderState::load();
        let server = get_server().expect("HTTP server should be initialized");

        server.serve_ui("provider-ui", vec!["/"], HttpBindingConfig::default()).unwrap();

        // Initialize VFS drive for provider storage
        if let Err(e) = self.init_vfs_drive() {
            error!("Failed to initialize VFS drive: {}", e);
        }
        // add_to_homepage("Hypergrid Provider Dashboard", Some(ICON), Some("/"), None);
    }

    #[local]
    #[remote]
    async fn health_ping(&self, request: HealthCheckRequest) -> Result<String, String> {
        info!("Health ping received: {:?}", request);
        
        info!("Checking availability for provider: {}", request.provider_name);
        
        // Check if provider exists in registry
        let provider_exists = self
            .registered_providers
            .iter()
            .find(|p| p.provider_name == request.provider_name);
            
        match provider_exists {
            Some(provider) => {
                // Check if provider has a valid endpoint configuration
                if provider.endpoint.is_empty() {
                    let error_msg = format!(
                        "Provider '{}' exists but needs endpoint configuration", 
                        request.provider_name
                    );
                    warn!("{}", error_msg);
                    return Err(error_msg);
                }
                
                debug!(
                    "Provider '{}' is available and configured (price: {} USDC)", 
                    request.provider_name, 
                    provider.price
                );
                Ok("Ack".to_string())
            }
            None => {
                let error_msg = format!("Provider '{}' not found in registry", request.provider_name);
                warn!("{}", error_msg);
                Err(error_msg)
            }
        }
    }

    #[http]
    async fn register_provider(
        &mut self,
        provider: RegisteredProvider,
    ) -> Result<RegisteredProvider, String> {
        // Usage tracking log - registration started
        debug!(
            "provider_registration_started: provider={}, price={}",
            provider.provider_name,
            provider.price
        );

        // need to check if provider already exists in db + our registry, add that later
        if self
            .registered_providers
            .iter()
            .any(|p| p.provider_name == provider.provider_name)
        {
            let error_msg = format!(
                "Provider with name '{}' already registered.",
                provider.provider_name
            );
            warn!("{}", error_msg);
            return Err(error_msg);
        }

        // Provider ID is set by frontend to match node identity
        self.registered_providers.push(provider.clone());
        
        // Success tracking log
        debug!(
            "provider_registration_success: provider={}, total_providers={}",
            provider.provider_name,
            self.registered_providers.len()
        );

        // Save to VFS
        if let Err(e) = self.save_providers_to_vfs() {
            error!("Failed to save providers to VFS: {}", e);
        }

        // Attempt manual save for diagnostics
        match rmp_serde::to_vec(self) {
            Ok(bytes) => {
                hyperware_process_lib::set_state(&bytes);
                debug!("Manually called set_state with {} bytes.", bytes.len());
            }
            Err(e) => {
                error!("Manual save: Failed to serialize HpnProviderState: {}", e);
            }
        }

        Ok(provider)
    }

    #[http]
    async fn validate_provider(
        &mut self,
        provider: RegisteredProvider,
        arguments: Vec<(String, String)>,
    ) -> Result<String, String> {
        // Usage tracking log - validation started
        debug!(
            "provider_validation_started: provider={}, arg_count={}",
            provider.provider_name,
            arguments.len()
        );
        // Check if already registered
        if self
            .registered_providers
            .iter()
            .any(|p| p.provider_name == provider.provider_name)
        {
            let error_msg = format!(
                "Provider with name '{}' already registered.",
                provider.provider_name
            );
            debug!("{}", error_msg);
            return Err(error_msg);
        }

        // Use the new curl-based validation
        let validation_result = call_provider(
            provider.provider_name.clone(),
            provider.endpoint.clone(),
            &arguments,
            our().node.to_string(),
        )
        .await?;
        debug!("Validation result: {}", validation_result);
        validate_response_status(&validation_result)
            .map_err(|e| format!("Validation failed: {}", e))?;

        let validation_start = std::time::Instant::now();
        // Success tracking log
        debug!(
            "provider_validation_success: provider={}, duration_ms={}, response_size_bytes={}",
            provider.provider_name,
            validation_start.elapsed().as_millis(),
            validation_result.len()
        );
        // Return the validated provider object as JSON for frontend consistency
        let response = serde_json::json!({
            "validation_result": validation_result,
            "provider": provider
        });

        serde_json::to_string(&response)
            .map_err(|e| format!("Failed to serialize validation response: {}", e))
    }



    #[http]
    async fn validate_provider_update(
        &mut self,
        provider_name: String,
        updated_provider: RegisteredProvider,
        arguments: Vec<(String, String)>,
    ) -> Result<String, String> {
        debug!("Validating provider update: {}", provider_name);
        // Check if the original provider exists
        if !self
            .registered_providers
            .iter()
            .any(|p| p.provider_name == provider_name)
        {
            let error_msg = format!(
                "Provider with name '{}' not found for update.",
                provider_name
            );
            warn!("{}", error_msg);
            return Err(error_msg);
        }

        // If the name is changing, check if new name already exists
        if provider_name != updated_provider.provider_name {
            if self
                .registered_providers
                .iter()
                .any(|p| p.provider_name == updated_provider.provider_name)
            {
                let error_msg = format!(
                    "A provider with name '{}' already exists. Please choose a different name.",
                    updated_provider.provider_name
                );
                warn!("{}", error_msg);
                return Err(error_msg);
            }
        }

        // Use the new curl-based validation
        let validation_result = call_provider(
            updated_provider.provider_name.clone(),
            updated_provider.endpoint.clone(),
            &arguments,
            our().node.to_string(),
        )
        .await?;
        debug!("Validation result: {}", validation_result);
        validate_response_status(&validation_result)
            .map_err(|e| format!("Validation failed: {}", e))?;

        debug!("Provider update validation successful: {}", updated_provider.provider_name);
        // Return the validated provider object as JSON for frontend consistency
        let response = serde_json::json!({
            "validation_result": validation_result,
            "provider": updated_provider
        });

        serde_json::to_string(&response)
            .map_err(|e| format!("Failed to serialize validation response: {}", e))
    }

    #[http]
    async fn update_provider(
        &mut self,
        provider_name: String,
        updated_provider: RegisteredProvider,
    ) -> Result<RegisteredProvider, String> {
        debug!("Provider update request received: {}", provider_name);

        // Find the provider to update
        let provider_index = self
            .registered_providers
            .iter()
            .position(|p| p.provider_name == provider_name);

        match provider_index {
            Some(index) => {
                // Check if the provider name is changing
                let name_changed = provider_name != updated_provider.provider_name;

                // If name changed, check if new name already exists
                if name_changed {
                    if self
                        .registered_providers
                        .iter()
                        .any(|p| p.provider_name == updated_provider.provider_name)
                    {
                        let error_msg = format!(
                            "A provider with name '{}' already exists. Please choose a different name.",
                            updated_provider.provider_name
                        );
                        debug!("{}", error_msg);
                        return Err(error_msg);
                    }
                }

                // Always use node identity as provider_id
                let updated_provider_with_id = RegisteredProvider {
                    provider_id: our().node.to_string(),
                    ..updated_provider
                };

                // Update the provider
                self.registered_providers[index] = updated_provider_with_id.clone();

                debug!(
                    "Successfully updated provider: {} -> {}",
                    provider_name, updated_provider_with_id.provider_name
                );

                // Save to VFS
                if let Err(e) = self.save_providers_to_vfs() {
                    error!("Failed to save updated providers to VFS: {}", e);
                }

                // Manual save for diagnostics
                match rmp_serde::to_vec(self) {
                    Ok(bytes) => {
                        hyperware_process_lib::set_state(&bytes);
                        debug!(
                            "Manually called set_state with {} bytes after update.",
                            bytes.len()
                        );
                    }
                    Err(e) => {
                        error!("Manual save after update: Failed to serialize HypergridProviderState: {}", e);
                    }
                }

                Ok(updated_provider_with_id)
            }
            None => Err(format!(
                "Provider with name '{}' not found for update.",
                provider_name
            )),
        }
    }

    #[local]
    #[remote]
    async fn call_provider(&mut self, request: ProviderRequest) -> Result<String, String> {
        let mcp_request = match request {
            ProviderRequest { .. } => request,
        };
        
        // Get the source node ID for tracking
        let source_address = source();
        let source_node_id = source_address.node().to_string();
        
        // Usage tracking log - no sensitive data
        info!(
            "provider_call_started: provider={}, provider_node={}, source_node={}, tx_hash={}, arg_count={}",
            mcp_request.provider_name,
            our().node,
            source_node_id,
            mcp_request.payment_tx_hash.as_deref().unwrap_or("none"),
            mcp_request.arguments.len()
        );

        // --- 0. Check if provider exists at all ---
        // First validate the payment before accessing registered_provider
        if !self
            .registered_providers
            .iter()
            .any(|p| p.provider_name == mcp_request.provider_name)
        {
            let error_msg = format!(
                "Provider '{}' not found - please make sure to enter a valid, registered provider name",
                mcp_request.provider_name
            );
            // Error tracking log - safe data only
            error!(
                "provider_call_failed: provider={}, source_node={}, error_type=provider_not_found, message={}",
                mcp_request.provider_name,
                source_node_id,
                "Provider not found in registry"
            );
            return Err(error_msg);
        }

        // Get the source node ID ---
        let source_address = source();
        // goobersync.os
        let source_node_id = source_address.node().to_string();

        // --- 1. Validate the payment ---
        if let Err(validation_err) =
            validate_transaction_payment(&mcp_request, self, source_node_id.clone()).await
        {
            // Error tracking log - payment validation failed
            error!(
                "provider_call_failed: provider={}, source_node={}, error_type=payment_validation_failed, validation_error={}",
                mcp_request.provider_name,
                source_node_id,
                validation_err
            );
            return Err(validation_err);
        }
        // We can safely unwrap here since validate_transaction_payment already checked
        // that the provider exists in the registered_providers list
        let registered_provider = self
            .registered_providers
            .iter()
            .find(|p| p.provider_name == mcp_request.provider_name)
            .expect(&format!(
                "Provider '{}' not found - this should never happen as it was validated in `validate_transaction_payment`",
                mcp_request.provider_name
            ));

        // --- 2. Call the provider with retry mechanism ---
        const MAX_RETRIES: usize = 3;
        let mut last_error = String::new();
        let call_start_time = std::time::Instant::now();
        for attempt in 1..=MAX_RETRIES {
            debug!("Attempting provider call {} of {}", attempt, MAX_RETRIES);

            let api_call_result = call_provider(
                // This is the HTTP call_provider
                registered_provider.provider_name.clone(),
                registered_provider.endpoint.clone(),
                &mcp_request.arguments,
                source_node_id.clone(), // this makes sure User-Agent is node ID
            )
            .await;

            match api_call_result {
                Ok(response) => {
                    let call_duration = call_start_time.elapsed();
                    
                    // Success tracking log - no sensitive data
                    info!(
                        "provider_call_success: provider={}, provider_node={}, source_node={}, tx_hash={}, price_usdc={}, attempt={}, duration_ms={}, response_size_bytes={}",
                        registered_provider.provider_name,
                        our().node,
                        source_node_id,
                        mcp_request.payment_tx_hash.as_deref().unwrap_or("none"),
                        registered_provider.price,
                        attempt,
                        call_duration.as_millis(),
                        response.len()
                    );
                    
                    if attempt > 1 {
                        debug!("Provider call succeeded on attempt {} of {} after {:?}", attempt, MAX_RETRIES, call_duration);
                    }
                    return Ok(response);
                },
                Err(e) => {
                    last_error = e.clone();
                    error!(
                        "provider_call_attempt_failed: provider={}, source_node={}, attempt={}, error_type=api_call_failed",
                        registered_provider.provider_name,
                        source_node_id,
                        attempt
                    );
                    // Don't sleep after the last attempt
                    if attempt < MAX_RETRIES {
                        // Add a small delay between retries to handle rate limiting and temporary issues
                        let _ = sleep(500).await;
                    }
                }
            }
        }

        // If we get here, all retries failed
        let total_duration = call_start_time.elapsed();
        error!(
            "provider_call_failed: provider={}, source_node={}, error_type=all_retries_failed, attempts={}, total_duration_ms={}",
            registered_provider.provider_name,
            source_node_id,
            MAX_RETRIES,
            total_duration.as_millis()
        );
        Err(last_error)
    }

    #[http]
    async fn get_registered_providers(&self) -> Result<Vec<RegisteredProvider>, String> {
        debug!("Fetching registered providers");
        Ok(self.registered_providers.clone())
    }

    #[http]
    async fn get_providers_needing_configuration(&self) -> Result<Vec<RegisteredProvider>, String> {
        debug!("Fetching providers that need endpoint configuration");
        let providers_needing_config: Vec<RegisteredProvider> = self
            .registered_providers
            .iter()
            .filter(|provider| provider.endpoint.is_empty())
            .cloned()
            .collect();
        debug!("Found {} providers needing endpoint configuration", providers_needing_config.len());
        Ok(providers_needing_config)
    }

    #[http]
    async fn export_providers(&self) -> Result<String, String> {
        debug!("Exporting providers as JSON");
        self.export_providers_json()
    }

    /// HTTP 402 Payment Required endpoint for x402 micropayment protocol
    ///
    /// This endpoint implements the x402 payment flow:
    /// 1. Initial request: Client sends query params (providername + provider args), gets 402 response with PaymentRequirements
    /// 2. Payment retry: Client retries with X-PAYMENT header containing signed payment authorization
    /// 3. Final response: After payment validation, return actual provider response with X-PAYMENT-RESPONSE header
    #[http(path = "/xfour")]
    async fn handle_xfour(&mut self) -> Result<String, String> {
        info!("x402 endpoint called");

        // ===== CHECK FOR X-PAYMENT HEADER =====
        let x_payment_header = get_request_header("x-payment");

        // ===== SHARED: QUERY PARAMETER VALIDATION =====
        let params = get_parsed_query_params();

        let params = match params {
            Some(p) if !p.is_empty() => p,
            _ => {
                let error_json = serde_json::json!({"error": "Missing query parameters. Expected ?providername=...&..."});
                let error_bytes = serde_json::to_vec(&error_json).unwrap();
                set_response_body(error_bytes);
                set_response_status(StatusCode::BAD_REQUEST);
                add_response_header("Content-Type".to_string(), "application/json".to_string());
                return Ok("".to_string());
            }
        };

        // ===== SHARED: PROVIDER NAME EXTRACTION =====
        let provider_name = match params.get("providername") {
            Some(name) => name,
            None => {
                let error_json = serde_json::json!({"error": "Missing required parameter: providername"});
                let error_bytes = serde_json::to_vec(&error_json).unwrap();
                set_response_body(error_bytes);
                set_response_status(StatusCode::BAD_REQUEST);
                add_response_header("Content-Type".to_string(), "application/json".to_string());
                return Ok("".to_string());
            }
        };

        // ===== SHARED: PROVIDER LOOKUP =====
        let provider = match self.registered_providers.iter().find(|p| &p.provider_name == provider_name).cloned() {
            Some(p) => p,
            None => {
                let error_json = serde_json::json!({"error": format!("Provider not found: {}", provider_name)});
                let error_bytes = serde_json::to_vec(&error_json).unwrap();
                set_response_body(error_bytes);
                set_response_status(StatusCode::NOT_FOUND);
                add_response_header("Content-Type".to_string(), "application/json".to_string());
                return Ok("".to_string());
            }
        };

        // ===== SHARED: GET RESOURCE URL =====
        // NOTE: Fallback URL uses test.hypr - this should never actually be used in production
        // as get_request_url() should always succeed in HTTP context. If this fallback triggers, investigate.
        let resource_url = get_request_url()
            .unwrap_or_else(|| format!("http://unknown/provider:hypergrid:test.hypr/xfour?providername={}", provider_name));

        // ===== BRANCH: PAYMENT VERIFICATION FLOW =====
        if let Some(x_payment_str) = x_payment_header {
            info!("X-PAYMENT header detected, processing payment");
            info!("X-PAYMENT header received, length: {} chars", x_payment_str.len());

            let payment_payload = match parse_x_payment_header(&x_payment_str) {
                Ok(payload) => payload,
                Err(e) => {
                    let error_json = serde_json::json!({"error": format!("Invalid X-PAYMENT header: {}", e)});
                    let error_bytes = serde_json::to_vec(&error_json).unwrap();
                    set_response_body(error_bytes);
                    set_response_status(StatusCode::BAD_REQUEST);
                    add_response_header("Content-Type".to_string(), "application/json".to_string());
                    return Ok("".to_string());
                }
            };

            // Validate protocol version
            if payment_payload.protocol_version != 1 {
                error!("Unsupported x402 protocol version: {}", payment_payload.protocol_version);
                let error_json = serde_json::json!({
                    "error": format!("Unsupported x402 protocol version: {}. Expected version 1.", payment_payload.protocol_version)
                });
                let error_bytes = serde_json::to_vec(&error_json).unwrap();
                set_response_body(error_bytes);
                set_response_status(StatusCode::BAD_REQUEST);
                add_response_header("Content-Type".to_string(), "application/json".to_string());
                return Ok("".to_string());
            }

            info!("Payment parsed - protocol v{}, scheme: {}, network: {}",
                payment_payload.protocol_version, payment_payload.scheme, payment_payload.network);

            // Rebuild PaymentRequirements for verification
            let payment_requirements = build_payment_requirements(&provider, &resource_url);

            // Find the matching payment method based on scheme and network
            let payment_method = payment_requirements.accepts
                .as_ref()
                .and_then(|accepts| {
                    accepts.iter()
                        .find(|method| {
                            method.scheme == payment_payload.scheme &&
                            method.network == payment_payload.network
                        })
                        .cloned()
                });

            let payment_method = match payment_method {
                Some(method) => {
                    info!("Found matching payment method for scheme: {}, network: {}",
                        payment_payload.scheme, payment_payload.network);
                    method
                },
                None => {
                    error!("No matching payment method found for scheme: {}, network: {}",
                        payment_payload.scheme, payment_payload.network);
                    let error_json = serde_json::json!({
                        "error": format!("No matching payment method for scheme: {}, network: {}",
                            payment_payload.scheme, payment_payload.network)
                    });
                    let error_bytes = serde_json::to_vec(&error_json).unwrap();
                    set_response_body(error_bytes);
                    set_response_status(StatusCode::BAD_REQUEST);
                    add_response_header("Content-Type".to_string(), "application/json".to_string());
                    return Ok("".to_string());
                }
            };

            // Build facilitator verify request with the matched payment method
            let verify_request = FacilitatorVerifyRequest {
                protocol_version: 1,
                payment_payload: payment_payload.clone(),
                payment_requirements: payment_method,
            };

            let verify_body = serde_json::to_vec(&verify_request)
                .map_err(|e| format!("Failed to serialize verify request: {}", e))?;

            // Call facilitator /verify
            let verify_url = url::Url::parse(&format!("{}/verify", X402_FACILITATOR_BASE_URL))
                .map_err(|e| format!("Invalid facilitator URL: {}", e))?;

            let mut verify_headers = HashMap::new();
            verify_headers.insert("Content-Type".to_string(), "application/json".to_string());

            let verify_response = match send_async_http_request(
                HyperwareHttpMethod::POST,
                verify_url,
                Some(verify_headers),
                30,
                verify_body,
            ).await {
                Ok(resp) => resp,
                Err(e) => {
                    error!("Facilitator /verify request failed: {:?}", e);
                    let error_json = serde_json::json!({"error": "Payment verification service unavailable"});
                    let error_bytes = serde_json::to_vec(&error_json).unwrap();
                    set_response_body(error_bytes);
                    set_response_status(StatusCode::SERVICE_UNAVAILABLE);
                    add_response_header("Content-Type".to_string(), "application/json".to_string());
                    return Ok("".to_string());
                }
            };

            info!("Facilitator /verify response: {:?}", verify_response.status());

            // Parse verify response
            let verify_result: VerifyResponse = serde_json::from_slice(verify_response.body())
                .map_err(|e| format!("Failed to parse verify response: {}", e))?;

            if !verify_result.is_valid {
                warn!("Payment verification failed: {:?}", verify_result.invalid_reason);
                let mut error_payment_reqs = payment_requirements.clone();
                error_payment_reqs.error = Some(verify_result.invalid_reason.unwrap_or_else(|| "Payment verification failed".to_string()));
                let error_bytes = serde_json::to_vec(&error_payment_reqs).unwrap();
                set_response_body(error_bytes);
                set_response_status(StatusCode::PAYMENT_REQUIRED);
                add_response_header("Content-Type".to_string(), "application/json".to_string());
                return Ok("".to_string());
            }

            info!("Payment verified for payer: {}", verify_result.payer);

            // Call upstream provider API
            let args_vec: Vec<(String, String)> = params.iter()
                .filter(|(k, _)| k != &"providername")
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect();

            let upstream_response = match call_provider(
                provider.provider_name.clone(),
                provider.endpoint.clone(),
                &args_vec,
                our().node.to_string(),
            ).await {
                Ok(resp) => resp,
                Err(e) => {
                    error!("Upstream API call failed: {}", e);
                    let error_json = serde_json::json!({"error": format!("Provider API call failed: {}", e)});
                    let error_bytes = serde_json::to_vec(&error_json).unwrap();
                    set_response_body(error_bytes);
                    set_response_status(StatusCode::BAD_GATEWAY);
                    add_response_header("Content-Type".to_string(), "application/json".to_string());
                    return Ok("".to_string());
                }
            };

            info!("Upstream API call successful, settling payment");

            // Call facilitator /settle
            let settle_body = serde_json::to_vec(&verify_request)
                .map_err(|e| format!("Failed to serialize settle request: {}", e))?;

            let settle_url = url::Url::parse(&format!("{}/settle", X402_FACILITATOR_BASE_URL))
                .map_err(|e| format!("Invalid facilitator URL: {}", e))?;

            let mut settle_headers = HashMap::new();
            settle_headers.insert("Content-Type".to_string(), "application/json".to_string());

            // Call facilitator /settle and parse response
            let settle_result: SettleResponse = match send_async_http_request(
                HyperwareHttpMethod::POST,
                settle_url,
                Some(settle_headers),
                30,
                settle_body,
            ).await {
                Ok(http_response) => {
                    info!("Facilitator /settle response: {:?}", http_response.status());

                    // Parse the HTTP response body into SettleResponse
                    serde_json::from_slice(http_response.body())
                        .unwrap_or_else(|e| {
                            error!("Failed to parse settlement response: {}", e);
                            SettleResponse {
                                success: false,
                                payer: verify_result.payer.clone(),
                                transaction: None,
                                network: payment_payload.network.clone(),
                                error_reason: Some(format!("Failed to parse settlement response: {}", e)),
                            }
                        })
                }
                Err(e) => {
                    // HTTP request failed - settlement service unavailable
                    error!("Facilitator /settle request failed but continuing: {:?}", e);
                    SettleResponse {
                        success: false,
                        payer: verify_result.payer.clone(),
                        transaction: None,
                        network: payment_payload.network.clone(),
                        error_reason: Some(format!("Settlement service error: {:?}", e)),
                    }
                }
            };

            // Reject request if settlement fails - provider does not get paid
            if !settle_result.success {
                error!("Settlement failed, rejecting request: {:?}", settle_result.error_reason);
                let error_json = serde_json::json!({
                    "error": "Payment settlement failed. Please try again.",
                    "reason": settle_result.error_reason.unwrap_or_else(|| "Unknown settlement error".to_string())
                });
                let error_bytes = serde_json::to_vec(&error_json).unwrap();
                set_response_body(error_bytes);
                set_response_status(StatusCode::PAYMENT_REQUIRED);
                add_response_header("Content-Type".to_string(), "application/json".to_string());
                return Ok("".to_string());
            }

            // Encode settle response for X-PAYMENT-RESPONSE header
            let settle_json = serde_json::to_vec(&settle_result)
                .map_err(|e| format!("Failed to serialize settle response: {}", e))?;

            // Base64 encode for header
            let encoded_len = Base64::encoded_len(&settle_json);
            let mut buf = vec![0u8; encoded_len];
            let settle_b64 = Base64::encode(&settle_json, &mut buf)
                .map_err(|e| format!("Failed to base64 encode settlement response: {}", e))?
                .to_string();

            // Return upstream response with X-PAYMENT-RESPONSE header
            set_response_body(upstream_response.into_bytes());
            set_response_status(StatusCode::OK);
            add_response_header("Content-Type".to_string(), "application/json".to_string());
            add_response_header("X-PAYMENT-RESPONSE".to_string(), settle_b64);

            info!("Payment flow completed successfully for provider '{}'", provider_name);
            return Ok("".to_string());
        }

        // ===== BRANCH: 402 PAYMENT REQUIRED FLOW =====
        info!("No X-PAYMENT header, returning 402 Payment Required");

        let payment_reqs = build_payment_requirements(&provider, &resource_url);
        let payment_json = serde_json::to_vec(&payment_reqs)
            .map_err(|e| format!("Failed to serialize payment requirements: {}", e))?;

        set_response_body(payment_json);
        set_response_status(StatusCode::PAYMENT_REQUIRED);
        add_response_header("Content-Type".to_string(), "application/json".to_string());

        info!("Returning 402 Payment Required for provider '{}'", provider_name);
        Ok("".to_string())
    }

    #[http]
    async fn get_provider_namehash(&self, provider_name: String) -> Result<String, String> {
        debug!("Getting namehash for provider: {}", provider_name);

        // Verify provider exists in our registry
        let provider = self
            .registered_providers
            .iter()
            .find(|p| p.provider_name == provider_name)
            .ok_or(format!("Provider '{}' not found in registry", provider_name))?;

        // Use the hypermap library to calculate the correct namehash
        // This ensures consistency with the on-chain registration
        let namespace = &HYPR_SUFFIX[1..]; // Remove the leading dot from ".grid.hypr" to get "grid.hypr"
        let full_name = format!("{}.{}", provider.provider_name, namespace);
        let namehash = hypermap::namehash(&full_name);

        debug!("Calculated namehash for '{}': {}", full_name, namehash);
        Ok(namehash)
    }

    /// Get all providers from the operator's indexed database
    #[http]
    async fn get_indexed_providers(&self) -> Result<String, String> {
        debug!("Fetching indexed providers");

        let db = load_provider_db().await.map_err(|e| {
            format!("Failed to load provider database: {}", e)
        })?;

        let providers = get_all_indexed_providers(&db).await.map_err(|e| {
            format!("Failed to fetch indexed providers: {}", e)
        })?;

        let json_providers: Vec<serde_json::Value> = providers
            .into_iter()
            .map(|provider| serde_json::to_value(provider).unwrap_or_default())
            .collect();

        debug!("Retrieved {} indexed providers", json_providers.len());

        serde_json::to_string(&json_providers).map_err(|e| {
            format!("Failed to serialize providers to JSON: {}", e)
        })
    }

    /// Search indexed providers by query
    #[http]
    async fn search_indexed_providers(&self, query: String) -> Result<String, String> {
        debug!("Searching indexed providers with query: {}", query);

        let db = load_provider_db().await.map_err(|e| {
            format!("Failed to load provider database: {}", e)
        })?;

        let providers = search_indexed_providers(&db, query.clone()).await.map_err(|e| {
            format!("Failed to search indexed providers: {}", e)
        })?;

        let json_providers: Vec<serde_json::Value> = providers
            .into_iter()
            .map(|provider| serde_json::to_value(provider).unwrap_or_default())
            .collect();

        debug!("Found {} providers matching query '{}'", json_providers.len(), query);

        serde_json::to_string(&json_providers).map_err(|e| {
            format!("Failed to serialize providers to JSON: {}", e)
        })
    }

    /// Get specific provider details from indexed database by name
    #[http]
    async fn get_indexed_provider_details(&self, name: String) -> Result<String, String> {
        debug!("Getting indexed provider details for name: {}", name);

        let db = load_provider_db().await.map_err(|e| {
            format!("Failed to load provider database: {}", e)
        })?;

        let provider = get_indexed_provider_by_name(&db, &name).await.map_err(|e| {
            format!("Failed to get provider details: {}", e)
        })?;

        let result = provider.map(|p| serde_json::to_value(p).unwrap_or_default());

        match &result {
            Some(_) => debug!("Found indexed provider details for '{}'", name),
            None => debug!("No indexed provider found for '{}'", name),
        }

        serde_json::to_string(&result).map_err(|e| {
            format!("Failed to serialize provider details to JSON: {}", e)
        })
    }

    /// Get provider state synchronization status
    #[http]
    async fn get_provider_sync_status(&self) -> Result<String, String> {
        debug!("Checking provider sync status");

        let db = load_provider_db().await.map_err(|e| {
            format!("Failed to load provider database: {}", e)
        })?;

        let comparison = compare_with_indexed_state(&self.registered_providers, &db).await.map_err(|e| {
            format!("Failed to compare provider states: {}", e)
        })?;

        let status = serde_json::json!({
            "is_synchronized": comparison.is_synchronized(),
            "summary": comparison.summary(),
            "total_local": comparison.total_local,
            "missing_from_index": comparison.missing_from_index,
            "mismatched": comparison.mismatched,
            "has_issues": !comparison.is_synchronized()
        });

        serde_json::to_string(&status).map_err(|e| {
            format!("Failed to serialize sync status to JSON: {}", e)
        })
    }

    #[local]
    async fn terminal_command(&mut self, command: TerminalCommand) -> Result<String, String> {
        match command {
            TerminalCommand::ListProviders => {
                debug!("Listing registered providers");
                Ok(format!(
                    "Registered providers: {:?}",
                    self.registered_providers
                ))
            }
            TerminalCommand::RegisterProvider(provider) => {
                debug!("Registering provider: {:?}", provider);
                if self
                    .registered_providers
                    .iter()
                    .any(|p| p.provider_name == provider.provider_name)
                {
                    let error_msg = format!(
                        "Provider with name '{}' already registered.",
                        provider.provider_name
                    );
                    warn!("{}", error_msg);
                    return Err(error_msg);
                }
                self.registered_providers.push(provider.clone());
                debug!(
                    "Successfully registered provider: {}",
                    provider.provider_name
                );

                // Save to VFS
                if let Err(e) = self.save_providers_to_vfs() {
                    error!("Failed to save providers to VFS: {}", e);
                }

                Ok(format!(
                    "Successfully registered provider: {}",
                    provider.provider_name
                ))
            }
            TerminalCommand::UnregisterProvider(provider_name) => {
                debug!("Unregistering provider: {}", provider_name);
                self.registered_providers
                    .retain(|p| p.provider_name != provider_name);

                // Save to VFS
                if let Err(e) = self.save_providers_to_vfs() {
                    error!("Failed to save providers to VFS after unregister: {}", e);
                }

                debug!("Successfully unregistered provider: {}", provider_name);
                Ok(format!(
                    "Successfully unregistered provider: {}",
                    provider_name
                ))
            }
            TerminalCommand::TestProvider(provider_request) => {
                debug!(
                    "Testing provider: {}, with dynamic args: {:?}, and tx hash: {:?}",
                    provider_request.provider_name,
                    provider_request.arguments,
                    provider_request.payment_tx_hash,
                );

                let source_node_id = "anotherdayanothertestingnodeweb.os".to_string();

                //validate_transaction_payment(&provider_request, self, source_node_id.clone()).await?;


                let registered_provider = match self
                    .registered_providers
                    .iter()
                    .find(|p| p.provider_name == provider_request.provider_name)
                {
                    Some(provider) => provider,
                    None => {
                        let error_msg = format!(
                            "Provider with name '{}' not found in registered providers.",
                            provider_request.provider_name
                        );
                        warn!("{}", error_msg);
                        return Err(error_msg);
                    }
                };

                debug!("Registered provider: {:?}", registered_provider);

                let result = call_provider(
                    registered_provider.provider_name.clone(),
                    registered_provider.endpoint.clone(),
                    &provider_request.arguments,
                    source_node_id,
                )
                .await;

                debug!("Result: {:?}", result);

                match result {
                    Ok(response) => Ok(response),
                    Err(e) => Err(e),
                }
            }
            TerminalCommand::ExportProviders => {
                debug!("Exporting providers as JSON");
                match self.export_providers_json() {
                    Ok(json_data) => {
                        debug!(
                            "Exported {} providers:\n{}",
                            self.registered_providers.len(),
                            json_data
                        );
                        Ok(format!(
                            "Successfully exported {} providers",
                            self.registered_providers.len()
                        ))
                    }
                    Err(e) => {
                        debug!("Failed to export providers: {}", e);
                        Err(e)
                    }
                }
            },
            TerminalCommand::ViewDatabase => {
                debug!("Viewing database");

                let db = load_provider_db().await.map_err(|e| {
                    format!("Failed to load provider database: {}", e)
                })?;

                let providers = get_all_indexed_providers(&db).await.map_err(|e| {
                    format!("Failed to fetch indexed providers: {}", e)
                })?;

                let json_providers: Vec<serde_json::Value> = providers
                    .into_iter()
                    .map(|provider| serde_json::to_value(provider).unwrap_or_default())
                    .collect();

                Ok(format!("Database: {:?}", json_providers))
            }
        }
    }
}

// Helper functions for data conversion
impl EndpointDefinition {
    /// Create an empty EndpointDefinition for migration purposes
    pub fn empty() -> Self {
        Self {
            original_curl: String::new(),
            method: "GET".to_string(),
            base_url: String::new(),
            url_template: String::new(),
            original_headers: Vec::new(),
            original_body: None,
            parameters: Vec::new(),
            parameter_names: Vec::new(),
        }
    }

    /// Check if this endpoint definition is empty (needs configuration)
    pub fn is_empty(&self) -> bool {
        self.original_curl.is_empty() &&
        self.base_url.is_empty() &&
        self.url_template.is_empty()
    }

    /// Parse the original_body string as JSON, returning None if parsing fails or field is None
    pub fn get_original_body_json(&self) -> Option<serde_json::Value> {
        self.original_body.as_ref()
            .and_then(|body_str| serde_json::from_str(body_str).ok())
    }

    /// Convert original_headers Vec<(String, String)> to HashMap<String, String> for processing
    pub fn get_original_headers_map(&self) -> HashMap<String, String> {
        self.original_headers.iter()
            .cloned()
            .collect()
    }
}


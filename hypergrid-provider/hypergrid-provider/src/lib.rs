use hyperprocess_macro::hyperprocess;
use hyperware_app_common::hyperware_process_lib::kiprintln;
use hyperware_process_lib::eth::Address as EthAddress;
use hyperware_process_lib::{eth::Provider, hypermap, our, homepage::add_to_homepage, get_state, logging::{info, error}};
use serde::{Deserialize, Serialize};
use rmp_serde;
use std::str::FromStr; // Needed for EthAddress::from_str

pub const CHAIN_ID: u64 = hypermap::HYPERMAP_CHAIN_ID;

mod util; // Declare the util module
use util::*; // Use its public items


const ICON: &str = include_str!("./icon");
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ProviderRequest {
    pub provider_name: String,
    pub arguments: Vec<(String, String)>,
    pub payment_tx_hash: Option<String>,
    pub endpoint: EndpointDefinition,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DummyArgument {
    pub argument: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DummyResponse {
    pub response: String,
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

#[derive(PartialEq, Clone, Debug, Serialize, Deserialize)]
pub enum TerminalCommand {
    ListProviders,
    RegisterProvider(RegisteredProvider),
    UnregisterProvider(String),
    TestProvider(TestProviderArgs),
}
#[derive(PartialEq, Clone, Debug, Serialize, Deserialize)]
pub struct TestProviderArgs {
    pub provider_name: String,
    pub args: Vec<(String, String)>,
}

// --- Modified EndpointDefinition ---
#[derive(PartialEq, Clone, Debug, Serialize, Deserialize)]
pub struct EndpointDefinition {
    pub name: String,                            // Operation name, e.g., "getUserById"
    pub method: HttpMethod,                      // GET, POST
    pub request_structure: RequestStructureType, // Explicitly define the structure
    pub base_url_template: String, // e.g., "https://api.example.com/users/{id}" or "https://api.example.com/v{apiVersion}/users"
    pub path_param_keys: Option<Vec<String>>, // Keys for placeholders in base_url_template, relevant for GetWithPath, PostWithJson
    pub query_param_keys: Option<Vec<String>>, // Keys for dynamic query params, relevant for GetWithQuery, PostWithJson
    pub header_keys: Option<Vec<String>>, // Keys for dynamic headers (always potentially relevant)
    pub body_param_keys: Option<Vec<String>>, // Keys for dynamic body params, relevant for PostWithJson

    pub api_key: Option<String>, // The actual secret key

    pub api_key_query_param_name: Option<String>, // e.g., "api_key"
    pub api_key_header_name: Option<String>,      // e.g., "X-API-Key"
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
}



impl HypergridProviderState {
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
        }
    }

    /// Loads old state from disk, falls back to new() if none exists
    pub fn load() -> Self {
        match get_state() {
            Some(bytes) => {
                match serde_json::from_slice::<Self>(&bytes) {
                    Ok(state) => {
                        println!("Successfully loaded HypergridProviderState from checkpoint.");
                        state
                    }
                    Err(e) => {
                        error!("Failed to deserialize HpnProviderState with rmp_serde: {}, creating new state", e);
                        Self::new()
                    }
                }
            }
            None => {
                info!("No saved state found. Creating new state.");
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

// --- Hyperware Process ---
#[hyperprocess(
    name = "hypergrid-provider",
    ui = Some(HttpBindingConfig::default()),
    endpoints = vec![
        Binding::Http {
            path: "/api",
            config: HttpBindingConfig::new(false, false, false, None),
        },
        Binding::Ws {
            path: "/ws",
            config: WsBindingConfig::new(false, false, false),
        }
    ],
    save_config = SaveOptions::EveryMessage,
    wit_world = "hypergrid-provider-template-dot-os-v0"
)]

// --- Hyperware Process API definitions ---
impl HypergridProviderState {
    #[init]
    async fn initialize(&mut self) {
        println!("Initializing provider registry");
        *self = HypergridProviderState::load();
        add_to_homepage("Hypergrid Provider Dashboard", Some(ICON), Some("/"), None);
    }

    #[local]
    #[remote]
    async fn health_ping(&self, _arg: DummyArgument) -> Result<String, String> {
        Ok("Ack".to_string())
    }

    #[http]
    async fn register_provider(
        &mut self,
        provider: RegisteredProvider,
    ) -> Result<RegisteredProvider, String> {
        info!("Registering provider: {:?}", provider);
        if self
            .registered_providers
            .iter()
            .any(|p| p.provider_name == provider.provider_name)
        {
            return Err(format!(
                "Provider with name '{}' already registered.",
                provider.provider_name
            ));
        }

        let unique_id = format!("{}_{}_{}",
            our().node.to_string(),
            provider.provider_name,
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs()
        );
        let provider_with_id = RegisteredProvider {
            provider_id: unique_id,
            ..provider
        };

        self.registered_providers.push(provider_with_id.clone());
        info!(
            "Successfully registered provider: {}",
            provider_with_id.provider_name
        );

        // Attempt manual save for diagnostics
        match rmp_serde::to_vec(self) {
            Ok(bytes) => {
                hyperware_process_lib::set_state(&bytes);
                info!("Manually called set_state with {} bytes.", bytes.len());
            }
            Err(e) => {
                error!("Manual save: Failed to serialize HpnProviderState: {}", e);
            }
        }

        Ok(provider_with_id)
    }

    #[http]
    async fn update_provider(
        &mut self,
        provider_name: String,
        updated_provider: RegisteredProvider,
    ) -> Result<RegisteredProvider, String> {
        info!("Updating provider: {}", provider_name);
        
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
                    if self.registered_providers.iter().any(|p| p.provider_name == updated_provider.provider_name) {
                        return Err(format!(
                            "A provider with name '{}' already exists. Please choose a different name.",
                            updated_provider.provider_name
                        ));
                    }
                }
                
                let updated_provider_with_id = if name_changed {
                    // If name changed, create new provider with new ID (essentially a new registration)
                    let unique_id = format!("{}_{}_{}",
                        our().node.to_string(),
                        updated_provider.provider_name,
                        std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_secs()
                    );
                    RegisteredProvider {
                        provider_id: unique_id, // Generate truly unique ID
                        ..updated_provider
                    }
                } else {
                    // If name unchanged, keep the original provider_id
                    let original_provider_id = self.registered_providers[index].provider_id.clone();
                    RegisteredProvider {
                        provider_name: provider_name.clone(), // Keep original name
                        provider_id: original_provider_id,    // Keep original ID
                        ..updated_provider
                    }
                };
                
                // Update the provider
                self.registered_providers[index] = updated_provider_with_id.clone();
                
                info!("Successfully updated provider: {} -> {}", provider_name, updated_provider_with_id.provider_name);
                
                // Manual save for diagnostics
                match rmp_serde::to_vec(self) {
                    Ok(bytes) => {
                        hyperware_process_lib::set_state(&bytes);
                        info!("Manually called set_state with {} bytes after update.", bytes.len());
                    }
                    Err(e) => {
                        error!("Manual save after update: Failed to serialize HypergridProviderState: {}", e);
                    }
                }
                
                Ok(updated_provider_with_id)
            }
            None => {
                Err(format!(
                    "Provider with name '{}' not found for update.",
                    provider_name
                ))
            }
        }
    }

    #[remote]
    async fn call_provider(
        &mut self,
        request: ProviderRequest,
    ) -> Result<String, String> {

        let mcp_request = match request {
            ProviderRequest { .. } => request,
        };
        info!("Received remote call for provider: {}", mcp_request.provider_name);

        // --- 0. Check if provider exists at all ---
        // First validate the payment before accessing registered_provider
        if !self.registered_providers.iter().any(|p| p.provider_name == mcp_request.provider_name) {
            return Err(format!(
                "Provider '{}' not found - please make sure to enter a valid, registered provider name",
                mcp_request.provider_name
            ));
        }

        // Get the source node ID ---
        let source_address = source();
        // goobersync.os
        let source_node_id = source_address.node().to_string();

        // --- 1. Validate the payment ---
        if let Err(validation_err) =
            validate_transaction_payment(&mcp_request, self, source_node_id.clone()).await
        {
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

        // --- 2. Call the provider ---
        let api_call_result = call_provider(
            // This is the HTTP call_provider
            registered_provider.provider_name.clone(),
            registered_provider.endpoint.clone(),
            &mcp_request.arguments,
            source_node_id, // this makes sure User-Agent is node ID
        )
        .await;

        match api_call_result {
            Ok(response) => Ok(response),
            Err(e) => Err(e), // The error from call_provider is already a String
        }
    }

    #[http]
    async fn get_registered_providers(&self) -> Result<Vec<RegisteredProvider>, String> {
        info!("Fetching registered providers");
        Ok(self.registered_providers.clone())
    }


    #[local]
    async fn terminal_command(&mut self, command: TerminalCommand) -> Result<String, String> {
        match command {
            TerminalCommand::ListProviders => {
                kiprintln!("Listing registered providers");
                Ok(format!(
                    "Registered providers: {:?}",
                    self.registered_providers
                ))
            }
            TerminalCommand::RegisterProvider(provider) => {
                kiprintln!("Registering provider: {:?}", provider);
                if self
                    .registered_providers
                    .iter()
                    .any(|p| p.provider_name == provider.provider_name)
                {
                    return Err(format!(
                        "Provider with name '{}' already registered.",
                        provider.provider_name
                    ));
                }
                self.registered_providers.push(provider.clone());
                kiprintln!(
                    "Successfully registered provider: {}",
                    provider.provider_name
                );

                Ok(format!(
                    "Successfully registered provider: {}",
                    provider.provider_name
                ))
            }
            TerminalCommand::UnregisterProvider(provider_name) => {
                kiprintln!("Unregistering provider: {}", provider_name);
                self.registered_providers
                    .retain(|p| p.provider_name != provider_name);

                kiprintln!("Successfully unregistered provider: {}", provider_name);
                Ok(format!(
                    "Successfully unregistered provider: {}",
                    provider_name
                ))
            }
            TerminalCommand::TestProvider(test_provider_args) => {
                kiprintln!(
                    "Testing provider: {}, with dynamic args: {:?}",
                    test_provider_args.provider_name,
                    test_provider_args.args
                );

                let registered_provider = match self
                    .registered_providers
                    .iter()
                    .find(|p| p.provider_name == test_provider_args.provider_name)
                {
                    Some(provider) => provider,
                    None => {
                        return Err(format!(
                            "Provider with name '{}' not found in registered providers.",
                            test_provider_args.provider_name
                        ));
                    }
                };

                kiprintln!("Registered provider: {:?}", registered_provider);

                let source_str = "default-node".to_string();
                
                let result = call_provider(
                    registered_provider.provider_name.clone(),
                    registered_provider.endpoint.clone(),
                    &test_provider_args.args,
                    source_str
                )
                .await;

                kiprintln!("Result: {:?}", result);

                match result {
                    Ok(response) => Ok(response),
                    Err(e) => Err(e),
                }
            }
        }
    }
}



//use hyperprocess_macro::hyperprocess;
//use hyperware_app_common::hyperware_process_lib::kiprintln;
//use hyperware_process_lib::eth::Address as EthAddress;
//use hyperware_process_lib::{eth::Provider, hypermap, our, homepage::add_to_homepage};
//use serde::{Deserialize, Serialize};
//use serde_json;
//use std::str::FromStr; // Needed for EthAddress::from_str
//
//pub const CHAIN_ID: u64 = hypermap::HYPERMAP_CHAIN_ID;
//
//mod util; // Declare the util module
//use util::*; // Use its public items
//
//
//const ICON: &str = include_str!("./icon");
//#[derive(Clone, Debug, Serialize, Deserialize)]
//pub struct ProviderRequest {
//    pub provider_name: String,
//    pub arguments: Vec<(String, String)>,
//    pub payment_tx_hash: Option<String>,
//}
//
//// Type system for API endpoints
//#[derive(PartialEq, Clone, Debug, Serialize, Deserialize)]
//pub enum HttpMethod {
//    GET,
//    POST,
//}
//
//// --- Added Enum for Request Structure ---
//#[derive(PartialEq, Clone, Debug, Serialize, Deserialize)]
//pub enum RequestStructureType {
//    GetWithPath,
//    GetWithQuery,
//    PostWithJson,
//}
//
//#[derive(PartialEq, Clone, Debug, Serialize, Deserialize)]
//pub enum TerminalCommand {
//    ListProviders,
//    RegisterProvider(RegisteredProvider),
//    UnregisterProvider(String),
//    TestProvider(TestProviderArgs),
//}
//#[derive(PartialEq, Clone, Debug, Serialize, Deserialize)]
//pub struct TestProviderArgs {
//    pub provider_name: String,
//    pub args: Vec<(String, String)>,
//}
//
//// --- Modified EndpointDefinition ---
//#[derive(PartialEq, Clone, Debug, Serialize, Deserialize)]
//pub struct EndpointDefinition {
//    pub name: String,                            // Operation name, e.g., "getUserById"
//    pub method: HttpMethod,                      // GET, POST
//    pub request_structure: RequestStructureType, // Explicitly define the structure
//    pub base_url_template: String, // e.g., "https://api.example.com/users/{id}" or "https://api.example.com/v{apiVersion}/users"
//    pub path_param_keys: Option<Vec<String>>, // Keys for placeholders in base_url_template, relevant for GetWithPath, PostWithJson
//    pub query_param_keys: Option<Vec<String>>, // Keys for dynamic query params, relevant for GetWithQuery, PostWithJson
//    pub header_keys: Option<Vec<String>>, // Keys for dynamic headers (always potentially relevant)
//    pub body_param_keys: Option<Vec<String>>, // Keys for dynamic body params, relevant for PostWithJson
//
//    pub api_key: Option<String>, // The actual secret key
//
//    pub api_key_query_param_name: Option<String>, // e.g., "api_key"
//    pub api_key_header_name: Option<String>,      // e.g., "X-API-Key"
//}
//
//// --- New Provider Struct ---
//#[derive(PartialEq, Clone, Debug, Serialize, Deserialize)]
//pub struct RegisteredProvider {
//    pub provider_name: String,
//    // Provide Node Identity (HNS entry (Node Identity) of the the process serving as the provider)
//    pub provider_id: String,
//    pub description: String,
//    // TODO: This should be an EthAddress, but that is not supported by WIT parser (yet)
//    // We should validate this is a valid address before storing it
//    pub registered_provider_wallet: String,
//    // Price per call in USDC, should be clear in HNS entry
//    pub price: f64,
//    pub endpoint: EndpointDefinition,
//}
//
//#[derive(Clone, Debug, Serialize, Deserialize)]
//pub struct HypergridProviderState {
//    pub registered_providers: Vec<RegisteredProvider>,
//    pub spent_tx_hashes: Vec<String>,
//    pub rpc_provider: Provider, // For general ETH RPC (e.g., tx receipts on various chains)
//    pub hypermap: hypermap::Hypermap, // For Hypermap specific calls (e.g., on Base chain)
//}
//
//impl Default for HypergridProviderState {
//    fn default() -> Self {
//        let hypermap_timeout = 60; // RPC Provider timeout
//
//        // Provider specifically for Hypermap, using its defined chain and address
//        let provider = Provider::new(hypermap::HYPERMAP_CHAIN_ID, hypermap_timeout);
//        let hypermap_contract_address = EthAddress::from_str(hypermap::HYPERMAP_ADDRESS)
//            .expect("HYPERMAP_ADDRESS const should be a valid Ethereum address");
//
//        Self {
//            registered_providers: Vec::new(),
//            spent_tx_hashes: Vec::new(),
//            rpc_provider: provider.clone(), // Example: Default to Ethereum Mainnet (chain 1), 60s timeout
//            hypermap: hypermap::Hypermap::new(provider.clone(), hypermap_contract_address),
//        }
//    }
//}
//
//
//// --- Hyperware Process ---
//#[hyperprocess(
//    name = "hpn-provider",
//    ui = Some(HttpBindingConfig::default()),
//    endpoints = vec![
//        Binding::Http {
//            path: "/api",
//            config: HttpBindingConfig::new(false, false, false, None),
//        },
//        Binding::Ws {
//            path: "/ws",
//            config: WsBindingConfig::new(false, false, false),
//        }
//    ],
//    save_config = SaveOptions::EveryMessage,
//    wit_world = "hpn-provider-template-dot-os-v0"
//)]
//
//// --- Hyperware Process API definitions ---
//impl HypergridProviderState {
//    #[init]
//    async fn initialize(&mut self) {
//        println!("Initializing provider registry");
//        *self = HypergridProviderState::default();
//        add_to_homepage("HPN Provider Dashboard", Some(ICON), Some("/"), None);
//    }
//
//    #[http]
//    async fn register_provider(
//        &mut self,
//        provider: RegisteredProvider,
//    ) -> Result<RegisteredProvider, String> {
//        println!("Registering provider: {:?}", provider);
//        if self
//            .registered_providers
//            .iter()
//            .any(|p| p.provider_name == provider.provider_name)
//        {
//            return Err(format!(
//                "Provider with name '{}' already registered.",
//                provider.provider_name
//            ));
//        }
//
//        let provider_with_id = RegisteredProvider {
//            provider_id: our().node.to_string(),
//            ..provider
//        };
//
//        self.registered_providers.push(provider_with_id.clone());
//        println!(
//            "Successfully registered provider: {}",
//            provider_with_id.provider_name
//        );
//        Ok(provider_with_id)
//    }
//
//
//    #[remote]
//    async fn call_provider(
//        &mut self,
//        request: ProviderRequest,
//    ) -> Result<String, String> {
//
//        let mcp_request = match request {
//            req => req,
//            _ => return Err("Invalid provider request structure, got: {:?}. Please make sure to use the correct request structure for the provider call.".to_string()),
//        };
//        
//        println!("Received remote call for provider: {}", mcp_request.provider_name);
//
//        // --- 0. Check if provider exists at all ---
//        // First validate the payment before accessing registered_provider
//        if !self.registered_providers.iter().any(|p| p.provider_name == mcp_request.provider_name) {
//            return Err(format!(
//                "Provider '{}' not found - please make sure to enter a valid, registered provider name",
//                mcp_request.provider_name
//            ));
//        }
//
//        // Get the source node ID ---
//        let source_address = source();
//        // goobersync.os
//        let source_node_id = source_address.node().to_string();
//
//        // --- 1. Validate the payment ---
//        if let Err(validation_err) =
//            validate_transaction_payment(&mcp_request, self, source_node_id.clone()).await
//        {
//            return Err(validation_err);
//        }
//        // We can safely unwrap here since validate_transaction_payment already checked
//        // that the provider exists in the registered_providers list
//        let registered_provider = self
//            .registered_providers
//            .iter()
//            .find(|p| p.provider_name == mcp_request.provider_name)
//            .expect(&format!(
//                "Provider '{}' not found - this should never happen as it was validated in `validate_transaction_payment`",
//                mcp_request.provider_name
//            ));
//
//        // --- 2. Call the provider ---
//        let api_call_result = call_provider(
//            // This is the HTTP call_provider
//            registered_provider.provider_name.clone(),
//            registered_provider.endpoint.clone(),
//            &mcp_request.arguments,
//            source_node_id, // this makes sure User-Agent is node ID
//        )
//        .await;
//
//        match api_call_result {
//            Ok(response) => Ok(response),
//            Err(e) => Err(e), // The error from call_provider is already a String
//        }
//    }
//
//    #[http]
//    async fn get_registered_providers(&self) -> Result<Vec<RegisteredProvider>, String> {
//        println!("Fetching registered providers");
//        Ok(self.registered_providers.clone())
//    }
//
//
//    #[local]
//    async fn terminal_command(&mut self, command: TerminalCommand) -> Result<String, String> {
//        match command {
//            TerminalCommand::ListProviders => {
//                kiprintln!("Listing registered providers");
//                Ok(format!(
//                    "Registered providers: {:?}",
//                    self.registered_providers
//                ))
//            }
//            TerminalCommand::RegisterProvider(provider) => {
//                kiprintln!("Registering provider: {:?}", provider);
//                if self
//                    .registered_providers
//                    .iter()
//                    .any(|p| p.provider_name == provider.provider_name)
//                {
//                    return Err(format!(
//                        "Provider with name '{}' already registered.",
//                        provider.provider_name
//                    ));
//                }
//                self.registered_providers.push(provider.clone());
//                kiprintln!(
//                    "Successfully registered provider: {}",
//                    provider.provider_name
//                );
//
//                Ok(format!(
//                    "Successfully registered provider: {}",
//                    provider.provider_name
//                ))
//            }
//            TerminalCommand::UnregisterProvider(provider_name) => {
//                kiprintln!("Unregistering provider: {}", provider_name);
//                self.registered_providers
//                    .retain(|p| p.provider_name != provider_name);
//
//                kiprintln!("Successfully unregistered provider: {}", provider_name);
//                Ok(format!(
//                    "Successfully unregistered provider: {}",
//                    provider_name
//                ))
//            }
//            TerminalCommand::TestProvider(test_provider_args) => {
//                kiprintln!(
//                    "Testing provider: {}, with dynamic args: {:?}",
//                    test_provider_args.provider_name,
//                    test_provider_args.args
//                );
//
//                let registered_provider = match self
//                    .registered_providers
//                    .iter()
//                    .find(|p| p.provider_name == test_provider_args.provider_name)
//                {
//                    Some(provider) => provider,
//                    None => {
//                        return Err(format!(
//                            "Provider with name '{}' not found in registered providers.",
//                            test_provider_args.provider_name
//                        ));
//                    }
//                };
//
//                kiprintln!("Registered provider: {:?}", registered_provider);
//
//                let source_str = "default-node".to_string();
//                
//                let result = call_provider(
//                    registered_provider.provider_name.clone(),
//                    registered_provider.endpoint.clone(),
//                    &test_provider_args.args,
//                    source_str
//                )
//                .await;
//
//                kiprintln!("Result: {:?}", result);
//
//                match result {
//                    Ok(response) => Ok(response),
//                    Err(e) => Err(e),
//                }
//            }
//        }
//    }
//}
//

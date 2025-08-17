use hyperprocess_macro::hyperprocess;
use hyperware_app_common::get_server;
use hyperware_app_common::hyperware_process_lib::kiprintln;
use hyperware_app_common::hyperware_process_lib::logging::RemoteLogSettings;
use hyperware_app_common::hyperware_process_lib::{
    eth::{Provider, Address as EthAddress},
    get_state,
    hypermap,
    logging::{debug, error, info, warn, init_logging, Level},
    our,
    vfs::{create_drive, create_file, open_file},
    Address,
};
use crate::constants::HYPR_SUFFIX;
use hyperware_app_common::{source, SaveOptions, sleep};
use rmp_serde;
use serde::{Deserialize, Serialize};
use serde_json;
use std::str::FromStr; // Needed for EthAddress::from_str

pub const CHAIN_ID: u64 = hypermap::HYPERMAP_CHAIN_ID;

mod util; // Declare the util module
use util::*; // Use its public items

mod db; // Declare the db module  
use db::*; // Use its public items

mod curl_executor; // Declare the curl_executor module
use curl_executor::*; // Use its public items

pub mod constants; // Declare the constants module
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ProviderRequest {
    pub provider_name: String,
    pub arguments: Vec<(String, String)>,
    pub payment_tx_hash: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DummyArgument {
    pub argument: String,
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

// Type system for API endpoints - kept for backward compatibility
#[derive(PartialEq, Clone, Debug, Serialize, Deserialize)]
pub enum HttpMethod {
    GET,
    POST,
}

// --- Added Enum for Request Structure - kept for backward compatibility ---
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

// --- New Variable struct for curl templates ---
#[derive(PartialEq, Clone, Debug, Serialize, Deserialize)]
pub struct Variable {
    pub name: String,
    pub example_value: Option<String>,
}

// --- New EndpointDefinition with curl templates ---
#[derive(PartialEq, Clone, Debug, Serialize, Deserialize)]
pub struct EndpointDefinition {
    pub name: String,
    pub curl_template: String,
    pub variables: Vec<Variable>,
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
                info!("Created VFS drive for providers at: {}", drive_path);
                self.vfs_drive_path = Some(drive_path);

                // Try to load existing providers from VFS
                if let Err(e) = self.load_providers_from_vfs() {
                    info!("No existing providers in VFS or error loading: {}", e);
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

        info!("Saved {} providers to VFS", self.registered_providers.len());
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
        info!(
            "Loaded {} providers from VFS",
            self.registered_providers.len()
        );
        Ok(())
    }

    /// Export providers as JSON string (for easy export functionality)
    pub fn export_providers_json(&self) -> Result<String, String> {
        let json_data =
            serde_json::to_string_pretty(&self.registered_providers).map_err(Self::to_err)?;

        info!(
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
                    info!("Successfully loaded HypergridProviderState from checkpoint.");
                    state
                }
                Err(e) => {
                    error!("Failed to deserialize HypergridProviderState with rmp_serde: {}, creating new state", e);
                    Self::new()
                }
            },
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
    name = "provider",
    ui = None,
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
    wit_world = "provider-template-dot-os-v0"
)]

// --- Hyperware Process API definitions ---
impl HypergridProviderState {
    #[init]
    async fn initialize(&mut self) {
        let remote_logger: RemoteLogSettings = RemoteLogSettings { target: Address::new("hypergrid-logger.os", ("logging", "logging", "nick.hypr") ), level: Level::ERROR };
        // Initialize tracing-based logging for the provider process
        init_logging(Level::DEBUG, Level::INFO, Some(remote_logger), None, None).expect("Failed to initialize logging");
        info!("Initializing Hypergrid Provider");
        
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
    async fn health_ping(&self, arg: DummyArgument) -> Result<String, String> {
        info!("Health ping received: {:?}", arg);
        Ok("Ack".to_string())
    }

    #[http]
    async fn register_provider(
        &mut self,
        provider: RegisteredProvider,
    ) -> Result<RegisteredProvider, String> {
        info!("Registering provider: {:?}", provider);

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
        info!(
            "Successfully registered provider: {}",
            provider.provider_name
        );

        // Save to VFS
        if let Err(e) = self.save_providers_to_vfs() {
            error!("Failed to save providers to VFS: {}", e);
        }

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

        Ok(provider)
    }

    #[http]
    async fn validate_provider(
        &mut self,
        provider: RegisteredProvider,
        arguments: Vec<(String, String)>,
    ) -> Result<String, String> {
        info!("Validating provider: {:?}", provider);
        
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
            warn!("{}", error_msg);
            return Err(error_msg);
        }
        
        // Validate the endpoint by making a test call
        let validation_result = call_provider(
            provider.provider_name.clone(),
            provider.endpoint.clone(),
            &arguments,
            our().node.to_string(),
        )
        .await?;
        
        info!("Validation result: {}", validation_result);
        validate_response_status(&validation_result)
            .map_err(|e| format!("Validation failed: {}", e))?;

        info!("Provider validation successful: {}", provider.provider_name);
        Ok(validation_result)
    }



    #[http]
    async fn update_provider(
        &mut self,
        provider_name: String,
        updated_provider: RegisteredProvider,
    ) -> Result<RegisteredProvider, String> {
        info!("Provider update request received: {}", provider_name);

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
                        warn!("{}", error_msg);
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

                info!(
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
                        info!(
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
        info!(
            "Received remote call for provider: {}",
            mcp_request.provider_name
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
            warn!("{}", error_msg);
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
            error!(
                "Payment validation failed for provider '{}' from node '{}': {}",
                mcp_request.provider_name, source_node_id, validation_err
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
                    if attempt > 1 {
                        info!("Provider call succeeded on attempt {} of {}", attempt, MAX_RETRIES);
                    }
                    return Ok(response);
                },
                Err(e) => {
                    last_error = e.clone();
                    warn!("Provider call failed on attempt {} of {}: {}", attempt, MAX_RETRIES, e);
                    
                    // Don't sleep after the last attempt
                    if attempt < MAX_RETRIES {
                        // Add a small delay between retries to handle rate limiting and temporary issues
                        let _ = sleep(500).await;
                    }
                }
            }
        }
        
        // If we get here, all retries failed
        error!("All {} provider call attempts failed. Last error: {}", MAX_RETRIES, last_error);
        Err(last_error)
    }

    #[http]
    async fn get_registered_providers(&self) -> Result<Vec<RegisteredProvider>, String> {
        debug!("Fetching registered providers");
        Ok(self.registered_providers.clone())
    }

    #[http]
    async fn export_providers(&self) -> Result<String, String> {
        info!("Exporting providers as JSON");
        self.export_providers_json()
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
        
        let db = load_provider_db().map_err(|e| {
            format!("Failed to load provider database: {}", e)
        })?;
        
        let providers = get_all_indexed_providers(&db).map_err(|e| {
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
        
        let db = load_provider_db().map_err(|e| {
            format!("Failed to load provider database: {}", e)
        })?;
        
        let providers = search_indexed_providers(&db, query.clone()).map_err(|e| {
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
        
        let db = load_provider_db().map_err(|e| {
            format!("Failed to load provider database: {}", e)
        })?;
        
        let provider = get_indexed_provider_by_name(&db, &name).map_err(|e| {
            format!("Failed to get provider details: {}", e)
        })?;
        
        let result = provider.map(|p| serde_json::to_value(p).unwrap_or_default());
        
        match &result {
            Some(_) => info!("Found indexed provider details for '{}'", name),
            None => info!("No indexed provider found for '{}'", name),
        }
        
        serde_json::to_string(&result).map_err(|e| {
            format!("Failed to serialize provider details to JSON: {}", e)
        })
    }

    /// Get provider state synchronization status
    #[http]
    async fn get_provider_sync_status(&self) -> Result<String, String> {
        debug!("Checking provider sync status");
        
        let db = load_provider_db().map_err(|e| {
            format!("Failed to load provider database: {}", e)
        })?;
        
        let comparison = compare_with_indexed_state(&self.registered_providers, &db).map_err(|e| {
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

                validate_transaction_payment(&provider_request, self, source_node_id.clone()).await?;


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

                let db = load_provider_db().map_err(|e| {
                    format!("Failed to load provider database: {}", e)
                })?;

                let providers = get_all_indexed_providers(&db).map_err(|e| {
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


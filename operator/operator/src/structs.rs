use hyperware_process_lib::logging::info;
use hyperware_process_lib::sqlite::Sqlite;
use hyperware_process_lib::wallet::KeyStorage;

use hyperware_process_lib::our;
use hyperware_process_lib::{eth, hypermap};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::str::FromStr;
use std::time::{SystemTime, UNIX_EPOCH};

//#[cfg(feature = "legacy-mods")]
//use crate::authorized_services::HotWalletAuthorizedClient;

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq)]
pub enum ClientStatus {
    Active,
    Halted,
}

#[cfg(not(feature = "legacy-mods"))]
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct HotWalletAuthorizedClient {
    pub id: String,                            // e.g., "hypergrid-shim-uuid"
    pub name: String,                          // e.g., "Shim for 0x123...456"
    pub associated_hot_wallet_address: String, // The wallet that pays for calls
    pub authentication_token: String,          // SHA256 hash of the raw token
    pub capabilities: ServiceCapabilities,     // What the client can do
    pub status: ClientStatus,                  // Active or Halted
}

#[cfg(not(feature = "legacy-mods"))]
#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq)]
pub enum ServiceCapabilities {
    All,
    SearchOnly,
    CallProviders,
    None,
}

#[cfg(feature = "legacy-mods")]
wit_bindgen::generate!({
    path: "../target/wit",
    world: "process-v1",
    generate_unused_types: true,
    additional_derives: [serde::Deserialize, serde::Serialize, process_macros::SerdeJsonInto],
});

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ManagedWallet {
    pub id: String,           // Typically the wallet address
    pub name: Option<String>, // User-defined alias
    // WIT compatibility: Store KeyStorage as JSON string
    pub storage_json: String, // Encrypted or Decrypted storage serialized as JSON
    pub spending_limits: SpendingLimits, // Per-wallet limits
}

impl ManagedWallet {
    /// Get the KeyStorage from JSON
    pub fn get_storage(&self) -> Result<KeyStorage, serde_json::Error> {
        serde_json::from_str(&self.storage_json)
    }

    /// Set the KeyStorage as JSON
    pub fn set_storage(&mut self, storage: &KeyStorage) -> Result<(), serde_json::Error> {
        self.storage_json = serde_json::to_string(storage)?;
        Ok(())
    }

    /// Create a new ManagedWallet with KeyStorage
    pub fn new(
        id: String,
        name: Option<String>,
        storage: KeyStorage,
        spending_limits: SpendingLimits,
    ) -> Result<Self, serde_json::Error> {
        Ok(Self {
            id,
            name,
            storage_json: serde_json::to_string(&storage)?,
            spending_limits,
        })
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct SpendingLimits {
    pub max_per_call: Option<String>,
    pub max_total: Option<String>,
    pub currency: Option<String>, // Currency (e.g., "USDC") - Default to USDC
    pub total_spent: Option<String>, // Total amount spent so far (from hyperwallet)
}

// Struct to return combined details for the active account
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActiveAccountDetails {
    // Fields from WalletSummary
    pub id: String,
    pub name: Option<String>,
    pub address: String,
    pub is_encrypted: bool,
    pub is_selected: bool, // Should always be true if returned
    pub is_unlocked: bool, // Should always be true if returned
    // Added Balance fields (as formatted strings)
    pub eth_balance: Option<String>,
    pub usdc_balance: Option<String>,
}

/// Represents a summary of a wallet for UI lists.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WalletSummary {
    pub id: String,
    pub name: Option<String>,
    pub address: String, // Always include address derived from storage
    pub is_encrypted: bool,
    pub is_selected: bool,
    pub is_unlocked: bool, // Added: Reflects if signer is cached in backend
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LinkedHotWalletInfo {
    pub summary: WalletSummary, // Existing struct, good for base info
    pub delegation_status: Option<DelegationStatus>, // Existing enum
    pub needs_eth_funding: bool, // Specific to this hot wallet
    pub eth_balance_str: Option<String>, // Specific to this hot wallet
    pub funding_check_error: Option<String>, // For RPC errors during this wallet's funding check
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ProviderDetails {
    pub provider_id: String,
    pub price_str: String,
    pub wallet_address: String,
}
// --- End Wallet Management Structs ---

// IMPORTANT: This enum structure MUST remain backwards compatible for state deserialization
// The old state has this exact enum structure serialized, so we cannot change it to a struct
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub enum PaymentAttemptResult {
    Success {
        tx_hash: String,
        amount_paid: String, // Store as string for consistency (e.g., "0.0001")
        currency: String,    // e.g., "USDC"
    },
    Failed {
        error: String,
        amount_attempted: String,
        currency: String,
    },
    Skipped {
        reason: String, // e.g., "Wallet Locked", "Zero Price", "Limit Exceeded"
    },
    LimitExceeded {
        limit: String,
        amount_attempted: String,
        currency: String,
    },
}

// Custom serialization for PaymentAttemptResult to handle WIT compatibility
fn serialize_payment_result<S>(value: &Option<String>, serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    match value {
        Some(json_str) => serializer.serialize_some(json_str),
        None => serializer.serialize_none(),
    }
}

fn deserialize_payment_result<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: Deserializer<'de>,
{
    // First try to deserialize as a String (new format)
    let value = Option::<serde_json::Value>::deserialize(deserializer)?;

    match value {
        Some(serde_json::Value::String(s)) => Ok(Some(s)),
        Some(other) => {
            // Legacy format: deserialize PaymentAttemptResult and convert to JSON string
            let payment_result: PaymentAttemptResult =
                serde_json::from_value(other).map_err(serde::de::Error::custom)?;
            Ok(Some(
                serde_json::to_string(&payment_result).map_err(serde::de::Error::custom)?,
            ))
        }
        None => Ok(None),
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CallRecord {
    pub timestamp_start_ms: u64,
    pub provider_lookup_key: String,
    pub target_provider_id: String,
    pub call_args_json: String,
    #[serde(default)]
    pub response_json: Option<String>,
    pub call_success: bool,
    pub response_timestamp_ms: u64,
    // WIT compatibility: Store complex enum as JSON for serialization
    #[serde(
        serialize_with = "serialize_payment_result",
        deserialize_with = "deserialize_payment_result",
        skip_serializing_if = "Option::is_none"
    )]
    pub payment_result: Option<String>,
    pub duration_ms: u64,
    pub operator_wallet_id: Option<String>,
    #[serde(default)]
    pub client_id: Option<String>,
    #[serde(default)]
    pub provider_name: Option<String>, // Human tool name (e.g., haiku-message-answering-machine)
}

impl CallRecord {
    /// Get the payment result as the enum type
    pub fn get_payment_result(&self) -> Option<PaymentAttemptResult> {
        self.payment_result
            .as_ref()
            .and_then(|json_str| serde_json::from_str(json_str).ok())
    }

    /// Set the payment result from the enum type
    pub fn set_payment_result(&mut self, result: Option<PaymentAttemptResult>) {
        self.payment_result = result.and_then(|r| serde_json::to_string(&r).ok());
    }
}
// --- End Call History Structs ---

pub type PendingLogs = Vec<(eth::Log, u8)>;

// Constants still used by legacy code - TO BE REFACTORED
const HYPERMAP_ADDRESS: &str = hypermap::HYPERMAP_ADDRESS;
pub const DELAY_MS: u64 = 30_000;
pub const CHECKPOINT_MS: u64 = 300_000;
pub const CHAIN_ID: u64 = hypermap::HYPERMAP_CHAIN_ID;
pub const HYPERMAP_FIRST_BLOCK: u64 = hypermap::HYPERMAP_FIRST_BLOCK;

// Operator-specific constants
pub const OPERATOR_PROCESS_NAME: &str = "operator";
pub const OPERATOR_PACKAGE_NAME: &str = "hypergrid";
pub const OPERATOR_PUBLISHER: &str = "os";
pub const OPERATOR_API_PATH: &str = "/api";

// Default node names and paths
pub const DEFAULT_NODE_NAME: &str = "operator-node";
pub const MCP_ENDPOINT_PATH: &str = "/mcp";
pub const SHIM_CLIENT_PREFIX: &str = "hypergrid-shim";

// Helper functions to construct common paths
pub fn operator_api_base_path() -> String {
    format!(
        "/{}:{}:{}{}",
        OPERATOR_PROCESS_NAME, OPERATOR_PACKAGE_NAME, OPERATOR_PUBLISHER, OPERATOR_API_PATH
    )
}

pub fn operator_base_path() -> String {
    format!(
        "/{}:{}:{}",
        OPERATOR_PROCESS_NAME, OPERATOR_PACKAGE_NAME, OPERATOR_PUBLISHER
    )
}

pub fn generate_shim_client_id() -> String {
    format!("{}-{}", SHIM_CLIENT_PREFIX, uuid::Uuid::new_v4())
}

// Copied Provider struct definition from indexer
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Provider {
    pub name: String, // Changed from Name type alias for WIT compatibility
    pub hash: String,
    pub facts: Vec<(String, Vec<String>)>, // Changed from HashMap for WIT compatibility
    pub wallet: Option<String>,
    pub price: Option<String>,
    pub provider_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct State {
    // --- Legacy indexer fields - kept for backwards compatibility ---
    // These fields are no longer used but kept to allow deserialization of old state
    #[serde(default)]
    pub chain_id: u64,
    #[serde(default)]
    pub contract_address: String, // Changed from eth::Address for compatibility
    #[serde(default)]
    pub hypermap_address: String,
    #[serde(default)]
    pub hypermap_timeout: u64,
    #[serde(default)]
    pub root_hash: Option<String>,
    #[serde(default)]
    pub names: Vec<(String, String)>, // DEPRECATED - use database instead
    #[serde(default)]
    pub last_checkpoint_block: u64,
    #[serde(default)]
    pub logging_started: u64,
    #[serde(default)]
    pub providers_cache: Vec<(u64, String)>,

    // --- Active fields ---
    // wallet management
    pub managed_wallets: Vec<(String, ManagedWallet)>,
    pub selected_wallet_id: Option<String>,
    pub operator_entry_name: Option<String>,
    pub operator_tba_address: Option<String>,
    #[serde(default)]
    pub wallet_limits_cache: Vec<(String, SpendingLimits)>,
    #[serde(default)]
    pub client_limits_cache: Vec<(String, SpendingLimits)>,
    pub active_signer_wallet_id: Option<String>,
    #[serde(skip)]
    pub cached_active_details: Option<ActiveAccountDetails>,
    pub call_history: Vec<CallRecord>,

    // hypergrid-shim auth
    pub hashed_shim_api_key: Option<String>,
    #[serde(default)]
    pub authorized_clients: Vec<(String, HotWalletAuthorizedClient)>,

    // ERC-4337 configuration
    #[serde(default)]
    pub gasless_enabled: Option<bool>,
    #[serde(default)]
    pub paymaster_approved: Option<bool>,

    // Session tracking
    #[serde(default)]
    pub hyperwallet_session_active: bool,
    #[serde(default)]
    pub db_initialized: bool,
    #[serde(default)]
    pub timers_initialized: bool,
}

impl State {
    pub fn new() -> Self {
        Self {
            // Legacy fields - all defaulted
            chain_id: 0,
            contract_address: String::new(),
            hypermap_address: String::new(),
            hypermap_timeout: 0,
            root_hash: None,
            names: Vec::new(),
            last_checkpoint_block: 0,
            logging_started: 0,
            providers_cache: Vec::new(),

            // Active fields
            managed_wallets: Vec::new(),
            selected_wallet_id: None,
            operator_entry_name: None,
            operator_tba_address: None,
            wallet_limits_cache: Vec::new(),
            client_limits_cache: Vec::new(),
            active_signer_wallet_id: None,
            cached_active_details: None,
            call_history: Vec::new(),
            hashed_shim_api_key: None,
            authorized_clients: Vec::new(),
            gasless_enabled: None,
            paymaster_approved: None,
            hyperwallet_session_active: false,
            db_initialized: false,
            timers_initialized: false,
        }
    }
    pub fn load() -> Self {
        // In hyperapp framework, state is managed by the framework itself
        // We just create a fresh state and let the framework handle persistence
        info!("Creating state (hyperapp framework manages persistence)");
        let mut state = Self::new();

        // Reset transient fields
        state.active_signer_wallet_id = None;
        state.cached_active_details = None;
        state.providers_cache = Vec::new();
        state.db_initialized = false;
        state.timers_initialized = false;
        state.hyperwallet_session_active = false;

        state
    }

    ///// In hyperapp framework, saving is handled automatically by the framework
    ///// This method is kept for compatibility but does nothing
    //pub fn save(&mut self) {
    //    // The hyperapp framework handles state persistence automatically
    //    // based on the save_config in the #[hyperprocess] macro
    //}

    /// Refresh per-client total spend from the on-disk USDC ledger.
    /// Counts total_cost (provider payout + gas/fees) toward the client limit.
    pub async fn refresh_client_totals_from_ledger(
        &mut self,
        db: &Sqlite,
        tba_address: &str,
    ) -> anyhow::Result<()> {
        // Sum totals per client from the ledger in base units (6 decimals)
        let q = r#"
            SELECT client_id, SUM(CAST(total_cost_units AS INTEGER)) AS total_units
            FROM usdc_call_ledger
            WHERE tba_address = ?1 AND client_id IS NOT NULL
            GROUP BY client_id
        "#
        .to_string();
        let params = vec![serde_json::Value::String(tba_address.to_lowercase())];
        let rows = db.read(q, params).await?;

        // Helper to format base units (6 dp) to display string
        fn format_units(units: i64) -> String {
            let whole = units / 1_000_000;
            let frac = (units % 1_000_000).abs();
            format!("{}.{}", whole, format!("{:06}", frac))
        }

        // Update or insert client totals in the cache
        for row in rows {
            let client_id = match row.get("client_id").and_then(|v| v.as_str()) {
                Some(s) => s.to_string(),
                None => continue,
            };
            let total_units = row.get("total_units").and_then(|v| v.as_i64()).unwrap_or(0);
            let display = format_units(total_units);
            if let Some((_, existing)) = self
                .client_limits_cache
                .iter_mut()
                .find(|(cid, _)| cid == &client_id)
            {
                existing.total_spent = Some(display);
            } else {
                self.client_limits_cache.push((
                    client_id,
                    SpendingLimits {
                        max_per_call: None,
                        max_total: None,
                        currency: Some("USDC".to_string()),
                        total_spent: Some(display),
                    },
                ));
            }
        }

        Ok(())
    }
}
// calls from the MCP shim (and now also UI)

// NEW: Actual Model Context Provider (MCP) requests - used by the shim
#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "PascalCase")] // Match frontend/old indexer naming
pub enum McpRequest {
    // Registry/Provider Actions (from Shim)
    SearchRegistry(String),
    CallProvider {
        #[serde(alias = "providerId")]
        provider_id: String,
        #[serde(alias = "providerName")]
        provider_name: String,
        arguments: Vec<(String, String)>,
    },
}

// NEW: Regular API requests for UI operations - not MCP related
#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "PascalCase")] // Match frontend naming
pub enum ApiRequest {
    // History Action
    GetCallHistory {},

    // Wallet Summary/Selection Actions
    GetWalletSummaryList {},
    SelectWallet {
        wallet_id: String,
    },
    RenameWallet {
        wallet_id: String,
        new_name: String,
    },
    DeleteWallet {
        wallet_id: String,
    },

    // Wallet Creation/Import
    GenerateWallet {},
    ImportWallet {
        private_key: String,
        password: Option<String>,
        name: Option<String>,
    },

    // Wallet State & Config (operate on SELECTED implicitly)
    ActivateWallet {
        password: Option<String>,
    },
    DeactivateWallet {},
    SetWalletLimits {
        limits: SpendingLimits,
    }, // Use SpendingLimits struct defined above
    SetClientLimits {
        client_id: String,
        limits: SpendingLimits,
    },
    ExportSelectedPrivateKey {
        password: Option<String>,
    },
    SetSelectedWalletPassword {
        new_password: String,
        old_password: Option<String>,
    },
    RemoveSelectedWalletPassword {
        current_password: String,
    },

    // Get details for the active/ready account
    GetActiveAccountDetails {},

    // Operator TBA withdrawals
    WithdrawEthFromOperatorTba {
        to_address: String,
        amount_wei_str: String, // Amount in Wei as a string to avoid precision loss
    },
    WithdrawUsdcFromOperatorTba {
        to_address: String,
        amount_usdc_units_str: String, // Amount in smallest USDC units (e.g., if 6 decimals, 1 USDC = "1000000")
    },

    // Authorized client management
    RenameAuthorizedClient {
        client_id: String,
        new_name: String,
    },
    DeleteAuthorizedClient {
        client_id: String,
    },

    // ERC-4337 configuration
    SetGaslessEnabled {
        enabled: bool,
    },
}

// calls to the Indexer
#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
pub enum ClientRequest {
    GetFullRegistry,
    SearchRegistry(String),
}
#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
pub struct CallProvider {
    pub request: ProviderRequest,
}
// changed from HashMap to Vec<String>
#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
pub struct ProviderRequest {
    pub provider_name: String,
    pub arguments: Vec<(String, String)>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payment_tx_hash: Option<String>,
}

/// Structure for storing shim authentication configuration.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ShimAuthConfig {
    pub node: String,
    pub token: String,
}

/// Request body for saving a frontend-generated shim API key.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SaveShimKeyRequest {
    pub raw_key: String,
}

// New Request struct for configuring an authorized client
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ConfigureAuthorizedClientDto {
    pub client_id: Option<String>, // If provided, update this client instead of creating new
    pub client_name: Option<String>,
    pub raw_token: String,
    pub hot_wallet_address_to_associate: String,
}

// New Response struct for configuring an authorized client
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ConfigureAuthorizedClientResult {
    pub client_id: String,
    pub raw_token: String,
    pub api_base_path: String, // e.g., "/package_id:process_name.os/api"
    pub node_name: String,     // e.g., "your_node.os"
}

// Enum defining the possible stages of operator onboarding
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub enum OnboardingStatus {
    Loading, // Added for initial/fetch state
    NeedsHotWallet,
    NeedsOnChainSetup,
    NeedsFunding,
    Ready,
    Error, // Keep Error state for actual fetch errors
}

// Response structure for the onboarding status endpoint
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct OnboardingStatusResponse {
    pub status: OnboardingStatus,
    pub checks: OnboardingCheckDetails, // Detailed check results
    pub errors: Vec<String>,            // List of specific errors encountered during checks
}

// WIT-safe DTOs for app-framework endpoints
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct OnboardingStatusResponseDto {
    pub status: OnboardingStatus,
    pub checks: OnboardingCheckDetailsDto,
    pub errors: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingCheckDetailsDto {
    pub identity_configured: bool,
    pub operator_entry: Option<String>,
    pub operator_tba: Option<String>,
    pub tba_eth_funded: Option<bool>,
    pub tba_usdc_funded: Option<bool>,
    pub tba_eth_balance_str: Option<String>,
    pub tba_usdc_balance_str: Option<String>,
    pub tba_funding_check_error: Option<String>,
}

// moved SetupStatus to app_api_types for WIT-safe API surface

// Detailed breakdown of individual checks for UI display
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingCheckDetails {
    pub identity_configured: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub operator_entry: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub operator_tba: Option<String>,
    // TODO: WIT-incompatible - complex enum. Use separate status field or flatten
    // #[serde(skip_serializing_if = "Option::is_none")]
    // pub identity_status: Option<IdentityStatus>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tba_eth_funded: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tba_usdc_funded: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tba_eth_balance_str: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tba_usdc_balance_str: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tba_funding_check_error: Option<String>,
    #[serde(default)]
    pub linked_hot_wallets_info: Vec<LinkedHotWalletInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum IdentityStatus {
    Verified {
        entry_name: String,
        tba_address: String,
        owner_address: String,
    },
    NotFound,
    ImplementationCheckFailed(String),
    IncorrectImplementation {
        found: String,
        expected: String,
    },
    CheckError(String),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum DelegationStatus {
    Verified,
    NeedsIdentity,  // Operator identity itself isn't configured
    NeedsHotWallet, // No hot wallet selected/active/unlocked
    AccessListNoteMissing,
    AccessListNoteInvalidData(String), // Include reason, e.g., "Invalid length"
    SignersNoteLookupError(String),    // Error fetching note pointed to by hash
    SignersNoteMissing,                // Note exists but no data
    SignersNoteInvalidData(String),    // e.g., ABI decode error
    HotWalletNotInList,
    CheckError(String), // Catch-all for RPC errors etc.
}

// New struct for Operator TBA specific funding details
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TbaFundingDetails {
    pub tba_needs_eth: bool,
    pub tba_needs_usdc: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tba_eth_balance_str: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tba_usdc_balance_str: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub check_error: Option<String>, // For RPC errors etc. during TBA checks
}

// Enum for client authentication errors
#[derive(Debug)]
pub enum AuthError {
    MissingClientId,
    MissingToken,
    ClientNotFound,
    InvalidToken,
    InsufficientCapabilities,
}

// --- Backend-Driven Graph Visualizer DTOs ---

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NodePosition {
    pub x: f64,
    pub y: f64,
}

// Operator TBA funding info for graph
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperatorWalletFundingInfo {
    pub eth_balance_str: Option<String>,
    pub usdc_balance_str: Option<String>,
    pub needs_eth: bool,
    pub needs_usdc: bool,
    pub error_message: Option<String>,
}

// Hot wallet funding info for graph
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HotWalletFundingInfo {
    pub eth_balance_str: Option<String>,
    pub needs_eth: bool,
    pub error_message: Option<String>,
}

// Note (Access List or Signers) info for graph
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteInfo {
    pub status_text: String,
    pub details: Option<String>,
    pub is_set: bool,
    pub action_needed: bool,
    pub action_id: Option<String>, // e.g., "trigger_set_signers_note"
}

// Coarse onboarding state for simplified UI flows
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum CoarseState {
    BeforeWallet,
    AfterWalletNoClients,
    AfterWalletWithClients,
}

//#[derive(Serialize, Deserialize, Debug, Clone)]
//#[serde(rename_all = "camelCase")]
//pub struct HypergridGraphResponse {
//    pub nodes: Vec<GraphNode>,
//    pub edges: Vec<GraphEdge>,
//    pub coarse_state: CoarseState,
//}

// WIT-compatible wrapper for HypergridGraphResponse
// Since GraphNodeData is complex, we serialize the entire response as JSON
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct HypergridGraphResponseWrapper {
    pub json_data: String, // JSON-serialized HypergridGraphResponse
}

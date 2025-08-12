use hyperware_process_lib::{eth, get_state, set_state, hypermap};
use hyperware_process_lib::signer::LocalSigner;
use hyperware_process_lib::logging::{info, error};
use hyperware_process_lib::hyperwallet_client::SessionInfo;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::str::FromStr;
use std::time::{SystemTime, UNIX_EPOCH};
use hyperware_process_lib::wallet::KeyStorage;
use rmp_serde;
use crate::authorized_services::HotWalletAuthorizedClient;

wit_bindgen::generate!({
    path: "../target/wit",
    world: "process-v1",
    generate_unused_types: true,
    additional_derives: [serde::Deserialize, serde::Serialize, process_macros::SerdeJsonInto],
});


#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ManagedWallet {
    pub id: String, // Typically the wallet address
    pub name: Option<String>, // User-defined alias
    pub storage: KeyStorage, // Encrypted or Decrypted storage (ensure type matches)
    pub spending_limits: SpendingLimits, // Per-wallet limits
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct SpendingLimits {
    pub max_per_call: Option<String>,
    pub max_total: Option<String>,
    pub currency: Option<String>,      // Currency (e.g., "USDC") - Default to USDC
    pub total_spent: Option<String>,   // Total amount spent so far (from hyperwallet)
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

#[derive(Serialize, Deserialize, Debug, Clone)]
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
        reason: String // e.g., "Wallet Locked", "Zero Price", "Limit Exceeded"
    },
    LimitExceeded {
        limit: String,
        amount_attempted: String,
        currency: String,
    },
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CallRecord {
   pub timestamp_start_ms: u128, // Use milliseconds for potentially higher resolution
   pub provider_lookup_key: String, // What was used to find the provider (name or id)
   pub target_provider_id: String, // The actual process ID called
   pub call_args_json: String, // Arguments sent (as JSON string)
   pub call_success: bool, // Did the provider respond without communication error?
   pub response_timestamp_ms: u128,
   pub payment_result: Option<PaymentAttemptResult>, // Payment outcome
   pub duration_ms: u128, // Calculated duration
   pub operator_wallet_id: Option<String>, // Added field
}
// --- End Call History Structs ---

// Copied types from indexer
type Namehash = String;
type Name = String;
pub type PendingLogs = Vec<(eth::Log, u8)>;

// Copied constants from indexer
const HYPERMAP_ADDRESS: &str = hypermap::HYPERMAP_ADDRESS;
pub const DELAY_MS: u64 = 30_000;
pub const CHECKPOINT_MS: u64 = 300_000;
pub const CHAIN_ID: u64 = hypermap::HYPERMAP_CHAIN_ID;
pub const HYPERMAP_FIRST_BLOCK: u64 = hypermap::HYPERMAP_FIRST_BLOCK; 

// Copied Provider struct definition from indexer
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Provider {
    pub name: Name,
    pub hash: String,
    pub facts: HashMap<String, Vec<String>>,
    pub wallet: Option<String>,
    pub price: Option<String>,
    pub provider_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct State {
    // --- Indexer Fields (Copied from Indexer) ---
    pub chain_id: u64,
    pub contract_address: eth::Address,
    pub hypermap: hypermap::Hypermap,
    pub root_hash: Option<Namehash>,
    // pub providers: HashMap<String, Provider>, // Keep this? Or always read from DB?
    pub names: HashMap<String, String>,
    pub last_checkpoint_block: u64,
    pub logging_started: u64,
    #[serde(skip)]
    pub providers_cache: HashMap<u64, eth::Provider>,

    // wallet management
    pub managed_wallets: HashMap<String, ManagedWallet>,
    pub selected_wallet_id: Option<String>,
    pub operator_entry_name: Option<String>,
    pub operator_tba_address: Option<String>,
    #[serde(default)]
    pub wallet_limits_cache: HashMap<String, SpendingLimits>,
    #[serde(skip)]
    pub active_signer_cache: Option<LocalSigner>,
    #[serde(skip)]
    pub cached_active_details: Option<ActiveAccountDetails>,
    pub call_history: Vec<CallRecord>,

    // hypergrid-shim auth
    pub hashed_shim_api_key: Option<String>,
    #[serde(default)]
    pub authorized_clients: HashMap<String, HotWalletAuthorizedClient>,
    
    // ERC-4337 configuration
    #[serde(default)]
    pub gasless_enabled: Option<bool>,

    // Hyperwallet session info
    #[serde(skip)]
    pub hyperwallet_session: Option<SessionInfo>,

    #[serde(skip)]
    pub db_conn: Option<hyperware_process_lib::sqlite::Sqlite>,
    
    #[serde(skip)]
    pub timers_initialized: bool,
}

impl State {
    pub fn new() -> Self {
        // Initialize indexer fields
        let hypermap = hypermap::Hypermap::default(60); // don't touch, k!?
        let logging_started = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs();

        // authorized_clients will be empty initially
        let default_clients = HashMap::new();

        Self {
            // Indexer fields
            chain_id: CHAIN_ID,
            contract_address: eth::Address::from_str(HYPERMAP_ADDRESS).unwrap(),
            hypermap,
            root_hash: None,
            // providers: HashMap::new(), // Omit if reading from DB
            names: HashMap::from([(String::new(), hypermap::HYPERMAP_ROOT_HASH.to_string())]),
            last_checkpoint_block: HYPERMAP_FIRST_BLOCK,
            logging_started,
            providers_cache: HashMap::new(), 
            // db: None, // Removed
            // pending_logs: Vec::new(), // Removed
            
            // Client fields
            managed_wallets: HashMap::new(),
            selected_wallet_id: None,
            operator_entry_name: None,
            operator_tba_address: None,
            wallet_limits_cache: HashMap::new(),
            active_signer_cache: None,
            cached_active_details: None,
            call_history: Vec::new(),
            hashed_shim_api_key: None, // Will be phased out
            authorized_clients: default_clients, // Initialize as empty HashMap
            gasless_enabled: None, // Initialize gasless_enabled
            hyperwallet_session: None, // Initialize hyperwallet session
            db_conn: None,
            timers_initialized: false,
        }
    }
    pub fn load() -> Self {
        match get_state() {
            None => {
                info!("No existing state found, creating new state.");
                Self::new()
            },
            Some(state_bytes) => match rmp_serde::from_slice(&state_bytes) {
                Ok::<State, _>(mut state) => { 
                    info!("Loaded existing state."); 
                    state.active_signer_cache = None;
                    state.cached_active_details = None;
                    state.providers_cache = HashMap::new(); 
                    state.db_conn = None; // Ensure db_conn is initialized after load
                    state.timers_initialized = false; // Reset timer initialization flag
                    state.hyperwallet_session = None; // Reset hyperwallet session on load
                    // Re-initialize hypermap to ensure a fresh eth::Provider instance
                    state.hypermap = hypermap::Hypermap::default(60);
                    // The contract_address field in state should still be respected by hypermap logic if it differs from default.
                    // However, Hypermap::default() already uses the HYPERMAP_ADDRESS constant.
                    // If state.contract_address could differ and needs to override, that'd be a separate adjustment in how Hypermap is constructed or used.
                    // For now, this ensures the provider part of hypermap is fresh.

                    info!("Loaded state, last checkpoint block: {}", state.last_checkpoint_block);
                    state
                }
                Err(e) => {
                    error!("Failed to deserialize saved state with rmp_serde: {:?}. Creating new state.", e);
                    Self::new()
                }
            },
        }
    }
    /// Saves the serializable state (including wallet_storage)
    pub fn save(&mut self) {
        // Detach DB connection and session before saving
        self.db_conn = None;
        // Note: hyperwallet_session is already marked with #[serde(skip)] so it won't be serialized
        match rmp_serde::to_vec(self) {
            Ok(state_bytes) => set_state(&state_bytes),
            Err(e) => {
                // Re-attach DB connection if save failed?
                // For now, just log.
                error!("Failed to serialize state for saving: {:?}", e);
            }
        }
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
    SelectWallet { wallet_id: String },
    RenameWallet { wallet_id: String, new_name: String },
    DeleteWallet { wallet_id: String },

    // Wallet Creation/Import
    GenerateWallet {}, 
    ImportWallet {
        private_key: String,
        password: Option<String>,
        name: Option<String>,
    },

    // Wallet State & Config (operate on SELECTED implicitly)
    ActivateWallet { password: Option<String> },
    DeactivateWallet {}, 
    SetWalletLimits { limits: SpendingLimits }, // Use SpendingLimits struct defined above
    ExportSelectedPrivateKey { password: Option<String> }, 
    SetSelectedWalletPassword { new_password: String, old_password: Option<String> }, 
    RemoveSelectedWalletPassword { current_password: String }, 
    
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
    RenameAuthorizedClient { client_id: String, new_name: String },
    DeleteAuthorizedClient { client_id: String },
    
    // ERC-4337 configuration
    SetGaslessEnabled { enabled: bool },
}

// DEPRECATED: This enum is being phased out. Use McpRequest or ApiRequest instead.
#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "PascalCase")]
pub enum HttpMcpRequest {
    // Registry/Provider Actions (from Shim)
    SearchRegistry(String),
    CallProvider {
        #[serde(alias = "providerId")]
        provider_id: String,
        #[serde(alias = "providerName")]
        provider_name: String,
        arguments: Vec<(String, String)>,
    },

    // History Action (from UI)
    GetCallHistory {},

    // Wallet Summary/Selection Actions (from UI)
    GetWalletSummaryList {}, 
    SelectWallet { wallet_id: String },
    RenameWallet { wallet_id: String, new_name: String },
    DeleteWallet { wallet_id: String },

    // Wallet Creation/Import (from UI)
    GenerateWallet {}, 
    ImportWallet {
        private_key: String,
        password: Option<String>,
        name: Option<String>,
    },

    // Wallet State & Config (from UI - operate on SELECTED implicitly)
    ActivateWallet { password: Option<String> },
    DeactivateWallet {}, 
    SetWalletLimits { limits: SpendingLimits }, // Use SpendingLimits struct defined above
    ExportSelectedPrivateKey { password: Option<String> }, 
    SetSelectedWalletPassword { new_password: String, old_password: Option<String> }, 
    RemoveSelectedWalletPassword { current_password: String }, 
    
    // New action to get details for the active/ready account
    GetActiveAccountDetails {},

    // New actions for Operator TBA withdrawals
    WithdrawEthFromOperatorTba {
        to_address: String,
        amount_wei_str: String, // Amount in Wei as a string to avoid precision loss
    },
    WithdrawUsdcFromOperatorTba {
        to_address: String,
        amount_usdc_units_str: String, // Amount in smallest USDC units (e.g., if 6 decimals, 1 USDC = "1000000")
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
pub struct ConfigureAuthorizedClientRequest {
    pub client_id: Option<String>, // If provided, update this client instead of creating new
    pub client_name: Option<String>,
    pub raw_token: String,
    pub hot_wallet_address_to_associate: String,
}

// New Response struct for configuring an authorized client
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ConfigureAuthorizedClientResponse {
    pub client_id: String,
    pub raw_token: String,
    pub api_base_path: String, // e.g., "/package_id:process_name.os/api"
    pub node_name: String,     // e.g., "your_node.os"
}

// Enum defining the possible stages of operator onboarding
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub enum OnboardingStatus {
    Loading,                // Added for initial/fetch state
    NeedsHotWallet,         
    NeedsOnChainSetup,      
    NeedsFunding,           
    Ready,                  
    Error                   // Keep Error state for actual fetch errors
}

// Response structure for the onboarding status endpoint
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct OnboardingStatusResponse {
    pub status: OnboardingStatus,
    pub checks: OnboardingCheckDetails, // Detailed check results
    pub errors: Vec<String>, // List of specific errors encountered during checks
}

// Detailed breakdown of individual checks for UI display
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingCheckDetails {
    pub identity_configured: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub operator_entry: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub operator_tba: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub identity_status: Option<IdentityStatus>,
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
        owner_address: String 
    },
    NotFound,
    ImplementationCheckFailed(String), 
    IncorrectImplementation { 
        found: String, 
        expected: String 
    },
    CheckError(String), 
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum DelegationStatus {
    Verified,
    NeedsIdentity, // Operator identity itself isn't configured
    NeedsHotWallet, // No hot wallet selected/active/unlocked
    AccessListNoteMissing,
    AccessListNoteInvalidData(String), // Include reason, e.g., "Invalid length"
    SignersNoteLookupError(String), // Error fetching note pointed to by hash
    SignersNoteMissing, // Note exists but no data
    SignersNoteInvalidData(String), // e.g., ABI decode error
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

// Graph building structs for visualizer
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged, rename_all = "camelCase")]  // Untagged removes variant wrapper, rename_all converts to camelCase
pub enum GraphNodeData {
    OwnerNode {
        name: String,
        #[serde(rename = "tbaAddress")]
        tba_address: Option<String>,
        #[serde(rename = "ownerAddress")]
        owner_address: Option<String>,
    },
    OperatorWalletNode {
        name: String,
        #[serde(rename = "tbaAddress")]
        tba_address: String,
        #[serde(rename = "fundingStatus")]
        funding_status: OperatorWalletFundingInfo,
        #[serde(rename = "signersNote")]
        signers_note: NoteInfo,
        #[serde(rename = "accessListNote")]
        access_list_note: NoteInfo,
        #[serde(rename = "gaslessEnabled")]
        gasless_enabled: bool,
        #[serde(rename = "paymasterApproved")]
        paymaster_approved: bool,
    },
    HotWalletNode {
        address: String,
        name: Option<String>,
        #[serde(rename = "statusDescription")]
        status_description: String,
        #[serde(rename = "isActiveInMcp")]
        is_active_in_mcp: bool,
        #[serde(rename = "isEncrypted")]
        is_encrypted: bool,
        #[serde(rename = "isUnlocked")]
        is_unlocked: bool,
        #[serde(rename = "fundingInfo")]
        funding_info: HotWalletFundingInfo,
        #[serde(rename = "authorizedClients")]
        authorized_clients: Vec<String>,
        limits: Option<SpendingLimits>,
    },
    AuthorizedClientNode {
        #[serde(rename = "clientId")]
        client_id: String,
        #[serde(rename = "clientName")]
        client_name: String,
        #[serde(rename = "associatedHotWalletAddress")]
        associated_hot_wallet_address: String,
    },
    AddHotWalletActionNode { // For triggering management/linking of hot wallets
        label: String,
        #[serde(rename = "operatorTbaAddress")]
        operator_tba_address: Option<String>, // Operator TBA this action is related to
        #[serde(rename = "actionId")]
        action_id: String, // e.g., "trigger_manage_wallets_modal"
    },
    AddAuthorizedClientActionNode {
        label: String,
        #[serde(rename = "targetHotWalletAddress")]
        target_hot_wallet_address: String, // The HW this client would be for
        #[serde(rename = "actionId")]
        action_id: String, // e.g., "trigger_add_client_modal"
    },
    MintOperatorWalletActionNode(MintOperatorWalletActionNodeData), // New Variant
}

// Mint operator wallet action data
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MintOperatorWalletActionNodeData {
    pub label: String,
    pub owner_node_name: String, // To construct the grid-wallet name
    pub action_id: String, // e.g., "trigger_mint_operator_wallet"
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GraphNode {
    pub id: String, // Unique ID for ReactFlow
    #[serde(rename = "type")] // Ensure correct serialization for ReactFlow
    pub node_type: String, // ReactFlow node type, e.g., "ownerNode", "operatorWalletNode"
    pub data: GraphNodeData,
    pub position: Option<NodePosition>, // Optional: Backend can suggest initial positions
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GraphEdge {
    pub id: String,
    pub source: String, // Source node ID
    pub target: String, // Target node ID
    pub style_type: Option<String>, // e.g., "dashed"
    pub animated: Option<bool>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HypergridGraphResponse {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
}

// --- End Backend-Driven Graph Visualizer DTOs ---
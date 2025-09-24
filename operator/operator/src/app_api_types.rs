use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SetupStatus {
    pub configured: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum AppOnboardingStatus {
    Loading,
    NeedsHotWallet,
    NeedsOnChainSetup,
    NeedsFunding,
    Ready,
    Error,
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

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct OnboardingStatusResponseDto {
    pub status: AppOnboardingStatus,
    pub checks: OnboardingCheckDetailsDto,
    pub errors: Vec<String>,
}

// WIT-safe payment result types
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum PaymentStatus {
    Success,
    Failed,
    Skipped,
    LimitExceeded,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PaymentResultDto {
    pub status: PaymentStatus,
    pub tx_hash: Option<String>,
    pub amount: Option<String>,
    pub currency: Option<String>,
    pub error: Option<String>,
    pub reason: Option<String>,
    pub limit: Option<String>,
}

// Shim-related types
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AuthorizeShimRequest {
    pub node: String,
    pub token: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AuthorizeShimResponse {
    pub status: String,
    pub node: String,
    pub message: String,
}

// WIT-safe MCP request types
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct McpSearchRequest {
    pub query: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct McpCallProviderRequest {
    #[serde(rename = "providerId")]
    pub provider_id: String,
    #[serde(rename = "providerName")]
    pub provider_name: String,
    pub arguments: Vec<(String, String)>, // The shim sends tuples, not KeyValue objects
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct KeyValue {
    pub key: String,
    pub value: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct McpSearchResponse {
    pub results: Vec<ProviderSearchResult>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ProviderSearchResult {
    pub provider_id: String,
    pub name: String,
    pub description: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct McpCallProviderResponse {
    pub status: String,
    pub provider_id: String,
    pub provider_name: String,
    pub response: String,
}

// Authorize response - returns config for shim to save locally
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AuthorizeResult {
    pub url: String,       // The /api endpoint URL
    pub token: String,     // Raw token for shim to save
    pub client_id: String, // Generated client ID
    pub node: String,      // Node name
}

// Shim adapter request - combines auth and MCP request in body
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ShimAdapterDto {
    pub client_id: String,
    pub token: String,
    pub client_name: Option<String>,
    pub mcp_request_json: String, // The actual MCP request as JSON string (SearchRegistry or CallProvider)
}

// Shim adapter response - returns JSON as string for WIT compatibility
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ShimAdapterResult {
    pub json_response: String,
}

// Provider information for public endpoints
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ProviderInfo {
    pub id: Option<i64>,
    pub provider_id: String,
    pub name: String,
    pub description: Option<String>,
    pub site: Option<String>,
    pub wallet: Option<String>,
    pub price: Option<String>,
    pub instructions: Option<String>,
    pub hash: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum TerminalCommand {
    GetState,
    ResetState,
    CheckDbSchema,
    SearchProviders(String),
    WipeDbAndReindex,
    PrintLedger(String),
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ConfigureAuthorizedClientDto {
    pub client_id: Option<String>, // If provided, update this client instead of creating new
    pub client_name: Option<String>,
    pub raw_token: String,
    pub hot_wallet_address_to_associate: String,
}

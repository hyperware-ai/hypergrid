use serde::{Serialize, Deserialize};

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq)]
pub enum ServiceCapabilities {
    All,
    None,
}

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq)]
pub struct HotWalletAuthorizedClient {
    pub id: String,                            // e.g., "grid-shim-main"
    pub name: String,                          // e.g., "Hypergrid Shim Service"
    pub associated_hot_wallet_address: String, // e.g., "0x123..."
    pub authentication_token: String,          // Secret token for this client
    pub capabilities: ServiceCapabilities,
} 
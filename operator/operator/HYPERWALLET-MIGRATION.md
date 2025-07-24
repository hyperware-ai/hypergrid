# Operator to Hyperwallet Migration Guide

## Overview

This document outlines how the operator will be transformed to use the hyperwallet service (`hyperwallet:hyperwallet:hallman.hypr`) for all wallet operations instead of its internal wallet management system.

## Architecture Changes

### Before (Current)
```
┌─────────────────────┐
│     Operator        │
├─────────────────────┤
│ wallet/service.rs   │ ← Manages wallets internally
│ wallet/payments.rs  │ ← Executes payments directly
│ State {             │
│   managed_wallets   │ ← Stores private keys
│   active_signer     │ ← Cached signer in memory
│ }                   │
└─────────────────────┘
```

### After (With Hyperwallet)
```
┌─────────────────────┐     ┌──────────────────────┐
│     Operator        │────▶│     Hyperwallet      │
├─────────────────────┤     ├──────────────────────┤
│ hyperwallet_client  │     │ Manages all wallets  │
│ State {             │     │ Handles signing      │
│   wallet_ids        │     │ Enforces permissions │
│   selected_wallet   │     │ Stores private keys  │
│ }                   │     └──────────────────────┘
└─────────────────────┘
```

## Key Changes

### 1. State Structure Changes

```rust
// Before: operator/src/structs.rs
pub struct State {
    pub managed_wallets: HashMap<String, ManagedWallet>,  // REMOVE
    pub selected_wallet_id: Option<String>,               // Keep, but just ID
    pub active_signer_cache: Option<LocalSigner>,         // REMOVE
    pub cached_active_details: Option<ActiveAccountDetails>, // Keep for UI
    // ... other fields remain
}

// After: operator/src/structs.rs
pub struct State {
    pub wallet_ids: Vec<String>,                          // Just IDs, not keys
    pub selected_wallet_id: Option<String>,               // Currently selected
    pub cached_active_details: Option<ActiveAccountDetails>, // For UI performance
    pub hyperwallet_permissions_granted: bool,            // Track if we have access
    // ... other fields remain
}
```

### 2. New Hyperwallet Client Module

Create `operator/src/hyperwallet_client.rs`:

```rust
use hyperware_process_lib::{Request, Address};
use serde::{Deserialize, Serialize};
use serde_json::json;

pub struct HyperwalletClient;

#[derive(Debug, Serialize, Deserialize)]
pub struct WalletInfo {
    pub id: String,
    pub name: Option<String>,
    pub address: String,
    pub chain_id: u64,
    pub is_encrypted: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct OperationResponse {
    pub success: bool,
    pub data: Option<serde_json::Value>,
    pub error: Option<String>,
}

impl HyperwalletClient {
    pub fn new() -> Self {
        Self
    }

    // Wallet Management
    pub async fn create_wallet(&self, name: &str, password: Option<&str>) -> Result<WalletInfo> {
        let response = self.send_operation(json!({
            "operation": "CreateWallet",
            "params": {
                "name": name,
                "chain_id": 8453, // Base
                "password": password
            }
        })).await?;
        
        // Parse response
        let wallet_info: WalletInfo = serde_json::from_value(response.data.unwrap())?;
        Ok(wallet_info)
    }

    pub async fn import_wallet(&self, private_key: &str, name: &str, password: Option<&str>) -> Result<WalletInfo> {
        let response = self.send_operation(json!({
            "operation": "ImportWallet",
            "params": {
                "private_key": private_key,
                "name": name,
                "password": password,
                "chain_id": 8453
            }
        })).await?;
        
        let wallet_info: WalletInfo = serde_json::from_value(response.data.unwrap())?;
        Ok(wallet_info)
    }

    pub async fn list_wallets(&self) -> Result<Vec<WalletInfo>> {
        let response = self.send_operation(json!({
            "operation": "ListWallets",
            "params": {}
        })).await?;
        
        let wallets: Vec<WalletInfo> = serde_json::from_value(response.data.unwrap())?;
        Ok(wallets)
    }

    pub async fn delete_wallet(&self, wallet_id: &str) -> Result<()> {
        self.send_operation(json!({
            "operation": "DeleteWallet",
            "wallet_id": wallet_id,
            "params": {}
        })).await?;
        Ok(())
    }

    pub async fn rename_wallet(&self, wallet_id: &str, new_name: &str) -> Result<()> {
        self.send_operation(json!({
            "operation": "RenameWallet",
            "wallet_id": wallet_id,
            "params": {
                "new_name": new_name
            }
        })).await?;
        Ok(())
    }

    // Payment Operations
    pub async fn execute_via_tba(
        &self,
        wallet_id: &str,
        tba_address: &str,
        target: &str,
        calldata: Vec<u8>,
        value: &str,
        password: Option<&str>
    ) -> Result<String> {
        let response = self.send_operation(json!({
            "operation": "ExecuteViaTBA",
            "wallet_id": wallet_id,
            "params": {
                "tba_address": tba_address,
                "target": target,
                "call_data": hex::encode(calldata),
                "value": value,
                "password": password
            }
        })).await?;
        
        // Extract transaction hash
        let tx_hash = response.data.unwrap()["transaction_hash"].as_str().unwrap().to_string();
        Ok(tx_hash)
    }

    // Balance Operations
    pub async fn get_balance(&self, address: &str, token: Option<&str>) -> Result<String> {
        let response = self.send_operation(json!({
            "operation": if token.is_some() { "GetTokenBalance" } else { "GetBalance" },
            "params": {
                "address": address,
                "token": token,
                "chain_id": 8453
            }
        })).await?;
        
        let balance = response.data.unwrap()["balance"].as_str().unwrap().to_string();
        Ok(balance)
    }

    // Delegation Verification
    pub async fn verify_delegation(&self, wallet_id: &str, operator_tba: &str) -> Result<bool> {
        let response = self.send_operation(json!({
            "operation": "VerifyDelegation",
            "wallet_id": wallet_id,
            "params": {
                "operator_tba": operator_tba
            }
        })).await?;
        
        Ok(response.data.unwrap()["is_delegated"].as_bool().unwrap())
    }

    // Internal helper
    async fn send_operation(&self, body: serde_json::Value) -> Result<OperationResponse> {
        let response = Request::new()
            .target(("hyperwallet:hyperwallet:hallman.hypr", "hyperwallet", "hyperwallet", "hallman.hypr"))
            .body(serde_json::to_vec(&body)?)
            .send_and_await_response(30)?;
        
        let op_response: OperationResponse = serde_json::from_slice(&response.body())?;
        if !op_response.success {
            return Err(anyhow!("Hyperwallet operation failed: {:?}", op_response.error));
        }
        
        Ok(op_response)
    }
}
```

### 3. Update wallet/service.rs

Replace most functions with hyperwallet client calls:

```rust
// operator/src/wallet/service.rs
use crate::hyperwallet_client::{HyperwalletClient, WalletInfo};
use crate::structs::*;

static CLIENT: Lazy<HyperwalletClient> = Lazy::new(|| HyperwalletClient::new());

pub fn initialize_wallet(state: &mut State) {
    // Just ensure we have permission to access hyperwallet
    // No need to generate initial wallet anymore
    state.hyperwallet_permissions_granted = false;
}

pub async fn generate_initial_wallet(state: &mut State) -> Result<WalletInfo> {
    let wallet = CLIENT.create_wallet("operator-main", None).await?;
    state.wallet_ids.push(wallet.id.clone());
    state.selected_wallet_id = Some(wallet.id.clone());
    state.save();
    Ok(wallet)
}

pub async fn import_new_wallet(
    state: &mut State,
    private_key: &str,
    password: Option<&str>,
    name: Option<&str>
) -> Result<WalletInfo> {
    let wallet_name = name.unwrap_or("imported-wallet");
    let wallet = CLIENT.import_wallet(private_key, wallet_name, password).await?;
    state.wallet_ids.push(wallet.id.clone());
    if state.selected_wallet_id.is_none() {
        state.selected_wallet_id = Some(wallet.id.clone());
    }
    state.save();
    Ok(wallet)
}

pub async fn get_wallet_summary_list(state: &State) -> Result<Vec<WalletSummary>> {
    let all_wallets = CLIENT.list_wallets().await?;
    
    // Convert to WalletSummary format for UI compatibility
    let summaries: Vec<WalletSummary> = all_wallets
        .into_iter()
        .filter(|w| state.wallet_ids.contains(&w.id))
        .map(|w| WalletSummary {
            id: w.id.clone(),
            name: w.name,
            address: w.address,
            is_encrypted: w.is_encrypted,
            is_selected: Some(&w.id) == state.selected_wallet_id.as_ref(),
            is_unlocked: true, // Hyperwallet handles this internally
        })
        .collect();
    
    Ok(summaries)
}

pub async fn select_wallet(state: &mut State, wallet_id: &str) -> Result<()> {
    if !state.wallet_ids.contains(&wallet_id.to_string()) {
        return Err(anyhow!("Wallet not found"));
    }
    state.selected_wallet_id = Some(wallet_id.to_string());
    state.cached_active_details = None; // Clear cache
    state.save();
    Ok(())
}

pub async fn delete_wallet(state: &mut State, wallet_id: &str) -> Result<()> {
    CLIENT.delete_wallet(wallet_id).await?;
    state.wallet_ids.retain(|id| id != wallet_id);
    if state.selected_wallet_id.as_ref() == Some(&wallet_id.to_string()) {
        state.selected_wallet_id = None;
        state.cached_active_details = None;
    }
    state.save();
    Ok(())
}

pub async fn rename_wallet(state: &mut State, wallet_id: &str, new_name: &str) -> Result<()> {
    CLIENT.rename_wallet(wallet_id, new_name).await?;
    state.cached_active_details = None; // Clear cache
    Ok(())
}

// These functions become no-ops or simple state updates
pub fn activate_wallet(_state: &mut State, _wallet_id: &str, _password: Option<&str>) -> Result<()> {
    // Hyperwallet handles activation internally
    Ok(())
}

pub fn deactivate_wallet(_state: &mut State, _wallet_id: &str) -> Result<()> {
    // Hyperwallet handles deactivation internally
    Ok(())
}

pub async fn export_private_key(wallet_id: &str, password: Option<&str>) -> Result<String> {
    let response = CLIENT.send_operation(json!({
        "operation": "ExportWallet",
        "wallet_id": wallet_id,
        "params": {
            "password": password
        }
    })).await?;
    
    Ok(response.data.unwrap()["private_key"].as_str().unwrap().to_string())
}

// Helper function for payments module
pub fn get_selected_wallet_id(state: &State) -> Result<String> {
    state.selected_wallet_id.clone()
        .ok_or_else(|| anyhow!("No wallet selected"))
}
```

### 4. Update wallet/payments.rs

Replace direct signing with hyperwallet calls:

```rust
// operator/src/wallet/payments.rs
use crate::hyperwallet_client::HyperwalletClient;

static CLIENT: Lazy<HyperwalletClient> = Lazy::new(|| HyperwalletClient::new());

pub async fn execute_payment_if_needed(
    state: &State,
    provider_name: &str,
    provider_id: &str,
    price_str: &str,
    provider_wallet: &str,
) -> Result<PaymentAttemptResult> {
    // Get selected wallet
    let wallet_id = match &state.selected_wallet_id {
        Some(id) => id,
        None => return Ok(PaymentAttemptResult::Skipped {
            reason: "No wallet selected".to_string()
        })
    };

    // Check operator TBA
    let operator_tba = match &state.operator_tba_address {
        Some(addr) => addr,
        None => return Ok(PaymentAttemptResult::Skipped {
            reason: "Operator TBA not configured".to_string()
        })
    };

    // Parse price
    let price_usdc = parse_usdc_amount(price_str)?;
    if price_usdc == 0.0 {
        return Ok(PaymentAttemptResult::Skipped {
            reason: "Zero price".to_string()
        });
    }

    // Check spending limits (if implemented in hyperwallet)
    // For now, we'll skip this check

    // Prepare USDC transfer
    let usdc_contract = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // Base USDC
    let amount_units = (price_usdc * 1_000_000.0) as u128; // 6 decimals
    
    // Encode ERC20 transfer
    let calldata = encode_erc20_transfer(provider_wallet, amount_units)?;

    // Execute via TBA using hyperwallet
    match CLIENT.execute_via_tba(
        wallet_id,
        operator_tba,
        usdc_contract,
        calldata,
        "0", // No ETH value
        None  // Password if needed
    ).await {
        Ok(tx_hash) => {
            Ok(PaymentAttemptResult::Success {
                tx_hash,
                amount_paid: price_str.to_string(),
                currency: "USDC".to_string(),
            })
        }
        Err(e) => {
            Ok(PaymentAttemptResult::Failed {
                error: e.to_string(),
                amount_attempted: price_str.to_string(),
                currency: "USDC".to_string(),
            })
        }
    }
}

pub async fn check_operator_tba_funding_detailed(
    operator_tba: &str,
) -> Result<(String, String)> {
    // Use hyperwallet to check balances
    let eth_balance = CLIENT.get_balance(operator_tba, None).await?;
    let usdc_balance = CLIENT.get_balance(operator_tba, Some("USDC")).await?;
    
    Ok((eth_balance, usdc_balance))
}

pub async fn handle_operator_tba_withdrawal(
    state: &State,
    to_address: &str,
    amount: &str,
    is_usdc: bool,
) -> Result<String> {
    let wallet_id = state.selected_wallet_id.as_ref()
        .ok_or_else(|| anyhow!("No wallet selected"))?;
    
    let operator_tba = state.operator_tba_address.as_ref()
        .ok_or_else(|| anyhow!("Operator TBA not configured"))?;

    if is_usdc {
        // USDC transfer
        let usdc_contract = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
        let amount_units = amount.parse::<u128>()?;
        let calldata = encode_erc20_transfer(to_address, amount_units)?;
        
        CLIENT.execute_via_tba(
            wallet_id,
            operator_tba,
            usdc_contract,
            calldata,
            "0",
            None
        ).await
    } else {
        // ETH transfer - just send to the address with value
        CLIENT.execute_via_tba(
            wallet_id,
            operator_tba,
            to_address,
            vec![], // Empty calldata for ETH transfer
            amount,
            None
        ).await
    }
}

// Delegation verification
pub async fn verify_selected_hot_wallet_delegation_detailed(
    state: &State,
) -> Result<DelegationStatus> {
    let wallet_id = match &state.selected_wallet_id {
        Some(id) => id,
        None => return Ok(DelegationStatus::NeedsHotWallet),
    };

    let operator_tba = match &state.operator_tba_address {
        Some(addr) => addr,
        None => return Ok(DelegationStatus::NeedsIdentity),
    };

    // Use hyperwallet to verify delegation
    match CLIENT.verify_delegation(wallet_id, operator_tba).await {
        Ok(is_delegated) => {
            if is_delegated {
                Ok(DelegationStatus::Verified)
            } else {
                Ok(DelegationStatus::HotWalletNotInList)
            }
        }
        Err(e) => Ok(DelegationStatus::CheckError(e.to_string()))
    }
}
```

### 5. Update HTTP Handlers

Update `http_handlers.rs` to use the new async wallet functions:

```rust
// operator/src/http_handlers.rs

// Example: Update wallet creation endpoint
ApiRequest::GenerateWallet {} => {
    match wallet_service::generate_initial_wallet(state).await {
        Ok(wallet_info) => {
            let summary = WalletSummary {
                id: wallet_info.id,
                name: wallet_info.name,
                address: wallet_info.address,
                is_encrypted: wallet_info.is_encrypted,
                is_selected: true,
                is_unlocked: true,
            };
            json_response(200, json!({
                "success": true,
                "wallet": summary
            }))
        }
        Err(e) => json_error(500, &format!("Failed to create wallet: {}", e))
    }
}

// Update import wallet endpoint
ApiRequest::ImportWallet { private_key, password, name } => {
    match wallet_service::import_new_wallet(state, &private_key, password.as_deref(), name.as_deref()).await {
        Ok(wallet_info) => {
            json_response(200, json!({
                "success": true,
                "wallet": wallet_info
            }))
        }
        Err(e) => json_error(500, &format!("Failed to import wallet: {}", e))
    }
}
```

### 6. Migration Steps

1. **Deploy Hyperwallet** with all required operations implemented
2. **Update Operator Dependencies** to include the hyperwallet client
3. **Grant Permissions** for operator to access hyperwallet
4. **Migration Script** to transfer existing wallets:

```rust
pub async fn migrate_to_hyperwallet(state: &State) -> Result<()> {
    let client = HyperwalletClient::new();
    
    // First, request permissions
    client.request_permissions().await?;
    
    // Migrate each wallet
    for (id, wallet) in &state.managed_wallets {
        println!("Migrating wallet: {}", id);
        
        match &wallet.storage {
            KeyStorage::Decrypted(signer) => {
                // Export and re-import
                let key = signer.export_private_key();
                client.import_wallet(&key, wallet.name.as_deref().unwrap_or("migrated"), None).await?;
            }
            KeyStorage::Encrypted(_) => {
                println!("Skipping encrypted wallet {}, manual migration needed", id);
            }
        }
    }
    
    println!("Migration complete!");
    Ok(())
}
```

## Benefits After Migration

1. **Security**: Private keys never in operator memory
2. **Modularity**: Wallet logic separated from business logic
3. **Reusability**: Other processes can use same wallet service
4. **Maintenance**: Single place to update wallet functionality
5. **Permissions**: Fine-grained access control
6. **Audit Trail**: All operations logged in hyperwallet

## Testing Strategy

1. **Unit Tests**: Mock hyperwallet responses
2. **Integration Tests**: Test with real hyperwallet service
3. **Migration Tests**: Ensure wallets transfer correctly
4. **Rollback Plan**: Keep old code commented for emergency rollback

## Timeline

- Week 1: Complete hyperwallet missing operations
- Week 2: Implement hyperwallet client in operator
- Week 3: Update all endpoints to use client
- Week 4: Test migration with test wallets
- Week 5: Production migration with monitoring 
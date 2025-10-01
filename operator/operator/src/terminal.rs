use crate::structs::State;
use hyperware_process_lib::logging::{error, info};
use hyperware_process_lib::sqlite::Sqlite;
use serde_json::Value;
use std::collections::HashMap;

/// Serialize the current state to pretty JSON
pub fn serialize_state_to_json(state: &State) -> Result<String, String> {
    serde_json::to_string_pretty(state).map_err(|e| format!("Failed to serialize state: {:?}", e))
}

/// Save runtime resources before state reset
pub struct RuntimeResources {
    pub hypermap: Option<hyperware_process_lib::hypermap::Hypermap>,
    pub db_conn: Option<Sqlite>,
    pub hyperwallet_session: Option<hyperware_process_lib::hyperwallet_client::SessionInfo>,
}

/// Extract runtime resources from the process
pub fn extract_runtime_resources(process: &crate::OperatorProcess) -> RuntimeResources {
    RuntimeResources {
        hypermap: process.hypermap.clone(),
        db_conn: process.db_conn.clone(),
        hyperwallet_session: process.hyperwallet_session.clone(),
    }
}

/// Create a fresh state
pub fn create_fresh_state() -> State {
    State::new()
}

/// Restore runtime resources to the process
pub fn restore_runtime_resources(
    process: &mut crate::OperatorProcess,
    resources: RuntimeResources,
) {
    process.hypermap = resources.hypermap;
    process.db_conn = resources.db_conn;
    process.hyperwallet_session = resources.hyperwallet_session;
}

/// Update state flags based on restored resources
pub fn update_state_flags(state: &mut State, resources: &RuntimeResources) {
    state.hyperwallet_session_active = resources.hyperwallet_session.is_some();
    state.db_initialized = resources.db_conn.is_some();
}

/// Query database schema information
pub async fn query_database_schema(db: &Sqlite) -> Result<Vec<HashMap<String, Value>>, String> {
    let query = "SELECT type, name, sql FROM sqlite_master WHERE type IN ('table', 'index') ORDER BY type, name".to_string();
    db.read(query, vec![])
        .await
        .map_err(|e| format!("Failed to query database schema: {:?}", e))
}

/// Parse schema rows into tables and indexes
pub fn parse_schema_rows(
    rows: Vec<HashMap<String, Value>>,
) -> (Vec<(String, String)>, Vec<(String, String)>) {
    let mut tables = Vec::new();
    let mut indexes = Vec::new();

    for row in rows {
        let obj_type = row
            .get("type")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown");
        let name = row
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("unnamed")
            .to_string();
        let sql = row
            .get("sql")
            .and_then(|v| v.as_str())
            .unwrap_or("no sql")
            .to_string();

        match obj_type {
            "table" => tables.push((name, sql)),
            "index" => indexes.push((name, sql)),
            _ => {}
        }
    }

    (tables, indexes)
}

/// Format schema information for display
pub fn format_schema_output(
    tables: Vec<(String, String)>,
    indexes: Vec<(String, String)>,
) -> String {
    info!(
        "format_schema_output: {:#?}",
        (tables.clone(), indexes.clone())
    );
    let mut output = String::from("Database Schema:\n\n");

    // Format tables
    output.push_str("TABLES:\n");
    for (name, sql) in tables {
        output.push_str(&format!("\n{}\n{}\n", name, "=".repeat(name.len())));
        output.push_str(&format!("{}\n", sql));
    }

    // Format indexes
    output.push_str("\n\nINDEXES:\n");
    for (name, sql) in indexes {
        output.push_str(&format!("\n{}: {}\n", name, sql));
    }

    output
}

/// Query provider count from database
pub async fn query_provider_count(db: &Sqlite) -> Result<i64, String> {
    let query = "SELECT COUNT(*) as count FROM providers".to_string();

    db.read(query, vec![])
        .await
        .map_err(|e| format!("Failed to query provider count: {:?}", e))?
        .get(0)
        .and_then(|r| r.get("count"))
        .and_then(|v| v.as_i64())
        .ok_or_else(|| "Failed to extract provider count".to_string())
}

/// Format provider search results
pub fn format_search_results(query: &str, providers: Vec<HashMap<String, Value>>) -> String {
    let mut output = format!(
        "Search results for '{}': {} providers found\n\n",
        query,
        providers.len()
    );

    if providers.is_empty() {
        output.push_str("No providers found matching your query.\n");
        return output;
    }

    for (i, provider) in providers.iter().enumerate() {
        output.push_str(&format_provider_details(i + 1, provider));
        output.push_str("\n");
    }

    output
}

/// Format a single provider's details
fn format_provider_details(index: usize, provider: &HashMap<String, Value>) -> String {
    let mut output = format!("=== Provider {} ===\n", index);

    // ID
    if let Some(id) = provider.get("id").and_then(|v| v.as_i64()) {
        output.push_str(&format!("ID: {}\n", id));
    }

    // Name
    if let Some(name) = provider.get("name").and_then(|v| v.as_str()) {
        output.push_str(&format!("Name: {}\n", name));
    }

    // Provider ID
    if let Some(provider_id) = provider.get("provider_id").and_then(|v| v.as_str()) {
        if !provider_id.is_empty() {
            output.push_str(&format!("Provider ID: {}\n", provider_id));
        }
    }

    // Site
    if let Some(site) = provider.get("site").and_then(|v| v.as_str()) {
        if !site.is_empty() {
            output.push_str(&format!("Site: {}\n", site));
        }
    }

    // Description (truncated if long)
    if let Some(description) = provider.get("description").and_then(|v| v.as_str()) {
        if !description.is_empty() {
            let desc = truncate_string(description, 100);
            output.push_str(&format!("Description: {}\n", desc));
        }
    }

    // Wallet
    if let Some(wallet) = provider.get("wallet").and_then(|v| v.as_str()) {
        if !wallet.is_empty() {
            output.push_str(&format!("Wallet: {}\n", wallet));
        }
    }

    // Price
    if let Some(price) = provider.get("price").and_then(|v| v.as_str()) {
        if !price.is_empty() {
            output.push_str(&format!("Price: {}\n", price));
        }
    }

    // Hash (abbreviated)
    if let Some(hash) = provider.get("hash").and_then(|v| v.as_str()) {
        if hash.len() >= 16 {
            output.push_str(&format!("Hash: {}...\n", &hash[..16]));
        } else {
            output.push_str(&format!("Hash: {}\n", hash));
        }
    }

    output
}

/// Truncate a string to a maximum length, adding ellipsis if truncated
fn truncate_string(s: &str, max_len: usize) -> String {
    if s.len() > max_len {
        format!("{}...", &s[..max_len.saturating_sub(3)])
    } else {
        s.to_string()
    }
}

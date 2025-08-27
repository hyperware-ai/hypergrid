use anyhow::{Error, Result};
use hyperware_process_lib::{
    logging::info,
    our,
    sqlite::{self, Sqlite},
};
use serde_json::Value;
use std::collections::HashMap;

/// Open the provider database - this accesses the same database that the operator uses for indexing
/// Note: This assumes the provider and operator share access to the same database through the package system
pub async fn open_provider_db() -> Result<sqlite::Sqlite, Error> {
    // Use the current package ID but access the "hypergrid" database
    // This should be the same database the operator uses if they're in the same package context
    let our_address = our();
    let package_id = our_address.package_id();
    let db = sqlite::open(package_id, "hypergrid", None).await;
    db
}

/// Load and initialize the provider database with proper schema
pub async fn load_provider_db() -> anyhow::Result<sqlite::Sqlite> {
    let db = open_provider_db().await?;
    let good = check_provider_schema(&db).await;
    if !good {
        info!("Provider database schema not found or incomplete - this is expected if operator hasn't indexed providers yet");
    }
    Ok(db)
}

/// Check if the provider database has the required schema
pub async fn check_provider_schema(db: &Sqlite) -> bool {
    let required = ["providers"];
    let mut found = required
        .iter()
        .map(|&s| (s, false))
        .collect::<std::collections::HashMap<_, _>>();

    let statement = "SELECT name from sqlite_master WHERE type='table';".to_string();
    let data = db.read(statement, vec![]).await;
    match data {
        Err(_) => false,
        Ok(data) => {
            let values: Vec<Value> = data
                .iter()
                .filter_map(|map| map.get("name"))
                .cloned()
                .collect();

            for val in values {
                if let Value::String(s) = val {
                    if let Some(entry) = found.get_mut(s.as_str()) {
                        *entry = true;
                    }
                }
            }
            let good = found.values().all(|&b| b);
            good
        }
    }
}

/// Get all providers from the database (indexed by operator)
pub async fn get_all_indexed_providers(db: &Sqlite) -> Result<Vec<HashMap<String, Value>>> {
    let s = "SELECT * FROM providers".to_string();
    let data = db.read(s, vec![]).await?;
    Ok(data)
}

/// Search for providers in the indexed database
pub async fn search_indexed_providers(db: &Sqlite, query: String) -> Result<Vec<HashMap<String, Value>>> {
    let like_param = format!("%{}%", query);
    let exact_param = query;

    let s = r#"
        SELECT * FROM providers
        WHERE (name LIKE ?1 COLLATE NOCASE)
        OR (site LIKE ?1 COLLATE NOCASE)
        OR (description LIKE ?1 COLLATE NOCASE)
        OR (provider_id = ?2)
        "#
    .to_string();

    let params = vec![Value::String(like_param), Value::String(exact_param)];

    let data = db.read(s, params).await?;
    Ok(data)
}

/// Get provider by exact name from indexed database
pub async fn get_indexed_provider_by_name(
    db: &Sqlite,
    name: &str,
) -> Result<Option<HashMap<String, Value>>> {
    let s = "SELECT * FROM providers WHERE name = ?1 LIMIT 1".to_string();
    let p = vec![serde_json::Value::String(name.to_string())];
    let data = db.read(s, p).await?;
    Ok(data.into_iter().next())
}

/// Compare local provider state with indexed state to detect inconsistencies
/// Only checks if local providers are properly synchronized with the index
pub async fn compare_with_indexed_state(
    local_providers: &[crate::RegisteredProvider],
    db: &Sqlite,
) -> Result<ComparisonResult> {
    let mut missing_from_index = Vec::new();
    let mut mismatched = Vec::new();

    // Check each local provider against the index
    for local_provider in local_providers {
        match get_indexed_provider_by_name(db, &local_provider.provider_name).await? {
            Some(indexed) => {
                // Check for mismatches between local and indexed data
                if let Some(Value::String(indexed_id)) = indexed.get("provider_id") {
                    if indexed_id != &local_provider.provider_id {
                        mismatched.push(format!(
                            "Provider '{}': ID mismatch (local: {}, indexed: {})",
                            local_provider.provider_name, local_provider.provider_id, indexed_id
                        ));
                    }
                }

                // Check price mismatch if available
                if let Some(Value::String(indexed_price)) = indexed.get("price") {
                    let local_price_str = local_provider.price.to_string();
                    if indexed_price != &local_price_str {
                        mismatched.push(format!(
                            "Provider '{}': Price mismatch (local: {}, indexed: {})",
                            local_provider.provider_name, local_price_str, indexed_price
                        ));
                    }
                }
            }
            None => {
                // Local provider is not in the index
                missing_from_index.push(local_provider.provider_name.clone());
            }
        }
    }

    Ok(ComparisonResult {
        missing_from_index,
        mismatched,
        total_local: local_providers.len(),
    })
}

/// Result of comparing local providers against indexed state
#[derive(Debug)]
pub struct ComparisonResult {
    pub missing_from_index: Vec<String>,
    pub mismatched: Vec<String>,
    pub total_local: usize,
}

impl ComparisonResult {
    pub fn is_synchronized(&self) -> bool {
        self.missing_from_index.is_empty() && self.mismatched.is_empty()
    }

    pub fn summary(&self) -> String {
        if self.is_synchronized() {
            format!(
                "✓ All {} local providers are synchronized with index",
                self.total_local
            )
        } else {
            format!(
                "⚠ Local provider sync issues: {} missing from index, {} mismatched",
                self.missing_from_index.len(),
                self.mismatched.len()
            )
        }
    }
}

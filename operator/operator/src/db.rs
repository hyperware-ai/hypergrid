use anyhow::{anyhow, Error, Result};
use hyperware_process_lib::{
    logging::{info, error},
    sqlite::{self, Sqlite},
    Address,
};
use serde_json::Value;
use std::collections::HashMap;

use crate::helpers::make_json_timestamp;

pub fn open_db(our: &Address) -> Result<sqlite::Sqlite, Error> {
    let p = our.package_id();
    let db = sqlite::open(p, "hypergrid-beta", None);
    db
}
pub fn wipe_db(our: &Address) -> anyhow::Result<()> {
    let p = our.package_id();
    sqlite::remove_db(p.clone(), "hypergrid-beta", None)?;
    Ok(())
}

pub fn load_db(our: &Address) -> anyhow::Result<sqlite::Sqlite> {
    let db = open_db(our)?;
    let good = check_schema(&db);
    if !good {
        write_db_schema(&db)?;
    }
    Ok(db)
}
pub fn check_schema(db: &Sqlite) -> bool {
    let required = ["providers"];
    let mut found = required
        .iter()
        .map(|&s| (s, false))
        .collect::<std::collections::HashMap<_, _>>();

    let statement = "SELECT name from sqlite_master WHERE type='table';".to_string();
    let data = db.read(statement, vec![]);
    match data {
        Err(_) => false,
        Ok(data) => {
            info!("sqlite read {:?}", data);
            let values: Vec<Value> = data
                .iter()
                .filter_map(|map| map.get("name"))
                .cloned()
                .collect();

            info!("sql tables:{:?}", values);
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

pub fn write_db_schema(db: &Sqlite) -> anyhow::Result<()> {
    let tx_id = db.begin_tx()?;
    let s1 = r#"
        CREATE TABLE providers(
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          hash TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL UNIQUE,
          site TEXT,
          description TEXT,
          provider_id TEXT,
          wallet TEXT,
          price TEXT,
          instructions TEXT,
          parent_hash TEXT NOT NULL,
          created INTEGER
        );"#
    .to_string();
    let s2 = r#"
       CREATE INDEX idx_providers_parent
       ON providers (id, parent_hash);
    "#
    .to_string();
    db.write(s1, vec![], Some(tx_id))?;
    db.write(s2, vec![], Some(tx_id))?;
    return db.commit_tx(tx_id);
}
pub fn insert_provider(
    db: &Sqlite,
    parent_hash: &str,
    child_hash: String,
    name: String,
) -> Result<(), Error> {
    let s1 = r#"
        INSERT OR IGNORE INTO providers(hash, name, parent_hash, created) 
        VALUES (?1, ?2, ?3, ?4);
        "#
    .to_string();
    let now = make_json_timestamp();
    let p1 = vec![
        serde_json::Value::String(child_hash),
        serde_json::Value::String(name),
        serde_json::Value::String(parent_hash.to_string()),
        serde_json::Value::Number(now),
    ];
    db.write(s1, p1, None)
}
pub fn insert_provider_facts(
    db: &Sqlite,
    key: String,
    value: String,
    hash: String,
) -> Result<(), Error> {
    // Step 1: Check if the provider exists
    let check_query = "SELECT id FROM providers WHERE hash = ?1 LIMIT 1".to_string();
    let check_params = vec![serde_json::Value::String(hash.clone())];
    match db.read(check_query, check_params) {
        Ok(rows) => {
            if rows.is_empty() {
                // Provider does not exist - check if ANY providers exist
                let count_query = "SELECT COUNT(*) as count FROM providers".to_string();
                let provider_count = db.read(count_query, vec![])
                    .ok()
                    .and_then(|rows| {
                        rows.get(0).and_then(|row| row.get("count")).and_then(|v| v.as_i64())
                    })
                    .unwrap_or(0);
                
                // Try to get some existing providers for context
                let existing_query = "SELECT hash, name FROM providers LIMIT 3".to_string();
                let existing_providers = db.read(existing_query, vec![])
                    .ok()
                    .map(|rows| {
                        rows.iter()
                            .filter_map(|row| {
                                let hash = row.get("hash")?.as_str()?;
                                let name = row.get("name")?.as_str()?;
                                Some(format!("{} ({})", name, &hash[..16]))
                            })
                            .collect::<Vec<_>>()
                            .join(", ")
                    })
                    .unwrap_or_else(|| "none".to_string());
                
                info!("Provider with hash {} not found for fact update (key: '{}', value: '{}'). Total providers in DB: {}. Sample providers: {}. Deferring.", 
                      hash, key, value, provider_count, existing_providers);
                return Err(anyhow!("Provider with hash {} not found for fact update (key: '{}')", hash, key));
            }
            // Provider exists, proceed to update
        }
        Err(e) => {
            // Error during the check query
            error!("DB Error checking provider existence for hash {}: {:?}", hash, e);
            return Err(anyhow!("DB Error checking provider existence for hash {}: {:?}", hash, e));
        }
    }

    // Step 2: Provider exists, perform the UPDATE
    let update_statement = format!(
        r#"
        UPDATE providers SET
        '{}' = ?1
        WHERE hash = ?2
        "#,
        key
    );
    let update_params = vec![
        serde_json::Value::String(value.clone()),
        serde_json::Value::String(hash.clone()),
    ];

    match db.write(update_statement, update_params, None) {
        Ok(_) => Ok(()),
        Err(e) => {
            error!("DB Error in insert_provider_facts (update) for key '{}', hash {}: {:?}", key, hash, e);
            Err(e)
        }
    }
}
pub fn get_all(db: &Sqlite) -> Result<Vec<HashMap<String, Value>>> {
    let s = "SELECT * FROM providers".to_string();
    let data = db.read(s, vec![])?;
    Ok(data)
}


pub fn search_provider(db: &Sqlite, query: String) -> Result<Vec<HashMap<String, Value>>> {
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

    let params = vec![
        Value::String(like_param),  
        Value::String(exact_param), 
    ];

    let data = db.read(s, params)?;
    Ok(data)
}

pub fn get_provider_details(db: &Sqlite, id_or_name: &str) -> Result<Option<HashMap<String, Value>>> {
    let s1 = "SELECT * FROM providers WHERE provider_id = ?1 LIMIT 1".to_string();
    let p1 = vec![serde_json::Value::String(id_or_name.to_string())];
    let data1 = db.read(s1, p1)?;

    if !data1.is_empty() {
        return Ok(data1.into_iter().next());
    }

    let s2 = "SELECT * FROM providers WHERE name = ?1 LIMIT 1".to_string();
    let p2 = vec![serde_json::Value::String(id_or_name.to_string())];
    let data2 = db.read(s2, p2)?;

    Ok(data2.into_iter().next()) 
} 
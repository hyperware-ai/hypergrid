// This is the cleaned-up version of helpers.rs with only the functions that are actually used

use anyhow::Result;
use std::time::{SystemTime, UNIX_EPOCH};
use std::collections::HashMap;
use hyperware_process_lib::logging::{info, error};
use hyperware_process_lib::Address as HyperAddress;
use hyperware_process_lib::sqlite::Sqlite;
use alloy_primitives::{Address as EthAddress, B256};
use hyperware_process_lib::hypermap;
use hyperware_process_lib::http::{StatusCode, server::send_response};
use alloy_sol_types::SolValue;
use hex;

use crate::structs::*;

/// Generate a JSON timestamp for database entries
pub fn make_json_timestamp() -> serde_json::Number {
    let systemtime = SystemTime::now();

    let duration_since_epoch = systemtime
        .duration_since(UNIX_EPOCH)
        .expect("Time went backwards");
    let secs = duration_since_epoch.as_secs();
    let now: serde_json::Number = secs.into();
    return now;
}
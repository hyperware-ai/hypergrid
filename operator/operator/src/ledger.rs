use crate::constants::{CIRCLE_PAYMASTER, USDC_BASE_ADDRESS};
use alloy_primitives::{keccak256, Address, B256, U256};
use alloy_sol_types::{sol, SolCall};
use hex;
use hyperware_process_lib::eth::{
    self, BlockId, BlockNumberOrTag, Filter, Provider, TransactionInput, TransactionRequest,
};
use hyperware_process_lib::logging::{error, info};
use hyperware_process_lib::sqlite::Sqlite;
use hyperware_process_lib::wallet::erc20_balance_of;
use std::str::FromStr;

use crate::structs::{PaymentAttemptResult, State};

// Schemas owned by ledger
pub async fn ensure_usdc_events_table(db: &Sqlite) -> anyhow::Result<()> {
    let stmt = r#"
        CREATE TABLE IF NOT EXISTS usdc_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            address TEXT NOT NULL,
            block INTEGER NOT NULL,
            time INTEGER,
            tx_hash TEXT NOT NULL,
            log_index INTEGER,
            from_addr TEXT NOT NULL,
            to_addr TEXT NOT NULL,
            value_units TEXT NOT NULL
        );
    "#
    .to_string();
    db.write(stmt, vec![], None).await?;
    let idx1 = r#"CREATE UNIQUE INDEX IF NOT EXISTS idx_usdc_events_tx_log ON usdc_events (tx_hash, log_index);"#.to_string();
    db.write(idx1, vec![], None).await?;
    let idx2 =
        r#"CREATE INDEX IF NOT EXISTS idx_usdc_events_addr_block ON usdc_events (address, block);"#
            .to_string();
    db.write(idx2, vec![], None).await?;
    Ok(())
}

pub async fn ensure_usdc_call_ledger_table(db: &Sqlite) -> anyhow::Result<()> {
    let stmt = r#"
        CREATE TABLE IF NOT EXISTS usdc_call_ledger (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tba_address TEXT NOT NULL,
            tx_hash TEXT NOT NULL UNIQUE,
            block INTEGER NOT NULL,
            time INTEGER,
            client_id TEXT,
            provider_name TEXT,
            provider_address TEXT,
            provider_cost_units TEXT NOT NULL DEFAULT '0',
            paymaster_deposit_units TEXT NOT NULL DEFAULT '0',
            paymaster_refund_units TEXT NOT NULL DEFAULT '0',
            gas_fees_units TEXT NOT NULL DEFAULT '0',
            total_cost_units TEXT NOT NULL DEFAULT '0'
        );
    "#
    .to_string();
    db.write(stmt, vec![], None).await?;
    let idx1 = r#"CREATE INDEX IF NOT EXISTS idx_usdc_ledger_tba_block ON usdc_call_ledger (tba_address, block);"#.to_string();
    db.write(idx1, vec![], None).await?;
    let idx2 =
        r#"CREATE UNIQUE INDEX IF NOT EXISTS idx_usdc_ledger_tx ON usdc_call_ledger (tx_hash);"#
            .to_string();
    db.write(idx2, vec![], None).await?;
    Ok(())
}

fn usdc_display_to_units(s: &str) -> Option<U256> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }
    let parts: Vec<&str> = s.split('.').collect();
    let one = U256::from(1_000_000u64);
    match parts.len() {
        1 => U256::from_str_radix(parts[0], 10).ok().map(|v| v * one),
        2 => {
            let int = U256::from_str_radix(parts[0], 10).ok()?;
            let mut frac = parts[1].to_string();
            if frac.len() > 6 {
                frac.truncate(6);
            }
            while frac.len() < 6 {
                frac.push('0');
            }
            let frac_v = U256::from_str_radix(&frac, 10).ok()?;
            Some(int * one + frac_v)
        }
        _ => None,
    }
}

async fn insert_usdc_event(
    db: &Sqlite,
    address: &str,
    block: u64,
    time: Option<u64>,
    tx_hash: &str,
    log_index: Option<u64>,
    from_addr: &str,
    to_addr: &str,
    value_units: &str,
) -> anyhow::Result<()> {
    let stmt = r#"
        INSERT OR IGNORE INTO usdc_events
        (address, block, time, tx_hash, log_index, from_addr, to_addr, value_units)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8);
    "#
    .to_string();
    let params = vec![
        serde_json::Value::String(address.to_string()),
        serde_json::Value::Number((block as i64).into()),
        time.map(|t| serde_json::Value::Number((t as i64).into()))
            .unwrap_or(serde_json::Value::Null),
        serde_json::Value::String(tx_hash.to_string()),
        log_index
            .map(|i| serde_json::Value::Number((i as i64).into()))
            .unwrap_or(serde_json::Value::Null),
        serde_json::Value::String(from_addr.to_string()),
        serde_json::Value::String(to_addr.to_string()),
        serde_json::Value::String(value_units.to_string()),
    ];
    db.write(stmt, params, None).await?;
    Ok(())
}

async fn upsert_usdc_ledger_row(
    db: &Sqlite,
    tba: &str,
    tx_hash: &str,
    block: u64,
    time: Option<u64>,
    client_id: Option<&str>,
    provider_name: Option<&str>,
    provider_address: Option<&str>,
    provider_cost: U256,
    paymaster_deposit: U256,
    paymaster_refund: U256,
    gas_fees: U256,
    total_cost: U256,
) -> anyhow::Result<()> {
    let stmt = r#"
        INSERT INTO usdc_call_ledger (
            tba_address, tx_hash, block, time, client_id, provider_name, provider_address,
            provider_cost_units, paymaster_deposit_units, paymaster_refund_units, gas_fees_units, total_cost_units
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
        ON CONFLICT(tx_hash) DO UPDATE SET
            tba_address = excluded.tba_address,
            block = excluded.block,
            time = excluded.time,
            client_id = excluded.client_id,
            provider_name = excluded.provider_name,
            provider_address = excluded.provider_address,
            provider_cost_units = excluded.provider_cost_units,
            paymaster_deposit_units = excluded.paymaster_deposit_units,
            paymaster_refund_units = excluded.paymaster_refund_units,
            gas_fees_units = excluded.gas_fees_units,
            total_cost_units = excluded.total_cost_units;
    "#.to_string();
    let params = vec![
        serde_json::Value::String(tba.to_string()),
        serde_json::Value::String(tx_hash.to_string()),
        serde_json::Value::Number((block as i64).into()),
        time.map(|t| serde_json::Value::Number((t as i64).into()))
            .unwrap_or(serde_json::Value::Null),
        client_id
            .map(|s| serde_json::Value::String(s.to_string()))
            .unwrap_or(serde_json::Value::Null),
        provider_name
            .map(|s| serde_json::Value::String(s.to_string()))
            .unwrap_or(serde_json::Value::Null),
        provider_address
            .map(|s| serde_json::Value::String(s.to_string()))
            .unwrap_or(serde_json::Value::Null),
        serde_json::Value::String(provider_cost.to_string()),
        serde_json::Value::String(paymaster_deposit.to_string()),
        serde_json::Value::String(paymaster_refund.to_string()),
        serde_json::Value::String(gas_fees.to_string()),
        serde_json::Value::String(total_cost.to_string()),
    ];
    db.write(stmt, params, None).await?;
    Ok(())
}

pub async fn build_usdc_ledger_for_tba(
    state: &State,
    db: &Sqlite,
    tba: &str,
) -> anyhow::Result<usize> {
    ensure_usdc_events_table(db).await?;
    ensure_usdc_call_ledger_table(db).await?;

    // Map tx_hash -> (client_id, provider_name, amount_units)
    let mut call_map: std::collections::HashMap<
        String,
        (Option<String>, Option<String>, Option<U256>),
    > = std::collections::HashMap::new();
    for rec in &state.call_history {
        if let Some(PaymentAttemptResult::Success {
            tx_hash,
            amount_paid,
            ..
        }) = rec.get_payment_result()
        {
            let amt_units = usdc_display_to_units(amount_paid.as_str());
            call_map.insert(
                tx_hash.to_lowercase(),
                (rec.client_id.clone(), rec.provider_name.clone(), amt_units),
            );
        }
    }

    // Get distinct txs for this TBA
    let q = r#"
        SELECT tx_hash, MIN(block) AS block, MIN(COALESCE(time, 0)) AS time
        FROM usdc_events WHERE address = ?1
        GROUP BY tx_hash ORDER BY block ASC
    "#
    .to_string();
    let rows = db
        .read(q, vec![serde_json::Value::String(tba.to_string())])
        .await?;
    let mut updated = 0usize;
    for row in rows {
        let tx = row.get("tx_hash").and_then(|v| v.as_str()).unwrap_or("");
        if tx.is_empty() {
            continue;
        }
        let block = row.get("block").and_then(|v| v.as_i64()).unwrap_or(0) as u64;
        let time = row.get("time").and_then(|v| v.as_i64()).map(|v| v as u64);

        // Fetch all events for this tx
        let qev = r#"
            SELECT from_addr, to_addr, value_units FROM usdc_events
            WHERE address = ?1 AND tx_hash = ?2
        "#
        .to_string();
        let evs = db
            .read(
                qev,
                vec![
                    serde_json::Value::String(tba.to_string()),
                    serde_json::Value::String(tx.to_string()),
                ],
            )
            .await?;

        let mut deposit_out = U256::ZERO;
        let mut refund_in = U256::ZERO;
        let mut provider_cost = U256::ZERO;
        let mut provider_addr: Option<String> = None;
        let pm = CIRCLE_PAYMASTER.to_lowercase();
        let tba_l = tba.to_lowercase();
        for ev in evs {
            let fa = ev
                .get("from_addr")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_lowercase();
            let ta = ev
                .get("to_addr")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_lowercase();
            let vu = ev
                .get("value_units")
                .and_then(|v| v.as_str())
                .unwrap_or("0");
            let amount = U256::from_str_radix(vu, 10).unwrap_or(U256::ZERO);
            let is_out = fa == tba_l;
            let is_in = ta == tba_l;
            if is_out && ta == pm {
                deposit_out = deposit_out.saturating_add(amount);
            } else if is_in && fa == pm {
                refund_in = refund_in.saturating_add(amount);
            } else if is_out && ta != pm {
                if amount > provider_cost {
                    provider_cost = amount;
                    provider_addr = Some(ta);
                }
            }
        }
        let gas_fees = if deposit_out > refund_in {
            deposit_out - refund_in
        } else {
            U256::ZERO
        };
        let total_cost = provider_cost + gas_fees;

        let (client_id_opt, provider_name_opt, _amt_units_opt) = call_map
            .get(&tx.to_lowercase())
            .cloned()
            .unwrap_or((None, None, None));

        upsert_usdc_ledger_row(
            db,
            tba,
            tx,
            block,
            time,
            client_id_opt.as_deref(),
            provider_name_opt.as_deref(),
            provider_addr.as_deref(),
            provider_cost,
            deposit_out,
            refund_in,
            gas_fees,
            total_cost,
        )
        .await?;
        updated += 1;
    }
    Ok(updated)
}

pub async fn build_ledger_for_tx(
    state: &State,
    db: &Sqlite,
    tba: &str,
    tx: &str,
) -> anyhow::Result<()> {
    ensure_usdc_call_ledger_table(db).await?;
    // Prepare call map for this tx
    let mut cid: Option<String> = None;
    let mut pname: Option<String> = None;
    for rec in &state.call_history {
        if let Some(PaymentAttemptResult::Success { tx_hash, .. }) = rec.get_payment_result() {
            if tx_hash.eq_ignore_ascii_case(tx) {
                cid = rec.client_id.clone();
                pname = rec.provider_name.clone();
                break;
            }
        }
    }
    // Aggregate events for this tx
    let qev = r#"
        SELECT from_addr, to_addr, value_units, MIN(block) AS block
        FROM usdc_events
        WHERE address = ?1 AND tx_hash = ?2
    "#
    .to_string();
    let params = vec![
        serde_json::Value::String(tba.to_string()),
        serde_json::Value::String(tx.to_string()),
    ];
    let row = db.read(qev, params).await?;
    if row.is_empty() {
        return Ok(());
    }

    // Re-query all rows to sum
    let qall = r#"
        SELECT from_addr, to_addr, value_units FROM usdc_events
        WHERE address = ?1 AND tx_hash = ?2
    "#
    .to_string();
    let evs = db
        .read(
            qall,
            vec![
                serde_json::Value::String(tba.to_string()),
                serde_json::Value::String(tx.to_string()),
            ],
        )
        .await?;
    let mut deposit_out = U256::ZERO;
    let mut refund_in = U256::ZERO;
    let mut provider_cost = U256::ZERO;
    let mut provider_addr: Option<String> = None;
    let pm = CIRCLE_PAYMASTER.to_lowercase();
    let tba_l = tba.to_lowercase();
    for ev in evs {
        let fa = ev
            .get("from_addr")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_lowercase();
        let ta = ev
            .get("to_addr")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_lowercase();
        let vu = ev
            .get("value_units")
            .and_then(|v| v.as_str())
            .unwrap_or("0");
        let amount = U256::from_str_radix(vu, 10).unwrap_or(U256::ZERO);
        let is_out = fa == tba_l;
        let is_in = ta == tba_l;
        if is_out && ta == pm {
            deposit_out = deposit_out.saturating_add(amount);
        } else if is_in && fa == pm {
            refund_in = refund_in.saturating_add(amount);
        } else if is_out && ta != pm {
            if amount > provider_cost {
                provider_cost = amount;
                provider_addr = Some(ta);
            }
        }
    }
    let gas_fees = if deposit_out > refund_in {
        deposit_out - refund_in
    } else {
        U256::ZERO
    };
    let total_cost = provider_cost + gas_fees;

    let block = row[0].get("block").and_then(|v| v.as_i64()).unwrap_or(0) as u64;
    upsert_usdc_ledger_row(
        db,
        tba,
        tx,
        block,
        None,
        cid.as_deref(),
        pname.as_deref(),
        provider_addr.as_deref(),
        provider_cost,
        deposit_out,
        refund_in,
        gas_fees,
        total_cost,
    )
    .await?;
    Ok(())
}

pub async fn ensure_call_tx_covered(
    state: &State,
    db: &Sqlite,
    provider: &eth::Provider,
    tba: &str,
    tx: &str,
) -> anyhow::Result<bool> {
    ensure_usdc_events_table(db).await?;
    ensure_usdc_call_ledger_table(db).await?;
    let tx_l = tx.to_lowercase();
    let tba_l = tba.to_lowercase();
    // already in ledger?
    let ql = r#"SELECT 1 FROM usdc_call_ledger WHERE tx_hash = ?1 AND tba_address = ?2 LIMIT 1"#
        .to_string();
    let exists = db
        .read(
            ql,
            vec![
                serde_json::Value::String(tx_l.clone()),
                serde_json::Value::String(tba_l.clone()),
            ],
        )
        .await?;
    if !exists.is_empty() {
        return Ok(false);
    }

    // events exist?
    let qe = r#"SELECT 1 FROM usdc_events WHERE tx_hash = ?1 AND address = ?2 LIMIT 1"#.to_string();
    let ev_exists = db
        .read(
            qe,
            vec![
                serde_json::Value::String(tx_l.clone()),
                serde_json::Value::String(tba_l.clone()),
            ],
        )
        .await?;
    if ev_exists.is_empty() {
        // fetch receipt
        let mut tx_bytes = [0u8; 32];
        if let Ok(b) = hex::decode(tx_l.trim_start_matches("0x")) {
            if b.len() == 32 {
                tx_bytes.copy_from_slice(&b);
            }
        }
        let tx_b256 = B256::from(tx_bytes);
        if let Ok(Some(rcpt)) = provider.get_transaction_receipt(tx_b256) {
            for rlog in rcpt.inner.logs().iter() {
                // Filter USDC Transfer logs in this tx pertaining to TBA
                if format!("0x{}", hex::encode(rlog.address())) != USDC_BASE_ADDRESS {
                    continue;
                }
                let transfer_sig = keccak256("Transfer(address,address,uint256)".as_bytes());
                if rlog.topics().first().copied() != Some(transfer_sig.into()) {
                    continue;
                }
                if rlog.topics().len() < 3 {
                    continue;
                }
                let from_addr = &rlog.topics()[1].as_slice()[12..];
                let to_addr = &rlog.topics()[2].as_slice()[12..];
                let from_hex = format!("0x{}", hex::encode(from_addr));
                let to_hex = format!("0x{}", hex::encode(to_addr));
                if !from_hex.eq_ignore_ascii_case(&tba_l) && !to_hex.eq_ignore_ascii_case(&tba_l) {
                    continue;
                }
                let amount = U256::from_be_slice(rlog.data().data.as_ref());
                let blk = rcpt.block_number.unwrap_or(0);
                let log_index = rlog.log_index.map(|v| v.into());
                insert_usdc_event(
                    db,
                    &tba_l,
                    blk,
                    None,
                    &tx_l,
                    log_index,
                    &from_hex,
                    &to_hex,
                    &amount.to_string(),
                )
                .await?;
            }
        }
    }

    // build ledger for this tx (if we inserted nothing and no events, this is a no-op)
    build_ledger_for_tx(state, db, &tba_l, &tx_l).await?;
    Ok(true)
}

pub async fn verify_calls_covering(
    state: &State,
    db: &Sqlite,
    provider: &eth::Provider,
    tba: &str,
) -> anyhow::Result<usize> {
    let mut updated = 0usize;
    for rec in &state.call_history {
        if let Some(PaymentAttemptResult::Success { tx_hash, .. }) = rec.get_payment_result() {
            if ensure_call_tx_covered(state, db, provider, tba, &tx_hash).await? {
                updated += 1;
            }
        }
    }
    Ok(updated)
}

/// Get the current USDC balance for a TBA by summing all events
pub async fn get_tba_usdc_balance(db: &Sqlite, tba: &str) -> anyhow::Result<f64> {
    ensure_usdc_events_table(db).await?;

    // Sum all incoming and outgoing USDC transfers
    let query = r#"
        SELECT 
            COALESCE(SUM(CASE 
                WHEN LOWER(to_addr) = LOWER(?1) THEN CAST(value_units AS INTEGER)
                WHEN LOWER(from_addr) = LOWER(?1) THEN -CAST(value_units AS INTEGER)
                ELSE 0
            END), 0) as balance_units
        FROM usdc_events
        WHERE LOWER(from_addr) = LOWER(?1) OR LOWER(to_addr) = LOWER(?1)
    "#
    .to_string();

    let params = vec![serde_json::Value::String(tba.to_string())];
    let rows = db.read(query, params).await?;

    if let Some(row) = rows.first() {
        if let Some(balance_units) = row.get("balance_units").and_then(|v| v.as_i64()) {
            // Convert from units (6 decimals) to float
            let balance = balance_units as f64 / 1_000_000.0;
            return Ok(balance);
        }
    }

    Ok(0.0)
}

pub async fn show_ledger(db: &Sqlite, tba: &str, limit: u64) -> anyhow::Result<()> {
    ensure_usdc_call_ledger_table(db).await?;
    let q = r#"
        SELECT block, time, tx_hash, client_id, provider_name, provider_cost_units, gas_fees_units, total_cost_units
        FROM usdc_call_ledger
        WHERE tba_address = ?1
        ORDER BY block DESC
        LIMIT ?2
    "#.to_string();
    let rows = db
        .read(
            q,
            vec![
                serde_json::Value::String(tba.to_string()),
                serde_json::Value::Number((limit as i64).into()),
            ],
        )
        .await?;
    info!("USDC ledger for {} (showing {}):", tba, rows.len());
    for r in rows {
        let blk = r.get("block").and_then(|v| v.as_i64()).unwrap_or(0);
        let ts = r.get("time").and_then(|v| v.as_i64()).unwrap_or(0);
        let tx = r.get("tx_hash").and_then(|v| v.as_str()).unwrap_or("");
        let cid = r.get("client_id").and_then(|v| v.as_str()).unwrap_or("");
        let pn = r
            .get("provider_name")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let pc = r
            .get("provider_cost_units")
            .and_then(|v| v.as_str())
            .unwrap_or("0");
        let gf = r
            .get("gas_fees_units")
            .and_then(|v| v.as_str())
            .unwrap_or("0");
        let tc = r
            .get("total_cost_units")
            .and_then(|v| v.as_str())
            .unwrap_or("0");
        info!("blk={} ts={} tx={} client={} provider={} provider_cost={} gas_fees={} total={} (units)", blk, ts, tx, cid, pn, pc, gf, tc);
    }
    Ok(())
}

// Binary search to find where USDC balance changes occurred
async fn find_balance_change_windows_binary(
    provider: &eth::Provider,
    usdc_addr: &str,
    tba: &str,
    start_block: u64,
    end_block: u64,
) -> anyhow::Result<Vec<(u64, u64)>> {
    let mut activity_regions = Vec::new();
    let mut iterations = 0;
    let mut error_count = 0;
    const MAX_ITERATIONS: usize = 50;
    const MAX_ERRORS: usize = 5;

    info!(
        "Starting comprehensive binary search for USDC activity between blocks {} and {}",
        start_block, end_block
    );

    // Recursive binary search function
    async fn binary_search_region(
        provider: &eth::Provider,
        usdc_addr: &str,
        tba: &str,
        low: u64,
        high: u64,
        regions: &mut Vec<(u64, u64)>,
        iterations: &mut usize,
        error_count: &mut usize,
    ) -> anyhow::Result<()> {
        // Stop conditions
        if *iterations >= MAX_ITERATIONS {
            info!(
                "Reached max iterations ({}), stopping search",
                MAX_ITERATIONS
            );
            return Ok(());
        }
        if *error_count >= MAX_ERRORS {
            info!("Too many errors ({}), stopping search", MAX_ERRORS);
            return Ok(());
        }
        if high <= low {
            return Ok(());
        }

        *iterations += 1;

        // For very small ranges (< 100 blocks), check a single block in the middle
        if high - low < 100 {
            let check_block = (low + high) / 2;
            match check_single_block_for_activity(provider, usdc_addr, tba, check_block).await {
                Ok(true) => {
                    info!(
                        "Found activity in small range {}-{} at block {}",
                        low, high, check_block
                    );
                    regions.push((low, high));
                }
                Ok(false) => {
                    // No activity in this small range
                }
                Err(e) => {
                    info!("Error checking small range {}-{}: {}", low, high, e);
                    *error_count += 1;
                }
            }
            return Ok(());
        }

        // Binary search: check midpoint
        let mid = (low + high) / 2;

        match check_single_block_for_activity(provider, usdc_addr, tba, mid).await {
            Ok(true) => {
                info!("Found activity at block {}", mid);
                // Activity found! Add a small region around this block
                regions.push((mid.saturating_sub(4), mid.saturating_add(4)));

                // Continue searching both halves for more activity
                // Left half: from low to just before found region
                if mid.saturating_sub(5) > low {
                    Box::pin(binary_search_region(
                        provider,
                        usdc_addr,
                        tba,
                        low,
                        mid.saturating_sub(5),
                        regions,
                        iterations,
                        error_count,
                    ))
                    .await?;
                }

                // Right half: from just after found region to high
                if mid.saturating_add(5) < high {
                    Box::pin(binary_search_region(
                        provider,
                        usdc_addr,
                        tba,
                        mid.saturating_add(5),
                        high,
                        regions,
                        iterations,
                        error_count,
                    ))
                    .await?;
                }
            }
            Ok(false) => {
                // No activity at midpoint, search both halves
                info!("No activity at block {}, searching both halves", mid);

                // Search left half
                if mid > low {
                    Box::pin(binary_search_region(
                        provider,
                        usdc_addr,
                        tba,
                        low,
                        mid - 1,
                        regions,
                        iterations,
                        error_count,
                    ))
                    .await?;
                }

                // Search right half
                if mid < high {
                    Box::pin(binary_search_region(
                        provider,
                        usdc_addr,
                        tba,
                        mid + 1,
                        high,
                        regions,
                        iterations,
                        error_count,
                    ))
                    .await?;
                }
            }
            Err(e) => {
                let err_str = e.to_string();
                if err_str.contains("internal error") || err_str.contains("-32000") {
                    *error_count += 1;
                    info!("RPC error at block {}: {}", mid, e);
                    // Wait a bit before continuing
                    std::thread::sleep(std::time::Duration::from_secs(1));

                    // Try to continue with smaller ranges
                    if mid > low + 1000 {
                        Box::pin(binary_search_region(
                            provider,
                            usdc_addr,
                            tba,
                            low,
                            low + 1000,
                            regions,
                            iterations,
                            error_count,
                        ))
                        .await?;
                    }
                    if high > mid + 1000 {
                        Box::pin(binary_search_region(
                            provider,
                            usdc_addr,
                            tba,
                            high - 1000,
                            high,
                            regions,
                            iterations,
                            error_count,
                        ))
                        .await?;
                    }
                } else {
                    info!("Other error at block {}: {}", mid, e);
                    // Continue searching despite error
                }
            }
        }

        Ok(())
    }

    // Start the recursive search
    binary_search_region(
        provider,
        usdc_addr,
        tba,
        start_block,
        end_block,
        &mut activity_regions,
        &mut iterations,
        &mut error_count,
    )
    .await?;

    // Merge overlapping regions
    activity_regions.sort_by_key(|&(start, _)| start);
    let mut merged = Vec::new();

    for (start, end) in activity_regions {
        if let Some((_, last_end)) = merged.last_mut() {
            if start <= *last_end + 10 {
                // Merge if regions are close
                *last_end = end.max(*last_end);
            } else {
                merged.push((start, end));
            }
        } else {
            merged.push((start, end));
        }
    }

    info!(
        "Binary search complete. Found {} activity regions after {} iterations",
        merged.len(),
        iterations
    );
    for (i, (start, end)) in merged.iter().enumerate() {
        info!(
            "  Region {}: blocks {} to {} ({} blocks)",
            i + 1,
            start,
            end,
            end - start + 1
        );
    }

    Ok(merged)
}

// Helper to check SINGLE block for activity - checks both FROM and TO
async fn check_single_block_for_activity(
    provider: &eth::Provider,
    usdc_addr: &str,
    tba: &str,
    block: u64,
) -> anyhow::Result<bool> {
    let transfer_sig = keccak256("Transfer(address,address,uint256)".as_bytes());

    // Create padded address for topics
    let mut pad = [0u8; 32];
    pad[12..].copy_from_slice(&hex::decode(&tba[2..]).unwrap_or_default());
    let topic_addr = B256::from(pad);

    // Check transfers FROM the TBA
    let filter_from = Filter::new()
        .address(Address::from_str(usdc_addr)?)
        .event_signature(transfer_sig)
        .topic1(topic_addr) // from address in topic1
        .from_block(block)
        .to_block(block);

    match provider.get_logs(&filter_from) {
        Ok(logs) if !logs.is_empty() => return Ok(true),
        Err(e) if e.to_string().contains("10000 results") => return Ok(true),
        _ => {}
    }

    // Check transfers TO the TBA
    let filter_to = Filter::new()
        .address(Address::from_str(usdc_addr)?)
        .event_signature(transfer_sig)
        .topic2(topic_addr) // to address in topic2
        .from_block(block)
        .to_block(block);

    match provider.get_logs(&filter_to) {
        Ok(logs) => Ok(!logs.is_empty()),
        Err(e) if e.to_string().contains("10000 results") => Ok(true),
        Err(_) => Ok(false),
    }
}

// Carefully scan blocks with max 9 block ranges
async fn scan_blocks_carefully(
    state: &State,
    db: &Sqlite,
    provider: &eth::Provider,
    tba: &str,
    from_block: u64,
    to_block: u64,
) -> anyhow::Result<usize> {
    let mut current = from_block;
    let mut total = 0;
    let mut consecutive_errors = 0;

    while current <= to_block {
        let chunk_end = (current + 8).min(to_block); // Max 9 blocks

        match ingest_usdc_events_for_range(db, provider, tba, current, chunk_end).await {
            Ok(count) => {
                total += count;
                current = chunk_end + 1;
                consecutive_errors = 0;
            }
            Err(e) => {
                let err_str = e.to_string();
                if err_str.contains("internal error") || err_str.contains("-32000") {
                    consecutive_errors += 1;
                    if consecutive_errors >= 3 {
                        info!("Too many consecutive errors, stopping");
                        break;
                    }
                    std::thread::sleep(std::time::Duration::from_secs(1));
                } else {
                    // Skip this range
                    current = chunk_end + 1;
                }
            }
        }
    }

    Ok(total)
}

// Helper to check if a range has USDC activity
async fn check_for_usdc_activity(
    provider: &eth::Provider,
    usdc_addr: &str,
    tba: &str,
    from_block: u64,
    to_block: u64,
) -> anyhow::Result<bool> {
    let transfer_sig = keccak256("Transfer(address,address,uint256)".as_bytes());

    // Create padded address for topics
    let mut pad = [0u8; 32];
    pad[12..].copy_from_slice(&hex::decode(&tba[2..]).unwrap_or_default());
    let topic_addr = B256::from(pad);

    // Check transfers FROM the TBA
    let filter_from = Filter::new()
        .address(Address::from_str(usdc_addr)?)
        .event_signature(transfer_sig)
        .topic1(topic_addr)
        .from_block(from_block)
        .to_block(to_block);

    match provider.get_logs(&filter_from) {
        Ok(logs) if !logs.is_empty() => return Ok(true),
        Err(e) if e.to_string().contains("10000 results") => return Ok(true),
        _ => {}
    }

    // Check transfers TO the TBA
    let filter_to = Filter::new()
        .address(Address::from_str(usdc_addr)?)
        .event_signature(transfer_sig)
        .topic2(topic_addr)
        .from_block(from_block)
        .to_block(to_block);

    match provider.get_logs(&filter_to) {
        Ok(logs) if !logs.is_empty() => Ok(true),
        Err(e) if e.to_string().contains("10000 results") => Ok(true),
        _ => Ok(false),
    }
}

// Helper to ingest a range with automatic chunking
async fn ingest_range_with_retry(
    state: &State,
    db: &Sqlite,
    provider: &eth::Provider,
    tba: &str,
    from_block: u64,
    to_block: u64,
) -> anyhow::Result<usize> {
    let mut chunk_size = 9u64; // Max safe size
    let mut current = from_block;
    let mut total = 0;

    while current <= to_block {
        let chunk_end = (current + chunk_size - 1).min(to_block);

        match ingest_usdc_events_for_range(db, provider, tba, current, chunk_end).await {
            Ok(count) => {
                total += count;
                current = chunk_end + 1;
            }
            Err(e) => {
                let err_str = e.to_string();
                if err_str.contains("10000 results") && chunk_size > 1 {
                    chunk_size = chunk_size.saturating_sub(1).max(1);
                    info!("Reducing chunk size to {}", chunk_size);
                } else {
                    return Err(e);
                }
            }
        }
    }

    Ok(total)
}

// Helper to scan recent blocks (for periodic updates)
async fn scan_recent_blocks(
    state: &State,
    db: &Sqlite,
    provider: &eth::Provider,
    tba: &str,
    from_block: u64,
    to_block: u64,
) -> anyhow::Result<usize> {
    let chunk_size = 100u64; // Recent blocks are less dense
    let mut current = from_block;
    let mut total = 0;

    while current <= to_block {
        let chunk_end = (current + chunk_size - 1).min(to_block);
        match ingest_range_with_retry(state, db, provider, tba, current, chunk_end).await {
            Ok(count) => {
                total += count;
                current = chunk_end + 1;
            }
            Err(e) => {
                info!("Error scanning recent blocks: {}", e);
                break;
            }
        }
    }

    Ok(total)
}

pub async fn ingest_usdc_events_for_range(
    db: &Sqlite,
    provider: &eth::Provider,
    tba: &str,
    from_block: u64,
    to_block: u64,
) -> anyhow::Result<usize> {
    ensure_usdc_events_table(db).await?;

    let tba_lower = tba.to_lowercase();
    let usdc_addr = USDC_BASE_ADDRESS.to_lowercase();

    info!(
        "Ingesting USDC events for {} in block range {} to {}",
        tba, from_block, to_block
    );

    // Build filter for USDC Transfer events - use the old bisect approach with separate from/to filters
    let transfer_sig = keccak256("Transfer(address,address,uint256)".as_bytes());

    // Create padded address for topics (like old code)
    let mut pad = [0u8; 32];
    pad[12..].copy_from_slice(&hex::decode(&tba_lower[2..]).unwrap_or_default());
    let topic_addr = B256::from(pad);

    // Two filters: one for transfers FROM the TBA, one for transfers TO the TBA
    let filter_from = Filter::new()
        .address(Address::from_str(&usdc_addr)?)
        .event_signature(transfer_sig)
        .topic1(topic_addr) // from address in topic1
        .from_block(from_block)
        .to_block(to_block);

    let filter_to = Filter::new()
        .address(Address::from_str(&usdc_addr)?)
        .event_signature(transfer_sig)
        .topic2(topic_addr) // to address in topic2
        .from_block(from_block)
        .to_block(to_block);

    info!("Fetching USDC transfers FROM {} in range...", tba);
    let logs_from = provider
        .get_logs(&filter_from)
        .map_err(|e| anyhow::anyhow!("Failed to get logs (from): {}", e))?;

    info!("Fetching USDC transfers TO {} in range...", tba);
    let logs_to = provider
        .get_logs(&filter_to)
        .map_err(|e| anyhow::anyhow!("Failed to get logs (to): {}", e))?;

    // Combine and deduplicate logs
    let mut all_logs = logs_from;
    all_logs.extend(logs_to);

    // Deduplicate by transaction hash and log index
    let mut seen = std::collections::HashSet::new();
    let logs: Vec<_> = all_logs
        .into_iter()
        .filter(|log| {
            let key = (log.transaction_hash, log.log_index);
            seen.insert(key)
        })
        .collect();

    info!("Retrieved {} total USDC transfer logs", logs.len());

    let mut total_events = 0;

    // Process logs
    for (idx, log) in logs.iter().enumerate() {
        if log.topics().len() < 3 {
            continue;
        }

        let from_addr = format!("0x{}", hex::encode(&log.topics()[1].as_slice()[12..]));
        let to_addr = format!("0x{}", hex::encode(&log.topics()[2].as_slice()[12..]));

        // Only process if TBA is involved
        if !from_addr.eq_ignore_ascii_case(&tba_lower) && !to_addr.eq_ignore_ascii_case(&tba_lower)
        {
            continue;
        }

        info!(
            "Found transfer involving TBA at index {}: from={}, to={}",
            idx, from_addr, to_addr
        );

        // Extract amount from data
        let amount = U256::from_be_slice(log.data().data.as_ref());

        // Insert event
        let tx_hash = format!(
            "0x{}",
            hex::encode(log.transaction_hash.unwrap_or_default())
        );
        let block = log.block_number.unwrap_or(0);
        let log_index = log.log_index.map(|i| i as u64);

        info!(
            "Inserting USDC event: tx={}, block={}, amount={}",
            tx_hash, block, amount
        );

        insert_usdc_event(
            db,
            &tba_lower,
            block,
            None,
            &tx_hash,
            log_index,
            &from_addr,
            &to_addr,
            &amount.to_string(),
        )
        .await?;

        total_events += 1;
    }

    info!("Ingested {} USDC events for {} in range", total_events, tba);
    Ok(total_events)
}

// ===== BISECT IMPLEMENTATION =====

// Query historical ERC20 balance at a specific block
async fn erc20_balance_of_at(
    provider: &Provider,
    token: Address,
    owner: Address,
    block: u64,
) -> anyhow::Result<U256> {
    sol! {
        function balanceOf(address owner) external view returns (uint256 balance);
    }
    let call = balanceOfCall { owner };
    let data = call.abi_encode();
    let tx = TransactionRequest::default()
        .input(TransactionInput::new(data.into()))
        .to(token);

    let res = provider
        .call(tx, Some(BlockId::Number(BlockNumberOrTag::Number(block))))
        .map_err(|e| anyhow::anyhow!("Failed to call balanceOf at block {}: {}", block, e))?;

    // Decode the result
    if res.len() == 32 {
        Ok(U256::from_be_slice(res.as_ref()))
    } else {
        let decoded = balanceOfCall::abi_decode_returns(&res, false)
            .map_err(|e| anyhow::anyhow!("Failed to decode balanceOf result: {}", e))?;
        Ok(decoded.balance)
    }
}

// Get TBA creation block from Hypermap
async fn get_tba_creation_block(
    hypermap: &hyperware_process_lib::hypermap::Hypermap,
    tba: &str,
) -> anyhow::Result<u64> {
    // Get the namehash for this TBA
    let tba_addr = Address::from_str(tba)?;
    let namehash = hypermap.get_namehash_from_tba(tba_addr).unwrap_or_default();

    if namehash.is_empty() {
        info!("No namehash found for TBA, using HYPERMAP_FIRST_BLOCK");
        return Ok(hyperware_process_lib::hypermap::HYPERMAP_FIRST_BLOCK);
    }

    // Look for Mint event for this namehash
    let mut namehash_bytes = [0u8; 32];
    if let Ok(bytes) = hex::decode(namehash.trim_start_matches("0x")) {
        if bytes.len() == 32 {
            namehash_bytes.copy_from_slice(&bytes);
        }
    }

    let mint_filter = hypermap.mint_filter().topic2(B256::from(namehash_bytes));

    let (_last_block, results) = hypermap
        .bootstrap(
            Some(hyperware_process_lib::hypermap::HYPERMAP_FIRST_BLOCK),
            vec![mint_filter],
            Some((5, Some(5))),
            None,
        )
        .await
        .map_err(|e| anyhow::anyhow!("Failed to bootstrap for mint events: {:?}", e))?;

    let mints = results.get(0).cloned().unwrap_or_default();
    let creation_block = mints
        .iter()
        .filter_map(|log| log.block_number)
        .min()
        .unwrap_or(hyperware_process_lib::hypermap::HYPERMAP_FIRST_BLOCK);

    info!("TBA {} created at block {}", tba, creation_block);
    Ok(creation_block)
}

// Binary search to find block ranges where balance changed
async fn bisect_find_balance_change_ranges(
    provider: &Provider,
    token_addr: &str,
    owner_addr: &str,
    start: u64,
    end: u64,
    window_cap: u64,
    cache: &mut std::collections::HashMap<u64, U256>,
) -> anyhow::Result<Vec<(u64, u64)>> {
    let token = Address::from_str(token_addr)?;
    let owner = Address::from_str(owner_addr)?;

    let mut ranges = Vec::new();
    bisect_recursive(
        provider,
        token,
        owner,
        start,
        end,
        window_cap,
        cache,
        &mut ranges,
    )
    .await?;

    info!("Found {} ranges with balance changes", ranges.len());
    Ok(ranges)
}

// Recursive bisection helper
async fn bisect_recursive(
    provider: &Provider,
    token: Address,
    owner: Address,
    start: u64,
    end: u64,
    window_cap: u64,
    cache: &mut std::collections::HashMap<u64, U256>,
    ranges_out: &mut Vec<(u64, u64)>,
) -> anyhow::Result<()> {
    if start >= end {
        return Ok(());
    }

    // Get balance at start
    let bal_start = if let Some(&b) = cache.get(&start) {
        b
    } else {
        let b = erc20_balance_of_at(provider, token, owner, start).await?;
        cache.insert(start, b);
        b
    };

    // Get balance at end
    let bal_end = if let Some(&b) = cache.get(&end) {
        b
    } else {
        let b = erc20_balance_of_at(provider, token, owner, end).await?;
        cache.insert(end, b);
        b
    };

    // If no balance change, nothing to do
    if bal_start == bal_end {
        return Ok(());
    }

    // If range is small enough, add it
    if end - start <= window_cap {
        info!(
            "Found balance change in range {}-{}: {} -> {}",
            start, end, bal_start, bal_end
        );
        ranges_out.push((start, end));
        return Ok(());
    }

    // Otherwise, bisect
    let mid = start + (end - start) / 2;

    // Get balance at midpoint
    let bal_mid = if let Some(&b) = cache.get(&mid) {
        b
    } else {
        let b = erc20_balance_of_at(provider, token, owner, mid).await?;
        cache.insert(mid, b);
        b
    };

    // Check left half
    if bal_mid != bal_start {
        Box::pin(bisect_recursive(
            provider, token, owner, start, mid, window_cap, cache, ranges_out,
        ))
        .await?;
    }

    // Check right half
    if bal_mid != bal_end {
        Box::pin(bisect_recursive(
            provider,
            token,
            owner,
            mid + 1,
            end,
            window_cap,
            cache,
            ranges_out,
        ))
        .await?;
    }

    Ok(())
}

// Process found ranges by fetching logs
async fn process_balance_change_ranges(
    db: &Sqlite,
    provider: &Provider,
    tba: &str,
    ranges: Vec<(u64, u64)>,
) -> anyhow::Result<usize> {
    let tba_lower = tba.to_lowercase();
    let usdc_addr = Address::from_str(USDC_BASE_ADDRESS)?;
    let transfer_sig = keccak256("Transfer(address,address,uint256)".as_bytes());

    // Create padded address for topics
    let mut pad = [0u8; 32];
    pad[12..].copy_from_slice(&hex::decode(&tba_lower[2..]).unwrap_or_default());
    let topic_addr = B256::from(pad);

    let mut total_inserted = 0usize;

    for (lo, hi) in ranges {
        info!("Processing range {}-{}", lo, hi);

        // Fetch transfers FROM the TBA
        let filter_from = Filter::new()
            .address(usdc_addr)
            .event_signature(transfer_sig)
            .topic1(topic_addr)
            .from_block(lo)
            .to_block(hi);

        // Fetch transfers TO the TBA
        let filter_to = Filter::new()
            .address(usdc_addr)
            .event_signature(transfer_sig)
            .topic2(topic_addr)
            .from_block(lo)
            .to_block(hi);

        for (direction, filter) in [("FROM", filter_from), ("TO", filter_to)] {
            match provider.get_logs(&filter) {
                Ok(logs) => {
                    info!(
                        "Found {} {} transfers in range {}-{}",
                        logs.len(),
                        direction,
                        lo,
                        hi
                    );

                    for log in logs {
                        let tx_hash = match log.transaction_hash {
                            Some(h) => format!("0x{}", hex::encode(h)),
                            None => continue,
                        };

                        if log.topics().len() < 3 {
                            continue;
                        }

                        let from_addr =
                            format!("0x{}", hex::encode(&log.topics()[1].as_slice()[12..]));
                        let to_addr =
                            format!("0x{}", hex::encode(&log.topics()[2].as_slice()[12..]));
                        let amount = U256::from_be_slice(log.data().data.as_ref());
                        let block = log.block_number.unwrap_or(lo);
                        let log_index = log.log_index.map(|v| v as u64);

                        insert_usdc_event(
                            db,
                            &tba_lower,
                            block,
                            None,
                            &tx_hash,
                            log_index,
                            &from_addr,
                            &to_addr,
                            &amount.to_string(),
                        )
                        .await?;

                        total_inserted += 1;
                    }
                }
                Err(e) => {
                    info!(
                        "Error fetching {} logs for range {}-{}: {}",
                        direction, lo, hi, e
                    );
                }
            }
        }
    }

    Ok(total_inserted)
}

// Main bisect ingestion function
pub async fn ingest_usdc_history_via_bisect(
    _state: &State,
    db: &Sqlite,
    provider: &eth::Provider,
    hypermap: &hyperware_process_lib::hypermap::Hypermap,
    tba: &str,
) -> anyhow::Result<usize> {
    ensure_usdc_events_table(db).await?;

    let tba_lower = tba.to_lowercase();
    info!("Starting USDC bisect ingestion for TBA: {}", tba_lower);

    // Check if we've already scanned recently to avoid redundant work
    let last_scan_query = r#"
        SELECT MAX(block) as last_block, MIN(block) as first_block, COUNT(*) as event_count 
        FROM usdc_events 
        WHERE address = ?1
    "#
    .to_string();
    let last_scan = db
        .read(
            last_scan_query,
            vec![serde_json::Value::String(tba_lower.clone())],
        )
        .await?;
    let last_scanned_block = last_scan
        .first()
        .and_then(|r| r.get("last_block"))
        .and_then(|v| v.as_i64())
        .map(|b| b as u64);
    let first_scanned_block = last_scan
        .first()
        .and_then(|r| r.get("first_block"))
        .and_then(|v| v.as_i64())
        .map(|b| b as u64);
    let existing_events = last_scan
        .first()
        .and_then(|r| r.get("event_count"))
        .and_then(|v| v.as_i64())
        .unwrap_or(0);

    // [Get Current Block]
    let end_block = match provider.get_block_number() {
        Ok(block) => block,
        Err(e) => {
            info!(
                "Failed to get current block: {}. Using last scanned + 1000",
                e
            );
            last_scanned_block.unwrap_or(0) + 1000
        }
    };

    // [Get TBA Creation Block from Hypermap] - with optimization
    let start_block = if let Some(first) = first_scanned_block {
        // If we already have events, use the first event block as start
        // This avoids the expensive hypermap lookup
        info!(
            "Using first event block {} as start (skipping hypermap lookup)",
            first
        );
        first
    } else {
        // Only do expensive hypermap lookup if we have no events
        match get_tba_creation_block(hypermap, &tba_lower).await {
            Ok(block) => block,
            Err(e) => {
                info!("Failed to get TBA creation block: {}. Using fallback", e);
                end_block.saturating_sub(100000) // Default 100k blocks back
            }
        }
    };

    // If we've already scanned up to near the current block, only scan new blocks
    if let Some(last) = last_scanned_block {
        if last + 1000 >= end_block && existing_events > 0 {
            info!(
                "Already scanned up to block {}. Only checking recent blocks.",
                last
            );
            let recent_start = last + 1;
            if recent_start >= end_block {
                info!("No new blocks to scan");
                return Ok(0);
            }

            // Just scan the recent blocks without bisect
            match process_balance_change_ranges(
                db,
                provider,
                &tba_lower,
                vec![(recent_start, end_block)],
            )
            .await
            {
                Ok(n) => return Ok(n),
                Err(e) => {
                    info!(
                        "Error scanning recent blocks: {}. Continuing with full bisect.",
                        e
                    );
                }
            }
        }
    }

    info!("Bisect scan from block {} to {}", start_block, end_block);

    if start_block >= end_block {
        info!("No blocks to scan");
        return Ok(0);
    }

    // [Initialize Balance Cache]
    let mut balance_cache = std::collections::HashMap::new();

    // [Bisect Algorithm: find_ranges(start, end)] - with error handling
    let ranges = match bisect_find_balance_change_ranges(
        provider,
        USDC_BASE_ADDRESS,
        &tba_lower,
        start_block,
        end_block,
        10, // window_cap = 10 blocks for current RPC limits
        &mut balance_cache,
    )
    .await
    {
        Ok(ranges) => ranges,
        Err(e) => {
            info!("Bisect algorithm failed: {}. Attempting fallback scan.", e);
            // Fallback: just scan recent activity
            vec![(end_block.saturating_sub(10000), end_block)]
        }
    };

    if ranges.is_empty() {
        info!("No USDC balance changes detected. Nothing to fetch.");
        return Ok(0);
    }

    info!("{} change windows to fetch logs for", ranges.len());

    // [For each range in ranges] - with error tolerance
    let total_inserted = match process_balance_change_ranges(db, provider, &tba_lower, ranges).await
    {
        Ok(n) => n,
        Err(e) => {
            info!(
                "Error processing ranges: {}. Partial results may have been saved.",
                e
            );
            0
        }
    };

    info!(
        "Bisect USDC scan complete. Rows inserted: {}",
        total_inserted
    );

    // Update scan state to current block
    if let Err(e) = update_scan_state(db, &tba_lower, end_block).await {
        error!("Failed to update scan state: {:?}", e);
    }

    Ok(total_inserted)
}

/// Check if we need to run expensive bisect ingestion
pub async fn check_needs_bisect_ingestion(db: &Sqlite, tba: &str) -> anyhow::Result<bool> {
    ensure_usdc_events_table(db).await?;
    ensure_ledger_scan_state_table(db).await?;

    let tba_lower = tba.to_lowercase();

    // First check when we last scanned
    let scan_query = r#"
        SELECT last_scan_block 
        FROM ledger_scan_state 
        WHERE tba_address = ?1
    "#
    .to_string();

    let scan_rows = db
        .read(
            scan_query,
            vec![serde_json::Value::String(tba_lower.clone())],
        )
        .await?;
    let last_scan_block = scan_rows
        .first()
        .and_then(|r| r.get("last_scan_block"))
        .and_then(|v| v.as_i64())
        .map(|b| b as u64);

    // Get current block
    let provider = hyperware_process_lib::eth::Provider::new(crate::structs::CHAIN_ID, 30000);
    let current_block = match provider.get_block_number() {
        Ok(block) => block,
        Err(e) => {
            info!(
                "Failed to get current block: {}, assuming bisect not needed",
                e
            );
            return Ok(false);
        }
    };

    // If we've scanned recently (within 10k blocks), we don't need bisect
    if let Some(last_scan) = last_scan_block {
        let scan_gap = current_block.saturating_sub(last_scan);
        if scan_gap < 10_000 {
            info!(
                "Last scan was {} blocks ago (block {}), no bisect needed",
                scan_gap, last_scan
            );
            return Ok(false);
        }
    }

    // Check what events we have
    let query = r#"
        SELECT 
            COUNT(*) as count,
            MAX(block) as last_block
        FROM usdc_events
        WHERE address = ?1
    "#
    .to_string();

    let params = vec![serde_json::Value::String(tba_lower)];
    let rows = db.read(query, params).await?;

    if let Some(row) = rows.first() {
        let count = row.get("count").and_then(|v| v.as_i64()).unwrap_or(0);
        let last_event_block = row
            .get("last_block")
            .and_then(|v| v.as_i64())
            .map(|b| b as u64);

        // If we have no events and haven't scanned recently, need bisect
        if count == 0 && last_scan_block.is_none() {
            info!("No USDC events found and no scan history, bisect needed");
            return Ok(true);
        }

        // If we have events but they're very old and we haven't scanned recently
        if let Some(last_event) = last_event_block {
            let event_gap = current_block.saturating_sub(last_event);

            if event_gap > 50_000 && last_scan_block.is_none() {
                info!(
                    "Last USDC event is {} blocks old and no recent scan, bisect needed",
                    event_gap
                );
                return Ok(true);
            }
        }
    }

    info!("No bisect needed based on scan history and event data");
    Ok(false)
}

/// Ensure the ledger scan state table exists
async fn ensure_ledger_scan_state_table(db: &Sqlite) -> anyhow::Result<()> {
    let stmt = r#"
        CREATE TABLE IF NOT EXISTS ledger_scan_state (
            tba_address TEXT PRIMARY KEY,
            last_scan_block INTEGER NOT NULL,
            last_scan_time INTEGER NOT NULL
        );
    "#
    .to_string();
    db.write(stmt, vec![], None).await?;
    Ok(())
}

/// Update the last scan state
async fn update_scan_state(db: &Sqlite, tba: &str, block: u64) -> anyhow::Result<()> {
    ensure_ledger_scan_state_table(db).await?;

    let stmt = r#"
        INSERT OR REPLACE INTO ledger_scan_state (tba_address, last_scan_block, last_scan_time)
        VALUES (?1, ?2, ?3);
    "#
    .to_string();

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;

    let params = vec![
        serde_json::Value::String(tba.to_lowercase()),
        serde_json::Value::Number(serde_json::Number::from(block as i64)),
        serde_json::Value::Number(serde_json::Number::from(now)),
    ];

    db.write(stmt, params, None).await?;
    Ok(())
}

/// Scan only recent blocks for new USDC events
pub async fn scan_recent_blocks_only(
    db: &Sqlite,
    provider: &eth::Provider,
    tba: &str,
) -> anyhow::Result<usize> {
    ensure_usdc_events_table(db).await?;

    let tba_lower = tba.to_lowercase();

    // Get last scanned block
    let query = r#"
        SELECT MAX(block) as last_block 
        FROM usdc_events 
        WHERE address = ?1
    "#
    .to_string();

    let params = vec![serde_json::Value::String(tba_lower.clone())];
    let rows = db.read(query, params).await?;

    let last_block = rows
        .first()
        .and_then(|r| r.get("last_block"))
        .and_then(|v| v.as_i64())
        .map(|b| b as u64);

    // Get current block
    let current_block = provider
        .get_block_number()
        .map_err(|e| anyhow::anyhow!("Failed to get current block: {}", e))?;

    let start_block = match last_block {
        Some(last) => {
            if last >= current_block {
                info!("Already up to date at block {}", last);
                return Ok(0);
            }
            last + 1
        }
        None => {
            // No history, scan last 1000 blocks
            current_block.saturating_sub(1000)
        }
    };

    if start_block >= current_block {
        return Ok(0);
    }

    info!(
        "Scanning recent blocks {} to {} for USDC events",
        start_block, current_block
    );

    // Use the existing range ingestion function
    let result =
        ingest_usdc_events_for_range(db, provider, &tba_lower, start_block, current_block).await;

    // Update scan state regardless of whether we found events
    if result.is_ok() {
        if let Err(e) = update_scan_state(db, &tba_lower, current_block).await {
            error!("Failed to update scan state: {:?}", e);
        }
    }

    result
}

/// Load recent call records from the ledger
pub async fn load_recent_call_history(
    db: &Sqlite,
    tba: &str,
    limit: usize,
    state: Option<&crate::structs::State>,
) -> anyhow::Result<Vec<crate::structs::CallRecord>> {
    ensure_usdc_call_ledger_table(db).await?;

    let query = r#"
        SELECT 
            tx_hash,
            block,
            time,
            client_id,
            provider_name,
            provider_address,
            provider_cost_units,
            gas_fees_units,
            total_cost_units
        FROM usdc_call_ledger
        WHERE tba_address = ?1 AND block > 0
        ORDER BY block DESC
        LIMIT ?2
    "#
    .to_string();

    let params = vec![
        serde_json::Value::String(tba.to_lowercase()),
        serde_json::Value::Number((limit as i64).into()),
    ];

    let rows = db.read(query, params).await?;
    let mut records = Vec::new();

    for row in rows {
        let tx_hash = row
            .get("tx_hash")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let block = row.get("block").and_then(|v| v.as_i64()).unwrap_or(0) as u64;
        let client_id = row
            .get("client_id")
            .and_then(|v| v.as_str())
            .map(String::from);
        let provider_name = row
            .get("provider_name")
            .and_then(|v| v.as_str())
            .map(String::from);
        let provider_address = row
            .get("provider_address")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let total_cost_units = row
            .get("total_cost_units")
            .and_then(|v| v.as_str())
            .unwrap_or("0");

        // Convert units to display amount
        let amount_paid = if let Ok(units) = total_cost_units.parse::<i128>() {
            let whole = units / 1_000_000;
            let frac = (units % 1_000_000).abs();
            format!("{}.{:06}", whole, frac)
        } else {
            "0.0".to_string()
        };

        // Build payment result
        let payment_result = if !tx_hash.is_empty() && total_cost_units != "0" {
            Some(crate::structs::PaymentAttemptResult::Success {
                tx_hash: tx_hash.clone(),
                amount_paid,
                currency: "USDC".to_string(),
            })
        } else {
            Some(crate::structs::PaymentAttemptResult::Skipped {
                reason: "Zero Price".to_string(),
            })
        };

        // Serialize payment result to JSON string for WIT compatibility
        let payment_result_json = payment_result
            .as_ref()
            .map(|pr| serde_json::to_string(pr).unwrap_or_else(|_| "null".to_string()));

        // Look up the actual provider ID from the wallet address
        let provider_id = if !provider_address.is_empty() {
            match crate::db::get_providers_by_wallet(db, &provider_address).await {
                Ok(providers) => {
                    // If we have the provider name, find the matching provider
                    if let Some(ref name) = provider_name {
                        providers.iter()
                            .find(|p| p.get("name").and_then(|v| v.as_str()) == Some(name))
                            .or_else(|| providers.first()) // Fallback to first if name doesn't match
                            .and_then(|p| p.get("provider_id"))
                            .and_then(|v| v.as_str())
                            .map(String::from)
                            .unwrap_or_else(|| provider_address.clone())
                    } else {
                        // No name to match on, use first provider with this wallet
                        providers.first()
                            .and_then(|p| p.get("provider_id"))
                            .and_then(|v| v.as_str())
                            .map(String::from)
                            .unwrap_or_else(|| provider_address.clone())
                    }
                }
                Err(_) => provider_address.clone(), // Fallback to wallet address if lookup fails
            }
        } else {
            provider_address.clone()
        };

        // Look up operator_wallet_id from state if available
        let operator_wallet_id = if let (Some(st), Some(ref cid)) = (state, &client_id) {
            st.authorized_clients
                .iter()
                .find(|(id, _)| id == cid)
                .map(|(_, client)| client.associated_hot_wallet_address.clone())
        } else {
            None
        };

        // Create a CallRecord
        let record = crate::structs::CallRecord {
            timestamp_start_ms: block * 1000, // Approximate (block to ms)
            provider_lookup_key: provider_id.clone(),
            target_provider_id: provider_id,
            call_args_json: "[]".to_string(), // Not stored in ledger
            response_json: None,              // Not stored in ledger
            call_success: true,               // Assume success if in ledger
            response_timestamp_ms: block * 1000,
            payment_result: payment_result_json,
            duration_ms: 0,                  // Not stored
            operator_wallet_id,
            client_id,
            provider_name,
        };

        records.push(record);
    }

    Ok(records)
}

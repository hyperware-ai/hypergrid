use hyperware_process_lib::sqlite::Sqlite;
use hyperware_process_lib::logging::{info};
use alloy_primitives::{U256, B256, keccak256};
use hyperware_process_lib::eth;
use crate::constants::{CIRCLE_PAYMASTER, USDC_BASE_ADDRESS};
use hex;

use crate::structs::{State, PaymentAttemptResult};

// Schemas owned by ledger
pub fn ensure_usdc_events_table(db: &Sqlite) -> anyhow::Result<()> {
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
    "#.to_string();
    db.write(stmt, vec![], None)?;
    let idx1 = r#"CREATE UNIQUE INDEX IF NOT EXISTS idx_usdc_events_tx_log ON usdc_events (tx_hash, log_index);"#.to_string();
    db.write(idx1, vec![], None)?;
    let idx2 = r#"CREATE INDEX IF NOT EXISTS idx_usdc_events_addr_block ON usdc_events (address, block);"#.to_string();
    db.write(idx2, vec![], None)?;
    Ok(())
}

pub fn ensure_usdc_call_ledger_table(db: &Sqlite) -> anyhow::Result<()> {
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
    "#.to_string();
    db.write(stmt, vec![], None)?;
    let idx1 = r#"CREATE INDEX IF NOT EXISTS idx_usdc_ledger_tba_block ON usdc_call_ledger (tba_address, block);"#.to_string();
    db.write(idx1, vec![], None)?;
    let idx2 = r#"CREATE UNIQUE INDEX IF NOT EXISTS idx_usdc_ledger_tx ON usdc_call_ledger (tx_hash);"#.to_string();
    db.write(idx2, vec![], None)?;
    Ok(())
}

pub fn usdc_display_to_units(s: &str) -> Option<U256> {
    let s = s.trim();
    if s.is_empty() { return None; }
    let parts: Vec<&str> = s.split('.').collect();
    let one = U256::from(1_000_000u64);
    match parts.len() {
        1 => U256::from_str_radix(parts[0], 10).ok().map(|v| v * one),
        2 => {
            let int = U256::from_str_radix(parts[0], 10).ok()?;
            let mut frac = parts[1].to_string();
            if frac.len() > 6 { frac.truncate(6); }
            while frac.len() < 6 { frac.push('0'); }
            let frac_v = U256::from_str_radix(&frac, 10).ok()?;
            Some(int * one + frac_v)
        }
        _ => None,
    }
}

fn insert_usdc_event(
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
    "#.to_string();
    let params = vec![
        serde_json::Value::String(address.to_string()),
        serde_json::Value::Number((block as i64).into()),
        time.map(|t| serde_json::Value::Number((t as i64).into())).unwrap_or(serde_json::Value::Null),
        serde_json::Value::String(tx_hash.to_string()),
        log_index.map(|i| serde_json::Value::Number((i as i64).into())).unwrap_or(serde_json::Value::Null),
        serde_json::Value::String(from_addr.to_string()),
        serde_json::Value::String(to_addr.to_string()),
        serde_json::Value::String(value_units.to_string()),
    ];
    db.write(stmt, params, None)?;
    Ok(())
}

fn upsert_usdc_ledger_row(
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
        time.map(|t| serde_json::Value::Number((t as i64).into())).unwrap_or(serde_json::Value::Null),
        client_id.map(|s| serde_json::Value::String(s.to_string())).unwrap_or(serde_json::Value::Null),
        provider_name.map(|s| serde_json::Value::String(s.to_string())).unwrap_or(serde_json::Value::Null),
        provider_address.map(|s| serde_json::Value::String(s.to_string())).unwrap_or(serde_json::Value::Null),
        serde_json::Value::String(provider_cost.to_string()),
        serde_json::Value::String(paymaster_deposit.to_string()),
        serde_json::Value::String(paymaster_refund.to_string()),
        serde_json::Value::String(gas_fees.to_string()),
        serde_json::Value::String(total_cost.to_string()),
    ];
    db.write(stmt, params, None)?;
    Ok(())
}

pub fn build_usdc_ledger_for_tba(state: &State, db: &Sqlite, tba: &str) -> anyhow::Result<usize> {
    ensure_usdc_events_table(db)?;
    ensure_usdc_call_ledger_table(db)?;

    // Map tx_hash -> (client_id, provider_name, amount_units)
    let mut call_map: std::collections::HashMap<String, (Option<String>, Option<String>, Option<U256>)> = std::collections::HashMap::new();
    for rec in &state.call_history {
        if let Some(PaymentAttemptResult::Success { tx_hash, amount_paid, .. }) = &rec.payment_result {
            let amt_units = usdc_display_to_units(amount_paid.as_str());
            call_map.insert(
                tx_hash.to_lowercase(),
                (
                    rec.client_id.clone(),
                    rec.provider_name.clone(),
                    amt_units,
                ),
            );
        }
    }

    // Get distinct txs for this TBA
    let q = r#"
        SELECT tx_hash, MIN(block) AS block, MIN(COALESCE(time, 0)) AS time
        FROM usdc_events WHERE address = ?1
        GROUP BY tx_hash ORDER BY block ASC
    "#.to_string();
    let rows = db.read(q, vec![serde_json::Value::String(tba.to_string())])?;
    let mut updated = 0usize;
    for row in rows {
        let tx = row.get("tx_hash").and_then(|v| v.as_str()).unwrap_or("");
        if tx.is_empty() { continue; }
        let block = row.get("block").and_then(|v| v.as_i64()).unwrap_or(0) as u64;
        let time = row.get("time").and_then(|v| v.as_i64()).map(|v| v as u64);

        // Fetch all events for this tx
        let qev = r#"
            SELECT from_addr, to_addr, value_units FROM usdc_events
            WHERE address = ?1 AND tx_hash = ?2
        "#.to_string();
        let evs = db.read(qev, vec![serde_json::Value::String(tba.to_string()), serde_json::Value::String(tx.to_string())])?;

        let mut deposit_out = U256::ZERO;
        let mut refund_in = U256::ZERO;
        let mut provider_cost = U256::ZERO;
        let mut provider_addr: Option<String> = None;
        let pm = CIRCLE_PAYMASTER.to_lowercase();
        let tba_l = tba.to_lowercase();
        for ev in evs {
            let fa = ev.get("from_addr").and_then(|v| v.as_str()).unwrap_or("").to_lowercase();
            let ta = ev.get("to_addr").and_then(|v| v.as_str()).unwrap_or("").to_lowercase();
            let vu = ev.get("value_units").and_then(|v| v.as_str()).unwrap_or("0");
            let amount = U256::from_str_radix(vu, 10).unwrap_or(U256::ZERO);
            let is_out = fa == tba_l;
            let is_in = ta == tba_l;
            if is_out && ta == pm {
                deposit_out = deposit_out.saturating_add(amount);
            } else if is_in && fa == pm {
                refund_in = refund_in.saturating_add(amount);
            } else if is_out && ta != pm {
                if amount > provider_cost { provider_cost = amount; provider_addr = Some(ta); }
            }
        }
        let gas_fees = if deposit_out > refund_in { deposit_out - refund_in } else { U256::ZERO };
        let total_cost = provider_cost + gas_fees;

        let (client_id_opt, provider_name_opt, _amt_units_opt) = call_map.get(&tx.to_lowercase())
            .cloned().unwrap_or((None, None, None));

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
        )?;
        updated += 1;
    }
    Ok(updated)
}

pub fn build_ledger_for_tx(state: &State, db: &Sqlite, tba: &str, tx: &str) -> anyhow::Result<()> {
    ensure_usdc_call_ledger_table(db)?;
    // Prepare call map for this tx
    let mut cid: Option<String> = None;
    let mut pname: Option<String> = None;
    for rec in &state.call_history {
        if let Some(PaymentAttemptResult::Success { tx_hash, .. }) = &rec.payment_result {
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
    "#.to_string();
    let params = vec![serde_json::Value::String(tba.to_string()), serde_json::Value::String(tx.to_string())];
    let row = db.read(qev, params)?;
    if row.is_empty() { return Ok(()); }

    // Re-query all rows to sum
    let qall = r#"
        SELECT from_addr, to_addr, value_units FROM usdc_events
        WHERE address = ?1 AND tx_hash = ?2
    "#.to_string();
    let evs = db.read(qall, vec![serde_json::Value::String(tba.to_string()), serde_json::Value::String(tx.to_string())])?;
    let mut deposit_out = U256::ZERO;
    let mut refund_in = U256::ZERO;
    let mut provider_cost = U256::ZERO;
    let mut provider_addr: Option<String> = None;
    let pm = CIRCLE_PAYMASTER.to_lowercase();
    let tba_l = tba.to_lowercase();
    for ev in evs {
        let fa = ev.get("from_addr").and_then(|v| v.as_str()).unwrap_or("").to_lowercase();
        let ta = ev.get("to_addr").and_then(|v| v.as_str()).unwrap_or("").to_lowercase();
        let vu = ev.get("value_units").and_then(|v| v.as_str()).unwrap_or("0");
        let amount = U256::from_str_radix(vu, 10).unwrap_or(U256::ZERO);
        let is_out = fa == tba_l;
        let is_in = ta == tba_l;
        if is_out && ta == pm { deposit_out = deposit_out.saturating_add(amount); }
        else if is_in && fa == pm { refund_in = refund_in.saturating_add(amount); }
        else if is_out && ta != pm { if amount > provider_cost { provider_cost = amount; provider_addr = Some(ta); } }
    }
    let gas_fees = if deposit_out > refund_in { deposit_out - refund_in } else { U256::ZERO };
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
    )?;
    Ok(())
}

pub fn ensure_call_tx_covered(state: &State, db: &Sqlite, provider: &eth::Provider, tba: &str, tx: &str) -> anyhow::Result<bool> {
    ensure_usdc_events_table(db)?;
    ensure_usdc_call_ledger_table(db)?;
    let tx_l = tx.to_lowercase();
    let tba_l = tba.to_lowercase();
    // already in ledger?
    let ql = r#"SELECT 1 FROM usdc_call_ledger WHERE tx_hash = ?1 AND tba_address = ?2 LIMIT 1"#.to_string();
    let exists = db.read(ql, vec![serde_json::Value::String(tx_l.clone()), serde_json::Value::String(tba_l.clone())])?;
    if !exists.is_empty() { return Ok(false); }

    // events exist?
    let qe = r#"SELECT 1 FROM usdc_events WHERE tx_hash = ?1 AND address = ?2 LIMIT 1"#.to_string();
    let ev_exists = db.read(qe, vec![serde_json::Value::String(tx_l.clone()), serde_json::Value::String(tba_l.clone())])?;
    if ev_exists.is_empty() {
        // fetch receipt
        let mut tx_bytes = [0u8; 32];
        if let Ok(b) = hex::decode(tx_l.trim_start_matches("0x")) { if b.len() == 32 { tx_bytes.copy_from_slice(&b); } }
        let tx_b256 = B256::from(tx_bytes);
        if let Ok(Some(rcpt)) = provider.get_transaction_receipt(tx_b256) {
            for rlog in rcpt.inner.logs().iter() {
                // Filter USDC Transfer logs in this tx pertaining to TBA
                if format!("0x{}", hex::encode(rlog.address())) != USDC_BASE_ADDRESS { continue; }
                let transfer_sig = keccak256("Transfer(address,address,uint256)".as_bytes());
                if rlog.topics().first().copied() != Some(transfer_sig.into()) { continue; }
                if rlog.topics().len() < 3 { continue; }
                let from_addr = &rlog.topics()[1].as_slice()[12..];
                let to_addr = &rlog.topics()[2].as_slice()[12..];
                let from_hex = format!("0x{}", hex::encode(from_addr));
                let to_hex = format!("0x{}", hex::encode(to_addr));
                if !from_hex.eq_ignore_ascii_case(&tba_l) && !to_hex.eq_ignore_ascii_case(&tba_l) { continue; }
                let amount = U256::from_be_slice(rlog.data().data.as_ref());
                let blk = rcpt.block_number.unwrap_or(0);
                let log_index = rlog.log_index.map(|v| v.into());
                insert_usdc_event(db, &tba_l, blk, None, &tx_l, log_index, &from_hex, &to_hex, &amount.to_string())?;
            }
        }
    }

    // build ledger for this tx (if we inserted nothing and no events, this is a no-op)
    build_ledger_for_tx(state, db, &tba_l, &tx_l)?;
    Ok(true)
}

pub fn verify_calls_covering(state: &State, db: &Sqlite, provider: &eth::Provider, tba: &str) -> anyhow::Result<usize> {
    let mut updated = 0usize;
    for rec in &state.call_history {
        if let Some(PaymentAttemptResult::Success { tx_hash, .. }) = &rec.payment_result {
            if ensure_call_tx_covered(state, db, provider, tba, tx_hash)? { updated += 1; }
        }
    }
    Ok(updated)
}

pub fn show_ledger(db: &Sqlite, tba: &str, limit: u64) -> anyhow::Result<()> {
    ensure_usdc_call_ledger_table(db)?;
    let q = r#"
        SELECT block, time, tx_hash, client_id, provider_name, provider_cost_units, gas_fees_units, total_cost_units
        FROM usdc_call_ledger
        WHERE tba_address = ?1
        ORDER BY block DESC
        LIMIT ?2
    "#.to_string();
    let rows = db.read(q, vec![serde_json::Value::String(tba.to_string()), serde_json::Value::Number((limit as i64).into())])?;
    info!("USDC ledger for {} (showing {}):", tba, rows.len());
    for r in rows {
        let blk = r.get("block").and_then(|v| v.as_i64()).unwrap_or(0);
        let ts = r.get("time").and_then(|v| v.as_i64()).unwrap_or(0);
        let tx = r.get("tx_hash").and_then(|v| v.as_str()).unwrap_or("");
        let cid = r.get("client_id").and_then(|v| v.as_str()).unwrap_or("");
        let pn = r.get("provider_name").and_then(|v| v.as_str()).unwrap_or("");
        let pc = r.get("provider_cost_units").and_then(|v| v.as_str()).unwrap_or("0");
        let gf = r.get("gas_fees_units").and_then(|v| v.as_str()).unwrap_or("0");
        let tc = r.get("total_cost_units").and_then(|v| v.as_str()).unwrap_or("0");
        info!("blk={} ts={} tx={} client={} provider={} provider_cost={} gas_fees={} total={} (units)", blk, ts, tx, cid, pn, pc, gf, tc);
    }
    Ok(())
}



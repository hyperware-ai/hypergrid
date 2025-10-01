use hyperware_process_lib::homepage::add_to_homepage;
use hyperware_process_lib::hypermap::Hypermap;
use hyperware_process_lib::hyperwallet_client::{
    initialize, HandshakeConfig, Operation, SessionInfo, SpendingLimits,
};
use hyperware_process_lib::logging::{error, info};
use hyperware_process_lib::{sqlite::Sqlite, Address};

/// Register the operator in the homepage
pub fn register_homepage() {
    add_to_homepage("Hypergrid", Some(include_str!("./icon")), Some("/"), None);
}

/// Initialize hypermap with default timeout
pub fn initialize_hypermap() -> Hypermap {
    Hypermap::default(60)
}

/// Create default spending limits for hyperwallet
pub fn create_default_spending_limits() -> SpendingLimits {
    SpendingLimits {
        per_tx_eth: Some("0.1".to_string()),
        daily_eth: Some("1".to_string()),
        per_tx_usdc: Some("100".to_string()),
        daily_usdc: Some("1000".to_string()),
        daily_reset_at: 0, // Timestamp for daily reset
        spent_today_eth: "0".to_string(),
        spent_today_usdc: "0".to_string(),
    }
}

/// Build hyperwallet configuration
pub fn build_hyperwallet_config() -> HandshakeConfig {
    let default_limits = create_default_spending_limits();

    HandshakeConfig::new()
        .with_operations(&[
            Operation::CreateWallet,
            Operation::ImportWallet,
            Operation::ListWallets,
            Operation::GetWalletInfo,
            Operation::SetWalletLimits,
            Operation::SendEth,
            Operation::SendToken,
            Operation::ExecuteViaTba,
            Operation::GetBalance,
            Operation::GetTokenBalance,
            Operation::ResolveIdentity,
            Operation::CreateNote,
            Operation::ReadNote,
            Operation::SetupDelegation,
            Operation::VerifyDelegation,
            Operation::GetTransactionHistory,
            Operation::UpdateSpendingLimits,
            Operation::RenameWallet,
            Operation::BuildUserOperation,
            Operation::BuildAndSignUserOperation,
            Operation::BuildAndSignUserOperationForPayment,
            Operation::SignUserOperation,
            Operation::SubmitUserOperation,
            Operation::EstimateUserOperationGas,
            Operation::GetUserOperationReceipt,
            Operation::ConfigurePaymaster,
        ])
        .with_spending_limits(default_limits)
        .with_name("hypergrid-operator")
}

/// Initialize hyperwallet service
pub fn initialize_hyperwallet_call() -> Result<SessionInfo, String> {
    let config = build_hyperwallet_config();

    match initialize(config) {
        Ok(session) => {
            info!("Hyperwallet session established successfully");
            Ok(session)
        }
        Err(e) => {
            error!("FATAL: Hyperwallet initialization failed: {:?}", e);
            error!("The operator requires hyperwallet service to be running and accessible.");
            error!("Please ensure hyperwallet:hyperwallet:sys is installed and running.");
            Err(format!("Hyperwallet initialization failed: {:?}", e))
        }
    }
}

/// Initialize hyperwallet and handle initial wallet setup
pub async fn initialize_hyperwallet(process: &mut crate::OperatorProcess) {
    match initialize_hyperwallet_call() {
        Ok(session) => {
            process.hyperwallet_session = Some(session);
            process.state.hyperwallet_session_active = true;

            // Generate a wallet for the operator if none exists
            if process.state.selected_wallet_id.is_none()
                && process.state.managed_wallets.is_empty()
            {
                info!("No wallets found, generating initial wallet for operator");
                match crate::wallet::generate_wallet(process).await {
                    Ok(wallet_id) => {
                        info!("Successfully generated initial wallet: {}", wallet_id);
                    }
                    Err(e) => {
                        error!("Failed to generate initial wallet for operator: {}", e);
                    }
                }
            } else if let Some(wallet_id) = &process.state.selected_wallet_id {
                info!("Wallet already selected: {}", wallet_id);
            }
        }
        Err(e) => {
            panic!("{}", e);
        }
    }
}

/// Initialize database only
pub async fn initialize_database(process: &mut crate::OperatorProcess) {
    let our = hyperware_process_lib::our();

    match initialize_database_connection(&our).await {
        Ok(db) => {
            process.db_conn = Some(db);
            process.state.db_initialized = true;
            info!("Database initialized successfully");
        }
        Err(e) => {
            panic!("{}", e);
        }
    }
}

/// Initialize ledger after identity has been established
pub async fn initialize_ledger(process: &mut crate::OperatorProcess) {
    // Only initialize ledger if we have both database and TBA address
    if let Some(db) = &process.db_conn {
        if process.state.operator_tba_address.is_some() {
            initialize_ledger_if_ready(&mut process.state, db, process.hypermap.as_ref()).await;
            // Notify WebSocket clients about potential balance changes
            process.notify_graph_state_update();
            process.notify_wallet_balance_update().await;
            // Notify about authorization updates (includes client limits and spending)
            notify_authorization_after_ledger_init(process).await;
        } else {
            info!("Skipping ledger initialization - no operator TBA address yet");
        }
    }
}

/// Initialize operator identity
pub async fn initialize_identity(process: &mut crate::OperatorProcess) {
    let our = hyperware_process_lib::our();
    info!(
        "Attempting to initialize operator identity for node: {}",
        our.node()
    );

    match crate::identity::initialize_operator_identity(&our, &mut process.state) {
        Ok(_) => {
            info!("Operator identity initialization completed");

            // If we just initialized identity and have a DB, we might need to init ledger now
            if process.state.operator_tba_address.is_some() {
                if let Some(db) = &process.db_conn {
                    if !process.state.client_limits_cache.is_empty()
                        || !process.state.authorized_clients.is_empty()
                    {
                        // Ledger might have been initialized here, notify about authorization updates
                        notify_authorization_after_ledger_init(process).await;
                    }
                }
            }

            // Notify WebSocket clients about potential graph state changes
            process.notify_graph_state_update();
        }
        Err(e) => {
            error!("Failed to initialize operator identity: {:?}", e);
            // Don't panic here as the operator can still function without identity
        }
    }
}

/// Initialize database connection
pub async fn initialize_database_connection(our: &Address) -> Result<Sqlite, String> {
    info!("Loading database...");

    match crate::db::load_db(our).await {
        Ok(db_conn) => {
            info!("Database loaded successfully");
            Ok(db_conn)
        }
        Err(e) => {
            error!("FATAL: Failed to load database: {:?}", e);
            Err(format!("Database load failed: {:?}", e))
        }
    }
}

/// Initialize USDC ledger tables and refresh client totals if TBA is known
pub async fn initialize_ledger_if_ready(
    state: &mut crate::structs::State,
    db: &hyperware_process_lib::sqlite::Sqlite,
    hypermap: Option<&hyperware_process_lib::hypermap::Hypermap>,
) {
    let tba_opt = state.operator_tba_address.clone();
    if let Some(tba) = tba_opt {
        //if let Err(e) = crate::ledger::ensure_usdc_events_table(db).await {
        //    error!("Failed ensuring usdc_events table: {:?}", e);
        //}
        //if let Err(e) = crate::ledger::ensure_usdc_call_ledger_table(db).await {
        //    error!("Failed ensuring usdc_call_ledger table: {:?}", e);
        //}

        // Check if we need to run bisect ingestion
        let needs_bisect =
            match crate::ledger::check_needs_bisect_ingestion(db, &tba.to_lowercase()).await {
                Ok(needs) => needs,
                Err(e) => {
                    error!("Failed to check bisect needs: {:?}", e);
                    false // Skip on error
                }
            };

        if needs_bisect {
            info!("USDC history needs update, running bisect ingestion");

            // Only run bisect ingestion if hypermap is available
            if let Some(hypermap) = hypermap {
                // Create provider and initialize USDC history using bisect approach
                let provider =
                    hyperware_process_lib::eth::Provider::new(crate::structs::CHAIN_ID, 30000);

                match crate::ledger::ingest_usdc_history_via_bisect(
                    &state,
                    db,
                    &provider,
                    hypermap,
                    &tba.to_lowercase(),
                )
                .await
                {
                    Ok(n) => info!(
                        "USDC bisect initialization for {}: {} events ingested",
                        tba, n
                    ),
                    Err(e) => error!("Failed initializing USDC history via bisect: {:?}", e),
                }
            } else {
                info!("Hypermap not available yet, skipping USDC history ingestion");
            }
        } else {
            info!("USDC history is up to date, skipping bisect ingestion");

            // Just scan recent blocks for new activity
            let provider =
                hyperware_process_lib::eth::Provider::new(crate::structs::CHAIN_ID, 30000);
            match crate::ledger::scan_recent_blocks_only(db, &provider, &tba.to_lowercase()).await {
                Ok(n) => {
                    if n > 0 {
                        info!("Found {} new USDC events in recent blocks", n);
                    }
                }
                Err(e) => error!("Failed to scan recent blocks: {:?}", e),
            }
        }

        match crate::ledger::build_usdc_ledger_for_tba(&state, db, &tba.to_lowercase()).await {
            Ok(n) => info!("USDC ledger built on boot for {} ({} rows)", tba, n),
            Err(e) => error!("Failed to build USDC ledger on boot: {:?}", e),
        }
        if let Err(e) = state.refresh_client_totals_from_ledger(db, &tba).await {
            error!("Failed to refresh client totals from ledger: {:?}", e);
        }
    }
}

/// Notify WebSocket clients about authorization updates after ledger refresh
pub async fn notify_authorization_after_ledger_init(process: &mut crate::OperatorProcess) {
    // Only notify if we have authorized clients
    if !process.state.authorized_clients.is_empty() {
        process.notify_authorization_update();

        // Also send fresh state snapshots to all connected WebSocket clients
        // This ensures they get the updated spending data
        let connections: Vec<u32> = process.ws_connections.keys().cloned().collect();
        for channel_id in connections {
            process.send_state_snapshot(channel_id).await;
        }
    }
}

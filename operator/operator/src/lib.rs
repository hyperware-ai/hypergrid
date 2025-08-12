pub mod graph;
mod structs;
mod http_handlers;
//mod wallet_manager;
mod db;
mod chain;
mod helpers;
mod identity;
mod authorized_services;
pub mod constants;
// Keep local module for functions not yet available in the library
pub mod hyperwallet_client;


use hyperware_process_lib::homepage::add_to_homepage;
use hyperware_process_lib::http::server::{HttpBindingConfig, HttpServer};
use hyperware_process_lib::logging::{info, init_logging, Level, error};
use hyperware_process_lib::{await_message, call_init, Address, Message};
use hyperware_process_lib::sqlite::Sqlite;
// Import the new hyperwallet client library with alias to avoid naming conflict
use hyperware_process_lib::hyperwallet_client as hw_lib;
use hw_lib::{initialize, HandshakeConfig, Operation, SpendingLimits};
use structs::*;

//use crate::wallet::{service as wallet_service};

const ICON: &str = include_str!("./icon");


// TODO b4 beta: clean these endpoints up
fn init_http() -> anyhow::Result<HttpServer> {
    let mut http_server = HttpServer::new(5);
    let http_config_authenticated = HttpBindingConfig::default().authenticated(true);
    let http_config_unauthenticated = HttpBindingConfig::default()
        .authenticated(false)
        .local_only(false)
        .secure_subdomain(false);

    // REST API endpoints
    http_server.bind_http_path("/api/search", http_config_authenticated.clone())?;
    http_server.bind_http_path("/api/state", http_config_authenticated.clone())?;
    http_server.bind_http_path("/api/actions", http_config_authenticated.clone())?;

    http_server.bind_http_path("/api/all", http_config_authenticated.clone())?;
    http_server.bind_http_path("/api/setup-status", http_config_authenticated.clone())?;
    http_server.bind_http_path("/api/onboarding-status", http_config_authenticated.clone())?;
    http_server.bind_http_path("/api/verify-delegation-and-funding", http_config_authenticated.clone())?;

    // Graph endpoints
    http_server.bind_http_path("/api/hypergrid-graph", http_config_authenticated.clone())?;
    http_server.bind_http_path("/api/managed-wallets", http_config_authenticated.clone())?;
    http_server.bind_http_path("/api/linked-wallets", http_config_authenticated.clone())?;
    
    // MCP endpoints
    http_server.bind_http_path("/api/mcp", http_config_authenticated.clone())?;
    http_server.bind_http_path("/api/save-shim-key", http_config_authenticated.clone())?;

    // MCP Shim endpoints (X-API-Key validation)
    http_server.bind_http_path("/shim/mcp", http_config_unauthenticated.clone())?;
    
    // UI
    add_to_homepage("Hypergrid", Some(ICON), Some("/"), None);
    // this changes depending on you are only building operator, or both
    // change back to just ui when building only operator to not have to build the provider
    http_server.serve_ui("ui", vec!["/"], http_config_authenticated)?;

    Ok(http_server)
}

call_init!(init);
fn init(our: Address) {
    init_logging(Level::DEBUG, Level::INFO, None, None, None).unwrap();
    info!("begin hypergrid operator for: {}", our.node);

    let mut state = State::load();

    // Initialize Operator Identity using the new module
    if let Err(e) = identity::initialize_operator_identity(&our, &mut state) {
        error!("Failed during operator identity initialization: {:?}", e);
    }

    // Initialize hyperwallet connection using new handshake protocol
    // Set up default spending limits for the operator
    let default_limits = SpendingLimits {
        per_tx_eth: Some("1.0".to_string()),      // 1 ETH per transaction
        daily_eth: Some("10.0".to_string()),      // 10 ETH daily limit
        per_tx_usdc: Some("100.0".to_string()), // 100 USDC per transaction  
        daily_usdc: Some("1000.0".to_string()), // 1000 USDC daily limit
        daily_reset_at: 0,                        // Will be set by hyperwallet
        spent_today_eth: "0".to_string(),         // Will be tracked by hyperwallet
        spent_today_usdc: "0".to_string(),        // Will be tracked by hyperwallet
    };

    let config = HandshakeConfig::new()
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
        .with_name("hypergrid-operator");

    match initialize(config) {
        Ok(session) => {
            info!("Hyperwallet session established successfully");
            state.hyperwallet_session = Some(session);
        }
        Err(e) => {
            error!("FATAL: Hyperwallet initialization failed: {:?}", e);
            error!("The operator requires hyperwallet service to be running and accessible.");
            error!("Please ensure hyperwallet:hyperwallet:sys is installed and running.");
            panic!("Hyperwallet initialization failed - operator cannot function without it");
        }
    }

    // Save state with session info
    state.save();

    // Initialize DB as local variable
    info!("Loading database..");
    let db = match db::load_db(&our) {
        Ok(db_conn) => db_conn,
        Err(e) => {
            error!("FATAL: Failed to load database: {:?}", e);
            panic!("DB Load Failed!"); 
        }
    };

    // Initialize Chain Syncing
    //let mut pending_logs: PendingLogs = Vec::new(); 
    info!("Starting chain fetch...");
    let mut pending_logs = chain::start_fetch(&mut state, &db);
    info!("Chain listeners initialized.");

    // Initialize HTTP server
    match init_http() {
        Ok(_http_server) => info!("Successfully initialized and bound HTTP server."),
        Err(e) => error!("FATAL: Failed to initialize HTTP server: {:?}", e),
    }
    
    info!("Entering main message loop...");
    loop {
        if let Err(e) = main(&our, &mut state, &db, &mut pending_logs) {
            error!("Error in main loop: {:?}", e);
            break;
        }
    }
    info!("Exited main message loop.");
}

fn main(
    our: &Address, 
    state: &mut State, 
    db: &Sqlite,
    pending_logs: &mut PendingLogs
) -> anyhow::Result<()> {
    let message = await_message()?;
    match message {
        // Updated handler signatures
        Message::Request { source, body, .. } => handle_request(our, &source, body, state, db, pending_logs),
        Message::Response { source, body, context, ..} => handle_response(our, &source, body, context, state, db, pending_logs),
    }
}

fn handle_request(
    our: &Address,
    source: &Address,
    body: Vec<u8>,
    state: &mut State,
    db: &Sqlite, 
    pending_logs: &mut PendingLogs 
) -> anyhow::Result<()> {
    let process = source.process.to_string();
    let pkg = source.package_id().to_string();

    match process.as_str() {
        "http-server:distro:sys" => http_handlers::handle_frontend(our, &body, state, db)?,
        "eth:distro:sys" =>         chain::handle_eth_message(state, db, pending_logs, &body)?,
        _ => {
            if pkg == "terminal:sys" {
                helpers::handle_terminal_debug(our, &body, state, db)?;
            } else {
                info!("Ignoring unexpected direct request from: {}", source);
            }
        }
    }

    Ok(())
}


fn handle_response(
    _our: &Address,
    source: &Address,
    body: Vec<u8>,
    context: Option<Vec<u8>>,
    state: &mut State,
    db: &Sqlite, // Pass db
    pending: &mut PendingLogs // Pass pending
) -> anyhow::Result<()> {
    let process = source.process.to_string();

    match process.as_str() {
        "timer:distro:sys" => chain::handle_timer(state, db, pending, context == Some(b"checkpoint".to_vec()))?,
        "eth:distro:sys" =>   chain::handle_eth_message(state, db, pending, &body)?,
        _ => info!("Ignoring response from unexpected process: {}", source),
    };
    Ok(())
}

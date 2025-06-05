pub mod graph;
mod structs;
mod http_handlers;
//mod wallet_manager;
mod db;
mod chain;
mod helpers;
mod identity;
mod authorized_services;
pub mod wallet;

use hyperware_process_lib::homepage::add_to_homepage;
use hyperware_process_lib::http::server::{HttpBindingConfig, HttpServer};
use hyperware_process_lib::logging::{info, init_logging, Level, error};
use hyperware_process_lib::{await_message, call_init, Address, Message};
use hyperware_process_lib::sqlite::Sqlite;
use structs::*;

use crate::helpers::handle_terminal_debug;
use crate::wallet::{service as wallet_service};


// TODO b4 beta: clean these endpoints up
fn init_http() -> anyhow::Result<HttpServer> {
    let mut http_server = HttpServer::new(5);
    let http_config_authenticated = HttpBindingConfig::default().authenticated(true);
    let http_config_unauthenticated = HttpBindingConfig::default()
        .authenticated(false)
        .local_only(false)
        .secure_subdomain(false);

    // REST API endpoints
    http_server.bind_http_path("/api/state", http_config_authenticated.clone())?;
    http_server.bind_http_path("/api/all", http_config_authenticated.clone())?;
    http_server.bind_http_path("/api/cat", http_config_authenticated.clone())?;
    http_server.bind_http_path("/api/search", http_config_authenticated.clone())?;
    http_server.bind_http_path("/api/setup-status", http_config_authenticated.clone())?;
    http_server.bind_http_path("/api/onboarding-status", http_config_authenticated.clone())?;
    http_server.bind_http_path("/api/verify-delegation-and-funding", http_config_authenticated.clone())?;

    // Graph endpoints
    http_server.bind_http_path("/api/hpn-graph", http_config_authenticated.clone())?;
    http_server.bind_http_path("/api/managed-wallets", http_config_authenticated.clone())?;
    
    // MCP endpoints
    http_server.bind_http_path("/api/mcp", http_config_authenticated.clone())?;
    http_server.bind_http_path("/api/save-shim-key", http_config_authenticated.clone())?;

    // MCP Shim endpoints (X-API-Key validation)
    http_server.bind_http_path("/shim/mcp", http_config_unauthenticated.clone())?;
    
    // UI
    add_to_homepage("HPN Dashboard", None, Some("/"), None);
    http_server.serve_ui("ui", vec!["/"], http_config_authenticated)?;

    Ok(http_server)
}

call_init!(init);
fn init(our: Address) {
    init_logging(Level::DEBUG, Level::INFO, None, None, None).unwrap();
    info!("begin hpn client for node: {}", our.node);

    let mut state = State::load();

    // Initialize Operator Identity using the new module
    if let Err(e) = identity::initialize_operator_identity(&our, &mut state) {
        // Log the error, but potentially continue initialization 
        // as some functions might work without full identity setup.
        error!("Failed during operator identity initialization: {:?}", e);
        // Ensure state is clean if init failed unexpectedly mid-way
        state.operator_entry_name = None;
        state.operator_tba_address = None;
        // We might not save here, let the error message be the indicator
    }

    // Initialize Wallet Manager
    wallet_service::initialize_wallet(&mut state);

    // Initialize DB as local variable
    info!("Loading database..");
    let db = match db::load_db(&our) {
        Ok(db_conn) => {
            info!("Database loaded successfully.");
            db_conn 
        }
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
    db: &Sqlite, // Pass db
    pending_logs: &mut PendingLogs // Pass pending_logs
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
    db: &Sqlite, // Pass db
    pending_logs: &mut PendingLogs // Renamed from _pending_logs to pending_logs
) -> anyhow::Result<()> {
    let process = source.process.to_string();
    let pkg = source.package_id().to_string();

    if pkg.as_str() == "terminal:sys" {
        handle_terminal_debug(our, &body, state, db)?;
    } else if process.as_str() == "http-server:distro:sys" {
        info!("HPNCLIENT: Received request from http-server");
        http_handlers::handle_frontend(our, &body, state, db)?;
    } else if process.as_str() == "eth:distro:sys" {
        info!("HPNCLIENT: Received Message::Request from eth:distro:sys, handling as ETH message...");
        chain::handle_eth_message(state, db, pending_logs, &body)?;
    } else {
        info!("Ignoring unexpected direct request from: {}", source);
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
        "timer:distro:sys" => {
            let is_checkpoint = context == Some(b"checkpoint".to_vec());
            chain::handle_timer(state, db, pending, is_checkpoint)?;
        }
        "eth:distro:sys" => {
            chain::handle_eth_message(state, db, pending, &body)?;
        }
        _ => {
            info!("Ignoring response from unexpected process: {}", source);
        },
    };
    Ok(())
}

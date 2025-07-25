pub mod graph;
mod structs;
mod http_handlers;
//mod wallet_manager;
mod db;
mod chain;
mod helpers;
mod identity;
mod authorized_services;
// Replace wallet module with hyperwallet_client
pub mod hyperwallet_client;

// Re-export hyperwallet_client as wallet for compatibility
pub use hyperwallet_client as wallet;

use hyperware_process_lib::homepage::add_to_homepage;
use hyperware_process_lib::http::server::{HttpBindingConfig, HttpServer};
use hyperware_process_lib::logging::{info, init_logging, Level, error};
use hyperware_process_lib::{await_message, call_init, Address, Message};
use hyperware_process_lib::sqlite::Sqlite;
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
    http_server.bind_http_path("/api/state", http_config_authenticated.clone())?;
    http_server.bind_http_path("/api/all", http_config_authenticated.clone())?;
    http_server.bind_http_path("/api/search", http_config_authenticated.clone())?;
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

    // Initialize hyperwallet connection
    if !hyperwallet_client::init_with_hyperwallet() {
        error!("Failed to initialize with hyperwallet service!");
        error!("The operator requires hyperwallet service to be running and accessible.");
        error!("Please ensure hyperwallet:hyperwallet:hallman.hypr is installed and running.");
    }
    info!("Successfully initialized with hyperwallet service");

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

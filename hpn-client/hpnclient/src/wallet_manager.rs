//use crate::structs::{
//    State, 
//    SpendingLimits, 
//    WalletSummary, 
//    PaymentAttemptResult, 
//    ManagedWallet, 
//    ActiveAccountDetails, 
//    DelegationStatus, 
//    TbaFundingDetails, 
//    ProviderRequest
//};
//use crate::helpers; 
//use crate::http_handlers::send_request_to_provider;
//
//use anyhow::Result;
//use hyperware_process_lib::logging::{info, error};
//use hyperware_process_lib::{eth, signer, wallet, hypermap};
//use hyperware_process_lib::Address as HyperwareAddress;
//use hyperware_process_lib::wallet::{get_eth_balance, get_token_details};
//use signer::{LocalSigner, Signer};
//use wallet::KeyStorage;
//use alloy_primitives::{Address, U256, B256, Bytes};
//use alloy_sol_types::SolValue;
//use std::str::FromStr;
//use hex;
//use std::thread;
//
//
//// --- Configuration Constants ---
//pub const BASE_CHAIN_ID: u64 = 8453; 
//pub const BASE_USDC_ADDRESS: &str = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
//pub const USDC_DECIMALS: u8 = 6; 
//
//// New Enum for Asset Type
//#[derive(Debug, Clone, Copy)]
//pub enum AssetType {
//    Eth,
//    Usdc,
//}
//
//// ===========================================================================================
//// ORPHANED FUNCTIONS - DO NOT USE
//// These functions have been moved to the wallet module and should not be called directly.
//// Update your code to use:
//// - crate::wallet::service for wallet management operations
//// - crate::wallet::payments for payment operations
//// ===========================================================================================
//
///// DEPRECATED: Use crate::wallet::service::generate_initial_wallet
//pub fn generate_initial_wallet() -> Result<ManagedWallet, String> {
//    panic!("wallet_manager::generate_initial_wallet is deprecated. Use crate::wallet::service::generate_initial_wallet instead")
//}
//
///// DEPRECATED: Use crate::wallet::service::initialize_wallet
//pub fn initialize_wallet(state: &mut State) {
//    panic!("wallet_manager::initialize_wallet is deprecated. Use crate::wallet::service::initialize_wallet instead")
//}
//
///// DEPRECATED: Use crate::wallet::payments::check_spending_limit
//pub fn check_spending_limit(state: &State, amount_to_spend_str: &str) -> Result<(), String> {
//    panic!("wallet_manager::check_spending_limit is deprecated. Use crate::wallet::payments::check_spending_limit instead")
//}
//
///// DEPRECATED: Use crate::wallet::service::set_wallet_spending_limits
//pub fn set_wallet_spending_limits(state: &mut State, wallet_id: String, limits: SpendingLimits) -> Result<(), String> {
//    panic!("wallet_manager::set_wallet_spending_limits is deprecated. Use crate::wallet::service::set_wallet_spending_limits instead")
//}
//
///// DEPRECATED: Use crate::wallet::service::export_private_key
//pub fn export_private_key(state: &State, wallet_id: String, password: Option<String>) -> Result<String, String> {
//    panic!("wallet_manager::export_private_key is deprecated. Use crate::wallet::service::export_private_key instead")
//}
//
///// DEPRECATED: Use crate::wallet::service::set_wallet_password
//pub fn set_wallet_password(
//    state: &mut State,
//    wallet_id: String,
//    new_password: String,
//    old_password: Option<String>,
//) -> Result<(), String> {
//    panic!("wallet_manager::set_wallet_password is deprecated. Use crate::wallet::service::set_wallet_password instead")
//}
//
///// DEPRECATED: Use crate::wallet::service::remove_wallet_password
//pub fn remove_wallet_password(state: &mut State, wallet_id: String, current_password: String) -> Result<(), String> {
//    panic!("wallet_manager::remove_wallet_password is deprecated. Use crate::wallet::service::remove_wallet_password instead")
//}
//
//// The perform_tba_payment_execution function has been moved to wallet/payments.rs
//
///// DEPRECATED: Use crate::wallet::payments::execute_payment_if_needed
//pub fn execute_payment_if_needed(
//    state: &mut State,
//    provider_wallet_str: &str, 
//    provider_price_str: &str,
//    provider_id: String,
//    associated_hot_wallet_id: &str
//) -> Option<PaymentAttemptResult> { 
//    panic!("wallet_manager::execute_payment_if_needed is deprecated. Use crate::wallet::payments::execute_payment_if_needed instead")
//}
//
///// DEPRECATED: Use crate::wallet::service::get_active_signer
//pub fn get_active_signer(state: &State) -> Result<&LocalSigner, anyhow::Error> {
//    panic!("wallet_manager::get_active_signer is deprecated. Use crate::wallet::service::get_active_signer instead")
//}
//
///// DEPRECATED: Use crate::wallet::service::import_new_wallet
//pub fn import_new_wallet(
//    state: &mut State,
//    pk_hex: String,
//    password: String,
//    name: Option<String>,
//) -> Result<String, String> {
//    panic!("wallet_manager::import_new_wallet is deprecated. Use crate::wallet::service::import_new_wallet instead")
//}
//
///// DEPRECATED: Use crate::wallet::service::activate_wallet
//pub fn activate_wallet(state: &mut State, wallet_id: String, password: Option<String>) -> Result<(), String> {
//    panic!("wallet_manager::activate_wallet is deprecated. Use crate::wallet::service::activate_wallet instead")
//}
//
///// DEPRECATED: Use crate::wallet::service::deactivate_wallet
//pub fn deactivate_wallet(state: &mut State, wallet_id: String) -> Result<(), String> {
//    panic!("wallet_manager::deactivate_wallet is deprecated. Use crate::wallet::service::deactivate_wallet instead")
//}
//
///// DEPRECATED: Use crate::wallet::service::get_wallet_summary_list
//pub fn get_wallet_summary_list(state: &State) -> (Option<String>, Vec<WalletSummary>) {
//    panic!("wallet_manager::get_wallet_summary_list is deprecated. Use crate::wallet::service::get_wallet_summary_list instead")
//}
//
///// DEPRECATED: Use crate::wallet::service::select_wallet
//pub fn select_wallet(state: &mut State, wallet_id: String) -> Result<(), String> {
//    panic!("wallet_manager::select_wallet is deprecated. Use crate::wallet::service::select_wallet instead")
//}
//
///// DEPRECATED: Use crate::wallet::service::delete_wallet
//pub fn delete_wallet(state: &mut State, wallet_id: String) -> Result<(), String> {
//    panic!("wallet_manager::delete_wallet is deprecated. Use crate::wallet::service::delete_wallet instead")
//}
//
///// DEPRECATED: Use crate::wallet::service::rename_wallet
//pub fn rename_wallet(state: &mut State, wallet_id: String, new_name: String) -> Result<(), String> {
//    panic!("wallet_manager::rename_wallet is deprecated. Use crate::wallet::service::rename_wallet instead")
//}
//
//// TODO: reduce calls to provider by caching balances in state
///// DEPRECATED: Use crate::wallet::service::get_active_account_details
//pub fn get_active_account_details(state: &State) -> Result<Option<ActiveAccountDetails>> {
//    panic!("wallet_manager::get_active_account_details is deprecated. Use crate::wallet::service::get_active_account_details instead")
//}
//
///// DEPRECATED: Use crate::wallet::service::verify_selected_hot_wallet_delegation_detailed
//pub fn verify_selected_hot_wallet_delegation_detailed(
//    state: &State, 
//    operator_entry_override: Option<&str> 
//) -> DelegationStatus { 
//    panic!("wallet_manager::verify_selected_hot_wallet_delegation_detailed is deprecated. Use crate::wallet::service::verify_selected_hot_wallet_delegation_detailed instead")
//}
//
///// DEPRECATED: Use crate::wallet::service::check_hot_wallet_status
//pub fn check_hot_wallet_status(state: &State) -> Result<WalletSummary, String> {
//    panic!("wallet_manager::check_hot_wallet_status is deprecated. Use crate::wallet::service::check_hot_wallet_status instead")
//}
//
///// DEPRECATED: Use crate::wallet::service::check_onchain_delegation_status
//pub fn check_onchain_delegation_status(state: &State) -> Result<(), String> {
//    panic!("wallet_manager::check_onchain_delegation_status is deprecated. Use crate::wallet::service::check_onchain_delegation_status instead")
//}
//
//// The PaymentPrerequisites struct has been moved to wallet/payments.rs
//
///// DEPRECATED: Use crate::wallet::service::get_decrypted_signer_for_wallet
//pub fn get_decrypted_signer_for_wallet(state: &State, wallet_id: &str) -> Result<LocalSigner, String> {
//    panic!("wallet_manager::get_decrypted_signer_for_wallet is deprecated. Use crate::wallet::service::get_decrypted_signer_for_wallet instead")
//}
//
//// The check_payment_prerequisites function has been moved to wallet/payments.rs
//
//// The check_provider_availability function has been moved to wallet/payments.rs
//
///// DEPRECATED: Use crate::wallet::payments::check_operator_tba_funding_detailed
//pub fn check_operator_tba_funding_detailed(
//    operator_tba_address_str: Option<&str>,
//    // Consider passing eth_provider: &eth::Provider if it's managed centrally
//) -> TbaFundingDetails {
//    panic!("wallet_manager::check_operator_tba_funding_detailed is deprecated. Use crate::wallet::payments::check_operator_tba_funding_detailed instead")
//} 
//
///// DEPRECATED: Use crate::wallet::service::get_wallet_summary_for_address
//pub fn get_wallet_summary_for_address(state: &State, hot_wallet_address_str: &str) -> WalletSummary {
//    panic!("wallet_manager::get_wallet_summary_for_address is deprecated. Use crate::wallet::service::get_wallet_summary_for_address instead")
//}
//
///// DEPRECATED: Use crate::wallet::service::get_all_onchain_linked_hot_wallet_addresses
//pub fn get_all_onchain_linked_hot_wallet_addresses(operator_entry_name_opt: Option<&str>) -> Result<Vec<String>, String> {
//    panic!("wallet_manager::get_all_onchain_linked_hot_wallet_addresses is deprecated. Use crate::wallet::service::get_all_onchain_linked_hot_wallet_addresses instead")
//}
//
///// DEPRECATED: Use crate::wallet::service::verify_single_hot_wallet_delegation_detailed
//pub fn verify_single_hot_wallet_delegation_detailed(
//    _state: &State, // state might be needed if we access managed wallet details, but not for pure on-chain check for now
//    operator_entry_name: Option<&str>,
//    hot_wallet_address_to_check_str: &str,
//    // Consider passing eth_provider: &eth::Provider if managed centrally
//) -> DelegationStatus {
//    panic!("wallet_manager::verify_single_hot_wallet_delegation_detailed is deprecated. Use crate::wallet::service::verify_single_hot_wallet_delegation_detailed instead")
//}
//
///// DEPRECATED: Use crate::wallet::payments::check_single_hot_wallet_funding_detailed
//pub fn check_single_hot_wallet_funding_detailed(
//    _state: &State, // Not directly used, but kept for consistency with other similar functions
//    hot_wallet_address_str: &str,
//    // Consider passing eth_provider: &eth::Provider if managed centrally
//) -> (bool, Option<String>, Option<String>) { // (needs_eth, eth_balance_str, check_error)
//    panic!("wallet_manager::check_single_hot_wallet_funding_detailed is deprecated. Use crate::wallet::payments::check_single_hot_wallet_funding_detailed instead")
//} 
//
///// DEPRECATED: Use crate::wallet::payments::handle_operator_tba_withdrawal
//pub fn handle_operator_tba_withdrawal(
//    state: &mut State, 
//    asset: AssetType,
//    to_address_str: String, 
//    amount_str: String
//) -> Result<(), String> {
//    panic!("wallet_manager::handle_operator_tba_withdrawal is deprecated. Use crate::wallet::payments::handle_operator_tba_withdrawal instead")
//}
//
//// The execute_eth_transfer_from_tba and execute_usdc_transfer_from_tba functions have been moved to wallet/payments.rs 
//! Payment-centric operations for hot wallets.
//!
//! The real logic is still implemented in `wallet_manager`; this module just
//! forwards calls so new code can depend on `crate::wallet::payments` instead
//! of the monolith.  Once everything is switched over we can migrate the
//! implementations here and delete the old ones.

use crate::structs::{State, PaymentAttemptResult, TbaFundingDetails};

pub use crate::wallet_manager::AssetType;

/// Delegates to `wallet_manager::execute_payment_if_needed`.
#[inline]
pub fn execute_payment_if_needed(
    state: &mut State,
    provider_wallet_str: &str,
    provider_price_str: &str,
    provider_id: String,
    associated_hot_wallet_id: &str,
) -> Option<PaymentAttemptResult> {
    crate::wallet_manager::execute_payment_if_needed(
        state,
        provider_wallet_str,
        provider_price_str,
        provider_id,
        associated_hot_wallet_id,
    )
}

/// Delegates to `wallet_manager::handle_operator_tba_withdrawal`.
#[inline]
pub fn handle_operator_tba_withdrawal(
    state: &mut State,
    asset: AssetType,
    to_address: String,
    amount: String,
) -> Result<(), String> {
    crate::wallet_manager::handle_operator_tba_withdrawal(state, asset, to_address, amount)
}

/// Delegates to `wallet_manager::check_operator_tba_funding_detailed`.
#[inline]
pub fn check_operator_tba_funding_detailed(
    operator_tba_address: Option<&str>,
) -> TbaFundingDetails {
    crate::wallet_manager::check_operator_tba_funding_detailed(operator_tba_address)
}

/// Delegates to `wallet_manager::check_single_hot_wallet_funding_detailed`.
#[inline]
pub fn check_single_hot_wallet_funding_detailed(
    state: &State,
    hot_wallet_addr: &str,
) -> (bool, Option<String>, Option<String>) {
    crate::wallet_manager::check_single_hot_wallet_funding_detailed(state, hot_wallet_addr)
} 
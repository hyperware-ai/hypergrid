use crate::structs::{State, CHAIN_ID, IdentityStatus};
use hyperware_process_lib::logging::{info, error, warn};
use hyperware_process_lib::{eth, hypermap, Address};
use hyperware_process_lib::eth::Provider;
use alloy_primitives::Address as EthAddress;
use anyhow::Result;
use std::str::FromStr;

use crate::chain; // To call get_implementation_address

/// Checks for the expected Hypergrid sub-entry (e.g., grid-beta-wallet.<node_name>.<tlz>)
/// and verifies it uses the correct HyperAccountAccessControlMinter implementation.
/// Updates the state with the verified entry name and TBA address if found and correct,
/// otherwise logs errors and ensures the relevant state fields are None.
/// DEPRECATED? Consider using check_operator_identity_detailed for status checks.
pub fn initialize_operator_identity(our: &Address, state: &mut State) -> Result<()> {
    info!("Initializing Hypergrid Operator Identity for node: {} (Note: initialize_operator_identity might be deprecated for status checks)", our.node);

    let identity_status = check_operator_identity_detailed(our);
    let mut needs_save = false;

    match identity_status {
        IdentityStatus::Verified { entry_name, tba_address, .. } => {
             info!("Identity verified via detailed check: Name={}, TBA={}", entry_name, tba_address);
            // Update state if necessary
            if state.operator_entry_name.as_deref() != Some(&entry_name) || 
               state.operator_tba_address.as_deref() != Some(&tba_address) {
                                
                state.operator_entry_name = Some(entry_name.clone());
                state.operator_tba_address = Some(tba_address.clone());
                info!("Set operator identity in state.");
                                needs_save = true;
                            }
        }
        _ => { // Handles NotFound, IncorrectImplementation, CheckError etc.
            let expected_sub_entry_name = format!("grid-beta-wallet.{}", our.node);
            let expected_implementation_str = "0x000000000046886061414588bb9F63b6C53D8674";

            // Only clear state if identity is definitively not found or incorrect.
            // Do NOT clear on temporary check errors.
            match identity_status {
                IdentityStatus::NotFound | IdentityStatus::IncorrectImplementation { .. } => {
                    error!("---------------------------------------------------------------------");
                    error!("Hypergrid operational sub-entry not found or incorrectly configured!");
                    error!("Status from detailed check: {:?}", identity_status);
                    error!("Expected sub-entry: {}", expected_sub_entry_name);
                    error!("Expected implementation: {}", expected_implementation_str);
                    error!("Please ensure this sub-entry exists and uses the correct implementation.");
                    error!("Payments and other Hypergrid operations requiring TBA interaction will fail.");
                    error!("---------------------------------------------------------------------");
                    
                    if state.operator_entry_name.is_some() || state.operator_tba_address.is_some() {
                        info!("Clearing invalid operator identity state due to configuration error.");
                        state.operator_entry_name = None;
                        state.operator_tba_address = None;
                        needs_save = true;
                    }
                }
                IdentityStatus::CheckError(ref e) | IdentityStatus::ImplementationCheckFailed(ref e) => {
                    // It's just a temporary check error. Log it but do NOT clear valid state.
                    warn!("Could not verify operator identity due to a temporary check error: {}. Existing valid configuration will be preserved.", e);
                }
                _ => {} // Should not happen due to outer match, but good to be exhaustive.
            }
         }
    }

    if needs_save {
        info!("Saving updated state after identity check.");
        state.save();
    }

    Ok(())
}

/// Checks the operator identity status without modifying state.
/// Returns a detailed IdentityStatus enum.
pub fn check_operator_identity_detailed(our: &Address) -> IdentityStatus {
    info!("Checking detailed Hypergrid Operator Identity status for node: {}", our.node);

    let base_node_name = our.node.clone();
    let expected_sub_entry_name = format!("grid-beta-wallet.{}", base_node_name);
    let expected_implementation_str = "0x000000000046886061414588bb9F63b6C53D8674"; 
    let expected_impl_addr = match EthAddress::from_str(expected_implementation_str) {
        Ok(addr) => addr,
        Err(e) => return IdentityStatus::CheckError(format!("Invalid expected_implementation_str: {}", e)),
    };
    
    let provider = eth::Provider::new(CHAIN_ID, 30000); // 30s timeout
    let hypermap_addr = match EthAddress::from_str(hypermap::HYPERMAP_ADDRESS) {
         Ok(addr) => addr,
         Err(e) => return IdentityStatus::CheckError(format!("Invalid HYPERMAP_ADDRESS: {}", e)),
    };
    let hypermap_reader = hypermap::Hypermap::new(provider.clone(), hypermap_addr);

    // 1. Check if sub-entry exists
    match hypermap_reader.get(&expected_sub_entry_name) {
        Ok((tba, owner, _data)) => {
            if tba == EthAddress::ZERO {
                info!(
                    "Hypergrid sub-entry '{}' lookup returned zero address TBA, interpreting as NOT FOUND.",
                    expected_sub_entry_name
                );
                return IdentityStatus::NotFound;
            }
            
            let tba_str = tba.to_string();
            let owner_str = owner.to_string();
            info!("Found sub-entry '{}', TBA: {}, Owner: {}. Checking implementation...", expected_sub_entry_name, tba_str, owner_str);
            
            // 2. Check implementation address
            match chain::get_implementation_address(&provider, tba) {
                Ok(implementation_address) => {
                    let impl_str = implementation_address.to_string();
                    if implementation_address == expected_impl_addr {
                        info!("Sub-entry '{}' uses the correct implementation ({})", expected_sub_entry_name, impl_str);
                        IdentityStatus::Verified { 
                            entry_name: expected_sub_entry_name,
                            tba_address: tba_str,
                            owner_address: owner_str,
                        }
                    } else {
                        error!("Sub-entry '{}' exists but uses WRONG implementation: {} (Expected: {})", 
                            expected_sub_entry_name, impl_str, expected_implementation_str);
                        IdentityStatus::IncorrectImplementation { 
                            found: impl_str, 
                            expected: expected_implementation_str.to_string() 
                        }
                    }
                }
                Err(e) => {
                    let err_msg = format!("Failed to get implementation address for '{}' (TBA: {}): {:?}", expected_sub_entry_name, tba_str, e);
                    error!("{}", err_msg);
                    IdentityStatus::ImplementationCheckFailed(err_msg)
                }
            }
        }
        Err(e) => { // Handle hypermap.get errors
            let err_msg = format!("{:?}", e);
             error!("Error during '{}' lookup via hypermap.get: {}", expected_sub_entry_name, err_msg);
             // Attempt to differentiate between "not found" and other errors
             // TODO: Use better error types from hypermap lib if available
            if err_msg.contains("note not found") || err_msg.contains("entry not found") { // Simple check
                IdentityStatus::NotFound
            } else {
                IdentityStatus::CheckError(format!("RPC/Read Error for '{}': {}", expected_sub_entry_name, err_msg))
            }
        }
    }
} 
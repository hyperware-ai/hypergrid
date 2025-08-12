use crate::structs::{State, CHAIN_ID, IdentityStatus};
use hyperware_process_lib::logging::{info, error, warn};
use hyperware_process_lib::{eth, hypermap, Address};
use hyperware_process_lib::eth::Provider;
use alloy_primitives::Address as EthAddress;
use anyhow::Result;
use std::str::FromStr;

use crate::chain; // To call get_implementation_address

// TBA Implementation addresses
const OLD_TBA_IMPLEMENTATION: &str = "0x000000000046886061414588bb9F63b6C53D8674"; // Works but no gasless
//const NEW_TBA_IMPLEMENTATION: &str = "0x19b89306e31D07426E886E3370E62555A0743D96"; // Supports ERC-4337 gasless (was faulty, no delegation)
const NEW_TBA_IMPLEMENTATION: &str = "0x3950D18044D7DAA56BFd6740fE05B42C95201535"; // Supports ERC-4337 gasless (fixed)

/// Checks for the expected Hypergrid sub-entry (e.g., grid-wallet.<node_name>.<tlz>)
/// and verifies it uses a supported HyperAccountAccessControlMinter implementation.
/// Updates the state with the verified entry name and TBA address if found and correct.
/// Also sets gasless_enabled based on the implementation version.
pub fn initialize_operator_identity(our: &Address, state: &mut State) -> Result<()> {
    info!("Initializing Hypergrid Operator Identity for node: {}", our.node);

    let identity_status = check_operator_identity_detailed(our);
    let mut needs_save = false;

    match identity_status {
        IdentityStatus::Verified { entry_name, tba_address, .. } => {
            info!("Identity verified: Name={}, TBA={}", entry_name, tba_address);
            
            // Update state if necessary
            if state.operator_entry_name.as_deref() != Some(&entry_name) || 
               state.operator_tba_address.as_deref() != Some(&tba_address) {
                state.operator_entry_name = Some(entry_name.clone());
                state.operator_tba_address = Some(tba_address.clone());
                info!("Set operator identity in state.");
                needs_save = true;
            }
            
            // Check implementation to determine gasless support
            let provider = eth::Provider::new(CHAIN_ID, 30000);
            if let Ok(tba_eth_addr) = EthAddress::from_str(&tba_address) {
                match chain::get_implementation_address(&provider, tba_eth_addr) {
                    Ok(impl_addr) => {
                        let impl_str = impl_addr.to_string().to_lowercase();
                        let new_gasless_enabled = impl_str == NEW_TBA_IMPLEMENTATION.to_lowercase();
                        
                        if state.gasless_enabled != Some(new_gasless_enabled) {
                            state.gasless_enabled = Some(new_gasless_enabled);
                            if new_gasless_enabled {
                                info!("✅ ERC-4337 gasless transactions ENABLED - TBA uses new implementation");
                            } else {
                                info!("⚠️  Gasless transactions DISABLED - TBA uses old implementation (ETH required for gas)");
                            }
                            needs_save = true;
                        }
                    }
                    Err(e) => {
                        warn!("Could not check implementation for gasless support: {}", e);
                    }
                }
            }
        }
        IdentityStatus::NotFound => {
            let expected_sub_entry_name = format!("grid-wallet.{}", our.node);
            error!("---------------------------------------------------------------------");
            error!("Hypergrid operational sub-entry not found!");
            error!("Expected sub-entry: {}", expected_sub_entry_name);
            error!("Please ensure this sub-entry exists with a supported implementation:");
            error!("  - {} (old - works but no gasless)", OLD_TBA_IMPLEMENTATION);
            error!("  - {} (new - supports gasless)", NEW_TBA_IMPLEMENTATION);
            error!("Payments and other Hypergrid operations will fail.");
            error!("---------------------------------------------------------------------");
            
            if state.operator_entry_name.is_some() || state.operator_tba_address.is_some() || state.gasless_enabled.is_some() {
                info!("Clearing operator identity state due to missing entry.");
                state.operator_entry_name = None;
                state.operator_tba_address = None;
                state.gasless_enabled = None;
                needs_save = true;
            }
        }
        IdentityStatus::IncorrectImplementation { found, expected } => {
            // This now means UNSUPPORTED implementation (not old or new)
            let expected_sub_entry_name = format!("grid-wallet.{}", our.node);
            error!("---------------------------------------------------------------------");
            error!("Hypergrid operational sub-entry uses UNSUPPORTED implementation!");
            error!("Sub-entry: {}", expected_sub_entry_name);
            error!("Found implementation: {}", found);
            error!("Supported implementations:");
            error!("  - {} (old)", OLD_TBA_IMPLEMENTATION);
            error!("  - {} (new)", NEW_TBA_IMPLEMENTATION);
            error!("The operator cannot work with this implementation.");
            error!("---------------------------------------------------------------------");
            
            if state.operator_entry_name.is_some() || state.operator_tba_address.is_some() || state.gasless_enabled.is_some() {
                info!("Clearing operator identity state due to unsupported implementation.");
                state.operator_entry_name = None;
                state.operator_tba_address = None;
                state.gasless_enabled = None;
                needs_save = true;
            }
        }
        IdentityStatus::CheckError(ref e) | IdentityStatus::ImplementationCheckFailed(ref e) => {
            // Temporary check error. Log it but do NOT clear valid state.
            warn!("Could not verify operator identity due to a temporary check error: {}. Existing configuration will be preserved.", e);
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
/// Now supports both old and new implementations.
pub fn check_operator_identity_detailed(our: &Address) -> IdentityStatus {
    info!("Checking detailed Hypergrid Operator Identity status for node: {}", our.node);

    let base_node_name = our.node.clone();
    let expected_sub_entry_name = format!("grid-wallet.{}", base_node_name);
    
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
                    let impl_str_lower = impl_str.to_lowercase();
                    
                    // Check if it's one of our supported implementations
                    if impl_str_lower == OLD_TBA_IMPLEMENTATION.to_lowercase() {
                        info!("Sub-entry '{}' uses OLD implementation ({}) - works but no gasless support", 
                            expected_sub_entry_name, impl_str);
                        IdentityStatus::Verified { 
                            entry_name: expected_sub_entry_name,
                            tba_address: tba_str,
                            owner_address: owner_str,
                        }
                    } else if impl_str_lower == NEW_TBA_IMPLEMENTATION.to_lowercase() {
                        info!("Sub-entry '{}' uses NEW implementation ({}) - gasless transactions supported!", 
                            expected_sub_entry_name, impl_str);
                        IdentityStatus::Verified { 
                            entry_name: expected_sub_entry_name,
                            tba_address: tba_str,
                            owner_address: owner_str,
                        }
                    } else {
                        error!("Sub-entry '{}' exists but uses UNSUPPORTED implementation: {}", 
                            expected_sub_entry_name, impl_str);
                        error!("Supported implementations:");
                        error!("  - {} (old)", OLD_TBA_IMPLEMENTATION);
                        error!("  - {} (new)", NEW_TBA_IMPLEMENTATION);
                        IdentityStatus::IncorrectImplementation { 
                            found: impl_str, 
                            expected: format!("{} or {}", OLD_TBA_IMPLEMENTATION, NEW_TBA_IMPLEMENTATION)
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
            if err_msg.contains("note not found") || err_msg.contains("entry not found") {
                IdentityStatus::NotFound
            } else {
                IdentityStatus::CheckError(format!("RPC/Read Error for '{}': {}", expected_sub_entry_name, err_msg))
            }
        }
    }
} 
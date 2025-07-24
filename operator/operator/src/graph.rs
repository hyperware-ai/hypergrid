use serde_json::json;
use hyperware_process_lib::{
    Address,
    http::StatusCode,
    logging::{info, warn, error},
    sqlite::Sqlite,
    eth, hypermap,
    wallet,
};
use alloy_primitives::Address as EthAddress;
use std::str::FromStr;

use crate::helpers::send_json_response;
use crate::structs::{
    State,
    HypergridGraphResponse,
    GraphNode,
    GraphEdge,
    GraphNodeData,
    //NodePosition, // Assuming frontend will handle layout initially
    OperatorWalletFundingInfo,
    HotWalletFundingInfo,
    NoteInfo,
    //WalletSummary, // For getting hot wallet names if managed
    IdentityStatus, DelegationStatus, 
    MintOperatorWalletActionNodeData,
};
use crate::wallet::service::{
    get_wallet_summary_for_address,
    get_all_onchain_linked_hot_wallet_addresses,
    //verify_single_hot_wallet_delegation_detailed,
};
use crate::wallet::payments::{
    check_operator_tba_funding_detailed,
    check_single_hot_wallet_funding_detailed,
};
use crate::identity; // For operator identity details

// Local helper function to truncate addresses for display
fn truncate_address(address_str: &str) -> String {
    if address_str.len() > 10 { // Basic truncation logic (e.g., 0x123...789)
        format!("{}...{}", &address_str[0..5], &address_str[address_str.len()-3..])
    } else {
        address_str.to_string()
    }
}

// New public function to build graph data
pub fn build_hypergrid_graph_data(
    our: &Address,
    state: &State,
) -> anyhow::Result<HypergridGraphResponse> {
    info!("Building Hypergrid graph data for node {}...", our.node);

    let mut nodes: Vec<GraphNode> = Vec::new();
    let mut edges: Vec<GraphEdge> = Vec::new();

    let owner_node_id = "owner-node".to_string();
    let mut owner_node_tba_address: Option<String> = None;
    let mut owner_node_actual_owner_eoa: Option<String> = None;

    // --- Populate OwnerNode (e.g., "pertinent.os") details ---
    info!("Graph Build: Attempting to fetch details for owner node: {}", our.node());
    let provider = eth::Provider::new(crate::structs::CHAIN_ID, 30000); // Use CHAIN_ID from structs
    match EthAddress::from_str(hypermap::HYPERMAP_ADDRESS) {
        Ok(hypermap_contract_address) => {
            if hypermap_contract_address != EthAddress::ZERO {
                let hypermap_reader = hypermap::Hypermap::new(provider.clone(), hypermap_contract_address);
                match hypermap_reader.get(our.node()) {
                    Ok((tba, owner_eoa, _data)) => {
                        if tba != EthAddress::ZERO {
                            owner_node_tba_address = Some(tba.to_string());
                            owner_node_actual_owner_eoa = Some(owner_eoa.to_string());
                            info!(
                                "Graph Build: Successfully fetched details for owner node '{}'. TBA: {}, Owner EOA: {}",
                                our.node(),
                                tba.to_string(),
                                owner_eoa.to_string()
                            );
                        } else {
                            info!(
                                "Graph Build: Owner node '{}' lookup returned zero address TBA (effectively not a registered TBA).",
                                our.node()
                            );
                        }
                    }
                    Err(e) => {
                        error!(
                            "Graph Build: Error fetching details for owner node '{}' from Hypermap: {:?}. This node might not be registered or accessible.",
                            our.node(),
                            e
                        );
                    }
                }
            } else {
                error!("Graph Build: HYPERMAP_ADDRESS is zero, cannot query owner node details.");
            }
        }
        Err(e) => {
            error!("Graph Build: Invalid HYPERMAP_ADDRESS string ('{}'): {}. Cannot query owner node details.", hypermap::HYPERMAP_ADDRESS, e);
            // This would be a critical configuration error.
        }
    }

    nodes.push(GraphNode {
        id: owner_node_id.clone(),
        node_type: "ownerNode".to_string(),
        data: GraphNodeData::OwnerNode {
            name: our.node().to_string(),
            tba_address: owner_node_tba_address, // Use fetched TBA address
            owner_address: owner_node_actual_owner_eoa, // Use fetched owner EOA
        },
        position: None,
    });

    let operator_identity_details = identity::check_operator_identity_detailed(our); 
    let mut operator_wallet_node_id: Option<String> = None;
    let fresh_operator_entry_name: Option<String> = match &operator_identity_details {
        IdentityStatus::Verified { entry_name, .. } => Some(entry_name.clone()),
        _ => None,
    };



    if let IdentityStatus::Verified { entry_name, tba_address, .. } = &operator_identity_details {
        let current_op_wallet_node_id = format!("operator-wallet-{}", tba_address);
        operator_wallet_node_id = Some(current_op_wallet_node_id.clone());

        info!("Graph: Checking funding for operator TBA: {}", tba_address);
        let funding_details = check_operator_tba_funding_detailed(Some(tba_address));
        info!("Graph: Funding details received: eth_balance={:?}, usdc_balance={:?}, needs_eth={}, needs_usdc={}", 
            funding_details.tba_eth_balance_str, 
            funding_details.tba_usdc_balance_str,
            funding_details.tba_needs_eth,
            funding_details.tba_needs_usdc
        );
        
        let op_wallet_funding_info = OperatorWalletFundingInfo {
            eth_balance_str: funding_details.tba_eth_balance_str,
            usdc_balance_str: funding_details.tba_usdc_balance_str,
            needs_eth: funding_details.tba_needs_eth,
            needs_usdc: funding_details.tba_needs_usdc,
            error_message: funding_details.check_error,
        };
        
        let mut access_list_note_status_text = "Access List Note: Unknown".to_string();
        let mut access_list_note_is_set = false;
        let mut signers_note_status_text = "Signers Note: Unknown".to_string();
        let mut signers_note_is_set = false;

        // First check if we have linked hot wallets on-chain
        let linked_wallets = get_all_onchain_linked_hot_wallet_addresses(Some(entry_name));
        
        if let Ok(linked_hw_addresses) = &linked_wallets {
            if !linked_hw_addresses.is_empty() {
                // We have linked wallets, so both notes should be set
                access_list_note_status_text = "Access List Note: Set".to_string();
                access_list_note_is_set = true;
                
                // Check if we have a selected wallet to show specific verification status
                if let Some(selected_hw_id) = &state.selected_wallet_id {
                    if let Some(selected_hw) = state.managed_wallets.get(selected_hw_id) {
                        let hw_address_str = &selected_hw.id.to_string();
                        match crate::wallet::service::verify_single_hot_wallet_delegation_detailed(state, Some(entry_name), hw_address_str) {
                            DelegationStatus::Verified => {
                                signers_note_status_text = format!("Signers Note: Set (Verified for {})", truncate_address(hw_address_str));
                                signers_note_is_set = true;
                            }
                            DelegationStatus::HotWalletNotInList => {
                                signers_note_status_text = "Signers Note: Set (Selected Hot Wallet Not Listed)".to_string();
                                signers_note_is_set = true;
                            }
                            _ => {
                                // For other statuses, just indicate it's set since we have linked wallets
                                signers_note_status_text = format!("Signers Note: Set ({} linked wallets)", linked_hw_addresses.len());
                                signers_note_is_set = true;
                            }
                        }
                    } else {
                        // Selected wallet not found, but we have linked wallets
                        signers_note_status_text = format!("Signers Note: Set ({} linked wallets)", linked_hw_addresses.len());
                        signers_note_is_set = true;
                    }
                } else {
                    // No selected wallet, but we have linked wallets
                    signers_note_status_text = format!("Signers Note: Set ({} linked wallets)", linked_hw_addresses.len());
                    signers_note_is_set = true;
                }
            } else {
                // No linked wallets, check access list note independently
                if !entry_name.is_empty() {
                    let provider = eth::Provider::new(crate::structs::CHAIN_ID, 30000);
                    if let Ok(hypermap_contract_address) = EthAddress::from_str(hypermap::HYPERMAP_ADDRESS) {
                        if hypermap_contract_address != EthAddress::ZERO {
                            let hypermap_reader = hypermap::Hypermap::new(provider.clone(), hypermap_contract_address);
                            let access_list_full_path = format!("~access-list.{}", entry_name);
                            match hypermap_reader.get(&access_list_full_path) {
                                Ok((_tba, _owner, Some(data))) => {
                                    if data.len() == 32 {
                                        access_list_note_status_text = "Access List Note: Set".to_string();
                                        access_list_note_is_set = true;
                                        signers_note_status_text = "Signers Note: Not Set (No Linked Wallets)".to_string();
                                        signers_note_is_set = false;
                                    } else {
                                        access_list_note_status_text = format!("Access List Note: Invalid Data (Expected 32 bytes, got {})", data.len());
                                        access_list_note_is_set = false;
                                    }
                                }
                                Ok((_tba, _owner, None)) => {
                                    access_list_note_status_text = "Access List Note: Not Set".to_string();
                                    access_list_note_is_set = false;
                                }
                                Err(e) => {
                                    if format!("{:?}", e).contains("note not found") {
                                        access_list_note_status_text = "Access List Note: Not Set".to_string();
                                    } else {
                                        access_list_note_status_text = format!("Access List Note: Error Reading ({:?})", e);
                                    }
                                    access_list_note_is_set = false;
                                }
                            }
                        }
                    }
                }
                signers_note_status_text = "Signers Note: Not Set (No Linked Wallets)".to_string();
                signers_note_is_set = false;
            }
        } else {
            // Error getting linked wallets, fall back to checking selected wallet
            if let Some(selected_hw_id) = &state.selected_wallet_id {
                // selected_hw_id exists, but wallet not found in managed_wallets (should be rare if state is consistent)
                access_list_note_status_text = "Access List Note: Status Unknown (Selected Wallet Not Found)".to_string();
                signers_note_status_text = "Signers Note: Status Unknown (Selected Wallet Not Found)".to_string();
            } else {
                // No hot wallet selected in state. We can't run verify_single_hot_wallet_delegation_detailed.
                // To get the Access List Note status independently, we'd need a different check.
                // For now, reflect that we can't determine status without a selected hot wallet for context.
                // A more robust check would be to read the access list note directly if operator_entry_name is known.
                // This can be a future improvement.
                 if !entry_name.is_empty() {
                     // Attempt to check access list note directly if operator entry name is known
                     // This requires a direct hypermap read, not relying on delegation check which needs a hot wallet
                     let provider = eth::Provider::new(crate::structs::CHAIN_ID, 30000);
                     if let Ok(hypermap_contract_address) = EthAddress::from_str(hypermap::HYPERMAP_ADDRESS) {
                         if hypermap_contract_address != EthAddress::ZERO {
                             let hypermap_reader = hypermap::Hypermap::new(provider.clone(), hypermap_contract_address);
                             let access_list_full_path = format!("~access-list.{}", entry_name);
                             match hypermap_reader.get(&access_list_full_path) {
                                 Ok((_tba, _owner, Some(data))) => {
                                     if data.len() == 32 {
                                         access_list_note_status_text = "Access List Note: Set".to_string();
                                         access_list_note_is_set = true;
                                         signers_note_status_text = "Signers Note: Status Unknown (No Hot Wallet Selected for Full Check)".to_string();
                                     } else {
                                         access_list_note_status_text = format!("Access List Note: Invalid Data (Expected 32 bytes, got {})", data.len());
                                         access_list_note_is_set = false;
                                     }
                                 }
                                 Ok((_tba, _owner, None)) => {
                                     access_list_note_status_text = "Access List Note: Set (No Data)".to_string(); // Or "Not Set" if no data means not set.
                                     access_list_note_is_set = false; // Assuming no data means effectively not set for its purpose.
                                 }
                                 Err(e) => {
                                     if format!("{:?}", e).contains("note not found") {
                                         access_list_note_status_text = "Access List Note: Not Set".to_string();
                                     } else {
                                         access_list_note_status_text = format!("Access List Note: Error Reading ({:?})", e);
                                     }
                                     access_list_note_is_set = false;
                                 }
                             }
                         } else {
                            access_list_note_status_text = "Access List Note: Error (Hypermap Address Zero)".to_string();
                         }
                     } else {
                        access_list_note_status_text = "Access List Note: Error (Invalid Hypermap Address)".to_string();
                     }
                 } else {
                    access_list_note_status_text = "Access List Note: Unknown (No Operator ID)".to_string();
                 }
                signers_note_status_text = "Signers Note: Unknown (No Hot Wallet Selected)".to_string(); // Signers note can't be checked without access list context and potentially a specific hot wallet
            }
        }

        let signers_note_info = NoteInfo {
            status_text: signers_note_status_text,
            details: None, 
            is_set: signers_note_is_set,
            action_needed: !signers_note_is_set,
            action_id: Some("trigger_set_signers_note".to_string()), 
        };
        let access_list_note_info = NoteInfo {
            status_text: access_list_note_status_text,
            details: None, 
            is_set: access_list_note_is_set,
            action_needed: !access_list_note_is_set,
            action_id: Some("trigger_set_access_list_note".to_string()),
        };

        // Check if paymaster has been approved (only if gasless is enabled)
        let paymaster_approved = if state.gasless_enabled.unwrap_or(false) {
            let provider = eth::Provider::new(crate::structs::CHAIN_ID, 30000);
            let usdc_addr = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // Base USDC
            let paymaster = "0x0578cFB241215b77442a541325d6A4E6dFE700Ec"; // Circle paymaster
            
            match wallet::erc20_allowance(usdc_addr, &tba_address, paymaster, &provider) {
                Ok(allowance) => allowance > alloy_primitives::U256::ZERO,
                Err(_) => false,
            }
        } else {
            false
        };

        nodes.push(GraphNode {
            id: current_op_wallet_node_id.clone(),
            node_type: "operatorWalletNode".to_string(),
            data: GraphNodeData::OperatorWalletNode {
                name: entry_name.clone(),
                tba_address: tba_address.clone(),
                funding_status: op_wallet_funding_info,
                signers_note: signers_note_info,
                access_list_note: access_list_note_info,
                gasless_enabled: state.gasless_enabled.unwrap_or(false),
                paymaster_approved,
            },
            position: None,
        });
        edges.push(GraphEdge {
            id: format!("edge-{}-{}", owner_node_id, current_op_wallet_node_id),
            source: owner_node_id.clone(),
            target: current_op_wallet_node_id.clone(),
            style_type: None, animated: None,
        });

        // Determine if there are any linked hot wallets to provide better labeling
        let has_linked_wallets = match get_all_onchain_linked_hot_wallet_addresses(Some(entry_name)) {
            Ok(linked_hw_addresses) => !linked_hw_addresses.is_empty(),
            Err(_) => false,
        };
        
        let action_label = if has_linked_wallets {
            "Manage Hot Wallets".to_string()
        } else {
            "Create Your First Wallet!".to_string()
        };

        nodes.push(GraphNode {
            id: "action-add-hot-wallet".to_string(),
            node_type: "addHotWalletActionNode".to_string(),
            data: GraphNodeData::AddHotWalletActionNode {
                label: action_label,
                operator_tba_address: Some(tba_address.clone()),
                action_id: "trigger_manage_wallets_modal".to_string(),
            },
            position: None,
        });
        edges.push(GraphEdge {
            id: format!("edge-{}-action-add-hot-wallet", current_op_wallet_node_id),
            source: current_op_wallet_node_id.clone(),
            target: "action-add-hot-wallet".to_string(),
            style_type: None,
            animated: Some(true),
        });
    } else {
        // Operator Identity is not verified, so add the mint action node
        let mint_action_node_id = "action-mint-operator-wallet".to_string();
        nodes.push(GraphNode {
            id: mint_action_node_id.clone(),
            node_type: "mintOperatorWalletActionNode".to_string(), // New node type
            data: GraphNodeData::MintOperatorWalletActionNode(
                MintOperatorWalletActionNodeData {
                    label: "Create Operator Wallet".to_string(),
                    owner_node_name: our.node().to_string(),
                    action_id: "trigger_mint_operator_wallet".to_string(),
                }
            ),
            position: None,
        });
        edges.push(GraphEdge {
            id: format!("edge-{}-{}", owner_node_id, mint_action_node_id),
            source: owner_node_id.clone(),
            target: mint_action_node_id.clone(),
            style_type: None,
            animated: Some(true),
        });
    }

    // Only add Hot Wallet and Client nodes if Operator Wallet exists
    if operator_wallet_node_id.is_some() {
        match get_all_onchain_linked_hot_wallet_addresses(fresh_operator_entry_name.as_deref()) {
            Ok(linked_hw_addresses) => {
                for hw_address_str in linked_hw_addresses {
                    let hot_wallet_node_id = format!("hot-wallet-{}", hw_address_str);
                    let summary_opt = get_wallet_summary_for_address(state, &hw_address_str);
                    let (needs_eth, eth_balance, funding_err) = check_single_hot_wallet_funding_detailed(state, &hw_address_str);
                    
                    let hw_funding_info = HotWalletFundingInfo {
                        eth_balance_str: eth_balance,
                        needs_eth,
                        error_message: funding_err,
                    };

                    // Handle the case where we might not have a summary
                    if let Some(ref summary) = summary_opt {
                        let is_active_mcp = state.selected_wallet_id.as_ref() == Some(&summary.id) && state.active_signer_cache.is_some();
                        let status_desc = if is_active_mcp {
                            // If it's active in MCP, its status description should reflect unlocked state too
                            if summary.is_unlocked {
                                "Active in MCP (Unlocked)".to_string()
                            } else {
                                "Active in MCP (Locked)".to_string()
                            }
                        } else if state.managed_wallets.contains_key(&summary.id) {
                            "Managed & Linked".to_string()
                        } else {
                            "Linked (External)".to_string()
                        };

                        let mut client_ids_for_this_hw: Vec<String> = Vec::new();
                        for client in state.authorized_clients.values() {
                            if client.associated_hot_wallet_address == hw_address_str {
                                client_ids_for_this_hw.push(client.id.clone());
                            }
                        }

                        // Get spending limits from hyperwallet (works for both managed and external wallets)
                        let spending_limits = crate::hyperwallet_client::service::get_wallet_spending_limits(hw_address_str.clone())
                            .unwrap_or_else(|e| {
                                info!("Could not fetch spending limits for {}: {}", hw_address_str, e);
                                None
                            });

                        nodes.push(GraphNode {
                            id: hot_wallet_node_id.clone(),
                            node_type: "hotWalletNode".to_string(),
                            data: GraphNodeData::HotWalletNode {
                                address: hw_address_str.clone(),
                                name: summary.name.clone(),
                                status_description: status_desc,
                                is_active_in_mcp: is_active_mcp, // This might be redundant if statusDescription covers it
                                is_encrypted: summary.is_encrypted, // ADDED
                                is_unlocked: summary.is_unlocked,   // ADDED
                                funding_info: hw_funding_info,
                                authorized_clients: client_ids_for_this_hw.clone(),
                                limits: spending_limits, // ADDED
                            },
                            position: None,
                        });
                    } else {
                        // No summary found - create a minimal node for external wallet
                        // Still try to get spending limits from hyperwallet
                        let spending_limits = crate::hyperwallet_client::service::get_wallet_spending_limits(hw_address_str.clone())
                            .unwrap_or_else(|e| {
                                info!("Could not fetch spending limits for external wallet {}: {}", hw_address_str, e);
                                None
                            });
                        
                        nodes.push(GraphNode {
                            id: hot_wallet_node_id.clone(),
                            node_type: "hotWalletNode".to_string(),
                            data: GraphNodeData::HotWalletNode {
                                address: hw_address_str.clone(),
                                name: None,
                                status_description: "Linked (External)".to_string(),
                                is_active_in_mcp: false,
                                is_encrypted: false,
                                is_unlocked: false,
                                funding_info: hw_funding_info,
                                authorized_clients: Vec::new(),
                                limits: spending_limits,
                            },
                            position: None,
                        });
                    }

                    if let Some(op_w_id) = &operator_wallet_node_id { 
                        edges.push(GraphEdge {
                            id: format!("edge-{}-{}", op_w_id, hot_wallet_node_id),
                            source: op_w_id.clone(),
                            target: hot_wallet_node_id.clone(),
                            style_type: None, animated: None,
                        });
                    }

                    // Add client nodes - only if we have a summary (managed wallet)
                    if summary_opt.is_some() {
                        let mut client_ids_for_this_hw: Vec<String> = Vec::new();
                        for client in state.authorized_clients.values() {
                            if client.associated_hot_wallet_address == hw_address_str {
                                client_ids_for_this_hw.push(client.id.clone());
                            }
                        }

                        for client_id in client_ids_for_this_hw {
                            if let Some(client_config) = state.authorized_clients.get(&client_id) {
                                let client_node_id = format!("auth-client-{}", client_id);
                                nodes.push(GraphNode {
                                    id: client_node_id.clone(),
                                    node_type: "authorizedClientNode".to_string(),
                                    data: GraphNodeData::AuthorizedClientNode {
                                        client_id: client_config.id.clone(),
                                        client_name: client_config.name.clone(),
                                        associated_hot_wallet_address: client_config.associated_hot_wallet_address.clone(),
                                    },
                                    position: None,
                                });
                                edges.push(GraphEdge {
                                    id: format!("edge-{}-{}", hot_wallet_node_id, client_node_id),
                                    source: hot_wallet_node_id.clone(),
                                    target: client_node_id.clone(),
                                    style_type: None, animated: None,
                                });
                            }
                        }
                    }

                    let add_client_action_node_id = format!("action-add-client-{}", hw_address_str);
                    nodes.push(GraphNode {
                        id: add_client_action_node_id.clone(),
                        node_type: "addAuthorizedClientActionNode".to_string(),
                        data: GraphNodeData::AddAuthorizedClientActionNode {
                            label: "Authorize New Client".to_string(),
                            target_hot_wallet_address: hw_address_str.clone(),
                            action_id: "trigger_add_client_modal".to_string(),
                        },
                        position: None,
                    });
                    edges.push(GraphEdge {
                        id: format!("edge-{}-{}", hot_wallet_node_id, add_client_action_node_id),
                        source: hot_wallet_node_id.clone(),
                        target: add_client_action_node_id.clone(),
                        style_type: None,
                        animated: Some(true),
                    });
                }
            }
            Err(e) => {
                error!("Failed to get linked hot wallet addresses for graph: {}", e);
            }
        }
    }
    Ok(HypergridGraphResponse { nodes, edges })
}

pub fn handle_get_hypergrid_graph_layout(
    our: &Address,
    state: &mut State,
) -> anyhow::Result<()> {
    info!("Handling GET /api/hypergrid-graph for node {}...", our.node);
    
    // Re-check operator identity to ensure state is up-to-date (especially after TBA minting)
    if let Err(e) = crate::identity::initialize_operator_identity(our, state) {
        warn!("Failed to re-initialize operator identity during graph build: {:?}", e);
    }
    
    match build_hypergrid_graph_data(our, state) {
        Ok(graph_response) => {
            // Log the serialized JSON before sending
            match serde_json::to_string_pretty(&graph_response) {
                Ok(json_string) => info!("Serialized HypergridGraphResponse JSON:\n{}", json_string),
                Err(e) => error!("Failed to serialize HypergridGraphResponse for logging: {:?}", e),
            }
            send_json_response(StatusCode::OK, &graph_response)
        }
        Err(e) => {
            error!("Error building Hypergrid graph data: {:?}", e);
            send_json_response(StatusCode::INTERNAL_SERVER_ERROR, &json!({"error": e.to_string()}))
        }
    }
} 
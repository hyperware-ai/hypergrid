#[cfg(test)]
mod graph_tests {
    use crate::structs::*;

    #[test]
    fn test_node_position_serialization() {
        let position = NodePosition { x: 100.5, y: 200.7 };
        
        let json = serde_json::to_string(&position).unwrap();
        let deserialized: NodePosition = serde_json::from_str(&json).unwrap();
        
        assert_eq!(position.x, deserialized.x);
        assert_eq!(position.y, deserialized.y);
    }

    #[test]
    fn test_operator_wallet_funding_info() {
        let funding_info = OperatorWalletFundingInfo {
            eth_balance_str: Some("1.5".to_string()),
            usdc_balance_str: Some("100.0".to_string()),
            needs_eth: false,
            needs_usdc: true,
            error_message: Some("RPC timeout".to_string()),
        };
        
        let json = serde_json::to_string(&funding_info).unwrap();
        let deserialized: OperatorWalletFundingInfo = serde_json::from_str(&json).unwrap();
        
        assert_eq!(funding_info.eth_balance_str, deserialized.eth_balance_str);
        assert_eq!(funding_info.usdc_balance_str, deserialized.usdc_balance_str);
        assert_eq!(funding_info.needs_eth, deserialized.needs_eth);
        assert_eq!(funding_info.needs_usdc, deserialized.needs_usdc);
        assert_eq!(funding_info.error_message, deserialized.error_message);
    }

    #[test]
    fn test_hot_wallet_funding_info() {
        let funding_info = HotWalletFundingInfo {
            eth_balance_str: Some("0.1".to_string()),
            needs_eth: true,
            error_message: None,
        };
        
        let json = serde_json::to_string(&funding_info).unwrap();
        let deserialized: HotWalletFundingInfo = serde_json::from_str(&json).unwrap();
        
        assert_eq!(funding_info.eth_balance_str, deserialized.eth_balance_str);
        assert_eq!(funding_info.needs_eth, deserialized.needs_eth);
        assert_eq!(funding_info.error_message, deserialized.error_message);
    }

    #[test]
    fn test_note_info() {
        let note_info = NoteInfo {
            status_text: "Signers note is set".to_string(),
            details: Some("Contains 3 authorized signers".to_string()),
            is_set: true,
            action_needed: false,
            action_id: None,
        };
        
        let json = serde_json::to_string(&note_info).unwrap();
        let deserialized: NoteInfo = serde_json::from_str(&json).unwrap();
        
        assert_eq!(note_info.status_text, deserialized.status_text);
        assert_eq!(note_info.details, deserialized.details);
        assert_eq!(note_info.is_set, deserialized.is_set);
        assert_eq!(note_info.action_needed, deserialized.action_needed);
        assert_eq!(note_info.action_id, deserialized.action_id);
    }

    #[test]
    fn test_graph_node_data_owner_node() {
        let node_data = GraphNodeData::OwnerNode {
            name: "alice.os".to_string(),
            tba_address: Some("0x123456".to_string()),
            owner_address: Some("0x654321".to_string()),
        };
        
        let json = serde_json::to_string(&node_data).unwrap();
        let deserialized: GraphNodeData = serde_json::from_str(&json).unwrap();
        
        match deserialized {
            GraphNodeData::OwnerNode { name, tba_address, owner_address } => {
                assert_eq!(name, "alice.os");
                assert_eq!(tba_address, Some("0x123456".to_string()));
                assert_eq!(owner_address, Some("0x654321".to_string()));
            }
            _ => panic!("Expected OwnerNode variant"),
        }
    }

    #[test]
    fn test_graph_node_data_hot_wallet_node() {
        let spending_limits = SpendingLimits {
            max_per_call: Some("50.0".to_string()),
            max_total: Some("500.0".to_string()),
            currency: Some("USDC".to_string()),
        };
        
        let funding_info = HotWalletFundingInfo {
            eth_balance_str: Some("0.05".to_string()),
            needs_eth: true,
            error_message: None,
        };
        
        let node_data = GraphNodeData::HotWalletNode {
            address: "0xabcdef".to_string(),
            name: Some("My Hot Wallet".to_string()),
            status_description: "Active and Ready".to_string(),
            is_active_in_mcp: true,
            is_encrypted: true,
            is_unlocked: true,
            funding_info,
            authorized_clients: vec!["client-1".to_string(), "client-2".to_string()],
            limits: Some(spending_limits),
        };
        
        let json = serde_json::to_string(&node_data).unwrap();
        let deserialized: GraphNodeData = serde_json::from_str(&json).unwrap();
        
        match deserialized {
            GraphNodeData::HotWalletNode { 
                address, 
                name, 
                status_description, 
                is_active_in_mcp, 
                is_encrypted, 
                is_unlocked, 
                funding_info: _,
                authorized_clients, 
                limits 
            } => {
                assert_eq!(address, "0xabcdef");
                assert_eq!(name, Some("My Hot Wallet".to_string()));
                assert_eq!(status_description, "Active and Ready");
                assert_eq!(is_active_in_mcp, true);
                assert_eq!(is_encrypted, true);
                assert_eq!(is_unlocked, true);
                assert_eq!(authorized_clients.len(), 2);
                assert!(limits.is_some());
            }
            _ => panic!("Expected HotWalletNode variant"),
        }
    }

    #[test]
    fn test_graph_node_data_authorized_client_node() {
        let node_data = GraphNodeData::AuthorizedClientNode {
            client_id: "client-123".to_string(),
            client_name: "Test MCP Client".to_string(),
            associated_hot_wallet_address: "0xabcdef".to_string(),
        };
        
        let json = serde_json::to_string(&node_data).unwrap();
        let deserialized: GraphNodeData = serde_json::from_str(&json).unwrap();
        
        match deserialized {
            GraphNodeData::AuthorizedClientNode { client_id, client_name, associated_hot_wallet_address } => {
                assert_eq!(client_id, "client-123");
                assert_eq!(client_name, "Test MCP Client");
                assert_eq!(associated_hot_wallet_address, "0xabcdef");
            }
            _ => panic!("Expected AuthorizedClientNode variant"),
        }
    }

    #[test]
    fn test_graph_node_data_add_hot_wallet_action_node() {
        let node_data = GraphNodeData::AddHotWalletActionNode {
            label: "Add Hot Wallet".to_string(),
            operator_tba_address: Some("0x123456".to_string()),
            action_id: "trigger_manage_wallets_modal".to_string(),
        };
        
        let json = serde_json::to_string(&node_data).unwrap();
        let deserialized: GraphNodeData = serde_json::from_str(&json).unwrap();
        
        match deserialized {
            GraphNodeData::AddHotWalletActionNode { label, operator_tba_address, action_id } => {
                assert_eq!(label, "Add Hot Wallet");
                assert_eq!(operator_tba_address, Some("0x123456".to_string()));
                assert_eq!(action_id, "trigger_manage_wallets_modal");
            }
            _ => panic!("Expected AddHotWalletActionNode variant"),
        }
    }

    #[test]
    fn test_mint_operator_wallet_action_node_data() {
        let action_data = MintOperatorWalletActionNodeData {
            label: "Mint Operator Wallet".to_string(),
            owner_node_name: "alice.os".to_string(),
            action_id: "trigger_mint_operator_wallet".to_string(),
        };
        
        let json = serde_json::to_string(&action_data).unwrap();
        let deserialized: MintOperatorWalletActionNodeData = serde_json::from_str(&json).unwrap();
        
        assert_eq!(action_data.label, deserialized.label);
        assert_eq!(action_data.owner_node_name, deserialized.owner_node_name);
        assert_eq!(action_data.action_id, deserialized.action_id);
    }

    #[test]
    fn test_graph_node_complete() {
        let position = NodePosition { x: 150.0, y: 250.0 };
        let node_data = GraphNodeData::OwnerNode {
            name: "test.os".to_string(),
            tba_address: Some("0x123".to_string()),
            owner_address: Some("0x456".to_string()),
        };
        
        let graph_node = GraphNode {
            id: "owner-node-1".to_string(),
            node_type: "ownerNode".to_string(),
            data: node_data,
            position: Some(position),
        };
        
        let json = serde_json::to_string(&graph_node).unwrap();
        let deserialized: GraphNode = serde_json::from_str(&json).unwrap();
        
        assert_eq!(graph_node.id, deserialized.id);
        assert_eq!(graph_node.node_type, deserialized.node_type);
        assert!(deserialized.position.is_some());
        
        if let Some(pos) = deserialized.position {
            assert_eq!(pos.x, 150.0);
            assert_eq!(pos.y, 250.0);
        }
    }

    #[test]
    fn test_graph_edge() {
        let edge = GraphEdge {
            id: "edge-1".to_string(),
            source: "owner-node".to_string(),
            target: "operator-wallet-node".to_string(),
            style_type: Some("dashed".to_string()),
            animated: Some(true),
        };
        
        let json = serde_json::to_string(&edge).unwrap();
        let deserialized: GraphEdge = serde_json::from_str(&json).unwrap();
        
        assert_eq!(edge.id, deserialized.id);
        assert_eq!(edge.source, deserialized.source);
        assert_eq!(edge.target, deserialized.target);
        assert_eq!(edge.style_type, deserialized.style_type);
        assert_eq!(edge.animated, deserialized.animated);
    }

    #[test]
    fn test_hypergrid_graph_response() {
        let node = GraphNode {
            id: "test-node".to_string(),
            node_type: "ownerNode".to_string(),
            data: GraphNodeData::OwnerNode {
                name: "test.os".to_string(),
                tba_address: None,
                owner_address: None,
            },
            position: None,
        };
        
        let edge = GraphEdge {
            id: "test-edge".to_string(),
            source: "node-1".to_string(),
            target: "node-2".to_string(),
            style_type: None,
            animated: None,
        };
        
        let response = HypergridGraphResponse {
            nodes: vec![node],
            edges: vec![edge],
        };
        
        let json = serde_json::to_string(&response).unwrap();
        let deserialized: HypergridGraphResponse = serde_json::from_str(&json).unwrap();
        
        assert_eq!(response.nodes.len(), deserialized.nodes.len());
        assert_eq!(response.edges.len(), deserialized.edges.len());
        assert_eq!(response.nodes[0].id, deserialized.nodes[0].id);
        assert_eq!(response.edges[0].id, deserialized.edges[0].id);
    }
}
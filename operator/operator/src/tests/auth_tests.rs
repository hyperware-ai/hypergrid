#[cfg(test)]
mod auth_tests {
    use crate::authorized_services::*;
    use crate::structs::*;
    use crate::helpers::authenticate_shim_client;
    use std::collections::HashMap;
    use sha2::{Sha256, Digest};

    #[test]
    fn test_service_capabilities_serialization() {
        let all = ServiceCapabilities::All;
        let none = ServiceCapabilities::None;
        
        let all_json = serde_json::to_string(&all).unwrap();
        let none_json = serde_json::to_string(&none).unwrap();
        
        let all_deserialized: ServiceCapabilities = serde_json::from_str(&all_json).unwrap();
        let none_deserialized: ServiceCapabilities = serde_json::from_str(&none_json).unwrap();
        
        assert_eq!(all, all_deserialized);
        assert_eq!(none, none_deserialized);
    }

    #[test]
    fn test_service_capabilities_equality() {
        assert_eq!(ServiceCapabilities::All, ServiceCapabilities::All);
        assert_eq!(ServiceCapabilities::None, ServiceCapabilities::None);
        assert_ne!(ServiceCapabilities::All, ServiceCapabilities::None);
    }

    #[test]
    fn test_hot_wallet_authorized_client_creation() {
        let client = HotWalletAuthorizedClient {
            id: "test-client-123".to_string(),
            name: "Test MCP Client".to_string(),
            associated_hot_wallet_address: "0x742d35Cc6634C0532925a3b8D0c0D7D2d1234567".to_string(),
            authentication_token: "hashed-token-value".to_string(),
            capabilities: ServiceCapabilities::All,
        };
        
        assert_eq!(client.id, "test-client-123");
        assert_eq!(client.name, "Test MCP Client");
        assert_eq!(client.associated_hot_wallet_address, "0x742d35Cc6634C0532925a3b8D0c0D7D2d1234567");
        assert_eq!(client.authentication_token, "hashed-token-value");
        assert_eq!(client.capabilities, ServiceCapabilities::All);
    }

    #[test]
    fn test_hot_wallet_authorized_client_serialization() {
        let client = HotWalletAuthorizedClient {
            id: "client-456".to_string(),
            name: "Another Client".to_string(),
            associated_hot_wallet_address: "0x123456789abcdef123456789abcdef123456789a".to_string(),
            authentication_token: "secret-hash".to_string(),
            capabilities: ServiceCapabilities::None,
        };
        
        let json = serde_json::to_string(&client).unwrap();
        let deserialized: HotWalletAuthorizedClient = serde_json::from_str(&json).unwrap();
        
        assert_eq!(client.id, deserialized.id);
        assert_eq!(client.name, deserialized.name);
        assert_eq!(client.associated_hot_wallet_address, deserialized.associated_hot_wallet_address);
        assert_eq!(client.authentication_token, deserialized.authentication_token);
        assert_eq!(client.capabilities, deserialized.capabilities);
    }

    #[test]
    fn test_hot_wallet_authorized_client_equality() {
        let client1 = HotWalletAuthorizedClient {
            id: "client-1".to_string(),
            name: "Client One".to_string(),
            associated_hot_wallet_address: "0x123".to_string(),
            authentication_token: "token1".to_string(),
            capabilities: ServiceCapabilities::All,
        };
        
        let client2 = HotWalletAuthorizedClient {
            id: "client-1".to_string(),
            name: "Client One".to_string(),
            associated_hot_wallet_address: "0x123".to_string(),
            authentication_token: "token1".to_string(),
            capabilities: ServiceCapabilities::All,
        };
        
        let client3 = HotWalletAuthorizedClient {
            id: "client-2".to_string(),
            name: "Client Two".to_string(),
            associated_hot_wallet_address: "0x456".to_string(),
            authentication_token: "token2".to_string(),
            capabilities: ServiceCapabilities::None,
        };
        
        assert_eq!(client1, client2);
        assert_ne!(client1, client3);
    }

    fn create_test_state_with_client() -> (State, String, String) {
        let raw_token = "test-raw-token-12345";
        let mut hasher = Sha256::new();
        hasher.update(raw_token.as_bytes());
        let hashed_token = format!("{:x}", hasher.finalize());
        
        let client = HotWalletAuthorizedClient {
            id: "test-client".to_string(),
            name: "Test Client".to_string(),
            associated_hot_wallet_address: "0x742d35Cc6634C0532925a3b8D0c0D7D2d1234567".to_string(),
            authentication_token: hashed_token,
            capabilities: ServiceCapabilities::All,
        };
        
        let mut authorized_clients = HashMap::new();
        authorized_clients.insert("test-client".to_string(), client);
        
        let mut state = State::new();
        state.authorized_clients = authorized_clients;
        
        (state, "test-client".to_string(), raw_token.to_string())
    }

    #[test]
    fn test_authenticate_shim_client_success() {
        let (state, client_id, raw_token) = create_test_state_with_client();
        
        let result = authenticate_shim_client(&state, &client_id, &raw_token);
        assert!(result.is_ok());
        
        let client = result.unwrap();
        assert_eq!(client.id, "test-client");
        assert_eq!(client.capabilities, ServiceCapabilities::All);
    }

    #[test]
    fn test_authenticate_shim_client_not_found() {
        let (state, _client_id, raw_token) = create_test_state_with_client();
        
        let result = authenticate_shim_client(&state, "nonexistent-client", &raw_token);
        assert!(result.is_err());
        
        match result {
            Err(AuthError::ClientNotFound) => {},
            _ => panic!("Expected ClientNotFound error"),
        }
    }

    #[test]
    fn test_authenticate_shim_client_invalid_token() {
        let (state, client_id, _raw_token) = create_test_state_with_client();
        
        let result = authenticate_shim_client(&state, &client_id, "wrong-token");
        assert!(result.is_err());
        
        match result {
            Err(AuthError::InvalidToken) => {},
            _ => panic!("Expected InvalidToken error"),
        }
    }

    #[test]
    fn test_authenticate_shim_client_insufficient_capabilities() {
        let (mut state, client_id, raw_token) = create_test_state_with_client();
        
        // Modify the client to have None capabilities
        if let Some(client) = state.authorized_clients.get_mut(&client_id) {
            client.capabilities = ServiceCapabilities::None;
        }
        
        let result = authenticate_shim_client(&state, &client_id, &raw_token);
        assert!(result.is_err());
        
        match result {
            Err(AuthError::InsufficientCapabilities) => {},
            _ => panic!("Expected InsufficientCapabilities error"),
        }
    }

    #[test]
    fn test_authenticate_shim_client_empty_token() {
        let (state, client_id, _raw_token) = create_test_state_with_client();
        
        let result = authenticate_shim_client(&state, &client_id, "");
        assert!(result.is_err());
        
        match result {
            Err(AuthError::InvalidToken) => {},
            _ => panic!("Expected InvalidToken error"),
        }
    }

    #[test]
    fn test_authenticate_shim_client_multiple_clients() {
        let mut state = State::new();
        let mut authorized_clients = HashMap::new();
        
        // Create two different clients
        for i in 1..=2 {
            let raw_token = format!("token-{}", i);
            let mut hasher = Sha256::new();
            hasher.update(raw_token.as_bytes());
            let hashed_token = format!("{:x}", hasher.finalize());
            
            let client = HotWalletAuthorizedClient {
                id: format!("client-{}", i),
                name: format!("Client {}", i),
                associated_hot_wallet_address: format!("0x{:040}", i),
                authentication_token: hashed_token,
                capabilities: ServiceCapabilities::All,
            };
            
            authorized_clients.insert(format!("client-{}", i), client);
        }
        
        state.authorized_clients = authorized_clients;
        
        // Test authenticating each client
        for i in 1..=2 {
            let client_id = format!("client-{}", i);
            let raw_token = format!("token-{}", i);
            
            let result = authenticate_shim_client(&state, &client_id, &raw_token);
            assert!(result.is_ok());
            
            let client = result.unwrap();
            assert_eq!(client.id, client_id);
        }
        
        // Test cross-authentication (should fail)
        let result = authenticate_shim_client(&state, "client-1", "token-2");
        assert!(result.is_err());
        match result {
            Err(AuthError::InvalidToken) => {},
            _ => panic!("Expected InvalidToken error for cross-authentication"),
        }
    }

    #[test]
    fn test_token_hashing_consistency() {
        let raw_token = "my-secret-token";
        
        // Hash the token twice
        let mut hasher1 = Sha256::new();
        hasher1.update(raw_token.as_bytes());
        let hash1 = format!("{:x}", hasher1.finalize());
        
        let mut hasher2 = Sha256::new();
        hasher2.update(raw_token.as_bytes());
        let hash2 = format!("{:x}", hasher2.finalize());
        
        assert_eq!(hash1, hash2);
        assert_eq!(hash1.len(), 64); // SHA256 produces 64 hex characters
    }

    #[test]
    fn test_different_tokens_different_hashes() {
        let tokens = ["token1", "token2", "token3"];
        let mut hashes = Vec::new();
        
        for token in &tokens {
            let mut hasher = Sha256::new();
            hasher.update(token.as_bytes());
            let hash = format!("{:x}", hasher.finalize());
            hashes.push(hash);
        }
        
        // All hashes should be different
        for i in 0..hashes.len() {
            for j in i+1..hashes.len() {
                assert_ne!(hashes[i], hashes[j], "Tokens '{}' and '{}' produced same hash", tokens[i], tokens[j]);
            }
        }
    }

    #[test]
    fn test_state_authorized_clients_empty_by_default() {
        let state = State::new();
        assert!(state.authorized_clients.is_empty());
    }
}
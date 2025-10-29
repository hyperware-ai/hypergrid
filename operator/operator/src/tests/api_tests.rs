#[cfg(test)]
mod api_tests {
    use crate::structs::*;

    #[test]
    fn test_mcp_request_search_registry() {
        let request = McpRequest::SearchRegistry("weather".to_string());
        
        let json = serde_json::to_string(&request).unwrap();
        let deserialized: McpRequest = serde_json::from_str(&json).unwrap();
        
        match deserialized {
            McpRequest::SearchRegistry(query) => {
                assert_eq!(query, "weather");
            }
            _ => panic!("Expected SearchRegistry variant"),
        }
    }

    #[test]
    fn test_mcp_request_call_provider() {
        let request = McpRequest::CallProvider {
            provider_id: "weather:provider:os".to_string(),
            provider_name: "weather-provider".to_string(),
            arguments: vec![
                ("location".to_string(), "San Francisco".to_string()),
                ("format".to_string(), "json".to_string()),
            ],
        };
        
        let json = serde_json::to_string(&request).unwrap();
        let deserialized: McpRequest = serde_json::from_str(&json).unwrap();
        
        match deserialized {
            McpRequest::CallProvider { provider_id, provider_name, arguments } => {
                assert_eq!(provider_id, "weather:provider:os");
                assert_eq!(provider_name, "weather-provider");
                assert_eq!(arguments.len(), 2);
                assert_eq!(arguments[0], ("location".to_string(), "San Francisco".to_string()));
                assert_eq!(arguments[1], ("format".to_string(), "json".to_string()));
            }
            _ => panic!("Expected CallProvider variant"),
        }
    }

    #[test]
    fn test_api_request_get_call_history() {
        let request = ApiRequest::GetCallHistory {};
        
        let json = serde_json::to_string(&request).unwrap();
        let deserialized: ApiRequest = serde_json::from_str(&json).unwrap();
        
        match deserialized {
            ApiRequest::GetCallHistory {} => {},
            _ => panic!("Expected GetCallHistory variant"),
        }
    }

    #[test]
    fn test_api_request_generate_wallet() {
        let request = ApiRequest::GenerateWallet {};
        
        let json = serde_json::to_string(&request).unwrap();
        let deserialized: ApiRequest = serde_json::from_str(&json).unwrap();
        
        match deserialized {
            ApiRequest::GenerateWallet {} => {},
            _ => panic!("Expected GenerateWallet variant"),
        }
    }

    #[test]
    fn test_api_request_import_wallet() {
        let request = ApiRequest::ImportWallet {
            private_key: "0x123456789abcdef".to_string(),
            password: Some("secure_password".to_string()),
            name: Some("My Wallet".to_string()),
        };
        
        let json = serde_json::to_string(&request).unwrap();
        let deserialized: ApiRequest = serde_json::from_str(&json).unwrap();
        
        match deserialized {
            ApiRequest::ImportWallet { private_key, password, name } => {
                assert_eq!(private_key, "0x123456789abcdef");
                assert_eq!(password, Some("secure_password".to_string()));
                assert_eq!(name, Some("My Wallet".to_string()));
            }
            _ => panic!("Expected ImportWallet variant"),
        }
    }

    #[test]
    fn test_api_request_select_wallet() {
        let request = ApiRequest::SelectWallet {
            wallet_id: "wallet-123".to_string(),
        };
        
        let json = serde_json::to_string(&request).unwrap();
        let deserialized: ApiRequest = serde_json::from_str(&json).unwrap();
        
        match deserialized {
            ApiRequest::SelectWallet { wallet_id } => {
                assert_eq!(wallet_id, "wallet-123");
            }
            _ => panic!("Expected SelectWallet variant"),
        }
    }

    #[test]
    fn test_api_request_set_wallet_limits() {
        let limits = SpendingLimits {
            max_per_call: Some("100.0".to_string()),
            max_total: Some("1000.0".to_string()),
            currency: Some("USDC".to_string()),
        };
        
        let request = ApiRequest::SetWalletLimits { limits: limits.clone() };
        
        let json = serde_json::to_string(&request).unwrap();
        let deserialized: ApiRequest = serde_json::from_str(&json).unwrap();
        
        match deserialized {
            ApiRequest::SetWalletLimits { limits: deserialized_limits } => {
                assert_eq!(limits.max_per_call, deserialized_limits.max_per_call);
                assert_eq!(limits.max_total, deserialized_limits.max_total);
                assert_eq!(limits.currency, deserialized_limits.currency);
            }
            _ => panic!("Expected SetWalletLimits variant"),
        }
    }

    #[test]
    fn test_api_request_withdraw_eth() {
        let request = ApiRequest::WithdrawEthFromOperatorTba {
            to_address: "0x742d35Cc6634C0532925a3b8D0c0D7D2d1234567".to_string(),
            amount_wei_str: "1000000000000000000".to_string(), // 1 ETH in wei
        };
        
        let json = serde_json::to_string(&request).unwrap();
        let deserialized: ApiRequest = serde_json::from_str(&json).unwrap();
        
        match deserialized {
            ApiRequest::WithdrawEthFromOperatorTba { to_address, amount_wei_str } => {
                assert_eq!(to_address, "0x742d35Cc6634C0532925a3b8D0c0D7D2d1234567");
                assert_eq!(amount_wei_str, "1000000000000000000");
            }
            _ => panic!("Expected WithdrawEthFromOperatorTba variant"),
        }
    }

    #[test]
    fn test_api_request_withdraw_usdc() {
        let request = ApiRequest::WithdrawUsdcFromOperatorTba {
            to_address: "0x742d35Cc6634C0532925a3b8D0c0D7D2d1234567".to_string(),
            amount_usdc_units_str: "1000000".to_string(), // 1 USDC (6 decimals)
        };
        
        let json = serde_json::to_string(&request).unwrap();
        let deserialized: ApiRequest = serde_json::from_str(&json).unwrap();
        
        match deserialized {
            ApiRequest::WithdrawUsdcFromOperatorTba { to_address, amount_usdc_units_str } => {
                assert_eq!(to_address, "0x742d35Cc6634C0532925a3b8D0c0D7D2d1234567");
                assert_eq!(amount_usdc_units_str, "1000000");
            }
            _ => panic!("Expected WithdrawUsdcFromOperatorTba variant"),
        }
    }

    #[test]
    fn test_save_shim_key_request() {
        let request = SaveShimKeyRequest {
            raw_key: "test-api-key-12345".to_string(),
        };
        
        let json = serde_json::to_string(&request).unwrap();
        let deserialized: SaveShimKeyRequest = serde_json::from_str(&json).unwrap();
        
        assert_eq!(request.raw_key, deserialized.raw_key);
    }

    #[test]
    fn test_configure_authorized_client_request() {
        let request = ConfigureAuthorizedClientRequest {
            client_id: Some("client-123".to_string()),
            client_name: Some("Test Client".to_string()),
            raw_token: "token-12345".to_string(),
            hot_wallet_address_to_associate: "0x742d35Cc6634C0532925a3b8D0c0D7D2d1234567".to_string(),
        };
        
        let json = serde_json::to_string(&request).unwrap();
        let deserialized: ConfigureAuthorizedClientRequest = serde_json::from_str(&json).unwrap();
        
        assert_eq!(request.client_id, deserialized.client_id);
        assert_eq!(request.client_name, deserialized.client_name);
        assert_eq!(request.raw_token, deserialized.raw_token);
        assert_eq!(request.hot_wallet_address_to_associate, deserialized.hot_wallet_address_to_associate);
    }

    #[test]
    fn test_configure_authorized_client_response() {
        let response = ConfigureAuthorizedClientResponse {
            client_id: "client-123".to_string(),
            raw_token: "token-12345".to_string(),
            api_base_path: "/test:process.os/api".to_string(),
            node_name: "test.os".to_string(),
        };
        
        let json = serde_json::to_string(&response).unwrap();
        let deserialized: ConfigureAuthorizedClientResponse = serde_json::from_str(&json).unwrap();
        
        assert_eq!(response.client_id, deserialized.client_id);
        assert_eq!(response.raw_token, deserialized.raw_token);
        assert_eq!(response.api_base_path, deserialized.api_base_path);
        assert_eq!(response.node_name, deserialized.node_name);
    }

    #[test]
    fn test_provider_request_serialization() {
        let provider_request = ProviderCall {
            provider_name: "weather-service".to_string(),
            arguments: vec![
                ("city".to_string(), "New York".to_string()),
                ("country".to_string(), "US".to_string()),
            ],
            payment_tx_hash: Some("0xabcdef123456".to_string()),
        };
        
        let json = serde_json::to_string(&provider_request).unwrap();
        let deserialized: ProviderCall = serde_json::from_str(&json).unwrap();
        
        assert_eq!(provider_request.provider_name, deserialized.provider_name);
        assert_eq!(provider_request.arguments, deserialized.arguments);
        assert_eq!(provider_request.payment_tx_hash, deserialized.payment_tx_hash);
    }

    #[test]
    fn test_client_request_variants() {
        let requests = vec![
            ClientRequest::GetFullRegistry,
            ClientRequest::SearchRegistry("search-term".to_string()),
        ];
        
        for request in requests {
            let json = serde_json::to_string(&request).unwrap();
            let _deserialized: ClientRequest = serde_json::from_str(&json).unwrap();
        }
    }
}
#[cfg(test)]
mod state_tests {
    use crate::structs::*;
    use std::collections::HashMap;

    #[test]
    fn test_state_new_initialization() {
        let state = State::new();
        
        assert_eq!(state.chain_id, CHAIN_ID);
        assert_eq!(state.last_checkpoint_block, HYPERMAP_FIRST_BLOCK);
        assert!(state.managed_wallets.is_empty());
        assert!(state.selected_wallet_id.is_none());
        assert!(state.operator_entry_name.is_none());
        assert!(state.operator_tba_address.is_none());
        assert!(state.call_history.is_empty());
        assert!(state.authorized_clients.is_empty());
        assert!(!state.timers_initialized);
    }

    #[test]
    fn test_spending_limits_serialization() {
        let limits = SpendingLimits {
            max_per_call: Some("100.0".to_string()),
            max_total: Some("1000.0".to_string()),
            currency: Some("USDC".to_string()),
        };
        
        let json = serde_json::to_string(&limits).unwrap();
        let deserialized: SpendingLimits = serde_json::from_str(&json).unwrap();
        
        assert_eq!(limits.max_per_call, deserialized.max_per_call);
        assert_eq!(limits.max_total, deserialized.max_total);
        assert_eq!(limits.currency, deserialized.currency);
    }

    #[test]
    fn test_onboarding_status_variants() {
        let statuses = vec![
            OnboardingStatus::Loading,
            OnboardingStatus::NeedsHotWallet,
            OnboardingStatus::NeedsOnChainSetup,
            OnboardingStatus::NeedsFunding,
            OnboardingStatus::Ready,
            OnboardingStatus::Error,
        ];
        
        for status in statuses {
            let json = serde_json::to_string(&status).unwrap();
            let _deserialized: OnboardingStatus = serde_json::from_str(&json).unwrap();
        }
    }

    #[test]
    fn test_payment_attempt_result_success() {
        let result = PaymentAttemptResult::Success {
            tx_hash: "0x123456".to_string(),
            amount_paid: "1.5".to_string(),
            currency: "USDC".to_string(),
        };
        
        let json = serde_json::to_string(&result).unwrap();
        let deserialized: PaymentAttemptResult = serde_json::from_str(&json).unwrap();
        
        match deserialized {
            PaymentAttemptResult::Success { tx_hash, amount_paid, currency } => {
                assert_eq!(tx_hash, "0x123456");
                assert_eq!(amount_paid, "1.5");
                assert_eq!(currency, "USDC");
            }
            _ => panic!("Expected Success variant"),
        }
    }

    #[test]
    fn test_payment_attempt_result_failed() {
        let result = PaymentAttemptResult::Failed {
            error: "Insufficient balance".to_string(),
            amount_attempted: "2.0".to_string(),
            currency: "USDC".to_string(),
        };
        
        let json = serde_json::to_string(&result).unwrap();
        let deserialized: PaymentAttemptResult = serde_json::from_str(&json).unwrap();
        
        match deserialized {
            PaymentAttemptResult::Failed { error, amount_attempted, currency } => {
                assert_eq!(error, "Insufficient balance");
                assert_eq!(amount_attempted, "2.0");
                assert_eq!(currency, "USDC");
            }
            _ => panic!("Expected Failed variant"),
        }
    }

    #[test]
    fn test_call_record_serialization() {
        let call_record = CallRecord {
            timestamp_start_ms: 1640995200000,
            provider_lookup_key: "weather-provider".to_string(),
            target_provider_id: "weather:provider:os".to_string(),
            call_args_json: r#"{"location": "San Francisco"}"#.to_string(),
            call_success: true,
            response_timestamp_ms: 1640995201000,
            payment_result: Some(PaymentAttemptResult::Success {
                tx_hash: "0xdef".to_string(),
                amount_paid: "0.001".to_string(),
                currency: "USDC".to_string(),
            }),
            duration_ms: 1000,
            operator_wallet_id: Some("wallet-1".to_string()),
        };
        
        let json = serde_json::to_string(&call_record).unwrap();
        let deserialized: CallRecord = serde_json::from_str(&json).unwrap();
        
        assert_eq!(call_record.timestamp_start_ms, deserialized.timestamp_start_ms);
        assert_eq!(call_record.provider_lookup_key, deserialized.provider_lookup_key);
        assert_eq!(call_record.target_provider_id, deserialized.target_provider_id);
        assert_eq!(call_record.call_success, deserialized.call_success);
        assert_eq!(call_record.duration_ms, deserialized.duration_ms);
    }

    #[test]
    fn test_identity_status_verified() {
        let status = IdentityStatus::Verified {
            entry_name: "test.os".to_string(),
            tba_address: "0x123".to_string(),
            owner_address: "0x456".to_string(),
        };
        
        let json = serde_json::to_string(&status).unwrap();
        let deserialized: IdentityStatus = serde_json::from_str(&json).unwrap();
        
        match deserialized {
            IdentityStatus::Verified { entry_name, tba_address, owner_address } => {
                assert_eq!(entry_name, "test.os");
                assert_eq!(tba_address, "0x123");
                assert_eq!(owner_address, "0x456");
            }
            _ => panic!("Expected Verified variant"),
        }
    }

    #[test]
    fn test_delegation_status_serialization() {
        let statuses = vec![
            DelegationStatus::Verified,
            DelegationStatus::NeedsIdentity,
            DelegationStatus::NeedsHotWallet,
            DelegationStatus::AccessListNoteMissing,
            DelegationStatus::SignersNoteMissing,
            DelegationStatus::HotWalletNotInList,
            DelegationStatus::AccessListNoteInvalidData("Invalid length".to_string()),
            DelegationStatus::SignersNoteLookupError("RPC error".to_string()),
            DelegationStatus::SignersNoteInvalidData("ABI decode error".to_string()),
            DelegationStatus::CheckError("Network timeout".to_string()),
        ];
        
        for status in statuses {
            let json = serde_json::to_string(&status).unwrap();
            let _deserialized: DelegationStatus = serde_json::from_str(&json).unwrap();
        }
    }
}
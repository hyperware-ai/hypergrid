#[cfg(test)]
mod helpers_tests {
    use crate::helpers::*;
    use crate::structs::*;
    use sha2::{Sha256, Digest};
    use alloy_primitives::{Address as EthAddress, B256};
    use std::str::FromStr;

    #[test]
    fn test_decode_datakey_valid_hex() {
        let hex_string = "0x48656c6c6f20576f726c64"; // "Hello World" in hex
        let result = _decode_datakey(hex_string).unwrap();
        assert_eq!(result, "Hello World");
    }

    #[test]
    fn test_decode_datakey_without_prefix() {
        let hex_string = "48656c6c6f20576f726c64"; // "Hello World" in hex without 0x
        let result = _decode_datakey(hex_string).unwrap();
        assert_eq!(result, "Hello World");
    }

    #[test]
    fn test_decode_datakey_odd_length() {
        let hex_string = "0x48656c6c6f20576f726c6"; // Odd length hex
        let result = _decode_datakey(hex_string);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("odd number of hex digits"));
    }

    #[test]
    fn test_decode_datakey_invalid_hex() {
        let hex_string = "0x48656g6c6f20576f726c64"; // Invalid hex character 'g'
        let result = _decode_datakey(hex_string);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("invalid hex digit"));
    }

    #[test]
    fn test_decode_datakey_non_utf8() {
        let hex_string = "0xff80"; // Invalid UTF-8 sequence
        let result = _decode_datakey(hex_string);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("invalid UTF-8"));
    }

    #[test]
    fn test_decode_datakey_non_printable() {
        let hex_string = "0x0148656c6c6f"; // Contains control character (0x01)
        let result = _decode_datakey(hex_string);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("non-printable characters"));
    }

    #[test]
    fn test_decode_datakey_empty() {
        let hex_string = "0x";
        let result = _decode_datakey(hex_string).unwrap();
        assert_eq!(result, "");
    }

    #[test]
    fn test_decode_datakey_printable_ascii() {
        let hex_string = "0x41424321407e"; // "ABC!@~" - all printable ASCII
        let result = _decode_datakey(hex_string).unwrap();
        assert_eq!(result, "ABC!@~");
    }

    #[test]
    fn test_make_json_timestamp() {
        let timestamp = make_json_timestamp();
        
        // Should be a valid JSON number
        assert!(timestamp.is_u64());
        
        // Should be a reasonable timestamp (after 2020 and before 2050)
        let ts_u64 = timestamp.as_u64().unwrap();
        assert!(ts_u64 > 1577836800); // 2020-01-01
        assert!(ts_u64 < 2524608000); // 2050-01-01
    }

    #[test]
    fn test_get_provider_id_consistent() {
        let provider_name = "weather-service";
        let id1 = get_provider_id(provider_name);
        let id2 = get_provider_id(provider_name);
        
        assert_eq!(id1, id2);
        assert_eq!(id1.len(), 64); // SHA256 hex string length
    }

    #[test]
    fn test_get_provider_id_different_names() {
        let id1 = get_provider_id("weather-service");
        let id2 = get_provider_id("news-service");
        
        assert_ne!(id1, id2);
        assert_eq!(id1.len(), 64);
        assert_eq!(id2.len(), 64);
    }

    #[test]
    fn test_get_provider_id_matches_sha256() {
        let provider_name = "test-provider";
        let manual_hash = {
            let digest = Sha256::digest(provider_name.as_bytes());
            format!("{:x}", digest)
        };
        
        let function_hash = get_provider_id(provider_name);
        assert_eq!(manual_hash, function_hash);
    }

    #[test]
    fn test_get_provider_id_empty_string() {
        let id = get_provider_id("");
        assert_eq!(id.len(), 64);
        
        // Should match SHA256 of empty string
        let expected = format!("{:x}", Sha256::digest(b""));
        assert_eq!(id, expected);
    }

    #[test]
    fn test_get_provider_id_special_characters() {
        let provider_name = "provider-name_123!@#$%^&*()";
        let id = get_provider_id(provider_name);
        assert_eq!(id.len(), 64);
        
        // Should be valid hex
        assert!(hex::decode(&id).is_ok());
    }

    #[test]
    fn test_auth_error_variants() {
        use AuthError::*;
        
        // Test that each variant is distinct
        let errors = vec![
            MissingClientId,
            MissingToken,
            ClientNotFound,
            InvalidToken,
            InsufficientCapabilities,
        ];
        
        // Each should be different when formatted as debug
        for (i, error1) in errors.iter().enumerate() {
            for (j, error2) in errors.iter().enumerate() {
                if i != j {
                    assert_ne!(format!("{:?}", error1), format!("{:?}", error2));
                }
            }
        }
    }

    #[test]
    fn test_b256_conversion() {
        // Test that B256 can be created from a slice
        let bytes = [0u8; 32];
        let b256 = B256::from_slice(&bytes);
        assert_eq!(b256.as_slice(), &bytes);
    }

    #[test]
    fn test_eth_address_parsing() {
        let valid_address = "0x742d35Cc6634C0532925a3b8D0c0D7D2d1234567";
        let address = EthAddress::from_str(valid_address);
        assert!(address.is_ok());
        
        let parsed = address.unwrap();
        assert_eq!(parsed.to_string().to_lowercase(), valid_address.to_lowercase());
    }

    #[test]
    fn test_eth_address_zero() {
        let zero_address = EthAddress::ZERO;
        assert_eq!(zero_address.to_string(), "0x0000000000000000000000000000000000000000");
    }

    #[test]
    fn test_hex_encoding_decoding() {
        let data = b"Hello, World!";
        let encoded = hex::encode(data);
        let decoded = hex::decode(&encoded).unwrap();
        assert_eq!(data, decoded.as_slice());
    }

    #[test]
    fn test_hex_encoding_with_prefix() {
        let data = b"test";
        let encoded = hex::encode(data);
        let with_prefix = format!("0x{}", encoded);
        
        // Remove prefix and decode
        let without_prefix = if with_prefix.starts_with("0x") {
            &with_prefix[2..]
        } else {
            &with_prefix
        };
        
        let decoded = hex::decode(without_prefix).unwrap();
        assert_eq!(data, decoded.as_slice());
    }

    // Test helper functions used in the main helpers.rs
    #[test]
    fn test_sha256_consistency() {
        let input = "test input";
        
        let mut hasher1 = Sha256::new();
        hasher1.update(input.as_bytes());
        let result1 = format!("{:x}", hasher1.finalize());
        
        let mut hasher2 = Sha256::new();
        hasher2.update(input.as_bytes());
        let result2 = format!("{:x}", hasher2.finalize());
        
        assert_eq!(result1, result2);
        assert_eq!(result1.len(), 64);
    }

    #[test]
    fn test_slice_operations() {
        let data = vec![1, 2, 3, 4, 5];
        
        // Test that we can take slices like the code does
        let slice = &data[0..32.min(data.len())];
        assert_eq!(slice, &[1, 2, 3, 4, 5]);
        
        // Test with exactly 32 bytes
        let data32 = vec![0u8; 32];
        let slice32 = &data32[0..32];
        assert_eq!(slice32.len(), 32);
    }

    #[test]
    fn test_string_from_utf8_operations() {
        let valid_utf8 = vec![72, 101, 108, 108, 111]; // "Hello"
        let result = String::from_utf8(valid_utf8);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "Hello");
        
        let invalid_utf8 = vec![255, 254, 253]; // Invalid UTF-8
        let result = String::from_utf8(invalid_utf8);
        assert!(result.is_err());
    }

    #[test]
    fn test_printable_ascii_check() {
        // Test the character range check used in _decode_datakey
        let printable_chars = " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~";
        
        for c in printable_chars.chars() {
            assert!(c >= ' ' && c <= '~', "Character '{}' should be printable ASCII", c);
        }
        
        // Test non-printable characters
        let non_printable = ['\x00', '\x01', '\x1F', '\x7F'];
        for c in non_printable {
            assert!(!(c >= ' ' && c <= '~'), "Character '{}' should not be printable ASCII", c);
        }
    }
}
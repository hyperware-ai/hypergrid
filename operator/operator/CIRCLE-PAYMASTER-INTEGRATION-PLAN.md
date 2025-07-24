# Circle Paymaster Integration Plan for Operator Payment System

## Current Architecture Overview

### Payment Flow
1. **Operator** receives payment request via HTTP handler
2. Flow: `handle_provider_call_request` → `execute_provider_flow` → `handle_payment`
3. **operator/src/hyperwallet_client/payments.rs**: 
   - `execute_payment_if_needed` → `execute_payment_with_metadata`
   - Checks if gasless is available via `should_use_gasless` and `is_gasless_available`
4. **operator/src/hyperwallet_client/account_abstraction.rs**:
   - Builds UserOperation request
   - Sends to Hyperwallet for signing
5. **Hyperwallet** process handles actual signing and UserOp construction

## Key Issues to Address

### 1. Paymaster Data Format Mismatch
- **Problem**: Current implementation doesn't properly handle Circle's paymaster data requirements
- **Solution**: Implement the packed format for hash calculation, unpacked for API submission

### 2. Missing Circle-Specific Logic
- **Problem**: No special handling for Circle paymaster vs other paymasters
- **Solution**: Add Circle paymaster detection and proper data encoding

## Required Changes

### Operator Side (operator/src/hyperwallet_client/account_abstraction.rs)

#### 1. Update `build_user_operation_with_metadata`
```rust
// Add Circle paymaster detection
const CIRCLE_PAYMASTER: &str = "0x0578cFB241215b77442a541325d6A4E6dFE700Ec";

// In build_user_operation_with_metadata:
if use_paymaster {
    // Check if it's Circle paymaster
    let is_circle = metadata.as_ref()
        .and_then(|m| m.get("paymaster_address"))
        .and_then(|v| v.as_str())
        .map(|addr| addr.eq_ignore_ascii_case(CIRCLE_PAYMASTER))
        .unwrap_or(false);
    
    if is_circle {
        // Add Circle-specific metadata
        params["metadata"]["is_circle_paymaster"] = json!(true);
        params["metadata"]["paymaster_verification_gas"] = json!("0x7a120"); // 500000
        params["metadata"]["paymaster_post_op_gas"] = json!("0x493e0"); // 300000
    }
}
```

#### 2. Update `build_and_sign_user_operation_with_metadata`
- Pass through Circle paymaster metadata to Hyperwallet
- Ensure proper gas limits are included

### Hyperwallet Side (hyperwallet/src/operations/account_abstraction.rs)

#### 1. Update `build_user_operation` to Handle Circle Paymaster
```rust
// After line 213 (paymaster handling)
if params.use_paymaster.unwrap_or(false) {
    let is_circle = params.metadata.as_ref()
        .and_then(|m| m.get("is_circle_paymaster"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    
    if is_circle {
        // For Circle paymaster, set specific gas limits
        builder.paymaster_verification_gas_limit = U256::from(500000);
        builder.paymaster_post_op_gas_limit = U256::from(300000);
        
        // Build packed paymasterAndData for hash calculation
        let mut paymaster_and_data = Vec::new();
        let paymaster_addr = hex::decode("0578cFB241215b77442a541325d6A4E6dFE700Ec").unwrap();
        paymaster_and_data.extend_from_slice(&paymaster_addr);
        paymaster_and_data.extend_from_slice(&500000u128.to_be_bytes());
        paymaster_and_data.extend_from_slice(&300000u128.to_be_bytes());
        
        // Store for later use in signing
        builder.paymaster_and_data = paymaster_and_data;
    }
}
```

#### 2. Update UserOperation Signing Logic
When signing the UserOperation:
1. Use the packed `paymasterAndData` format for hash calculation
2. But return the unpacked format for Candide API submission

#### 3. Update Response Format
Ensure the response includes:
```json
{
  "signed_user_operation": {
    "sender": "0x...",
    "nonce": "0x0",
    "callData": "0x...",
    "callGasLimit": "0x...",
    "verificationGasLimit": "0x...",
    "preVerificationGas": "0x...",
    "maxFeePerGas": "0x...",
    "maxPriorityFeePerGas": "0x...",
    "signature": "0x...",
    "factory": null,
    "factoryData": null,
    "paymaster": "0x0578cFB241215b77442a541325d6A4E6dFE700Ec",
    "paymasterVerificationGasLimit": "0x7a120",
    "paymasterPostOpGasLimit": "0x493e0",
    "paymasterData": "0x"
  },
  "entry_point": "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108"
}
```

### Testing Strategy

#### 1. Update operator/src/hyperwallet_client/payments.rs
Add Circle paymaster metadata when gasless is enabled:
```rust
// Around line 151
if should_use_gasless(state) && account_abstraction::is_gasless_available(...) {
    // Add Circle paymaster metadata
    let mut final_metadata = metadata.unwrap_or_default();
    final_metadata.insert("paymaster_address".to_string(), 
        json!("0x0578cFB241215b77442a541325d6A4E6dFE700Ec"));
    
    // Continue with existing flow but pass final_metadata
}
```

#### 2. Test Commands
1. First test with the existing `test-submit-userop` to ensure it still works
2. Then test operator payments with gasless enabled
3. Monitor for AA33 errors and adjust gas limits if needed

## Implementation Steps

1. **Phase 1**: Update Hyperwallet to properly handle Circle paymaster
   - Implement packed format for hash calculation
   - Return unpacked format for API submission
   - Test with direct Hyperwallet calls

2. **Phase 2**: Update Operator to pass Circle metadata
   - Add Circle paymaster detection
   - Pass proper metadata to Hyperwallet
   - Test end-to-end payment flow

3. **Phase 3**: Production Testing
   - Test with real USDC transfers
   - Monitor gas usage and costs
   - Fine-tune gas limits if needed

## Key Insights from Working Implementation

1. **Hash Calculation**: Must use packed `paymasterAndData` format
2. **API Submission**: Must use unpacked format with separate fields
3. **Gas Limits**: 
   - Paymaster Verification: 500,000
   - Paymaster Post-Op: 300,000
4. **No Additional Data**: Circle paymaster doesn't require timestamps or signatures in `paymasterData`

## Success Criteria

1. Operator can make USDC payments without EOA having ETH
2. UserOperations are properly signed and submitted
3. Circle paymaster accepts and sponsors the transactions
4. No AA33 or signature validation errors
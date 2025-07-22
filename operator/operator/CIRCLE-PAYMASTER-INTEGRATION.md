# Circle Paymaster Integration Guide

## Overview

This document explains how to integrate Circle's USDC paymaster with ERC-4337 UserOperations on Base (chain ID 8453). The paymaster allows users to pay gas fees in USDC instead of ETH.

## Key Addresses

- **Circle Paymaster**: `0x0578cFB241215b77442a541325d6A4E6dFE700Ec`
- **EntryPoint v0.8**: `0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108`
- **USDC on Base**: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`

## Prerequisites

Before using the Circle paymaster:
1. The TBA (Token Bound Account) must have USDC
2. The TBA must approve the Circle paymaster to spend its USDC
3. The EOA signer does NOT need ETH (that's the whole point!)

## Critical Implementation Details

### The Format Mismatch Challenge

The main complexity comes from a format mismatch between:
1. **EntryPoint Contract**: Expects packed `paymasterAndData` field
2. **Candide Bundler API**: Expects separate paymaster fields

### Hash Calculation (Packed Format)

For the UserOperation hash calculation, the EntryPoint expects `paymasterAndData` as a single packed field:

```
paymasterAndData = paymaster_address (20 bytes) + verification_gas (16 bytes) + post_op_gas (16 bytes)
```

Example:
```
0x0578cfb241215b77442a541325d6a4e6dfe700ec  // Paymaster address (20 bytes)
0000000000000000000000000007a120            // Verification gas: 500000 (16 bytes)
000000000000000000000000000493e0            // Post-op gas: 300000 (16 bytes)
```

### API Submission (Unpacked Format)

Candide's v0.8 API expects these as separate fields:

```json
{
  "paymaster": "0x0578cFB241215b77442a541325d6A4E6dFE700Ec",
  "paymasterVerificationGasLimit": "0x7a120",  // 500000
  "paymasterPostOpGasLimit": "0x493e0",        // 300000
  "paymasterData": "0x"                        // Empty for Circle
}
```

## Implementation Steps

### 1. Prepare Paymaster Data for Hash

```rust
// For hash calculation, pack the full paymasterAndData
let mut paymaster_and_data = Vec::new();

// Paymaster address (20 bytes)
let paymaster_addr = hex::decode("0578cFB241215b77442a541325d6A4E6dFE700Ec").unwrap();
paymaster_and_data.extend_from_slice(&paymaster_addr);

// Verification gas limit (16 bytes, big-endian)
let verif_gas: u128 = 500000;
paymaster_and_data.extend_from_slice(&verif_gas.to_be_bytes());

// Post-op gas limit (16 bytes, big-endian)
let post_op_gas: u128 = 300000;
paymaster_and_data.extend_from_slice(&post_op_gas.to_be_bytes());
```

### 2. Calculate UserOperation Hash

Use the packed `paymaster_and_data` when calculating the hash:

```rust
let user_op_hash = calculate_userop_hash(
    &provider,
    entry_point,
    sender,
    &nonce,
    &call_data,
    final_call_gas,
    final_verif_gas,
    final_preverif_gas,
    dynamic_max_fee,
    dynamic_priority_fee,
    &paymaster_and_data,  // Use packed format here
)?;
```

### 3. Build UserOperation for API

When submitting to Candide, use the unpacked format:

```rust
let user_op = json!({
    "sender": sender,
    "nonce": nonce,
    "callData": call_data,
    // ... other fields ...
    "paymaster": "0x0578cFB241215b77442a541325d6A4E6dFE700Ec",
    "paymasterVerificationGasLimit": "0x7a120",
    "paymasterPostOpGasLimit": "0x493e0",
    "paymasterData": "0x"  // Empty for Circle
});
```

## Common Errors and Solutions

### AA33 Reverted
- **Meaning**: Paymaster validation failed
- **Common Causes**:
  - Insufficient USDC balance in TBA
  - Paymaster not approved to spend TBA's USDC
  - Incorrect paymasterAndData format in hash calculation
  - Wrong gas limits for paymaster

### Invalid UserOp signature or paymaster signature
- **Meaning**: Signature doesn't match the UserOp hash
- **Common Causes**:
  - Hash calculated with different paymaster data than what's submitted
  - Using packed format for API instead of unpacked format
  - Missing paymaster gas limits in the hash calculation

## Gas Limits

Based on successful transactions, these gas limits work well:
- **Paymaster Verification Gas**: 500,000 (0x7a120)
- **Paymaster Post-Op Gas**: 300,000 (0x493e0)
- **Call Gas Limit**: ~100,000 for simple USDC transfers
- **Verification Gas Limit**: ~200,000

## Key Takeaways

1. **Two Formats**: Always use packed format for hash, unpacked for API
2. **Gas Limits Matter**: The paymaster gas limits must be included in the hash
3. **No Extra Data**: Circle's paymaster doesn't require timestamps or signatures in paymasterData
4. **USDC Approval**: Ensure the TBA has approved the paymaster to spend USDC

## References

- [ERC-4337 Specification](https://eips.ethereum.org/EIPS/eip-4337)
- [Circle Paymaster Docs](https://developers.circle.com/stablecoins/paymaster-overview)
- [Candide v0.8 API](https://docs.candide.dev/wallet/bundler/rpc-methods/)
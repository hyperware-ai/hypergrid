# Migration Guide: MCP Operation Separation

## Overview

This document describes the refactoring that separates actual Model Context Provider (MCP) operations from regular API operations in the HPN Client.

## What Changed

### 1. Backend (Rust)

#### New Type Definitions
- **`McpRequest`**: Contains only actual MCP operations
  - `SearchRegistry`
  - `CallProvider`
  
- **`ApiRequest`**: Contains all other operations
  - Wallet management (GetWalletSummaryList, SelectWallet, etc.)
  - Call history (GetCallHistory)
  - Withdrawals (WithdrawEthFromOperatorTba, WithdrawUsdcFromOperatorTba)

- **`HttpMcpRequest`**: Kept as deprecated for backwards compatibility

#### New Endpoints
- `/api/mcp` - For actual MCP operations only
- `/shim/mcp` - For shim-authenticated MCP operations
- `/api/actions` - For all other API operations (NEW)

#### Handler Functions
- `handle_mcp()` - Now only handles `McpRequest` operations
- `handle_api_actions()` - New function for `ApiRequest` operations  
- `handle_legacy_mcp()` - Backwards compatibility for old format

### 2. Frontend (TypeScript)

#### New Utility Module
Created `src/utils/api-endpoints.ts` with:
- `callApiWithRouting()` - Automatically routes to correct endpoint based on operation
- `getEndpointForOperation()` - Determines endpoint from operation name
- Constants for `MCP_ENDPOINT` and `API_ACTIONS_ENDPOINT`

#### Component Updates
Components should use `callApiWithRouting()` instead of directly calling endpoints:

```typescript
// Old way
await callMcpApi(MCP_ENDPOINT, { SelectWallet: { wallet_id } });

// New way
import { callApiWithRouting } from '../utils/api-endpoints';
await callApiWithRouting({ SelectWallet: { wallet_id } });
```

### 3. Shim

No changes required - the shim already correctly uses `/shim/mcp` for actual MCP operations only.

## Migration Steps

### For Backend Code
1. Update imports to include new types: `McpRequest`, `ApiRequest`
2. Use appropriate type based on the operation being handled
3. Route requests to correct handler based on endpoint

### For Frontend Code
1. Import `callApiWithRouting` from `utils/api-endpoints`
2. Replace direct endpoint calls with `callApiWithRouting()`
3. Remove hardcoded `MCP_ENDPOINT` constants

## Backwards Compatibility

The old `HttpMcpRequest` format is still supported temporarily:
- Requests to `/api/mcp` with the old format will log a deprecation warning
- The system will continue to work but should be migrated

## Benefits

1. **Clarity**: Clear separation between MCP and regular operations
2. **Maintainability**: Easier to understand what each endpoint does
3. **Scalability**: Easy to add new endpoints for different operation types
4. **Type Safety**: Separate types prevent mixing concerns 
# Changelog

## [1.3.8] - 2025-01-10

### Fixed
- Function-specific endpoints now receive parameters directly, not wrapped in RPC format
- This aligns with hyperapp framework expectations for dedicated endpoints

## [1.3.7] - 2025-01-10

### Fixed
- Authorization test now correctly uses search_registry endpoint
- The authorize tool configures existing credentials, doesn't generate new ones

## [1.3.6] - 2025-01-10

### Fixed
- Restored RPC wrapper format for function-specific endpoints
- All requests now properly wrap parameters in function name object

### Changed  
- `/mcp-authorize` expects `{ "authorize": { "node": "...", "token": "..." } }`
- `/mcp-search-registry` expects `{ "search_registry": { ... } }`
- `/mcp-call-provider` expects `{ "call_provider": { ... } }`

## [1.3.0] - 2025-01-09

### Changed
- **BREAKING**: Authentication now sent in request body instead of headers for WIT compatibility
- **BREAKING**: Requests now use proper hyperapp RPC format (wrapped in `ShimAdapter`)
- Aligned with hyperapp framework's RPC pattern
- Both `/shim/mcp` and `/mcp` endpoints are supported

### Fixed
- Fixed authorization test request format to use proper RPC wrapping
- Fixed search-registry and call-provider to use correct RPC format
- Fixed response parsing to handle hyperapp Result wrapper (`{Ok: ...}` or `{Err: ...}`)

### Migration Guide
When updating from 1.2.x to 1.3.0:
1. The shim now sends requests in proper hyperapp RPC format automatically
2. Both `/shim/mcp` (legacy) and `/mcp` (new) endpoints work
3. No changes needed to your Claude Desktop configuration

### Technical Details
- Requests are now wrapped: `{ "ShimAdapter": { client_id, token, client_name, mcp_request_json } }`
- Responses are wrapped in Result type: `{ "Ok": { "json_response": "..." } }` or `{ "Err": "..." }`
- This change ensures compatibility with the hyperapp framework's RPC pattern

## [1.2.0] - Previous Release
- Initial public release with header-based authentication

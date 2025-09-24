# Local Development Guide for Hypergrid MCP Shim

This guide explains how to use the local development version of the shim instead of the npm-published version.

## Building the Local Shim

1. Navigate to the shim directory:
   ```bash
   cd hypergrid-shim
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the TypeScript code:
   ```bash
   npm run build
   ```

## Using the Local Version in Claude Desktop

Instead of using the npm package, you can point Claude to your local build:

### Option 1: Direct Path (Recommended for Development)

Update your Claude Desktop configuration file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`  
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "hyperware": {
      "command": "node",
      "args": ["/Users/hall/deve/HYPERWARE/APPS/MONO-HPN/hpn/hypergrid-shim/dist/index.js"]
    }
  }
}
```

Replace the path with the absolute path to your local `dist/index.js` file.

### Option 2: npm link (Alternative)

1. In the shim directory, create a global link:
   ```bash
   npm link
   ```

2. Then use the same configuration as the npm version:
   ```json
   {
     "mcpServers": {
       "hyperware": {
         "command": "npx",
         "args": ["@hyperware-ai/hypergrid-mcp"]
       }
     }
   }
   ```

## Key Changes in This Version

1. **New Endpoint**: The shim now uses `/mcp` instead of `/shim/mcp`
2. **Direct RPC Calls**: The shim routes directly to the operator's RPC functions
3. **Better Error Handling**: Improved error messages and authentication flow

## Testing the Local Version

After updating your Claude configuration:

1. Restart Claude Desktop
2. Test the authorization:
   ```
   Use the authorize tool with url "http://localhost:8080/operator:hypergrid:ware.hypr/mcp", token "your-token", client_id "your-client-id", and node "your-node"
   ```
   Note the new `/mcp` endpoint (not `/shim/mcp`)

3. Test searching:
   ```
   Search the registry for test providers
   ```

4. Test calling a provider:
   ```
   Call a provider you found in the search
   ```

## Debugging

If you encounter issues:

1. Check the Claude logs for error messages
2. Run the shim manually to see console output:
   ```bash
   node /path/to/hypergrid-shim/dist/index.js
   ```
3. Verify the operator is running and the `/mcp` endpoint is accessible
4. Check that your local build is up to date (`npm run build`)

## Publishing Updates

When ready to publish the updated shim to npm:

1. Update the version in `package.json`
2. Build: `npm run build`
3. Publish: `npm publish`

Remember to update any references to `/shim/mcp` in documentation to use `/mcp` instead.

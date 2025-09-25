# @hyperware-ai/hypergrid-mcp

This package provides a Model Context Protocol (MCP) server that acts as a shim to the Hypergrid operator, enabling AI assistants to discover and interact with services on the Hypergrid network.

## Features

- **Self-configuring**: Configure the MCP server directly from your AI assistant using the `authorize` tool
- **Service Discovery**: Search the Hypergrid registry for available services
- **Service Interaction**: Call providers on the Hypergrid network
- **Secure Authentication**: Uses token-based authentication with the Hypergrid operator

## Installation

Install the package globally via npm:

```bash
npm install -g @hyperware-ai/hypergrid-mcp
```

## Setup

### 1. Add to Claude Desktop

Add the following to your Claude Desktop configuration file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`  
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

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

Then restart Claude Desktop.

### 2. Configure Authentication

The MCP server needs to be authorized with your Hypergrid operator credentials. This is done directly through Claude/LM Client:

1. Generate credentials in your Hypergrid Operator UI by clicking on the 'Authorize New Client' under a hot wallet
2. Copy the authorization command provided by the UI
3. Paste it into Claude - it will look something like:
   ```
   Use the authorize tool with url "http://...", token "...", client_id "...", and node "..."
   ```
4. Claude will call the authorize tool, which saves your configuration permanently

That's it! The MCP server is now configured and will remember your credentials for future sessions.

## Available Tools

Once configured, you can use these tools in Claude:

### search-registry
Search for services in the Hypergrid registry.

Example: "Search the registry for weather services"

### call-provider
Call a specific provider with arguments.

Example: "Call the weather provider to get the forecast for New York"

### authorize
Configure or reconfigure the MCP server with Hypergrid credentials.

Example: "Use the authorize tool with url '...', token '...', client_id '...', and node '...'"

## Manual Configuration (Alternative)

If you prefer manual configuration, you can create a `grid-shim-api.json` file:

```json
{
  "url": "http://localhost:8080/operator:operator:obfusc-grid123.hypr/shim/mcp",
  "client_id": "your-client-id",
  "token": "your-token",
  "node": "your-node.hypr"
}
```

Then run with:
```bash
npx @hyperware-ai/hypergrid-mcp -c /path/to/grid-shim-api.json
```

## Configuration File Locations

The MCP server looks for configuration in these locations (in order):
1. Command line specified file (`-c` or `--configFile` option)
2. Current directory: `./grid-shim-api.json`
3. User config directory: `~/.hypergrid/configs/grid-shim-api.json`
4. User home directory: `~/.hypergrid/grid-shim-api.json`

When using the `authorize` tool, configurations are saved to `~/.hypergrid/configs/grid-shim-api.json` by default.

## Troubleshooting

- If the MCP server is not working, check Claude's logs for error messages
- Ensure your Hypergrid operator is running and accessible
- Try re-authorizing with fresh credentials from the operator UI

## License

ISC
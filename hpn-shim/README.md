# @hyperware-ai/hpn-mcp

A Model Context Protocol (MCP) shim that exposes Hyperware MCP servers to MCP clients like Claude Desktop and Cursor.

## Installation

```bash
npm install -g @hyperware-ai/hpn-mcp
```

Or use directly with npx:
```bash
npx @hyperware-ai/hpn-mcp
```

## Configuration

The shim requires a configuration file (`hpn-shim-api.json`) with the following structure:

```json
{
  "url": "http://localhost:8080/hpnclient:nodename.os/",
  "client_id": "your-unique-client-id",
  "token": "your-auth-token",
  "node": "your-node-name"
}
```

You generate this configuration file using the Hypergrid Operator UI.

## Usage

### Basic Usage
By default, the shim looks for `hpn-shim-api.json` in the current directory:

```bash
npx @hyperware-ai/hpn-mcp
```

### Specify Config File
You can specify a custom configuration file location:

```bash
npx @hyperware-ai/hpn-mcp --configFile /path/to/your/config.json
# or
npx @hyperware-ai/hpn-mcp -c /path/to/your/config.json
```

### MCP Client Configuration

#### Claude Desktop
Add to your Claude configuration:

```json
{
  "mcpServers": {
    "hyperware": {
      "command": "npx",
      "args": ["@hyperware-ai/hpn-mcp", "--configFile", "/path/to/config.json"]
    }
  }
}
```

#### Cursor
Add to your Cursor MCP configuration:

```json
{
  "mcpServers": {
    "hyperware": {
      "command": "npx",
      "args": ["@hyperware-ai/hpn-mcp"],
      "cwd": "/directory/containing/config"
    }
  }
}
```

## Available Tools

- **search-registry**: Search the Hyperware provider registry
- **call-provider**: Call a specific Hyperware provider

## License

ISC
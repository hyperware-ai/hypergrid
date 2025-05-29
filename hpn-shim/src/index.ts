#!/usr/bin/env node
import yargs from "yargs/yargs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from 'fs/promises'; // Import fs promises API
import path from 'path'; // Import path module

// --- Configuration Loading --- 
const CONFIG_FILE_NAME = 'hpn-shim-api.json';

interface ShimConfig {
    url: string;         // Base URL for the HPN client API (e.g., http://localhost:8081/hpnclient:nodename.os/api)
    token: string;       // The raw secret token for authentication
    client_id: string;   // The unique client ID for this shim instance
    node: string;        // The Kinode node name of the HPN client (for reference/logging)
}

async function loadConfig(): Promise<ShimConfig> {
    // Parse command line arguments
    const argv = await yargs(process.argv.slice(2))
        .option('configFile', {
            type: 'string',
            description: 'Path to the configuration file',
            alias: 'c'
        })
        .help()
        .argv;
    
    // Use provided config file path or default to current directory
    const configPath = argv.configFile 
        ? path.resolve(argv.configFile)
        : path.join(process.cwd(), CONFIG_FILE_NAME);
        
    console.error(`Attempting to load config from: ${configPath}`);
    try {
        const fileContent = await fs.readFile(configPath, 'utf-8');
        const parsedConfig = JSON.parse(fileContent);

        // Validate required fields
        if (typeof parsedConfig.url !== 'string' || 
            typeof parsedConfig.token !== 'string' ||    // Updated field name
            typeof parsedConfig.client_id !== 'string' || // New field
            typeof parsedConfig.node !== 'string') {
            throw new Error('Config file is missing required fields (url, token, client_id, node).');
        }
        console.error(`Config loaded successfully for node: ${parsedConfig.node}, client_id: ${parsedConfig.client_id}`);
        return parsedConfig as ShimConfig;
    } catch (error: any) {
        console.error(`\n--- ERROR LOADING SHIM CONFIGURATION ---`);
        if (error.code === 'ENOENT') {
            console.error(`Configuration file not found: ${configPath}`);
            console.error(`Please create ${CONFIG_FILE_NAME} in this directory.`);
            console.error(`You can generate the content using the HPN Client UI.`);
        } else if (error instanceof SyntaxError) {
            console.error(`Failed to parse configuration file (invalid JSON): ${configPath}`);
            console.error(error.message);
        } else {
            console.error(`Failed to read configuration file: ${configPath}`);
            console.error(error.message);
        }
        console.error(`----------------------------------------\n`);
        process.exit(1);
    }
}

// --- Main Execution --- 
async function main() {
    const config = await loadConfig();

    const server = new McpServer({
      name: `HyperwareMCP Shim (Node: ${config.node}, ClientID: ${config.client_id})`,
      version: "0.1.0",
    });

    const mcpApiEndpoint = `${config.url}shim/mcp`; // Construct the full MCP endpoint

    server.tool("search-registry", { query: z.string() }, async ({ query }) => {
      const body = { SearchRegistry: query };
      console.error(`search-registry: Forwarding to ${mcpApiEndpoint}`);
      const headers = {
        "Content-type": "application/json",
        "X-Client-ID": config.client_id, 
        "X-Token": config.token          
      };
      console.error(`search-registry: Sending Request:`);
      console.error(`  - URL: ${mcpApiEndpoint}`);
      console.error(`  - Method: POST`);
      console.error(`  - Headers: ${JSON.stringify(headers)}`);
      console.error(`  - Body: ${JSON.stringify(body)}`);
      try {
        const res = await fetch(mcpApiEndpoint, {
          method: "POST",
          headers: headers,
          body: JSON.stringify(body),
        });
        const resBody = await res.text();
        console.error(`search-registry: Response received (status ${res.status})`);
        return { content: [{ type: "text", text: String(resBody) }] };
      } catch (e: any) {
        console.error(`search-registry: Request failed: ${e.message}`);
        return {
          content: [{ type: "text", text: String(`{"error": "Request Failed to ${mcpApiEndpoint}"}`) }],
        };
      }
    });
    
    server.tool(
      "call-provider",
      {
        providerId: z.string(),
        providerName: z.string(),
        callArgs: z.array(z.tuple([z.string(), z.string()])),
      },
      async ({ providerId, providerName, callArgs }) => {
        const body = {
          CallProvider: { providerId, providerName, arguments: callArgs },
        };
        console.error(`call-provider: Forwarding to ${mcpApiEndpoint}`);
        const headers = {
          "Content-type": "application/json",
          "X-Client-ID": config.client_id, // New header
          "X-Token": config.token          // New header, renamed from X-API-Key
        };
        console.error(`call-provider: Sending Request:`);
        console.error(`  - URL: ${mcpApiEndpoint}`);
        console.error(`  - Method: POST`);
        console.error(`  - Headers: ${JSON.stringify(headers)}`);
        console.error(`  - Body: ${JSON.stringify(body)}`);
        try {
          const res = await fetch(mcpApiEndpoint, {
            method: "POST",
            headers: headers,
            body: JSON.stringify(body),
          });
          const resBody = await res.text();
          console.error(`call-provider: Response received (status ${res.status})`);
          return { content: [{ type: "text", text: String(resBody) }] };
        } catch (e: any) {
          console.error(`call-provider: Request failed: ${e.message}`);
          return {
            content: [
              { type: "text", text: String(`{"error": "Request Failed to ${mcpApiEndpoint}"}`) },
            ],
          };
        }
      },
    );

    console.error(`Connecting transport...`);
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error(`Shim connected and listening for MCP commands.`);
}

main().catch(error => {
    console.error("Unhandled error in main execution:", error);
    process.exit(1);
});

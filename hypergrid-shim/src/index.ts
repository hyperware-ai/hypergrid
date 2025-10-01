#!/usr/bin/env node
import yargs from "yargs/yargs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

// Version - update this when releasing
const SHIM_VERSION = '1.3.0';

// --- Configuration Management ---
const CONFIG_FILE_NAME = 'grid-shim-api.json';
const DEFAULT_CONFIG_DIR = path.join(os.homedir(), '.hypergrid', 'configs');

interface ShimConfig {
    url: string;
    token: string;
    client_id: string;
    node: string;
    name?: string;
}

// Global config that can be updated at runtime
let currentConfig: ShimConfig | null = null;
let configPath: string = '';

// ew?
// Helper to normalize config URLs
function normalizeConfigUrl(config: ShimConfig): ShimConfig {
    // The MCP endpoints are at the operator root level
    // Remove any path after the operator identifier pattern (operator:hypergrid:*.hypr)
    //let normalizedUrl = config.url;
    
    //// Match operator pattern and remove anything after it
    //const operatorMatch = normalizedUrl.match(/(https?:\/\/[^\/]+\/operator:[^\/]+\.hypr)/);
    //if (operatorMatch) {
    //    normalizedUrl = operatorMatch[1];
    //} else {
    //    // Fallback: remove common suffixes if operator pattern not found
    //    normalizedUrl = normalizedUrl.replace(/\/(shim|api)\/(mcp|api|mcp-.*?)$/, '');
    //    normalizedUrl = normalizedUrl.replace(/\/(mcp|api|mcp-.*?)$/, '');
    //}
    
    return { ...config, url: config.url };
}

async function loadConfig(): Promise<ShimConfig | null> {
    const argv = await yargs(process.argv.slice(2))
        .option('configFile', {
            type: 'string',
            description: 'Path to the configuration file',
            alias: 'c'
        })
        .help()
        .argv;

    // Try explicit config file first
    if (argv.configFile) {
        configPath = path.resolve(argv.configFile);
        try {
            const fileContent = await fs.readFile(configPath, 'utf-8');
            const parsedConfig = JSON.parse(fileContent) as ShimConfig;
            const normalizedConfig = normalizeConfigUrl(parsedConfig);
            console.error(`Config loaded from: ${configPath}`);
            return normalizedConfig;
        } catch (error: any) {
            console.error(`Failed to load config from ${configPath}: ${error.message}`);
        }
    }

    // Try auto-discovery locations
    const discoveryPaths = [
        path.join(process.cwd(), CONFIG_FILE_NAME),
        path.join(DEFAULT_CONFIG_DIR, CONFIG_FILE_NAME),
        path.join(os.homedir(), '.hypergrid', CONFIG_FILE_NAME),
    ];

    for (const tryPath of discoveryPaths) {
        try {
            const fileContent = await fs.readFile(tryPath, 'utf-8');
            const parsedConfig = JSON.parse(fileContent) as ShimConfig;
            const normalizedConfig = normalizeConfigUrl(parsedConfig);
            configPath = tryPath;
            console.error(`Config auto-discovered at: ${tryPath}`);
            return normalizedConfig;
        } catch (error) {
            // Continue to next path
        }
    }

    // No config found - this is OK, we'll run in unconfigured mode
    console.error(`No configuration found. Running in unconfigured mode.`);
    console.error(`Use the 'authorize' tool to configure this MCP server.`);
    return null;
}

async function saveConfig(config: ShimConfig): Promise<string> {
    // If we already have a config path from loading, update it
    if (configPath && !configPath.includes('configs')) {
        // Use existing path if it's a specific file (not in the auto-discovery dir)
        await fs.writeFile(configPath, JSON.stringify(config, null, 2));
        return configPath;
    }

    // Otherwise, save to default location
    await fs.mkdir(DEFAULT_CONFIG_DIR, { recursive: true });
    const savedPath = path.join(DEFAULT_CONFIG_DIR, CONFIG_FILE_NAME);
    await fs.writeFile(savedPath, JSON.stringify(config, null, 2));
    configPath = savedPath;
    return savedPath;
}

async function main() {
    // Try to load existing config
    currentConfig = await loadConfig();

    const server = new McpServer({
        name: currentConfig
            ? `HyperwareMCP Shim v${SHIM_VERSION} (Node: ${currentConfig.node}, ClientID: ${currentConfig.client_id})`
            : `HyperwareMCP Shim v${SHIM_VERSION} (Unconfigured)`,
        version: SHIM_VERSION,
        instructions: `This is the Hypergrid MCP shim. This shim facilitates access to the Hypergrid protocol, which allows AI agents to connect to a p2p registry of remote data-feed providers. Hypergrid should be used in a situation where you might benefit from external data that is not contained or possibly out-of-date in your training data, or would be clunky to access via web search. This shim exposes three tools: the first is "authorize", which connects the shim to the user's external Hyperware node (Hyperware is the p2p server framework that Hypergrid is built on). If the user doesn't have an external Hyperware node or seems unsure about what that means, direct them to book.hyperware.ai where they can find setup instructions for the Hypergrid Operator Client. The second tool is "search-registry" which allows you to search through all listed providers (a provider is a process running on a Hyperware node using the Hypergrid Provider Client that will return some data to you) to identify candidates for when you might use the third tool, "call-provider", which allows you to set the parameters for and make a request to a previously discovered Provider. You should be using the "search-provider" tool often, anytime you think that it might be helpful to get some targeted specific data, but only actually call a provider you find if it makes sense given your current task. The Provider registry is constantly growing, and a Provider could be many kinds of things, not just some simple data feed. Maybe it transforms some input data, maybe it does something more complex. Be liberal with your searches and decisive with your calls. The search function works based on string-matching, so think about what a Provider relevant to your task might have included in their description.`
    });

    server.tool(
        "authorize",
        {
            url: z.string().describe("The base URL for the Hypergrid API (e.g., http://localhost:8080/operator:hypergrid:ware.hypr)"),
            token: z.string().describe("The authentication token"),
            client_id: z.string().describe("The unique client ID"),
            node: z.string().describe("The Hyperware node name"),
            name: z.string().optional().describe("Your identity (e.g., 'Claude', 'GPT-4', 'Gemini Pro') - be just specific enough so that a user can identify you")
        },
        async ({ url, token, client_id, node, name }) => {
            try {
                // Use the same normalization as config loading
                const tempConfig: ShimConfig = { url, token, client_id, node };
                const normalizedConfig = normalizeConfigUrl(tempConfig);
                let normalizedUrl = normalizedConfig.url;
                
                // Call operator to authorize this client and get a client_id (PascalCase variant wrapper + tuple)
                const authorizeBody = { Authorize: [node, token, client_id, name || null] };

                console.error(`Authorizing with operator...`);
                const authorizeUrl = `${normalizedUrl}mcp-authorize`;
                const authorizeResponse = await fetch(authorizeUrl, {
                    method: "POST",
                    headers: {
                        "Content-type": "application/json"
                    },
                    body: JSON.stringify(authorizeBody),
                });

                if (!authorizeResponse.ok) {
                    throw new Error(`Authorization request failed: ${authorizeResponse.status} ${authorizeResponse.statusText}`);
                }

                const authorizeText = await authorizeResponse.text();
                let returnedClientId = client_id;
                let returnedToken = token;
                try {
                    const parsed = JSON.parse(authorizeText);
                    if (parsed.Ok) {
                        returnedClientId = parsed.Ok.client_id || returnedClientId;
                        returnedToken = parsed.Ok.token || returnedToken;
                    } else if (parsed.Err) {
                        throw new Error(`Authorize error: ${parsed.Err}`);
                    }
                } catch (e) {
                    // If parsing fails, continue with provided credentials
                }

                // Save the new config with normalized URL and returned client credentials
                const newConfig: ShimConfig = { url: normalizedUrl, token: returnedToken, client_id: returnedClientId, node, ...(name && { name }) };
                const savedPath = await saveConfig(newConfig);
                currentConfig = newConfig;

                console.error(`Configuration saved to: ${savedPath}`);

                return {
                    content: [{
                        type: "text",
                        text: `✅ Successfully authorized! Configuration saved to ${savedPath}.\n\nThe MCP server is now configured and ready to use with:\n- Node: ${node}\n- Client ID: ${returnedClientId}${name ? `\n- Name: ${name}` : ''}\n- URL: ${url}\n\nYou can now use the search-registry and call-provider tools.`
                    }]
                };
            } catch (error: any) {
                console.error(`Authorization failed: ${error.message}`);
                return {
                    content: [{
                        type: "text",
                        text: `❌ Authorization failed: ${error.message}\n\nPlease check your credentials and try again.`
                    }]
                };
            }
        }
    );

    // Search registry tool - requires configuration
    server.tool("search-registry", { query: z.string() }, async ({ query }) => {
        if (!currentConfig) {
            return {
                content: [{
                    type: "text",
                    text: "⚠️ This MCP server is not configured yet. Please use the 'authorize' tool first with your Hypergrid credentials.\n\nExample: Use the authorize tool with url \"...\", token \"...\", client_id \"...\", and node \"...\""
                }]
            };
        }

        // Use PascalCase variant wrapper + tuple to match active UI RPC style
        const rpcBody = {
            SearchRegistry: [
                query,
                currentConfig.client_id,
                currentConfig.token
            ]
        };
        
        const searchUrl = `${currentConfig.url}mcp-search-registry`;
        console.error(`search-registry: Calling ${searchUrl} with query: ${query}`);

        try {
            const res = await fetch(searchUrl, {
                method: "POST",
                headers: {
                    "Content-type": "application/json"
                },
                body: JSON.stringify(rpcBody),
            });
            const resBody = await res.text();
            console.error(`search-registry: Response received (status ${res.status})`);
            
            // Parse the hyperapp Result wrapper
            try {
                const parsed = JSON.parse(resBody);
                if (parsed.Ok) {
                    // search_registry returns Vec<ProviderSearchResult>
                    const results = parsed.Ok;
                    return { 
                        content: [{ 
                            type: "text", 
                            text: JSON.stringify({ results }, null, 2)
                        }] 
                    };
                } else if (parsed.Err) {
                    return { content: [{ type: "text", text: `Error: ${parsed.Err}` }] };
                } else {
                    return { content: [{ type: "text", text: resBody }] };
                }
            } catch {
                // If parsing fails, return raw response
                return { content: [{ type: "text", text: resBody }] };
            }
        } catch (e: any) {
            console.error(`search-registry: Request failed: ${e.message}`);
            return {
                content: [{ type: "text", text: String(`{"error": "Request Failed: ${e.message}"}`) }],
            };
        }
    });

    // Call provider tool - requires configuration
    server.tool(
        "call-provider",
        {
            providerId: z.string(),
            providerName: z.string(),
            callArgs: z.array(z.tuple([z.string(), z.string()])),
        },
        async ({ providerId, providerName, callArgs }) => {
            if (!currentConfig) {
                return {
                    content: [{
                        type: "text",
                        text: "⚠️ This MCP server is not configured yet. Please use the 'authorize' tool first with your Hypergrid credentials.\n\nExample: Use the authorize tool with url \"...\", token \"...\", client_id \"...\", and node \"...\""
                    }]
                };
            }

            // Convert call args to KeyValue format
            const args = callArgs.map(([key, value]) => ({ key, value }));
            
            // Use PascalCase variant wrapper + tuple to match active UI RPC style
            const rpcBody = {
                CallProvider: [
                    providerId,
                    providerName,
                    args,
                    currentConfig.client_id,
                    currentConfig.token
                ]
            };
            
            const callUrl = `${currentConfig.url}mcp-call-provider`;
            console.error(`call-provider: Calling ${callUrl} for provider ${providerName} (${providerId})`);

            try {
                const res = await fetch(callUrl, {
                    method: "POST",
                    headers: {
                        "Content-type": "application/json"
                    },
                    body: JSON.stringify(rpcBody),
                });
                const resBody = await res.text();
                console.error(`call-provider: Response received (status ${res.status})`);
                
                // Parse the hyperapp Result wrapper
                try {
                    const parsed = JSON.parse(resBody);
                    if (parsed.Ok) {
                        // call_provider returns a String (JSON response from provider)
                        return { content: [{ type: "text", text: parsed.Ok }] };
                    } else if (parsed.Err) {
                        return { content: [{ type: "text", text: `Error: ${parsed.Err}` }] };
                    } else {
                        return { content: [{ type: "text", text: resBody }] };
                    }
                } catch {
                    // If parsing fails, return raw response
                    return { content: [{ type: "text", text: resBody }] };
                }
            } catch (e: any) {
                console.error(`call-provider: Request failed: ${e.message}`);
                return {
                    content: [
                        { type: "text", text: String(`{"error": "Request Failed: ${e.message}"}`) },
                    ],
                };
            }
        },
    );

    console.error(`Connecting transport...`);
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error(`HyperwareMCP Shim v${SHIM_VERSION} connected and listening for MCP commands.`);

    if (!currentConfig) {
        console.error(`\n⚠️  MCP server v${SHIM_VERSION} started in UNCONFIGURED mode.`);
        console.error(`To configure, ask your LLM: "Use the authorize tool with these credentials..."`);
        console.error(`The operator UI will provide the exact command to use.\n`);
    } else {
        console.error(`\n✅ MCP server v${SHIM_VERSION} started with existing configuration.`);
        console.error(`Node: ${currentConfig.node}`);
        console.error(`Client ID: ${currentConfig.client_id}`);
        console.error(`Using base URL: ${currentConfig.url}`);
        console.error(`Endpoints: /mcp-authorize, /mcp-search-registry, /mcp-call-provider\n`);
    }
}

main().catch(error => {
    console.error("Unhandled error in main execution:", error);
    process.exit(1);
});

import React, { useState, useCallback } from 'react';
import { ConfigureAuthorizedClientResponse } from '../logic/types'; // Import from types.ts
import Modal from './modals/Modal';
import { truncate } from '../utils/truncate';
import { BsInfoCircle, BsLayers, BsSortDown, BsSortUp } from 'react-icons/bs';
import { ImSpinner8 } from 'react-icons/im';

// Helper function to generate a random API key (copied from AccountManager.tsx)
function generateApiKey(length = 32): string {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    const randomValues = new Uint32Array(length);
    window.crypto.getRandomValues(randomValues);
    for (let i = 0; i < length; i++) {
        result += characters.charAt(randomValues[i] % characters.length);
    }
    return result;
}

// Define getApiBasePath directly here (copied from AccountManager.tsx)
const getApiBasePath = () => {
    const pathParts = window.location.pathname.split('/').filter(p => p);
    const processIdPart = pathParts.find(part => part.includes(':'));
    return processIdPart ? `/${processIdPart}/api` : '/api';
};

interface ShimApiConfigModalProps {
    isOpen: boolean;
    onClose: (shouldRefresh?: boolean) => void;
    hotWalletAddress: string; // Changed from optional to required
}

const ShimApiConfigModal: React.FC<ShimApiConfigModalProps> = ({
    isOpen,
    onClose,
    hotWalletAddress // Now mandatory
}) => {
    const [apiConfig, setApiConfig] = useState<any | null>(null);
    const [isGeneratingConfig, setIsGeneratingConfig] = useState<boolean>(false);
    const [generationError, setGenerationError] = useState<string | null>(null);
    const [copiedCommand, setCopiedCommand] = useState(false);
    const [copiedMcpConfig, setCopiedMcpConfig] = useState(false);
    const [showManualInstructions, setShowManualInstructions] = useState(false);
    const [hasGeneratedCredentials, setHasGeneratedCredentials] = useState(false);

    const copyToClipboard = useCallback((text: string, setCopiedState: (value: boolean) => void) => {
        navigator.clipboard.writeText(text).then(() => {
            setCopiedState(true);
            setTimeout(() => setCopiedState(false), 2000);
        }, (err) => {
            console.error('Failed to copy: ', err);
            setGenerationError('Failed to copy to clipboard.');
        });
    }, []);

    const handleGenerateApiConfig = useCallback(() => {
        setGenerationError(null);
        setCopiedCommand(false);

        setIsGeneratingConfig(true);
        const newApiKey = generateApiKey(32);

        const payload = {
            client_name: `Shim for ${hotWalletAddress.substring(0, 6)}...${hotWalletAddress.slice(-4)}`,
            raw_token: newApiKey,
            hot_wallet_address_to_associate: hotWalletAddress
        };

        fetch(`${getApiBasePath()}/configure-authorized-client`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(payload)
        })
            .then(response => {
                if (!response.ok) {
                    return response.json().then(errData => {
                        throw new Error(errData.error || `Failed to save API key: ${response.statusText}`);
                    }).catch(() => {
                        throw new Error(`Failed to save API key: ${response.statusText}`);
                    });
                }
                return response.json() as Promise<ConfigureAuthorizedClientResponse>;
            })
            .then(responseData => {
                const configData = {
                    url: window.location.origin + window.location.pathname + 'shim/mcp',
                    client_id: responseData.client_id,
                    token: responseData.raw_token,
                    node: responseData.node_name,
                };
                console.log("configData", configData);
                setApiConfig(configData);
                setGenerationError(null);
                setHasGeneratedCredentials(true);
            })
            .catch(err => {
                console.error("Error generating API config:", err);
                setGenerationError(`Failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
                setApiConfig(null);
            })
            .finally(() => {
                setIsGeneratingConfig(false);
            });
    }, [hotWalletAddress]);

    if (!isOpen) {
        return null;
    }

    const handleClose = () => {
        onClose(hasGeneratedCredentials);
        setHasGeneratedCredentials(false);
        setApiConfig(null);
    };

    const authCommand = apiConfig ?
        `Use the authorize tool with url "${apiConfig.url}", token "${apiConfig.token}", client_id "${apiConfig.client_id}", and node "${apiConfig.node}"` : '';

    const mcpServerConfig = {
        "mcpServers": {
            "hyperware": {
                "command": "npx",
                "args": ["@hyperware-ai/hypergrid-mcp"]
            }
        }
    };

    return (
        <Modal
            title={`MCP Configuration`}
            onClose={handleClose}
            preventAccidentalClose={true}
            titleChildren={
                <div className="flex gap-2 text-xs ml-auto items-center">
                    <span className="font-bold p-2">For Hot Wallet:</span>
                    <span className="py-1 px-2 bg-dark-gray/25 rounded-lg">{truncate(hotWalletAddress, 6, 4)}</span>
                </div>
            }
        >
            <div className="grow self-stretch grid grid-cols-2 gap-12">
                <div className="p-4 bg-white rounded-lg flex flex-col gap-2 self-start">
                    <h4 className="text-lg font-bold">Step 1: Add the MCP Server to Claude</h4>
                    <p className="text-sm">
                        Add this to your Claude Desktop config:
                    </p>
                    <div className="relative">
                        <pre className="bg-dark-gray text-white p-4 rounded-lg overflow-x-auto">
                            {JSON.stringify(mcpServerConfig, null, 2)}
                        </pre>
                        <button
                            onClick={() => copyToClipboard(JSON.stringify(mcpServerConfig, null, 2), setCopiedMcpConfig)}
                            className="absolute top-2 right-2 px-2 py-1 text-sm bg-gray-700 text-white rounded-md cursor-pointer"
                        >
                            {copiedMcpConfig ? '✓' : 'Copy'}
                        </button>
                    </div>
                    <p className="text-sm bg-cyan p-2 rounded-full flex items-center gap-2 self-start">
                        <BsInfoCircle />
                        <span>Then restart Claude Desktop.</span>
                    </p>
                </div>

                {/* Step 2: Generate Credentials */}
                <div className="flex flex-col gap-2">
                    <div className="p-4 bg-white rounded-lg flex flex-col gap-2">
                        <h4 className="text-lg font-bold">Step 2: Generate Authorization Credentials</h4>
                        <p className="text-sm">
                            Each generation creates a new authorized client for this hot wallet.
                            This allows multiple MCP servers or environments to use the same wallet.
                        </p>
                        <button
                            onClick={handleGenerateApiConfig}
                            disabled={isGeneratingConfig}
                            className="self-start bg-dark-gray/5 font-bold py-2 px-4  hover:bg-dark-gray/10"
                        >
                            {isGeneratingConfig ? <ImSpinner8 className="animate-spin" /> : <BsLayers />}
                            {isGeneratingConfig ? 'Generating...' :
                                (apiConfig ? 'Generate New Credentials' : 'Generate Credentials')}
                        </button>
                        {generationError && (
                            <p className="text-red-500">{generationError}</p>
                        )}
                    </div>

                    {/* Step 3: Authorize in Claude */}
                    {apiConfig && (
                        <div className="p-4 bg-white rounded-lg flex flex-col gap-2">
                            <h4 className="text-lg font-bold">Step 3: Authorize in Claude</h4>
                            <p className="text-sm">
                                Copy this command and paste it into Claude:
                            </p>
                            <div className="relative">
                                <pre className="bg-dark-gray text-white p-4 rounded-lg overflow-x-auto">
                                    {authCommand}
                                </pre>
                                <button
                                    onClick={() => copyToClipboard(authCommand, setCopiedCommand)}
                                    className="absolute top-2 right-2 px-2 py-1 text-sm bg-gray-700 text-white rounded-md cursor-pointer"
                                >
                                    {copiedCommand ? '✓' : 'Copy'}
                                </button>
                            </div>
                            <p className="text-sm">
                                This will permanently configure the MCP server with your credentials.
                            </p>
                        </div>
                    )}

                    {/* That's it! */}
                    {apiConfig && <>
                        <div className="p-4 bg-white rounded-lg flex flex-col gap-2">
                            <p className="text-sm">
                                <strong>That's it!</strong> Once you run the authorize command in Claude,
                                you can use these tools:
                            </p>
                            <div className="flex flex-col gap-2">
                                <div className="flex items-center gap-2">
                                    <code className="bg-dark-gray text-white p-2 rounded-lg">search-registry</code>
                                    <span className="text-sm">
                                        Search for services in the Hypergrid network
                                    </span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <code className="bg-dark-gray text-white p-2 rounded-lg">call-provider</code>
                                    <span className="text-sm">
                                        Call a provider with specific arguments
                                    </span>
                                </div>
                            </div>
                        </div>
                        <div className="flex flex-col gap-2">
                            <button
                                onClick={() => setShowManualInstructions(!showManualInstructions)}
                                className="self-start bg-dark-gray/5 py-2 px-4  hover:bg-dark-gray/10"
                            >
                                {showManualInstructions ? <BsSortUp className="text-lg" /> : <BsSortDown className="text-lg" />}

                                <span>{showManualInstructions ? 'Hide' : 'Show'} manual setup option</span>
                            </button>

                            {showManualInstructions && (
                                <div className="p-4 bg-white rounded-lg flex flex-col gap-2">
                                    <p>Alternative: Save this as <code className="bg-dark-gray text-white p-2 rounded-lg">grid-shim-api.json</code>:</p>
                                    <div className="relative">
                                        <pre className="bg-dark-gray text-white p-4 rounded-lg overflow-x-auto">
                                            {JSON.stringify(apiConfig, null, 2)}
                                        </pre>
                                        <button
                                            onClick={() => copyToClipboard(JSON.stringify(apiConfig, null, 2), setCopiedCommand)}
                                            className="absolute top-2 right-2 px-2 py-1 text-sm bg-gray-700 text-white rounded-md cursor-pointer"
                                        >
                                            {copiedCommand ? '✓' : 'Copy'}
                                        </button>
                                    </div>
                                    <p>Then use: <code className="bg-dark-gray text-white p-2 rounded-lg">npx @hyperware-ai/hypergrid-mcp -c grid-shim-api.json</code></p>
                                </div>
                            )}

                        </div>
                    </>}

                </div>

            </div>

        </Modal>
    );
};

export default ShimApiConfigModal; 

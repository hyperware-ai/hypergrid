import React, { useState, useCallback } from 'react';
import { ConfigureAuthorizedClientResponse } from '../logic/types'; // Import from types.ts

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
            client_name: `Shim for ${hotWalletAddress.substring(0,6)}...${hotWalletAddress.slice(-4)}`,
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
                url: window.location.origin + window.location.pathname + '/shim/mcp',
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

    const modalStyle: React.CSSProperties = {
        position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
        backgroundColor: 'rgba(0, 0, 0, 0.6)', display: 'flex',
        alignItems: 'center', justifyContent: 'center', zIndex: 1010,
    };
    const contentStyle: React.CSSProperties = {
        backgroundColor: '#2c3038', color: 'white', padding: '25px',
        borderRadius: '8px', width: '90%', maxWidth: '700px',
        maxHeight: '85vh', overflowY: 'auto', position: 'relative',
        border: '1px solid #555',
    };
    const closeButtonStyle: React.CSSProperties = {
        position: 'absolute', top: '10px', right: '15px', background: 'transparent',
        border: 'none', color: 'white', fontSize: '1.8rem', cursor: 'pointer',
    };

    return (
        <div style={modalStyle} onClick={handleClose}>
            <div style={contentStyle} onClick={(e) => e.stopPropagation()}>
                <button style={closeButtonStyle} onClick={handleClose}>&times;</button>
                
                <h3>Hypergrid MCP Configuration</h3>
                <p style={{ fontSize: '0.9em', color: '#ddd', marginBottom: '20px' }}>
                    For Hot Wallet: <code>{hotWalletAddress.substring(0,6)}...{hotWalletAddress.slice(-4)}</code>
                </p>

                {/* Step 1: Add MCP Server */}
                <div style={{ marginBottom: '25px', padding: '15px', backgroundColor: '#22252a', borderRadius: '6px' }}>
                    <h4 style={{ margin: '0 0 10px 0' }}>Step 1: Add the MCP Server to Claude</h4>
                    <p style={{ fontSize: '0.9em', marginBottom: '10px' }}>
                        Add this to your Claude Desktop config:
                    </p>
                    <div style={{ position: 'relative' }}>
                        <pre style={{ 
                            background: '#1a1c20', 
                            padding: '10px 35px 10px 10px', 
                            borderRadius: '4px', 
                            overflowX: 'auto',
                            fontSize: '0.85em'
                        }}>
{JSON.stringify(mcpServerConfig, null, 2)}
                        </pre>
                        <button
                            onClick={() => copyToClipboard(JSON.stringify(mcpServerConfig, null, 2), setCopiedMcpConfig)}
                            style={{
                                position: 'absolute',
                                top: '5px',
                                right: '5px',
                                padding: '5px 10px',
                                fontSize: '0.8em',
                                background: '#3a3d42',
                                border: 'none',
                                borderRadius: '3px',
                                color: 'white',
                                cursor: 'pointer'
                            }}
                        >
                            {copiedMcpConfig ? '✓' : 'Copy'}
                        </button>
                    </div>
                    <p style={{ fontSize: '0.8em', color: '#999', marginTop: '8px' }}>
                        Then restart Claude Desktop.
                    </p>
                </div>

                {/* Step 2: Generate Credentials */}
                <div style={{ marginBottom: '25px', padding: '15px', backgroundColor: '#22252a', borderRadius: '6px' }}>
                    <h4 style={{ margin: '0 0 10px 0' }}>Step 2: Generate Authorization Credentials</h4>
                    <p style={{ fontSize: '0.85em', color: '#999', marginBottom: '10px' }}>
                        Each generation creates a new authorized client for this hot wallet. 
                        This allows multiple MCP servers or environments to use the same wallet.
                    </p>
                    <button
                        onClick={handleGenerateApiConfig}
                        disabled={isGeneratingConfig}
                        className="button secondary-button"
                        style={{ padding: '10px 15px', fontSize: '1em', marginBottom: '10px' }}
                    >
                        {isGeneratingConfig ? 'Generating...' : 
                         (apiConfig ? 'Generate New Credentials' : 'Generate Credentials')}
                    </button>
                    {generationError && (
                        <p style={{ marginTop: '10px', color: '#ff8a8a' }}>{generationError}</p>
                    )}
                </div>

                {/* Step 3: Authorize in Claude */}
                {apiConfig && (
                    <div style={{ marginBottom: '25px', padding: '15px', backgroundColor: '#22252a', borderRadius: '6px' }}>
                        <h4 style={{ margin: '0 0 10px 0' }}>Step 3: Authorize in Claude</h4>
                        <p style={{ fontSize: '0.9em', marginBottom: '10px' }}>
                            Copy this command and paste it into Claude:
                        </p>
                        <div style={{ position: 'relative' }}>
                            <pre style={{ 
                                background: '#1a1c20', 
                                padding: '10px 35px 10px 10px', 
                                borderRadius: '4px', 
                                overflowX: 'auto',
                                fontSize: '0.85em',
                                wordBreak: 'break-word',
                                whiteSpace: 'pre-wrap'
                            }}>
                                {authCommand}
                            </pre>
                            <button
                                onClick={() => copyToClipboard(authCommand, setCopiedCommand)}
                                style={{
                                    position: 'absolute',
                                    top: '5px',
                                    right: '5px',
                                    padding: '5px 10px',
                                    fontSize: '0.8em',
                                    background: '#3a3d42',
                                    border: 'none',
                                    borderRadius: '3px',
                                    color: 'white',
                                    cursor: 'pointer'
                                }}
                            >
                                {copiedCommand ? '✓' : 'Copy'}
                            </button>
                        </div>
                        <p style={{ fontSize: '0.8em', color: '#999', marginTop: '8px' }}>
                            This will permanently configure the MCP server with your credentials.
                        </p>
                    </div>
                )}

                {/* That's it! */}
                {apiConfig && (
                    <div style={{ 
                        padding: '15px', 
                        backgroundColor: '#1e3a1e', 
                        borderRadius: '6px',
                        border: '1px solid #2e5a2e'
                    }}>
                        <p style={{ margin: '0 0 15px 0', fontSize: '0.9em' }}>
                            <strong>That's it!</strong> Once you run the authorize command in Claude, 
                            you can use these tools:
                        </p>
                        <div style={{ fontSize: '0.85em', marginLeft: '20px' }}>
                            <div style={{ marginBottom: '8px' }}>
                                <code style={{ background: '#2a3d2a', padding: '2px 6px', borderRadius: '3px' }}>search-registry</code>
                                <span style={{ color: '#bbb', marginLeft: '8px' }}>
                                    Search for services in the Hypergrid network
                                </span>
                            </div>
                            <div>
                                <code style={{ background: '#2a3d2a', padding: '2px 6px', borderRadius: '3px' }}>call-provider</code>
                                <span style={{ color: '#bbb', marginLeft: '8px' }}>
                                    Call a provider with specific arguments
                                </span>
                            </div>
                        </div>
                    </div>
                )}

                {/* Manual Setup Option */}
                <div style={{ marginTop: '20px', fontSize: '0.8em' }}>
                    <button
                        onClick={() => setShowManualInstructions(!showManualInstructions)}
                        style={{
                            background: 'none',
                            border: 'none',
                            color: '#888',
                            cursor: 'pointer',
                            textDecoration: 'underline'
                        }}
                    >
                        {showManualInstructions ? 'Hide' : 'Show'} manual setup option
                    </button>
                    
                    {showManualInstructions && apiConfig && (
                        <div style={{ marginTop: '10px', padding: '10px', background: '#1a1c20', borderRadius: '4px' }}>
                            <p>Alternative: Save this as <code>grid-shim-api.json</code>:</p>
                            <pre style={{ fontSize: '0.8em', overflowX: 'auto' }}>
                                {JSON.stringify(apiConfig, null, 2)}
                            </pre>
                            <p>Then use: <code>npx @hyperware-ai/hypergrid-mcp -c grid-shim-api.json</code></p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ShimApiConfigModal; 
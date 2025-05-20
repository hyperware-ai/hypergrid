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
    onClose: () => void;
    hotWalletAddress: string; // Changed from optional to required
}

const ShimApiConfigModal: React.FC<ShimApiConfigModalProps> = ({
    isOpen,
    onClose,
    hotWalletAddress // Now mandatory
}) => {
    const [apiConfigJson, setApiConfigJson] = useState<string | null>(null);
    const [isGeneratingConfig, setIsGeneratingConfig] = useState<boolean>(false);
    const [generationError, setGenerationError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    const copyToClipboard = useCallback((text: string) => {
        navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }, (err) => {
            console.error('Failed to copy: ', err);
            setGenerationError('Failed to copy to clipboard.');
        });
    }, []);

    const handleGenerateApiConfig = useCallback(() => {
        setGenerationError(null);
        setCopied(false);

        if (apiConfigJson && !isGeneratingConfig) {
            copyToClipboard(apiConfigJson);
            return;
        }

        setIsGeneratingConfig(true);
        const newApiKey = generateApiKey(32);

        const payload = {
            client_name: `Shim for ${hotWalletAddress.substring(0,6)}...${hotWalletAddress.slice(-4)}`, // Example default name
            raw_token: newApiKey,
            hot_wallet_address_to_associate: hotWalletAddress
        };

        fetch(`${getApiBasePath()}/configure-authorized-client`, { // Endpoint updated
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(payload) // Payload updated
        })
        .then(response => {
            if (!response.ok) {
                return response.json().then(errData => {
                    throw new Error(errData.error || `Failed to save API key: ${response.statusText}`);
                }).catch(() => {
                    throw new Error(`Failed to save API key: ${response.statusText}`);
                });
            }
            return response.json() as Promise<ConfigureAuthorizedClientResponse>; // Expecting new response structure
        })
        .then(responseData => {
            const configData = {
                url: window.location.origin + window.location.pathname,
                client_id: responseData.client_id,
                token: responseData.raw_token, // Use the token from backend response
                node: responseData.node_name, 
            };
            console.log("configData", configData);
            const jsonStringToCopy = JSON.stringify(configData, null, 2);

            setApiConfigJson(jsonStringToCopy);
            copyToClipboard(jsonStringToCopy);
            setGenerationError(null);
        })
        .catch(err => {
            console.error("Error generating API config:", err);
            setGenerationError(`Failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
            setApiConfigJson(null);
        })
        .finally(() => {
            setIsGeneratingConfig(false);
        });
    }, [apiConfigJson, copyToClipboard, isGeneratingConfig, hotWalletAddress]); // Added hotWalletAddress to dependencies

    if (!isOpen) {
        return null;
    }

    const modalStyle: React.CSSProperties = {
        position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
        backgroundColor: 'rgba(0, 0, 0, 0.6)', display: 'flex',
        alignItems: 'center', justifyContent: 'center', zIndex: 1010,
    };
    const contentStyle: React.CSSProperties = {
        backgroundColor: '#2c3038', color: 'white', padding: '25px',
        borderRadius: '8px', width: '90%', maxWidth: '600px',
        maxHeight: '80vh', overflowY: 'auto', position: 'relative',
        border: '1px solid #555',
    };
    const closeButtonStyle: React.CSSProperties = {
        position: 'absolute', top: '10px', right: '15px', background: 'transparent',
        border: 'none', color: 'white', fontSize: '1.8rem', cursor: 'pointer',
    };

    return (
        <div style={modalStyle} onClick={onClose}>
            <div style={contentStyle} onClick={(e) => e.stopPropagation()}>
                <button style={closeButtonStyle} onClick={onClose}>&times;</button>
                <div className="config-form api-config-section">
                    <h4>Shim API Configuration for Hot Wallet: {hotWalletAddress.substring(0,6)}...{hotWalletAddress.slice(-4)}</h4>
                    <p style={{ fontSize: '0.9em', color: '#ccc', marginBottom: '15px' }}>
                        Generate and copy an API key configuration for use with the HPN MCP Shim.
                        Save this configuration as <code>hpn-shim-api.json</code> in the directory where you run the shim.
                        Generating a new config for this session will overwrite any previous one shown here.
                    </p>
                    <button
                        onClick={handleGenerateApiConfig}
                        disabled={isGeneratingConfig}
                        className="button secondary-button" // Class for styling consistency
                        style={{padding: '10px 15px', fontSize: '1em', marginBottom: '10px'}}
                    >
                        {isGeneratingConfig ? 'Generating...' : 
                         (copied ? '✅ Copied!' : 
                          (apiConfigJson ? 'Copy Existing Config' : 'Generate & Copy Config'))}
                    </button>
                    {generationError && <p className="error-message" style={{marginTop: '10px', color: '#ff8a8a'}}>{generationError}</p>}
                    {apiConfigJson && !generationError && (
                        <div style={{marginTop: '15px', background: '#22252a', padding: '10px', borderRadius: '4px'}}>
                            <p>Save the following as <code>hpn-shim-api.json</code>:</p>
                            <pre style={{whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: '200px', overflowY: 'auto', background: '#1a1c20', padding: '8px', borderRadius: '3px'}}>
                                {apiConfigJson}
                            </pre>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ShimApiConfigModal; 
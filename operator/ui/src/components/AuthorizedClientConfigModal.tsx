import React, { useState } from 'react';

interface AuthorizedClientConfigModalProps {
    isOpen: boolean;
    onClose: (shouldRefresh?: boolean) => void;
    clientId: string;
    clientName: string;
    hotWalletAddress: string;
}

// Helper function to generate a random API key
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

const getApiBasePath = () => {
    const pathParts = window.location.pathname.split('/').filter(p => p);
    const processIdPart = pathParts.find(part => part.includes(':'));
    return processIdPart ? `/${processIdPart}/api` : '/api';
};

const AuthorizedClientConfigModal: React.FC<AuthorizedClientConfigModalProps> = ({
    isOpen,
    onClose,
    clientId,
    clientName,
    hotWalletAddress
}) => {
    const [isRegenerating, setIsRegenerating] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [newToken, setNewToken] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [copiedCommand, setCopiedCommand] = useState(false);
    const [hasChanges, setHasChanges] = useState(false);
    
    if (!isOpen) {
        return null;
    }

    const handleClose = () => {
        onClose(hasChanges);
        // Reset state for next time
        setHasChanges(false);
        setNewToken(null);
        setError(null);
        setConfirmDelete(false);
    };

    const handleRegenerateToken = async () => {
        setIsRegenerating(true);
        setError(null);
        setNewToken(null);
        
        const newApiKey = generateApiKey(32);
        
        try {
            const response = await fetch(`${getApiBasePath()}/configure-authorized-client`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    client_id: clientId,
                    raw_token: newApiKey,
                    hot_wallet_address_to_associate: hotWalletAddress
                })
            });
            
            if (!response.ok) {
                throw new Error(`Failed to regenerate token: ${response.statusText}`);
            }
            
            const responseData = await response.json();
            setNewToken(responseData.raw_token);
            setHasChanges(true); // Mark that changes were made
        } catch (err) {
            setError(`Failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
        } finally {
            setIsRegenerating(false);
        }
    };
    
    const handleDeleteClient = async () => {
        if (!confirmDelete) {
            setConfirmDelete(true);
            return;
        }
        
        setIsDeleting(true);
        setError(null);
        
        try {
            const response = await fetch(`${getApiBasePath()}/actions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    DeleteAuthorizedClient: { client_id: clientId }
                })
            });
            
            if (!response.ok) {
                throw new Error(`Failed to delete client: ${response.statusText}`);
            }
            
            // Close modal with refresh flag
            onClose(true);
        } catch (err) {
            setError(`Failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
            setConfirmDelete(false);
        } finally {
            setIsDeleting(false);
        }
    };

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text).then(() => {
            setCopiedCommand(true);
            setTimeout(() => setCopiedCommand(false), 2000);
        }, (err) => {
            console.error('Failed to copy: ', err);
            setError('Failed to copy to clipboard.');
        });
    };

    const authCommand = newToken ? 
        `Use the authorize tool with url "${window.location.origin + window.location.pathname + '/shim/mcp'}", token "${newToken}", client_id "${clientId}", and node "${window.location.hostname}"` : '';

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
                
                <h3>Client Configuration</h3>
                <p style={{ fontSize: '0.9em', color: '#ddd', marginBottom: '20px' }}>
                    {clientName} • Client ID: <code>{clientId.substring(0,16)}...</code>
                </p>

                {/* Current Status */}
                <div style={{ marginBottom: '25px', padding: '15px', backgroundColor: '#22252a', borderRadius: '6px' }}>
                    <h4 style={{ margin: '0 0 10px 0' }}>Current Configuration</h4>
                    <div style={{ fontSize: '0.85em', color: '#999' }}>
                        <div style={{ marginBottom: '5px' }}>
                            Client Name: <strong style={{ color: '#ddd' }}>{clientName}</strong>
                        </div>
                        <div style={{ marginBottom: '5px' }}>
                            Hot Wallet: <code>{hotWalletAddress.substring(0,6)}...{hotWalletAddress.slice(-4)}</code>
                        </div>
                        <div>
                            Status: <span style={{ color: '#4ade80' }}>Active</span>
                        </div>
                    </div>
                </div>

                {/* Regenerate Token Section */}
                {newToken && (
                    <div style={{ marginBottom: '25px', padding: '15px', backgroundColor: '#22252a', borderRadius: '6px' }}>
                        <h4 style={{ margin: '0 0 10px 0' }}>New Authorization Command</h4>
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
                                onClick={() => copyToClipboard(authCommand)}
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
                            This will update the existing client with a new token.
                        </p>
                    </div>
                )}

                {/* Success Message */}
                {newToken && (
                    <div style={{ 
                        padding: '15px', 
                        backgroundColor: '#1e3a1e', 
                        borderRadius: '6px',
                        border: '1px solid #2e5a2e',
                        marginBottom: '25px'
                    }}>
                        <p style={{ margin: 0, fontSize: '0.9em' }}>
                            <strong>Token regenerated!</strong> The old token is now invalid. 
                            Use the command above to update your MCP server.
                        </p>
                    </div>
                )}

                {/* Error Message */}
                {error && (
                    <div style={{ 
                        padding: '15px', 
                        backgroundColor: '#3a1a1a', 
                        borderRadius: '6px',
                        border: '1px solid #5a2a2a',
                        marginBottom: '25px'
                    }}>
                        <p style={{ margin: 0, fontSize: '0.9em', color: '#ff8a8a' }}>
                            {error}
                        </p>
                    </div>
                )}

                {/* Action Buttons */}
                <div style={{ display: 'flex', gap: '10px' }}>
                    <button
                        onClick={handleRegenerateToken}
                        disabled={isRegenerating || isDeleting}
                        className="button secondary-button"
                        style={{ 
                            padding: '10px 15px', 
                            fontSize: '1em',
                            opacity: isRegenerating || isDeleting ? 0.6 : 1,
                            cursor: isRegenerating || isDeleting ? 'not-allowed' : 'pointer'
                        }}
                    >
                        {isRegenerating ? 'Regenerating...' : 'Regenerate Token'}
                    </button>
                    
                    <button
                        onClick={handleDeleteClient}
                        disabled={isRegenerating || isDeleting}
                        style={{
                            padding: '10px 15px',
                            fontSize: '1em',
                            backgroundColor: confirmDelete ? '#dc2626' : '#4a3a3a',
                            border: 'none',
                            borderRadius: '4px',
                            color: 'white',
                            cursor: isRegenerating || isDeleting ? 'not-allowed' : 'pointer',
                            opacity: isRegenerating || isDeleting ? 0.6 : 1
                        }}
                    >
                        {isDeleting ? 'Deleting...' : (confirmDelete ? 'Click Again to Confirm' : 'Delete Client')}
                    </button>
                </div>

                {/* Footer Note */}
                <p style={{ 
                    marginTop: '20px',
                    fontSize: '0.8em', 
                    color: '#999' 
                }}>
                    Multiple clients can use the same hot wallet for different environments.
                </p>
            </div>
        </div>
    );
};

export default AuthorizedClientConfigModal; 

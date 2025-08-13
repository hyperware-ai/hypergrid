import React, { useState, useEffect, useRef } from 'react';
import classNames from 'classnames';
import Modal from './modals/Modal';
import { useErrorLogStore } from '../store/errorLog';
import { truncate } from '../utils/truncate';

interface AuthorizedClientConfigModalProps {
    isOpen: boolean;
    onClose: (shouldRefresh?: boolean) => void;
    clientId: string;
    clientName: string;
    hotWalletAddress: string;
    onClientUpdate: (clientId: string) => void;
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
    hotWalletAddress,
    onClientUpdate
}) => {
    const { showToast } = useErrorLogStore();
    const [isRegenerating, setIsRegenerating] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [newToken, setNewToken] = useState<string | null>(null);
    const [nodeName, setNodeName] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [copiedCommand, setCopiedCommand] = useState(false);
    const [hasChanges, setHasChanges] = useState(false);

    // Name editing state
    const [editedName, setEditedName] = useState<string>(clientName);
    const [isEditingName, setIsEditingName] = useState<boolean>(false);
    const [currentName, setCurrentName] = useState<string>(clientName);
    const nameInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (clientName) {
            setCurrentName(clientName);
            setEditedName(clientName);
            setIsEditingName(false);
        }
    }, [clientName]);

    // Focus input when isEditingName becomes true
    useEffect(() => {
        if (isEditingName && nameInputRef.current) {
            nameInputRef.current.focus();
            nameInputRef.current.select();
        }
    }, [isEditingName]);

    if (!isOpen) {
        return null;
    }

    const handleClose = () => {
        onClose(hasChanges);
        // Reset state for next time
        setHasChanges(false);
        setNewToken(null);
        setNodeName(null);
        setError(null);
        setConfirmDelete(false);
        setIsEditingName(false);
        setEditedName(currentName);
    };

    // Name editing handlers
    const handleRenameClient = async () => {
        if (!editedName.trim() || editedName.trim() === currentName) {
            setIsEditingName(false);
            setEditedName(currentName);
            return;
        }

        try {
            const response = await fetch(`${getApiBasePath()}/actions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    RenameAuthorizedClient: {
                        client_id: clientId,
                        new_name: editedName.trim()
                    }
                })
            });

            if (!response.ok) {
                throw new Error(`Failed to rename client: ${response.statusText}`);
            }

            showToast('success', `Client renamed to "${editedName.trim()}".`);
            setCurrentName(editedName.trim());
            setIsEditingName(false);
            setHasChanges(true);
            onClientUpdate(clientId);
        } catch (err: any) {
            showToast('error', err.message || 'Failed to rename client.');
            setEditedName(currentName);
            setIsEditingName(false);
        }
    };

    const handleNameInputBlur = () => {
        if (editedName.trim() !== currentName && editedName.trim() !== '') {
            handleRenameClient();
        } else {
            setEditedName(currentName);
            setIsEditingName(false);
        }
    };

    const handleNameInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            handleRenameClient();
        }
        if (event.key === 'Escape') {
            setEditedName(currentName);
            setIsEditingName(false);
        }
    };


    const handleRegenerateToken = async () => {
        setIsRegenerating(true);
        setError(null);
        setNewToken(null);
        setNodeName(null);

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
            setNodeName(responseData.node_name);
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

    const authCommand = newToken && nodeName ?
        `Use the authorize tool with url "${window.location.origin + window.location.pathname + 'shim/mcp'}", token "${newToken}", client_id "${clientId}", and node "${nodeName}"` : '';

    return (
        <Modal
            title={`Authorized Client Settings`}
            onClose={handleClose}
            preventAccidentalClose={true}
        >
            <h4 className="font-bold">Client Name</h4>
            <input
                ref={nameInputRef}
                type="text"
                value={editedName}
                readOnly={!isEditingName}
                onChange={(e) => setEditedName(e.target.value)}
                onBlur={handleNameInputBlur}
                onKeyDown={handleNameInputKeyDown}
                onClick={(e) => { e.stopPropagation(); setIsEditingName(true); }}
                className={classNames("p-2 rounded bg-dark-gray/5", {
                    "border border-black": isEditingName,
                })}
                disabled={isRegenerating || isDeleting}
            />

            <h4 className="font-bold">Client Information</h4>
            <div className="space-y-2">
                <div>Client ID: <code>{truncate(clientId, 16, 8)}</code></div>
                <div>Hot Wallet: <code>{truncate(hotWalletAddress, 16, 8)}</code></div>
                <div>Status: <span className="text-green-400">Active</span></div>
            </div>



            {newToken && <>
                <h4 className="font-bold">New Authorization Command</h4>
                <p className="text-sm opacity-50">
                    Copy this command and paste it into Claude:
                </p>
                <div className="relative">
                    <pre className="p-2 rounded bg-dark-gray/5 text-sm overflow-x-auto break-words whitespace-pre-wrap">
                        {authCommand}
                    </pre>
                    <button
                        onClick={() => copyToClipboard(authCommand)}
                        className="absolute top-2 right-2 px-2 py-1 text-xs bg-black text-white rounded hover:bg-gray-800"
                    >
                        {copiedCommand ? '✓' : 'Copy'}
                    </button>
                </div>
                <p className="text-xs opacity-50">
                    This will update the existing client with a new token.
                </p>
            </>}

            {newToken && (
                <div className="p-2 rounded bg-green-600/20">
                    <p className="text-sm">
                        <strong>Token regenerated!</strong> The old token is now invalid.
                        Use the command above to update your MCP server.
                    </p>
                </div>
            )}

            {error && (
                <div className="p-2 rounded bg-red-600/20">
                    <p className="text-sm text-red-300">
                        {error}
                    </p>
                </div>
            )}

            <h4 className="font-bold">Actions</h4>
            <div className="flex gap-2">
                <button
                    onClick={handleRegenerateToken}
                    disabled={isRegenerating || isDeleting}
                    className="p-2 rounded bg-green-600 text-white hover:bg-green-700 grow "
                >
                    {isRegenerating ? 'Regenerating...' : 'Regenerate Token'}
                </button>

                <button
                    onClick={handleDeleteClient}
                    disabled={isRegenerating || isDeleting}
                    className={`p-2 rounded  grow text-white ${confirmDelete
                        ? 'bg-red-600 hover:bg-red-700'
                        : 'bg-gray-600 hover:bg-gray-700'
                        }`}
                >
                    {isDeleting ? 'Deleting...' : (confirmDelete ? 'Click Again to Confirm' : 'Delete Client')}
                </button>
            </div>

            <p className="text-xs opacity-50">
                Multiple clients can use the same hot wallet for different environments.
            </p>
        </Modal>
    );
};

export default AuthorizedClientConfigModal; 

import React, { useState, useEffect, useCallback } from 'react';
import { Address } from 'viem';
import { useSetOperatorNote } from '../logic/hypermapHelpers';

// API Base Path Helper
const getApiBasePath = () => {
    const pathParts = window.location.pathname.split('/').filter(p => p);
    const processIdPart = pathParts.find(part => part.includes(':'));
    return processIdPart ? `/${processIdPart}/api` : '/api';
};
const API_BASE_URL = getApiBasePath();
const MANAGED_WALLETS_ENDPOINT = `${API_BASE_URL}/managed-wallets`;
const MCP_ENDPOINT = `${API_BASE_URL}/mcp`;

interface ManagedWalletSummaryFromApi {
    id: string;
    name: string | null;
    address: string;
    is_active: boolean;
    is_locked: boolean;
    is_selected: boolean;
    balance_eth: string;
    balance_usdc: string;
}

interface ManagedWalletSummary {
    id: string;
    name: string | null;
    address: Address;
    isActive: boolean;
}

interface LinkHotWalletsInlineProps {
    operatorTbaAddress: Address | null;
    operatorEntryName: string | null;
    currentLinkedWallets?: Address[]; // Currently linked wallet addresses
    onWalletsLinked: () => void;
}

const LinkHotWalletsInline: React.FC<LinkHotWalletsInlineProps> = ({
    operatorTbaAddress,
    operatorEntryName,
    currentLinkedWallets = [],
    onWalletsLinked,
}) => {
    const [managedWallets, setManagedWallets] = useState<ManagedWalletSummary[]>([]);
    const [selectedWallets, setSelectedWallets] = useState<Set<Address>>(new Set());
    const [isLoadingWallets, setIsLoadingWallets] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    
    // Wallet creation states
    const [showImportForm, setShowImportForm] = useState<boolean>(false);
    const [privateKeyToImport, setPrivateKeyToImport] = useState<string>('');
    const [passwordForImport, setPasswordForImport] = useState<string>('');
    const [walletNameToImport, setWalletNameToImport] = useState<string>('');
    const [isCreatingWallet, setIsCreatingWallet] = useState<boolean>(false);

    const {
        setSignersNote,
        transactionHash,
        isSending,
        isConfirming,
        isConfirmed,
        error: signersNoteError,
        reset: resetSignersNote,
    } = useSetOperatorNote({
        onSuccess: (data) => {
            console.log("Successfully set/updated signers note (transaction sent), tx:", data);
        },
        onError: (err) => {
            console.error("Error setting/updating signers note:", err);
            setError(`Failed to update signers: ${err.message}`);
        },
    });

    // Effect to synchronize selectedWallets with currentLinkedWallets prop
    useEffect(() => {
        // Create a new set from currentLinkedWallets to ensure it reflects the prop accurately
        const newSelectedWallets = new Set(currentLinkedWallets);
        // Only update state if the content has actually changed to avoid potential loops
        if (newSelectedWallets.size !== selectedWallets.size || 
            ![...newSelectedWallets].every(addr => selectedWallets.has(addr))) {
            setSelectedWallets(newSelectedWallets);
        }
    }, [currentLinkedWallets]); // Rerun when currentLinkedWallets changes

    // Effect to refresh graph data once the transaction is confirmed
    useEffect(() => {
        if (isConfirmed && transactionHash) {
            console.log("Signers note transaction confirmed. Refreshing wallets/graph. Tx:", transactionHash);
            onWalletsLinked();
        }
    }, [isConfirmed, transactionHash, onWalletsLinked]);

    // Helper function for API calls
    const callMcpApi = async (body: any) => {
        const response = await fetch(MCP_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || `API Error: ${response.status}`);
        }
        return data;
    };

    // Fetch managed wallets
    const fetchWallets = useCallback(async () => {
        setIsLoadingWallets(true);
        setError(null);
        try {
            const response = await fetch(MANAGED_WALLETS_ENDPOINT);
            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`Failed to fetch wallets: ${response.status} ${errText}`);
            }
            const data = await response.json();
            
            if (data && Array.isArray(data.managed_wallets)) {
                const transformedWallets: ManagedWalletSummary[] = data.managed_wallets.map((w: ManagedWalletSummaryFromApi) => ({
                    id: w.id,
                    name: w.name,
                    address: w.address as Address,
                    isActive: w.is_active && !w.is_locked,
                }));
                setManagedWallets(transformedWallets); // Set all managed wallets
            }
        } catch (err: any) {
            console.error("Error fetching managed wallets:", err);
            setError(err.message || 'Failed to load wallets.');
        }
        setIsLoadingWallets(false);
    }, []);

    useEffect(() => {
        fetchWallets();
        resetSignersNote();
    }, [fetchWallets, resetSignersNote]);

    const handleWalletSelectionToggle = (walletAddress: Address) => {
        setSelectedWallets(prev => {
            const newSelection = new Set(prev);
            if (newSelection.has(walletAddress)) {
                newSelection.delete(walletAddress);
            } else {
                newSelection.add(walletAddress);
            }
            return newSelection;
        });
    };

    const handleUpdateLinkedWallets = () => {
        if (!operatorTbaAddress || !operatorEntryName) {
            setError("Operator details missing.");
            return;
        }
        setError(null);
        const finalAddressesToLink = Array.from(selectedWallets);
        setSignersNote({
            operatorTbaAddress,
            operatorEntryName,
            hotWalletAddresses: finalAddressesToLink,
        });
    };

    const handleGenerateWallet = async () => {
        setIsCreatingWallet(true);
        setError(null);
        try {
            const requestBody = { GenerateWallet: {} };
            await callMcpApi(requestBody);
            await fetchWallets(); // Refresh wallet list
            setError(null);
        } catch (err: any) {
            setError(err.message || 'Failed to generate wallet');
        } finally {
            setIsCreatingWallet(false);
        }
    };

    const handleImportWallet = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!privateKeyToImport || !passwordForImport) {
            setError('Private Key and Password required for import.');
            return;
        }
        setIsCreatingWallet(true);
        setError(null);
        try {
            const requestBody = {
                ImportWallet: {
                    private_key: privateKeyToImport,
                    password: passwordForImport,
                    name: walletNameToImport.trim() === '' ? null : walletNameToImport.trim()
                }
            };
            await callMcpApi(requestBody);
            setShowImportForm(false);
            setPrivateKeyToImport('');
            setPasswordForImport('');
            setWalletNameToImport('');
            await fetchWallets(); // Refresh wallet list
        } catch (err: any) {
            setError(err.message || 'Failed to import wallet');
        } finally {
            setIsCreatingWallet(false);
        }
    };

    // Logic for showing creation/import form if NO managed wallets at all
    const hasAnyManagedWallets = managedWallets.length > 0;

    // Render import form
    if (showImportForm) {
        return (
            <form onSubmit={handleImportWallet} style={{ padding: '10px' }}>
                <h4 style={{ marginBottom: '10px' }}>Import Wallet</h4>
                <input
                    type="text"
                    placeholder="Private Key (0x...)"
                    value={privateKeyToImport}
                    onChange={e => setPrivateKeyToImport(e.target.value)}
                    required
                    className="input-field"
                    style={{ marginBottom: '8px', width: '100%' }}
                />
                <input
                    type="text"
                    placeholder="Name (Optional)"
                    value={walletNameToImport}
                    onChange={e => setWalletNameToImport(e.target.value)}
                    className="input-field"
                    style={{ marginBottom: '8px', width: '100%' }}
                />
                <input
                    type="password"
                    placeholder="Password"
                    value={passwordForImport}
                    onChange={e => setPasswordForImport(e.target.value)}
                    required
                    className="input-field"
                    style={{ marginBottom: '8px', width: '100%' }}
                />
                <div style={{ display: 'flex', gap: '8px' }}>
                    <button 
                        type="submit" 
                        className="button primary-button" 
                        disabled={isCreatingWallet}
                        style={{ fontSize: '0.85em', padding: '4px 8px' }}
                    >
                        {isCreatingWallet ? 'Importing...' : 'Import'}
                    </button>
                    <button 
                        type="button"
                        onClick={() => {
                            setShowImportForm(false);
                            setPrivateKeyToImport('');
                            setPasswordForImport('');
                            setWalletNameToImport('');
                            setError(null);
                        }}
                        className="button"
                        disabled={isCreatingWallet}
                        style={{ fontSize: '0.85em', padding: '4px 8px' }}
                    >
                        Cancel
                    </button>
                </div>
                {error && (
                    <div style={{ color: 'red', fontSize: '0.85em', marginTop: '8px' }}>
                        {error}
                    </div>
                )}
            </form>
        );
    }

    // Main display for listing wallets for linking
    return (
        <div style={{ padding: '10px' }}>
            <div style={{ marginBottom: '10px' }}>
                <h4 style={{ marginBottom: '8px' }}>Select Wallets to Link/Unlink:</h4>
                {managedWallets.map(wallet => {
                    const isChecked = selectedWallets.has(wallet.address);
                    return (
                        <div key={wallet.id} style={{ display: 'flex', alignItems: 'center', marginBottom: '6px' }}>
                            <input 
                                type="checkbox" 
                                id={`wallet-manage-${wallet.id}`} // Unique ID
                                checked={isChecked}
                                onChange={() => handleWalletSelectionToggle(wallet.address)}
                                style={{ marginRight: '6px' }}
                            />
                            <label 
                                htmlFor={`wallet-manage-${wallet.id}`} 
                                style={{ fontSize: '0.85em', cursor: 'pointer' }}
                            >
                                {wallet.name ? wallet.name : 'Wallet'} ({wallet.address.substring(0,6)}...{wallet.address.substring(wallet.address.length - 4)})
                            </label>
                        </div>
                    );
                })}
                {!hasAnyManagedWallets && !isLoadingWallets && (
                     <p style={{ fontSize: '0.85em', color: '#888'}}>No managed wallets found. Create one below.</p>
                )}
            </div>

            {(error || signersNoteError) && (
                <div style={{ color: 'red', fontSize: '0.85em', marginBottom: '8px' }}>
                    {error || signersNoteError?.message}
                </div>
            )}

            {isSending && <p style={{ fontSize: '0.85em' }}>Updating signers...</p>}
            {isConfirming && <p style={{ fontSize: '0.85em' }}>Confirming update...</p>}
            {isConfirmed && transactionHash && (
                <div style={{ color: 'green', fontSize: '0.85em', marginBottom: '8px' }}>
                    Signers updated! Tx: {transactionHash.substring(0,10)}...
                </div>
            )}

            <div style={{ marginTop: '10px', display: 'flex', gap: '15px', flexWrap: 'wrap', alignItems: 'stretch' }}>
                <button 
                    onClick={handleUpdateLinkedWallets} 
                    disabled={isSending || isConfirming}
                    className="button primary-button"
                    style={{ fontSize: '0.9em', padding: '10px 15px', borderRadius: '6px' }}
                >
                    {isSending || isConfirming ? 'Processing...' : 'Update Signers'}
                </button>
                <div style={{ width: '100%', marginTop: '10px' }}> 
                    <p style={{ marginBottom: '8px', fontSize: '0.9em', color: '#aaa' }}>
                        Add a new wallet:
                    </p>
                    <div 
                        className="add-wallet-container minimalist" 
                        style={{ 
                            width: '100%', 
                            display: 'flex', 
                            alignItems: 'center', 
                            padding: '10px', 
                            border: '1px solid #404552', 
                            borderRadius: '8px', 
                            backgroundColor: '#262930' 
                        }}
                    >
                        <span className="add-wallet-plus" style={{ fontSize: '1.6em', color: '#8c92a3', marginRight: '12px' }}>+</span>
                        <div 
                            className="add-wallet-actions-inline" 
                            style={{ 
                                display: 'flex', 
                                flexGrow: 1, 
                                borderRadius: '6px', 
                                overflow: 'hidden', 
                                border: '1px solid #4a4f5c'
                            }}
                        >
                            <button 
                                onClick={handleGenerateWallet} 
                                className="button generate-button action-button" 
                                disabled={isCreatingWallet}
                                style={{
                                    flex: 1,
                                    fontSize: '0.85em', 
                                    padding: '10px 5px',
                                    color: '#a9c1ff',
                                    backgroundColor: isCreatingWallet ? '#30343e' : '#30343e',
                                    border: 'none',
                                    borderRadius: 0,
                                    textAlign: 'center',
                                    lineHeight: '1.3',
                                    cursor: isCreatingWallet ? 'not-allowed' : 'pointer',
                                    opacity: isCreatingWallet ? 0.6 : 1,
                                }}
                            >
                                {isCreatingWallet ? 'Generating...' : 'Generate'}
                            </button>
                            <button 
                                onClick={() => setShowImportForm(true)} 
                                className="button import-toggle-button action-button" 
                                disabled={isCreatingWallet}
                                style={{
                                    flex: 1,
                                    fontSize: '0.85em', 
                                    padding: '10px 5px',
                                    color: '#a9c1ff',
                                    backgroundColor: isCreatingWallet ? '#3c404a' : '#3c404a',
                                    border: 'none',
                                    borderLeft: '1px solid #4a4f5c',
                                    borderRadius: 0,
                                    textAlign: 'center',
                                    lineHeight: '1.3',
                                    cursor: isCreatingWallet ? 'not-allowed' : 'pointer',
                                    opacity: isCreatingWallet ? 0.6 : 1,
                                }}
                            >
                                Import
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default LinkHotWalletsInline; 
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
const LINKED_WALLETS_ENDPOINT = `${API_BASE_URL}/linked-wallets`;
const MCP_ENDPOINT = `${API_BASE_URL}/mcp`;

interface LinkedWalletFromApi {
    address: string;
    name: string | null;
    is_managed: boolean;
    is_linked_on_chain: boolean;
    is_active: boolean;
    is_encrypted: boolean;
    is_selected: boolean;
    is_unlocked: boolean;
}

interface LinkedWallet {
    address: Address;
    name: string | null;
    isManaged: boolean;
    isLinkedOnChain: boolean;
    isActive: boolean;
    isSelected: boolean;
    isUnlocked: boolean;
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
    const [allWallets, setAllWallets] = useState<LinkedWallet[]>([]);
    const [selectedWallets, setSelectedWallets] = useState<Set<Address>>(new Set());
    const [isLoadingWallets, setIsLoadingWallets] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    
    // Wallet creation states
    const [showImportForm, setShowImportForm] = useState<boolean>(false);
    const [privateKeyToImport, setPrivateKeyToImport] = useState<string>('');
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

    // Effect to synchronize selectedWallets with on-chain linked wallets
    useEffect(() => {
        // Update selected wallets based on which ones are actually linked on-chain
        const newSelectedWallets = new Set<Address>();
        allWallets.forEach(wallet => {
            if (wallet.isLinkedOnChain) {
                newSelectedWallets.add(wallet.address);
            }
        });
        setSelectedWallets(newSelectedWallets);
    }, [allWallets]);

    // Effect to refresh graph data once the transaction is confirmed
    useEffect(() => {
        if (isConfirmed && transactionHash) {
            console.log("Signers note transaction confirmed. Refreshing wallets/graph with delay. Tx:", transactionHash);
            // Add delay to allow backend to sync with blockchain
            setTimeout(() => {
                onWalletsLinked();
                fetchWallets(); // Refresh the wallet list too
            }, 2000);
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

    // Fetch linked wallets (both managed and on-chain)
    const fetchWallets = useCallback(async () => {
        setIsLoadingWallets(true);
        setError(null);
        try {
            const response = await fetch(LINKED_WALLETS_ENDPOINT);
            
            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`Failed to fetch wallets: ${response.status} ${errText}`);
            }
            
            const data = await response.json();
            
            if (data && Array.isArray(data.linked_wallets)) {
                const transformedWallets: LinkedWallet[] = data.linked_wallets.map((w: LinkedWalletFromApi) => ({
                    address: w.address as Address,
                    name: w.name,
                    isManaged: w.is_managed,
                    isLinkedOnChain: w.is_linked_on_chain,
                    isActive: w.is_active,
                    isSelected: w.is_selected,
                    isUnlocked: w.is_unlocked,
                }));
                setAllWallets(transformedWallets);
            }
        } catch (err: any) {
            console.error("Error fetching linked wallets:", err);
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
        if (!privateKeyToImport) {
            setError('Private Key is required for import.');
            return;
        }
        setIsCreatingWallet(true);
        setError(null);
        try {
            const requestBody = {
                ImportWallet: {
                    private_key: privateKeyToImport,
                    password: null,  // No password for imported wallets
                    name: walletNameToImport.trim() === '' ? null : walletNameToImport.trim()
                }
            };
            await callMcpApi(requestBody);
            setShowImportForm(false);
            setPrivateKeyToImport('');
            setWalletNameToImport('');
            await fetchWallets(); // Refresh wallet list
        } catch (err: any) {
            setError(err.message || 'Failed to import wallet');
        } finally {
            setIsCreatingWallet(false);
        }
    };

    // Separate wallets into managed and external
    const managedWallets = allWallets.filter(w => w.isManaged);
    const externalWallets = allWallets.filter(w => !w.isManaged && w.isLinkedOnChain);

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

    // Main display
    return (
        <div style={{ padding: '10px' }}>
            {isLoadingWallets ? (
                <p style={{ fontSize: '0.85em' }}>Loading wallets...</p>
            ) : (
                <>
                    {/* Managed Wallets Section */}
                    <div style={{ marginBottom: '15px' }}>
                        <h5 style={{ marginBottom: '8px', color: '#a9c1ff' }}>Your Wallets:</h5>
                        {managedWallets.length === 0 ? (
                            <p style={{ fontSize: '0.85em', color: '#888' }}>No managed wallets found. Create one below.</p>
                        ) : (
                            managedWallets.map(wallet => {
                                const isChecked = selectedWallets.has(wallet.address);
                                return (
                                    <div key={wallet.address} style={{ display: 'flex', alignItems: 'center', marginBottom: '6px' }}>
                                        <input 
                                            type="checkbox" 
                                            id={`wallet-manage-${wallet.address}`}
                                            checked={isChecked}
                                            onChange={() => handleWalletSelectionToggle(wallet.address)}
                                            style={{ marginRight: '6px' }}
                                        />
                                        <label 
                                            htmlFor={`wallet-manage-${wallet.address}`} 
                                            style={{ fontSize: '0.85em', cursor: 'pointer' }}
                                        >
                                            {wallet.name || 'Wallet'} ({wallet.address.substring(0,6)}...{wallet.address.substring(wallet.address.length - 4)})
                                        </label>
                                    </div>
                                );
                            })
                        )}
                    </div>

                    {/* External Wallets Section */}
                    {externalWallets.length > 0 && (
                        <div style={{ marginBottom: '15px' }}>
                            <h5 style={{ marginBottom: '8px', color: '#ffaa44' }}>Other Linked Wallets:</h5>
                            {externalWallets.map(wallet => {
                                const isChecked = selectedWallets.has(wallet.address);
                                return (
                                    <div key={wallet.address} style={{ display: 'flex', alignItems: 'center', marginBottom: '6px' }}>
                                        <input 
                                            type="checkbox" 
                                            id={`wallet-external-${wallet.address}`}
                                            checked={isChecked}
                                            onChange={() => handleWalletSelectionToggle(wallet.address)}
                                            style={{ marginRight: '6px' }}
                                        />
                                        <label 
                                            htmlFor={`wallet-external-${wallet.address}`} 
                                            style={{ fontSize: '0.85em', cursor: 'pointer', color: '#ccc' }}
                                        >
                                            {wallet.address.substring(0,6)}...{wallet.address.substring(wallet.address.length - 4)}
                                        </label>
                                    </div>
                                );
                            })}
                            <p style={{ fontSize: '0.7em', color: '#666', marginTop: '4px' }}>
                                These wallets are linked on-chain but not managed by this operator.
                            </p>
                        </div>
                    )}
                </>
            )}

            {/* Add Wallet Section - right after wallet lists */}
            <div style={{ marginTop: '15px' }}> 
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

            {/* Error/Status Messages */}
            {(error || signersNoteError) && (
                <div style={{ color: 'red', fontSize: '0.85em', marginBottom: '8px', marginTop: '10px' }}>
                    {error || signersNoteError?.message}
                </div>
            )}

            {isSending && <p style={{ fontSize: '0.85em', marginTop: '10px' }}>Updating signers...</p>}
            {isConfirming && <p style={{ fontSize: '0.85em', marginTop: '10px' }}>Confirming update...</p>}
            {isConfirmed && transactionHash && (
                <div style={{ color: 'green', fontSize: '0.85em', marginBottom: '8px', marginTop: '10px' }}>
                    Signers updated! Tx: {transactionHash.substring(0,10)}...
                </div>
            )}

            {/* Update Linked Wallets Button - moved to bottom */}
            <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'center' }}>
                <button 
                    onClick={handleUpdateLinkedWallets} 
                    disabled={isSending || isConfirming || isLoadingWallets}
                    className="button primary-button"
                    style={{ 
                        fontSize: '0.9em', 
                        padding: '12px 20px', 
                        borderRadius: '6px',
                        backgroundColor: '#007bff',
                        border: 'none',
                        color: 'white',
                        cursor: (isSending || isConfirming || isLoadingWallets) ? 'not-allowed' : 'pointer',
                        opacity: (isSending || isConfirming || isLoadingWallets) ? 0.6 : 1
                    }}
                >
                    {isSending || isConfirming ? 'Processing...' : (allWallets.length === 0 ? 'Link Wallets' : 'Update Linked Wallets')}
                </button>
            </div>
        </div>
    );
};

export default LinkHotWalletsInline; 
import React, { useState, useEffect, useCallback } from 'react';
import { WalletSummary, WalletListData } from '../logic/types';
import type { Address as ViemAddress } from 'viem';

// TODO: Consolidate these API helpers if they become widely used
const getApiBasePath = () => {
    const pathParts = window.location.pathname.split('/').filter(p => p);
    const processIdPart = pathParts.find(part => part.includes(':'));
    return processIdPart ? `/${processIdPart}/api` : '/api';
};
const MCP_ENDPOINT = `${getApiBasePath()}/mcp`;

interface HotWalletLinkerModalProps {
    isOpen: boolean;
    onClose: () => void;
    currentLinkedHotWalletAddress: ViemAddress | null | undefined; // The one from onboardingData.checks
    operatorTbaAddress: ViemAddress | null | undefined;
    nodeName: string | null;
    onSignersNoteUpdate: (newSigners: ViemAddress[]) => Promise<void>; // Function to call HVM's setSignersNote
    // Consider passing existing handleSetSignersNote directly or a wrapper from HVM
}

const HotWalletLinkerModal: React.FC<HotWalletLinkerModalProps> = ({
    isOpen,
    onClose,
    currentLinkedHotWalletAddress,
    operatorTbaAddress,
    nodeName,
    onSignersNoteUpdate,
}) => {
    const [mcpWallets, setMcpWallets] = useState<WalletSummary[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);

    // States for import form (similar to AccountManager)
    const [showImportForm, setShowImportForm] = useState<boolean>(false);
    const [privateKeyToImport, setPrivateKeyToImport] = useState<string>('');
    const [passwordForImport, setPasswordForImport] = useState<string>('');
    const [walletNameToImport, setWalletNameToImport] = useState<string>('');
    const [isImporting, setIsImporting] = useState<boolean>(false);
    const [isGenerating, setIsGenerating] = useState<boolean>(false);

    const fetchMcpWalletData = useCallback(async () => {
        if (!isOpen) return; // Only fetch if modal is open
        setIsLoading(true);
        setError(null);
        try {
            const requestBody = { GetWalletSummaryList: {} };
            const response = await fetch(MCP_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody),
            });
            if (!response.ok) {
                const errData = await response.json().catch(() => ({ error: `HTTP error! Status: ${response.status}` }));
                throw new Error(errData.error || `Failed to fetch MCP wallet list: ${response.statusText}`);
            }
            const data: WalletListData = await response.json();
            setMcpWallets(data.wallets || []);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'An unknown error occurred fetching MCP wallet data');
            setMcpWallets([]);
        } finally {
            setIsLoading(false);
        }
    }, [isOpen]);

    useEffect(() => {
        fetchMcpWalletData();
    }, [fetchMcpWalletData]);

    const handleGenerateWallet = async () => {
        setIsGenerating(true); setError(null);
        try {
            const requestBody = { GenerateWallet: {} };
            const response = await fetch(MCP_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody),
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Failed to generate wallet');
            // alert(`New wallet ${data.id} generated!`); // Or a more subtle notification
            fetchMcpWalletData(); // Refresh list
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to generate wallet');
        } finally {
            setIsGenerating(false);
        }
    };

    const handleImportWallet = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!privateKeyToImport || !passwordForImport) {
            setError('Private Key and Password required for import.'); return;
        }
        setIsImporting(true); setError(null);
        try {
            const requestBody = {
                ImportWallet: {
                    private_key: privateKeyToImport,
                    password: passwordForImport,
                    name: walletNameToImport.trim() === '' ? null : walletNameToImport.trim()
                }
            };
            const response = await fetch(MCP_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody),
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Failed to import wallet');
            // alert('Wallet imported successfully!');
            fetchMcpWalletData(); // Refresh list
            setShowImportForm(false);
            setPrivateKeyToImport(''); setPasswordForImport(''); setWalletNameToImport('');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to import wallet');
        } finally {
            setIsImporting(false);
        }
    };

    const handleSetSignerAction = async (walletToLink: ViemAddress) => {
        // For now, this assumes we are always setting a single signer.
        // A more robust solution would manage an array of signers.
        if (!operatorTbaAddress || !nodeName) {
            setError('Operator TBA or Node Name missing, cannot set signer.');
            return;
        }
        try {
            await onSignersNoteUpdate([walletToLink]);
            onClose(); // Close modal on success
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to update signers note.');
        }
    };

    if (!isOpen) return null;

    const linkedWallets = mcpWallets.filter(w => w.address === currentLinkedHotWalletAddress);
    const unlinkedWallets = mcpWallets.filter(w => w.address !== currentLinkedHotWalletAddress);

    // Basic modal styling - can be improved with a proper CSS file or styled-components
    const modalStyle: React.CSSProperties = {
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        backgroundColor: '#2d2d2d', padding: '20px', borderRadius: '8px', 
        zIndex: 1000, color: 'white', maxHeight: '80vh', overflowY: 'auto',
        minWidth: '500px', boxShadow: '0 5px 15px rgba(0,0,0,0.3)'
    };
    const overlayStyle: React.CSSProperties = {
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, 
        backgroundColor: 'rgba(0,0,0,0.7)', zIndex: 999
    };

    return (
        <div style={overlayStyle} onClick={onClose}>
            <div style={modalStyle} onClick={e => e.stopPropagation()}>
                <h3>Link Hot Wallets to Operator: {truncateString(operatorTbaAddress)}</h3>
                {error && <p style={{color: 'red'}}>{error}</p>}
                
                <h4>Linked Wallets</h4>
                {isLoading ? <p>Loading...</p> : (
                    linkedWallets.length > 0 ? (
                        <ul>
                            {linkedWallets.map(wallet => (
                                <li key={wallet.id}> 
                                    {wallet.name || truncateString(wallet.address)} (Currently Linked)
                                    {/* Add button to Unlink / Set as different active if multiple signers were supported */}
                                </li>
                            ))}
                        </ul>
                    ) : <p>No hot wallet currently linked as primary via signers note.</p>
                )}

                <h4>Unlinked Wallets (Available in MCP)</h4>
                {isLoading ? <p>Loading...</p> : (
                    unlinkedWallets.length > 0 ? (
                        <ul>
                            {unlinkedWallets.map(wallet => (
                                <li key={wallet.id}>
                                    {wallet.name || truncateString(wallet.address)}
                                    <button onClick={() => handleSetSignerAction(wallet.address as ViemAddress)} style={{marginLeft: '10px'}}>
                                        Set as Signer
                                    </button>
                                </li>
                            ))}
                        </ul>
                    ) : <p>No other wallets available in MCP to link.</p>
                )}

                <div className="add-wallet-container" style={{marginTop: '20px', borderTop: '1px solid #555', paddingTop: '15px'}}>
                     <button onClick={handleGenerateWallet} disabled={isGenerating} style={{marginRight: '10px'}}>
                         {isGenerating ? 'Generating...' : 'Generate New Wallet'}
                     </button>
                     <button onClick={() => setShowImportForm(prev => !prev)}>
                          {showImportForm ? 'Cancel Import' : 'Import Wallet'}
                     </button>
                </div>

                {showImportForm && (
                    <form onSubmit={handleImportWallet} style={{marginTop: '15px', padding: '10px', border: '1px solid #444', borderRadius: '4px'}}>
                        <h5>Import Wallet</h5>
                        <input
                            type="text"
                            placeholder="Private Key (0x...)"
                            value={privateKeyToImport}
                            onChange={e => setPrivateKeyToImport(e.target.value)}
                            required style={{display:'block', marginBottom:'5px', width: '95%'}}
                        />
                         <input
                            type="text"
                            placeholder="Account Name (Optional)"
                            value={walletNameToImport}
                            onChange={e => setWalletNameToImport(e.target.value)}
                            style={{display:'block', marginBottom:'5px', width: '95%'}}
                        />
                        <input
                            type="password"
                            placeholder="Choose Password to Encrypt Key"
                            value={passwordForImport}
                            onChange={e => setPasswordForImport(e.target.value)}
                            required style={{display:'block', marginBottom:'10px', width: '95%'}}
                        />
                        <button type="submit" disabled={isImporting}>
                            {isImporting ? 'Importing...' : 'Import Wallet'}
                        </button>
                    </form>
                )}
                <button onClick={onClose} style={{marginTop: '20px'}}>Close</button>
            </div>
        </div>
    );
};

// Helper for modal, can be moved
const truncateString = (str: string | null | undefined, len: number = 10): string => {
    if (!str) return '(N/A)'; 
    if (str.length <= len + 3) return str; 
    const prefix = str.startsWith('0x') ? '0x' : '';
    const addressPart = prefix ? str.substring(2) : str;
    const visibleLen = len - prefix.length - 3; 
    if (visibleLen <= 1) return prefix + '...'; 
    const start = prefix + addressPart.substring(0, Math.ceil(visibleLen / 2));
    const end = addressPart.substring(addressPart.length - Math.floor(visibleLen / 2));
    return `${start}...${end}`;
}

export default HotWalletLinkerModal; 
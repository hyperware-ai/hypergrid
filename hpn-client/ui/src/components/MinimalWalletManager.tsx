import React, { useState, useEffect, useCallback } from 'react';
import CopyToClipboardText from './CopyToClipboardText';
import { WalletSummary, WalletListData } from '../logic/types'; // Assuming SpendingLimits is not needed

// Define getApiBasePath directly here
const getApiBasePath = () => {
    const pathParts = window.location.pathname.split('/').filter(p => p);
    const processIdPart = pathParts.find(part => part.includes(':'));
    return processIdPart ? `/${processIdPart}/api` : '/api';
};
const MCP_ENDPOINT = `${getApiBasePath()}/mcp`;

const callMcpApi = async (endpoint: string, body: any) => {
    const response = await fetch(endpoint, {
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

interface MinimalWalletManagerProps {
    onActionComplete: () => void;
    onCloseManager: () => void;
}

const MinimalWalletManager: React.FC<MinimalWalletManagerProps> = ({ onActionComplete, onCloseManager }) => {
    const [wallets, setWallets] = useState<WalletSummary[]>([]);
    const [selectedWalletId, setSelectedWalletId] = useState<string | null>(null); // To highlight selected
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [isActionLoading, setIsActionLoading] = useState<boolean>(false);
    const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

    const [privateKeyToImport, setPrivateKeyToImport] = useState<string>('');
    const [passwordForImport, setPasswordForImport] = useState<string>('');
    const [walletNameToImport, setWalletNameToImport] = useState<string>('');
    const [showImportForm, setShowImportForm] = useState<boolean>(false);

    const showToast = useCallback((type: 'success' | 'error', text: string, duration: number = 3000) => {
        setToastMessage({ type, text });
        setTimeout(() => setToastMessage(null), duration);
    }, []);

    const fetchWalletData = useCallback(async (selectLastKnown?: boolean) => {
        setIsLoading(true);
        setToastMessage(null);
        try {
            const requestBody = { GetWalletSummaryList: {} };
            const data: WalletListData = await callMcpApi(MCP_ENDPOINT, requestBody);
            setWallets(data.wallets || []);
            if (selectLastKnown) {
                setSelectedWalletId(data.selected_id || null);
            } else if (data.wallets && data.wallets.length > 0 && !data.selected_id) {
                // If no wallet is selected backend-wise, but we have wallets, visually select the first one.
                // setSelectedWalletId(data.wallets[0].id); 
            } else {
                 setSelectedWalletId(data.selected_id || null);
            }
        } catch (err) {
            showToast('error', err instanceof Error ? err.message : 'An unknown error occurred fetching wallet data');
            setWallets([]);
            setSelectedWalletId(null);
        } finally {
            setIsLoading(false);
        }
    }, [showToast]);

    useEffect(() => {
        fetchWalletData(true); // Fetch and try to respect backend's selectedId
    }, [fetchWalletData]);

    const handleSuccess = (msg: string) => {
        showToast('success', msg);
        fetchWalletData(true).then(() => { // Refresh and respect backend selectedId
            window.dispatchEvent(new CustomEvent('accountActionSuccess')); // For other listeners
            onActionComplete(); // Notify HpnVisualManager
        });
    };
    
    const handleError = (err: any) => {
        showToast('error', err instanceof Error ? err.message : 'An unknown API error occurred');
        setIsActionLoading(false); // Ensure loading state is reset on error
    };

    const handleSelectWallet = async (walletId: string) => {
        if (walletId === selectedWalletId && wallets.find(w => w.id === walletId && w.is_selected)) {
            // If already selected visually AND in backend, do nothing extra.
            // Or, if we want to allow "unselecting" visually:
            // setSelectedWalletId(null); return;
            return;
        }
        setIsActionLoading(true); setToastMessage(null);
        try {
            const requestBody = { SelectWallet: { wallet_id: walletId } };
            await callMcpApi(MCP_ENDPOINT, requestBody);
            // Backend selection successful.
            // fetchWalletData will update our local selectedWalletId based on backend truth.
            handleSuccess(`Account ${truncateString(walletId,10)} selected.`);
        } catch (err: any) { handleError(err); }
        finally { setIsActionLoading(false); }
    };
    
    const handleGenerateWallet = async () => {
         setIsActionLoading(true); setToastMessage(null);
         try {
            const requestBody = { GenerateWallet: {} };
            const data = await callMcpApi(MCP_ENDPOINT, requestBody);
            handleSuccess(`New account ${truncateString(data.id, 10)} generated and selected.`);
        } catch (err: any) { handleError(err); }
        finally { setIsActionLoading(false); }
    };

    const handleImport = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!privateKeyToImport || !passwordForImport) {
            showToast('error', 'Private Key and Password required for import.'); return;
        }
        setIsActionLoading(true); setToastMessage(null);
        try {
            const requestBody = {
                ImportWallet: {
                    private_key: privateKeyToImport, password: passwordForImport,
                    name: walletNameToImport.trim() === '' ? null : walletNameToImport.trim()
                }
            };
            await callMcpApi(MCP_ENDPOINT, requestBody);
            handleSuccess(`Account imported successfully. It is now inactive (select and activate if needed).`);
            setShowImportForm(false);
            setPrivateKeyToImport(''); setPasswordForImport(''); setWalletNameToImport('');
        } catch (err: any) { handleError(err); }
        finally { setIsActionLoading(false); }
    };

    const truncateString = (str: string | null | undefined, len: number = 10): string => {
        if (!str) return '-';
        if (str.length <= len + 3) return str;
        const prefix = str.startsWith('0x') ? '0x' : '';
        const addressPart = prefix ? str.substring(2) : str;
        const visibleLen = len - prefix.length - 3;
        if (visibleLen <= 1) return prefix + '...';
        const start = prefix + addressPart.substring(0, Math.ceil(visibleLen / 2));
        const end = addressPart.substring(addressPart.length - Math.floor(visibleLen / 2));
        return `${start}...${end}`;
    }
    
    // Simplified status for this minimal view - primarily if it's the backend's active/selected one
    const getWalletDisplayStatus = (wallet: WalletSummary): string => {
        if (wallet.is_selected) return "Selected"; // is_selected from WalletSummary
        // Could add more if needed, e.g. if encrypted & inactive
        return wallet.is_active ? "Active" : "Inactive"; 
    }


    if (isLoading) {
         return <div className="loading-message" style={{padding: '20px', textAlign: 'center'}}>Loading wallets...</div>;
    }

    return (
        <div className="operator-wallet-content minimal-wallet-manager" style={{minWidth:'320px', padding: '15px'}}>
            {toastMessage && (
                <div className={`toast-notification ${toastMessage.type}`}>
                    {toastMessage.text}
                    <button onClick={() => setToastMessage(null)} className="toast-close-button">&times;</button>
                 </div>
            )}

            <section className="wallet-list-section config-section" style={{marginBottom: '15px'}}>
                <h4 className="section-title" style={{marginTop:0}}>Available Wallets</h4>
                {wallets.length === 0 && !isLoading && (
                    <p className="info-message">No wallets found. Generate or import one below.</p>
                )}
                {wallets.length > 0 && (
                    <ul className="wallet-list" style={{maxHeight: '200px', overflowY: 'auto'}}>
                        {wallets.map(wallet => (
                            <li key={wallet.id} 
                                className={`wallet-item ${wallet.is_selected ? 'selected' : ''}`}
                                onClick={() => handleSelectWallet(wallet.id)}
                                title={`Select Account: ${wallet.name || wallet.address} (${getWalletDisplayStatus(wallet)})`}
                            >
                                <div className="wallet-main-info" style={{flexGrow: 1}}>
                                    <span className="wallet-name">{wallet.name || truncateString(wallet.address, 12)}</span>
                                    <CopyToClipboardText textToCopy={wallet.address} className="wallet-address-short">
                                        <code title="Copy address">{truncateString(wallet.address, 8)}</code>
                                    </CopyToClipboardText>
                                </div>
                                <div className="wallet-status-display">
                                     <span 
                                        className={`status-indicator-dot ${wallet.is_selected ? 'selected' : (wallet.is_active ? 'active' : 'inactive')}`}
                                        title={getWalletDisplayStatus(wallet)}
                                     ></span>
                                     <span className="wallet-display-status">
                                        {getWalletDisplayStatus(wallet)}
                                     </span>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
                 <div className="add-wallet-container minimalist" style={{marginTop: '15px'}}>
                      {/* Keeping class structure similar to AccountManager for add/import buttons */}
                      <span className="add-wallet-plus">+</span> 
                      <div className="add-wallet-actions-inline">
                         <button onClick={handleGenerateWallet} className="button generate-button action-button" disabled={isActionLoading}>
                             {isActionLoading ? 'Generating...' : 'Generate New Wallet'}
                         </button>
                         <button onClick={() => setShowImportForm(prev => !prev)} className="button import-toggle-button action-button" disabled={isActionLoading}>
                              {showImportForm ? 'Cancel Import' : 'Import Wallet'}
                         </button>
                       </div>
                  </div>
            </section>

            {showImportForm && (
                <form onSubmit={handleImport} className="import-form config-section" style={{marginTop: '15px'}}>
                    <h4 className="section-title">Import Wallet</h4>
                    <input
                        type="text" placeholder="Enter Private Key (0x...)" value={privateKeyToImport}
                        onChange={e => setPrivateKeyToImport(e.target.value)} required
                        className="input-field"
                    />
                     <input
                        type="text" placeholder="Account Name (Optional)" value={walletNameToImport}
                        onChange={e => setWalletNameToImport(e.target.value)}
                        className="input-field"
                    />
                    <input
                        type="password" placeholder="Choose Password to Encrypt Key" value={passwordForImport}
                        onChange={e => setPasswordForImport(e.target.value)} required
                        className="input-field"
                    />
                    <button type="submit" className="button primary-button action-button" disabled={isActionLoading} style={{width: '100%'}}>
                        {isActionLoading ? 'Importing...' : 'Import Wallet'}
                    </button>
                </form>
            )}
             <button onClick={onCloseManager} className="button action-button" style={{marginTop: '20px', width: '100%'}}>
                Done
            </button>
        </div>
    );
};

export default MinimalWalletManager; 
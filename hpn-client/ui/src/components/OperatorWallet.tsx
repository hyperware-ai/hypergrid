//import React, { useState, useEffect, useCallback } from 'react';
//
//// --- Interfaces (mirroring backend structs) ---
//// TODO: Share these types between frontend and backend? Maybe via a shared package or codegen.
//interface SpendingLimits {
//    max_per_call?: string | null;
//    max_total?: string | null;
//    currency?: string | null;
//}
//
//// Interface for the data fetched from GetWalletSummaryList
//interface WalletListData {
//    selected_id?: string | null;
//    wallets: WalletSummary[];
//}
//
//// Summary for displaying in the list
//interface WalletSummary {
//    id: string;
//    name?: string | null;
//    address: string;
//    is_active: boolean;
//    is_encrypted: boolean;
//    is_selected: boolean;
//}
//
//
//// Base URL for the client API
//// Dynamically determine base path from window location
//const getApiBasePath = () => {
//    const pathParts = window.location.pathname.split('/').filter(p => p); // Split and remove empty parts
//    // Assume the first part containing colons is the process ID prefix
//    const processIdPart = pathParts.find(part => part.includes(':'));
//    // Construct base API path including the process ID prefix
//    return processIdPart ? `/${processIdPart}/api` : '/api'; // Fallback to /api if prefix not found
//};
//
//const API_BASE_URL = getApiBasePath(); // e.g., /hpnclient:hpn:sortugdev.os/api
//const MCP_ENDPOINT = `${API_BASE_URL}/mcp`; // Central MCP endpoint for client
//
//// --- API Call Helper ---
//const callMcpApi = async (endpoint: string, body: any) => {
//    const response = await fetch(endpoint, {
//        method: 'POST',
//        headers: { 'Content-Type': 'application/json' },
//        body: JSON.stringify(body),
//    });
//    const data = await response.json();
//    if (!response.ok) {
//        throw new Error(data.error || `API Error: ${response.status}`);
//    }
//    return data;
//};
//
//// --- Component ---
//
//function AccountManager() {
//    // --- State ---
//    const [wallets, setWallets] = useState<WalletSummary[]>([]);
//    const [selectedWalletId, setSelectedWalletId] = useState<string | null>(null);
//    const [isLoading, setIsLoading] = useState<boolean>(true);
//    const [isActionLoading, setIsActionLoading] = useState<boolean>(false);
//    const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
//
//    // Input states 
//    const [currentPassword, setCurrentPassword] = useState<string>(''); 
//    const [newPassword, setNewPassword] = useState<string>('');
//    const [confirmPassword, setConfirmPassword] = useState<string>('');
//    const [revealedPrivateKey, setRevealedPrivateKey] = useState<string | null>(null);
//    const [privateKeyToImport, setPrivateKeyToImport] = useState<string>('');
//    const [passwordForImport, setPasswordForImport] = useState<string>('');
//    const [walletNameToImport, setWalletNameToImport] = useState<string>(''); 
//    const [limitPerCall, setLimitPerCall] = useState<string>('');
//    const [limitCurrency, setLimitCurrency] = useState<string>('USDC');
//    const [renameInput, setRenameInput] = useState<string>('');
//    const [walletToRename, setWalletToRename] = useState<string | null>(null);
//    const [showImportForm, setShowImportForm] = useState<boolean>(false);
//    const [activationPassword, setActivationPassword] = useState<{[key: string]: string}>({}); 
//    const [isConfigExpanded, setIsConfigExpanded] = useState<boolean>(false); 
//
//    // --- API Calls ---
//    const fetchWalletData = useCallback(async () => {
//        setCurrentPassword('');
//        setNewPassword('');
//        setConfirmPassword('');
//        setRevealedPrivateKey(null);
//        setWalletToRename(null);
//        setRenameInput('');
//
//        try {
//            const requestBody = { GetWalletSummaryList: {} }; 
//            const response = await fetch(MCP_ENDPOINT, {
//                method: 'POST',
//                headers: { 'Content-Type': 'application/json' },
//                body: JSON.stringify(requestBody),
//            });
//            if (!response.ok) {
//                const errData = await response.json().catch(() => ({ error: `HTTP error! Status: ${response.status}` }));
//                throw new Error(errData.error || `Failed to fetch wallet list: ${response.statusText}`);
//            }
//            const data: WalletListData = await response.json();
//            setWallets(data.wallets || []);
//            setSelectedWalletId(data.selected_id || null);
//
//            // TODO: Update limits - requires backend change
//            setLimitPerCall(''); 
//            setLimitCurrency('USDC');
//
//        } catch (err) {
//            showToast('error', err instanceof Error ? err.message : 'An unknown error occurred fetching wallet data');
//            setWallets([]);
//            setSelectedWalletId(null);
//        } finally {
//            setIsLoading(false); 
//        }
//    }, []);
//
//    useEffect(() => {
//        setIsLoading(true);
//        fetchWalletData().finally(() => setIsLoading(false));
//    }, [fetchWalletData]);
//
//    useEffect(() => {
//         setCurrentPassword('');
//         setNewPassword('');
//         setConfirmPassword('');
//         setRevealedPrivateKey(null);
//         setWalletToRename(null); 
//         setRenameInput('');
//         setToastMessage(null); 
//         setIsConfigExpanded(false); 
//         // Keep limit fields as they are
//    }, [selectedWalletId, wallets]); 
//
//    const handleRefresh = () => {
//        setIsActionLoading(true);
//        setToastMessage(null); 
//        fetchWalletData().finally(() => setIsActionLoading(false));
//    }
//
//    const handleSuccess = (msg: string) => {
//        showToast('success', msg);
//        fetchWalletData(); 
//    };
//
//    const handleError = (err: any) => {
//        showToast('error', err instanceof Error ? err.message : 'An unknown API error occurred');
//    };
//
//    const getSelectedWalletSummary = (): WalletSummary | undefined => {
//        return wallets.find(w => w.id === selectedWalletId);
//    }
//
//    // --- Wallet Actions Handlers ---
//    const handleActivate = async (walletId: string) => {
//        const wallet = wallets.find(w => w.id === walletId);
//        if (!wallet) return;
//        
//        const requiredPassword = wallet.is_encrypted ? activationPassword[walletId] : null;
//        if (wallet.is_encrypted && (!requiredPassword || requiredPassword === '')) { 
//            showToast('error', 'Password required to activate this encrypted wallet.');
//            return; 
//        }
//
//        setIsActionLoading(true); setToastMessage(null);
//        try {
//             if (walletId !== selectedWalletId) {
//                 await handleSelectWallet(walletId);
//             }
//            const requestBody = { ActivateWallet: { password: requiredPassword } }; 
//            await callMcpApi(MCP_ENDPOINT, requestBody);
//            handleSuccess(`Account ${truncateString(walletId, 10)} activated.`);
//            setActivationPassword(prev => ({...prev, [walletId]: ''}));
//        } catch (err: any) { handleError(err); }
//        finally { setIsActionLoading(false); }
//    };
//
//    const handleDeactivate = async (walletId: string) => {
//          if (walletId !== selectedWalletId) {
//             await handleSelectWallet(walletId);
//          }
//         const currentSelectedId = selectedWalletId ?? walletId; 
//         if(currentSelectedId !== walletId) { 
//             showToast('error', "Account must be selected to deactivate.");
//             return; 
//         } 
//
//         setIsActionLoading(true); setToastMessage(null);
//         try {
//            const requestBody = { DeactivateWallet: {} }; 
//            await callMcpApi(MCP_ENDPOINT, requestBody);
//            handleSuccess(`Account ${truncateString(walletId, 10)} deactivated.`);
//        } catch (err: any) { handleError(err); }
//        finally { setIsActionLoading(false); }
//    };
//
//    const handleSelectWallet = async (walletId: string) => {
//        if (walletId === selectedWalletId) return; 
//        setIsActionLoading(true); setToastMessage(null);
//        try {
//            const requestBody = { SelectWallet: { wallet_id: walletId } };
//            await callMcpApi(MCP_ENDPOINT, requestBody);
//            await fetchWalletData(); 
//        } catch (err: any) { handleError(err); }
//        finally { setIsActionLoading(false); }
//    };
//
//     const handleDeleteWallet = async (walletId: string) => {
//         if (!window.confirm(`Are you sure you want to delete account ${truncateString(walletId, 10)}? This cannot be undone.`)) return;
//        setIsActionLoading(true); setToastMessage(null);
//         try {
//            const requestBody = { DeleteWallet: { wallet_id: walletId } };
//             await callMcpApi(MCP_ENDPOINT, requestBody);
//             handleSuccess(`Account ${truncateString(walletId, 10)} deleted.`);
//        } catch (err: any) { handleError(err); }
//        finally { setIsActionLoading(false); }
//    };
//
//    const startRename = (walletId: string) => {
//        setWalletToRename(walletId);
//        setRenameInput(wallets.find(w => w.id === walletId)?.name || '');
//        setToastMessage(null); 
//    }
//    const handleRenameWallet = async (e: React.FormEvent) => {
//        e.preventDefault();
//         if (!walletToRename || !renameInput) return;
//         setIsActionLoading(true); setToastMessage(null);
//         try {
//            const requestBody = { RenameWallet: { wallet_id: walletToRename, new_name: renameInput } };
//             await callMcpApi(MCP_ENDPOINT, requestBody);
//             handleSuccess(`Account ${truncateString(walletToRename, 10)} renamed to ${renameInput}.`);
//             setWalletToRename(null); 
//        } catch (err: any) { handleError(err); }
//        finally { setIsActionLoading(false); }
//    }
//
//    const handleGenerateWallet = async () => {
//         setIsActionLoading(true); setToastMessage(null);
//         try {
//            const requestBody = { GenerateWallet: {} };
//             const data = await callMcpApi(MCP_ENDPOINT, requestBody);
//             handleSuccess(`New account ${truncateString(data.id, 10)} generated and selected.`);
//        } catch (err: any) { handleError(err); }
//        finally { setIsActionLoading(false); }
//    };
//
//    // Settings Handlers 
//    const handleExportKey = async () => {
//        const selectedWallet = getSelectedWalletSummary();
//        if (!selectedWallet) { showToast('error', "No account selected"); return; }
//        setIsActionLoading(true); setToastMessage(null); setRevealedPrivateKey(null);
//        try {
//            const requestBody = {
//                ExportSelectedPrivateKey: { 
//                    password: (selectedWallet.is_encrypted && !selectedWallet.is_active) ? currentPassword : null
//                } 
//            };
//             if (selectedWallet.is_encrypted && !selectedWallet.is_active && !currentPassword) {
//                throw new Error("Password required to export key from inactive/locked account.");
//            }
//            const data = await callMcpApi(MCP_ENDPOINT, requestBody);
//            setRevealedPrivateKey(data.private_key);
//            showToast('success', 'Private key revealed.', 10000); 
//            setCurrentPassword(''); 
//        } catch (err: any) { handleError(err); }
//        finally { setIsActionLoading(false); }
//    };
//
//    const handleSetPassword = async (e: React.FormEvent) => {
//        e.preventDefault();
//        const selectedWallet = getSelectedWalletSummary();
//        if (!selectedWallet) { showToast('error', "No account selected"); return; }
//        if (newPassword !== confirmPassword) { showToast('error', 'New passwords do not match.'); return; }
//        if (!newPassword) { showToast('error', 'New password cannot be empty.'); return; }
//        setIsActionLoading(true); setToastMessage(null);
//        try {
//             const requestBody = {
//                SetSelectedWalletPassword: { 
//                    new_password: newPassword, 
//                    old_password: selectedWallet.is_encrypted ? currentPassword : null 
//                } 
//            };
//             if (selectedWallet.is_encrypted && !currentPassword) {
//                throw new Error("Current password required to change password.");
//            }
//            await callMcpApi(MCP_ENDPOINT, requestBody);
//            handleSuccess('Password set successfully. Account is now inactive/locked.');
//            setCurrentPassword('');
//            setNewPassword('');
//            setConfirmPassword('');
//        } catch (err: any) { handleError(err); }
//        finally { setIsActionLoading(false); }
//    };
//
//     const handleRemovePassword = async (e: React.FormEvent) => {
//        e.preventDefault();
//         if (!selectedWalletId) { showToast('error', "No account selected"); return; }
//         if (!currentPassword) { showToast('error', 'Current password required.'); return; }
//         setIsActionLoading(true); setToastMessage(null);
//         try {
//            const requestBody = { RemoveSelectedWalletPassword: { current_password: currentPassword } };
//            await callMcpApi(MCP_ENDPOINT, requestBody);
//            handleSuccess('Password removed successfully. Account is now active/unlocked.');
//            setCurrentPassword(''); 
//        } catch (err: any) { handleError(err); }
//        finally { setIsActionLoading(false); }
//    };
//
//     const handleSetLimits = async (e: React.FormEvent) => {
//        e.preventDefault();
//         if (!selectedWalletId) { showToast('error', "No account selected"); return; }
//         setIsActionLoading(true); setToastMessage(null);
//        const limits: SpendingLimits = {
//            max_per_call: limitPerCall.trim() === '' ? null : limitPerCall.trim(),
//            max_total: null, 
//            currency: limitCurrency.trim() === '' ? 'USDC' : limitCurrency.trim(), 
//        };
//         try {
//            const requestBody = { SetWalletLimits: { limits: limits } }; 
//            await callMcpApi(MCP_ENDPOINT, requestBody);
//            handleSuccess('Spending limits updated successfully.');
//        } catch (err: any) { handleError(err); }
//        finally { setIsActionLoading(false); }
//    };
//
//    const handleImport = async (e: React.FormEvent) => {
//        e.preventDefault();
//        if (!privateKeyToImport || !passwordForImport) { showToast('error', 'Private Key and Password required for import.'); return; }
//        setIsActionLoading(true); setToastMessage(null);
//        try {
//            const requestBody = {
//                ImportWallet: {
//                    private_key: privateKeyToImport,
//                    password: passwordForImport,
//                    name: walletNameToImport.trim() === '' ? null : walletNameToImport.trim()
//                }
//            };
//            await callMcpApi(MCP_ENDPOINT, requestBody);
//            handleSuccess(`Account imported successfully. It is now inactive.`);
//            setShowImportForm(false); 
//            setPrivateKeyToImport(''); setPasswordForImport(''); setWalletNameToImport(''); 
//        } catch (err: any) { handleError(err); }
//        finally { setIsActionLoading(false); }
//    };
//
//    // --- Helper Functions ---
//    const truncateString = (str: string | null | undefined, len: number = 10): string => {
//        if (!str) return '-';
//        if (str.length <= len + 3) return str; 
//        const prefix = str.startsWith('0x') ? '0x' : '';
//        const addressPart = prefix ? str.substring(2) : str;
//        const visibleLen = len - prefix.length - 3; 
//        if (visibleLen <= 1) return prefix + '...'; 
//        const start = prefix + addressPart.substring(0, Math.ceil(visibleLen / 2));
//        const end = addressPart.substring(addressPart.length - Math.floor(visibleLen / 2));
//        return `${start}...${end}`;
//    }
//
//    const showToast = (type: 'success' | 'error', text: string, duration: number = 3000) => {
//        setToastMessage({ type, text });
//        setTimeout(() => {
//            setToastMessage(null);
//        }, duration);
//    };
//
//    // --- Render Logic ---
//    if (isLoading) {
//         return <div className="loading-message">Loading account data...</div>;
//    }
//    if (!isLoading && wallets.length === 0 && toastMessage?.type === 'error') {
//         return (
//            <div className="operator-wallet-content"> 
//                <div className={`toast-notification ${toastMessage.type}`}>
//                    {toastMessage.text}
//                    <button onClick={() => setToastMessage(null)} className="toast-close-button">&times;</button>
//                 </div>
//                <button onClick={handleRefresh} className="button refresh-button" disabled={isActionLoading}>
//                    {isActionLoading ? 'Retrying...' : 'Retry'}
//                </button>
//             </div>
//        );
//    }
//
//    const selectedWallet = getSelectedWalletSummary();
//
//    return (
//        <div className="operator-wallet-content"> 
//            {toastMessage && (
//                <div className={`toast-notification ${toastMessage.type}`}>
//                    {toastMessage.text}
//                    <button onClick={() => setToastMessage(null)} className="toast-close-button">&times;</button>
//                 </div>
//            )}
//
//            {/* --- Wallet List Section --- */} 
//            <section className="wallet-list-section config-section">
//                {wallets.length === 0 && !isLoading && (
//                    <p className="info-message">No accounts found. Generate or import one below.</p>
//                )}
//                {wallets.length > 0 && (
//                    <ul className="wallet-list">
//                        {wallets.map(wallet => (
//                            <li key={wallet.id} className={`wallet-item ${wallet.is_selected ? 'selected' : ''}`}> 
//                                <div className="wallet-main-info" onClick={() => handleSelectWallet(wallet.id)} title={`Select Account: ${wallet.name || wallet.address}`}>
//                                    <span className="wallet-name">{wallet.name || truncateString(wallet.address, 16)}</span>
//                                    {wallet.name && <code className="wallet-address-short" title={wallet.address}>{truncateString(wallet.address)}</code>}
//                                </div>
//                                <div className="wallet-status-actions">
//                                    <div className="activation-control" onClick={e => e.stopPropagation()}>
//                                        <span className={`status-dot ${wallet.is_active ? 'active' : 'inactive'}`} title={wallet.is_active ? 'Active' : 'Inactive'}></span>
//                                        <label className="switch" title={wallet.is_active ? 'Deactivate Account' : 'Activate Account'}>
//                                            <input 
//                                                type="checkbox" 
//                                                checked={wallet.is_active}
//                                                onChange={() => wallet.is_active ? handleDeactivate(wallet.id) : handleActivate(wallet.id)}
//                                                disabled={isActionLoading}
//                                            />
//                                            <span className="slider round"></span>
//                                        </label>
//                                        {!wallet.is_active && wallet.is_encrypted && (
//                                            <input
//                                                type="password"
//                                                className="activation-password-input"
//                                                placeholder="Password"
//                                                value={activationPassword[wallet.id] || ''}
//                                                onChange={e => setActivationPassword(prev => ({...prev, [wallet.id]: e.target.value}))}
//                                                onClick={e => e.stopPropagation()} 
//                                                disabled={isActionLoading}
//                                             />
//                                        )}
//                                    </div>
//                                    <div className="wallet-actions">
//                                        {walletToRename === wallet.id ? (
//                                            <form onSubmit={(e) => {e.stopPropagation(); handleRenameWallet(e);}} className="rename-form" onClick={e => e.stopPropagation()}>
//                                                <input type="text" value={renameInput} onChange={(e) => setRenameInput(e.target.value)} autoFocus />
//                                                <button type="submit" className="button save-rename-button" disabled={isActionLoading}>Save</button>
//                                                <button type="button" onClick={(e) => { e.stopPropagation(); setWalletToRename(null); }} className="button cancel-rename-button" disabled={isActionLoading}>Cancel</button>
//                                            </form>
//                                        ) : (
//                                            <button onClick={(e) => {e.stopPropagation(); startRename(wallet.id);}} className="button rename-button action-button" title="Rename">Rename</button>
//                                        )}
//                                        <button onClick={(e) => {e.stopPropagation(); handleDeleteWallet(wallet.id);}} className="button delete-button action-button" title="Delete" disabled={isActionLoading}>Delete</button>
//                                    </div>
//                                </div>
//                            </li>
//                        ))}
//                    </ul>
//                )}
//                 {/* Minimalist Add Wallet Bar */} 
//                 <div className="add-wallet-container minimalist">
//                      <span className="add-wallet-plus">+</span>
//                      <div className="add-wallet-actions-inline">
//                         <button onClick={handleGenerateWallet} className="button generate-button action-button" disabled={isActionLoading}>
//                             {isActionLoading ? 'Generating...' : 'Generate New Wallet'}
//                         </button>
//                         <button onClick={() => setShowImportForm(prev => !prev)} className="button import-toggle-button action-button" disabled={isActionLoading}>
//                              {showImportForm ? 'Cancel Import' : 'Import Wallet'}
//                         </button>
//                       </div>
//                  </div>
//
//                {/* Import Wallet Form */} 
//                {showImportForm && (
//                    <form onSubmit={handleImport} className="import-form config-section">
//                        <h4>Import Wallet</h4>
//                        <input
//                            type="text"
//                            placeholder="Enter Private Key (0x...)"
//                            value={privateKeyToImport}
//                            onChange={e => setPrivateKeyToImport(e.target.value)}
//                            required
//                            className="input-field"
//                        />
//                         <input
//                            type="text"
//                            placeholder="Account Name (Optional)"
//                            value={walletNameToImport}
//                            onChange={e => setWalletNameToImport(e.target.value)}
//                            className="input-field"
//                        />
//                        <input
//                            type="password"
//                            placeholder="Choose Password to Encrypt Key"
//                            value={passwordForImport}
//                            onChange={e => setPasswordForImport(e.target.value)}
//                            required
//                            className="input-field"
//                        />
//                        <button type="submit" className="button primary-button" disabled={isActionLoading}>
//                            {isActionLoading ? 'Importing...' : 'Import Wallet'}
//                        </button>
//                    </form>
//                )}
//            </section>
//
//            {/* --- Selected Account Configuration Section --- */}
//             {selectedWallet && (
//                 <section className="selected-wallet-config config-section">
//                     <h3 className="section-title" onClick={() => setIsConfigExpanded(!isConfigExpanded)} style={{ cursor: 'pointer' }}>
//                        Configure: {selectedWallet.name || truncateString(selectedWallet.address, 16)} 
//                        <span className="collapse-indicator">{isConfigExpanded ? '[-]' : '[+]'}</span>
//                    </h3>
//                    {isConfigExpanded && (
//                        <div className="config-forms">
//                            {/* Set/Change Password Form */} 
//                            <form onSubmit={handleSetPassword} className="config-form">
//                                <h4>{selectedWallet.is_encrypted ? 'Change' : 'Set'} Password</h4>
//                                {selectedWallet.is_encrypted && (
//                                    <input 
//                                        type="password" 
//                                        placeholder="Current Password"
//                                        value={currentPassword}
//                                        onChange={e => setCurrentPassword(e.target.value)}
//                                        required
//                                        className="input-field"
//                                    />
//                                )}
//                                <input 
//                                    type="password" 
//                                    placeholder="New Password"
//                                    value={newPassword}
//                                    onChange={e => setNewPassword(e.target.value)}
//                                    required
//                                    className="input-field"
//                                />
//                                <input 
//                                    type="password" 
//                                    placeholder="Confirm New Password"
//                                    value={confirmPassword}
//                                    onChange={e => setConfirmPassword(e.target.value)}
//                                    required
//                                    className="input-field"
//                                />
//                                <button type="submit" className="button action-button" disabled={isActionLoading}>
//                                    {isActionLoading ? 'Saving...' : (selectedWallet.is_encrypted ? 'Change Password' : 'Set Password')}
//                                </button>
//                            </form>
//
//                            {/* Remove Password Form */} 
//                            {selectedWallet.is_encrypted && (
//                                <form onSubmit={handleRemovePassword} className="config-form">
//                                    <h4>Remove Password</h4>
//                                    <input 
//                                        type="password" 
//                                        placeholder="Current Password"
//                                        value={currentPassword}
//                                        onChange={e => setCurrentPassword(e.target.value)}
//                                        required
//                                        className="input-field"
//                                    />
//                                    <button type="submit" className="button action-button" disabled={isActionLoading}>
//                                         {isActionLoading ? 'Removing...' : 'Remove Password'}
//                                    </button>
//                                </form>
//                            )}
//
//                            {/* Set Spending Limits Form */} 
//                             <form onSubmit={handleSetLimits} className="config-form">
//                                <h4>Spending Limits</h4>
//                                <input 
//                                    type="number" 
//                                    step="any" 
//                                    min="0"
//                                    placeholder="Max Per Call (e.g., 0.01)"
//                                    value={limitPerCall}
//                                    onChange={e => setLimitPerCall(e.target.value)}
//                                    className="input-field"
//                                />
//                                <input 
//                                    type="text" 
//                                    placeholder="Currency (e.g., USDC)" 
//                                    value={limitCurrency}
//                                    onChange={e => setLimitCurrency(e.target.value)}
//                                     className="input-field"
//                                 />
//                                <button type="submit" className="button action-button" disabled={isActionLoading}>
//                                     {isActionLoading ? 'Saving...' : 'Set Limits'}
//                                 </button>
//                            </form>
//
//                            {/* Export Private Key Section */} 
//                            <div className="config-form">
//                                <h4>Export Private Key</h4>
//                                {selectedWallet.is_encrypted && !selectedWallet.is_active && (
//                                     <input 
//                                        type="password" 
//                                        placeholder="Current Password (if inactive/locked)"
//                                        value={currentPassword}
//                                        onChange={e => setCurrentPassword(e.target.value)}
//                                        className="input-field"
//                                    />
//                                )}
//                                <button onClick={handleExportKey} className="button action-button" disabled={isActionLoading}>
//                                    {isActionLoading ? 'Exporting...' : 'Reveal Private Key'}
//                                </button>
//                                {revealedPrivateKey && (
//                                    <div className="revealed-key">
//                                        <p><strong>Private Key:</strong></p>
//                                        <code style={{ wordBreak: 'break-all' }}>{revealedPrivateKey}</code>
//                                        <button onClick={() => setRevealedPrivateKey(null)} className="button close-reveal-button">Hide</button>
//                                    </div>
//                                )}
//                             </div>
//                         </div>
//                     )}
//                 </section>
//             )}
//        </div>
//    );
//}
//
//export default AccountManager; 
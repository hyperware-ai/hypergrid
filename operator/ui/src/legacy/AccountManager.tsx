import React, { useState, useEffect, useCallback } from 'react';
import classNames from 'classnames';
import CopyToClipboardText from '../components/CopyToClipboardText';
import { callApiWithRouting } from '../utils/api-endpoints';
// Import shared types
import { WalletSummary, SpendingLimits, WalletListData } from '../logic/types';
import { useErrorLogStore } from '../store/errorLog';

type ToastMessage = {
    type: 'success' | 'error';
    text: string;
};

const getApiBasePath = () => {
    const pathParts = window.location.pathname.split('/').filter(p => p);
    const packagePath = pathParts.find(p => p.includes(':'));
    return packagePath ? `/${packagePath}/api` : '/api';
};

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

// --- API Call Helper ---
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

// --- Component ---
function AccountManager() {
    const { showToast } = useErrorLogStore();
    // --- State ---
    // Restore state initialization
    const [wallets, setWallets] = useState<WalletSummary[]>([]);
    const [selectedWalletId, setSelectedWalletId] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [isActionLoading, setIsActionLoading] = useState<boolean>(false);

    // Input states 
    const [currentPassword, setCurrentPassword] = useState<string>('');
    const [newPassword, setNewPassword] = useState<string>('');
    const [confirmPassword, setConfirmPassword] = useState<string>('');
    const [revealedPrivateKey, setRevealedPrivateKey] = useState<string | null>(null);
    const [privateKeyToImport, setPrivateKeyToImport] = useState<string>('');
    const [passwordForImport, setPasswordForImport] = useState<string>('');
    const [walletNameToImport, setWalletNameToImport] = useState<string>('');
    const [limitPerCall, setLimitPerCall] = useState<string>('');
    const [limitCurrency, setLimitCurrency] = useState<string>('USDC');
    const [renameInput, setRenameInput] = useState<string>('');
    const [walletToRename, setWalletToRename] = useState<string | null>(null);
    const [showImportForm, setShowImportForm] = useState<boolean>(false);
    const [activationPassword, setActivationPassword] = useState<{ [key: string]: string }>({});
    const [isConfigExpanded, setIsConfigExpanded] = useState<boolean>(false);

    // Re-add state for storing the generated config JSON in this session
    const [apiConfigJson, setApiConfigJson] = useState<string | null>(null);
    const [isGeneratingConfig, setIsGeneratingConfig] = useState<boolean>(false);
    const [generationError, setGenerationError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    // --- API Calls ---
    // Restore fetchWalletData
    const fetchWalletData = useCallback(async () => {
        setIsLoading(true);
        setRevealedPrivateKey(null);
        setWalletToRename(null);
        setRenameInput('');

        try {
            const requestBody = { GetWalletSummaryList: {} };
            const data: WalletListData = await callApiWithRouting(requestBody);
            setWallets(data.wallets || []);
            setSelectedWalletId(data.selected_id || null);

        } catch (err) {
            showToast('error', err instanceof Error ? err.message : 'An unknown error occurred fetching wallet data');
            setWallets([]);
            setSelectedWalletId(null);
        } finally {
            setIsLoading(false);
        }
    }, []);

    // --- Effects ---
    // Restore initial fetch useEffect
    useEffect(() => {
        fetchWalletData();
    }, [fetchWalletData]);

    // Keep effect for resetting inputs on selection change
    useEffect(() => {
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        setRevealedPrivateKey(null);
        setWalletToRename(null);
        setRenameInput('');
        setIsConfigExpanded(false);
        // Keep limit fields as they are
    }, [selectedWalletId]);

    // Keep handleRefresa (could maybe use fetchWalletData directly?)
    const handleRefresh = () => {
        setIsActionLoading(true);
        fetchWalletData().finally(() => setIsActionLoading(false)); // Use internal fetch
    }

    // Restore success handler to use internal fetch and dispatch event
    const handleSuccess = (msg: string) => {
        showToast('success', msg);
        fetchWalletData().then(() => {
            // Keep event dispatch for ActiveAccountDisplay
            window.dispatchEvent(new CustomEvent('accountActionSuccess'));
        });
    };

    const handleError = (err: any) => {
        showToast('error', err instanceof Error ? err.message : 'An unknown API error occurred');
    };

    const getSelectedWalletSummary = (): WalletSummary | undefined => {
        return wallets.find(w => w.id === selectedWalletId);
    }

    // --- Wallet Actions Handlers ---
    const handleActivate = async (walletId: string) => {
        const wallet = wallets.find(w => w.id === walletId);
        if (!wallet) return;

        const requiredPassword = wallet.is_encrypted ? activationPassword[walletId] : null;
        if (wallet.is_encrypted && (!requiredPassword || requiredPassword === '')) {
            showToast('error', 'Password required to activate this encrypted wallet.');
            return;
        }

        setIsActionLoading(true);
        try {
            if (walletId !== selectedWalletId) {
                await handleSelectWallet(walletId);
            }
            const requestBody = { ActivateWallet: { password: requiredPassword } };
            await callApiWithRouting(requestBody);
            handleSuccess(`Account ${truncateString(walletId, 10)} activated.`);
            setActivationPassword(prev => ({ ...prev, [walletId]: '' }));
        } catch (err: any) { handleError(err); }
        finally { setIsActionLoading(false); }
    };

    const handleDeactivate = async (walletId: string) => {
        if (walletId !== selectedWalletId) {
            await handleSelectWallet(walletId);
        }
        const currentSelectedId = selectedWalletId ?? walletId;
        if (currentSelectedId !== walletId) {
            showToast('error', "Account must be selected to deactivate.");
            return;
        }

        setIsActionLoading(true);
        try {
            const requestBody = { DeactivateWallet: {} };
            await callApiWithRouting(requestBody);
            handleSuccess(`Account ${truncateString(walletId, 10)} deactivated.`);
        } catch (err: any) { handleError(err); }
        finally { setIsActionLoading(false); }
    };

    const handleSelectWallet = async (walletId: string) => {
        if (walletId === selectedWalletId) return;
        setIsActionLoading(true);
        try {
            const requestBody = { SelectWallet: { wallet_id: walletId } };
            await callApiWithRouting(requestBody);
            // Selection successful in backend, dispatch event to trigger UI updates
            window.dispatchEvent(new CustomEvent('accountActionSuccess'));
            // Call the passed-in refresh AFTER dispatching, so App gets latest list
            fetchWalletData();
        } catch (err: any) { handleError(err); }
        finally { setIsActionLoading(false); }
    };

    const handleDeleteWallet = async (walletId: string) => {
        if (!window.confirm(`Are you sure you want to delete account ${truncateString(walletId, 10)}? This cannot be undone.`)) return;
        setIsActionLoading(true);
        try {
            const requestBody = { DeleteWallet: { wallet_id: walletId } };
            await callApiWithRouting(requestBody);
            handleSuccess(`Account ${truncateString(walletId, 10)} deleted.`);
        } catch (err: any) { handleError(err); }
        finally { setIsActionLoading(false); }
    };

    const startRename = (walletId: string) => {
        setWalletToRename(walletId);
        setRenameInput(wallets.find(w => w.id === walletId)?.name || '');
    }
    const handleRenameWallet = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!walletToRename || !renameInput) return;
        setIsActionLoading(true);
        try {
            const requestBody = { RenameWallet: { wallet_id: walletToRename, new_name: renameInput } };
            await callApiWithRouting(requestBody);
            handleSuccess(`Account ${truncateString(walletToRename, 10)} renamed to ${renameInput}.`);
            setWalletToRename(null);
        } catch (err: any) { handleError(err); }
        finally { setIsActionLoading(false); }
    }

    const handleGenerateWallet = async () => {
        setIsActionLoading(true);
        try {
            const requestBody = { GenerateWallet: {} };
            const data = await callApiWithRouting(requestBody);
            handleSuccess(`New account ${truncateString(data.id, 10)} generated and selected.`);
        } catch (err: any) { handleError(err); }
        finally { setIsActionLoading(false); }
    };

    // Settings Handlers 
    const handleExportKey = async () => {
        const selectedWallet = getSelectedWalletSummary();
        if (!selectedWallet) {
            showToast('error', "No account selected");
            return;
        }
        setIsActionLoading(true);
        setRevealedPrivateKey(null);
        try {
            const requestBody = {
                ExportSelectedPrivateKey: {
                    password: (selectedWallet.is_encrypted && !selectedWallet.is_active) ? currentPassword : null
                }
            };
            if (selectedWallet.is_encrypted && !selectedWallet.is_active && !currentPassword) {
                throw new Error("Password required to export key from inactive/locked account.");
            }
            const data = await callApiWithRouting(requestBody);
            setRevealedPrivateKey(data.private_key);
            showToast('success', 'Private key revealed.', 10000);
            setCurrentPassword('');
        } catch (err: any) { handleError(err); }
        finally { setIsActionLoading(false); }
    };

    const handleSetPassword = async (e: React.FormEvent) => {
        e.preventDefault();
        const selectedWallet = getSelectedWalletSummary();
        if (!selectedWallet) { showToast('error', "No account selected"); return; }
        if (newPassword !== confirmPassword) { showToast('error', 'New passwords do not match.'); return; }
        if (!newPassword) { showToast('error', 'New password cannot be empty.'); return; }
        setIsActionLoading(true);
        try {
            const requestBody = {
                SetSelectedWalletPassword: {
                    new_password: newPassword,
                    old_password: selectedWallet.is_encrypted ? currentPassword : null
                }
            };
            if (selectedWallet.is_encrypted && !currentPassword) {
                throw new Error("Current password required to change password.");
            }
            await callApiWithRouting(requestBody);
            handleSuccess('Password set successfully. Account is now inactive/locked.');
            setCurrentPassword('');
            setNewPassword('');
            setConfirmPassword('');
        } catch (err: any) { handleError(err); }
        finally { setIsActionLoading(false); }
    };

    const handleRemovePassword = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedWalletId) { showToast('error', "No account selected"); return; }
        if (!currentPassword) { showToast('error', 'Current password required.'); return; }
        setIsActionLoading(true);
        try {
            const requestBody = { RemoveSelectedWalletPassword: { current_password: currentPassword } };
            await callApiWithRouting(requestBody);
            handleSuccess('Password removed successfully. Account is now active/unlocked.');
            setCurrentPassword('');
        } catch (err: any) { handleError(err); }
        finally { setIsActionLoading(false); }
    };

    const handleSetLimits = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedWalletId) { showToast('error', "No account selected"); return; }
        setIsActionLoading(true);
        const limitsToSet: SpendingLimits = {
            maxPerCall: limitPerCall.trim() === '' ? null : limitPerCall.trim(),
            maxTotal: null,
            currency: 'USDC', // Defaulting to USDC here
        };
        try {
            const requestBody = { SetWalletLimits: { limits: limitsToSet } };
            await callApiWithRouting(requestBody);
            handleSuccess('Spending limits updated successfully.');
        } catch (err: any) { handleError(err); }
        finally { setIsActionLoading(false); }
    };

    const handleImport = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!privateKeyToImport) { showToast('error', 'Private Key is required for import.'); return; }
        setIsActionLoading(true);
        try {
            const requestBody = {
                ImportWallet: {
                    private_key: privateKeyToImport,
                    password: null,  // No password for imported wallets
                    name: walletNameToImport.trim() === '' ? null : walletNameToImport.trim()
                }
            };
            await callApiWithRouting(requestBody);
            handleSuccess(`Account imported successfully and ready to use.`);
            setShowImportForm(false);
            setPrivateKeyToImport(''); setPasswordForImport(''); setWalletNameToImport('');
        } catch (err: any) { handleError(err); }
        finally { setIsActionLoading(false); }
    };

    // --- Helper Functions ---
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

    // Helper to get clearer status text
    const getWalletDisplayStatus = (wallet: WalletSummary): string => {
        if (!wallet.is_active) {
            return "Inactive";
        }
        if (wallet.is_unlocked) {
            return "Active (Unlocked)";
        } else {
            return "Active (Locked)";
        }
    }

    // Modified handler for generating/copying API config
    const handleGenerateApiConfig = () => {
        setGenerationError(null); // Clear previous errors
        setCopied(false); // Reset copied status

        // If config already generated in this session, just re-copy
        if (apiConfigJson) {
            copyToClipboard(apiConfigJson);
            return; // Don't generate or save again
        }

        // Otherwise, proceed with generation and saving
        setIsGeneratingConfig(true);
        const newApiKey = generateApiKey(32);

        fetch(getApiBasePath() + '/save-shim-key', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ raw_key: newApiKey })
        })
            .then(response => {
                if (!response.ok) {
                    return response.json().then(errData => {
                        throw new Error(errData.error || `Failed to save API key: ${response.statusText}`);
                    }).catch(() => {
                        throw new Error(`Failed to save API key: ${response.statusText}`);
                    });
                }

                // Build config object locally for copying
                const serverUrl = window.location.origin + getApiBasePath(); // Get base API path like /.../api
                const configData = {
                    // URL should be the base API path, shim appends /shim/mcp
                    url: serverUrl,
                    key: newApiKey,
                    node: (window as any).our?.node || window.location.hostname
                };
                const jsonStringToCopy = JSON.stringify(configData, null, 2);

                // Store the generated config in state for potential re-copy
                setApiConfigJson(jsonStringToCopy);

                // Copy to clipboard
                copyToClipboard(jsonStringToCopy);
                setGenerationError(null);
            })
            .catch(err => {
                console.error("Error generating API config:", err);
                setGenerationError(`Failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
                setApiConfigJson(null); // Ensure state is cleared on error
            })
            .finally(() => {
                setIsGeneratingConfig(false);
            });
    };

    // Function to copy text to clipboard
    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }, (err) => {
            console.error('Failed to copy: ', err);
            setGenerationError('Failed to copy to clipboard.');
        });
    };

    // --- Render Logic ---
    if (isLoading) {
        return <div className="loading-message">Loading account data...</div>;
    }
    if (!isLoading && wallets.length === 0) {
        return (
            <div className="operator-wallet-content">
                <button onClick={handleRefresh} className="button refresh-button" disabled={isActionLoading}>
                    {isActionLoading ? 'Retrying...' : 'Retry'}
                </button>
            </div>
        );
    }

    const selectedWallet = getSelectedWalletSummary();

    return (
        <div className="operator-wallet-content">
            <section className="pt-6 mt-6 border-t border-gray-300">
                {wallets.length === 0 && !isLoading && (
                    <p className="text-gray-500 text-base p-6 text-center">No accounts found. Generate or import one below.</p>
                )}
                {wallets.length > 0 && (
                    <ul className="list-none p-0 m-0 border border-gray-300 rounded-md overflow-hidden mb-4">
                        {wallets.map(wallet => (
                            <li key={wallet.id} className={classNames(
                                "flex items-center px-4 py-3 border-b border-gray-300 bg-white last:border-b-0",
                                {
                                    "bg-blue-100 outline outline-2 outline-blue-500 outline-offset-[-1px]": wallet.is_selected
                                }
                            )}>
                                {/* Use CopyToClipboardText for address */}
                                <div
                                    className="flex flex-col gap-1 cursor-pointer flex-grow mr-4"
                                    onClick={() => handleSelectWallet(wallet.id)}
                                    title={`Select Account: ${wallet.name || wallet.address} (${getWalletDisplayStatus(wallet)})`}
                                >
                                    <span className={classNames(
                                        "font-medium text-base text-gray-900",
                                        {
                                            "font-semibold text-blue-800": wallet.is_selected
                                        }
                                    )}>{wallet.name || truncateString(wallet.address, 16)}</span>
                                    {/* Display address using CopyToClipboardText */}
                                    <CopyToClipboardText
                                        textToCopy={wallet.address}
                                        className={classNames(
                                            "text-sm text-gray-500",
                                            {
                                                "text-blue-800": wallet.is_selected
                                            }
                                        )}
                                    >
                                        {/* Pass truncated string as children */}
                                        <code title="">{truncateString(wallet.address)}</code>
                                    </CopyToClipboardText>
                                </div>

                                {/* --- Display Status Text (Read Only) --- */}
                                <div className="flex-shrink-0 ml-auto pl-4 text-right">
                                    <span
                                        className={classNames(
                                            "inline-block w-2 h-2 rounded-full mr-2",
                                            {
                                                "bg-green-600": wallet.is_active,
                                                "bg-gray-500": !wallet.is_active
                                            }
                                        )}
                                        title={getWalletDisplayStatus(wallet)}
                                    ></span>
                                    <span className="text-sm text-gray-600" title={getWalletDisplayStatus(wallet)}>
                                        {getWalletDisplayStatus(wallet)}
                                    </span>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
                {/* Minimalist Add Wallet Bar */}
                <div className="relative mt-0 p-0 border border-gray-300 border-t-0 text-center cursor-pointer h-11 flex justify-center items-center rounded-b-md bg-gray-50 transition-colors hover:bg-gray-200 group">
                    <span className="text-2xl text-gray-500 font-light transition-opacity group-hover:hidden">+</span>
                    <div className="absolute inset-0 flex items-stretch opacity-0 invisible transition-opacity transition-visibility group-hover:opacity-100 group-hover:visible group-hover:pointer-events-auto">
                        <button onClick={handleGenerateWallet} className="flex-grow flex-basis-0 bg-none border-none px-3 py-2 text-sm font-medium text-blue-600 rounded-none flex items-center justify-center text-center h-full hover:bg-blue-50 hover:text-blue-800 disabled:text-gray-500 disabled:bg-none disabled:opacity-65" disabled={isActionLoading}>
                            {isActionLoading ? 'Generating...' : 'Generate New Wallet'}
                        </button>
                        <button onClick={() => setShowImportForm(prev => !prev)} className="flex-grow flex-basis-0 bg-none border-none px-3 py-2 text-sm font-medium text-blue-600 rounded-none flex items-center justify-center text-center h-full hover:bg-blue-50 hover:text-blue-800 disabled:text-gray-500 disabled:bg-none disabled:opacity-65" disabled={isActionLoading}>
                            {showImportForm ? 'Cancel Import' : 'Import Wallet'}
                        </button>
                    </div>
                </div>

                {/* Import Wallet Form */}
                {showImportForm && (
                    <form onSubmit={handleImport} className="mt-4 pt-6 mt-6 border-t border-gray-300">
                        <h4 className="text-base font-medium mb-4 text-gray-700">Import Wallet</h4>
                        <input
                            type="text"
                            placeholder="Enter Private Key (0x...)"
                            value={privateKeyToImport}
                            onChange={e => setPrivateKeyToImport(e.target.value)}
                            required
                            className="mb-3 block w-full px-3 py-2 border border-gray-300 rounded-md text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                        <input
                            type="text"
                            placeholder="Account Name (Optional)"
                            value={walletNameToImport}
                            onChange={e => setWalletNameToImport(e.target.value)}
                            className="mb-3 block w-full px-3 py-2 border border-gray-300 rounded-md text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                        <p className="text-sm text-gray-500 my-2 italic">
                            ℹ️ Imported wallets are stored unencrypted for easier access
                        </p>
                        <button type="submit" className="w-full px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:bg-gray-300 disabled:cursor-not-allowed" disabled={isActionLoading}>
                            {isActionLoading ? 'Importing...' : 'Import Wallet'}
                        </button>
                    </form>
                )}
            </section>

            {/* --- Selected Account Configuration Section --- */}
            {selectedWallet && (
                <section className="pt-6 mt-6 border-t-2 border-blue-600">
                    <h3 className="text-xl mb-4 pb-3 border-b border-gray-300 text-gray-700 cursor-pointer flex justify-between items-center" onClick={() => setIsConfigExpanded(!isConfigExpanded)}>
                        Configure: {selectedWallet.name || truncateString(selectedWallet.address, 16)}
                        <span className="collapse-indicator">{isConfigExpanded ? '[-]' : '[+]'}</span>
                    </h3>
                    {isConfigExpanded && (
                        <div className="config-forms">

                            {/* --- Activation / Deactivation / Unlock Controls --- */}
                            <div className="config-form activation-section">
                                <h4>Account Status & Actions</h4>

                                {/* Case 1: Inactive */}
                                {!selectedWallet.is_active && (
                                    <div className="status-action-group">
                                        <span>Status: Inactive</span>
                                        {selectedWallet.is_encrypted && (
                                            <input
                                                type="password"
                                                className="activation-password-input"
                                                placeholder="Password to Activate"
                                                value={activationPassword[selectedWallet.id] || ''}
                                                onChange={e => setActivationPassword(prev => ({ ...prev, [selectedWallet.id]: e.target.value }))}
                                                disabled={isActionLoading}
                                            />
                                        )}
                                        <button
                                            onClick={() => handleActivate(selectedWallet.id)}
                                            className="button primary-button action-button"
                                            disabled={isActionLoading || (selectedWallet.is_encrypted && !activationPassword[selectedWallet.id])}
                                        >
                                            Activate
                                        </button>
                                    </div>
                                )}

                                {/* Case 2: Active (Locked) */}
                                {selectedWallet.is_active && selectedWallet.is_encrypted && (
                                    <div className="status-action-group">
                                        <span>Status: Active (Locked)</span>
                                        <input
                                            type="password"
                                            className="unlock-password-input"
                                            placeholder="Password to Unlock"
                                            value={activationPassword[selectedWallet.id] || ''}
                                            onChange={e => setActivationPassword(prev => ({ ...prev, [selectedWallet.id]: e.target.value }))}
                                            disabled={isActionLoading}
                                        />
                                        <button
                                            onClick={() => handleActivate(selectedWallet.id)} // handleActivate performs unlock
                                            className="button primary-button action-button"
                                            disabled={isActionLoading || !activationPassword[selectedWallet.id]}
                                        >
                                            Unlock
                                        </button>
                                        <button
                                            onClick={() => handleDeactivate(selectedWallet.id)}
                                            className="button action-button"
                                            disabled={isActionLoading}
                                        >
                                            Deactivate
                                        </button>
                                    </div>
                                )}

                                {/* Case 3: Active (Unencrypted) */}
                                {selectedWallet.is_active && !selectedWallet.is_encrypted && (
                                    <div className="status-action-group">
                                        <span>Status: Active</span>
                                        <button
                                            onClick={() => handleDeactivate(selectedWallet.id)}
                                            className="button action-button"
                                            disabled={isActionLoading}
                                        >
                                            Deactivate
                                        </button>
                                    </div>
                                )}
                            </div>
                            {/* --- End Status Controls --- */}

                            {/* Keep existing config forms (Password, Limits, Export, Rename, Delete) */}
                            {/* Rename Button (Moved here) */}
                            <div className="config-form">
                                <h4>Rename Account</h4>
                                {walletToRename === selectedWallet.id ? (
                                    <form onSubmit={handleRenameWallet} className="rename-form">
                                        <input type="text" value={renameInput} onChange={(e) => setRenameInput(e.target.value)} autoFocus />
                                        <button type="submit" className="button save-rename-button" disabled={isActionLoading}>Save</button>
                                        <button type="button" onClick={() => setWalletToRename(null)} className="button cancel-rename-button" disabled={isActionLoading}>Cancel</button>
                                    </form>
                                ) : (
                                    <button onClick={() => startRename(selectedWallet.id)} className="button action-button" disabled={isActionLoading}>Rename {selectedWallet.name || truncateString(selectedWallet.address, 16)}</button>
                                )}
                            </div>
                            {/* Set/Change Password Form */}
                            <form onSubmit={handleSetPassword} className="config-form">
                                <h4>{selectedWallet.is_encrypted ? 'Change' : 'Set'} Password</h4>
                                {selectedWallet.is_encrypted && (
                                    <input
                                        type="password"
                                        placeholder="Current Password"
                                        value={currentPassword}
                                        onChange={e => setCurrentPassword(e.target.value)}
                                        required
                                        className="input-field"
                                    />
                                )}
                                <input
                                    type="password"
                                    placeholder="New Password"
                                    value={newPassword}
                                    onChange={e => setNewPassword(e.target.value)}
                                    required
                                    className="input-field"
                                />
                                <input
                                    type="password"
                                    placeholder="Confirm New Password"
                                    value={confirmPassword}
                                    onChange={e => setConfirmPassword(e.target.value)}
                                    required
                                    className="input-field"
                                />
                                <button type="submit" className="button action-button" disabled={isActionLoading}>
                                    {isActionLoading ? 'Saving...' : (selectedWallet.is_encrypted ? 'Change Password' : 'Set Password')}
                                </button>
                            </form>
                            {/* Remove Password Form */}
                            {selectedWallet.is_encrypted && (
                                <form onSubmit={handleRemovePassword} className="config-form">
                                    <h4>Remove Password</h4>
                                    <input
                                        type="password"
                                        placeholder="Current Password"
                                        value={currentPassword}
                                        onChange={e => setCurrentPassword(e.target.value)}
                                        required
                                        className="input-field"
                                    />
                                    <button type="submit" className="button action-button" disabled={isActionLoading}>
                                        {isActionLoading ? 'Removing...' : 'Remove Password'}
                                    </button>
                                </form>
                            )}
                            {/* Set Spending Limits Form */}
                            <form onSubmit={handleSetLimits} className="config-form">
                                <h4>Spending Limits</h4>
                                <input
                                    type="number"
                                    step="any"
                                    min="0"
                                    placeholder="Max Per Call (e.g., 0.01)"
                                    value={limitPerCall}
                                    onChange={e => setLimitPerCall(e.target.value)}
                                    className="input-field"
                                />
                                <input
                                    type="text"
                                    placeholder="Currency (e.g., USDC)"
                                    value={limitCurrency}
                                    onChange={e => setLimitCurrency(e.target.value)}
                                    className="input-field"
                                />
                                <button type="submit" className="button action-button" disabled={isActionLoading}>
                                    {isActionLoading ? 'Saving...' : 'Set Limits'}
                                </button>
                            </form>
                            {/* Export Private Key Section */}
                            <div className="config-form">
                                <h4>Export Private Key</h4>
                                {selectedWallet.is_encrypted && !selectedWallet.is_active && (
                                    <input
                                        type="password"
                                        placeholder="Current Password (if inactive/locked)"
                                        value={currentPassword}
                                        onChange={e => setCurrentPassword(e.target.value)}
                                        className="input-field"
                                    />
                                )}
                                <button onClick={handleExportKey} className="button action-button" disabled={isActionLoading}>
                                    {isActionLoading ? 'Exporting...' : 'Reveal Private Key'}
                                </button>
                                {revealedPrivateKey && (
                                    <div className="revealed-key">
                                        <p><strong>Private Key:</strong></p>
                                        <code style={{ wordBreak: 'break-all' }}>{revealedPrivateKey}</code>
                                        <button onClick={() => setRevealedPrivateKey(null)} className="button close-reveal-button">Hide</button>
                                    </div>
                                )}
                            </div>
                            {/* Delete Button (Moved here) */}
                            <div className="config-form delete-section">
                                <h4>Delete Account</h4>
                                <p className="warning-text">This action cannot be undone.</p>
                                <button
                                    onClick={() => handleDeleteWallet(selectedWallet.id)}
                                    className="button delete-button action-button"
                                    disabled={isActionLoading}
                                >
                                    Delete {selectedWallet.name || truncateString(selectedWallet.address, 16)}
                                </button>
                            </div>
                        </div>
                    )}
                </section>
            )}

            {/* --- Modified API Config Section --- */}
            <div className="config-form api-config-section" style={{ marginTop: '20px', borderTop: '1px solid #eee', paddingTop: '15px' }}>
                <h4>Shim API Configuration</h4>
                <p style={{ fontSize: '0.9em', color: '#666', marginBottom: '10px' }}>
                    Generate and copy an API key configuration for use with the Hypergrid MCP Shim (npx).
                    Save this configuration as `grid-shim-api.json` in the directory where you run the shim.
                    Generating a new config will invalidate any previous one.
                </p>
                <button
                    onClick={handleGenerateApiConfig}
                    disabled={isGeneratingConfig}
                    className="button secondary-button"
                >
                    {/* Button text depends on if config exists and copy status */}
                    {isGeneratingConfig ? 'Generating...' :
                        (copied ? '✅ Copied!' :
                            (apiConfigJson ? 'Copy Existing Config' : 'Generate & Copy Config'))}
                </button>

                {generationError && <p className="error-message" style={{ marginTop: '10px' }}>{generationError}</p>}
            </div>
            {/* --- End Modified API Config Section --- */}
        </div>
    );
}

export default AccountManager; 
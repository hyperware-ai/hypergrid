import React, { useState, useCallback, useEffect, useRef } from 'react';
import classNames from 'classnames';
import { IHotWalletNodeData, SpendingLimits } from '../../logic/types';
import type { Address } from 'viem';
import CopyToClipboardText from '../CopyToClipboardText'; // If needed for displaying info within modal

interface HotWalletSettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    walletData: IHotWalletNodeData | null;
    // Callback to inform parent that an update happened so graph can be refreshed
    onWalletUpdate: (walletAddress: Address) => void;
}

// Helper function to truncate text (can be moved to a utils file)
const truncate = (str: string | undefined | null, startLen = 6, endLen = 4) => {
    if (!str) return '';
    if (str.length <= startLen + endLen + 3) return str;
    return `${str.substring(0, startLen)}...${str.substring(str.length - endLen)}`;
};

// Define getApiBasePath and callMcpApi locally 
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
        throw new Error(data.error || `API Error: ${response.statusText}`);
    }
    return data;
};


const HotWalletSettingsModal: React.FC<HotWalletSettingsModalProps> = ({
    isOpen,
    onClose,
    walletData,
    onWalletUpdate,
}) => {
    const [limitPerCall, setLimitPerCall] = useState<string>('');
    // const [limitCurrency, setLimitCurrency] = useState<string>('USDC'); // Currency is now fixed

    const [editedName, setEditedName] = useState<string>('');
    const [isEditingName, setIsEditingName] = useState<boolean>(false);

    const [isActionLoading, setIsActionLoading] = useState<boolean>(false);
    const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

    const [currentLimits, setCurrentLimits] = useState<SpendingLimits | null>(null);
    const [currentName, setCurrentName] = useState<string | null>(null);
    const [isEncrypted, setIsEncrypted] = useState<boolean>(false);
    const [isUnlocked, setIsUnlocked] = useState<boolean>(false);
    const nameInputRef = useRef<HTMLInputElement>(null); // Ref for focusing the input

    useEffect(() => {
        if (walletData) {
            setCurrentLimits(walletData.limits);
            setLimitPerCall(walletData.limits?.maxPerCall || '');
            // setLimitCurrency(walletData.limits?.currency || 'USDC'); // Removed
            setCurrentName(walletData.name);
            setEditedName(walletData.name || '');
            setIsEditingName(false);
            setIsEncrypted(walletData.isEncrypted);
            setIsUnlocked(walletData.isUnlocked);
        }
    }, [walletData]);

    // Focus input when isEditingName becomes true
    useEffect(() => {
        if (isEditingName && nameInputRef.current) {
            nameInputRef.current.focus();
            nameInputRef.current.select();
        }
    }, [isEditingName]);

    const showToast = useCallback((type: 'success' | 'error', text: string, duration: number = 3000) => {
        setToastMessage({ type, text });
        const timer = setTimeout(() => {
            setToastMessage(null);
        }, duration);
        return () => clearTimeout(timer);
    }, []);

    const handleSuccess = (msg: string, actionCallback?: () => void) => {
        showToast('success', msg);
        if (actionCallback) actionCallback();
        if (walletData) {
            onWalletUpdate(walletData.address);
        }
    };

    const handleError = (err: any, actionContext?: string) => {
        const errorMessage = err instanceof Error ? err.message : 'An unknown API error occurred';
        showToast('error', actionContext ? `${actionContext}: ${errorMessage}` : errorMessage);
    };

    const selectAndExecute = async (
        actionNameForContext: string,
        actionPayload: any,
        successMessage: string,
        successCallback?: () => void
    ) => {
        if (!walletData) return;
        setIsActionLoading(true);
        setToastMessage(null);
        try {
            await callMcpApi(MCP_ENDPOINT, { SelectWallet: { wallet_id: walletData.address } });
            await callMcpApi(MCP_ENDPOINT, actionPayload);
            handleSuccess(successMessage, successCallback);
        } catch (err: any) {
            handleError(err, actionNameForContext);
        } finally {
            setIsActionLoading(false);
        }
    };

    const handleRenameWallet = async () => { // No longer takes event
        if (!walletData || !editedName.trim() || editedName.trim() === currentName) {
            setIsEditingName(false);
            setEditedName(currentName || ''); // Reset if no change or empty
            return;
        }
        setIsActionLoading(true); setToastMessage(null);
        try {
            const requestBody = { RenameWallet: { wallet_id: walletData.address, new_name: editedName.trim() } };
            await callMcpApi(MCP_ENDPOINT, requestBody);
            handleSuccess(`Wallet renamed to "${editedName.trim()}".`, () => {
                setCurrentName(editedName.trim());
                setIsEditingName(false);
            });
        } catch (err: any) {
            handleError(err, 'Rename Wallet');
            setEditedName(currentName || ''); // Revert on error
            setIsEditingName(false); // Exit editing mode on error too
        } finally {
            setIsActionLoading(false);
        }
    };

    const handleNameInputBlur = () => {
        // Save if name changed and not empty, otherwise just exit editing mode reverting
        if (editedName.trim() !== currentName && editedName.trim() !== '') {
            handleRenameWallet();
        } else {
            setEditedName(currentName || ''); // Revert to original
            setIsEditingName(false);
        }
    };

    const handleNameInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter') {
            event.preventDefault(); // Prevent form submission if inside one
            handleRenameWallet();
        }
        if (event.key === 'Escape') {
            setEditedName(currentName || '');
            setIsEditingName(false);
        }
    };

    const handleSetLimits = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!walletData) return;
        const limitsToSet: SpendingLimits = {
            maxPerCall: limitPerCall.trim() === '' ? null : limitPerCall.trim(),
            maxTotal: null,
            currency: 'USDC', // Currency is now fixed to USDC
        };
        const payload = { SetWalletLimits: { limits: limitsToSet } };
        await selectAndExecute(
            'Set Limits', payload,
            'Spending limits updated successfully.',
            () => setCurrentLimits(limitsToSet)
        );
    };

    const handleNameDisplayClick = () => {
        console.log('HotWalletSettingsModal: Name display clicked. Current isEditingName:', isEditingName);
        setIsEditingName(true);
    };

    if (!isOpen || !walletData) return null;

    const limitsDisabled = isActionLoading || (isEncrypted && !isUnlocked);

    return (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50" onClick={onClose}>
            <div className="bg-gray-700 text-gray-100 p-6 rounded-lg w-[90%] max-w-2xl max-h-[85vh] overflow-y-auto relative shadow-xl border border-gray-600" onClick={(e) => e.stopPropagation()}>
                <button className="absolute top-2 right-4 bg-transparent border-none text-gray-100 text-3xl cursor-pointer leading-none" onClick={onClose}>&times;</button>
                <h3 className="mt-0 text-gray-400 border-b border-gray-600 pb-2 mb-5 text-xl">Hot Wallet Settings: {truncate(currentName || walletData.address, 15, 6)}</h3>

                {toastMessage && (
                    <div className={classNames(
                        "px-4 py-3 my-4 rounded text-sm text-center",
                        {
                            "bg-green-600 text-white border border-green-700": toastMessage.type === 'success',
                            "bg-red-600 text-white border border-red-700": toastMessage.type === 'error'
                        }
                    )}>
                        {toastMessage.text}
                    </div>
                )}

                {/* Rename Form - Click-to-edit */}
                <div className="mb-5 pb-4 border-b border-gray-600">
                    <h4 className="mt-0 mb-3 text-lg text-gray-300">Rename Wallet</h4>
                    {isEditingName ? (
                        <input
                            ref={nameInputRef}
                            type="text"
                            value={editedName}
                            onChange={(e) => setEditedName(e.target.value)}
                            onBlur={handleNameInputBlur}
                            onKeyDown={handleNameInputKeyDown}
                            className="px-2 py-2 rounded border border-gray-600 bg-gray-800 text-gray-100 text-sm"
                            disabled={isActionLoading}
                        />
                    ) : (
                        <div className="flex justify-between items-center py-1 cursor-text" title="Click to edit name" onClick={handleNameDisplayClick}>
                            <span>Name: <strong>{currentName || '(No name set)'}</strong></span>
                            {/* Edit button removed, click text instead */}
                        </div>
                    )}
                </div>

                {/* Spending Limits - Compact UI */}
                <div className="mb-5 pb-4 border-b border-gray-600">
                    <h4 className="mt-0 mb-3 text-lg text-gray-300">Spending Limits (USDC)</h4>
                    {(isEncrypted && !isUnlocked) && (
                        <p className="text-orange-400 text-sm mb-2">Wallet is locked. Unlock to change spending limits.</p>
                    )}
                    <form onSubmit={handleSetLimits} className="flex items-center gap-2">
                        <input
                            type="number"
                            step="any"
                            min="0"
                            placeholder="Max Per Call"
                            value={limitPerCall}
                            onChange={e => setLimitPerCall(e.target.value)}
                            className="flex-grow px-2 py-2 rounded border border-gray-600 bg-gray-800 text-gray-100 text-sm min-w-24"
                            disabled={limitsDisabled}
                            onClick={(e) => e.stopPropagation()} // Good to have on inputs too
                        />
                        <button
                            type="submit"
                            className="px-5 py-2 rounded border-none cursor-pointer text-sm bg-green-600 text-white transition-colors hover:bg-green-700 disabled:bg-gray-600 disabled:opacity-60 disabled:cursor-not-allowed"
                            disabled={limitsDisabled}
                            onClick={(e) => e.stopPropagation()} // Prevent modal close if form is part of a clickable area
                        >
                            OK
                        </button>
                    </form>
                </div>

            </div>
        </div>
    );
};

export default HotWalletSettingsModal; 
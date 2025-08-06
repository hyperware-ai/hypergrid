import React, { useState, useCallback, useEffect, useRef } from 'react';
import classNames from 'classnames';
import { IHotWalletNodeData, SpendingLimits } from '../../logic/types';
import type { Address } from 'viem';
import { truncate } from '../../utils/truncate';
import { useErrorLogStore } from '../../store/errorLog';
import { toast } from 'react-toastify';
import Modal from './Modal';
import { HiLockClosed, HiLockOpen } from 'react-icons/hi';
import { BsFillLockFill, BsUnlockFill } from 'react-icons/bs';

interface HotWalletSettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    walletData: IHotWalletNodeData | null;
    // Callback to inform parent that an update happened so graph can be refreshed
    onWalletUpdate: (walletAddress: Address) => void;
    // Unlock/lock wallet functionality
    onUnlockWallet: (walletAddress: Address, passwordInput: string) => Promise<void>;
    onLockWallet: (walletAddress: Address) => Promise<void>;
    isUnlockingOrLocking?: boolean;
}


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
    onUnlockWallet,
    onLockWallet,
    isUnlockingOrLocking,
}) => {
    const { showToast } = useErrorLogStore();
    const [limitPerCall, setLimitPerCall] = useState<string>('');
    // const [limitCurrency, setLimitCurrency] = useState<string>('USDC'); // Currency is now fixed

    const [editedName, setEditedName] = useState<string>('');
    const [isEditingName, setIsEditingName] = useState<boolean>(false);

    const [isActionLoading, setIsActionLoading] = useState<boolean>(false);

    const [currentLimits, setCurrentLimits] = useState<SpendingLimits | null>(null);
    const [currentName, setCurrentName] = useState<string | null>(null);
    const [isEncrypted, setIsEncrypted] = useState<boolean>(false);
    const [isUnlocked, setIsUnlocked] = useState<boolean>(false);
    const nameInputRef = useRef<HTMLInputElement>(null); // Ref for focusing the input

    // Unlock/Lock wallet state
    const [passwordInput, setPasswordInput] = useState<string>('');
    const [showPasswordInputForUnlock, setShowPasswordInputForUnlock] = useState<boolean>(false);

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
            setPasswordInput('');
            setShowPasswordInputForUnlock(false);
        }
    }, [walletData]);

    // Focus input when isEditingName becomes true
    useEffect(() => {
        if (isEditingName && nameInputRef.current) {
            nameInputRef.current.focus();
            nameInputRef.current.select();
        }
    }, [isEditingName]);

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
        setIsActionLoading(true);
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

    // Unlock/Lock wallet handlers
    const handleUnlockWalletAttempt = async () => {
        if (isEncrypted && !passwordInput) {
            showToast('error', 'Password is required to unlock encrypted wallet.');
            return;
        }
        try {
            await onUnlockWallet(walletData!.address, passwordInput);
            setPasswordInput('');
            setShowPasswordInputForUnlock(false);
            showToast('success', 'Unlock request sent.');
        } catch (err: any) {
            showToast('error', err.message || 'Failed to send unlock request');
        }
    };

    const handleLockWallet = async () => {
        try {
            await onLockWallet(walletData!.address);
            showToast('success', 'Lock request sent.');
        } catch (err: any) {
            showToast('error', err.message || 'Failed to send lock request');
        }
    };

    const handleLockIconClick = () => {
        if (isEncrypted && !isUnlocked) {
            setShowPasswordInputForUnlock(true);
        } else if (isUnlocked) {
            handleLockWallet();
        }
    };

    const isWalletLocked = isEncrypted && !isUnlocked;

    if (!isOpen || !walletData) return null;

    const limitsDisabled = isActionLoading || (isEncrypted && !isUnlocked);

    return (
        <Modal
            title={`Hot Wallet Settings: ${truncate(currentName || walletData.address, 15, 6)}`}
            onClose={onClose}
            preventAccidentalClose={true}
        >
            <h4 className="font-bold">Wallet Name </h4>
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
                disabled={isActionLoading}
            />

            <h4 className="font-bold">Spending Limits (USDC)</h4>
            {(isEncrypted && !isUnlocked) && (
                <p className="text-orange-400 text-sm">Wallet is locked. Unlock to change spending limits.</p>
            )}
            <form
                onSubmit={handleSetLimits}
                className="flex items-center gap-2"
            >
                <input
                    type="number"
                    step="any"
                    min="0"
                    placeholder="Max Per Call (USDC)"
                    value={limitPerCall}
                    onChange={e => setLimitPerCall(e.target.value)}
                    className="p-2 rounded bg-dark-gray/5 grow"
                    disabled={limitsDisabled}
                    onClick={(e) => e.stopPropagation()} // Good to have on inputs too
                />
                <button
                    type="submit"
                    className="p-2 rounded bg-green-600 text-white hover:bg-green-700"
                    disabled={limitsDisabled}
                    onClick={(e) => e.stopPropagation()} // Prevent modal close if form is part of a clickable area
                >
                    OK
                </button>
            </form>
            <h4 className="text-lg flex justify-between items-center gap-2">
                <p>
                    Status: {isWalletLocked ? 'Locked' : 'Unlocked'}
                    {isEncrypted && !isUnlocked && ' (Encrypted)'}
                </p>
                <button
                    onClick={handleLockIconClick}
                    title={isWalletLocked ? "Wallet Locked. Click to Unlock." : "Wallet Unlocked. Click to Lock."}
                    disabled={isActionLoading || isUnlockingOrLocking}
                    className="p-2 bg-black text-white hover:bg-white hover:!border-black hover:text-black"
                >
                    {isWalletLocked ? <BsFillLockFill /> : <BsUnlockFill />}
                    <span className="text-sm">{isWalletLocked ? 'Unlock' : 'Lock'} wallet</span>
                </button>
            </h4>

            {showPasswordInputForUnlock && isWalletLocked && <>
                <h5 className="text-sm font-medium text-yellow-400">
                    {isEncrypted ? 'Unlock' : 'Activate'} Wallet
                </h5>
                {isEncrypted && (
                    <input
                        type="password"
                        placeholder="Enter Password"
                        value={passwordInput}
                        onChange={(e) => setPasswordInput(e.target.value)}
                        className="p-2 rounded bg-dark-gray/5"
                        disabled={isActionLoading || isUnlockingOrLocking}
                        autoFocus
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                handleUnlockWalletAttempt();
                            }
                        }}
                    />
                )}
                {!isEncrypted && (
                    <p className=" text-sm opacity-50">
                        This wallet needs to be activated for use.
                    </p>
                )}
                <div className="flex gap-2">
                    <button
                        onClick={handleUnlockWalletAttempt}
                        disabled={isActionLoading || isUnlockingOrLocking || (isEncrypted && !passwordInput)}
                        className="px-3 py-1 bg-green-600 text-white hover:bg-green-700"
                    >
                        {isUnlockingOrLocking ? (isEncrypted ? 'Unlocking...' : 'Activating...') : (isEncrypted ? 'Unlock' : 'Activate')}
                    </button>
                    <button
                        onClick={() => { setShowPasswordInputForUnlock(false); setPasswordInput(''); }}
                        className="px-3 py-1 bg-gray-600 text-white hover:bg-gray-700"
                        disabled={isActionLoading || isUnlockingOrLocking}
                    >
                        Cancel
                    </button>
                </div>
            </>}
        </Modal>
    );
};

export default HotWalletSettingsModal; 
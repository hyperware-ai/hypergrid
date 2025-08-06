import React, { useState, useCallback, useEffect, useRef } from 'react';
import classNames from 'classnames';
import { NodeProps, Handle, Position } from 'reactflow';
import { IHotWalletNodeData, SpendingLimits } from '../../logic/types';
import type { Address } from 'viem';
import CopyToClipboardText from '../CopyToClipboardText';
import { truncate } from '../../utils/truncate';
import { useErrorLogStore } from '../../store/errorLog';
import BaseNodeComponent from './BaseNodeComponent';
import { HiLockClosed, HiLockOpen } from 'react-icons/hi';
import { SlClock, SlPencil } from 'react-icons/sl';


// Prop for callback when wallet data is updated from modal
interface HotWalletNodeComponentProps extends NodeProps<IHotWalletNodeData> {
    onWalletDataUpdate: (walletAddress: Address) => void;
    onOpenHistoryModal: (walletAddress: Address) => void;
    onOpenSettingsModal: () => void; // New prop to open settings modal
    onUnlockWallet: (walletAddress: Address, passwordInput: string) => Promise<void>;
    onLockWallet: (walletAddress: Address) => Promise<void>;
    isUnlockingOrLocking?: boolean;
}

const HotWalletNodeComponent: React.FC<HotWalletNodeComponentProps> = ({ data, id: nodeId, onWalletDataUpdate, onOpenHistoryModal, onOpenSettingsModal, onUnlockWallet, onLockWallet, isUnlockingOrLocking }) => {
    const { showToast } = useErrorLogStore();
    const {
        address,
        statusDescription,
        fundingInfo,
        isEncrypted: initialIsEncrypted,
        isUnlocked: initialIsUnlocked,
        limits: initialLimits,
        name: initialName
    } = data;

    // Simplified state - only what's needed for display and lock functionality
    const [isEncrypted, setIsEncrypted] = useState<boolean>(initialIsEncrypted);
    const [isUnlocked, setIsUnlocked] = useState<boolean>(initialIsUnlocked);
    const [passwordInput, setPasswordInput] = useState<string>('');
    const [showPasswordInputForUnlock, setShowPasswordInputForUnlock] = useState<boolean>(false);

    useEffect(() => {
        // Only update encryption status if it changed
        if (isEncrypted !== initialIsEncrypted) {
            setIsEncrypted(initialIsEncrypted);
        }

        // Only update unlock status if it changed
        if (isUnlocked !== initialIsUnlocked) {
            setIsUnlocked(initialIsUnlocked);
        }

        // Reset password and unlock modal state on prop changes
        setPasswordInput('');
        setShowPasswordInputForUnlock(false);
    }, [initialIsEncrypted, initialIsUnlocked, isEncrypted, isUnlocked]);




    const handleUnlockWalletAttempt = async () => {
        // For unencrypted wallets that need activation, we don't require a password
        if (isEncrypted && !passwordInput) {
            showToast('error', 'Password is required to unlock encrypted wallet.');
            return;
        }
        try {
            await onUnlockWallet(address, passwordInput);
            setPasswordInput('');
            showToast('success', 'Unlock request sent.');
        } catch (err: any) {
            showToast('error', err.message || 'Failed to send unlock request');
        }
    };



    const handleLockIconClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        console.log('handleLockIconClick', e);
        setShowPasswordInputForUnlock(true);
    };

    const handleUnlockAction = async () => {
        if (showPasswordInputForUnlock) {
            await handleUnlockWalletAttempt();
            // setShowPasswordInputForUnlock(false); // Optional: parent refresh handles this by isUnlocked change
        }
    };

    const isWalletLocked = isEncrypted && !isUnlocked;



    return (
        <BaseNodeComponent
            showHandles={{ target: true, source: true }}
        >
            <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
                <button
                    onClick={(e) => { e.stopPropagation(); onOpenSettingsModal(); }}
                    title="Open Settings"
                    className="text-lg hover:text-gray-300"
                >
                    <SlPencil />
                </button>
                <button
                    onClick={handleLockIconClick}
                    title={isWalletLocked ? "Wallet Locked. Click to Unlock." : "Wallet Unlocked. Click to Lock."}
                    className="text-xl hover:text-gray-300"
                >
                    {isWalletLocked ? <HiLockClosed /> : <HiLockOpen />}
                </button>
            </div>


            <div className={classNames("flex flex-col", { "blur-sm": isWalletLocked && !showPasswordInputForUnlock })}>
                <div className="font-bold">
                    <span>Hot Wallet</span>
                </div>

                <span>
                    {(initialName && initialName.toLowerCase() !== 'unnamed')
                        ? `"${initialName}"`
                        : truncate(address)}
                </span>

                <div className="text-sm leading-relaxed flex justify-between items-center">
                    <span className="text-gray-400 mr-2 whitespace-nowrap">Address:</span>
                    <span className="text-gray-300 break-all text-right flex-grow" onClick={(e) => e.stopPropagation()}>
                        <CopyToClipboardText textToCopy={address || ''} className="text-blue-400 cursor-pointer no-underline hover:underline">
                            {truncate(address)}
                        </CopyToClipboardText>
                    </span>
                </div>

                <div className="text-sm leading-relaxed flex justify-between items-center">
                    <span className="text-gray-400 mr-2 whitespace-nowrap">Status:</span>
                    <span className="text-gray-300 text-right flex-grow">{statusDescription || '-'}</span>
                </div>

                {fundingInfo?.errorMessage && (
                    <div className="text-sm leading-relaxed flex justify-between items-center">
                        <span className="text-gray-400 mr-2"></span>
                        <span className="text-red-400 text-sm ">{fundingInfo.errorMessage}</span>
                    </div>
                )}

                <div className="text-sm leading-relaxed flex justify-between items-center">
                    <span className="text-gray-400 mr-2 whitespace-nowrap">Transaction Limit:</span>
                    <span className="text-gray-300 text-right flex-grow">
                        {(initialLimits && initialLimits.maxPerCall && initialLimits.maxPerCall.trim() !== '')
                            ? `${initialLimits.maxPerCall} ${(initialLimits.currency || 'USDC')}`
                            : 'Unlimited'
                        }
                    </span>
                </div>

                <div className="text-sm leading-relaxed flex justify-between items-center">
                    <span className="text-gray-400 mr-2 whitespace-nowrap">Spending Limit:</span>
                    <span className="text-gray-300 text-right flex-grow">
                        {(initialLimits && initialLimits.maxTotal && initialLimits.maxTotal.trim() !== '')
                            ? `${initialLimits.maxTotal} ${(initialLimits.currency || 'USDC')} total`
                            : 'Unlimited'
                        }
                    </span>
                </div>

                {initialLimits && (
                    <div className="text-sm leading-relaxed flex justify-between items-center">
                        <span className="text-gray-400 mr-2 whitespace-nowrap">Total Spent:</span>
                        <span className="text-gray-300 text-right flex-grow">
                            {initialLimits.totalSpent || '0'} {(initialLimits.currency || 'USDC')}
                        </span>
                    </div>
                )}
            </div>

            {showPasswordInputForUnlock && isWalletLocked && (
                <div className="mt-2 pt-2 border-t border-gray-600" onClick={(e) => e.stopPropagation()}>
                    <h4 className="text-base font-medium mb-1 text-center" style={{ color: '#ffff00' }}>
                        {isEncrypted ? 'Unlock' : 'Activate'} Wallet: {initialName || truncate(address)}
                    </h4>
                    {isEncrypted && (
                        <input
                            type="password"
                            placeholder="Enter Password"
                            value={passwordInput}
                            onChange={(e) => setPasswordInput(e.target.value)}
                            className="flex-grow mr-2 bg-gray-800 text-gray-100 border border-gray-600 rounded px-2 py-1 text-sm w-full box-border"
                            disabled={isUnlockingOrLocking}
                            autoFocus
                        />
                    )}
                    {!isEncrypted && (
                        <p className="mb-2 text-sm text-gray-500">
                            This wallet needs to be activated for use.
                        </p>
                    )}
                    <div className="flex gap-2 mt-2">
                        <button
                            onClick={handleUnlockAction}
                            disabled={isUnlockingOrLocking || (isEncrypted && !passwordInput)}
                            className="px-3 py-1.5 rounded text-sm bg-green-600 text-white transition-colors hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed disabled:opacity-70"
                        >
                            {isUnlockingOrLocking ? (isEncrypted ? 'Unlocking...' : 'Activating...') : (isEncrypted ? 'Unlock' : 'Activate')}
                        </button>
                        <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setShowPasswordInputForUnlock(false); setPasswordInput(''); }}
                            className="px-3 py-1.5 rounded text-sm bg-gray-600 text-white transition-colors hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-70"
                            disabled={isUnlockingOrLocking}
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            <button
                onClick={() => onOpenHistoryModal(address)}
                className="self-stretch bg-mid-gray/25 hover:bg-black hover:text-white  justify-center p-1"
            >
                <SlClock className="text-xl" />
                <span>Call History</span>
            </button>
        </BaseNodeComponent>
    );
};

export default HotWalletNodeComponent; 
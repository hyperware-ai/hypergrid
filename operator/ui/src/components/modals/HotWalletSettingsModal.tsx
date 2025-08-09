import React, { useState, useCallback, useEffect, useRef } from 'react';
import classNames from 'classnames';
import { IHotWalletNodeData, SpendingLimits } from '../../logic/types';
import type { Address } from 'viem';
import { truncate } from '../../utils/truncate';
import { useErrorLogStore } from '../../store/errorLog';
import { toast } from 'react-toastify';
import Modal from './Modal';
import { callApiWithRouting } from '../../utils/api-endpoints';
// lock icons removed

interface HotWalletSettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    walletData: IHotWalletNodeData | null;
    // Callback to inform parent that an update happened so graph can be refreshed
    onWalletUpdate: (walletAddress: Address) => void;
}


// Use centralized router for API calls
const callApi = async (body: any) => callApiWithRouting(body);


const HotWalletSettingsModal: React.FC<HotWalletSettingsModalProps> = ({
    isOpen,
    onClose,
    walletData,
    onWalletUpdate,
}) => {
    const { showToast } = useErrorLogStore();
    const [limitPerCall, setLimitPerCall] = useState<string>('');
    const [limitTotal, setLimitTotal] = useState<string>('');
    // const [limitCurrency, setLimitCurrency] = useState<string>('USDC'); // Currency is now fixed

    const [editedName, setEditedName] = useState<string>('');
    const [isEditingName, setIsEditingName] = useState<boolean>(false);

    const [isActionLoading, setIsActionLoading] = useState<boolean>(false);

    const [currentLimits, setCurrentLimits] = useState<SpendingLimits | null>(null);
    const [currentName, setCurrentName] = useState<string | null>(null);
    const [isEncrypted, setIsEncrypted] = useState<boolean>(false);
    const nameInputRef = useRef<HTMLInputElement>(null); // Ref for focusing the input


    useEffect(() => {
        if (walletData) {
            setCurrentLimits(walletData.limits);
            setLimitPerCall(walletData.limits?.maxPerCall || '');
            setLimitTotal(walletData.limits?.maxTotal || '');
            // setLimitCurrency(walletData.limits?.currency || 'USDC'); // Removed
            setCurrentName(walletData.name);
            setEditedName(walletData.name || '');
            setIsEditingName(false);
            setIsEncrypted(walletData.isEncrypted);
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
            await callApi({ SelectWallet: { wallet_id: walletData.address } });
            await callApi(actionPayload);
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
            await callApi(requestBody);
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
            maxTotal: limitTotal.trim() === '' ? null : limitTotal.trim(),
            currency: 'USDC',
        };
        const payload = { SetWalletLimits: { limits: limitsToSet } };
        await selectAndExecute(
            'Set Limits', payload,
            'Spending limits updated successfully.',
            () => {
                setCurrentLimits(limitsToSet);
                // Close settings after successful save to avoid reopening modal on refresh
                onClose();
            }
        );
    };

    const handleNameDisplayClick = () => {
        console.log('HotWalletSettingsModal: Name display clicked. Current isEditingName:', isEditingName);
        setIsEditingName(true);
    };



    if (!isOpen || !walletData) return null;

    const limitsDisabled = isActionLoading; // no lock gating in UI

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
            <form onSubmit={handleSetLimits} className="flex items-center gap-2">
                <input
                    type="number"
                    step="any"
                    min="0"
                    placeholder="Max Per Call (USDC)"
                    value={limitPerCall}
                    onChange={e => setLimitPerCall(e.target.value)}
                    className="p-2 rounded bg-dark-gray/5 grow"
                    disabled={limitsDisabled}
                    onClick={(e) => e.stopPropagation()}
                />
                <input
                    type="number"
                    step="any"
                    min="0"
                    placeholder="Max Total (USDC)"
                    value={limitTotal}
                    onChange={e => setLimitTotal(e.target.value)}
                    className="p-2 rounded bg-dark-gray/5 grow"
                    disabled={limitsDisabled}
                    onClick={(e) => e.stopPropagation()}
                />
                <button
                    type="submit"
                    className="p-2 rounded bg-green-600 text-white hover:bg-green-700"
                    disabled={limitsDisabled}
                    onClick={(e) => e.stopPropagation()}
                >
                    Save
                </button>
            </form>

        </Modal>
    );
};

export default HotWalletSettingsModal; 
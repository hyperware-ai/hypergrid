import React, { useState, useCallback, useEffect } from 'react';
import classNames from 'classnames';
import { NodeProps, Handle, Position } from 'reactflow';
import { IOperatorWalletNodeData, IOperatorWalletFundingInfo, INoteInfo, SpendingLimits } from '../../logic/types';
import type { Address } from 'viem';
import { NODE_WIDTH } from '../BackendDrivenHypergridVisualizer';
import CopyToClipboardText from '../CopyToClipboardText';
import PaymasterApprovalButton from '../PaymasterApprovalButton';
import { useApprovePaymaster } from '../../logic/hypermapHelpers';
import { truncate } from '../../utils/truncate';
import { useErrorLogStore } from '../../store/errorLog';
import { FaArrowUpFromBracket } from 'react-icons/fa6';
import { TbPencilCheck } from 'react-icons/tb';
import BaseNodeComponent from './BaseNodeComponent';

interface PaymasterToggleButtonProps {
    operatorTbaAddress: Address;
    isApproved: boolean;
    isProcessing: boolean;
    onApprove: () => void;
    onRevoke: () => void;
    revokeHookState?: {
        isConfirmed: boolean;
        reset: () => void;
    };
}

const PaymasterToggleButton: React.FC<PaymasterToggleButtonProps> = ({
    operatorTbaAddress,
    isApproved,
    isProcessing,
    onApprove,
    onRevoke,
    revokeHookState
}) => {
    const [isHovered, setIsHovered] = useState(false);

    const approveHook = useApprovePaymaster({
        onSuccess: () => {
            console.log("Paymaster approval transaction sent");
            // Don't call onApprove() immediately - wait for confirmation
        },
        onError: (err) => {
            console.error("Paymaster approval error:", err);
        },
    });

    // Handle approve confirmation with delayed refresh
    useEffect(() => {
        if (approveHook.isConfirmed) {
            console.log("Approve confirmed in toggle button - triggering delayed refresh");
            setTimeout(() => {
                onApprove(); // This triggers the graph refresh after delay
            }, 2000);
            approveHook.reset();
        }
    }, [approveHook.isConfirmed, onApprove, approveHook]);

    // Handle revoke confirmation - don't trigger immediate refresh, let BackendDrivenHypergridVisualizer handle it with delay
    useEffect(() => {
        if (revokeHookState?.isConfirmed) {
            console.log("Revoke confirmed in toggle button - letting parent handle delayed refresh");
            // Don't call onApprove() here - the parent BackendDrivenHypergridVisualizer will handle the refresh with proper delay
            revokeHookState.reset();
        }
    }, [revokeHookState?.isConfirmed, revokeHookState]);

    const handleClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (isProcessing) return;

        if (isApproved) {
            onRevoke();
        } else {
            approveHook.approvePaymaster({ operatorTbaAddress });
        }
    };

    const getButtonState = () => {
        if (isProcessing || approveHook.isSending || approveHook.isConfirming) {
            return {
                text: isApproved ? 'Revoking...' : 'Approving...',
                backgroundColor: '#6c757d',
                color: 'white',
                borderColor: '#6c757d'
            };
        }

        if (isHovered) {
            return isApproved ? {
                text: 'Revoke paymaster',
                backgroundColor: '#dc3545',
                color: 'white',
                borderColor: '#dc3545'
            } : {
                text: 'Approve paymaster',
                backgroundColor: '#28a745',
                color: 'white',
                borderColor: '#28a745'
            };
        }

        return isApproved ? {
            text: 'Paymaster approved',
            backgroundColor: '#d4edda',
            color: '#155724',
            borderColor: '#c3e6cb'
        } : {
            text: 'Paymaster not approved',
            backgroundColor: '#f8d7da',
            color: '#721c24',
            borderColor: '#f5c6cb'
        };
    };

    const buttonState = getButtonState();
    const disabled = isProcessing || approveHook.isSending || approveHook.isConfirming;

    return (
        <button
            onClick={handleClick}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            disabled={disabled}
            style={{
                width: '100%',
                padding: '10px 16px',
                fontSize: '14px',
                fontWeight: '500',
                backgroundColor: buttonState.backgroundColor,
                color: buttonState.color,
                border: `1px solid ${buttonState.borderColor}`,
                borderRadius: '6px',
                cursor: disabled ? 'not-allowed' : 'pointer',
                opacity: disabled ? 0.7 : 1,
                transition: 'all 0.2s ease',
                outline: 'none'
            }}
            className={classNames("w-full text-sm font-bold rounded-lg justify-center", {
                "bg-red-600 hover:bg-red-700 text-white": !isApproved,
                "bg-green-600 hover:bg-green-700 text-white": isApproved,
                "bg-mid-gray text-dark-gray": isProcessing || approveHook.isSending || approveHook.isConfirming
            })}
        >
            {buttonState.text}
        </button>
    );
};

const OperatorWalletNodeComponent: React.FC<NodeProps<IOperatorWalletNodeData>> = ({ data }) => {
    const { showToast } = useErrorLogStore();
    const {
        name: operatorName,
        tbaAddress,
        fundingStatus,
        accessListNote: accessListNoteInfo,
        signersNote: signersNoteInfo
    } = data;

    const onSetAccessListNoteHandler = (data as any).onSetAccessListNote;
    const isCurrentlySettingAccessListNote = (data as any).isSettingAccessListNote;
    const onSetSignersNoteHandler = (data as any).onSetSignersNote;
    const isCurrentlySettingSignersNote = (data as any).isSettingSignersNote;
    const activeHotWalletAddress = (data as any).activeHotWalletAddressForNode as Address | null;
    const onDataRefreshNeeded = (data as any).onWalletsLinked || (data as any).onWalletDataUpdate;

    const [showUsdcWithdrawInput, setShowUsdcWithdrawInput] = useState<boolean>(false);
    const [usdcWithdrawAddress, setUsdcWithdrawAddress] = useState<string>('');
    const [isSendingUsdc, setIsSendingUsdc] = useState<boolean>(false);
    const [usdcWithdrawAmount, setUsdcWithdrawAmount] = useState<string>('');

    const getApiBasePathLocal = () => {
        const pathParts = window.location.pathname.split('/').filter(p => p);
        const processIdPart = pathParts.find(part => part.includes(':'));
        return processIdPart ? `/${processIdPart}/api` : '/api';
    };
    const API_ACTIONS_ENDPOINT_LOCAL = `${getApiBasePathLocal()}/actions`;

    const callApiActionsLocal = async (body: any) => {
        const response = await fetch(API_ACTIONS_ENDPOINT_LOCAL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const responseData = await response.json();
        if (!response.ok) {
            throw new Error(responseData.error || `API Error: ${response.statusText}`);
        }
        return responseData;
    };

    const handleToggleUsdcWithdraw = (e: React.MouseEvent) => {
        e.stopPropagation();
        const nextState = !showUsdcWithdrawInput;
        setShowUsdcWithdrawInput(nextState);
        setUsdcWithdrawAddress('');
        setUsdcWithdrawAmount('');
    };



    const handleSendUsdc = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!usdcWithdrawAddress.trim() || !usdcWithdrawAmount.trim()) {
            showToast('error', 'Address and Amount are required for USDC withdrawal.');
            return;
        }
        const amountUsdcNum = parseFloat(usdcWithdrawAmount);
        if (isNaN(amountUsdcNum) || amountUsdcNum <= 0) {
            showToast('error', 'USDC withdrawal amount must be a positive number.');
            return;
        }

        let amountUsdcUnitsStr: string;
        const USDC_DECIMALS = 6;
        try {
            const usdcAsFloat = parseFloat(usdcWithdrawAmount.trim());
            if (isNaN(usdcAsFloat)) throw new Error("Invalid USDC amount format");
            amountUsdcUnitsStr = (usdcAsFloat * Math.pow(10, USDC_DECIMALS)).toLocaleString('fullwide', { useGrouping: false });
            if (amountUsdcUnitsStr.includes('.')) amountUsdcUnitsStr = amountUsdcUnitsStr.split('.')[0];
        } catch (parseErr) {
            showToast('error', 'Invalid USDC amount format.');
            return;
        }
        if (amountUsdcUnitsStr === "0") {
            showToast('error', 'USDC withdrawal amount cannot be zero.');
            return;
        }

        setIsSendingUsdc(true);
        try {
            const payload = {
                WithdrawUsdcFromOperatorTba: {
                    to_address: usdcWithdrawAddress.trim(),
                    amount_usdc_units_str: amountUsdcUnitsStr
                }
            };
            await callApiActionsLocal(payload);
            showToast('success', 'USDC withdrawal initiated!');
            setShowUsdcWithdrawInput(false);
            setUsdcWithdrawAddress('');
            setUsdcWithdrawAmount('');
            if (typeof onDataRefreshNeeded === 'function') onDataRefreshNeeded();
        } catch (err: any) {
            showToast('error', `USDC Withdrawal Failed: ${err.message}`);
        } finally {
            setIsSendingUsdc(false);
        }
    };

    const handleSetAccessListNoteClick = (event: React.MouseEvent) => {
        event.stopPropagation();
        if (tbaAddress && operatorName && typeof onSetAccessListNoteHandler === 'function') {
            onSetAccessListNoteHandler(tbaAddress, operatorName);
        } else {
            console.error('[OperatorWalletNodeComponent] Skipping SetAccessListNote: tbaAddress, operatorName, or handler is invalid.');
        }
    };

    const handleSetSignersNoteClick = (event: React.MouseEvent) => {
        event.stopPropagation();
        if (tbaAddress && operatorName && activeHotWalletAddress && typeof onSetSignersNoteHandler === 'function') {
            onSetSignersNoteHandler(tbaAddress, operatorName, activeHotWalletAddress);
        } else {
            console.error('[OperatorWalletNodeComponent] Skipping SetSignersNote: required parameters or handler is invalid.',
                { tbaAddress, operatorName, activeHotWalletAddress, handlerExists: typeof onSetSignersNoteHandler === 'function' });
        }
    };

    const canSetAccessList = accessListNoteInfo && !accessListNoteInfo.isSet && tbaAddress;
    const canSetSigners = accessListNoteInfo?.isSet &&
        tbaAddress &&
        operatorName &&
        activeHotWalletAddress &&
        (signersNoteInfo?.actionNeeded || !signersNoteInfo?.isSet);
    const needsSignersButNoActiveHW = accessListNoteInfo?.isSet && signersNoteInfo && !signersNoteInfo.isSet && !activeHotWalletAddress;
    const isProcessingNote = isCurrentlySettingAccessListNote || isCurrentlySettingSignersNote;

    return (
        <BaseNodeComponent
            showHandles={{ target: true, source: true }}
        >
            <div>
                <div className=" font-bold " >Operator Wallet:</div>
                <div className="text-sm text-dark-gray break-words leading-tight">{operatorName}</div>
            </div>

            <div className="text-sm flex gap-1 self-stretch">
                <span className="font-bold">Address:</span>
                <span className="text-dark-gray wrap-anywhere">
                    {tbaAddress ? (
                        <CopyToClipboardText textToCopy={tbaAddress as string}>
                            {truncate(tbaAddress as string, 8, 6)}
                        </CopyToClipboardText>
                    ) : 'N/A'}
                </span>
            </div>

            <div className="border-y border-mid-gray flex flex-col gap-2 py-4 text-xs">
                <div className="flex gap-1 items-center">
                    <span className="font-bold text-dark-gray">USDC:</span>
                    <span className="flex items-center gap-2 grow">
                        <span className="grow p-2 bg-mid-gray/25 rounded-lg">{(fundingStatus as IOperatorWalletFundingInfo)?.usdcBalanceStr ?? 'N/A'} </span>
                        {!showUsdcWithdrawInput && (
                            <button
                                className="rounded-lg hover:bg-mid-gray p-2"
                                onClick={handleToggleUsdcWithdraw}
                                title="Withdraw USDC"
                                disabled={isCurrentlySettingAccessListNote || isCurrentlySettingSignersNote || isSendingUsdc}
                            >
                                <FaArrowUpFromBracket className="w-4 h-4" />
                            </button>
                        )}
                    </span>
                </div>
                {showUsdcWithdrawInput && (
                    <div className="flex flex-col gap-2 mt-2 p-2 bg-darkgray rounded ">
                        <span className="font-bold">Withdraw USDC</span>
                        <input
                            type="text"
                            placeholder="Destination Address (0x...)"
                            value={usdcWithdrawAddress}
                            onChange={(e) => setUsdcWithdrawAddress(e.target.value)}
                            className="px-2 py-1 bg-mid-gray/25 rounded"
                            onClick={(e) => e.stopPropagation()}
                            disabled={isSendingUsdc}
                        />
                        <input
                            type="number"
                            step="any"
                            min="0"
                            placeholder="Amount USDC"
                            value={usdcWithdrawAmount}
                            onChange={(e) => setUsdcWithdrawAmount(e.target.value)}
                            className="px-2 py-1 bg-mid-gray/25 rounded"
                            onClick={(e) => e.stopPropagation()}
                            disabled={isSendingUsdc}
                        />
                        <div className="flex gap-2 font-bold">
                            <button
                                className="rounded-lg bg-mid-gray/25 text-dark-gray grow px-2 py-1 justify-center"
                                onClick={handleToggleUsdcWithdraw}
                                disabled={isSendingUsdc}
                            >
                                Cancel
                            </button>
                            <button
                                className="rounded-lg bg-cyan grow px-2 py-1 justify-center"
                                onClick={handleSendUsdc}
                                disabled={isSendingUsdc || !usdcWithdrawAddress.trim() || !usdcWithdrawAmount.trim()}
                            >
                                {isSendingUsdc ? 'Sending...' : 'Send USDC'}
                            </button>
                        </div>
                    </div>
                )}
                {(fundingStatus as IOperatorWalletFundingInfo)?.errorMessage && (
                    <div className="text-red-400 text-sm mt-0.5">Funding Error: {(fundingStatus as IOperatorWalletFundingInfo).errorMessage}</div>
                )}
            </div>

            {/* Only show notes section if either note is not set */}
            {(!accessListNoteInfo?.isSet || !signersNoteInfo?.isSet) && (
                <div className="flex flex-col gap-2">
                    <span className="font-bold text-sm">Access List Note:</span>
                    <div className={classNames("text-xs leading-relaxed p-2 rounded-xl",
                        {
                            "bg-green-400 text-dark-gray": (accessListNoteInfo as INoteInfo)?.isSet,
                            "bg-red-100 text-red-500": !(accessListNoteInfo as INoteInfo)?.isSet
                        }
                    )}>
                        {(accessListNoteInfo as INoteInfo)?.statusText || 'Unknown'}
                    </div>
                    <span className="font-bold text-sm">Signers Note:</span>
                    <div className={classNames(
                        "text-xs leading-relaxed p-2 rounded-xl flex flex-col gap-1",
                        {
                            "bg-green-400 text-dark-gray": (signersNoteInfo as INoteInfo)?.isSet,
                            "text-red-500 bg-red-100": !(signersNoteInfo as INoteInfo)?.isSet
                        }
                    )}>
                        <span>{(signersNoteInfo as INoteInfo)?.statusText || 'Unknown'}</span>
                        {(signersNoteInfo as INoteInfo)?.isSet && (signersNoteInfo as INoteInfo).details &&
                            <span>
                                {(signersNoteInfo as INoteInfo).details}
                            </span>
                        }
                    </div>
                </div>
            )}

            {/* Paymaster Toggle Button - show when both notes are set and gasless implementation is available */}
            {tbaAddress && accessListNoteInfo?.isSet && signersNoteInfo?.isSet && data.gaslessEnabled && (
                <PaymasterToggleButton
                    operatorTbaAddress={tbaAddress as Address}
                    isApproved={data.paymasterApproved || false}
                    isProcessing={(data as any).isRevokingPaymaster || isProcessingNote || showUsdcWithdrawInput || isSendingUsdc}
                    onApprove={() => {
                        console.log('Paymaster approval initiated...');
                        if (typeof onDataRefreshNeeded === 'function') {
                            onDataRefreshNeeded();
                        }
                    }}
                    onRevoke={() => {
                        console.log('Paymaster revoke initiated...');
                        if (typeof (data as any).onRevokePaymaster === 'function') {
                            (data as any).onRevokePaymaster(tbaAddress);
                        }
                    }}
                    revokeHookState={(data as any).revokeHookState}
                />
            )}

            {/* Show info when operator is configured but gasless implementation is not available */}
            {tbaAddress && accessListNoteInfo?.isSet && signersNoteInfo?.isSet && !data.gaslessEnabled && (
                <div className="mt-3 p-2 bg-yellow-100 rounded text-xs text-yellow-800 text-center border border-yellow-300">
                    <em>⚠️ This TBA uses an older implementation. ETH required for gas fees.</em>
                </div>
            )}

            {(canSetAccessList || canSetSigners || needsSignersButNoActiveHW) && (
                <div className="mt-2 flex flex-col gap-2">
                    {canSetAccessList && (
                        <button
                            onClick={handleSetAccessListNoteClick}
                            disabled={isProcessingNote || showUsdcWithdrawInput}
                            className={classNames(
                                "bg-black hover:bg-dark-gray rounded-xl p-2 text-white",
                            )}
                        >
                            <TbPencilCheck className="w-4 h-4" />
                            <span className="text-sm">{isCurrentlySettingAccessListNote ? 'Setting Access List...' : 'Set Access List Note'}</span>
                        </button>
                    )}
                    {canSetSigners && (
                        <button
                            onClick={handleSetSignersNoteClick}
                            disabled={isProcessingNote || showUsdcWithdrawInput}
                            className={classNames(
                                "w-full px-2 py-2 rounded text-white text-center text-sm border-none cursor-pointer transition-colors",
                                {
                                    "bg-blue-600 hover:bg-blue-700": !isProcessingNote && !showUsdcWithdrawInput,
                                    "bg-gray-600 cursor-not-allowed opacity-70": isProcessingNote || showUsdcWithdrawInput
                                }
                            )}
                        >
                            {isCurrentlySettingSignersNote ? 'Setting Signers...' : `Set Signers (via ${truncate(activeHotWalletAddress || undefined, 4, 4)})`}
                        </button>
                    )}
                    {needsSignersButNoActiveHW && (
                        <div className="text-xs text-orange-400 mt-1">
                            Signers Note not set. Link and activate a Hot Wallet to enable.
                        </div>
                    )}
                </div>
            )}
        </BaseNodeComponent>
    );
};

export default OperatorWalletNodeComponent; 
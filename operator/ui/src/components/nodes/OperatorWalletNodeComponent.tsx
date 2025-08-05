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
        <div style={{ marginTop: '12px', marginBottom: '12px' }}>
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
            >
                {buttonState.text}
            </button>
        </div>
    );
};

const OperatorWalletNodeComponent: React.FC<NodeProps<IOperatorWalletNodeData>> = ({ data }) => {
    const { addError } = useErrorLogStore();
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

    const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

    const showToast = useCallback((type: 'success' | 'error', text: string, duration: number = 3000) => {
        // Log errors to the error store
        if (type === 'error') {
            addError(text);
        }

        setToastMessage({ type, text });
        setTimeout(() => {
            setToastMessage(null);
        }, duration);
    }, [addError]);



    const getApiBasePathLocal = () => {
        const pathParts = window.location.pathname.split('/').filter(p => p);
        const processIdPart = pathParts.find(part => part.includes(':'));
        return processIdPart ? `/${processIdPart}/api` : '/api';
    };
    const MCP_ENDPOINT_LOCAL = `${getApiBasePathLocal()}/mcp`;

    const callMcpApiLocal = async (body: any) => {
        const response = await fetch(MCP_ENDPOINT_LOCAL, {
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
            await callMcpApiLocal(payload);
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
        <div
            className="p-3 border rounded-lg box-border font-sans flex flex-col gap-2 text-left border-cyan bg-gray"
            style={{ maxWidth: NODE_WIDTH }}
        >
            <Handle type="target" position={Position.Top} style={{ visibility: 'hidden' }} />
            <div className="mb-2 text-center">
                <div className="text-base font-bold mb-0.5" style={{ color: '#00ffff' }}>Operator Wallet</div>
                <div className="text-sm text-gray-400 break-words leading-tight">{operatorName}</div>
            </div>

            {toastMessage && (
                <div className={classNames(
                    "px-3 py-3 my-4 rounded text-sm text-center",
                    {
                        "bg-green-600 text-white border border-green-800": toastMessage.type === 'success',
                        "bg-red-600 text-white border border-red-800": toastMessage.type === 'error'
                    }
                )}>
                    {toastMessage.text}
                </div>
            )}

            <div className="text-sm mb-2">
                <span className="text-gray-400 mr-1">Address:</span>
                <span className="text-blue-400 break-all">
                    {tbaAddress ? (
                        <CopyToClipboardText textToCopy={tbaAddress as string}>
                            {truncate(tbaAddress as string)}
                        </CopyToClipboardText>
                    ) : 'N/A'}
                </span>
            </div>

            <div className="mt-2 pt-2 border-t border-gray-600 flex flex-col gap-1.5">
                <div className="flex justify-between items-center">
                    <span className="text-gray-400 mr-auto">USDC Balance:</span>
                    <span className="inline-flex items-center gap-2">
                        <span className="text-gray-300">{(fundingStatus as IOperatorWalletFundingInfo)?.usdcBalanceStr ?? 'N/A'}</span>
                        {!showUsdcWithdrawInput && (
                            <button
                                className="bg-none border-none p-1 m-0 ml-2 text-base leading-none cursor-pointer text-gray-500 inline-flex items-center justify-center rounded transition-colors hover:text-blue-400 hover:bg-gray-800 disabled:text-gray-600 disabled:cursor-not-allowed disabled:bg-transparent"
                                onClick={handleToggleUsdcWithdraw}
                                title="Withdraw USDC"
                                disabled={isCurrentlySettingAccessListNote || isCurrentlySettingSignersNote || isSendingUsdc}
                            >
                                💸
                            </button>
                        )}
                    </span>
                </div>
                {showUsdcWithdrawInput && (
                    <div className="flex flex-col gap-2 mt-2 p-2 bg-gray-800 rounded border border-gray-600">
                        <input
                            type="text"
                            placeholder="Destination Address (0x...)"
                            value={usdcWithdrawAddress}
                            onChange={(e) => setUsdcWithdrawAddress(e.target.value)}
                            className="px-2 py-1 border border-gray-600 rounded bg-gray-700 text-gray-100 text-sm placeholder-gray-400"
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
                            className="px-2 py-1 border border-gray-600 rounded bg-gray-700 text-gray-100 text-sm placeholder-gray-400"
                            onClick={(e) => e.stopPropagation()}
                            disabled={isSendingUsdc}
                        />
                        <div className="flex gap-2">
                            <button
                                className="flex-1 px-3 py-1.5 rounded text-sm bg-green-600 text-white transition-colors hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed"
                                onClick={handleSendUsdc}
                                disabled={isSendingUsdc || !usdcWithdrawAddress.trim() || !usdcWithdrawAmount.trim()}
                            >
                                {isSendingUsdc ? 'Sending...' : 'Send USDC'}
                            </button>
                            <button
                                className="px-3 py-1.5 rounded text-sm bg-gray-600 text-white transition-colors hover:bg-gray-700 disabled:cursor-not-allowed"
                                onClick={handleToggleUsdcWithdraw}
                                disabled={isSendingUsdc}
                            >
                                Cancel
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
                <div className="mt-2 pt-2 border-t border-gray-600 flex flex-col gap-1.5">
                    <div className="text-sm leading-relaxed">
                        <span className="text-gray-400 mr-1">Access List Note:</span>
                        <span className={classNames(
                            "text-gray-300",
                            {
                                "text-green-400": (accessListNoteInfo as INoteInfo)?.isSet,
                                "text-orange-400": !(accessListNoteInfo as INoteInfo)?.isSet
                            }
                        )}>
                            {(accessListNoteInfo as INoteInfo)?.statusText || 'Unknown'}
                        </span>
                    </div>
                    <div className="text-sm leading-relaxed">
                        <span className="text-gray-400 mr-1">Signers Note:</span>
                        <span className={classNames(
                            "text-gray-300",
                            {
                                "text-green-400": (signersNoteInfo as INoteInfo)?.isSet,
                                "text-orange-400": !(signersNoteInfo as INoteInfo)?.isSet
                            }
                        )}>
                            {(signersNoteInfo as INoteInfo)?.statusText || 'Unknown'}
                            {(signersNoteInfo as INoteInfo)?.isSet && (signersNoteInfo as INoteInfo).details &&
                                <span className="text-xs text-gray-500 ml-1">
                                    {(signersNoteInfo as INoteInfo).details}
                                </span>
                            }
                        </span>
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
                                "w-full px-2 py-2 rounded text-white text-center text-sm border-none cursor-pointer transition-colors",
                                {
                                    "bg-red-600 hover:bg-red-700": !isProcessingNote && !showUsdcWithdrawInput,
                                    "bg-gray-600 cursor-not-allowed opacity-70": isProcessingNote || showUsdcWithdrawInput
                                }
                            )}
                        >
                            {isCurrentlySettingAccessListNote ? 'Setting Access List...' : 'Set Access List Note'}
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
            <Handle type="source" position={Position.Bottom} style={{ visibility: 'hidden' }} />
        </div>
    );
};

export default OperatorWalletNodeComponent; 
import React, { useState, useCallback, useEffect } from 'react';
import { NodeProps, Handle, Position } from 'reactflow';
import { IOperatorWalletNodeData, IOperatorWalletFundingInfo, INoteInfo, SpendingLimits } from '../../logic/types';
import type { Address } from 'viem';
import { NODE_WIDTH } from '../BackendDrivenHypergridVisualizer';
import CopyToClipboardText from '../CopyToClipboardText';
import PaymasterApprovalButton from '../PaymasterApprovalButton';
import { useApprovePaymaster } from '../../logic/hypermapHelpers';
import styles from '../OperatorWalletNode.module.css';

const truncate = (str: string | undefined | null, startLen = 6, endLen = 4) => {
    if (!str) return '';
    if (str.length <= startLen + endLen + 3) return str;
    return `${str.substring(0, startLen)}...${str.substring(str.length - endLen)}`;
};

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
        setToastMessage({ type, text });
        setTimeout(() => {
            setToastMessage(null);
        }, duration);
    }, []);



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
            amountUsdcUnitsStr = (usdcAsFloat * Math.pow(10, USDC_DECIMALS)).toLocaleString('fullwide', {useGrouping:false});
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
                {tbaAddress, operatorName, activeHotWalletAddress, handlerExists: typeof onSetSignersNoteHandler === 'function' });
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
        <div className={styles.nodeContainer} style={{ maxWidth: NODE_WIDTH }}>
            <Handle type="target" position={Position.Top} style={{visibility:'hidden'}}/>
            <div className={styles.header}>
                <div className={styles.nodeTitle}>Operator Wallet</div>
                <div className={styles.nodeSubtitle}>{operatorName}</div>
            </div>

            {toastMessage && (
                <div className={`${styles.toastNotification} ${toastMessage.type === 'success' ? styles.toastSuccess : styles.toastError}`}>
                    {toastMessage.text}
                </div>
            )}

            <div className={styles.addressRow}>
                <span className={styles.addressLabel}>Address:</span>
                <span className={styles.addressValue}>
                    {tbaAddress ? (
                        <CopyToClipboardText textToCopy={tbaAddress as string}>
                            {truncate(tbaAddress as string)}
                        </CopyToClipboardText>
                    ) : 'N/A'}
                </span>
            </div>

            <div className={styles.fundingSection}>
                <div className={styles.fundingItem}>
                    <span className={styles.fundingLabel}>USDC Balance:</span>
                    <span className={styles.fundingValueWithButton}>
                        <span>{(fundingStatus as IOperatorWalletFundingInfo)?.usdcBalanceStr ?? 'N/A'}</span>
                        {!showUsdcWithdrawInput && (
                            <button 
                                className={styles.withdrawButtonInline} 
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
                    <div className={styles.withdrawInputSection}>
                        <input 
                            type="text" 
                            placeholder="Destination Address (0x...)"
                            value={usdcWithdrawAddress}
                            onChange={(e) => setUsdcWithdrawAddress(e.target.value)}
                            className={styles.withdrawAddressInput}
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
                            className={styles.withdrawAmountInput}
                            onClick={(e) => e.stopPropagation()}
                            disabled={isSendingUsdc}
                        />
                        <button className={styles.sendButton} onClick={handleSendUsdc} disabled={isSendingUsdc || !usdcWithdrawAddress.trim() || !usdcWithdrawAmount.trim()}>
                            {isSendingUsdc ? 'Sending...' : 'Send USDC'}
                        </button>
                        <button className={styles.cancelWithdrawButton} onClick={handleToggleUsdcWithdraw} disabled={isSendingUsdc}>
                            Cancel
                        </button>
                    </div>
                )}
                {(fundingStatus as IOperatorWalletFundingInfo)?.errorMessage && <div className={styles.statusError}>Funding Error: {(fundingStatus as IOperatorWalletFundingInfo).errorMessage}</div>}
            </div>

            {/* Only show notes section if either note is not set */}
            {(!accessListNoteInfo?.isSet || !signersNoteInfo?.isSet) && (
            <div className={styles.notesSection}>
                <div className={styles.noteItem}>
                    <span className={styles.noteLabel}>Access List Note:</span>
                    <span className={`${styles.noteValue} ${(accessListNoteInfo as INoteInfo)?.isSet ? styles.noteStatusSet : styles.noteStatusNotSet}`}>
                        {(accessListNoteInfo as INoteInfo)?.statusText || 'Unknown'}
                    </span>
                </div>
                <div className={styles.noteItem}>
                    <span className={styles.noteLabel}>Signers Note:</span>
                    <span className={`${styles.noteValue} ${(signersNoteInfo as INoteInfo)?.isSet ? styles.noteStatusSet : styles.noteStatusNotSet}`}>
                        {(signersNoteInfo as INoteInfo)?.statusText || 'Unknown'}
                        {(signersNoteInfo as INoteInfo)?.isSet && (signersNoteInfo as INoteInfo).details && 
                            <span style={{fontSize: '0.8em', color: '#aaa', marginLeft: '5px'}}>
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
                <div style={{ 
                    marginTop: '12px', 
                    padding: '8px', 
                    backgroundColor: '#f8f4e6', 
                    borderRadius: '4px',
                    fontSize: '12px',
                    color: '#8b5a2b',
                    textAlign: 'center',
                    border: '1px solid #e6c77a'
                }}>
                    <em>⚠️ This TBA uses an older implementation. ETH required for gas fees.</em>
                </div>
            )}

            {(canSetAccessList || canSetSigners || needsSignersButNoActiveHW) && (
                <div className={styles.actionsContainer}>
                    {canSetAccessList && (
                        <button
                            onClick={handleSetAccessListNoteClick}
                            disabled={isProcessingNote || showUsdcWithdrawInput}
                            className={`${styles.actionButton} ${styles.actionButtonSetAccessList} ${(isProcessingNote || showUsdcWithdrawInput) ? styles.actionButtonDisabled : ''}`}
                        >
                            {isCurrentlySettingAccessListNote ? 'Setting Access List...' : 'Set Access List Note'}
                        </button>
                    )}
                    {canSetSigners && (
                         <button
                            onClick={handleSetSignersNoteClick}
                            disabled={isProcessingNote || showUsdcWithdrawInput}
                            className={`${styles.actionButton} ${styles.actionButtonSetSigners} ${(isProcessingNote || showUsdcWithdrawInput) ? styles.actionButtonDisabled : ''}`}
                        >
                            {isCurrentlySettingSignersNote ? 'Setting Signers...' : `Set Signers (via ${truncate(activeHotWalletAddress || undefined, 4, 4)})`}
                        </button>
                    )}
                    {needsSignersButNoActiveHW && (
                        <div className={styles.infoText}>
                            Signers Note not set. Link and activate a Hot Wallet to enable.
                        </div>
                    )}
                </div>
            )}
            <Handle type="source" position={Position.Bottom} style={{visibility:'hidden'}}/>
        </div>
    );
};

export default OperatorWalletNodeComponent; 
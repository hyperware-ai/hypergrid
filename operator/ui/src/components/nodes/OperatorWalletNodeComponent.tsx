import React, { useState, useCallback, useEffect } from 'react';
import { NodeProps, Handle, Position } from 'reactflow';
import { IOperatorWalletNodeData, IOperatorWalletFundingInfo, INoteInfo, SpendingLimits } from '../../logic/types';
import type { Address } from 'viem';
import { NODE_WIDTH } from '../BackendDrivenHypergridVisualizer';
import CopyToClipboardText from '../CopyToClipboardText';
import PaymasterApprovalButton from '../PaymasterApprovalButton';
import styles from '../OperatorWalletNode.module.css';

const truncate = (str: string | undefined | null, startLen = 6, endLen = 4) => {
    if (!str) return '';
    if (str.length <= startLen + endLen + 3) return str;
    return `${str.substring(0, startLen)}...${str.substring(str.length - endLen)}`;
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

    const [showEthWithdrawInput, setShowEthWithdrawInput] = useState<boolean>(false);
    const [ethWithdrawAddress, setEthWithdrawAddress] = useState<string>('');
    const [isSendingEth, setIsSendingEth] = useState<boolean>(false);
    const [ethWithdrawAmount, setEthWithdrawAmount] = useState<string>('');

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

    const handleToggleEthWithdraw = (e: React.MouseEvent) => {
        e.stopPropagation();
        const nextState = !showEthWithdrawInput;
        setShowEthWithdrawInput(nextState);
        setEthWithdrawAddress('');
        setEthWithdrawAmount('');
        if (nextState && showUsdcWithdrawInput) {
            setShowUsdcWithdrawInput(false);
            setUsdcWithdrawAddress('');
            setUsdcWithdrawAmount('');
        }
    };

    const handleToggleUsdcWithdraw = (e: React.MouseEvent) => {
        e.stopPropagation();
        const nextState = !showUsdcWithdrawInput;
        setShowUsdcWithdrawInput(nextState);
        setUsdcWithdrawAddress('');
        setUsdcWithdrawAmount('');
        if (nextState && showEthWithdrawInput) {
            setShowEthWithdrawInput(false);
            setEthWithdrawAddress('');
            setEthWithdrawAmount('');
        }
    };

    const handleSendEth = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!ethWithdrawAddress.trim() || !ethWithdrawAmount.trim()) {
            showToast('error', 'Address and Amount are required for ETH withdrawal.');
            return;
        }
        const amountEthNum = parseFloat(ethWithdrawAmount);
        if (isNaN(amountEthNum) || amountEthNum <= 0) {
            showToast('error', 'ETH withdrawal amount must be a positive number.');
            return;
        }

        let amountWeiStr: string;
        try {
            const ethAsFloat = parseFloat(ethWithdrawAmount.trim());
            if (isNaN(ethAsFloat)) throw new Error("Invalid ETH amount format");
            amountWeiStr = (ethAsFloat * 1e18).toLocaleString('fullwide', {useGrouping:false});
            if (amountWeiStr.includes('.')) amountWeiStr = amountWeiStr.split('.')[0];
        } catch (parseErr) {
            showToast('error', 'Invalid ETH amount format.');
            return;
        }
        if (amountWeiStr === "0") {
             showToast('error', 'ETH withdrawal amount cannot be zero.');
             return;
        }

        setIsSendingEth(true);
        try {
            const payload = {
                WithdrawEthFromOperatorTba: {
                    to_address: ethWithdrawAddress.trim(),
                    amount_wei_str: amountWeiStr
                }
            };
            await callMcpApiLocal(payload);
            showToast('success', 'ETH withdrawal initiated!');
            setShowEthWithdrawInput(false);
            setEthWithdrawAddress('');
            setEthWithdrawAmount('');
            if (typeof onDataRefreshNeeded === 'function') onDataRefreshNeeded();
        } catch (err: any) {
            showToast('error', `ETH Withdrawal Failed: ${err.message}`);
        } finally {
            setIsSendingEth(false);
        }
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
            <div className={styles.header}>Operator Wallet: {operatorName}</div>

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
                    <span className={styles.fundingLabel}>ETH:</span>
                    <span className={styles.fundingValueWithButton}>
                        <span>{(fundingStatus as IOperatorWalletFundingInfo)?.ethBalanceStr ?? 'N/A'}</span>
                        {!showEthWithdrawInput && (
                            <button 
                                className={styles.withdrawButtonInline} 
                                onClick={handleToggleEthWithdraw} 
                                title="Withdraw ETH"
                                disabled={isCurrentlySettingAccessListNote || isCurrentlySettingSignersNote || isSendingUsdc || isSendingEth}
                            >
                                💸
                            </button>
                        )}
                    </span>
                    {(fundingStatus as IOperatorWalletFundingInfo)?.needsEth && !showEthWithdrawInput && <span className={styles.statusNeedsFunding}>Needs ETH</span>}
                </div>
                {showEthWithdrawInput && (
                    <div className={styles.withdrawInputSection}>
                        <input 
                            type="text" 
                            placeholder="Destination Address (0x...)"
                            value={ethWithdrawAddress}
                            onChange={(e) => setEthWithdrawAddress(e.target.value)}
                            className={styles.withdrawAddressInput}
                            onClick={(e) => e.stopPropagation()}
                            disabled={isSendingEth}
                        />
                        <input 
                            type="number" 
                            step="any" 
                            min="0"
                            placeholder="Amount ETH"
                            value={ethWithdrawAmount}
                            onChange={(e) => setEthWithdrawAmount(e.target.value)}
                            className={styles.withdrawAmountInput}
                            onClick={(e) => e.stopPropagation()}
                            disabled={isSendingEth}
                        />
                        <button className={styles.sendButton} onClick={handleSendEth} disabled={isSendingEth || !ethWithdrawAddress.trim() || !ethWithdrawAmount.trim()}>
                            {isSendingEth ? 'Sending...' : 'Send ETH'}
                        </button>
                        <button className={styles.cancelWithdrawButton} onClick={handleToggleEthWithdraw} disabled={isSendingEth}>
                            Cancel
                        </button>
                    </div>
                )}

                <div className={styles.fundingItem}>
                    <span className={styles.fundingLabel}>USDC:</span>
                    <span className={styles.fundingValueWithButton}>
                        <span>{(fundingStatus as IOperatorWalletFundingInfo)?.usdcBalanceStr ?? 'N/A'}</span>
                        {!showUsdcWithdrawInput && (
                            <button 
                                className={styles.withdrawButtonInline} 
                                onClick={handleToggleUsdcWithdraw} 
                                title="Withdraw USDC"
                                disabled={isCurrentlySettingAccessListNote || isCurrentlySettingSignersNote || isSendingEth || isSendingUsdc}
                            >
                                💸
                            </button>
                        )}
                    </span>
                    {(fundingStatus as IOperatorWalletFundingInfo)?.needsUsdc && !showUsdcWithdrawInput && <span className={styles.statusNeedsFunding}>Needs USDC</span>}
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

            {/* Paymaster Approval Section - only show if both notes are set */}
            {tbaAddress && accessListNoteInfo?.isSet && signersNoteInfo?.isSet && data.gaslessEnabled && (
                <div className={styles.paymasterSection} style={{ marginTop: '12px', marginBottom: '12px' }}>
                    <PaymasterApprovalButton
                        operatorTbaAddress={tbaAddress as Address}
                        onApprovalComplete={() => {
                            console.log('Paymaster approval complete, refreshing data...');
                            if (typeof onDataRefreshNeeded === 'function') {
                                onDataRefreshNeeded();
                            }
                        }}
                        disabled={isProcessingNote || showEthWithdrawInput || showUsdcWithdrawInput || isSendingEth || isSendingUsdc}
                    />
                </div>
            )}
            
            {/* Show info when operator is configured but gasless is not available */}
            {tbaAddress && accessListNoteInfo?.isSet && signersNoteInfo?.isSet && !data.gaslessEnabled && (
                <div style={{ 
                    marginTop: '12px', 
                    padding: '8px', 
                    backgroundColor: '#f0f0f0', 
                    borderRadius: '4px',
                    fontSize: '12px',
                    color: '#666',
                    textAlign: 'center'
                }}>
                    <em>This TBA uses an older implementation. ETH required for gas fees.</em>
                </div>
            )}

            {(canSetAccessList || canSetSigners || needsSignersButNoActiveHW) && (
                <div className={styles.actionsContainer}>
                    {canSetAccessList && (
                        <button
                            onClick={handleSetAccessListNoteClick}
                            disabled={isProcessingNote || showEthWithdrawInput || showUsdcWithdrawInput}
                            className={`${styles.actionButton} ${styles.actionButtonSetAccessList} ${(isProcessingNote || showEthWithdrawInput || showUsdcWithdrawInput) ? styles.actionButtonDisabled : ''}`}
                        >
                            {isCurrentlySettingAccessListNote ? 'Setting Access List...' : 'Set Access List Note'}
                        </button>
                    )}
                    {canSetSigners && (
                         <button
                            onClick={handleSetSignersNoteClick}
                            disabled={isProcessingNote || showEthWithdrawInput || showUsdcWithdrawInput}
                            className={`${styles.actionButton} ${styles.actionButtonSetSigners} ${(isProcessingNote || showEthWithdrawInput || showUsdcWithdrawInput) ? styles.actionButtonDisabled : ''}`}
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
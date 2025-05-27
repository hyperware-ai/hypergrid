import React from 'react';
import { NodeProps, Handle, Position } from 'reactflow';
import { IOperatorWalletNodeData, IOperatorWalletFundingInfo, INoteInfo } from '../../logic/types';
import type { Address } from 'viem';
import { NODE_WIDTH } from '../BackendDrivenHpnVisualizer'; // Assuming NODE_WIDTH is exported
import CopyToClipboardText from '../CopyToClipboardText';
// LinkHotWalletsInline is no longer used here
import styles from '../OperatorWalletNode.module.css';

// Helper to truncate text (can be moved to a utils file)
const truncate = (str: string | undefined, startLen = 6, endLen = 4) => {
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
    // Restore these from before
    const onSetSignersNoteHandler = (data as any).onSetSignersNote;
    const isCurrentlySettingSignersNote = (data as any).isSettingSignersNote;
    const activeHotWalletAddress = (data as any).activeHotWalletAddressForNode as Address | null;

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
    // Signers note can be set (or re-set) if access list is set and an active hot wallet is identified
    const canSetSigners = accessListNoteInfo?.isSet &&
                      tbaAddress && 
                      operatorName && 
                      activeHotWalletAddress &&
                      (signersNoteInfo?.actionNeeded || !signersNoteInfo?.isSet); 
    // Show a message if signers note is needed but no active HW to use for setting it initially
    const needsSignersButNoActiveHW = accessListNoteInfo?.isSet && signersNoteInfo && !signersNoteInfo.isSet && !activeHotWalletAddress;

    const isProcessingNote = isCurrentlySettingAccessListNote || isCurrentlySettingSignersNote;

    return (
        <div className={styles.nodeContainer} style={{ maxWidth: NODE_WIDTH }}>
            <Handle type="target" position={Position.Top} style={{ visibility: 'hidden' }} />
            
            <div className={styles.header}>Operator Wallet: {operatorName}</div>

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
                    <span className={styles.fundingValue}>{(fundingStatus as IOperatorWalletFundingInfo)?.ethBalanceStr ?? 'N/A'}</span>
                    {(fundingStatus as IOperatorWalletFundingInfo)?.needsEth && <span className={styles.statusNeedsFunding}>Needs ETH</span>}
                </div>
                <div className={styles.fundingItem}>
                    <span className={styles.fundingLabel}>USDC:</span>
                    <span className={styles.fundingValue}>{(fundingStatus as IOperatorWalletFundingInfo)?.usdcBalanceStr ?? 'N/A'}</span>
                    {(fundingStatus as IOperatorWalletFundingInfo)?.needsUsdc && <span className={styles.statusNeedsFunding}>Needs USDC</span>}
                </div>
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
                         {/* Optionally show verification details if signers note is set */}
                         {(signersNoteInfo as INoteInfo)?.isSet && (signersNoteInfo as INoteInfo).details && 
                            <span style={{fontSize: '0.8em', color: '#aaa', marginLeft: '5px'}}>
                                (Verified for {truncate(activeHotWalletAddress || undefined, 4, 4)})
                            </span>
                        }
                        </span>
                    </div>
                </div>

            {(canSetAccessList || canSetSigners || needsSignersButNoActiveHW) && (
                <div className={styles.actionsContainer}>
                    {canSetAccessList && (
                        <button
                            onClick={handleSetAccessListNoteClick}
                            disabled={isProcessingNote}
                            className={`${styles.actionButton} ${styles.actionButtonSetAccessList} ${isProcessingNote ? styles.actionButtonDisabled : ''}`}
                        >
                            {isCurrentlySettingAccessListNote ? 'Setting Access List Note...' : 'Set Access List Note'}
                        </button>
                    )}
                    {canSetSigners && (
                         <button
                            onClick={handleSetSignersNoteClick}
                            disabled={isProcessingNote}
                            className={`${styles.actionButton} ${styles.actionButtonSetSigners} ${isProcessingNote ? styles.actionButtonDisabled : ''}`}
                        >
                            {isCurrentlySettingSignersNote ? 'Setting Signers Note...' : `Set Signers (via ${truncate(activeHotWalletAddress || undefined, 4, 4)})`}
                        </button>
                    )}
                    {needsSignersButNoActiveHW && (
                        <div className={styles.infoText}>
                            Signers Note not set. Link and activate a Hot Wallet in the 'Manage Hot Wallets' node below to enable.
                        </div>
                    )}
                </div>
            )}
            <Handle type="source" position={Position.Bottom} style={{ visibility: 'hidden' }} />
        </div>
    );
};

export default OperatorWalletNodeComponent; 
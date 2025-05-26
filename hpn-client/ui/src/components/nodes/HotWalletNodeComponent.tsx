import React, { useState, useCallback, useEffect, useRef } from 'react';
import { NodeProps, Handle, Position } from 'reactflow';
import { IHotWalletNodeData, SpendingLimits } from '../../logic/types';
import type { Address } from 'viem';
import { NODE_WIDTH } from '../BackendDrivenHpnVisualizer'; // Assuming NODE_WIDTH is exported
import CopyToClipboardText from '../CopyToClipboardText';
import styles from '../HotWalletNode.module.css';

// Helper to truncate text (can be moved to a utils file)
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

// Simplified callMcpApi: just sends the body as is.
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

// Prop for callback when wallet data is updated from modal
interface HotWalletNodeComponentProps extends NodeProps<IHotWalletNodeData> {
    onWalletDataUpdate: (walletAddress: Address) => void;
    onOpenHistoryModal: (walletAddress: Address) => void; // New prop to open modal
}

const HotWalletNodeComponent: React.FC<HotWalletNodeComponentProps> = ({ data, id: nodeId, onWalletDataUpdate, onOpenHistoryModal }) => {
    const { 
        address,
        statusDescription, 
        fundingInfo, 
        isEncrypted: initialIsEncrypted, 
        isUnlocked: initialIsUnlocked, 
        limits: initialLimits,
        name: initialName
    } = data;

    const [currentName, setCurrentName] = useState<string | null>(initialName);
    const [editedName, setEditedName] = useState<string>(initialName || '');
    const [isEditingName, setIsEditingName] = useState<boolean>(false);
    const nameInputRef = useRef<HTMLInputElement>(null);

    const [limitPerCall, setLimitPerCall] = useState<string>(initialLimits?.max_per_call || '');
    const [currentLimits, setCurrentLimits] = useState<SpendingLimits | null>(initialLimits);

    const [isEncrypted, setIsEncrypted] = useState<boolean>(initialIsEncrypted);
    const [isUnlocked, setIsUnlocked] = useState<boolean>(initialIsUnlocked);

    const [isActionLoading, setIsActionLoading] = useState<boolean>(false);
    const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

    useEffect(() => {
        setCurrentName(initialName);
        setEditedName(initialName || '');
        setCurrentLimits(initialLimits);
        setLimitPerCall(initialLimits?.max_per_call || '');
        setIsEncrypted(initialIsEncrypted);
        setIsUnlocked(initialIsUnlocked);
        setIsEditingName(false);
    }, [initialName, initialLimits, initialIsEncrypted, initialIsUnlocked, data]);

    useEffect(() => {
        if (isEditingName && nameInputRef.current) {
            nameInputRef.current.focus();
            nameInputRef.current.select();
        }
    }, [isEditingName]);

    const showToast = useCallback((type: 'success' | 'error', text: string, duration: number = 3000) => {
        setToastMessage({ type, text });
        setTimeout(() => {
            setToastMessage(null);
        }, duration);
    }, []);

    const handleSuccess = (msg: string, actionCallback?: () => void) => {
        showToast('success', msg);
        if (actionCallback) actionCallback();
        onWalletDataUpdate(address);
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
        setIsActionLoading(true);
        setToastMessage(null);
        try {
            await callMcpApi(MCP_ENDPOINT, { SelectWallet: { wallet_id: address } });
            await callMcpApi(MCP_ENDPOINT, actionPayload);
            handleSuccess(successMessage, successCallback);
        } catch (err: any) {
            handleError(err, actionNameForContext);
        } finally {
            setIsActionLoading(false);
        }
    };

    const handleSetLimits = async (e?: React.FormEvent) => {
        e?.preventDefault();
        const limitsToSet: SpendingLimits = {
            max_per_call: limitPerCall.trim() === '' ? null : limitPerCall.trim(),
            max_total: null, 
            currency: 'USDC',
        };
        const payload = { SetWalletLimits: { limits: limitsToSet } };
        await selectAndExecute(
            'Set Limits', payload,
            'Spending limits updated.',
            () => setCurrentLimits(limitsToSet)
        );
    };

    const limitsDisabled = isActionLoading || (isEncrypted && !isUnlocked);

    const handleNodeAreaClick = () => {
        onOpenHistoryModal(address);
    };

    // Name Editing Handlers
    const handleNameDisplayClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        setIsEditingName(true);
    };

    const handleRenameWallet = async () => {
        if (!editedName.trim() || editedName.trim() === currentName) {
            setIsEditingName(false);
            setEditedName(currentName || '');
            return;
        }
        setIsActionLoading(true); setToastMessage(null);
        try {
            const requestBody = { RenameWallet: { wallet_id: address, new_name: editedName.trim() } };
            await callMcpApi(MCP_ENDPOINT, requestBody);
            handleSuccess(`Wallet renamed to "${editedName.trim()}".`, () => {
                setCurrentName(editedName.trim());
                setIsEditingName(false);
            });
        } catch (err: any) { 
            handleError(err, 'Rename Wallet');
            setEditedName(currentName || ''); 
            setIsEditingName(false); 
        } finally {
            setIsActionLoading(false);
        }
    };

    const handleNameInputBlur = () => {
        if (editedName.trim() !== currentName && editedName.trim() !== '') {
            handleRenameWallet();
        } else {
            setEditedName(currentName || '');
            setIsEditingName(false);
        }
    };

    const handleNameInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            handleRenameWallet();
        }
        if (event.key === 'Escape') {
            setEditedName(currentName || '');
            setIsEditingName(false);
        }
    };

    return (
        <div 
            className={styles.nodeContainer} 
            style={{ maxWidth: NODE_WIDTH, cursor: 'pointer' }} 
            onClick={handleNodeAreaClick}
            title={`Click node to view history, click name to edit`}
        >
            <Handle type="target" position={Position.Top} style={{ visibility: 'hidden' }} />
            
            <div className={styles.header}>
                Wallet:{" "}
                {isEditingName ? (
                    <input 
                        ref={nameInputRef}
                        type="text"
                        value={editedName}
                        onChange={(e) => setEditedName(e.target.value)}
                        onBlur={handleNameInputBlur}
                        onKeyDown={handleNameInputKeyDown}
                        className={styles.nameInputEditing} 
                        disabled={isActionLoading}
                        onClick={(e) => e.stopPropagation()}
                    />
                ) : (
                    <span 
                        onClick={handleNameDisplayClick}
                        className={styles.nameDisplayClickable}
                        title="Click to edit name"
                    >
                        {(currentName && currentName.toLowerCase() !== 'unnamed') 
                            ? `"${currentName}"` 
                            : truncate(address) }
                    </span>
                )}
            </div>

            {toastMessage && (
                <div className={`${styles.toastNotification} ${toastMessage.type === 'success' ? styles.toastSuccess : styles.toastError}`}>
                    {toastMessage.text}
                </div>
            )}

            <div className={styles.infoRow}>
                <span className={styles.infoLabel}>Address:</span>
                <span className={styles.infoValue} onClick={(e) => e.stopPropagation()}>
                    <CopyToClipboardText textToCopy={address || ''} className={styles.addressValueClickable}>
                        {truncate(address)}
                    </CopyToClipboardText>
                </span>
            </div>

            <div className={styles.statusItem}>
                <span className={styles.infoLabel}>Status:</span>
                <span className={styles.infoValue}>{statusDescription || '-'}</span>
            </div>

            <div className={styles.fundingItem}>
                <span className={styles.infoLabel}>Funding (ETH):</span>
                <span className={styles.infoValue}>{fundingInfo?.ethBalanceStr ?? '-'}</span>
                {fundingInfo?.needsEth && <span className={styles.statusNeedsFunding}>Needs ETH</span>}
            </div>
            {fundingInfo?.errorMessage && <div className={styles.statusError}>{fundingInfo.errorMessage}</div>}
            
            <div className={styles.configSectionInline}>
                <div className={styles.inlineLabel}>Limit (USDC):</div>
                <form onSubmit={handleSetLimits} className={styles.spendingLimitFormNodeCompact} onClick={(e) => e.stopPropagation()}>
                    <input 
                        type="number" 
                        step="any" 
                        min="0"
                        placeholder="Max/Call"
                        value={limitPerCall}
                        onChange={e => setLimitPerCall(e.target.value)} 
                        onClick={(e) => e.stopPropagation()}
                        className={styles.limitInputFieldNodeCompact}
                        disabled={limitsDisabled}
                        title={ (isEncrypted && !isUnlocked) ? "Wallet is locked. Unlock to change." : "Max USDC per call"}
                    />
                    <button 
                        type="submit" 
                        className={styles.limitButtonOkNodeCompact}
                        disabled={limitsDisabled}
                        onClick={(e) => e.stopPropagation()}
                    >
                        OK
                    </button>
                </form>
            </div>
            {(isEncrypted && !isUnlocked) && (
                <p className={styles.warningTextSmall}>Wallet locked. Limits cannot be changed.</p>
            )}
            
            <Handle type="source" position={Position.Bottom} style={{ visibility: 'hidden' }} />
        </div>
    );
};

export default HotWalletNodeComponent; 
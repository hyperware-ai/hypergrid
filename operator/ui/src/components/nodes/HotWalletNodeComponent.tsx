import React, { useState, useCallback, useEffect, useRef } from 'react';
import { NodeProps, Handle, Position } from 'reactflow';
import { IHotWalletNodeData, SpendingLimits } from '../../logic/types';
import type { Address } from 'viem';
import { NODE_WIDTH } from '../BackendDrivenHypergridVisualizer'; // Assuming NODE_WIDTH is exported
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
    onUnlockWallet: (walletAddress: Address, passwordInput: string) => Promise<void>;
    onLockWallet: (walletAddress: Address) => Promise<void>;
    isUnlockingOrLocking?: boolean;
}

const HotWalletNodeComponent: React.FC<HotWalletNodeComponentProps> = ({ data, id: nodeId, onWalletDataUpdate, onOpenHistoryModal, onUnlockWallet, onLockWallet, isUnlockingOrLocking }) => {
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

    const [limitPerCall, setLimitPerCall] = useState<string>(initialLimits?.maxPerCall || '');
    const [currentLimits, setCurrentLimits] = useState<SpendingLimits | null>(initialLimits);

    const [isEncrypted, setIsEncrypted] = useState<boolean>(initialIsEncrypted);
    const [isUnlocked, setIsUnlocked] = useState<boolean>(initialIsUnlocked);
    const [passwordInput, setPasswordInput] = useState<string>('');

    const [isEditingLimit, setIsEditingLimit] = useState<boolean>(false);
    const [tempLimitPerCall, setTempLimitPerCall] = useState<string>('');
    const limitInputRef = useRef<HTMLInputElement>(null);

    const [showPasswordInputForUnlock, setShowPasswordInputForUnlock] = useState<boolean>(false);

    const [isLocalActionLoading, setIsLocalActionLoading] = useState<boolean>(false);
    const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

    useEffect(() => {
        // Only update name if it actually changed from backend
        if (currentName !== initialName) {
        setCurrentName(initialName);
        setEditedName(initialName || '');
        }
        
        // Only update limits if they actually changed
        if (JSON.stringify(currentLimits) !== JSON.stringify(initialLimits)) {
        setCurrentLimits(initialLimits);
            setLimitPerCall(initialLimits?.maxPerCall || '');
            setTempLimitPerCall(initialLimits?.maxPerCall || '');
        }
        
        // Only update encryption status if it changed
        if (isEncrypted !== initialIsEncrypted) {
        setIsEncrypted(initialIsEncrypted);
        }
        
        // Only update unlock status if it changed
        // This prevents the wallet from appearing locked after operations
        if (isUnlocked !== initialIsUnlocked) {
        setIsUnlocked(initialIsUnlocked);
        }
        
        // Always reset editing states on prop changes
        setIsEditingName(false);
        setPasswordInput('');
        setIsEditingLimit(false);
        setShowPasswordInputForUnlock(false);
    }, [initialName, initialLimits, initialIsEncrypted, initialIsUnlocked, currentName, currentLimits, isEncrypted, isUnlocked]);

    useEffect(() => {
        if (isEditingName && nameInputRef.current) {
            nameInputRef.current.focus();
            nameInputRef.current.select();
        }
    }, [isEditingName]);

    useEffect(() => {
        if (isEditingLimit && limitInputRef.current) {
            limitInputRef.current.focus();
            limitInputRef.current.select();
        }
    }, [isEditingLimit]);

    const showToast = useCallback((type: 'success' | 'error', text: string, duration: number = 3000) => {
        setToastMessage({ type, text });
        setTimeout(() => {
            setToastMessage(null);
        }, duration);
    }, []);

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

    const handleLockWalletAttempt = async () => {
        try {
            await onLockWallet(address);
            showToast('success', 'Lock request sent.');
        } catch (err: any) {
            showToast('error', err.message || 'Failed to send lock request');
        }
    };

    const MCP_ENDPOINT_LOCAL = `${window.location.pathname.split('/').filter(p=>p).find(p=>p.includes(':')) ? '/'+window.location.pathname.split('/').filter(p=>p).find(p=>p.includes(':')) : ''}/api/mcp`;

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

    const handleSetLimitsAttempt = async () => { // Renamed from handleSetLimits, no event param
        if (isUnlockingOrLocking) return;

        const newLimitValue = tempLimitPerCall.trim() === '' ? null : tempLimitPerCall.trim();
        const currentEffectiveLimit = currentLimits?.maxPerCall?.trim() === '' ? null : currentLimits?.maxPerCall?.trim();

        if (newLimitValue === currentEffectiveLimit) {
            setIsEditingLimit(false); 
            return;
        }

        const limitsToSet: SpendingLimits = {
            maxPerCall: newLimitValue,
            maxTotal: null, 
            currency: 'USDC',
        };
        
        setIsLocalActionLoading(true);
        try {
            await callMcpApiLocal({ SelectWallet: { wallet_id: address } });
            await callMcpApiLocal({ SetWalletLimits: { limits: limitsToSet } });
            showToast('success', 'Spending limits updated.');
            setCurrentLimits(limitsToSet);
            setLimitPerCall(newLimitValue || '');
            onWalletDataUpdate(address);
            setIsEditingLimit(false);
        } catch (err: any) {
            showToast('error', err.message || 'Failed to set limits.');
        } finally {
            setIsLocalActionLoading(false);
        }
    };

    const handleLimitInputBlur = () => {
        // Save if value changed, otherwise just exit edit mode
        const newLimitValue = tempLimitPerCall.trim() === '' ? null : tempLimitPerCall.trim();
        const currentEffectiveLimit = currentLimits?.maxPerCall?.trim() === '' ? null : currentLimits?.maxPerCall?.trim();
        if (newLimitValue !== currentEffectiveLimit) {
            handleSetLimitsAttempt();
        } else {
            setIsEditingLimit(false);
            setTempLimitPerCall(limitPerCall || ''); // Reset temp to actual if no change
        }
    };

    const handleLimitInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            handleSetLimitsAttempt();
        }
        if (event.key === 'Escape') {
            event.preventDefault();
            setTempLimitPerCall(limitPerCall || ''); // Reset to original
            setIsEditingLimit(false);
        }
    };

    const handleToggleLimitEdit = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (isUnlockingOrLocking || (isEncrypted && !isUnlocked)) {
            showToast('error', 'Unlock wallet to change limits.');
            return;
        }
        if (!isEditingLimit) {
            setTempLimitPerCall(currentLimits?.maxPerCall || '');
        }
        setIsEditingLimit(!isEditingLimit);
    };

    const handleLockIconClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        setShowPasswordInputForUnlock(true);
    };
    
    const handleUnlockAction = async () => {
        if (showPasswordInputForUnlock) { 
            await handleUnlockWalletAttempt();
            // setShowPasswordInputForUnlock(false); // Optional: parent refresh handles this by isUnlocked change
        }
    };

    const isWalletActuallyLocked = isEncrypted && !isUnlocked;

    const handleNodeAreaClick = () => {
        onOpenHistoryModal(address);
    };

    // Name Editing Handlers
    const handleNameDisplayClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (isUnlockingOrLocking) return;
        setIsEditingName(true);
    };

    const handleRenameWallet = async () => {
        if (!editedName.trim() || editedName.trim() === currentName) {
            setIsEditingName(false);
            setEditedName(currentName || '');
            return;
        }
        if (isUnlockingOrLocking) return;

        setIsLocalActionLoading(true);
        try {
            const requestBody = { RenameWallet: { wallet_id: address, new_name: editedName.trim() } };
            await callMcpApiLocal(requestBody);
            showToast('success', `Wallet renamed to "${editedName.trim()}".`);
            setCurrentName(editedName.trim());
            setIsEditingName(false);
            onWalletDataUpdate(address);
        } catch (err: any) { 
            showToast('error', err.message || 'Failed to rename wallet.');
            setEditedName(currentName || ''); 
            setIsEditingName(false); 
        } finally {
            setIsLocalActionLoading(false);
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
            style={{ 
                maxWidth: NODE_WIDTH, 
                cursor: 'pointer', 
                position: 'relative' 
            }} 
            onClick={isWalletActuallyLocked ? handleLockIconClick : handleNodeAreaClick}
            title={isWalletActuallyLocked ? "Wallet Locked. Click to Unlock." : `Click node to view history, click name to edit`}
        >
            {/* Top-Right Lock Icon - always rendered if locked, click handled by handleLockIconClick */} 
            {isWalletActuallyLocked && (
                <div 
                    className={styles.lockIconTopRight} 
                    onClick={handleLockIconClick} 
                    title="Wallet Locked. Click to Unlock."
                >
                    🔒 
                </div>
            )}

            <Handle type="target" position={Position.Top} style={{ visibility: 'hidden' }} />
            
            {/* Content Wrapper for Blur Effect */}
            <div className={`${styles.nodeContentWrapper} ${isWalletActuallyLocked && !showPasswordInputForUnlock ? styles.contentBlurred : ''}`}>
                <div className={styles.header}>
                    <div className={styles.nodeTitle}>Hot Wallet</div>
                    <div className={styles.nodeSubtitle}>
                    {isEditingName ? (
                        <input 
                            ref={nameInputRef}
                            type="text"
                            value={editedName}
                            onChange={(e) => setEditedName(e.target.value)}
                            onBlur={handleNameInputBlur}
                            onKeyDown={handleNameInputKeyDown}
                            className={styles.nameInputEditing} 
                            disabled={isLocalActionLoading || isUnlockingOrLocking}
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
                </div>

                {toastMessage && (
                    <div className={`${styles.toastNotification} ${toastMessage.type === 'success' ? styles.toastSuccess : styles.toastError}`}>
                        {toastMessage.text}
                    </div>
                )}

                <div className={`${styles.infoRow} ${styles.addressRowAltered}`}> {/* Use infoRow for consistent styling */}
                    <span className={styles.infoLabel}>Address:</span>
                    <span className={styles.infoValue} onClick={(e) => e.stopPropagation()}>
                        <CopyToClipboardText textToCopy={address || ''} className={styles.addressValueClickable}>
                            {truncate(address)}
                        </CopyToClipboardText>
                    </span>
                </div>

                <div className={`${styles.infoRow} ${styles.statusRowAltered}`}> {/* Use infoRow */}
                    <span className={styles.infoLabel}>Status:</span>
                    <span className={styles.infoValue}>{statusDescription || '-'}</span>
                </div>


                {fundingInfo?.errorMessage && <div className={`${styles.infoRow} ${styles.errorRowAltered}`}><span className={styles.infoLabel}></span><span className={`${styles.infoValue} ${styles.statusError}`}>{fundingInfo.errorMessage}</span></div>}
                
                {/* Transaction Limit Display/Edit Section */}
                <div 
                    className={`${styles.infoRow} ${styles.limitConfigRowAltered}`} 
                    style={{ marginTop: (showPasswordInputForUnlock && isWalletActuallyLocked) ? '5px' : '0' }}
                >
                    <span className={styles.infoLabel}>Transaction Limit:</span>
                    <span className={styles.infoValue} onClick={(e) => e.stopPropagation()}>
                        {isEditingLimit ? (
                            <input 
                                ref={limitInputRef}
                                type="number" 
                                step="any" 
                                min="0"
                                placeholder="(empty for ∞)"
                                value={tempLimitPerCall} 
                                onChange={e => setTempLimitPerCall(e.target.value)} 
                                onBlur={handleLimitInputBlur}
                                onKeyDown={handleLimitInputKeyDown}
                                className={styles.limitInputFieldInline} 
                                disabled={isLocalActionLoading || isUnlockingOrLocking || isWalletActuallyLocked}
                                autoFocus
                            />
                        ) : (
                            <span 
                                className={styles.limitValueDisplayClickable} 
                                onClick={handleToggleLimitEdit} 
                                title={isWalletActuallyLocked ? "Unlock wallet to change limit" : "Click to change transaction limit"}
                            >
                                {
                                    (currentLimits && currentLimits.maxPerCall && currentLimits.maxPerCall.trim() !== '') 
                                    ? `${currentLimits.maxPerCall} ${(currentLimits.currency || 'USDC')}` 
                                    : <span style={{ fontSize: '1.2em' }}>∞</span>
                                }
                            </span>
                        )}
                    </span>
                </div>

                {/* Spending Limit Display (Lifetime Total) */}
                <div className={`${styles.infoRow}`}>
                    <span className={styles.infoLabel}>Spending Limit:</span>
                    <span className={styles.infoValue}>
                        {(currentLimits && currentLimits.maxTotal && currentLimits.maxTotal.trim() !== '') 
                            ? `${currentLimits.maxTotal} ${(currentLimits.currency || 'USDC')} total` 
                            : 'Unlimited'
                        }
                    </span>
                </div>

                {/* Total Spent Display (if limits exist) */}
                {currentLimits && (
                    <div className={`${styles.infoRow}`}>
                        <span className={styles.infoLabel}>Total Spent:</span>
                        <span className={styles.infoValue}>
                            {currentLimits.totalSpent || '0'} {(currentLimits.currency || 'USDC')}
                        </span>
                    </div>
                )}
            </div>

            {/* Unlock Section - Appears distinctly, not part of the blurred content wrapper */}
            {showPasswordInputForUnlock && isWalletActuallyLocked && (
                <div className={styles.unlockOverlaySection} onClick={(e) => e.stopPropagation()}> {/* New class for overlay styling */}
                    <h4>{isEncrypted ? 'Unlock' : 'Activate'} Wallet: {currentName || truncate(address)}</h4>
                    {isEncrypted && (
                    <input 
                        type="password"
                        placeholder="Enter Password"
                        value={passwordInput}
                        onChange={(e) => setPasswordInput(e.target.value)}
                        className={styles.passwordInputCentered} // New/Updated class
                        disabled={isUnlockingOrLocking} 
                        autoFocus
                    />
                    )}
                    {!isEncrypted && (
                        <p style={{ marginBottom: '10px', fontSize: '0.9em', color: '#888' }}>
                            This wallet needs to be activated for use.
                        </p>
                    )}
                    <div className={styles.unlockButtonContainer}> {/* For button layout */}
                        <button
                            onClick={handleUnlockAction}
                            disabled={isUnlockingOrLocking || (isEncrypted && !passwordInput)}
                            className={styles.actionButtonPrimary} // New/Updated class
                        >
                            {isUnlockingOrLocking ? (isEncrypted ? 'Unlocking...' : 'Activating...') : (isEncrypted ? 'Unlock' : 'Activate')}
                        </button>
                        <button 
                            type="button" 
                            onClick={(e) => { e.stopPropagation(); setShowPasswordInputForUnlock(false); setPasswordInput(''); }}
                            className={styles.actionButtonSecondary} // New/Updated class
                            disabled={isUnlockingOrLocking}
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}
            
            <Handle type="source" position={Position.Bottom} style={{ visibility: 'hidden' }} />
        </div>
    );
};

export default HotWalletNodeComponent; 
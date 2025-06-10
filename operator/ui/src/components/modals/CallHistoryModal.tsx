import React from 'react';
import CallHistory from '../CallHistory'; // Assuming CallHistory is in ../components/
import styles from './CallHistoryModal.module.css'; // CSS for the modal itself
import type { Address } from 'viem';

interface CallHistoryModalProps {
    isOpen: boolean;
    onClose: () => void;
    walletAddress: Address | null; // This will be the selectedAccountId for CallHistory
}

const CallHistoryModal: React.FC<CallHistoryModalProps> = ({
    isOpen,
    onClose,
    walletAddress,
}) => {
    if (!isOpen) {
        return null;
    }

    // Helper to truncate the address for the title
    const truncate = (str: string | null | undefined, startLen = 8, endLen = 6) => {
        if (!str) return '';
        if (str.length <= startLen + endLen + 3) return str;
        return `${str.substring(0, startLen)}...${str.substring(str.length - endLen)}`;
    };

    return (
        <div className={styles.modalOverlay} onClick={onClose}>
            <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
                <button className={styles.closeButton} onClick={onClose}>&times;</button>
                <h3>Call History for {walletAddress ? truncate(walletAddress) : 'Wallet'}</h3>
                <div className={styles.historyInnerContainer}>
                    <CallHistory selectedAccountId={walletAddress} isNonCollapsible={true} />
                </div>
            </div>
        </div>
    );
};

export default CallHistoryModal; 
import React from 'react';
import CallHistory from '../CallHistory'; // Assuming CallHistory is in ../components/
import type { Address } from 'viem';
import { truncate } from '../../utils/truncate';
import Modal from './Modal';

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

    return (
        <Modal
            title={`Call History for ${walletAddress ? truncate(walletAddress) : 'Wallet'}`}
            onClose={onClose}
            preventAccidentalClose={true}
        >
            <CallHistory selectedAccountId={walletAddress} isNonCollapsible={true} />
        </Modal>
    );
};

export default CallHistoryModal; 
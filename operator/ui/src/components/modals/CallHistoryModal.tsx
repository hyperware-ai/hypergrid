import React from 'react';
import CallHistory from '../CallHistory'; // Assuming CallHistory is in ../components/
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
        <div className="fixed inset-0 bg-black bg-opacity-45 flex items-center justify-center z-50" onClick={onClose}>
            <div className="bg-white text-gray-800 p-6 rounded-lg w-[90%] max-w-4xl max-h-[85vh] flex flex-col shadow-xl border border-gray-300" onClick={(e) => e.stopPropagation()}>
                <button className="absolute top-4 right-5 bg-transparent border-none text-gray-500 text-3xl cursor-pointer leading-none p-1 hover:text-gray-800" onClick={onClose}>&times;</button>
                <h3 className="mt-0 text-gray-800 pb-4 mb-5 border-b border-gray-200 text-2xl text-center">Call History for {walletAddress ? truncate(walletAddress) : 'Wallet'}</h3>
                <div className="flex-grow overflow-y-auto pr-1">
                    <CallHistory selectedAccountId={walletAddress} isNonCollapsible={true} />
                </div>
            </div>
        </div>
    );
};

export default CallHistoryModal; 
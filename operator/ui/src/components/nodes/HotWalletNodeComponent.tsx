import React, { useState, useCallback, useEffect, useRef } from 'react';
import classNames from 'classnames';
import { NodeProps, Handle, Position } from 'reactflow';
import { IHotWalletNodeData, SpendingLimits } from '../../logic/types';
import type { Address } from 'viem';
import CopyToClipboardText from '../CopyToClipboardText';
import { truncate } from '../../utils/truncate';
import { useErrorLogStore } from '../../store/errorLog';
import BaseNodeComponent from './BaseNodeComponent';
// lock icons removed
import { SlClock, SlPencil } from 'react-icons/sl';


// Prop for callback when wallet data is updated from modal
interface HotWalletNodeComponentProps extends NodeProps<IHotWalletNodeData> {
    onWalletDataUpdate: (walletAddress: Address) => void;
    onOpenHistoryModal: (walletAddress: Address) => void;
    onOpenSettingsModal: () => void; // New prop to open settings modal
}

const HotWalletNodeComponent: React.FC<HotWalletNodeComponentProps> = ({ data, id: nodeId, onWalletDataUpdate, onOpenHistoryModal, onOpenSettingsModal }) => {
    const { showToast } = useErrorLogStore();
    const {
        address,
        statusDescription,
        fundingInfo,
        isEncrypted: initialIsEncrypted,
        isUnlocked: initialIsUnlocked,
        limits: initialLimits,
        name: initialName
    } = data;

    // Simplified state - lock functionality removed from UI
    const [isEncrypted, setIsEncrypted] = useState<boolean>(initialIsEncrypted);

    useEffect(() => {
        // Only update encryption status if it changed
        if (isEncrypted !== initialIsEncrypted) {
            setIsEncrypted(initialIsEncrypted);
        }

        // lock state hidden in UI
    }, [initialIsEncrypted, initialIsUnlocked, isEncrypted]);

    return (
        <BaseNodeComponent
            showHandles={{ target: true, source: true }}
        >
            <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
                <button
                    onClick={(e) => { e.stopPropagation(); onOpenSettingsModal(); }}
                    title="Open Settings"
                    className="text-lg hover:text-gray-300"
                >
                    <SlPencil />
                </button>
            </div>


            <div className={classNames("flex flex-col") }>
                <div className="font-bold">
                    <span>Hot Wallet</span>
                </div>

                <span>
                    {(initialName && initialName.toLowerCase() !== 'unnamed')
                        ? `"${initialName}"`
                        : truncate(address)}
                </span>

                <div className="text-sm leading-relaxed flex justify-between items-center">
                    <span className="text-gray-400 mr-2 whitespace-nowrap">Address:</span>
                    <span className="text-gray-300 break-all text-right flex-grow" onClick={(e) => e.stopPropagation()}>
                        <CopyToClipboardText textToCopy={address || ''} className="text-blue-400 cursor-pointer no-underline hover:underline">
                            {truncate(address)}
                        </CopyToClipboardText>
                    </span>
                </div>

                {/*
                <div className="text-sm leading-relaxed flex justify-between items-center">
                    <span className="text-gray-400 mr-2 whitespace-nowrap">Status:</span>
                    <span className="text-gray-300 text-right flex-grow">{statusDescription || '-'}</span>
                </div>
                */}

                {fundingInfo?.errorMessage && (
                    <div className="text-sm leading-relaxed flex justify-between items-center">
                        <span className="text-gray-400 mr-2"></span>
                        <span className="text-red-400 text-sm ">{fundingInfo.errorMessage}</span>
                    </div>
                )}

                <div className="text-sm leading-relaxed flex justify-between items-center">
                    <span className="text-gray-400 mr-2 whitespace-nowrap">Transaction Limit:</span>
                    <span className="text-gray-300 text-right flex-grow">
                        {(initialLimits && initialLimits.maxPerCall && initialLimits.maxPerCall.trim() !== '')
                            ? `${initialLimits.maxPerCall} ${(initialLimits.currency || 'USDC')}`
                            : 'Unlimited'
                        }
                    </span>
                </div>

                <div className="text-sm leading-relaxed flex justify-between items-center">
                    <span className="text-gray-400 mr-2 whitespace-nowrap">Spending Limit:</span>
                    <span className="text-gray-300 text-right flex-grow">
                        {(initialLimits && initialLimits.maxTotal && initialLimits.maxTotal.trim() !== '')
                            ? `${initialLimits.maxTotal} ${(initialLimits.currency || 'USDC')}`
                            : 'Unlimited'
                        }
                    </span>
                </div>

                {/*
                {initialLimits && (
                    <div className="text-sm leading-relaxed flex justify-between items-center">
                        <span className="text-gray-400 mr-2 whitespace-nowrap">Total Spent:</span>
                        <span className="text-gray-300 text-right flex-grow">
                            {initialLimits.totalSpent || '0'} {(initialLimits.currency || 'USDC')}
                        </span>
                    </div>
                )}
                */}
            </div>

            {/* Locking/password UI removed */}

            <button
                onClick={() => onOpenHistoryModal(address)}
                className="self-stretch bg-mid-gray/25 hover:bg-black hover:text-white  justify-center p-1"
            >
                <SlClock className="text-xl" />
                <span>Call History</span>
            </button>
        </BaseNodeComponent>
    );
};

export default HotWalletNodeComponent; 
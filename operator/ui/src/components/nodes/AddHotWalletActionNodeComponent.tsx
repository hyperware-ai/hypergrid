import React from 'react';
import { NodeProps } from 'reactflow';
import { IAddHotWalletActionNodeData } from '../../logic/types';
import LinkHotWalletsInline from '../LinkHotWalletsInline';
import BaseNodeComponent from './BaseNodeComponent';
import type { Address } from 'viem';

// Define a more specific type for the data prop including what LinkHotWalletsInline expects
interface ExtendedAddHotWalletActionNodeData extends IAddHotWalletActionNodeData {
    operatorTbaAddress?: Address | null;
    operatorEntryName?: string | null;
    currentLinkedWallets?: Address[];
    onWalletsLinked?: () => void;
    label: string;
}

const AddHotWalletActionNodeComponent: React.FC<NodeProps<ExtendedAddHotWalletActionNodeData>> = ({ data }) => {
    const {
        operatorTbaAddress,
        operatorEntryName,
        currentLinkedWallets,
        onWalletsLinked,
        label
    } = data;

    return (
        <BaseNodeComponent
            showHandles={{ target: true, source: false }}
        >
            <div className="font-bold border-b border-mid-gray/50 pb-1">
                {label}
            </div>

            {(operatorTbaAddress && operatorEntryName && onWalletsLinked) ? (
                <LinkHotWalletsInline
                    operatorTbaAddress={operatorTbaAddress}
                    operatorEntryName={operatorEntryName}
                    currentLinkedWallets={currentLinkedWallets || []}
                    onWalletsLinked={onWalletsLinked}
                />
            ) : (
                <div className="text-center text-sm text-warning flex-grow flex items-center justify-center">
                    Operator details not fully loaded for linking.
                </div>
            )}
        </BaseNodeComponent>
    );
};

export default AddHotWalletActionNodeComponent; 
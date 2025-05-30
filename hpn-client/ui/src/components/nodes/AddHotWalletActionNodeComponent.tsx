import React from 'react';
import { NodeProps, Handle, Position } from 'reactflow';
import { IAddHotWalletActionNodeData } from '../../logic/types';
import LinkHotWalletsInline from '../LinkHotWalletsInline';
import { NODE_WIDTH } from '../BackendDrivenHpnVisualizer';
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
        <div style={{
            padding: '10px',
            border: '1px solid #444',
            borderRadius: '8px',
            background: '#2d2d2d',
            color: '#f0f0f0',
            width: '100%',
            maxWidth: NODE_WIDTH, // Use imported NODE_WIDTH
            minHeight: '100px', // Ensure some minimum height for the inline content
            boxSizing: 'border-box',
            display: 'flex', // Added for centering content
            flexDirection: 'column' // Added for centering content
        }}>
            <Handle type="target" position={Position.Top} style={{ visibility: 'hidden' }} />
            
            <div style={{ marginBottom: '10px', fontWeight: 'bold', color: '#ffff00', textAlign: 'center'}}>
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
                <div style={{ textAlign: 'center', fontSize: '0.9em', color: 'orange', flexGrow: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    Operator details not fully loaded for linking.
                </div>
            )}
            {/* Hidden source handle if this node can be a source for edges */}
            {/* <Handle type="source" position={Position.Bottom} style={{ visibility: 'hidden' }} /> */}
        </div>
    );
};

export default AddHotWalletActionNodeComponent; 
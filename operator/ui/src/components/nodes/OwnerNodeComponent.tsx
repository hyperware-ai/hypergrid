import React from 'react';
import { NodeProps, Handle, Position } from 'reactflow';
import { IOwnerNodeData } from '../../logic/types';
import { NODE_WIDTH } from '../BackendDrivenHypergridVisualizer'; // Assuming NODE_WIDTH is exported
import CopyToClipboardText from '../CopyToClipboardText';

// Helper to truncate text (can be moved to a utils file)
const truncate = (str: string | undefined, startLen = 6, endLen = 4) => {
    if (!str) return '';
    if (str.length <= startLen + endLen + 3) return str;
    return `${str.substring(0, startLen)}...${str.substring(str.length - endLen)}`;
};

const OwnerNodeComponent: React.FC<NodeProps<IOwnerNodeData>> = ({ data }) => {
    const { name, tbaAddress, ownerAddress } = data;
    const displayAddress = tbaAddress || ownerAddress;

    return (
        <div
            className="p-3 border rounded-lg box-border font-sans flex flex-col gap-2 text-left"
            style={{
                maxWidth: NODE_WIDTH,
                borderColor: '#00ff00',
                backgroundColor: '#2a2a2a',
                color: '#f0f0f0'
            }}
        >
            <Handle type="target" position={Position.Top} style={{ visibility: 'hidden' }} />
            <div className="mb-2 text-center">
                <div className="text-base font-bold mb-0.5" style={{ color: '#00ff00' }}>Operator</div>
                <div className="text-sm text-gray-400 break-words leading-tight">{name}</div>
            </div>
            {displayAddress && (
                <div className="text-sm text-gray-400 break-all">
                    Address:{` `}
                    <CopyToClipboardText textToCopy={displayAddress} className="text-blue-400 cursor-pointer no-underline hover:underline">
                        {truncate(displayAddress, 10, 6)}
                    </CopyToClipboardText>
                </div>
            )}
            <Handle type="source" position={Position.Bottom} style={{ visibility: 'hidden' }} />
        </div>
    );
};

export default OwnerNodeComponent; 
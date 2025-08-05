import React from 'react';
import { NodeProps, Handle, Position } from 'reactflow';
import { IOwnerNodeData } from '../../logic/types';
import { NODE_WIDTH } from '../BackendDrivenHypergridVisualizer';
import CopyToClipboardText from '../CopyToClipboardText';
import { truncate } from '../../utils/truncate';
import { FaGear, FaLink } from 'react-icons/fa6';

const OwnerNodeComponent: React.FC<NodeProps<IOwnerNodeData>> = ({ data }) => {
    const { name, tbaAddress, ownerAddress } = data;
    const displayAddress = tbaAddress || ownerAddress;

    return (
        <div
            className="p-6 border rounded font-sans flex flex-col gap-2  border-black bg-gray"
            style={{
                maxWidth: NODE_WIDTH,
            }}
        >
            <Handle className="hidden" type="target" position={Position.Top} />
            <div className="flex flex-col">
                <div className="flex items-center gap-1">
                    <FaGear className="w-5 h-5" />
                    <div className=" font-bold">Operator:</div>
                </div>
                <div className="text-sm text-mid-gray wrap-anywhere leading-tight">{name}</div>
            </div>
            {displayAddress && <div className="flex flex-col">
                <div className="flex items-center gap-1">
                    <FaLink className="w-5 h-5" />
                    <div className=" font-bold">Address:</div>
                </div>
                <CopyToClipboardText
                    textToCopy={displayAddress}
                    className="text-mid-gray text-sm cursor-pointer no-underline hover:underline"
                >
                    {truncate(displayAddress, 10, 6)}
                </CopyToClipboardText>
            </div>}
            <Handle type="source" position={Position.Bottom} style={{ visibility: 'hidden' }} />
        </div>
    );
};

export default OwnerNodeComponent; 
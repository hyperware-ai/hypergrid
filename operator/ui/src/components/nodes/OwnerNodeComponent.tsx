import React from 'react';
import { NodeProps, Handle, Position } from 'reactflow';
import { IOwnerNodeData } from '../../logic/types';
import { NODE_WIDTH } from '../BackendDrivenHypergridVisualizer';
import CopyToClipboardText from '../CopyToClipboardText';
import { truncate } from '../../utils/truncate';
import { FaGear, FaLink } from 'react-icons/fa6';
import BaseNodeComponent from './BaseNodeComponent';

const OwnerNodeComponent: React.FC<NodeProps<IOwnerNodeData>> = ({ data }) => {
    const { name, tbaAddress, ownerAddress } = data;
    const displayAddress = tbaAddress || ownerAddress;

    return (
        <BaseNodeComponent
            showHandles={{ target: false, source: true }}
        >
            <div className="flex flex-col">
                <div className="flex items-center gap-1">
                    <FaGear className="w-5 h-5" />
                    <div className=" font-bold">Operator:</div>
                </div>
                <div className="text-sm opacity-50 wrap-anywhere leading-tight">{name}</div>
            </div>
            {displayAddress && <div className="flex flex-col">
                <div className="flex items-center gap-1">
                    <FaLink className="w-5 h-5" />
                    <div className=" font-bold">Address:</div>
                </div>
                <CopyToClipboardText
                    textToCopy={displayAddress}
                    className="text-sm cursor-pointer no-underline hover:underline"
                >
                    <span className="opacity-50">{truncate(displayAddress, 10, 6)}</span>
                </CopyToClipboardText>
            </div>}
        </BaseNodeComponent>
    );
};

export default OwnerNodeComponent; 
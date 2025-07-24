import React from 'react';
import { NodeProps, Handle, Position } from 'reactflow';
import { IOwnerNodeData } from '../../logic/types';
import { NODE_WIDTH } from '../BackendDrivenHypergridVisualizer'; // Assuming NODE_WIDTH is exported
import CopyToClipboardText from '../CopyToClipboardText';
import styles from '../OwnerNode.module.css';

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
        <div className={styles.nodeContainer} style={{ maxWidth: NODE_WIDTH }}>
            <Handle type="target" position={Position.Top} style={{ visibility: 'hidden' }} />
            <div className={styles.header}>
                <div className={styles.nodeTitle}>Operator</div>
                <div className={styles.nodeSubtitle}>{name}</div>
            </div>
            {displayAddress && (
                <div className={styles.addressRow}>
                    Address:{` `}
                    <CopyToClipboardText textToCopy={displayAddress} className={styles.addressClickable}>
                        {truncate(displayAddress, 10, 6)}
                    </CopyToClipboardText>
                </div>
            )}
            <Handle type="source" position={Position.Bottom} style={{ visibility: 'hidden' }} />
        </div>
    );
};

export default OwnerNodeComponent; 
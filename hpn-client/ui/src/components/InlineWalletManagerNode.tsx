import React from 'react';
import { Handle, Position } from 'reactflow';
import MinimalWalletManager from './MinimalWalletManager';

// data prop will be typed more strictly in HpnVisualManager when creating the node
const InlineWalletManagerNodeComponent = ({ data }: { data: any }) => {
    return (
        <div style={{
            // Basic styling for the node; can be adjusted
            // Width should be controlled by MinimalWalletManager's content ideally
            // border: '1px solid #555', 
            // borderRadius: '5px',
            // background: 'transparent' // The MinimalWalletManager has its own background
        }}>
            {/* No Handles needed if it's a terminal display element or if connections are managed differently */}
            {/* <Handle type="target" position={Position.Top} style={{ background: '#555' }} /> */}
            <MinimalWalletManager
                onActionComplete={data.onActionComplete}
                onCloseManager={data.onCloseManager}
            />
            {/* <Handle type="source" position={Position.Bottom} style={{ background: '#555' }} /> */}
        </div>
    );
};

export default InlineWalletManagerNodeComponent; 
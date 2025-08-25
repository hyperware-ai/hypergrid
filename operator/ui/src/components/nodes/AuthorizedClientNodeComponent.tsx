import React from 'react';
import { NodeProps } from 'reactflow';
import { IAuthorizedClientNodeData } from '../../logic/types';
import CopyToClipboardText from '../CopyToClipboardText';
import { truncate } from '../../utils/truncate';
import BaseNodeComponent from './BaseNodeComponent';
import { SlPencil } from 'react-icons/sl';

interface AuthorizedClientNodeComponentProps extends NodeProps<IAuthorizedClientNodeData> {
    onOpenSettingsModal: () => void;
}

const AuthorizedClientNodeComponent: React.FC<AuthorizedClientNodeComponentProps> = ({ data, onOpenSettingsModal }) => {
    const { clientId, clientName: initialClientName, associatedHotWalletAddress } = data;

    return (
        <BaseNodeComponent
            showHandles={{ target: true, source: true }}
        >
            {/* Pencil icon for settings modal */}
            <div className="absolute top-2 right-2 z-10">
                <button
                    onClick={(e) => { e.stopPropagation(); onOpenSettingsModal(); }}
                    title="Open Settings"
                    className="text-lg"
                >
                    <SlPencil />
                </button>
            </div>

            <div className="flex flex-col">
                <div className="font-bold">
                    <span>Authorized Client</span>
                </div>

                <span>
                    {initialClientName || 'Unnamed Client'}
                </span>

                <div className="text-sm leading-relaxed flex justify-between items-center">
                    <span className="text-dark-gray dark:text-gray mr-2 whitespace-nowrap">Client ID:</span>
                    <span className="text-dark-gray dark:text-gray break-all text-right flex-grow" onClick={(e) => e.stopPropagation()}>
                        <CopyToClipboardText textToCopy={clientId} className="text-blue-400 cursor-pointer no-underline hover:underline">
                            {truncate(clientId, 8, 8)}
                        </CopyToClipboardText>
                    </span>
                </div>

                <div className="text-sm leading-relaxed flex justify-between items-center">
                    <span className="text-gray-400 mr-2 whitespace-nowrap">Hot Wallet:</span>
                    <span className="text-gray-300 break-all text-right flex-grow" onClick={(e) => e.stopPropagation()}>
                        <CopyToClipboardText textToCopy={associatedHotWalletAddress} className="text-blue-400 cursor-pointer no-underline hover:underline">
                            {truncate(associatedHotWalletAddress)}
                        </CopyToClipboardText>
                    </span>
                </div>
            </div>
        </BaseNodeComponent>
    );
};

export default AuthorizedClientNodeComponent;
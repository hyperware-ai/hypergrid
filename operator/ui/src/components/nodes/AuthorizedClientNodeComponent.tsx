import React, { useState, useCallback, useEffect, useRef } from 'react';
import classNames from 'classnames';
import { NodeProps, Handle, Position } from 'reactflow';
import { IAuthorizedClientNodeData } from '../../logic/types';
import { NODE_WIDTH } from '../BackendDrivenHypergridVisualizer';
import CopyToClipboardText from '../CopyToClipboardText';

// Helper to truncate text (can be moved to a utils file)
const truncate = (str: string | undefined, startLen = 6, endLen = 4) => {
    if (!str) return '';
    if (str.length <= startLen + endLen + 3) return str;
    return `${str.substring(0, startLen)}...${str.substring(str.length - endLen)}`;
};

const AuthorizedClientNodeComponent: React.FC<NodeProps<IAuthorizedClientNodeData>> = ({ data }) => {
    const { clientId, clientName: initialClientName, associatedHotWalletAddress } = data;

    const [currentClientName, setCurrentClientName] = useState(initialClientName);
    const [isEditingName, setIsEditingName] = useState(false);
    const [editedName, setEditedName] = useState(initialClientName);
    const nameInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        setCurrentClientName(initialClientName);
        setEditedName(initialClientName);
        setIsEditingName(false);
    }, [initialClientName]);

    useEffect(() => {
        if (isEditingName && nameInputRef.current) {
            nameInputRef.current.focus();
            nameInputRef.current.select();
        }
    }, [isEditingName]);

    const handleNameChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        setEditedName(event.target.value);
    };

    const handleSaveName = useCallback(async () => {
        if (!editedName.trim() || editedName.trim() === currentClientName) {
            setIsEditingName(false);
            setEditedName(currentClientName);
            return;
        }
        console.log(`Saving new client name: "${editedName.trim()}" for client ID: ${clientId}`);
        await new Promise(resolve => setTimeout(resolve, 300));
        setCurrentClientName(editedName.trim());
        setIsEditingName(false);
    }, [editedName, clientId, currentClientName]);

    const handleNameInputBlur = () => {
        if (editedName.trim() !== currentClientName && editedName.trim() !== '') {
            handleSaveName();
        } else {
            setEditedName(currentClientName);
            setIsEditingName(false);
        }
    };

    const handleNameInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            handleSaveName();
        }
        if (event.key === 'Escape') {
            setEditedName(currentClientName);
            setIsEditingName(false);
        }
    };

    const handleNameClick = (e: React.MouseEvent) => {
        e.stopPropagation(); // Prevent node click when editing name
        setIsEditingName(true);
    };

    return (
        <div
            className="p-3 border border-cyan rounded-lg bg-gray-800 text-gray-100 box-border font-sans flex flex-col gap-2 text-left cursor-pointer"
            style={{
                maxWidth: NODE_WIDTH,
                cursor: 'pointer'
            }}
            title="Click to view configuration"
        >
            <Handle type="target" position={Position.Top} style={{ visibility: 'hidden' }} />

            <div className="mb-2 text-center">
                <div className="text-base font-bold mb-0.5" style={{ color: '#ff00ff' }}>Authorized Client</div>
                <div className="text-sm text-gray-400 break-words leading-tight flex justify-center items-center">
                    {isEditingName ? (
                        <input
                            ref={nameInputRef}
                            type="text"
                            value={editedName}
                            onChange={handleNameChange}
                            onBlur={handleNameInputBlur}
                            onKeyDown={handleNameInputKeyDown}
                            className="bg-gray-700 text-gray-100 border border-gray-600 rounded px-2 py-1 text-sm w-full min-w-0 mt-0.5 box-border"
                            style={{
                                backgroundColor: '#3a3a3a',
                                color: '#f0f0f0',
                                borderColor: '#555',
                                width: 'calc(100% - 16px)'
                            }}
                            onClick={(e) => e.stopPropagation()}
                        />
                    ) : (
                        <span
                            title={currentClientName}
                            onClick={handleNameClick}
                            className="cursor-text"
                        >
                            {currentClientName}
                        </span>
                    )}
                </div>
            </div>

            <div className="flex justify-between items-center text-sm leading-relaxed">
                <span className="text-gray-400 mr-2 whitespace-nowrap">Client ID:</span>
                <span className="text-gray-300 break-all" onClick={(e) => e.stopPropagation()}>
                    <CopyToClipboardText textToCopy={clientId} className="text-blue-400 cursor-pointer no-underline hover:underline">
                        {truncate(clientId, 8, 8)}
                    </CopyToClipboardText>
                </span>
            </div>

            <div className="flex justify-between items-center text-sm leading-relaxed">
                <span className="text-gray-400 mr-2 whitespace-nowrap">Hot Wallet:</span>
                <span className="text-gray-300 break-all" onClick={(e) => e.stopPropagation()}>
                    <CopyToClipboardText textToCopy={associatedHotWalletAddress} className="text-blue-400 cursor-pointer no-underline hover:underline">
                        {truncate(associatedHotWalletAddress)}
                    </CopyToClipboardText>
                </span>
            </div>

            <Handle type="source" position={Position.Bottom} style={{ visibility: 'hidden' }} />
        </div>
    );
};

export default AuthorizedClientNodeComponent; 
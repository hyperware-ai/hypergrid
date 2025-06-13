import React, { useState, useCallback, useEffect, useRef } from 'react';
import { NodeProps, Handle, Position } from 'reactflow';
import { IAuthorizedClientNodeData } from '../../logic/types';
import { NODE_WIDTH } from '../BackendDrivenHypergridVisualizer';
import CopyToClipboardText from '../CopyToClipboardText';
import styles from '../AuthorizedClientNode.module.css';

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
            className={styles.nodeContainer} 
            style={{ 
                maxWidth: NODE_WIDTH,
                cursor: 'pointer'
            }}
            title="Click to view configuration"
        >
            <Handle type="target" position={Position.Top} style={{ visibility: 'hidden' }} />
            
            <div className={styles.header}>
                Auth. Client:{" "}
                {isEditingName ? (
                    <input 
                        ref={nameInputRef}
                        type="text" 
                        value={editedName}
                        onChange={handleNameChange}
                        onBlur={handleNameInputBlur}
                        onKeyDown={handleNameInputKeyDown}
                        className={styles.nameInputEditing}
                        onClick={(e) => e.stopPropagation()}
                    />
                ) : (
                    <span 
                        title={currentClientName} 
                        onClick={handleNameClick} 
                        className={styles.nameDisplay}
                        style={{cursor: 'text'}}
                    >
                        {currentClientName}
                    </span>
                )}
            </div>

            <div className={styles.infoRow}>
                <span className={styles.infoLabel}>Client ID:</span>
                <span className={styles.infoValue} onClick={(e) => e.stopPropagation()}>
                    <CopyToClipboardText textToCopy={clientId} className={styles.infoValueClickable}>
                        {truncate(clientId, 8, 8)}
                    </CopyToClipboardText>
                </span>
            </div>

            <div className={styles.infoRow}>
                <span className={styles.infoLabel}>Hot Wallet:</span>
                <span className={styles.infoValue} onClick={(e) => e.stopPropagation()}>
                     <CopyToClipboardText textToCopy={associatedHotWalletAddress} className={styles.infoValueClickable}>
                        {truncate(associatedHotWalletAddress)}
                    </CopyToClipboardText>
                </span>
            </div>
            
            <Handle type="source" position={Position.Bottom} style={{ visibility: 'hidden' }} />
        </div>
    );
};

export default AuthorizedClientNodeComponent; 
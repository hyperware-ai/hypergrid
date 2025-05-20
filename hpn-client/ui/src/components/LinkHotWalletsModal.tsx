import React, { useState, useEffect, useCallback } from 'react';
import { Address } from 'viem';

import { useSetOperatorNote } from '../logic/hypermapHelpers';
// import { KinodeModernButton, KinodeModernInput, KinodeModernModal, KinodeModernAlert } from './KinodeModernUI'; // Assuming you have these

// API Base Path Helper
const getApiBasePath = () => {
    const pathParts = window.location.pathname.split('/').filter(p => p);
    const processIdPart = pathParts.find(part => part.includes(':'));
    return processIdPart ? `/${processIdPart}/api` : '/api';
};
const API_BASE_URL = getApiBasePath();
const MANAGED_WALLETS_ENDPOINT = `${API_BASE_URL}/managed-wallets`;

// TODO: Define this type based on the actual API response from /api/managed-wallets
interface ManagedWalletSummaryFromApi {
    id: string; // Wallet address (hex string)
    name: string | null;
    address: string; // Wallet address (hex string)
    is_active: boolean;
    is_locked: boolean;
    is_selected: boolean;
    balance_eth: string;
    balance_usdc: string;
    // Add other fields if present and needed
}

// Frontend interface (can be simpler if not all fields are used for display)
interface ManagedWalletSummary {
    id: string; // Using the id from API which is the address
    name: string | null;
    address: Address; // Store as Viem Address type
    isActive: boolean; // Derived from is_active and !is_locked
    // balanceEth: string;
    // balanceUsdc: string;
}

interface LinkHotWalletsModalProps {
    isOpen: boolean;
    onClose: () => void;
    operatorTbaAddress: Address | null;
    operatorEntryName: string | null; // e.g., hpn-beta-wallet.pertinent.os
    currentSignersNoteStatus: any; // To display current status if needed
    onWalletsLinked: () => void; // Callback after successful linking
}

const LinkHotWalletsModal: React.FC<LinkHotWalletsModalProps> = ({
    isOpen,
    onClose,
    operatorTbaAddress,
    operatorEntryName,
    currentSignersNoteStatus,
    onWalletsLinked,
}) => {
    const [managedWallets, setManagedWallets] = useState<ManagedWalletSummary[]>([]);
    const [selectedWallets, setSelectedWallets] = useState<Set<Address>>(new Set());
    const [isLoadingWallets, setIsLoadingWallets] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);

    const {
        setSignersNote,
        transactionHash,
        isSending,
        isConfirming,
        isConfirmed,
        error: signersNoteError,
        reset: resetSignersNote,
    } = useSetOperatorNote({
        onSuccess: (data) => {
            console.log("Successfully set signers note, tx:", data);
            onWalletsLinked(); // Refresh graph or state
            onClose(); // Close modal on success
        },
        onError: (err) => {
            console.error("Error setting signers note:", err);
            setError(`Failed to set signers note: ${err.message}`);
        },
    });

    // Fetch managed wallets when modal opens or operator details change
    useEffect(() => {
        if (isOpen) {
            const fetchWallets = async () => {
                setIsLoadingWallets(true);
                setError(null);
                setManagedWallets([]); // Clear previous wallets
                try {
                    console.log(`Fetching managed wallets from ${MANAGED_WALLETS_ENDPOINT}...`);
                    const response = await fetch(MANAGED_WALLETS_ENDPOINT);
                    if (!response.ok) {
                        const errText = await response.text();
                        throw new Error(`Failed to fetch wallets: ${response.status} ${errText}`);
                    }
                    const data = await response.json();
                    console.log("Received managed wallets data:", data);
                    if (data && Array.isArray(data.managed_wallets)) {
                        const transformedWallets: ManagedWalletSummary[] = data.managed_wallets.map((w: ManagedWalletSummaryFromApi) => ({
                            id: w.id, // id is the address
                            name: w.name,
                            address: w.address as Address, // cast to Viem Address
                            isActive: w.is_active && !w.is_locked, // Consider active if it's active AND not locked
                            // balanceEth: w.balance_eth,
                            // balanceUsdc: w.balance_usdc,
                        }));
                        setManagedWallets(transformedWallets);
                    } else {
                        console.warn("Managed wallets data is not in the expected format or managed_wallets array is missing:", data);
                        setManagedWallets([]);
                    }
                } catch (err: any) {
                    console.error("Error fetching managed wallets:", err);
                    setError(err.message || 'Failed to load wallets.');
                    setManagedWallets([]);
                }
                setIsLoadingWallets(false);
            };
            fetchWallets();
            resetSignersNote(); // Reset any previous transaction state from the hook
        }
    }, [isOpen, resetSignersNote]);

    const handleWalletSelection = (walletAddress: Address) => {
        setSelectedWallets(prev => {
            const newSelection = new Set(prev);
            if (newSelection.has(walletAddress)) {
                newSelection.delete(walletAddress);
            } else {
                newSelection.add(walletAddress);
            }
            return newSelection;
        });
    };

    const handleSubmit = () => {
        if (!operatorTbaAddress || !operatorEntryName) {
            setError("Operator details are missing. Cannot set signers note.");
            return;
        }
        if (selectedWallets.size === 0) {
            setError("Please select at least one hot wallet to link.");
            return;
        }
        setError(null);
        const addressesToLink = Array.from(selectedWallets);
        setSignersNote({
            operatorTbaAddress,
            operatorEntryName,
            hotWalletAddresses: addressesToLink,
        });
    };

    if (!isOpen) return null;

    return (
        <KinodeModernModal isOpen={isOpen} onClose={onClose} title="Link Hot Wallets to Operator">
            <div style={{ padding: '1rem' }}>
                {currentSignersNoteStatus && (
                    <div style={{ marginBottom: '1rem', padding: '0.5rem', border: '1px solid #ccc', borderRadius: '4px' }}>
                        <p><strong>Current Signers Note Status:</strong> {currentSignersNoteStatus.statusText}</p>
                        {currentSignersNoteStatus.isSet && currentSignersNoteStatus.details && (
                            <p>Details: {JSON.stringify(currentSignersNoteStatus.details)}</p>
                        )}
                    </div>
                )}

                {isLoadingWallets && <p>Loading managed hot wallets...</p>}
                {!isLoadingWallets && managedWallets.length === 0 && !error && (
                    <p>No managed hot wallets found. You can create or import wallets in the main Account Manager.</p>
                )}
                {!isLoadingWallets && managedWallets.length > 0 && (
                    <div style={{ marginBottom: '1rem' }}>
                        <h4>Select Hot Wallets to Link:</h4>
                        {managedWallets.map(wallet => (
                            <div key={wallet.id} style={{ display: 'flex', alignItems: 'center', marginBottom: '0.5rem' }}>
                                <input 
                                    type="checkbox" 
                                    id={`wallet-${wallet.id}`}
                                    checked={selectedWallets.has(wallet.address)}
                                    onChange={() => handleWalletSelection(wallet.address)}
                                    style={{ marginRight: '0.5rem' }}
                                />
                                <label htmlFor={`wallet-${wallet.id}`}>
                                    {wallet.name || 'Unnamed Wallet'} ({wallet.address.substring(0,6)}...{wallet.address.substring(wallet.address.length - 4)})
                                    {wallet.isActive ? ' (Active)' : ' (Inactive/Locked)'}
                                </label>
                            </div>
                        ))}
                    </div>
                )}

                {(error || signersNoteError) && (
                    <KinodeModernAlert type="error" style={{ marginBottom: '1rem' }}>
                        {error || signersNoteError?.message}
                    </KinodeModernAlert>
                )}

                {isSending && <p>Sending transaction to set signers note...</p>}
                {isConfirming && <p>Confirming transaction (Tx: {transactionHash})...</p>}
                {isConfirmed && transactionHash && (
                    <KinodeModernAlert type="success" style={{ marginBottom: '1rem' }}>
                        Signers note updated successfully! Tx: {transactionHash}
                    </KinodeModernAlert>
                )}

                <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
                    <KinodeModernButton 
                        variant="outline" 
                        onClick={onClose} 
                        disabled={isSending || isConfirming}
                    >
                        Cancel
                    </KinodeModernButton>
                    <KinodeModernButton 
                        onClick={handleSubmit} 
                        disabled={isSending || isConfirming || isLoadingWallets || selectedWallets.size === 0}
                    >
                        {isSending || isConfirming ? 'Processing...' : `Link ${selectedWallets.size} Wallet(s)`}
                    </KinodeModernButton>
                </div>
            </div>
        </KinodeModernModal>
    );
};

export default LinkHotWalletsModal;


// Basic styling for KinodeModern components (replace with actual imports or definitions)

const KinodeModernModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    title: string;
    children: React.ReactNode;
}> = ({ isOpen, onClose, title, children }) => 
    isOpen ? (
        <div style={{
            border: '1px solid #ccc', 
            padding: '20px', 
            background: 'white', 
            position: 'fixed', 
            top: '50%', 
            left: '50%', 
            transform: 'translate(-50%, -50%)',
            zIndex: 1000,
            minWidth: '400px',
            boxShadow: '0 4px 8px rgba(0,0,0,0.1)',
            borderRadius: '8px',
        }}>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px'}}>
                <h2 style={{margin: 0}}>{title}</h2>
                <button onClick={onClose} style={{background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer'}}>&times;</button>
            </div>
            {children}
        </div>
    ) : null;

const KinodeModernButton: React.FC<{
    children: React.ReactNode;
    onClick: () => void;
    disabled?: boolean;
    variant?: 'outline' | 'solid';
    style?: React.CSSProperties;
}> = ({ children, onClick, disabled, variant = 'solid', style }) => (
    <button 
        onClick={onClick} 
        disabled={disabled} 
        style={{
            padding: '10px 15px', 
            margin: '5px',
            border: variant === 'outline' ? '1px solid #007bff' : '1px solid #007bff',
            background: variant === 'outline' ? 'transparent' : '#007bff', 
            color: variant === 'outline' ? '#007bff' : 'white', 
            cursor: disabled ? 'not-allowed' : 'pointer',
            borderRadius: '4px',
            opacity: disabled ? 0.6 : 1,
            ...style,
        }}
    >
        {children}
    </button>
);

const KinodeModernAlert: React.FC<{
    children: React.ReactNode;
    type: 'error' | 'success' | 'warning';
    style?: React.CSSProperties;
}> = ({ children, type, style }) => (
    <div style={{
        padding: '10px 15px',
        margin: '10px 0',
        border: `1px solid ${type === 'error' ? '#dc3545' : type === 'success' ? '#28a745' : '#ffc107'}`,
        color: type === 'error' ? '#721c24' : type === 'success' ? '#155724' : '#856404',
        backgroundColor: type === 'error' ? '#f8d7da' : type === 'success' ? '#d4edda' : '#fff3cd',
        borderRadius: '4px',
        ...style,
    }}>
        {children}
    </div>
);

// Dummy KinodeModernInput if needed by other parts, not used in this modal directly yet
const KinodeModernInput: React.FC<React.InputHTMLAttributes<HTMLInputElement>> = (props) => (
    <input {...props} style={{padding: '8px', border: '1px solid #ccc', borderRadius: '4px', ...props.style}} />
); 
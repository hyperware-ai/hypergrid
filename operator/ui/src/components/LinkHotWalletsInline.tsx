import React, { useState, useEffect, useCallback } from 'react';
import { Address } from 'viem';
import { useSetOperatorNote } from '../logic/hypermapHelpers';
import { ImSpinner8 } from 'react-icons/im';
import { truncate } from '../utils/truncate';
import { FaPlus } from 'react-icons/fa6';
import { FiCheck, FiCheckCircle, FiCircle, FiPlusCircle } from 'react-icons/fi';
import classNames from 'classnames';
import { callApiWithRouting } from '../utils/api-endpoints';

// API Base Path Helper
const getApiBasePath = () => {
    const pathParts = window.location.pathname.split('/').filter(p => p);
    const processIdPart = pathParts.find(part => part.includes(':'));
    return processIdPart ? `/${processIdPart}/api` : '/api';
};
const API_BASE_URL = getApiBasePath();
const LINKED_WALLETS_ENDPOINT = `${API_BASE_URL}/linked-wallets`;
const MCP_ENDPOINT = `${API_BASE_URL}/mcp`;

interface LinkedWalletFromApi {
    address: string;
    name: string | null;
    is_managed: boolean;
    is_linked_on_chain: boolean;
    is_active: boolean;
    is_encrypted: boolean;
    is_selected: boolean;
    is_unlocked: boolean;
}

interface LinkedWallet {
    address: Address;
    name: string | null;
    isManaged: boolean;
    isLinkedOnChain: boolean;
    isActive: boolean;
    isSelected: boolean;
    isUnlocked: boolean;
}

interface LinkHotWalletsInlineProps {
    operatorTbaAddress: Address | null;
    operatorEntryName: string | null;
    currentLinkedWallets?: Address[]; // Currently linked wallet addresses
    onWalletsLinked: () => void;
}

const LinkHotWalletsInline: React.FC<LinkHotWalletsInlineProps> = ({
    operatorTbaAddress,
    operatorEntryName,
    currentLinkedWallets = [],
    onWalletsLinked,
}) => {
    const [allWallets, setAllWallets] = useState<LinkedWallet[]>([]);
    const [selectedWallets, setSelectedWallets] = useState<Set<Address>>(new Set());
    const [isLoadingWallets, setIsLoadingWallets] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);

    // Wallet creation states
    const [showImportForm, setShowImportForm] = useState<boolean>(false);
    const [privateKeyToImport, setPrivateKeyToImport] = useState<string>('');
    const [walletNameToImport, setWalletNameToImport] = useState<string>('');
    const [isCreatingWallet, setIsCreatingWallet] = useState<boolean>(false);

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
            console.log("Successfully set/updated signers note (transaction sent), tx:", data);
        },
        onError: (err) => {
            console.error("Error setting/updating signers note:", err);
            setError(`Failed to update signers: ${err.message}`);
        },
    });

    // Effect to synchronize selectedWallets with on-chain linked wallets
    useEffect(() => {
        // Update selected wallets based on which ones are actually linked on-chain
        const newSelectedWallets = new Set<Address>();
        allWallets.forEach(wallet => {
            if (wallet.isLinkedOnChain) {
                newSelectedWallets.add(wallet.address);
            }
        });
        setSelectedWallets(newSelectedWallets);
    }, [allWallets]);

    // Effect to refresh graph data once the transaction is confirmed
    useEffect(() => {
        if (isConfirmed && transactionHash) {
            console.log("Signers note transaction confirmed. Refreshing wallets/graph with delay. Tx:", transactionHash);
            // Add delay to allow backend to sync with blockchain
            setTimeout(() => {
                onWalletsLinked();
                fetchWallets(); // Refresh the wallet list too
            }, 2000);
        }
    }, [isConfirmed, transactionHash, onWalletsLinked]);

    // Use centralized router for API calls; only MCP ops should hit /mcp
    const callApi = async (body: any) => callApiWithRouting(body);

    // Fetch linked wallets (both managed and on-chain)
    const fetchWallets = useCallback(async () => {
        setIsLoadingWallets(true);
        setError(null);
        try {
            const response = await fetch(LINKED_WALLETS_ENDPOINT);

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`Failed to fetch wallets: ${response.status} ${errText}`);
            }

            const data = await response.json();

            if (data && Array.isArray(data.linked_wallets)) {
                const transformedWallets: LinkedWallet[] = data.linked_wallets.map((w: LinkedWalletFromApi) => ({
                    address: w.address as Address,
                    name: w.name,
                    isManaged: w.is_managed,
                    isLinkedOnChain: w.is_linked_on_chain,
                    isActive: w.is_active,
                    isSelected: w.is_selected,
                    isUnlocked: w.is_unlocked,
                }));
                setAllWallets(transformedWallets);
            }
        } catch (err: any) {
            console.error("Error fetching linked wallets:", err);
            setError(err.message || 'Failed to load wallets.');
        }
        setIsLoadingWallets(false);
    }, []);

    useEffect(() => {
        fetchWallets();
        resetSignersNote();
    }, [fetchWallets, resetSignersNote]);

    const handleWalletSelectionToggle = (walletAddress: Address) => {
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

    const handleUpdateLinkedWallets = () => {
        if (!operatorTbaAddress || !operatorEntryName) {
            setError("Operator details missing.");
            return;
        }
        setError(null);
        const finalAddressesToLink = Array.from(selectedWallets);
        setSignersNote({
            operatorTbaAddress,
            operatorEntryName,
            hotWalletAddresses: finalAddressesToLink,
        });
    };

    const handleGenerateWallet = async () => {
        setIsCreatingWallet(true);
        setError(null);
        try {
            const requestBody = { GenerateWallet: {} };
            await callApi(requestBody);
            await fetchWallets(); // Refresh wallet list
            setError(null);
        } catch (err: any) {
            setError(err.message || 'Failed to generate wallet');
        } finally {
            setIsCreatingWallet(false);
        }
    };

    const handleImportWallet = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!privateKeyToImport) {
            setError('Private Key is required for import.');
            return;
        }
        setIsCreatingWallet(true);
        setError(null);
        try {
            const requestBody = {
                ImportWallet: {
                    private_key: privateKeyToImport,
                    // Do not send password at all
                    name: walletNameToImport.trim() === '' ? undefined : walletNameToImport.trim()
                }
            };
            await callApi(requestBody);
            setShowImportForm(false);
            setPrivateKeyToImport('');
            setWalletNameToImport('');
            await fetchWallets(); // Refresh wallet list
        } catch (err: any) {
            setError(err.message || 'Failed to import wallet');
        } finally {
            setIsCreatingWallet(false);
        }
    };

    // Separate wallets into managed and external
    const managedWallets = allWallets.filter(w => w.isManaged);
    const externalWallets = allWallets.filter(w => !w.isManaged && w.isLinkedOnChain);

    // Render import form
    if (showImportForm) {
        return (
            <form
                onSubmit={handleImportWallet}
                className="flex flex-col gap-2"
            >
                <span className="font-bold">Import Wallet</span>
                <input
                    type="text"
                    placeholder="Private Key (0x...)"
                    value={privateKeyToImport}
                    onChange={e => setPrivateKeyToImport(e.target.value)}
                    required
                    className="bg-dark-gray/5 rounded p-2 self-stretch"
                />
                <input
                    type="text"
                    placeholder="Name (Optional)"
                    value={walletNameToImport}
                    onChange={e => setWalletNameToImport(e.target.value)}
                    className="bg-dark-gray/5 rounded p-2 self-stretch"
                />
                <div className="flex gap-2">
                    <button
                        type="button"
                        onClick={() => {
                            setShowImportForm(false);
                            setPrivateKeyToImport('');
                            setWalletNameToImport('');
                            setError(null);
                        }}
                        disabled={isCreatingWallet}
                        className="grow p-2 hover:bg-dark-gray/25"
                    >
                        Cancel
                    </button>
                    <button
                        type="submit"
                        disabled={isCreatingWallet}
                        className="grow p-2 bg-cyan font-bold"
                    >
                        {isCreatingWallet ? 'Importing...' : 'Import'}
                    </button>
                </div>
                {error && (
                    <div className="text-red-500 text-sm">
                        {error}
                    </div>
                )}
            </form>
        );
    }

    return (
        <div className="flex flex-col gap-4">
            {isLoadingWallets ? (
                <div className="flex gap-2 flex-col grow self-stretch place-items-center place-content-center">
                    <span className="text-lg">Loading wallets ...</span>
                    <ImSpinner8 className="animate-spin" />
                </div>
            ) : (
                <>
                    <div className="flex flex-col gap-1">
                        <span className="font-bold">Your Wallets</span>
                        {managedWallets.length === 0 && <p className="text-sm text-gray">No managed wallets found. Create one below.</p>}
                        {managedWallets.map(wallet => {
                            const isChecked = selectedWallets.has(wallet.address);
                            return (
                                <div
                                    key={wallet.address}
                                    className="flex items-center gap-2"
                                >
                                    <button
                                        onClick={() => handleWalletSelectionToggle(wallet.address)}
                                        className={classNames('!rounded-full', {
                                            'bg-cyan': isChecked,
                                            '!border-black': !isChecked,
                                        })}
                                    >
                                        <FiCheck className={classNames("text-xl", {
                                            'opacity-100': isChecked,
                                            'opacity-0': !isChecked,
                                        })} />
                                    </button>
                                    <div
                                        className="text-xs cursor-pointer rounded-xl bg-mid-gray/25 py-2 px-4 grow"
                                    >
                                        {wallet.name || 'Wallet'} ({truncate(wallet.address, 6, 4)})
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {externalWallets.length > 0 && (
                        <div className="flex flex-col gap-1">
                            <span className="font-bold">Other Linked Wallets</span>
                            {externalWallets.map(wallet => {
                                const isChecked = selectedWallets.has(wallet.address);
                                return (
                                    <div key={wallet.address} className="flex items-center gap-2">
                                        <button
                                            onClick={() => handleWalletSelectionToggle(wallet.address)}
                                        >
                                            {isChecked
                                                ? <FiCheckCircle className="text-2xl text-cyan" />
                                                : <FiCircle className="text-2xl text-dark-gray" />}
                                        </button>
                                        <div
                                            className="text-xs cursor-pointer rounded-xl bg-mid-gray/25 py-2 px-4 grow"
                                        >
                                            {truncate(wallet.address, 6)}...{truncate(wallet.address, 4)}
                                        </div>
                                    </div>
                                );
                            })}
                            <p className="text-sm text-gray">
                                These wallets are linked on-chain but not managed by this operator.
                            </p>
                        </div>
                    )}
                </>
            )}

            <div
                className="self-stretch flex items-center gap-2 text-sm font-bold"
            >
                <button
                    onClick={handleGenerateWallet}
                    className="p-2 bg-black dark:bg-white text-white dark:text-black grow"
                    disabled={isCreatingWallet}
                >
                    <FiPlusCircle className="text-xl" />
                    <span>{isCreatingWallet ? 'Generating...' : 'Generate'}</span>
                </button>
                <button
                    onClick={() => setShowImportForm(true)}
                    className="p-2 hover:bg-cyan grow"
                    disabled={isCreatingWallet}
                >
                    Import
                </button>
            </div>

            {(error || signersNoteError) && (
                <div className="text-red-500 text-sm">
                    {error || signersNoteError?.message}
                </div>
            )}

            {isSending && <p className="text-sm">Updating signers...</p>}
            {isConfirming && <p className="text-sm">Confirming update...</p>}
            {isConfirmed && transactionHash && (
                <div className="text-green-500 text-sm">
                    Signers updated! Tx: {transactionHash.substring(0, 10)}...
                </div>
            )}

            <button
                onClick={handleUpdateLinkedWallets}
                disabled={isSending || isConfirming || isLoadingWallets}
                className="bg-cyan text-black p-2 font-bold text-sm self-stretch"
            >
                {isSending || isConfirming ? 'Processing...' : (allWallets.length === 0 ? 'Link Wallets' : 'Update Linked Wallets')}
            </button>
        </div>
    );
};

export default LinkHotWalletsInline;
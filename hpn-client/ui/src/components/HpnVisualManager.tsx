import React, { useState, useEffect, useCallback, useMemo } from 'react';
import ReactFlow, { ReactFlowProvider, Controls, Background, useNodesState, useEdgesState, addEdge, Node, Edge, Connection, Position, Handle, BackgroundVariant } from 'reactflow';
import 'reactflow/dist/style.css'; // Default styles
import DebugStateControls from './DebugStateControls'; // Import the new component
import ShimApiConfigModal from './ShimApiConfigModal'; // IMPORT SHIM API CONFIG MODAL
import InlineWalletManagerNodeComponent from './InlineWalletManagerNode'; // IMPORT INLINE WALLET MANAGER NODE

import { 
    OnboardingStatusResponse, 
    OnboardingCheckDetails, 
    IdentityStatus as TIdentityStatus,
    DelegationStatus as TDelegationStatus,
    FundingStatusDetails as TFundingStatusDetails,
    OnboardingStatus,
    WalletSummary, // Added for WalletList
    WalletListData // Added for WalletList
} from '../logic/types';
import { useAccount, useChainId, useWriteContract, useWaitForTransactionReceipt, useConfig } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import {
    encodeFunctionData, 
    parseAbi, 
    stringToHex, 
    bytesToHex, 
    namehash as viemNamehash, 
    type Address as ViemAddress, 
    toHex,
    encodePacked,
    encodeAbiParameters, 
    parseAbiParameters,
    getAddress,
    hexToBytes
} from 'viem';

// --- Constants ---
const BASE_CHAIN_ID = 8453;
const HYPERMAP_ADDRESS = '0x000000000044C6B8Cb4d8f0F889a3E47664EAeda' as ViemAddress;
const OPERATOR_TBA_IMPLEMENTATION = '0x000000000046886061414588bb9F63b6C53D8674' as ViemAddress;

// Copied from AccountManager.tsx for now
const getApiBasePath = () => {
    const pathParts = window.location.pathname.split('/').filter(p => p);
    const processIdPart = pathParts.find(part => part.includes(':'));
    return processIdPart ? `/${processIdPart}/api` : '/api';
};
const MCP_ENDPOINT = `${getApiBasePath()}/mcp`;

const hypermapAbi = parseAbi([
  'function note(bytes calldata note, bytes calldata data) external returns (bytes32 labelhash)',
  'function mint(address owner, bytes calldata label, bytes calldata initData, address implementation) external returns (address tba)', 
  'function fact(bytes calldata key, bytes calldata value) external returns (bytes32 factHash)', 
  'function get(bytes32 node) external view returns (address tba, address owner, bytes memory note)'
]);
const mechAbi = parseAbi([
  'function execute(address target, uint256 value, bytes calldata data, uint8 operation) payable returns (bytes memory returnData)',
]);

const truncateString = (str: string | null | undefined, len: number = 10): string => {
    if (!str) return '(N/A)'; 
    if (str.length <= len + 3) return str; 
    const prefix = str.startsWith('0x') ? '0x' : '';
    const addressPart = prefix ? str.substring(2) : str;
    const visibleLen = len - prefix.length - 3; 
    if (visibleLen <= 1) return prefix + '...'; 
    const start = prefix + addressPart.substring(0, Math.ceil(visibleLen / 2));
    const end = addressPart.substring(addressPart.length - Math.floor(visibleLen / 2));
    return `${start}...${end}`;
}

interface HpnVisualManagerProps {
    onboardingData: OnboardingStatusResponse | null;
    nodeName: string | null;
    nodeTbaAddress: ViemAddress | null | undefined;
    nodeTbaOwner: ViemAddress | null | undefined;
    onRefreshStatus: () => void;
}

// --- REVISED Custom Node Types ---
const nodeStyle = { padding: 10, borderRadius: 5, color: 'white', minWidth: 180, textAlign: 'center' as const };
const actionNodeStyle = { ...nodeStyle, border: '2px dashed #888', background: '#3a3a3a', cursor: 'pointer' };
const placeholderNodeStyle = { ...nodeStyle, border: '1px solid #555', background: '#2c2c2c', opacity: 0.7 };

const MainIdentityNodeComponent = ({ data }: { data: { label: string, owner?: string, tba?: string } }) => (
    <div style={{ ...nodeStyle, background: '#284B63' /* Dark Blue */ }}>
        <strong>{data.label}</strong><br />
        {data.owner && <small>Owner: {truncateString(data.owner)}<br /></small>}
        {data.tba && <small>TBA: {truncateString(data.tba)}</small>}
        <Handle type="source" position={Position.Bottom} style={{ background: '#555' }} />
    </div>
);

const OperatorWalletNodeComponent = ({ data }: { 
    data: { 
        label: string, 
        status: string, 
        tba?: string, 
        signersNoteStatus?: string, 
        accessListNoteStatus?: string,
        onSetSignersNote?: () => void, 
        onSetAccessListNote?: () => void,
        canSetSignersNote?: boolean,
        canSetAccessListNote?: boolean
    }
}) => (
     <div style={{ ...nodeStyle, background: '#006400', paddingBottom: data.onSetSignersNote || data.onSetAccessListNote ? '40px' : '10px' /* Extra padding if actions */ }}>
        <strong>{data.label}</strong><br />
        <small>Status: {data.status}<br /></small>
        {data.tba && <small>TBA: {truncateString(data.tba)}<br /></small>}
        
        {data.signersNoteStatus && (
            <div style={{fontSize: '0.8em', marginTop: '5px', borderTop: '1px solid #38761D', paddingTop: '5px'}}>
                Signers: {data.signersNoteStatus}
                {data.onSetSignersNote && data.canSetSignersNote && (
                    <button onClick={data.onSetSignersNote} style={{fontSize:'0.8em', padding: '2px 5px', marginLeft: '8px'}}>
                        Set Signers
                    </button>
                )}
            </div>
        )}
        {data.accessListNoteStatus && (
            <div style={{fontSize: '0.8em', marginTop: '3px', borderTop: '1px solid #38761D', paddingTop: '3px'}}>
                Access List: {data.accessListNoteStatus}
                {data.onSetAccessListNote && data.canSetAccessListNote && (
                    <button onClick={data.onSetAccessListNote} style={{fontSize:'0.8em', padding: '2px 5px', marginLeft: '8px'}}>
                        Set Access List
                    </button>
                )}
            </div>
        )}

        <Handle type="target" position={Position.Top} style={{ background: '#555' }} />
        <Handle type="source" position={Position.Bottom} style={{ background: '#555' }} />
    </div>
);

const HotWalletCardNodeComponent = ({ data }: { data: { label: string, address?: string, status: string } }) => (
    <div style={{ ...nodeStyle, background: '#644A00' /* Dark Orange */ }}>
        <strong>{data.label}</strong><br />
        {data.address && <small>Address: {truncateString(data.address)}<br/></small>}
        <small>Status: {data.status}</small>
        <Handle type="target" position={Position.Top} style={{ background: '#555' }} />
        <Handle type="source" position={Position.Bottom} style={{ background: '#555' }} />
    </div>
);

const ShimConfigNodeComponent = ({ data }: { data: { label: string } }) => (
    <div style={{ ...placeholderNodeStyle, borderStyle: 'solid'}}>
        <strong>{data.label}</strong> (Future)
    </div>
);

const AddActionPlaceholderNodeComponent = ({ data }: { data: { label: string, onClick: () => void, disabled?: boolean } }) => (
    <button onClick={data.onClick} disabled={data.disabled} style={{...actionNodeStyle, display: 'block', width: '100%'}}>
        {data.label}
        <Handle type="target" position={Position.Top} style={{ background: '#555'}} />
    </button>
);

const nodeTypes = {
    mainIdentityNode: MainIdentityNodeComponent,
    operatorWalletNode: OperatorWalletNodeComponent,
    hotWalletCardNode: HotWalletCardNodeComponent,
    shimConfigNode: ShimConfigNodeComponent,
    addActionPlaceholderNode: AddActionPlaceholderNodeComponent,
    inlineWalletManagerNode: InlineWalletManagerNodeComponent,
};
// --- End Custom Node Types ---

const HpnVisualManager: React.FC<HpnVisualManagerProps> = ({
    onboardingData: realOnboardingData,
    nodeName,
    nodeTbaAddress,
    nodeTbaOwner,
    onRefreshStatus
}) => {
    const [nodes, setNodes, onNodesChange] = useNodesState([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState([]);

    const { address: connectedOwnerWalletAddress, isConnected: isOwnerConnected, chain } = useAccount();
    const currentOwnerChainId = useChainId();
    const { data: hookTxHash, writeContract: executeOnChainAction, isPending, reset, error: writeContractHookError } = useWriteContract(); 
    const { isLoading: isOnChainActionConfirming, isSuccess: isOnChainActionConfirmed, error: txReceiptError } = useWaitForTransactionReceipt({ hash: hookTxHash, chainId: BASE_CHAIN_ID });

    const [onChainTxHash, setOnChainTxHash] = useState<`0x${string}` | undefined>(undefined);
    const [onChainError, setOnChainError] = useState<string | null>(null);
    const [currentActionName, setCurrentActionName] = useState<string | null>(null);
    const [nextAction, setNextAction] = useState<'setAccessList' | 'setSignersNote' | null>(null);

    const [showInlineWalletManager, setShowInlineWalletManager] = useState<boolean>(false);

    const [mcpWalletList, setMcpWalletList] = useState<WalletSummary[]>([]);
    const [isLoadingMcpWalletList, setIsLoadingMcpWalletList] = useState<boolean>(true);

    const [isShimApiConfigModalOpen, setIsShimApiConfigModalOpen] = useState<boolean>(false);
    const [currentHotWalletForShimModal, setCurrentHotWalletForShimModal] = useState<ViemAddress | undefined>(undefined);

    const showToast = useCallback((type: 'success' | 'error', text: string, duration: number = 4000) => {
        alert(`${type.toUpperCase()}: ${text}`);
    }, []);

    const [useSimulatedState, setUseSimulatedState] = useState<boolean>(false);
    const [simulatedChecks, setSimulatedChecks] = useState<Partial<OnboardingCheckDetails>>(() => {
        const initialRealChecks = realOnboardingData?.checks;
        return {
            identityConfigured: initialRealChecks?.identityConfigured || false,
            hotWalletSelectedAndActive: initialRealChecks?.hotWalletSelectedAndActive || false,
            delegationVerified: initialRealChecks?.delegationVerified === true,
            operatorTba: initialRealChecks?.operatorTba || null,
            hotWalletAddress: initialRealChecks?.hotWalletAddress || null,
            identityStatus: initialRealChecks?.identityStatus || { type: 'notFound' },
            delegationStatus: initialRealChecks?.delegationStatus || null,
            fundingStatus: initialRealChecks?.fundingStatus || { tbaNeedsEth: true, tbaNeedsUsdc: true, hotWalletNeedsEth: true },
        };
    });

    const onboardingDataToUse = useMemo(() => {
        if (useSimulatedState) {
            let simulatedStatus = OnboardingStatus.Loading;
            if (simulatedChecks.identityConfigured === false) {
                simulatedStatus = OnboardingStatus.NeedsOnChainSetup;
            } else if (simulatedChecks.hotWalletSelectedAndActive === false) {
                simulatedStatus = OnboardingStatus.NeedsHotWallet;
            } else if (simulatedChecks.delegationVerified === false) {
                simulatedStatus = OnboardingStatus.NeedsOnChainSetup;
            } else if (simulatedChecks.fundingStatus?.tbaNeedsEth || simulatedChecks.fundingStatus?.tbaNeedsUsdc || simulatedChecks.fundingStatus?.hotWalletNeedsEth) {
                simulatedStatus = OnboardingStatus.NeedsFunding;
            } else if (simulatedChecks.identityConfigured && simulatedChecks.hotWalletSelectedAndActive && simulatedChecks.delegationVerified) {
                simulatedStatus = OnboardingStatus.Ready;
            }
            return { 
                status: simulatedStatus, 
                checks: simulatedChecks as OnboardingCheckDetails,
                errors: []
            } as OnboardingStatusResponse;
        }
        return realOnboardingData;
    }, [useSimulatedState, simulatedChecks, realOnboardingData]);

    useEffect(() => {
        if (!useSimulatedState && realOnboardingData?.checks) {
            setSimulatedChecks(realOnboardingData.checks);
        }
    }, [realOnboardingData, useSimulatedState]);
    
    const getIdentityNodeStatus = (checks: OnboardingCheckDetails): string => {
        if (!checks.identityStatus) return checks.identityConfigured ? '❓' : '❌';
        const is = checks.identityStatus as any;
        if (typeof is === 'object' && 'verified' in is) return `✅ Verified`;
        if (typeof is === 'string' && is === 'notFound') return `❌ Not Found`;
        if (typeof is === 'object' && 'incorrectImplementation' in is) return `❌ Wrong Impl.`;
        return `❓ Error`;
    };

    const getNoteNodeStatus = (noteType: 'signers' | 'accessList', checks: OnboardingCheckDetails): { statusText: string, isSet: boolean, value?: string } => {
        if (!checks.identityConfigured) return { statusText: '⚪ Blocked (No Op Wallet)', isSet: false };
        if (noteType === 'signers' && !checks.hotWalletSelectedAndActive) return { statusText: '⚪ Blocked (No Active Hot Wallet)', isSet: false };
        const ds = checks.delegationStatus as any;
        if (!ds) return { statusText: checks.delegationVerified === null ? '❓ Checking...' : (checks.delegationVerified ? '✅ (No Detail)' : '❓ Unknown'), isSet: checks.delegationVerified === true };
        if (ds === 'verified') return { statusText: '✅ Set Correctly', isSet: true, value: noteType === 'signers' ? (checks.hotWalletAddress ?? undefined) : "(Namehash)" };
        if (noteType === 'signers') {
            if (ds === 'signersNoteMissing') return { statusText: '❌ Missing', isSet: false };
            if (typeof ds === 'object' && ds !== null && 'signersNoteInvalidData' in ds) return { statusText: `❌ Invalid Data`, isSet: false, value: ds.signersNoteInvalidData };
            if (ds === 'hotWalletNotInList') return { statusText: '❌ Value Mismatch', isSet: false };
            if (typeof ds === 'object' && ds !== null && 'signersNoteLookupError' in ds) return { statusText: '❌ Lookup Error', isSet: false };
        }
        if (noteType === 'accessList') {
            if (ds === 'accessListNoteMissing') return { statusText: '❌ Missing', isSet: false };
            if (typeof ds === 'object' && ds !== null && 'accessListNoteInvalidData' in ds) {
                const reason = ds.accessListNoteInvalidData as string;
                return { statusText: reason.includes("has no data") ? '❌ Missing (No Data)' : `❌ Invalid Data`, isSet: false, value: reason };
            }
        }
        if (typeof ds === 'object' && ds !== null && 'checkError' in ds) return { statusText: `❓ Error (${ds.checkError})`, isSet: false };
        return { statusText: '⏳ Pending Other/Unknown', isSet: false };
    };

    const getFundingText = (type: 'tbaEth' | 'tbaUsdc' | 'hwEth', checks: OnboardingCheckDetails): string => {
        if (!checks.fundingStatus) return '❓ Checking...';
        const fs = checks.fundingStatus;
        if (type === 'tbaEth') return `${fs.tbaNeedsEth ? '❌ Needs ETH' : '✅ OK'} (${checks.tbaEthBalanceStr || 'N/A'})`;
        if (type === 'tbaUsdc') return `${fs.tbaNeedsUsdc ? '❌ Needs USDC' : '✅ OK'} (${checks.tbaUsdcBalanceStr || 'N/A'})`;
        if (type === 'hwEth') return `${fs.hotWalletNeedsEth ? '❌ Needs ETH' : '✅ OK'} (${checks.hotWalletEthBalanceStr || 'N/A'})`;
        return '❓ Error';
    };

    const handleMintOperatorSubEntry = useCallback(async () => {
        // No direct use of onboardingDataToUse.checks here, uses props like nodeTbaAddress, nodeTbaOwner
        // ... (pre-checks)
        // ... (mint logic)
    }, [nodeName, connectedOwnerWalletAddress, nodeTbaAddress, nodeTbaOwner, executeOnChainAction, reset, showToast]);
    
    const handleSetSignersNote = useCallback(async () => {
        if (!onboardingDataToUse?.checks?.operatorTba || !onboardingDataToUse?.checks?.hotWalletAddress || !connectedOwnerWalletAddress) {
            showToast('error', 'Signers Note: Missing required info.'); return;
        }
        const operatorTba = onboardingDataToUse.checks.operatorTba as ViemAddress;
        const hotWalletAddr = onboardingDataToUse.checks.hotWalletAddress as ViemAddress;
        // ... (rest of set signers note logic)
    }, [onboardingDataToUse, connectedOwnerWalletAddress, executeOnChainAction, reset, showToast]);

    const handleSetAccessListNote = useCallback(async () => {
        if (!onboardingDataToUse?.checks?.operatorTba || !nodeName || !connectedOwnerWalletAddress) {
            showToast('error', 'Access List Note: Missing required info.'); return Promise.reject("Missing info");
        }
        const operatorTba = onboardingDataToUse.checks.operatorTba as ViemAddress;
        const fullSignersNoteName = `~hpn-beta-signers.${nodeName}`;
        
        const noteKeyArg = stringToHex('~access-list', { size: 32 });
        const accessListValueHex = viemNamehash(fullSignersNoteName);

        const data = encodeFunctionData({
            abi: hypermapAbi,
            functionName: 'note',
            args: [noteKeyArg, accessListValueHex]
        });
        setCurrentActionName('SetAccessListNote');
        setOnChainError(null); setOnChainTxHash(undefined); reset();
        return new Promise<void>((resolve, reject) => {
            executeOnChainAction({
                address: operatorTba,
                abi: mechAbi,
                functionName: 'execute',
                args: [HYPERMAP_ADDRESS, BigInt(0), data, 0],
                chainId: BASE_CHAIN_ID
            }, {
                onSuccess: (hash) => { 
                    setOnChainTxHash(hash); 
                    resolve(); 
                },
                onError: (err) => { 
                    setOnChainError(err.message); 
                    setCurrentActionName(null); 
                    showToast('error', `Access List Note Error: ${err.message}`);
                    reject(err);
                }
            });
        });
    }, [onboardingDataToUse, nodeName, connectedOwnerWalletAddress, executeOnChainAction, reset, showToast]);

    const handleSetSignersNoteWrapperForModal = useCallback(async (newSigners: ViemAddress[]) => {
        if (!onboardingDataToUse?.checks?.operatorTba || !connectedOwnerWalletAddress || newSigners.length === 0) {
            showToast('error', 'Signers Note (Modal): Missing required info or no signer selected.');
            return Promise.reject("Missing info for modal signer set");
        }
        const operatorTba = onboardingDataToUse.checks.operatorTba as ViemAddress;
        const hotWalletToLink = newSigners[0];

        const signersNoteKeyArg = stringToHex('~hpn-beta-signers', { size: 32 });
        const abiEncodedSignersHex = encodeAbiParameters(
            parseAbiParameters('address[]'),
            [[hotWalletToLink]]
        );

        const data = encodeFunctionData({
            abi: hypermapAbi,
            functionName: 'note',
            args: [signersNoteKeyArg, abiEncodedSignersHex]
        });
        setCurrentActionName('SetSignersNoteFromModal');
        setOnChainError(null); setOnChainTxHash(undefined); reset();
        
        return new Promise<void>((resolve, reject) => {
            executeOnChainAction({
                address: operatorTba,
                abi: mechAbi,
                functionName: 'execute',
                args: [HYPERMAP_ADDRESS, BigInt(0), data, 0],
                chainId: BASE_CHAIN_ID
            }, {
                onSuccess: (hash) => { 
                    setOnChainTxHash(hash); 
                    resolve(); 
                },
                onError: (err) => { 
                    setOnChainError(err.message); 
                    setCurrentActionName(null); 
                    showToast('error', `Signers Note Error (Modal): ${err.message}`);
                    reject(err);
                }
            });
        });
    }, [onboardingDataToUse, connectedOwnerWalletAddress, executeOnChainAction, reset, showToast]);

    const fetchMcpWalletData = useCallback(async () => {
        setIsLoadingMcpWalletList(true);
        try {
            const requestBody = { GetWalletSummaryList: {} }; 
            const response = await fetch(MCP_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody),
            });
            if (!response.ok) {
                const errData = await response.json().catch(() => ({ error: `HTTP error! Status: ${response.status}` }));
                throw new Error(errData.error || `Failed to fetch MCP wallet list: ${response.statusText}`);
            }
            const data: WalletListData = await response.json();
            setMcpWalletList(data.wallets || []);
        } catch (err) {
            showToast('error', err instanceof Error ? err.message : 'An unknown error occurred fetching MCP wallet data');
            setMcpWalletList([]);
        } finally {
            setIsLoadingMcpWalletList(false); 
        }
    }, [showToast]);

    useEffect(() => {
        fetchMcpWalletData();
    }, [fetchMcpWalletData]);

    useEffect(() => {
        console.log("HVM: Rebuilding graph. MCP Wallets Loading:", isLoadingMcpWalletList, "Count:", mcpWalletList.length);
        if (!onboardingDataToUse || !nodeName) { 
            setNodes([]); setEdges([]); return;
        }
        const { checks } = onboardingDataToUse;
        const newNodes: Node[] = [];
        const newEdges: Edge[] = [];
        const isOwnerAuthed = isOwnerConnected && currentOwnerChainId === BASE_CHAIN_ID; 

        const NODE_X_INITIAL = 100;
        const NODE_X_SPACING_HORIZONTAL = 250;
        const LEVEL_Y_SPACING = 180;
        const HOTWALLET_Y_SPACING = 120;

        const L0_Y = 50;
        const L1_Y = L0_Y + LEVEL_Y_SPACING;
        const L2_HOTWALLET_Y = L1_Y + LEVEL_Y_SPACING; 
        const L3_SHIM_Y_BENEATH_HW = L2_HOTWALLET_Y + HOTWALLET_Y_SPACING; 
        const L2_INLINE_WALLET_MANAGER_Y = L1_Y + LEVEL_Y_SPACING;

        const mainIdentityNodeId = 'main-identity';
        newNodes.push({
            id: mainIdentityNodeId, type: 'mainIdentityNode',
            data: { label: nodeName, owner: nodeTbaOwner ?? undefined, tba: nodeTbaAddress ?? undefined },
            position: { x: NODE_X_INITIAL, y: L0_Y }, draggable: true,
        });

        const operatorWalletNodeId = `operator-wallet-hpn-beta-${nodeName}`;
        const operatorWalletName = `hpn-beta-wallet.${nodeName}`;
        const addOperatorWalletActionId = 'action-create-op-wallet';
        const isOpWalletVerified = checks.identityConfigured && checks.operatorTba && checks.identityStatus && typeof checks.identityStatus === 'object' && 'verified' in checks.identityStatus;

        if (isOpWalletVerified && checks.operatorTba) {
            const signersStatus = getNoteNodeStatus('signers', checks);
            const accessListStatus = getNoteNodeStatus('accessList', checks);

            newNodes.push({
                id: operatorWalletNodeId, type: 'operatorWalletNode',
                data: { 
                    label: operatorWalletName, 
                    status: getIdentityNodeStatus(checks), 
                    tba: checks.operatorTba,
                    signersNoteStatus: signersStatus.statusText,
                    accessListNoteStatus: accessListStatus.statusText,
                    onSetSignersNote: !signersStatus.isSet ? handleSetSignersNote : undefined,
                    onSetAccessListNote: !accessListStatus.isSet ? handleSetAccessListNote : undefined,
                    canSetSignersNote: !signersStatus.isSet && isOwnerAuthed && !!checks.hotWalletAddress,
                    canSetAccessListNote: !accessListStatus.isSet && isOwnerAuthed
                },
                position: { x: NODE_X_INITIAL, y: L1_Y }, draggable: true,
            });
            newEdges.push({ id: `edge-${mainIdentityNodeId}-${operatorWalletNodeId}`, source: mainIdentityNodeId, target: operatorWalletNodeId, type: 'smoothstep' });

            let currentX_for_C_Level = NODE_X_INITIAL;
            let actualLinkedHotWalletDisplayed = false;

            if (signersStatus.isSet && checks.hotWalletAddress) {
                const linkedHotWalletId = `hotwallet-${checks.hotWalletAddress as ViemAddress}`; 
                const mcpDetailsForLinkedHW = mcpWalletList.find(w => w.address === checks.hotWalletAddress);
                newNodes.push({
                    id: linkedHotWalletId,
                    type: 'hotWalletCardNode',
                    data: {
                        label: mcpDetailsForLinkedHW?.name || `hotwallet: ${truncateString(checks.hotWalletAddress, 12)}`,
                        address: checks.hotWalletAddress,
                        status: checks.hotWalletSelectedAndActive ? 'Active & Linked' : 'Linked (Not Active)',
                    },
                    position: { x: currentX_for_C_Level, y: L2_HOTWALLET_Y }, 
                    draggable: true,
                });
                newEdges.push({
                    id: `edge-${operatorWalletNodeId}-${linkedHotWalletId}`,
                    source: operatorWalletNodeId,
                    target: linkedHotWalletId,
                    type: 'smoothstep', 
                });

                const addShimActionId = `action-add-shim-${linkedHotWalletId}`;
                newNodes.push({
                    id: addShimActionId,
                    type: 'addActionPlaceholderNode',
                    data: { 
                        label: '[+] Create Wallet User' , 
                        onClick: () => {
                            setCurrentHotWalletForShimModal(checks.hotWalletAddress as ViemAddress);
                            setIsShimApiConfigModalOpen(true);
                        }
                    },                     
                    position: { x: currentX_for_C_Level, y: L3_SHIM_Y_BENEATH_HW }, 
                    draggable: true,
                });
                newEdges.push({
                    id: `edge-${linkedHotWalletId}-${addShimActionId}`,
                    source: linkedHotWalletId,
                    target: addShimActionId,
                    type: 'smoothstep',
                    style: { strokeDasharray: '5,5' }, 
                });
                
                currentX_for_C_Level += NODE_X_SPACING_HORIZONTAL; 
                actualLinkedHotWalletDisplayed = true;
            }

            const manageWalletsNodeId = `manage-wallets-${operatorWalletNodeId}`;
            if (showInlineWalletManager) {
                newNodes.push({
                    id: manageWalletsNodeId,
                    type: 'inlineWalletManagerNode',
                    data: {
                        onActionComplete: () => {
                            fetchMcpWalletData();
                            onRefreshStatus();
                        },
                        onCloseManager: () => {
                            setShowInlineWalletManager(false);
                        }
                    },
                    position: { x: currentX_for_C_Level, y: L2_INLINE_WALLET_MANAGER_Y },
                    draggable: true,
                    style: { width: 'auto', minWidth: '320px'}
                });
                 newEdges.push({ id: `edge-${operatorWalletNodeId}-${manageWalletsNodeId}`, source: operatorWalletNodeId, target: manageWalletsNodeId, type: 'smoothstep', style: {strokeDasharray: '5,5'}});
            } else {
                const addHotWalletLabel = actualLinkedHotWalletDisplayed 
                    ? '[+] Manage/Link Another Hot Wallet' 
                    : '[+] Manage/Link First Hot Wallet';
                newNodes.push({
                    id: manageWalletsNodeId, 
                    type: 'addActionPlaceholderNode',
                    data: { label: addHotWalletLabel, onClick: () => setShowInlineWalletManager(true) }, 
                    position: { x: currentX_for_C_Level, y: L2_HOTWALLET_Y }, 
                    draggable: true, 
                });
                newEdges.push({ id: `edge-${operatorWalletNodeId}-${manageWalletsNodeId}`, source: operatorWalletNodeId, target: manageWalletsNodeId, type: 'smoothstep', style: {strokeDasharray: '5,5'}});
            }

        } else { 
            newNodes.push({
                id: addOperatorWalletActionId, type: 'addActionPlaceholderNode',
                data: { label: `[+] Create Operator Wallet (${operatorWalletName})`, onClick: handleMintOperatorSubEntry, disabled: isPending || !isOwnerAuthed || !nodeTbaAddress || !nodeTbaOwner },
                position: { x: NODE_X_INITIAL, y: L1_Y }, draggable: true,
            });
            newEdges.push({ id: `edge-${mainIdentityNodeId}-${addOperatorWalletActionId}`, source: mainIdentityNodeId, target: addOperatorWalletActionId, type: 'smoothstep', animated: true, style: { strokeDasharray: '5,5' } });
        }
        
        console.log("HVM: Final nodes for render (FULL LOGIC):", JSON.stringify(newNodes.map(n => ({id: n.id, type: n.type, data: (n.data as any)?.label || 'No Label', position: n.position}))));
        console.log("HVM: Final edges for render (FULL LOGIC):", JSON.stringify(newEdges));
        setNodes(newNodes);
        setEdges(newEdges);

    }, [onboardingDataToUse, nodeName, nodeTbaAddress, nodeTbaOwner, isOwnerConnected, currentOwnerChainId, isPending, handleMintOperatorSubEntry, handleSetSignersNote, handleSetAccessListNote, mcpWalletList, isLoadingMcpWalletList, showToast, showInlineWalletManager, fetchMcpWalletData, onRefreshStatus]);
    
    useEffect(() => {
        if (isOnChainActionConfirmed && onChainTxHash && currentActionName) {
            showToast('success', `Action (${currentActionName}) confirmed! Refreshing status.`);
            const completedAction = currentActionName;
            setCurrentActionName(null);
            setOnChainTxHash(undefined);
            setOnChainError(null);
            onRefreshStatus();

            if (completedAction === 'MintOperatorTBA') {
                setNextAction('setAccessList');
            } else if (completedAction === 'SetAccessListNote') {
                setNextAction(null);
            }
        }
        const combinedError = writeContractHookError || txReceiptError;
        if (combinedError && currentActionName) {
            const errorMsg = combinedError instanceof Error ? combinedError.message : "Unknown transaction error";
            showToast('error',`Tx Error (${currentActionName}): ${errorMsg}`);
            setOnChainError(errorMsg);
            setCurrentActionName(null);
            setNextAction(null);
        }
    }, [isOnChainActionConfirmed, onChainTxHash, txReceiptError, writeContractHookError, currentActionName, onRefreshStatus, showToast]);

    useEffect(() => {
        if (nextAction && onboardingDataToUse && onboardingDataToUse.checks.identityConfigured && onboardingDataToUse.checks.operatorTba) {
            if (nextAction === 'setAccessList') {
                console.log("HVM: Triggering SetAccessListNote after mint.");
                handleSetAccessListNote();
            }
            setNextAction(null);
        }
    }, [nextAction, onboardingDataToUse, handleSetAccessListNote]);

    return (
        <div style={{display: 'flex', flexDirection: 'column', height: '100%'}}>
            <div style={{ padding: '10px', background:'#eee', borderBottom: '1px solid #ccc' }}>
                <label>
                    <input 
                        type="checkbox" 
                        checked={useSimulatedState} 
                        onChange={(e) => setUseSimulatedState(e.target.checked)} 
                    />
                    Use Simulated State
                </label>
            </div>

            {useSimulatedState && (
                <DebugStateControls 
                    currentChecks={simulatedChecks} 
                    onUpdateChecks={(newChecks) => setSimulatedChecks(prev => ({...prev, ...newChecks}))} 
                />
            )}

            <div style={{ flexGrow: 1, height: '80vh', width: '100%', border: '1px solid #444', position:'relative' }}>
                <ReactFlow
                    nodes={nodes}
                    edges={edges}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    nodeTypes={nodeTypes}
                    fitView
                    attributionPosition="bottom-left"
                    defaultEdgeOptions={{ style: { stroke: '#fff072', strokeWidth: 2 }, type: 'smoothstep', animated: false }}
                >
                    <Controls />
                    <Background color="#444" gap={15} size={1.5} />
                </ReactFlow>
                {onChainTxHash && <p style={{color:'white', position:'absolute', bottom: '10px', left:'10px', zIndex:10, background:'rgba(0,0,0,0.5)', padding:'5px'}}>Tx: {truncateString(onChainTxHash)} {isOnChainActionConfirming ? "Confirming..." : (isOnChainActionConfirmed ? "✅" : "Pending...")}</p>}
                {onChainError && <p style={{color:'red', position:'absolute', bottom: '30px', left:'10px', zIndex:10, background:'rgba(0,0,0,0.5)', padding:'5px'}}>Error: {onChainError}</p>}
                {isShimApiConfigModalOpen && currentHotWalletForShimModal && (
                    <ShimApiConfigModal
                        isOpen={isShimApiConfigModalOpen}
                        onClose={() => {
                            setIsShimApiConfigModalOpen(false);
                            setCurrentHotWalletForShimModal(undefined);
                        }}
                        hotWalletAddress={currentHotWalletForShimModal}
                    />
                )}
            </div>
        </div>
    );
};

// Wrapper component that includes the ReactFlowProvider
const HpnVisualManagerWrapper: React.FC<HpnVisualManagerProps> = (props) => (
    <ReactFlowProvider>
        <HpnVisualManager {...props} />
    </ReactFlowProvider>
);

export default HpnVisualManagerWrapper; 
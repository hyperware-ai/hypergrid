import React, { useState, useEffect, useCallback, useMemo } from 'react';
import ReactFlow, {
    ReactFlowProvider,
    Controls,
    Background,
    useNodesState,
    useEdgesState,
    addEdge,
    Node,
    Edge,
    Connection,
    Position,
    Handle,
    NodeProps
} from 'reactflow';
import 'reactflow/dist/style.css';

import {
    IHpnGraphResponse,
    IGraphNode,
    IGraphEdge,
    IOwnerNodeData,
    // Import specific node data types if needed for custom node components later
} from '../logic/types';

import {
    useAccount // Added for accessing connected account
} from 'wagmi'; // Added
import {
    useMintOperatorSubEntry,
    useSetOperatorNote, // Added import
    DEFAULT_OPERATOR_TBA_IMPLEMENTATION,
    viemNamehash, // Use the re-exported namehash
    // HYPERMAP_ADDRESS, // Not directly used in component, but good to be aware of
    // BASE_CHAIN_ID // Not strictly needed for component
} from '../logic/hypermapHelpers'; // Added
import type { Address } from 'viem'; // Import Address type

// Import the new modal
import LinkHotWalletsModal from './LinkHotWalletsModal';
import ShimApiConfigModal from './ShimApiConfigModal';

// Placeholder for API base path - adjust if necessary
const getApiBasePath = () => {
    const pathParts = window.location.pathname.split('/').filter(p => p);
    const processIdPart = pathParts.find(part => part.includes(':'));
    return processIdPart ? `/${processIdPart}/api` : '/api';
};
const API_BASE_URL = getApiBasePath();
const HPN_GRAPH_ENDPOINT = `${API_BASE_URL}/hpn-graph`;

// --- Custom Node Component Placeholders (to be defined or imported) ---
// Example:
// const OwnerNodeComponent = ({ data }) => <div style={{ padding: 10, border: '1px solid #777', background: '#eee' }}>Owner: {data.name}</div>;
// const OperatorWalletNodeComponent = ({ data }) => <div style={{ padding: 10, border: '1px solid #777', background: '#eee' }}>Operator Wallet: {data.name}</div>;
// ... etc. for HotWalletNode, AuthorizedClientNode, AddHotWalletActionNode, AddAuthorizedClientActionNode

const OwnerNodeComponent: React.FC<NodeProps<IOwnerNodeData>> = ({ data }) => (
    <div style={{ padding: 10, border: '1px solid #00ff00', borderRadius: '5px', background: '#222', color: '#00ff00' }}>
        <Handle type="target" position={Position.Top} />
        <strong>Owner:</strong> {data.name} ({(data as any)['tba_address'] || (data as any)['owner_address'] || 'N/A'})
        <Handle type="source" position={Position.Bottom} />
    </div>
);

// Updated OperatorWalletNodeComponent to include note status and action button
interface IOperatorWalletNodeProps extends NodeProps<IOperatorWalletNodeData> {
    onSetAccessListNote: (operatorTbaAddress: Address, operatorEntryName: string) => void;
    isSettingAccessListNote: boolean;
    // Props for Signers Note
    onSetSignersNote: (operatorTbaAddress: Address, operatorEntryName: string, hotWalletAddress: Address) => void;
    isSettingSignersNote: boolean;
    activeHotWalletAddressForNode: Address | null;
}

const OperatorWalletNodeComponent: React.FC<NodeProps<IOperatorWalletNodeData>> = ({ data }) => {
    const tbaAddress = (data as any)['tba_address'] as Address | undefined;
    const operatorName = (data as any)['name'] as string | undefined;
    const accessListNoteInfo = (data as any)['access_list_note'];
    const signersNoteInfo = (data as any)['signers_note'];
    
    const onSetAccessListNoteHandler = (data as any).onSetAccessListNote;
    const isCurrentlySettingAccessListNote = (data as any).isSettingAccessListNote;

    const onSetSignersNoteHandler = (data as any).onSetSignersNote;
    const isCurrentlySettingSignersNote = (data as any).isSettingSignersNote;
    const activeHotWalletAddress = (data as any).activeHotWalletAddressForNode as Address | null;

    // Log the note info objects as seen by this component
    // console.log('[OperatorWalletNodeComponent] Render. accessListNoteInfo:', accessListNoteInfo);
    // console.log('[OperatorWalletNodeComponent] Render. signersNoteInfo:', signersNoteInfo);

    const handleSetAccessListNoteClick = (event: React.MouseEvent) => {
        event.stopPropagation();
        if (tbaAddress && operatorName && typeof onSetAccessListNoteHandler === 'function') {
            onSetAccessListNoteHandler(tbaAddress, operatorName);
        } else {
            console.error('[OperatorWalletNodeComponent] Skipping SetAccessListNote: tbaAddress, operatorName, or handler is invalid.');
        }
    };

    const handleSetSignersNoteClick = (event: React.MouseEvent) => {
        event.stopPropagation();
        if (tbaAddress && operatorName && activeHotWalletAddress && typeof onSetSignersNoteHandler === 'function') {
            onSetSignersNoteHandler(tbaAddress, operatorName, activeHotWalletAddress);
        } else {
            console.error('[OperatorWalletNodeComponent] Skipping SetSignersNote: required parameters or handler is invalid.', 
                {tbaAddress, operatorName, activeHotWalletAddress, handlerExists: typeof onSetSignersNoteHandler === 'function' });
        }
    };

    const canSetAccessList = accessListNoteInfo && !accessListNoteInfo.isSet && tbaAddress;
    const canSetSigners = accessListNoteInfo && accessListNoteInfo.isSet && signersNoteInfo && !signersNoteInfo.isSet && tbaAddress && operatorName && activeHotWalletAddress;

    return (
        <div style={{ padding: 10, border: '1px solid #00ffff', borderRadius: '5px', background: '#222', color: '#00ffff', minWidth: '250px' }}>
            <Handle type="target" position={Position.Top} />
            <strong>Operator Wallet:</strong> {(data as any)['name']}
            <div>Address: {tbaAddress ?? 'N/A'}</div>
            <div>Funding:
                ETH {((data as any).funding_status)?.['ethBalanceStr'] ?? 'N/A'},
                USDC {((data as any).funding_status)?.['usdcBalanceStr'] ?? 'N/A'}
            </div>
            {((data as any).funding_status)?.['needsEth'] && <div style={{color: 'orange'}}>Needs ETH</div>}
            {((data as any).funding_status)?.['needsUsdc'] && <div style={{color: 'orange'}}>Needs USDC</div>}
            {((data as any).funding_status)?.['errorMessage'] && <div style={{color: 'red', fontSize: '0.8em'}}>Funding Error: {((data as any).funding_status)?.['errorMessage']}</div>}

            <div style={{ marginTop: '10px', borderTop: '1px solid #444', paddingTop: '5px' }}>
                <div>Access List Note: <span style={{color: accessListNoteInfo?.isSet ? 'lightgreen' : 'orange'}}>{accessListNoteInfo?.statusText || 'Unknown'}</span></div>
                <div>Signers Note: <span style={{color: signersNoteInfo?.isSet ? 'lightgreen' : 'orange'}}>{signersNoteInfo?.statusText || 'Unknown'}</span></div>
            </div>

            {canSetAccessList && (
                <button
                    onClick={handleSetAccessListNoteClick}
                    disabled={isCurrentlySettingAccessListNote || isCurrentlySettingSignersNote}
                    style={{
                        marginTop: '10px',
                        padding: '5px 10px',
                        backgroundColor: (isCurrentlySettingAccessListNote || isCurrentlySettingSignersNote) ? '#555' : '#dc3545',
                        color: 'white',
                        border: 'none',
                        borderRadius: '3px',
                        cursor: (isCurrentlySettingAccessListNote || isCurrentlySettingSignersNote) ? 'not-allowed' : 'pointer',
                        width: '100%'
                    }}
                >
                    {isCurrentlySettingAccessListNote ? 'Setting Access List Note...' : 'Set Access List Note'}
                </button>
            )}

            {canSetSigners && (
                 <button
                    onClick={handleSetSignersNoteClick}
                    disabled={isCurrentlySettingAccessListNote || isCurrentlySettingSignersNote}
                    style={{
                        marginTop: '5px', // Adjusted margin if both buttons show
                        padding: '5px 10px',
                        backgroundColor: (isCurrentlySettingAccessListNote || isCurrentlySettingSignersNote) ? '#555' : '#007bff',
                        color: 'white',
                        border: 'none',
                        borderRadius: '3px',
                        cursor: (isCurrentlySettingAccessListNote || isCurrentlySettingSignersNote) ? 'not-allowed' : 'pointer',
                        width: '100%'
                    }}
                >
                    {isCurrentlySettingSignersNote ? 'Setting Signers Note...' : `Set Signers Note (HW: ${activeHotWalletAddress ? activeHotWalletAddress.substring(0,6) : 'N/A'}...)`}
                </button>
            )}
            {!canSetSigners && accessListNoteInfo && accessListNoteInfo.isSet && signersNoteInfo && !signersNoteInfo.isSet && !activeHotWalletAddress && (
                <div style={{marginTop: '5px', fontSize: '0.8em', color: 'orange'}}>
                    Cannot set Signers Note: No active hot wallet identified in graph. Link and activate one first.
                </div>
            )}
            <Handle type="source" position={Position.Bottom} />
        </div>
    );
};

const HotWalletNodeComponent: React.FC<NodeProps<IHotWalletNodeData>> = ({ data }) => (
    <div style={{ padding: 10, border: '1px solid #ffff00', borderRadius: '5px', background: '#222', color: '#ffff00' }}>
        <Handle type="target" position={Position.Top} />
        <strong>Hot Wallet:</strong> {(data as any)['name']}
        <div>Address: {(data as any)['address']}</div>
        <div>Status: {(data as any)['status_description']}</div>
        <div>Funding: ETH {((data as any).funding_info)?.['ethBalanceStr'] ?? 'N/A'}</div>
        {((data as any).funding_info)?.['needsEth'] && <div style={{color: 'orange'}}>Needs ETH</div>}
        {((data as any).funding_info)?.['errorMessage'] && <div style={{color: 'red', fontSize: '0.8em'}}>Funding Error: {((data as any).funding_info)?.['errorMessage']}</div>}
        <Handle type="source" position={Position.Bottom} />
    </div>
);

const AuthorizedClientNodeComponent: React.FC<NodeProps<IAuthorizedClientNodeData>> = ({ data }) => (
    <div style={{ padding: 10, border: '1px solid #ff00ff', borderRadius: '5px', background: '#222', color: '#ff00ff' }}>
        <Handle type="target" position={Position.Top} />
        <strong>Auth. Client:</strong> {(data as any)['client_name']}
        <div>ID: {(data as any)['client_id']}</div>
        <div>Hot Wallet: {(data as any)['associated_hot_wallet_address']}</div>
    </div>
);

const AddHotWalletActionNodeComponent: React.FC<NodeProps<IAddHotWalletActionNodeData>> = ({ data }) => (
    <div style={{ padding: 15, border: '2px dashed #00ffff', borderRadius: '5px', background: '#333', color: '#00ffff', cursor: 'pointer' }}>
        <Handle type="target" position={Position.Top} />
        <strong>{(data as any)['label'] || "Link New Hot Wallet"}</strong>
    </div>
);

const AddAuthorizedClientActionNodeComponent: React.FC<NodeProps<IAddAuthorizedClientActionNodeData>> = ({ data }) => (
    <div style={{ padding: 15, border: '2px dashed #ff00ff', borderRadius: '5px', background: '#333', color: '#ff00ff', cursor: 'pointer' }}>
        <Handle type="target" position={Position.Top} />
        <strong>{(data as any)['label'] || "Add New Client"}</strong>
    </div>
);

// Cast data to any to access potential onClick and disabled props from GraphStateTester
const MintOperatorWalletActionNodeComponent: React.FC<NodeProps<IMintOperatorWalletActionNodeData & { onClick?: () => void; disabled?: boolean }>> = ({ data }) => (
    <button 
        onClick={(data as any).onClick} 
        disabled={(data as any).disabled}
        style={{
            padding: 15, 
            border: '2px dashed #28a745', 
            borderRadius: '5px', 
            background: (data as any).disabled ? '#555' : '#333', 
            color: (data as any).disabled ? '#888' : '#28a745', 
            cursor: (data as any).disabled ? 'not-allowed' : 'pointer',
            width: '100%', // Ensure button takes full width of the node
            textAlign: 'center' as 'center' // Explicitly cast to string literal type
        }}
    >
        <Handle type="target" position={Position.Top} style={{visibility: 'hidden'}}/>
        <strong>{(data as any)['label'] || "Create Operator Wallet"}</strong>
        {(data as any)['ownerNodeName'] && <div style={{fontSize: '0.7em', color: (data as any).disabled ? '#777' : '#aaa'}}>For: {(data as any)['ownerNodeName']}</div>}
    </button>
);

// Helper interfaces for NodeProps data (mirroring Rust structs, but ensure they are defined in types.ts and imported)
// These are illustrative. Actual props will come from IGraphNode.data which is an enum.
// The 'type' field in IGraphNode.data will discriminate, but for NodeProps, we need specific data shapes.
// For now, let's assume the data prop passed to each component matches these.
// We might need a type guard or a more sophisticated way to pass props if data is a union type in NodeProps.
import { 
    IOperatorWalletNodeData,
    IHotWalletNodeData,
    IAuthorizedClientNodeData,
    IAddHotWalletActionNodeData,
    IAddAuthorizedClientActionNodeData,
    IMintOperatorWalletActionNodeData
    // Ensure these are defined in types.ts and imported
} from '../logic/types';

const nodeTypes = {
    ownerNode: OwnerNodeComponent,
    operatorWalletNode: OperatorWalletNodeComponent,
    hotWalletNode: HotWalletNodeComponent,
    authorizedClientNode: AuthorizedClientNodeComponent,
    addHotWalletActionNode: AddHotWalletActionNodeComponent,
    addAuthorizedClientActionNode: AddAuthorizedClientActionNodeComponent,
    mintOperatorWalletActionNode: MintOperatorWalletActionNodeComponent,
};

interface BackendDrivenHpnVisualizerProps {
    initialGraphData?: IHpnGraphResponse; // Optional prop for test data
}

const BackendDrivenHpnVisualizer: React.FC<BackendDrivenHpnVisualizerProps> = ({ initialGraphData }) => {
    const [nodes, setNodes, onNodesChange] = useNodesState<Node[]>([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState([]);
    const [isLoadingGraph, setIsLoadingGraph] = useState<boolean>(!initialGraphData);
    const [graphDataError, setGraphDataError] = useState<string | null>(null);
    const [isProcessingMintClick, setIsProcessingMintClick] = useState<boolean>(false);
    const [mintDisplayError, setMintDisplayError] = useState<string | null>(null);
    const [noteDisplayError, setNoteDisplayError] = useState<string | null>(null);

    // State for LinkHotWalletsModal
    const [isLinkHotWalletsModalOpen, setIsLinkHotWalletsModalOpen] = useState<boolean>(false);
    const [selectedOperatorTbaForModal, setSelectedOperatorTbaForModal] = useState<Address | null>(null);
    const [selectedOperatorEntryNameForModal, setSelectedOperatorEntryNameForModal] = useState<string | null>(null);
    // To pass current note status to the modal for display (optional, but good for context)
    const [currentSignersNoteStatusForModal, setCurrentSignersNoteStatusForModal] = useState<any>(null);

    // State for ShimApiConfigModal
    const [isShimApiConfigModalOpen, setIsShimApiConfigModalOpen] = useState<boolean>(false);
    const [hotWalletAddressForShimModal, setHotWalletAddressForShimModal] = useState<Address | null>(null);

    const { address: connectedAddress } = useAccount();
    const mintOperatorWalletHook = useMintOperatorSubEntry();
    
    const operatorNoteHook = useSetOperatorNote({
        onSuccess: (data) => {
            console.log("Set Note successful via hook.onSuccess, tx data:", data);
        },
        onError: (error) => {
            console.error("Set Note error via hook.onError:", error);
            setNoteDisplayError(error.message || "An error occurred calling setAccessListNote (hook.onError).");
        },
        onSettled: (data, error) => {
            console.log("Set Note settled via hook.onSettled. Data:", data, "Error:", error);
        }
    });

    const onConnect = useCallback(
        (params: Edge | Connection) => setEdges((eds: Edge[]) => addEdge(params, eds)),
        [setEdges],
    );

    const fetchGraphData = useCallback(async () => {
        if (initialGraphData) return;

        setIsLoadingGraph(true);
        setGraphDataError(null);
        try {
            const response = await fetch(HPN_GRAPH_ENDPOINT);
            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`Graph Data Fetch Failed: ${response.status} - ${errText}`);
            }
            const data: IHpnGraphResponse = await response.json();
            
            let activeHotWalletAddress: Address | null = null;
            if (data.nodes) {
                const activeHwNode = data.nodes.find(
                    (n: IGraphNode) => n.type === 'hotWalletNode' && (n.data as any)?.['is_active_in_mcp'] === true
                );
                if (activeHwNode) {
                    activeHotWalletAddress = (activeHwNode.data as any)?.['address'] as Address | null;
                }
            }

            const transformedNodes = data.nodes.map((n, index) => {
                const nodeTypeString = n.type;
                const actualNodeDataWrapper = n.data as any; 
                const actualNodeData = actualNodeDataWrapper[nodeTypeString];

                // Pass through onClick/disabled if they exist from backend data (e.g. initialGraphData setup)
                // but ensure they are not causing type issues with base IGraphNodeData types
                const finalNodeData = {
                    ...(actualNodeData || {}),
                    type: nodeTypeString,
                };

                // For action nodes that might have these properties from test data, add them if present
                if ((actualNodeDataWrapper).onClick) {
                    (finalNodeData as any).onClick = (actualNodeDataWrapper).onClick;
                }
                if ((actualNodeDataWrapper).disabled !== undefined) {
                    (finalNodeData as any).disabled = (actualNodeDataWrapper).disabled;
                }

                // Pass down handlers and states for OperatorWalletNode
                if (nodeTypeString === 'operatorWalletNode') {
                    (finalNodeData as any).onSetAccessListNote = handleSetAccessListNote;
                    (finalNodeData as any).isSettingAccessListNote = operatorNoteHook.isSending || operatorNoteHook.isConfirming;
                    (finalNodeData as any).onSetSignersNote = handleSetSignersNote;
                    (finalNodeData as any).isSettingSignersNote = operatorNoteHook.isSending || operatorNoteHook.isConfirming;
                    (finalNodeData as any).activeHotWalletAddressForNode = activeHotWalletAddress;
                }

                return {
                    ...n,
                    type: nodeTypeString, 
                    data: finalNodeData,
                    position: n.position ?? { x: 0, y: index * 150 },
                };
            });

            setNodes(transformedNodes);
            // Convert IGraphEdge[] to Edge<any>[] by ensuring all required fields are present
            setEdges(data.edges.map(edge => ({
                id: edge.id,
                source: edge.source,
                target: edge.target,
                animated: edge.animated || undefined, // Convert null to undefined
                type: edge.styleType || undefined
            })));
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : 'Unknown error during graph data fetch';
            setGraphDataError(errorMsg);
            setNodes([]); 
            setEdges([]);
        } finally {
            setIsLoadingGraph(false);
        }
    }, [initialGraphData, setNodes, setEdges, operatorNoteHook.isSending, operatorNoteHook.isConfirming]);

    useEffect(() => {
        if (initialGraphData) {
            let activeHotWalletAddress: Address | null = null;
            if (initialGraphData.nodes) {
                const activeHwNode = initialGraphData.nodes.find(
                    (n: IGraphNode) => n.type === 'hotWalletNode' && (n.data as any)?.['is_active_in_mcp'] === true
                );
                if (activeHwNode) {
                    activeHotWalletAddress = (activeHwNode.data as any)?.['address'] as Address | null;
                }
            }

            const transformedNodes = initialGraphData.nodes.map((n, index) => {
                const nodeTypeString = n.type; // Store original type from IGraphNode
                const baseData = n.data as any; // Cast to any to handle different data shapes

                let finalNodeData = { ...baseData }; // Start with a copy of the base data

                // If the type exists as a key in baseData (e.g. data: { ownerNode: { ... } }), use that inner object.
                // Otherwise, assume baseData itself is the data payload.
                if (baseData && typeof baseData === 'object' && baseData[nodeTypeString]) {
                    finalNodeData = { ...baseData[nodeTypeString] };
                }
                
                // Add the 'type' field back if it was stripped or to ensure it's present
                (finalNodeData as any).type = nodeTypeString;


                // Pass through onClick/disabled if they exist from backend data (e.g. initialGraphData setup)
                 if ((n.data as any).onClick) {
                    (finalNodeData as any).onClick = (n.data as any).onClick;
                }
                if ((n.data as any).disabled !== undefined) {
                    (finalNodeData as any).disabled = (n.data as any).disabled;
                }


                if (nodeTypeString === 'operatorWalletNode') {
                    (finalNodeData as any).onSetAccessListNote = handleSetAccessListNote;
                    (finalNodeData as any).isSettingAccessListNote = operatorNoteHook.isSending || operatorNoteHook.isConfirming;
                    (finalNodeData as any).onSetSignersNote = handleSetSignersNote;
                    (finalNodeData as any).isSettingSignersNote = operatorNoteHook.isSending || operatorNoteHook.isConfirming;
                    (finalNodeData as any).activeHotWalletAddressForNode = activeHotWalletAddress;
                }

                return {
                    ...n, // Spread the original node properties (id, etc.)
                    type: nodeTypeString, // Ensure correct type for React Flow
                    data: finalNodeData, // Use the processed data
                    position: n.position ?? { x: 0, y: index * 150 },
                };
            });
            setNodes(transformedNodes);
            // Convert IGraphEdge[] to Edge<any>[] by ensuring all required fields are present
            setEdges(initialGraphData.edges.map(edge => ({
                id: edge.id,
                source: edge.source,
                target: edge.target,
                animated: edge.animated || undefined, // Convert null to undefined
                type: edge.styleType || undefined
            })));
        } else {
            fetchGraphData();
        }
    }, [initialGraphData, fetchGraphData, setNodes, setEdges]);

    // Effect to update the specific minting node's disabled state
    useEffect(() => {
        setNodes((nds: Node[]) => 
            nds.map((n: Node) => { 
                if (n.type === 'mintOperatorWalletActionNode' && n.data?.actionId === 'trigger_mint_operator_wallet') {
                    return {
                        ...n,
                        data: {
                            ...n.data,
                            // Use specific underlying loading states from the hook
                            disabled: isProcessingMintClick || mintOperatorWalletHook.isSending || mintOperatorWalletHook.isConfirming, 
                        },
                    };
                }
                // Update OperatorWalletNode with current setting state
                if (n.type === 'operatorWalletNode') {
                     return {
                         ...n,
                         data: {
                             ...n.data,
                             isSettingAccessListNote: operatorNoteHook.isSending || operatorNoteHook.isConfirming,
                             isSettingSignersNote: operatorNoteHook.isSending || operatorNoteHook.isConfirming,
                         }
                     };
                }
                return n;
            })
        );
    }, [isProcessingMintClick, mintOperatorWalletHook.isSending, mintOperatorWalletHook.isConfirming, operatorNoteHook.isSending, operatorNoteHook.isConfirming, setNodes]);

    // Effect to refetch graph data when a mint transaction is successfully confirmed
    useEffect(() => {
        if (mintOperatorWalletHook.isConfirmed) {
            console.log("Mint transaction confirmed (Tx: ", mintOperatorWalletHook.transactionHash, "). Refetching graph data.");
            fetchGraphData();
            setIsProcessingMintClick(false);
            mintOperatorWalletHook.reset(); // Reset hook state
        }
    }, [mintOperatorWalletHook.isConfirmed, fetchGraphData, mintOperatorWalletHook.reset]);

    // Effect to refetch graph data when a note transaction is successfully confirmed
    useEffect(() => {
        if (operatorNoteHook.isConfirmed) {
            console.log("Set Note transaction confirmed (Tx: ", operatorNoteHook.transactionHash, "). Refetching graph data.");
            fetchGraphData();
            operatorNoteHook.reset(); // Reset hook state
        }
    }, [operatorNoteHook.isConfirmed, fetchGraphData, operatorNoteHook.reset]);

    // Effect to display wagmi hook errors
    useEffect(() => {
        if (mintOperatorWalletHook.error) {
            setMintDisplayError(mintOperatorWalletHook.error.message || "An error occurred during the minting process.");
        }
    }, [mintOperatorWalletHook.error]);

    // Effect to display wagmi hook errors for note setting
    useEffect(() => {
        if (operatorNoteHook.error) {
            // Check if already handled by direct onError to avoid duplicate messages
            if (!noteDisplayError?.includes("hook.onError")) {
                 setNoteDisplayError(operatorNoteHook.error.message || "An error occurred while setting the note (hook.error).");
            }
        } else {
             // Only clear if it was set by this effect, allow manual try/catch to persist its message
            if (noteDisplayError?.includes("(hook.error)")){
                setNoteDisplayError(null);
            }
        }
    }, [operatorNoteHook.error, noteDisplayError]); // Added noteDisplayError to dependencies

    const handleSetAccessListNote = useCallback(async (operatorTbaAddress: Address, operatorEntryName: string) => {
        if (!operatorTbaAddress || !operatorEntryName) {
            setNoteDisplayError("Operator TBA address or entry name not available to set note.");
            return;
        }
        console.log(`Attempting to set Access List Note for Operator TBA: ${operatorTbaAddress}, Entry: ${operatorEntryName}`);
        
        console.log('DEBUG: Entire operatorNoteHook object:', operatorNoteHook);
        const functionToCall = operatorNoteHook.setAccessListNote;
        console.log('DEBUG: Extracted operatorNoteHook.setAccessListNote is:', functionToCall);
        console.log('DEBUG: typeof extracted function is:', typeof functionToCall);

        setNoteDisplayError(null); 
        try {
            if (typeof functionToCall === 'function') {
                await functionToCall({ operatorTbaAddress, operatorEntryName });
            } else {
                console.error('Critical: operatorNoteHook.setAccessListNote (or extracted functionToCall) is not a function before call!');
                setNoteDisplayError('Internal error: setAccessListNote handler is not available.');
            }
        } catch (e: any) {
            console.error("Error invoking setAccessListNote directly in handler:", e);
            setNoteDisplayError(e.message || "Failed to initiate set access list note transaction (catch block).");
        }
    }, [operatorNoteHook]);

    const handleSetSignersNote = useCallback(async (operatorTbaAddress: Address, operatorEntryName: string, hotWalletAddress: Address) => {
        if (!operatorTbaAddress || !operatorEntryName || !hotWalletAddress) {
            setNoteDisplayError("Missing required parameters to set signers note.");
            return;
        }
        console.log(`Attempting to set Signers Note for Operator TBA: ${operatorTbaAddress}, Entry: ${operatorEntryName}, with Hot Wallet: ${hotWalletAddress}`);
        setNoteDisplayError(null); // Clear previous errors
        
        // Ensure the hook and its method are available
        const setSignersNoteFn = operatorNoteHook.setSignersNote;
        if (typeof setSignersNoteFn !== 'function') {
            console.error('Critical: operatorNoteHook.setSignersNote is not a function!');
            setNoteDisplayError('Internal error: setSignersNote handler is not available.');
            return;
        }

        try {
            await setSignersNoteFn({
                operatorTbaAddress,
                operatorEntryName,
                hotWalletAddresses: [hotWalletAddress] // Send as an array
            });
            // onSuccess and onError are handled by the hook's own callbacks
        } catch (e: any) {
            console.error("Error invoking setSignersNote directly in handler:", e);
            setNoteDisplayError(e.message || "Failed to initiate set signers note transaction (catch block).");
        }
    }, [operatorNoteHook]); // operatorNoteHook is the dependency

    const handleNodeClick = useCallback(async (_event: React.MouseEvent, node: Node) => {
        console.log('Node clicked: ', node);
        setMintDisplayError(null); // Clear previous mint errors on any node click
        setNoteDisplayError(null); // Clear previous note errors

        if (node.type === 'mintOperatorWalletActionNode' && node.data) {
            console.log("Mint Action Clicked. Data:", node.data);
            const ownerNodeName = (node.data as any)['ownerNodeName']; // e.g., "pertinent.os"
            const subLabelToMintForHpn = "hpn-beta-wallet"; // Or fetch from config/state if dynamic

            if (!ownerNodeName) {
                console.error("Mint Action: Owner node name not found in node data.");
                setMintDisplayError("Configuration error: Owner node name missing.");
                return;
            }

            // Find the parent OwnerNode in the current React Flow nodes to get its TBA address
            // Adjusted for flattened data structure from fetchGraphData
            const parentOwnerNode = nodes.find(n => n.type === 'ownerNode' && (n.data as any)?.name === ownerNodeName);

            if (!parentOwnerNode) {
                console.error(`Mint Action: OwnerNode for '${ownerNodeName}' not found in graph nodes. Current nodes:`, nodes);
                setMintDisplayError(`Runtime error: Could not find graph data for parent ${ownerNodeName}.`);
                return;
            }
            // Adjusted for flattened data structure
            const parentTbaAddress = (parentOwnerNode.data as any)?.['tba_address'] as Address | undefined;

            if (!parentTbaAddress) {
                console.error(`Mint Action: TBA for parent node '${ownerNodeName}' not found. Parent node data:`, parentOwnerNode.data);
                setMintDisplayError(`Configuration error: TBA for parent node '${ownerNodeName}' is missing.`);
                return;
            }
            if (!connectedAddress) {
                console.error("Mint Action: Connected EOA address not found.");
                setMintDisplayError("Wallet not connected or address unavailable.");
                return;
            }

            console.log(`Proceeding with mint for sub-label '${subLabelToMintForHpn}' under parent '${ownerNodeName}' (TBA: ${parentTbaAddress}). New owner: ${connectedAddress}`);
            setIsProcessingMintClick(true);
            setMintDisplayError(null);

            try {
                mintOperatorWalletHook.mint({
                    parentTbaAddress: parentTbaAddress,
                    ownerOfNewSubTba: connectedAddress, // EOA is the owner
                    subLabelToMint: subLabelToMintForHpn,
                    implementationForNewSubTba: DEFAULT_OPERATOR_TBA_IMPLEMENTATION,
                });
                // Note: onSuccess/onError/onSettled are handled by the hook itself.
                // We might set a loading state here and wait for hook's status.
            } catch (error: any) {
                console.error("Error calling mintOperatorWalletHook.mint:", error);
                setMintDisplayError(error.message || "An unexpected error occurred during mint initiation.");
            } finally {
                // isProcessingMintClick will be set to false via the hook's isSending/isConfirming states eventually
            }
        } else if (node.type === 'operatorWalletNode' && node.data) {
            // This block can be simplified or removed if direct interaction with OperatorWalletNode
            // is not intended to set state for the modal anymore.
            // For now, let's keep it for potential direct info display or other actions, but
            // the modal opening will be driven by the action node.
            const operatorData = node.data as any;
            if (operatorData && operatorData.tba_address && operatorData.name) {
                console.log(`OperatorWalletNode clicked (for informational purposes): Name: ${operatorData.name}, TBA: ${operatorData.tba_address}. Signers note status:`, operatorData.signers_note);
                // We are no longer setting setSelectedOperatorTbaForModal here for the purpose of opening the link hot wallets modal.
            } else {
                console.warn("OperatorWalletNode clicked, but essential data (TBA or name) is missing:", operatorData);
            }
        } else if (node.type === 'addHotWalletActionNode' && node.data) {
            const actionNodeData = node.data as any;
            const actionId = actionNodeData.action_id;

            if (actionId === 'trigger_manage_wallets_modal') {
                console.log("Add Hot Wallet Action Node clicked. Data:", actionNodeData);
                const linkedOperatorTba = actionNodeData.operator_tba_address as Address | undefined;

                if (!linkedOperatorTba) {
                    setNoteDisplayError("Configuration error: The action node is missing the operator_tba_address.");
                    console.error("Cannot open LinkHotWalletsModal: operator_tba_address missing from action node data.", actionNodeData);
                    return;
                }

                // Find the corresponding OperatorWalletNode in the graph to get its name (operatorEntryName)
                const operatorNode = nodes.find(n => 
                    n.type === 'operatorWalletNode' && 
                    (n.data as any).tba_address === linkedOperatorTba
                );

                if (!operatorNode) {
                    setNoteDisplayError(`Runtime error: Could not find Operator Wallet node for TBA ${linkedOperatorTba}.`);
                    console.error(`Cannot open LinkHotWalletsModal: OperatorWalletNode with TBA ${linkedOperatorTba} not found in graph nodes.`);
                    return;
                }
                
                const operatorEntryName = (operatorNode.data as any).name as string | undefined;
                const operatorSignersNoteStatus = (operatorNode.data as any).signers_note;

                if (!operatorEntryName) {
                    setNoteDisplayError(`Runtime error: Name (operatorEntryName) is missing for Operator Wallet with TBA ${linkedOperatorTba}.`);
                    console.error(`Cannot open LinkHotWalletsModal: OperatorWalletNode with TBA ${linkedOperatorTba} is missing its name.`, operatorNode.data);
                    return;
                }
                
                console.log(`Opening LinkHotWalletsModal for Operator: ${operatorEntryName} (TBA: ${linkedOperatorTba})`);
                setSelectedOperatorTbaForModal(linkedOperatorTba);
                setSelectedOperatorEntryNameForModal(operatorEntryName);
                setCurrentSignersNoteStatusForModal(operatorSignersNoteStatus || null);
                setIsLinkHotWalletsModalOpen(true);

            } else if (actionId === 'trigger_authorize_client_modal') {
                // Spy Camera Log!
                console.log("Authorize Client Action Node CLICKED. Node Data:", JSON.stringify(actionNodeData, null, 2));

                const targetHotWallet = actionNodeData.target_hot_wallet_address as Address | undefined;
                console.log("Authorize Client Action Node extracted targetHotWallet:", targetHotWallet);

                if (targetHotWallet) {
                    console.log(`Opening ShimApiConfigModal for Hot Wallet: ${targetHotWallet}`);
                    setHotWalletAddressForShimModal(targetHotWallet);
                    setIsShimApiConfigModalOpen(true);
                } else {
                    setNoteDisplayError("Configuration error: Action node is missing target_hot_wallet_address.");
                    console.error("Cannot open ShimApiConfigModal: target_hot_wallet_address missing.", actionNodeData);
                }
            }
        } else if (node.type === 'addAuthorizedClientActionNode' && node.data) {
            const actionNodeData = node.data as any;
            const actionId = actionNodeData.action_id; 

            // Spy Camera Log right after confirming node type and getting data
            console.log("[HPN VISUALIZER] addAuthorizedClientActionNode clicked. Node Data:", JSON.stringify(actionNodeData, null, 2));
            console.log("[HPN VISUALIZER] actionId from data:", actionId);

            // IMPORTANT: Check against the action_id seen in your logs: "trigger_add_client_modal"
            if (actionId === 'trigger_add_client_modal') { 
                const targetHotWallet = actionNodeData.target_hot_wallet_address as Address | undefined;
                console.log("[HPN VISUALIZER] Extracted targetHotWallet for Shim Modal:", targetHotWallet);

                if (targetHotWallet) {
                    console.log(`[HPN VISUALIZER] Opening ShimApiConfigModal for Hot Wallet: ${targetHotWallet}`);
                    setHotWalletAddressForShimModal(targetHotWallet);
                    setIsShimApiConfigModalOpen(true);
                } else {
                    setNoteDisplayError("Configuration error: Action node for authorizing client is missing target_hot_wallet_address.");
                    console.error("[HPN VISUALIZER] Cannot open ShimApiConfigModal: target_hot_wallet_address missing from action node data.", actionNodeData);
                }
            } else {
                console.warn(`[HPN VISUALIZER] addAuthorizedClientActionNode clicked, but action_id was '${actionId}', not 'trigger_add_client_modal'. Modal not opened.`);
            }
        }
    }, [nodes, connectedAddress, mintOperatorWalletHook, operatorNoteHook, setSelectedOperatorTbaForModal, setSelectedOperatorEntryNameForModal, setCurrentSignersNoteStatusForModal]);

    if (isLoadingGraph) {
        return <p>Loading HPN graph data...</p>;
    }

    if (graphDataError) {
        return <p style={{ color: 'red' }}>Error loading graph: {graphDataError} <button onClick={fetchGraphData}>Retry</button></p>;
    }

    const proOptions = { hideAttribution: true };

    return (
        <ReactFlowProvider>
            <div style={{ width: '100%', height: '700px', border: '1px solid #ccc', position: 'relative' }}>
                {isLoadingGraph && <div style={{ padding: '10px', color: 'blue' }}>Loading graph data...</div>}
                {graphDataError && <div style={{ padding: '10px', color: 'red' }}>Error loading graph: {graphDataError}</div>}
                {mintDisplayError && <div style={{ padding: '10px', color: 'red', background: '#ffe0e0', border: '1px solid red' }}>Mint Error: {mintDisplayError}</div>}
                {noteDisplayError && <div style={{ padding: '10px', color: 'red', background: '#ffe0e0', border: '1px solid red' }}>Note Error: {noteDisplayError}</div>}
                
                {mintOperatorWalletHook.isSending && <div style={{ padding: '10px', color: 'orange' }}>Minting: Sending transaction...</div>}
                {mintOperatorWalletHook.isConfirming && mintOperatorWalletHook.transactionHash && (
                    <div style={{ padding: '10px', color: 'blue' }}>
                        Minting: Confirming transaction (Tx: {mintOperatorWalletHook.transactionHash})...
                    </div>
                )}
                {mintOperatorWalletHook.isConfirmed && mintOperatorWalletHook.transactionHash && (
                    <div style={{ padding: '10px', color: 'green' }}>
                        Minting Successful! Tx: {mintOperatorWalletHook.transactionHash}. Refreshing graph...
                    </div>
                )}
                {mintOperatorWalletHook.error && (
                    <div style={{ padding: '10px', color: 'red', background: '#ffe0e0', border: '1px solid red' }}>
                        Minting Failed: {mintOperatorWalletHook.error.message}
                    </div>
                )}

                {operatorNoteHook.isSending && <div style={{ padding: '10px', color: 'orange' }}>Setting Note: Sending transaction...</div>}
                {operatorNoteHook.isConfirming && operatorNoteHook.transactionHash && (
                    <div style={{ padding: '10px', color: 'blue' }}>
                        Setting Note: Confirming transaction (Tx: {operatorNoteHook.transactionHash})...
                    </div>
                )}
                {operatorNoteHook.isConfirmed && operatorNoteHook.transactionHash && (
                    <div style={{ padding: '10px', color: 'green' }}>
                        Set Note Successful! Tx: {operatorNoteHook.transactionHash}. Refreshing graph...
                    </div>
                )}
                {operatorNoteHook.error && ( // This will also catch errors from setSignersNote
                    <div style={{ padding: '10px', color: 'red', background: '#ffe0e0', border: '1px solid red' }}>
                        Set Note Failed: {operatorNoteHook.error.message}
                    </div>
                )}

                <ReactFlow
                    nodes={nodes}
                    edges={edges}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    onConnect={onConnect}
                    nodeTypes={nodeTypes}
                    onNodeClick={handleNodeClick}
                    fitView
                    proOptions={proOptions}
                >
                    <Controls />
                    <Background />
                </ReactFlow>
            </div>
            <LinkHotWalletsModal
                isOpen={isLinkHotWalletsModalOpen}
                onClose={() => setIsLinkHotWalletsModalOpen(false)}
                operatorTbaAddress={selectedOperatorTbaForModal}
                operatorEntryName={selectedOperatorEntryNameForModal}
                currentSignersNoteStatus={currentSignersNoteStatusForModal}
                onWalletsLinked={() => {
                    console.log("Wallets linked successfully (callback from modal). Refreshing graph.");
                    fetchGraphData(); // Refresh graph after linking
                    setIsLinkHotWalletsModalOpen(false); // Also close modal on success
                }}
            />
            {hotWalletAddressForShimModal && (
                <ShimApiConfigModal
                    isOpen={isShimApiConfigModalOpen}
                    onClose={() => {
                        setIsShimApiConfigModalOpen(false);
                        setHotWalletAddressForShimModal(null); // Clear the selected hot wallet
                        console.log("ShimApiConfigModal closed. Refreshing graph data.");
                        fetchGraphData(); 
                    }}
                    hotWalletAddress={hotWalletAddressForShimModal} 
                />
            )}
        </ReactFlowProvider>
    );
};

export default BackendDrivenHpnVisualizer; 
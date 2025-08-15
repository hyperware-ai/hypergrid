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
    NodeProps,
    applyNodeChanges,
    applyEdgeChanges
} from 'reactflow';
import 'reactflow/dist/style.css';
import dagre from 'dagre';
import { ImSpinner8 } from 'react-icons/im';

import {
    IHypergridGraphResponse,
    IGraphNode,
    IGraphEdge,
    IOwnerNodeData,
    IOperatorWalletNodeData,
    IHotWalletNodeData,
    IAuthorizedClientNodeData,
    IAddHotWalletActionNodeData,
    IAddAuthorizedClientActionNodeData,
    IMintOperatorWalletActionNodeData
} from '../logic/types';

import { useAccount } from 'wagmi';
import type { Address } from 'viem';

import {
    useMintOperatorSubEntry,
    useSetOperatorNote,
    useApprovePaymaster,
    DEFAULT_OPERATOR_TBA_IMPLEMENTATION,
    viemNamehash,
} from '../logic/hypermapHelpers';

import ShimApiConfigModal from './ShimApiConfigModal';
import CallHistoryModal from './modals/CallHistoryModal';
import AuthorizedClientConfigModal from './AuthorizedClientConfigModal';
import HotWalletSettingsModal from './modals/HotWalletSettingsModal';
import { FiPlusCircle } from 'react-icons/fi';

import OriginalOperatorWalletNodeComponent from './nodes/OperatorWalletNodeComponent';
import OriginalAuthorizedClientNodeComponent from './nodes/AuthorizedClientNodeComponent';
import OriginalOwnerNodeComponent from './nodes/OwnerNodeComponent';
import OriginalHotWalletNodeComponent from './nodes/HotWalletNodeComponent';
import AddHotWalletActionNodeComponent from './nodes/AddHotWalletActionNodeComponent';
import { useErrorLogStore } from '../store/errorLog';
import { callApiWithRouting } from '../utils/api-endpoints';

const getApiBasePath = () => {
    const pathParts = window.location.pathname.split('/').filter(p => p);
    const processIdPart = pathParts.find(part => part.includes(':'));
    return processIdPart ? `/${processIdPart}/api` : '/api';
};
const API_BASE_URL = getApiBasePath();
const HYPERGRID_GRAPH_ENDPOINT = `${API_BASE_URL}/hypergrid-graph`;

const dagreGraph = new dagre.graphlib.Graph();
dagreGraph.setDefaultEdgeLabel(() => ({}));

export const NODE_WIDTH = 320;
export const NODE_HEIGHT = 150;

const getLayoutedElements = (nodes: Node<any>[], edges: Edge[], direction = 'TB') => {
    dagreGraph.setGraph({
        rankdir: direction,
        nodesep: 100,
        ranksep: 100
    });

    nodes.forEach((node) => {
        let height = NODE_HEIGHT;
        let width = NODE_WIDTH;
        if (node.type === 'operatorWalletNode') height = 250;
        if (node.type === 'hotWalletNode') height = 270;
        if (node.type === 'addHotWalletActionNode') height = 300;
        if (node.type === 'authorizedClientNode') { height = 280 };
        if (node.type === 'mintOperatorWalletActionNode') height = 60;
        dagreGraph.setNode(node.id, { width, height });
    });

    edges.forEach((edge) => {
        dagreGraph.setEdge(edge.source, edge.target);
    });

    dagre.layout(dagreGraph);

    const layoutedNodes = nodes.map((node) => {
        const nodeWithPosition = dagreGraph.node(node.id);
        const nodeHeightCalculated = dagreGraph.node(node.id).height || NODE_HEIGHT;
        const nodeWidthCalculated = dagreGraph.node(node.id).width || NODE_WIDTH;
        node.position = {
            x: nodeWithPosition.x - nodeWidthCalculated / 2,
            y: nodeWithPosition.y - nodeHeightCalculated / 2,
        };
        return node;
    });

    // Special positioning logic to prevent overlap of operator wallet and hot wallet action nodes
    const operatorWalletNode = layoutedNodes.find(n => n.type === 'operatorWalletNode');
    const addHotWalletActionNode = layoutedNodes.find(n => n.type === 'addHotWalletActionNode');
    
    if (operatorWalletNode && addHotWalletActionNode) {
        // Check if they're too close (likely overlapping)
        const xDiff = Math.abs(operatorWalletNode.position.x - addHotWalletActionNode.position.x);
        const yDiff = Math.abs(operatorWalletNode.position.y - addHotWalletActionNode.position.y);
        
        // Check if nodes are overlapping or too close vertically/horizontally
        const operatorNodeHeight = 250; // From line 84
        const addHotWalletNodeHeight = 300; // From line 86
        
        // They overlap if they're on the same X coordinate or very close horizontally
        const horizontallyAligned = xDiff < NODE_WIDTH + 50; // Within node width + small margin
        
        // Check if they need repositioning due to overlap or poor spacing
        if (horizontallyAligned) {
            addHotWalletActionNode.position = {
                x: operatorWalletNode.position.x - 50, // Position only slightly to the left
                y: operatorWalletNode.position.y + 400 // Position more down
            };
        }
    }

console.log("layoutedNodes", layoutedNodes);

    return { nodes: layoutedNodes, edges };
};

const MintOperatorWalletActionNodeComponent: React.FC<NodeProps<IMintOperatorWalletActionNodeData & { onClick?: () => void; disabled?: boolean }>> = ({ data }) => (
    <button
        onClick={(data as any).onClick}
        disabled={(data as any).disabled}
        style={{
            maxWidth: NODE_WIDTH,
        }}
        className="flex flex-col items-center justify-center"
    >
        <Handle type="target" position={Position.Top} style={{ visibility: 'hidden' }} />
        <FiPlusCircle className="w-8 h-8" />
        <div
            className="border-2 border-transparent hover:border-black px-8 py-4 text-white bg-dark-gray hover:bg-white hover:text-dark-gray transition-all duration-300 rounded-full font-semibold"
        >
            {(data as any)['label'] || "Create Operator Wallet"}
        </div>
        {(data as any)['ownerNodeName'] && (
            <div className="text-xs text-mid-gray">
                For: {(data as any)['ownerNodeName']}
            </div>
        )}
    </button>
);

const SimpleAddAuthorizedClientActionNodeComponent: React.FC<NodeProps<IAddAuthorizedClientActionNodeData>> = ({ data }) => (
    <button
        className="p-4 px-8 font-bold !border-2 hover:!border-black !rounded-full bg-dark-gray text-white hover:bg-cyan hover:text-black"
        style={{ maxWidth: NODE_WIDTH }}
    >
        <Handle type="target" position={Position.Top} style={{ visibility: 'hidden' }} />
        {(data as any)['label'] || "Authorize New Client"}
    </button>
);

interface BackendDrivenHypergridVisualizerProps {
    initialGraphData?: IHypergridGraphResponse;
}

const toCamelCase = (str: string): string => {
    return str.replace(/([-_][a-z])/ig, ($1) => {
        return $1.toUpperCase()
            .replace('-', '')
            .replace('_', '');
    });
};

const convertKeysToCamelCase = (obj: any): any => {
    if (typeof obj !== 'object' || obj === null) {
        return obj;
    }
    if (Array.isArray(obj)) {
        return obj.map(convertKeysToCamelCase);
    }
    return Object.keys(obj).reduce((acc, key) => {
        const camelKey = toCamelCase(key);
        acc[camelKey] = convertKeysToCamelCase(obj[key]);
        return acc;
    }, {} as any);
};

const BackendDrivenHypergridVisualizerWrapper: React.FC<BackendDrivenHypergridVisualizerProps> = ({ initialGraphData }) => {
    const { showToast } = useErrorLogStore();
    const [nodes, setNodes, onNodesChange] = useNodesState<Node[]>([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState([]);
    const [isLoadingGraph, setIsLoadingGraph] = useState<boolean>(!initialGraphData);
    const [graphDataError, setGraphDataError] = useState<string | null>(null);
    const [isProcessingMintClick, setIsProcessingMintClick] = useState<boolean>(false);

    const [isShimApiConfigModalOpen, setIsShimApiConfigModalOpen] = useState<boolean>(false);
    const [hotWalletAddressForShimModal, setHotWalletAddressForShimModal] = useState<Address | null>(null);

    // New state for authorized client modal
    const [isAuthorizedClientModalOpen, setIsAuthorizedClientModalOpen] = useState<boolean>(false);
    const [selectedAuthorizedClient, setSelectedAuthorizedClient] = useState<{
        clientId: string;
        clientName: string;
        hotWalletAddress: string;
    } | null>(null);

    const [isHistoryModalOpen, setIsHistoryModalOpen] = useState<boolean>(false);
    const [selectedWalletForHistory, setSelectedWalletForHistory] = useState<Address | null>(null);

    // Hot Wallet Settings Modal state
    const [isHotWalletSettingsModalOpen, setIsHotWalletSettingsModalOpen] = useState<boolean>(false);
    const [selectedWalletForSettings, setSelectedWalletForSettings] = useState<IHotWalletNodeData | null>(null);

    // States for lock/unlock operations initiated from visualizer
    const [isUnlockingOrLockingWalletId, setIsUnlockingOrLockingWalletId] = useState<string | null>(null);

    const { address: connectedAddress } = useAccount();
    const mintOperatorWalletHook = useMintOperatorSubEntry();

    // Paymaster revoke hook
    const revokePaymasterHook = useApprovePaymaster({
        onSuccess: (data) => {
            console.log("Paymaster revoke transaction sent:", data);
            showToast('success', 'Paymaster revocation initiated!');
        },
        onError: (err) => {
            console.error("Paymaster revoke error:", err);
            showToast('error', `Failed to revoke paymaster: ${err.message}`);
        },
    });

    // Centralized routing: only MCP ops will go to /api/mcp; others to /api/actions
    const callApiRouted = useCallback(async (payload: any) => {
        return callApiWithRouting(payload);
    }, []);

    const onSetNoteSuccess = useCallback((data: any) => {
        console.log("Set Note successful via hook.onSuccess, tx data:", data);
    }, []);

    const onSetNoteError = useCallback((error: Error) => {
        console.error("Set Note error via hook.onError:", error);
        showToast('error', error.message || "An error occurred calling setAccessListNote (hook.onError).");
    }, []);

    const onSetNoteSettled = useCallback((data: any, error: Error | null) => {
        console.log("Set Note settled via hook.onSettled. Data:", data, "Error:", error);
    }, []);

    const operatorNoteHookOriginal = useSetOperatorNote({
        onSuccess: onSetNoteSuccess,
        onError: onSetNoteError,
        onSettled: onSetNoteSettled,
    });

    const {
        setAccessListNote,
        setSignersNote,
        isSending: isOperatorNoteSending,
        isConfirming: isOperatorNoteConfirming,
        isConfirmed: isOperatorNoteConfirmed,
        transactionHash: operatorNoteTxHash,
        error: operatorNoteErrorState,
        reset: resetOperatorNoteHook
    } = operatorNoteHookOriginal;

    const onConnect = useCallback(
        (params: Edge | Connection) => setEdges((eds: Edge[]) => addEdge(params, eds)),
        [setEdges],
    );

    const handleSetAccessListNote = useCallback(async (operatorTbaAddress: Address, operatorEntryName: string) => {
        if (!operatorTbaAddress || !operatorEntryName) {
            showToast('error', "Operator TBA address or entry name not available to set note.");
            return;
        }
        console.log(`Attempting to set Access List Note for Operator TBA: ${operatorTbaAddress}, Entry: ${operatorEntryName}`);

        try {
            if (typeof setAccessListNote === 'function') {
                setAccessListNote({ operatorTbaAddress, operatorEntryName });
            } else {
                console.error('Critical: setAccessListNote is not a function before call!');
                showToast('error', 'Internal error: setAccessListNote handler is not available.');
            }
        } catch (e: any) {
            console.error("Error invoking setAccessListNote directly in handler:", e);
            showToast('error', e.message || "Failed to initiate set access list note transaction (catch block).");
        }
    }, [setAccessListNote, showToast]);

    const handleSetSignersNote = useCallback(async (operatorTbaAddress: Address, operatorEntryName: string, hotWalletAddress: Address) => {
        if (!operatorTbaAddress || !operatorEntryName || !hotWalletAddress) {
            showToast('error', "Missing required parameters to set signers note.");
            return;
        }
        console.log(`Attempting to set Signers Note for Operator TBA: ${operatorTbaAddress}, Entry: ${operatorEntryName}, with Hot Wallet: ${hotWalletAddress}`);

        const setSignersNoteFn = setSignersNote;
        if (typeof setSignersNoteFn !== 'function') {
            console.error('Critical: setSignersNote is not a function!');
            showToast('error', 'Internal error: setSignersNote handler is not available.');
            return;
        }

        try {
            setSignersNoteFn({
                operatorTbaAddress,
                operatorEntryName,
                hotWalletAddresses: [hotWalletAddress]
            });
        } catch (e: any) {
            console.error("Error invoking setSignersNote directly in handler:", e);
            showToast('error', e.message || "Failed to initiate set signers note transaction (catch block).");
        }
    }, [setSignersNote, showToast]);

    const fetchGraphData = useCallback(async () => {
        setIsLoadingGraph(true);
        setGraphDataError(null);
        try {
            const response = await fetch(HYPERGRID_GRAPH_ENDPOINT);
            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`Graph Data Fetch Failed: ${response.status} - ${errText}`);
            }
            const rawData: IHypergridGraphResponse = await response.json(); // Raw data from backend

            const processedNodes = rawData.nodes.map(backendNode => {
                let processedData: any = {};
                // The backend sends data like: { ownerNode: { name: "..." } } or { hotWalletNode: { address: "..." } }
                // We want to extract the inner object and camelCase its keys.
                const nodeTypeKey = backendNode.type; // e.g., "ownerNode", "hotWalletNode"
                const specificNodeData = (backendNode.data as any)[nodeTypeKey];

                if (specificNodeData) {
                    processedData = convertKeysToCamelCase(specificNodeData);

                    // Specifically ensure 'limits' within hotWalletNode data is also camelCased
                    if (backendNode.type === 'hotWalletNode' && processedData.limits) {
                        processedData.limits = convertKeysToCamelCase(processedData.limits);
                    }
                } else {
                    // Fallback if data structure is different, or just copy if no specific data
                    processedData = convertKeysToCamelCase(backendNode.data);
                }

                return {
                    id: backendNode.id,
                    type: backendNode.type,
                    position: backendNode.position || { x: 0, y: 0 },
                    data: processedData, // This data object is what HotWalletNodeComponent receives as its `data` prop
                };
            });

            let activeHotWalletAddress: Address | null = null;
            const backendNodesForTransform: Node[] = processedNodes.map((n) => ({
                id: n.id,
                type: n.type,
                data: n.data, // This `data` should now be correctly camelCased
                position: n.position || { x: 0, y: 0 }
            }));

            const backendEdges: Edge[] = rawData.edges.map(edge => ({
                id: edge.id,
                source: edge.source,
                target: edge.target,
                animated: edge.animated || undefined,
                type: edge.styleType || undefined
            }));

            const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(backendNodesForTransform, backendEdges);

            if (layoutedNodes) {
                const activeHwNode = layoutedNodes.find(
                    (node: Node) => node.type === 'hotWalletNode' && (node.data as IHotWalletNodeData)?.isActiveInMcp === true
                );
                if (activeHwNode) {
                    activeHotWalletAddress = (activeHwNode.data as IHotWalletNodeData)?.address as Address | null;
                }
            }

            const transformedNodes = layoutedNodes.map((n) => {
                const nodeTypeString = n.type as string;
                const finalNodeData = { ...n.data } as any;
                finalNodeData.type = nodeTypeString;

                if (nodeTypeString === 'operatorWalletNode') {
                    finalNodeData.onSetAccessListNote = handleSetAccessListNote;
                    finalNodeData.isSettingAccessListNote = isOperatorNoteSending || isOperatorNoteConfirming;
                    finalNodeData.onSetSignersNote = handleSetSignersNote;
                    finalNodeData.isSettingSignersNote = isOperatorNoteSending || isOperatorNoteConfirming;
                    finalNodeData.activeHotWalletAddressForNode = activeHotWalletAddress;
                    finalNodeData.onWalletsLinked = fetchGraphData;
                    finalNodeData.onRevokePaymaster = handleRevokePaymaster;
                    finalNodeData.isRevokingPaymaster = revokePaymasterHook.isSending || revokePaymasterHook.isConfirming;
                    finalNodeData.revokeHookState = {
                        isConfirmed: revokePaymasterHook.isConfirmed,
                        reset: revokePaymasterHook.reset
                    };
                } else if (nodeTypeString === 'addHotWalletActionNode') {
                    finalNodeData.onWalletsLinked = fetchGraphData;
                    const opTBAForActionNode = finalNodeData.operatorTbaAddress as Address | undefined;
                    finalNodeData.currentLinkedWallets = [];
                    finalNodeData.operatorEntryName = null;

                    if (opTBAForActionNode) {
                        const operatorNode = layoutedNodes.find(ln => ln.type === 'operatorWalletNode' && (ln.data as IOperatorWalletNodeData)?.tbaAddress === opTBAForActionNode);
                        if (operatorNode) {
                            finalNodeData.operatorEntryName = (operatorNode.data as IOperatorWalletNodeData).name;
                            const operatorNodeId = operatorNode.id;
                            const linkedWalletsForThisOp: Address[] = [];
                            layoutedEdges.forEach(edge => {
                                if (edge.source === operatorNodeId) {
                                    const targetNode = layoutedNodes.find(node => node.id === edge.target);
                                    if (targetNode && targetNode.type === 'hotWalletNode') {
                                        const hotWalletAddress = (targetNode.data as IHotWalletNodeData)?.address;
                                        if (hotWalletAddress) {
                                            linkedWalletsForThisOp.push(hotWalletAddress as Address);
                                        }
                                    }
                                }
                            });
                            finalNodeData.currentLinkedWallets = linkedWalletsForThisOp;
                        } else {
                            console.warn(`[Visualizer] AddHotWalletActionNode: Could not find operator node for TBA ${opTBAForActionNode}`);
                        }
                    } else {
                        console.warn("[Visualizer] AddHotWalletActionNode is missing operatorTbaAddress in its data", finalNodeData);
                    }
                }
                return { ...n, data: finalNodeData };
            });

            setNodes(transformedNodes);
            setEdges(layoutedEdges);
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : 'Unknown error during graph data fetch';
            setGraphDataError(errorMsg);
            showToast('error', errorMsg);
            setNodes([]);
            setEdges([]);
        } finally {
            setIsLoadingGraph(false);
        }
    }, [setNodes, setEdges, handleSetAccessListNote, handleSetSignersNote, isOperatorNoteSending, isOperatorNoteConfirming]);

    useEffect(() => {
        if (initialGraphData) {
            const processedNodes = initialGraphData.nodes.map(n => {
                let processedData: any = {};
                // The backend sends data like: { ownerNode: { name: "..." } } or { hotWalletNode: { address: "..." } }
                // We want to extract the inner object and camelCase its keys.
                const nodeTypeKey = n.type; // e.g., "ownerNode", "hotWalletNode"
                const specificNodeData = (n.data as any)[nodeTypeKey];

                if (specificNodeData) {
                    processedData = convertKeysToCamelCase(specificNodeData);

                    // Specifically ensure 'limits' within hotWalletNode data is also camelCased
                    if (n.type === 'hotWalletNode' && processedData.limits) {
                        processedData.limits = convertKeysToCamelCase(processedData.limits);
                    }
                } else {
                    // Fallback if data structure is different, or just copy if no specific data
                    processedData = convertKeysToCamelCase(n.data);
                }

                return {
                    ...n,
                    data: processedData,
                };
            });

            let activeHotWalletAddressForInitial: Address | null = null;
            const backendNodesForInitial: Node[] = processedNodes.map((n) => ({
                id: n.id,
                type: n.type,
                data: n.data,
                position: n.position || { x: 0, y: 0 }
            }));

            const backendEdgesForInitial: Edge[] = initialGraphData.edges.map(edge => ({
                id: edge.id,
                source: edge.source,
                target: edge.target,
                animated: edge.animated || undefined,
                type: edge.styleType || undefined
            }));

            const { nodes: layoutedInitialNodes, edges: layoutedInitialEdges } = getLayoutedElements(backendNodesForInitial, backendEdgesForInitial);

            if (layoutedInitialNodes) {
                const activeHwNode = layoutedInitialNodes.find(
                    (node: Node) => node.type === 'hotWalletNode' && (node.data as IHotWalletNodeData)?.isActiveInMcp === true
                );
                if (activeHwNode) {
                    activeHotWalletAddressForInitial = (activeHwNode.data as IHotWalletNodeData)?.address as Address | null;
                }
            }

            const transformedInitialNodes = layoutedInitialNodes.map((n) => {
                const nodeTypeString = n.type as string;
                const finalNodeData = { ...n.data } as any;
                finalNodeData.type = nodeTypeString;

                if ((n.data as any).onClick) { finalNodeData.onClick = (n.data as any).onClick; }
                if ((n.data as any).disabled !== undefined) { finalNodeData.disabled = (n.data as any).disabled; }

                if (nodeTypeString === 'operatorWalletNode') {
                    finalNodeData.onSetAccessListNote = handleSetAccessListNote;
                    finalNodeData.isSettingAccessListNote = isOperatorNoteSending || isOperatorNoteConfirming;
                    finalNodeData.onSetSignersNote = handleSetSignersNote;
                    finalNodeData.isSettingSignersNote = isOperatorNoteSending || isOperatorNoteConfirming;
                    finalNodeData.activeHotWalletAddressForNode = activeHotWalletAddressForInitial;
                    finalNodeData.onWalletsLinked = fetchGraphData;
                    finalNodeData.onRevokePaymaster = handleRevokePaymaster;
                    finalNodeData.isRevokingPaymaster = revokePaymasterHook.isSending || revokePaymasterHook.isConfirming;
                    finalNodeData.revokeHookState = {
                        isConfirmed: revokePaymasterHook.isConfirmed,
                        reset: revokePaymasterHook.reset
                    };
                } else if (nodeTypeString === 'addHotWalletActionNode') {
                    finalNodeData.onWalletsLinked = fetchGraphData;
                    const opTBAForActionNode = finalNodeData.operatorTbaAddress as Address | undefined;
                    finalNodeData.currentLinkedWallets = [];
                    finalNodeData.operatorEntryName = null;

                    if (opTBAForActionNode) {
                        const operatorNode = layoutedInitialNodes.find(ln => ln.type === 'operatorWalletNode' && (ln.data as IOperatorWalletNodeData)?.tbaAddress === opTBAForActionNode);
                        if (operatorNode) {
                            finalNodeData.operatorEntryName = (operatorNode.data as IOperatorWalletNodeData).name;
                            const operatorNodeId = operatorNode.id;
                            const linkedWalletsForThisOp: Address[] = [];
                            layoutedInitialEdges.forEach(edge => {
                                if (edge.source === operatorNodeId) {
                                    const targetNode = layoutedInitialNodes.find(node => node.id === edge.target);
                                    if (targetNode && targetNode.type === 'hotWalletNode') {
                                        const hotWalletAddress = (targetNode.data as IHotWalletNodeData)?.address;
                                        if (hotWalletAddress) {
                                            linkedWalletsForThisOp.push(hotWalletAddress as Address);
                                        }
                                    }
                                }
                            });
                            finalNodeData.currentLinkedWallets = linkedWalletsForThisOp;
                        } else {
                            console.warn(`[Visualizer Initial] AddHotWalletActionNode: Could not find operator node for TBA ${opTBAForActionNode}`);
                        }
                    } else {
                        console.warn("[Visualizer Initial] AddHotWalletActionNode is missing operatorTbaAddress in its data", finalNodeData);
                    }
                }
                return { ...n, data: finalNodeData };
            });
            setNodes(transformedInitialNodes);
            setEdges(layoutedInitialEdges);
        } else {
            fetchGraphData();
        }
    }, [initialGraphData, fetchGraphData, setNodes, setEdges, handleSetAccessListNote, handleSetSignersNote, isOperatorNoteSending, isOperatorNoteConfirming]);

    useEffect(() => {
        setNodes((nds: Node[]) =>
            nds.map((n: Node) => {
                if (n.type === 'mintOperatorWalletActionNode' && n.data?.actionId === 'trigger_mint_operator_wallet') {
                    return {
                        ...n,
                        data: {
                            ...n.data,
                            disabled: isProcessingMintClick || mintOperatorWalletHook.isSending || mintOperatorWalletHook.isConfirming,
                        },
                    };
                }
                if (n.type === 'operatorWalletNode') {
                    return {
                        ...n,
                        data: {
                            ...n.data,
                            isSettingAccessListNote: isOperatorNoteSending || isOperatorNoteConfirming,
                            isSettingSignersNote: isOperatorNoteSending || isOperatorNoteConfirming,
                        }
                    };
                }
                return n;
            })
        );
    }, [isProcessingMintClick, mintOperatorWalletHook.isSending, mintOperatorWalletHook.isConfirming, isOperatorNoteSending, isOperatorNoteConfirming, setNodes]);

    useEffect(() => {
        if (mintOperatorWalletHook.isConfirmed) {
            console.log("Mint transaction confirmed (Tx: ", mintOperatorWalletHook.transactionHash, "). Refetching graph data with delay.");
            setIsProcessingMintClick(false);
            // Add delay to allow backend to sync with blockchain
            setTimeout(() => {
                fetchGraphData();
            }, 2000);
            mintOperatorWalletHook.reset();
        }
    }, [mintOperatorWalletHook.isConfirmed, fetchGraphData, mintOperatorWalletHook.reset]);

    // Handle mint operation errors (including user cancellation)
    useEffect(() => {
        if (mintOperatorWalletHook.error) {
            console.log("Mint operation error:", mintOperatorWalletHook.error.message);
            setIsProcessingMintClick(false);
            showToast('error', mintOperatorWalletHook.error.message);
        }
    }, [mintOperatorWalletHook.error]);

    useEffect(() => {
        if (isOperatorNoteConfirmed) {
            console.log("Set Note transaction confirmed (Tx: ", operatorNoteTxHash, "). Refetching graph data with delay.");
            // Add delay to allow backend to sync with blockchain
            setTimeout(() => {
                fetchGraphData();
            }, 2000);
            resetOperatorNoteHook();
        }
    }, [isOperatorNoteConfirmed, operatorNoteTxHash, fetchGraphData, resetOperatorNoteHook]);

    useEffect(() => {
        if (revokePaymasterHook.isConfirmed) {
            console.log("Paymaster revoke transaction confirmed (Tx: ", revokePaymasterHook.transactionHash, "). Refetching graph data with delay.");
            // Add delay to allow backend to sync with blockchain
            setTimeout(() => {
                fetchGraphData();
            }, 2000);
            revokePaymasterHook.reset();
        }
    }, [revokePaymasterHook.isConfirmed, revokePaymasterHook.transactionHash, fetchGraphData, revokePaymasterHook.reset]);

    const handleNodeClick = useCallback(async (_event: React.MouseEvent, node: Node) => {
        console.log('Node clicked: ', node);

        if (node.type === 'mintOperatorWalletActionNode' && node.data) {
            console.log("Mint Action Clicked. Data:", node.data);
            const ownerNodeName = (node.data as any)['ownerNodeName'];
            const subLabelToMintForGrid = "grid-wallet";
            if (!ownerNodeName) {
                console.error("Mint Action: Owner node name not found in node data.");
                showToast('error', "Configuration error: Owner node name missing.");
                return;
            }
            const parentOwnerNode = nodes.find(n => n.type === 'ownerNode' && (n.data as any)?.name === ownerNodeName);
            if (!parentOwnerNode) {
                console.error(`Mint Action: OwnerNode for '${ownerNodeName}' not found in graph nodes. Current nodes:`, nodes);
                showToast('error', `Runtime error: Could not find graph data for parent ${ownerNodeName}.`);
                return;
            }
            const parentTbaAddress = (parentOwnerNode.data as any)?.tbaAddress as Address | undefined;
            if (!parentTbaAddress) {
                console.error(`Mint Action: TBA for parent node '${ownerNodeName}' not found. Parent node data:`, parentOwnerNode.data);
                showToast('error', `Configuration error: TBA for parent node '${ownerNodeName}' is missing.`);
                return;
            }

            // Now we have everything we need to mint
            console.log(`Mint Action: Ready to mint '${subLabelToMintForGrid}' under parent TBA ${parentTbaAddress}`);

            if (!connectedAddress) {
                showToast('error', 'Please connect your wallet to mint.');
                return;
            }

            setIsProcessingMintClick(true);

            // Call the mint function
            mintOperatorWalletHook.mint({
                parentTbaAddress: parentTbaAddress,
                ownerOfNewSubTba: connectedAddress, // The connected wallet will own the new operator wallet
                subLabelToMint: subLabelToMintForGrid,
                implementationForNewSubTba: DEFAULT_OPERATOR_TBA_IMPLEMENTATION,
            });
        } else if (node.type === 'addHotWalletActionNode' && node.data) {
            console.log("AddHotWalletActionNode (Manage Hot Wallets) clicked. Data:", node.data);
            // No modal, content is inline
        } else if (node.type === 'addAuthorizedClientActionNode' && node.data) {
            const actionNodeData = node.data as any;
            const actionId = actionNodeData.actionId;
            if (actionId === 'trigger_add_client_modal') {
                const targetHotWallet = actionNodeData.targetHotWalletAddress as Address | undefined;
                if (targetHotWallet) {
                    setHotWalletAddressForShimModal(targetHotWallet);
                    setIsShimApiConfigModalOpen(true);
                } else {
                    showToast('error', "Configuration error: Action node for authorizing client is missing target_hot_wallet_address.");
                }
            }
        } else if (node.type === 'authorizedClientNode' && node.data) {
            // Handle clicks on authorized client nodes
            const clientData = node.data as IAuthorizedClientNodeData;
            console.log("Authorized Client Node clicked. Data:", clientData);
            setSelectedAuthorizedClient({
                clientId: clientData.clientId,
                clientName: clientData.clientName,
                hotWalletAddress: clientData.associatedHotWalletAddress
            });
            setIsAuthorizedClientModalOpen(true);
        }
    }, [nodes, connectedAddress, mintOperatorWalletHook, setHotWalletAddressForShimModal, setIsShimApiConfigModalOpen, DEFAULT_OPERATOR_TBA_IMPLEMENTATION, fetchGraphData, showToast]);

    const handleWalletNodeUpdate = useCallback((_walletAddress: Address) => {
        console.log(`Wallet ${_walletAddress} was updated, refreshing graph data.`);
        fetchGraphData();
    }, [fetchGraphData]);

    const handleOpenHistoryModal = useCallback((walletAddress: Address) => {
        setSelectedWalletForHistory(walletAddress);
        setIsHistoryModalOpen(true);
    }, []);

    const handleCloseHistoryModal = useCallback(() => {
        setIsHistoryModalOpen(false);
        setSelectedWalletForHistory(null);
    }, []);

    const handleOpenHotWalletSettingsModal = useCallback((walletData: IHotWalletNodeData) => {
        setSelectedWalletForSettings(walletData);
        setIsHotWalletSettingsModalOpen(true);
    }, []);

    const handleCloseHotWalletSettingsModal = useCallback(() => {
        setIsHotWalletSettingsModalOpen(false);
        setSelectedWalletForSettings(null);
    }, []);

    const handleOpenAuthorizedClientSettingsModal = useCallback((clientData: IAuthorizedClientNodeData) => {
        setSelectedAuthorizedClient({
            clientId: clientData.clientId,
            clientName: clientData.clientName,
            hotWalletAddress: clientData.associatedHotWalletAddress
        });
        setIsAuthorizedClientModalOpen(true);
    }, []);

    // Unlock flow removed from UI

    // Lock flow removed from UI

    const handleRevokePaymaster = useCallback(async (operatorTbaAddress: Address) => {
        if (!operatorTbaAddress) {
            showToast('error', 'No operator TBA address provided');
            return;
        }

        try {
            console.log('Revoking paymaster approval for TBA:', operatorTbaAddress);
            revokePaymasterHook.revokePaymaster({ operatorTbaAddress });
        } catch (err: any) {
            showToast('error', err.message || 'Failed to revoke paymaster.');
        }
    }, [revokePaymasterHook, showToast]);

    const nodeTypes = useMemo(() => ({
        ownerNode: OriginalOwnerNodeComponent,
        operatorWalletNode: OriginalOperatorWalletNodeComponent,
        hotWalletNode: (props: NodeProps<IHotWalletNodeData>) => (
            <OriginalHotWalletNodeComponent
                {...props}
                onWalletDataUpdate={handleWalletNodeUpdate}
                onOpenHistoryModal={handleOpenHistoryModal}
                onOpenSettingsModal={() => handleOpenHotWalletSettingsModal(props.data)}
            />
        ),
        authorizedClientNode: (props: NodeProps<IAuthorizedClientNodeData>) => (
            <OriginalAuthorizedClientNodeComponent
                {...props}
                onOpenSettingsModal={() => handleOpenAuthorizedClientSettingsModal(props.data)}
            />
        ),
        addHotWalletActionNode: AddHotWalletActionNodeComponent,
        addAuthorizedClientActionNode: SimpleAddAuthorizedClientActionNodeComponent,
        mintOperatorWalletActionNode: MintOperatorWalletActionNodeComponent,
    }), [
        handleWalletNodeUpdate,
        handleOpenHistoryModal,
        handleOpenHotWalletSettingsModal,
        handleOpenAuthorizedClientSettingsModal
    ]);

    if (isLoadingGraph && !initialGraphData) {
        return <div className="flex gap-2 flex-col grow self-stretch place-items-center place-content-center">
            <span className="tetx-lg">Loading graph ...</span>
            <ImSpinner8 className="animate-spin" />
        </div>
    }

    if (graphDataError && !isLoadingGraph) {
        return <button
            onClick={fetchGraphData}
            className="place-self-center p-2 rounded bg-red-600 text-white hover:bg-red-700">
            Reload Graph
        </button>;
    }

    const proOptions = { hideAttribution: true };

    return (
        <ReactFlowProvider>
            <div
                className="w-full h-screen flex flex-col grow self-stretch relative"
            >
                {isLoadingGraph && <div className="p-2 text-blue-500 absolute top-0 left-0 z-10">Updating graph...</div>}

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
                    style={{ flexGrow: 1 }}
                >
                    <Controls
                        className="flex scale-150 -translate-x-1/4 -translate-y-1/4"
                        position="bottom-right"
                    />
                    <Background />
                </ReactFlow>
            </div>
            {isShimApiConfigModalOpen && hotWalletAddressForShimModal && (
                <ShimApiConfigModal
                    isOpen={isShimApiConfigModalOpen}
                    onClose={(shouldRefresh) => {
                        setIsShimApiConfigModalOpen(false);
                        setHotWalletAddressForShimModal(null);
                        if (shouldRefresh) {
                            fetchGraphData();
                        }
                    }}
                    hotWalletAddress={hotWalletAddressForShimModal}
                />
            )}
            {isHistoryModalOpen && selectedWalletForHistory && (
                <CallHistoryModal
                    isOpen={isHistoryModalOpen}
                    onClose={handleCloseHistoryModal}
                    walletAddress={selectedWalletForHistory}
                />
            )}
            {isAuthorizedClientModalOpen && selectedAuthorizedClient && (
                <AuthorizedClientConfigModal
                    isOpen={isAuthorizedClientModalOpen}
                    onClose={(shouldRefresh) => {
                        setIsAuthorizedClientModalOpen(false);
                        setSelectedAuthorizedClient(null);
                        if (shouldRefresh) {
                            fetchGraphData();
                        }
                    }}
                    clientId={selectedAuthorizedClient.clientId}
                    clientName={selectedAuthorizedClient.clientName}
                    hotWalletAddress={selectedAuthorizedClient.hotWalletAddress}
                    onClientUpdate={() => fetchGraphData()}
                />
            )}
            {isHotWalletSettingsModalOpen && selectedWalletForSettings && (
                <HotWalletSettingsModal
                    isOpen={isHotWalletSettingsModalOpen}
                    onClose={handleCloseHotWalletSettingsModal}
                    walletData={selectedWalletForSettings}
                    onWalletUpdate={handleWalletNodeUpdate}
                />
            )}
        </ReactFlowProvider>
    );
};

export default BackendDrivenHypergridVisualizerWrapper;

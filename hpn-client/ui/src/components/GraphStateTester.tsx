import React, { useState, useEffect, useMemo, useCallback } from 'react';
import BackendDrivenHpnVisualizerWrapper from './BackendDrivenHpnVisualizer';
import { 
    IHpnGraphResponse, 
    IGraphNode, 
    IGraphEdge, 
    // IGraphNodeData, // Not directly used for construction here
    IOwnerNodeData,
    IOperatorWalletNodeData,
    IHotWalletNodeData,
    IAuthorizedClientNodeData,
    IAddHotWalletActionNodeData,
    IAddAuthorizedClientActionNodeData,
    IMintOperatorWalletActionNodeData,
    IOperatorWalletFundingInfo, 
    IHotWalletFundingInfo, 
    INoteInfo 
} from '../logic/types';
import {
    useMintOperatorSubEntry,
    useSetOperatorNote,
    // viemNamehash, // Not used if not calling setNoteCall directly
    // encodeAddressArray, // Not used if not calling setNoteCall directly
    DEFAULT_OPERATOR_TBA_IMPLEMENTATION,
    // BASE_CHAIN_ID // Not strictly needed for fake signing logic, but good for context
} from '../logic/hypermapHelpers';
import { useAccount } from 'wagmi';
import type { Address, Hex } from 'viem';

interface ISimulatedAuthorizedClient extends IAuthorizedClientNodeData {
    parentHotWalletNodeId: string;
}

const GraphStateTester: React.FC = () => {
    // --- State for Test Configuration ---
    const [operatorWalletExists, setOperatorWalletExists] = useState<boolean>(false); // Start with no operator wallet
    const [accessListNoteSet, setAccessListNoteSet] = useState<boolean>(false);
    const [hotWalletLinked, setHotWalletLinked] = useState<boolean>(false); // Tracks if *any* HW is linked
    const [hotWalletIsDelegated, setHotWalletIsDelegated] = useState<boolean>(false); 
    // const [clientAuthorized, setClientAuthorized] = useState<boolean>(false); // Replaced by authorizedClientObjects

    // --- State for Simulated Graph Data ---
    const [simulatedGraph, setSimulatedGraph] = useState<IHpnGraphResponse>({ nodes: [], edges: [] });

    // --- Wagmi and Helper Hook Instantiation ---
    const { 
        mint,
        // transactionHash: actualMintTxHash, 
        // isSending: isHookSending, 
        // isConfirming: isHookConfirming, 
        // error: hookError,
        reset: resetMintHook
    } = useMintOperatorSubEntry();

    const {
        // error: setNoteHookError,
        reset: resetSetNoteHook
    } = useSetOperatorNote();

    // --- State for Simulating Mint Action ---
    const [isSimulatingMint, setIsSimulatingMint] = useState<boolean>(false);
    const [simulatedMintError, setSimulatedMintError] = useState<string | null>(null);
    const [simulatedMintTxHash, setSimulatedMintTxHash] = useState<string | null>(null);

    // --- State for Simulating Set Access List Note Action ---
    const [isSimulatingSetAccessList, setIsSimulatingSetAccessList] = useState<boolean>(false);
    const [simulatedSetAccessListError, setSimulatedSetAccessListError] = useState<string | null>(null);
    const [simulatedSetAccessListTxHash, setSimulatedSetAccessListTxHash] = useState<string | null>(null);

    // --- State for Simulating Link Hot Wallet and Set Signers Note Action ---
    const [isSimulatingLinkAndSetSigners, setIsSimulatingLinkAndSetSigners] = useState<boolean>(false);
    const [simulatedLinkAndSetSignersError, setSimulatedLinkAndSetSignersError] = useState<string | null>(null);
    const [simulatedLinkAndSetSignersTxHash, setSimulatedLinkAndSetSignersTxHash] = useState<string | null>(null);
    const [linkedHotWalletAddresses, setLinkedHotWalletAddresses] = useState<Address[]>([]);

    // --- State for Simulating Authorize Client Action ---
    const [authorizedClientObjects, setAuthorizedClientObjects] = useState<ISimulatedAuthorizedClient[]>([]);
    const [isSimulatingAuthorizeClient, setIsSimulatingAuthorizeClient] = useState<boolean>(false);
    const [simulatedAuthorizeClientError, setSimulatedAuthorizeClientError] = useState<string | null>(null);
    const [simulatedAuthorizeClientStatus, setSimulatedAuthorizeClientStatus] = useState<string | null>(null);


    // --- Simulated Mint Handler ---
    const handleSimulatedMint = useCallback(() => {
        console.log("handleSimulatedMint called");
        setIsSimulatingMint(true);
        setSimulatedMintError(null);
        setSimulatedMintTxHash(null);
        // resetMintHook(); // Still good to reset UI state of the hook if it was used

        // const mockOwnerAddress = connectedAccount || '0xMOCKOWNER00000000000000000000000000000000' as Address;
        // const operatorSubLabel = "hpn-beta-wallet"; // Standard label

        // REMOVE: mint({ ... });

        // Simulate the async nature and outcome
        setTimeout(() => {
            // Since we are not calling mint(), hookError won't be populated by a contract call error
            // We could introduce a random mock error here if needed for testing UI error states
            console.log("Simulating mint success...");
            setOperatorWalletExists(true); // Transition the graph state
            setSimulatedMintTxHash(`0xSIMMINT${Date.now().toString(16)}`);
            setIsSimulatingMint(false);
        }, 1500); // Simulate 1.5 second delay

    }, [resetMintHook, /*connectedAccount - remove mint, hookError */]);

    // --- Simulated Set Access List Note Handler ---
    const handleSimulatedSetAccessListNote = useCallback(() => {
        console.log("handleSimulatedSetAccessListNote called");
        setIsSimulatingSetAccessList(true);
        setSimulatedSetAccessListError(null);
        setSimulatedSetAccessListTxHash(null);
        // resetSetNoteHook(); // Still good to reset UI state of the hook
        setTimeout(() => {
            console.log("Simulating set access list note success...");
            setAccessListNoteSet(true);
            setSimulatedSetAccessListTxHash(`0xSIMACCESSLIST${Date.now().toString(16)}`);
            setIsSimulatingSetAccessList(false);
        }, 1500); 
    }, [resetSetNoteHook /* remove setNoteCall, setNoteHookError */]);

    // --- Simulated Link Hot Wallet and Set Signers Note Handler ---
    const handleSimulatedLinkHotWalletAndSetSignersNote = useCallback(() => {
        setIsSimulatingLinkAndSetSigners(true);
        setSimulatedLinkAndSetSignersError(null);
        setSimulatedLinkAndSetSignersTxHash(null);
        
        const randomHex = Array(40).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('');
        const newHotWallet = `0x${randomHex}` as Address;
        const updatedHotWallets = [...linkedHotWalletAddresses, newHotWallet];
        setLinkedHotWalletAddresses(updatedHotWallets); 

        setTimeout(() => {
            setHotWalletLinked(true); // Mark that at least one HW is now linked
            setSimulatedLinkAndSetSignersTxHash(`0xSIMSIGNERS${Date.now().toString(16)}`);
            setIsSimulatingLinkAndSetSigners(false);
        }, 1500);
    }, [resetSetNoteHook, linkedHotWalletAddresses /* remove encodeAddressArray, setNoteCall, setNoteHookError */]);

    // --- Simulated Authorize Client Handler ---
    const handleSimulatedAuthorizeClient = useCallback((targetHotWalletAddress: Address, parentHotWalletNodeId: string) => {
        console.log(`handleSimulatedAuthorizeClient called for HW: ${targetHotWalletAddress} (Node ID: ${parentHotWalletNodeId})`);
        setIsSimulatingAuthorizeClient(true);
        setSimulatedAuthorizeClientError(null);
        setSimulatedAuthorizeClientStatus("Authorizing client...");

        setTimeout(() => {
            const newClientId = `sim-client-${Date.now().toString(36)}`;
            const newClientName = `Simulated Client ${authorizedClientObjects.length + 1}`;
            
            const newClient: ISimulatedAuthorizedClient = {
                type: "AuthorizedClientNode", // Ensure this matches type for node component
                clientId: newClientId,
                clientName: newClientName,
                associatedHotWalletAddress: targetHotWalletAddress,
                parentHotWalletNodeId: parentHotWalletNodeId,
            };

            setAuthorizedClientObjects(prevClients => [...prevClients, newClient]);
            setSimulatedAuthorizeClientStatus(`Client ${newClientName} authorized for ${targetHotWalletAddress.substring(0,10)}...`);
            setIsSimulatingAuthorizeClient(false);
        }, 1500);
    }, [authorizedClientObjects]);


    const { address: connectedAccount } = useAccount(); 
    // --- Logic to build the graph based on test configuration ---
    useEffect(() => {
        const nodes: IGraphNode[] = [];
        const edges: IGraphEdge[] = [];
        let yPos = 0;
        const xPos = 100;
        const yIncrement = 180;
        const clientXOffset = 300; // How far to the right client nodes appear from HW
        const clientYIncrement = 100;


        // 1. Owner Node (Always exists)
        const ownerNodeId = "owner-node";
        const ownerNodeData: IOwnerNodeData = {
            type: "OwnerNode",
            name: "test-owner.os",
            tbaAddress: "0xOWNER_TBA_PLACEHOLDER", // Replace if/when owner TBA is part of simulation
            ownerAddress: connectedAccount || "0xOWNER_WALLET_PLACEHOLDER"
        };
        nodes.push({ 
            id: ownerNodeId, 
            type: "ownerNode", 
            data: ownerNodeData,
            position: { x: xPos, y: yPos }
        });
        yPos += yIncrement;

        if (operatorWalletExists) {
            const operatorWalletNodeId = "operator-wallet-node";
            const operatorTbaPlaceholder = `0xSIMOP${Array(35).fill('0').join('')}${ownerNodeData.name.length}` as Address; // Example unique mock OpTBA
            const opWalletFunding: IOperatorWalletFundingInfo = { 
                needsEth: false, 
                needsUsdc: false, 
                ethBalanceStr: "1.0",
                usdcBalanceStr: "1000"
            };
            const signersNoteInfo: INoteInfo = { 
                // Updated to reflect linkedHotWalletAddresses.length > 0, not hotWalletIsDelegated directly for this text
                statusText: linkedHotWalletAddresses.length > 0 ? "Set Correctly" : "Missing/Incorrect", 
                isSet: linkedHotWalletAddresses.length > 0, 
                actionNeeded: !(linkedHotWalletAddresses.length > 0)
            };
            const currentAccessListNoteInfo: INoteInfo = { 
                statusText: accessListNoteSet ? "Set Correctly" : "Missing/Incorrect", 
                isSet: accessListNoteSet, 
                actionNeeded: !accessListNoteSet 
            };
            
            const operatorWalletData: IOperatorWalletNodeData = {
                type: "OperatorWalletNode",
                name: `hpn-beta-wallet.${ownerNodeData.name}`,
                tbaAddress: operatorTbaPlaceholder,
                fundingStatus: opWalletFunding,
                signersNote: signersNoteInfo,
                accessListNote: currentAccessListNoteInfo,
            };
            nodes.push({
                id: operatorWalletNodeId,
                type: "operatorWalletNode",
                data: operatorWalletData,
                position: { x: xPos, y: yPos }
            });
            edges.push({ id: `e-${ownerNodeId}-${operatorWalletNodeId}`, source: ownerNodeId, target: operatorWalletNodeId });
            yPos += yIncrement;

            const addHwActionId = "action-add-hw";
            const addHwActionNodeSpecificData: IAddHotWalletActionNodeData = {
                type: "AddHotWalletActionNode",
                label: isSimulatingLinkAndSetSigners 
                    ? "Linking Wallet & Setting Signers..." 
                    : `Manage/Link Hot Wallets (${linkedHotWalletAddresses.length} linked)`,
                operatorTbaAddress: operatorWalletData.tbaAddress,
                actionId: "trigger_manage_wallets_modal" // This ID is for generic click handler if onClick isn't used
            };
            const addHwNodeDataForFlow = {
                ...addHwActionNodeSpecificData,
                onClick: handleSimulatedLinkHotWalletAndSetSignersNote,
                disabled: isSimulatingLinkAndSetSigners || !accessListNoteSet, 
            };

            nodes.push({
                id: addHwActionId,
                type: "addHotWalletActionNode",
                data: addHwNodeDataForFlow,
                position: { x: xPos, y: yPos }
            });
            edges.push({ id: `e-${operatorWalletNodeId}-${addHwActionId}`, source: operatorWalletNodeId, target: addHwActionId, styleType: "dashed", animated: true });

            if (linkedHotWalletAddresses.length > 0) {
                // --- Tree Layout Logic for Hot Wallets ---
                const numHotWallets = linkedHotWalletAddresses.length;
                const individualHotWalletBranchWidth = 400; // Increased width for each "branch"
                const totalHotWalletGroupWidth = numHotWallets * individualHotWalletBranchWidth;

                // Calculate starting X to center the group of hot wallets under `xPos` (OperatorWallet/AddHwAction node)
                const startXForHotWallets = xPos - (totalHotWalletGroupWidth / 2) + (individualHotWalletBranchWidth / 2);
                
                const yPosForHotWallets = yPos + yIncrement; // Increased vertical space below AddHwAction
                const yPosForAddClientActions = yPosForHotWallets + yIncrement; // Increased space below HW node
                const yPosStartForClients = yPosForAddClientActions + yIncrement; // Increased space before first client
                const clientNodeVerticalSpacing = 120; // Increased from clientYIncrement (100)

                linkedHotWalletAddresses.forEach((hwAddress, index) => {
                    const currentHotWalletX = startXForHotWallets + (index * individualHotWalletBranchWidth);
                    const hotWalletNodeId = `hot-wallet-node-${hwAddress}`;
                    const clientsForThisHW = authorizedClientObjects.filter(c => c.parentHotWalletNodeId === hotWalletNodeId);

                    const hwFunding: IHotWalletFundingInfo = { needsEth: !hotWalletIsDelegated, ethBalanceStr: hotWalletIsDelegated ? "1 ETH" : "0 ETH" }; 
                    const hotWalletData: IHotWalletNodeData = {
                        type: "HotWalletNode",
                        address: hwAddress, 
                        name: `Simulated Hot Wallet ${index + 1}`,
                        statusDescription: hotWalletIsDelegated ? "Delegated & Funded" : "Needs Delegation/Funding", 
                        isActiveInMcp: true,
                        fundingInfo: hwFunding,
                        authorizedClients: clientsForThisHW.map(c => c.clientId) 
                    };
                    nodes.push({
                        id: hotWalletNodeId,
                        type: "hotWalletNode",
                        data: hotWalletData,
                        position: { x: currentHotWalletX, y: yPosForHotWallets } 
                    });
                    edges.push({ id: `e-${operatorWalletNodeId}-${hotWalletNodeId}`, source: operatorWalletNodeId, target: hotWalletNodeId });
                    
                    const addClientActionNodeId = `action-add-client-${hotWalletNodeId}`;
                    const addClientActionNodeSpecificData: IAddAuthorizedClientActionNodeData = {
                        type: "AddAuthorizedClientActionNode",
                        label: `Create API Client (${clientsForThisHW.length})`, 
                        targetHotWalletAddress: hwAddress,
                        actionId: `trigger_add_client_for_${hwAddress}`
                    };
                    const addClientNodeDataForFlow = {
                        ...addClientActionNodeSpecificData,
                        onClick: () => handleSimulatedAuthorizeClient(hwAddress, hotWalletNodeId),
                        disabled: isSimulatingAuthorizeClient
                    };

                    nodes.push({
                        id: addClientActionNodeId,
                        type: "addAuthorizedClientActionNode",
                        data: addClientNodeDataForFlow, 
                        position: { x: currentHotWalletX, y: yPosForAddClientActions } 
                    });
                    edges.push({ id: `e-${hotWalletNodeId}-${addClientActionNodeId}`, source: hotWalletNodeId, target: addClientActionNodeId, styleType: "dashed", animated: true });

                    // Client nodes will be stacked under their AddClientAction node
                    clientsForThisHW.forEach((client, clientIndex) => {
                        const clientNodeId = client.clientId;
                        nodes.push({
                            id: clientNodeId,
                            type: "authorizedClientNode",
                            data: client,
                            position: { x: currentHotWalletX, y: yPosStartForClients + (clientIndex * clientNodeVerticalSpacing) }
                        });
                        edges.push({id: `e-${hotWalletNodeId}-${clientNodeId}`, source: hotWalletNodeId, target: clientNodeId }); 
                    });
                });
            }
        } else { // Operator wallet does not exist
            const mintOpActionId = "action-mint-op";
            const mintOpActionNodeSpecificData: IMintOperatorWalletActionNodeData = {
                type: "MintOperatorWalletActionNode",
                label: isSimulatingMint ? "Creating Operator Wallet..." : "Create Operator Wallet",
                ownerNodeName: ownerNodeData.name, // from ownerNodeData
                actionId: "trigger_mint_operator_wallet",
            };
            const mintOpNodeDataForFlow = { // Data for React Flow
                ...mintOpActionNodeSpecificData,
                onClick: handleSimulatedMint,
                disabled: isSimulatingMint,
            };

            nodes.push({
                id: mintOpActionId,
                type: "mintOperatorWalletActionNode",
                data: mintOpNodeDataForFlow,
                position: { x: xPos, y: yPos }
            });
            edges.push({ id: `e-${ownerNodeId}-${mintOpActionId}`, source: ownerNodeId, target: mintOpActionId, styleType: "dashed", animated: true });
        }

        setSimulatedGraph({ nodes, edges });

    }, [
        operatorWalletExists, accessListNoteSet, hotWalletLinked, hotWalletIsDelegated, 
        connectedAccount, 
        isSimulatingMint, 
        isSimulatingLinkAndSetSigners, linkedHotWalletAddresses,
        isSimulatingAuthorizeClient, authorizedClientObjects, // Added new state dependencies
        handleSimulatedLinkHotWalletAndSetSignersNote, handleSimulatedMint, handleSimulatedAuthorizeClient // Added handlers
    ]);

    // Reset dependent states when higher-level states are toggled off
    useEffect(() => { 
        if (!operatorWalletExists) { 
            setAccessListNoteSet(false); 
            setHotWalletLinked(false); 
            setLinkedHotWalletAddresses([]); 
            setAuthorizedClientObjects([]); // Clear clients
        }
    }, [operatorWalletExists]);
    useEffect(() => { 
        if (!accessListNoteSet) { 
            setHotWalletLinked(false); 
            setLinkedHotWalletAddresses([]); 
            setAuthorizedClientObjects([]); // Clear clients
        }
    }, [accessListNoteSet]);
    useEffect(() => { 
        if (!hotWalletLinked && linkedHotWalletAddresses.length === 0) { // Clear if no HWs are linked
            setAuthorizedClientObjects([]);
        }
    }, [hotWalletLinked, linkedHotWalletAddresses]);


    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
            <div style={{ padding: '10px', background: '#f0f0f0', borderBottom: '1px solid #ccc', flexShrink: 0 }}>
                <h4>Graph State Tester Controls</h4>
                <div style={{marginBottom: '5px'}}>
                    <small>Direct State Toggles (for debug):</small><br/>
                    <label style={{marginRight: '10px'}}><input type="checkbox" checked={operatorWalletExists} onChange={(e) => setOperatorWalletExists(e.target.checked)} /> Op Wallet</label>
                    <label style={{marginRight: '10px', display: operatorWalletExists ? 'inline-block' : 'none' }}><input type="checkbox" checked={accessListNoteSet} onChange={(e) => setAccessListNoteSet(e.target.checked)} disabled={!operatorWalletExists} /> AccessListNote</label>
                    <label style={{marginRight: '10px', display: accessListNoteSet ? 'inline-block' : 'none' }}><input type="checkbox" checked={hotWalletLinked && linkedHotWalletAddresses.length > 0} onChange={(e) => {
                        const isChecked = e.target.checked;
                        setHotWalletLinked(isChecked);
                        if (!isChecked) {
                            setLinkedHotWalletAddresses([]);
                            setAuthorizedClientObjects([]);
                        } else if (linkedHotWalletAddresses.length === 0) {
                            // If checking true and no addresses, simulate one link for simplicity via controls
                            handleSimulatedLinkHotWalletAndSetSignersNote();
                        }
                    }} disabled={!accessListNoteSet} /> HW Linked (${linkedHotWalletAddresses.length})</label>
                    {/* Removed hotWalletIsDelegated checkbox, clientAuthorized checkbox */}
                </div>
                <hr style={{margin: "10px 0"}}/>

                {/* Simulated Action Buttons */}
                {!operatorWalletExists && (
                     <button onClick={handleSimulatedMint} disabled={isSimulatingMint} style={{marginRight: '10px', marginBottom: '5px'}}>
                        {isSimulatingMint ? "Creating Operator Wallet..." : "1. Simulate Create Operator Wallet"}
                    </button>
                )}
                {operatorWalletExists && !accessListNoteSet && (
                    <button onClick={handleSimulatedSetAccessListNote} disabled={isSimulatingSetAccessList} style={{marginRight: '10px', marginBottom: '5px'}}>
                        {isSimulatingSetAccessList ? "Setting Access List Note..." : "2. Simulate Set Access List Note"}
                    </button>
                )}
                {operatorWalletExists && accessListNoteSet && ( // Button to link first/next HW
                    <button 
                        onClick={handleSimulatedLinkHotWalletAndSetSignersNote} 
                        disabled={isSimulatingLinkAndSetSigners || !accessListNoteSet} 
                        style={{marginRight: '10px', marginBottom: '5px'}}
                    >
                        {isSimulatingLinkAndSetSigners ? "Linking Wallet..." : `3. Simulate Link HW (${linkedHotWalletAddresses.length} linked)`}
                    </button>
                )}
                {linkedHotWalletAddresses.length > 0 && ( // Button to authorize client for the FIRST linked HW
                     <button 
                        onClick={() => {
                            if (linkedHotWalletAddresses.length > 0) { // Simplified check, assumes first HW exists if array not empty
                                const firstHwAddress = linkedHotWalletAddresses[0];
                                const firstHwNodeId = `hot-wallet-node-${firstHwAddress}`;
                                handleSimulatedAuthorizeClient(firstHwAddress, firstHwNodeId);
                            } else {
                                console.warn("No hot wallet found to authorize client against.");
                            }
                        }} 
                        disabled={isSimulatingAuthorizeClient} 
                        style={{marginRight: '10px', marginBottom: '5px'}}
                    >
                        {isSimulatingAuthorizeClient ? "Authorizing Client..." : `4. Auth Client for HW 1 (${authorizedClientObjects.filter(c => c.associatedHotWalletAddress === (linkedHotWalletAddresses.length > 0 ? linkedHotWalletAddresses[0] : '')).length} for HW1)`}
                    </button>
                )}
                
                {/* Simulation Status Displays */}
                {(isSimulatingMint || simulatedMintTxHash || simulatedMintError) && (
                    <div style={{marginTop: '10px', padding: '5px', border: '1px solid #ddd', background: '#fafafa'}}>
                        {isSimulatingMint && <p><strong>Minting...</strong></p>}
                        {simulatedMintTxHash && <p style={{color: 'green'}}>Mint Tx: {simulatedMintTxHash}</p>}
                        {simulatedMintError && <p style={{color: 'red'}}>Mint Error: {simulatedMintError}</p>}
                    </div>
                )}
                {(isSimulatingSetAccessList || simulatedSetAccessListTxHash || simulatedSetAccessListError) && (
                    <div style={{marginTop: '5px', padding: '5px', border: '1px solid #ddd', background: '#fafafa'}}>
                        {isSimulatingSetAccessList && <p><strong>Setting Access List Note...</strong></p>}
                        {simulatedSetAccessListTxHash && <p style={{color: 'green'}}>Access List Note Tx: {simulatedSetAccessListTxHash}</p>}
                        {simulatedSetAccessListError && <p style={{color: 'red'}}>Access List Note Error: {simulatedSetAccessListError}</p>}
                    </div>
                )}
                {(isSimulatingLinkAndSetSigners || simulatedLinkAndSetSignersTxHash || simulatedLinkAndSetSignersError) && (
                    <div style={{marginTop: '5px', padding: '5px', border: '1px solid #ddd', background: '#fafafa'}}>
                        {isSimulatingLinkAndSetSigners && <p><strong>Linking Wallet & Setting Signers Note...</strong></p>}
                        {simulatedLinkAndSetSignersTxHash && <p style={{color: 'green'}}>Link & Signers Note Tx: {simulatedLinkAndSetSignersTxHash}</p>}
                        {simulatedLinkAndSetSignersError && <p style={{color: 'red'}}>Link & Signers Note Error: {simulatedLinkAndSetSignersError}</p>}
                    </div>
                )}
                {(isSimulatingAuthorizeClient || simulatedAuthorizeClientStatus || simulatedAuthorizeClientError) && (
                     <div style={{marginTop: '5px', padding: '5px', border: '1px solid #ddd', background: '#fafafa'}}>
                        {isSimulatingAuthorizeClient && <p><strong>Authorizing Client...</strong></p>}
                        {simulatedAuthorizeClientStatus && !isSimulatingAuthorizeClient && <p style={{color: 'green'}}>{simulatedAuthorizeClientStatus}</p>}
                        {simulatedAuthorizeClientError && <p style={{color: 'red'}}>Auth Client Error: {simulatedAuthorizeClientError}</p>}
                    </div>
                )}
            </div>
            <div style={{ flexGrow: 1, border: '1px solid blue' }}>
                <BackendDrivenHpnVisualizerWrapper initialGraphData={simulatedGraph} />
            </div>
        </div>
    );
};

export default GraphStateTester; 
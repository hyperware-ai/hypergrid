/**
 * Example of how to integrate Hypergrid operator initialization into node boot process
 * This shows how to combine it with existing networking setup calls
 */

import { 
    encodeFunctionData, 
    encodePacked, 
    stringToHex, 
    type Address,
    type Hex 
} from 'viem';

import {
    generateOperatorSubEntryMintCall,
    generateAccessListNoteCall,
    HYPERMAP_ADDRESS,
    MULTICALL_ADDRESS,
    hypermapAbi,
    multicallAbi,
    tbaExecuteAbi,
} from './hypergridInitHelpers';

/**
 * Enhanced node initialization that includes Hypergrid operator setup
 */
export const generateNodeInitWithHypergrid = async ({
    // Existing params for networking
    direct,
    our_address,
    label,
    setNetworkingKey,
    setIpAddress,
    setWsPort,
    setTcpPort,
    setRouters,
    reset,
    // New params for Hypergrid
    includeHypergrid = true,
    operatorWalletOwner, // Who will own the operator wallet (usually same as our_address)
}: {
    direct: boolean;
    label: string;
    our_address: Address;
    setNetworkingKey: (networkingKey: string) => void;
    setIpAddress: (ipAddress: number) => void;
    setWsPort: (wsPort: number) => void;
    setTcpPort: (tcpPort: number) => void;
    setRouters: (routers: string[]) => void;
    reset: boolean;
    includeHypergrid?: boolean;
    operatorWalletOwner?: Address;
}) => {
    // 1. Generate networking info (existing logic)
    const networkingInfo = await fetch("/generate-networking-info", { method: "POST" })
        .then(res => res.json());
    
    // ... (networking setup code here) ...
    
    // 2. Build the calls array
    const calls = [];
    
    // Add networking calls (simplified for example)
    calls.push(
        { 
            target: HYPERMAP_ADDRESS, 
            callData: encodeFunctionData({
                abi: hypermapAbi,
                functionName: 'note',
                args: [
                    encodePacked(["bytes"], [stringToHex("~net-key")]),
                    encodePacked(["bytes"], [networkingInfo.networking_key as Hex]),
                ]
            })
        },
        // ... other networking calls ...
    );
    
    // 3. Add Hypergrid operator initialization if requested
    if (includeHypergrid) {
        const operatorOwner = operatorWalletOwner || our_address;
        
        // Mint the hpn-grid-beta operator wallet
        calls.push({
            target: HYPERMAP_ADDRESS,
            callData: generateOperatorSubEntryMintCall({
                ownerOfNewSubTba: operatorOwner,
                subLabelToMint: 'hpn-grid-beta', // This creates label.hpn-grid-beta
            })
        });
        
        // Set the ~access-list note
        // The operator entry name is the full node name (e.g., "my-node.os")
        calls.push({
            target: HYPERMAP_ADDRESS,
            callData: generateAccessListNoteCall({
                operatorEntryName: label, // Using the node's label as the operator entry name
            })
        });
    }
    
    // 4. Encode the multicall
    const multicallData = encodeFunctionData({
        abi: multicallAbi,
        functionName: 'aggregate',
        args: [calls]
    });
    
    if (reset) return multicallData;
    
    // 5. Wrap in TBA execute for initialization
    const initCall = encodeFunctionData({
        abi: tbaExecuteAbi,
        functionName: 'execute',
        args: [
            MULTICALL_ADDRESS,
            BigInt(0),
            multicallData,
            1 // DELEGATECALL for init
        ]
    });
    
    return initCall;
};

/**
 * Usage in the minting component:
 */
export async function mintNodeWithHypergrid({
    address,
    nodeName,
}: {
    address: Address;
    nodeName: string;
}) {
    // Generate the init call with Hypergrid setup included
    const initCall = await generateNodeInitWithHypergrid({
        direct: false, // or whatever your networking setup needs
        our_address: address,
        label: nodeName,
        setNetworkingKey: () => {}, // These would be real state setters
        setIpAddress: () => {},
        setWsPort: () => {},
        setTcpPort: () => {},
        setRouters: () => {},
        reset: false,
        includeHypergrid: true, // Enable Hypergrid operator setup
        operatorWalletOwner: address, // The minter will own the operator wallet
    });
    
    // Now use this initCall when minting the node
    // (similar to how MintDotOsName does it)
    return {
        abi: hypermapAbi,
        functionName: 'mint',
        args: [
            address,
            encodePacked(["bytes"], [stringToHex(nodeName)]),
            initCall, // This includes all networking + hypergrid setup
            '0x...', // Your node TBA implementation address
        ]
    };
} 
import { Address, encodeFunctionData, Hex, encodePacked, stringToHex } from 'viem';
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { useCallback, useMemo } from 'react';
import { hypermapAbi, tbaExecuteAbi, prepareTbaExecuteArgs, HYPERMAP_ADDRESS, BASE_CHAIN_ID, OLD_TBA_IMPLEMENTATION, NEW_TBA_IMPLEMENTATION, DEFAULT_OPERATOR_TBA_IMPLEMENTATION } from './hypermapHelpers';

// Re-export the implementation constants for convenience
export { OLD_TBA_IMPLEMENTATION, NEW_TBA_IMPLEMENTATION, DEFAULT_OPERATOR_TBA_IMPLEMENTATION, HYPERMAP_ADDRESS, BASE_CHAIN_ID, hypermapAbi, tbaExecuteAbi } from './hypermapHelpers';

// Constants
export const HYPERGRID_ACCESS_LIST_NOTE_KEY = "~access-list";
export const HYPERGRID_SIGNERS_NOTE_KEY = "~grid-beta-signers";

// ABIs
//export const hypermapAbi = parseAbi([
//    'function mint(address owner, bytes calldata node, bytes calldata data, address implementation) external returns (address tba)',
//    'function note(bytes calldata noteKey, bytes calldata noteValue) external returns (bytes32 labelhash)',
//]);
//
//export const tbaExecuteAbi = parseAbi([
//    'function execute(address target, uint256 value, bytes calldata data, uint8 operation) returns (bytes memory returnData)',
//]);
//
//export const multicallAbi = parseAbi([
//    'function aggregate(Call[] calls) external payable returns (uint256 blockNumber, bytes[] returnData)',
//    'struct Call { address target; bytes callData; }',
//]);

/**
 * Generates the calldata for minting an operator sub-entry (hpn-grid-beta wallet)
 * This creates the mint call that the parent TBA will execute
 */
//export function generateOperatorSubEntryMintCall({
//    ownerOfNewSubTba,
//    subLabelToMint = 'hpn-grid-beta',
//    implementationForNewSubTba = DEFAULT_OPERATOR_TBA_IMPLEMENTATION,
//}: {
//    ownerOfNewSubTba: Address;
//    subLabelToMint?: string;
//    implementationForNewSubTba?: Address;
//}): Hex {
//    return encodeFunctionData({
//        abi: hypermapAbi,
//        functionName: 'mint',
//        args: [
//            ownerOfNewSubTba,
//            encodePacked(["bytes"], [stringToHex(subLabelToMint)]),
//            "0x", // initializationData for the new sub-TBA
//            implementationForNewSubTba,
//        ]
//    });
//}

/**
 * Generates the calldata for setting the ~access-list note
 * The value is the namehash of '~grid-beta-signers.OPERATOR_ENTRY_NAME'
 */
//export function generateAccessListNoteCall({
//    operatorEntryName,
//}: {
//    operatorEntryName: string;
//}): Hex {
//    const signersNotePath = `${HYPERGRID_SIGNERS_NOTE_KEY}.${operatorEntryName}`;
//    const valueToStore = stringToHex(signersNotePath); // Changed to stringToHex
//    
//    return encodeFunctionData({
//        abi: hypermapAbi,
//        functionName: 'note',
//        args: [
//            encodePacked(["bytes"], [stringToHex(HYPERGRID_ACCESS_LIST_NOTE_KEY)]),
//            encodePacked(["bytes"], [valueToStore]),
//        ]
//    });
//}

/**
 * Wraps a call in a TBA execute call
 * Used when the parent TBA needs to make the call
 */
//export function wrapInTbaExecute({
//    targetContract,
//    callData,
//    value = 0n,
//    operation = 0,
//}: {
//    targetContract: Address;
//    callData: Hex;
//    value?: bigint;
//    operation?: number;
//}): Hex {
//    return encodeFunctionData({
//        abi: tbaExecuteAbi,
//        functionName: 'execute',
//        args: [targetContract, value, callData, operation]
//    });
//}

/**
 * Generates a complete multicall for initializing a hypergrid operator
 * This includes:
 * 1. Minting the hpn-grid-beta operator wallet
 * 2. Setting the ~access-list note
 * 
 * @param parentTbaAddress - The TBA that will execute these calls (e.g., the node's identity)
 * @param ownerOfOperatorWallet - The address that will own the new operator wallet
 * @param operatorEntryName - The name for the operator entry (used in access-list value)
 * @returns The encoded multicall data
 */
//export function generateHypergridOperatorInitMulticall({
//    ownerOfOperatorWallet,
//    operatorEntryName,
//}: {
//    ownerOfOperatorWallet: Address;
//    operatorEntryName: string;
//}): Hex {
//    // 1. Generate the mint call for the operator sub-entry
//    const mintOperatorCall = generateOperatorSubEntryMintCall({
//        ownerOfNewSubTba: ownerOfOperatorWallet,
//        subLabelToMint: 'hpn-grid-beta',
//    });
//
//    // 2. Generate the access-list note call
//    const accessListNoteCall = generateAccessListNoteCall({
//        operatorEntryName,
//    });
//
//    // 3. Create the multicall
//    const calls = [
//        { target: HYPERMAP_ADDRESS, callData: mintOperatorCall },
//        { target: HYPERMAP_ADDRESS, callData: accessListNoteCall },
//    ];
//
//    return encodeFunctionData({
//        abi: multicallAbi,
//        functionName: 'aggregate',
//        args: [calls]
//    });
//}

/**
 * If the multicall needs to be executed by a TBA (not directly),
 * wrap it in a TBA execute call
 */
//export function generateTbaExecutedHypergridInit({
//    parentTbaAddress,
//    ownerOfOperatorWallet,
//    operatorEntryName,
//}: {
//    parentTbaAddress: Address;
//    ownerOfOperatorWallet: Address; 
//    operatorEntryName: string;
//}): Hex {
//    const multicallData = generateHypergridOperatorInitMulticall({
//        ownerOfOperatorWallet,
//        operatorEntryName,
//    });
//
//    return wrapInTbaExecute({
//        targetContract: MULTICALL_ADDRESS,
//        callData: multicallData,
//        value: 0n,
//        operation: 0, // CALL
//    });
//}

/**
 * Example usage in external codebase:
 * 
 * // During node initialization, add hypergrid operator setup to your multicall:
 * 
 * import { generateOperatorSubEntryMintCall, generateAccessListNoteCall } from './hypergridInitHelpers';
 * 
 * const hypergridCalls = [
 *     { target: HYPERMAP_ADDRESS, callData: generateOperatorSubEntryMintCall({ ownerOfNewSubTba: nodeOwnerAddress }) },
 *     { target: HYPERMAP_ADDRESS, callData: generateAccessListNoteCall({ operatorEntryName: 'my-node.os' }) },
 * ];
 * 
 * // Add these to your existing multicall array
 * const allCalls = [...networkingCalls, ...hypergridCalls, ...otherCalls];
 * 
 * // Or use the convenience function:
 * const initCall = generateTbaExecutedHypergridInit({
 *     parentTbaAddress: nodeTbaAddress,
 *     ownerOfOperatorWallet: nodeOwnerAddress,
 *     operatorEntryName: 'my-node.os',
 * });
 */ 
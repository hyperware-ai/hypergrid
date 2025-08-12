import { useWriteContract, useAccount, useChainId, useWaitForTransactionReceipt } from 'wagmi';
import {
    encodeFunctionData,
    stringToHex,
    parseAbi,
    hexToBytes,
    Hex,
    Address,
    EncodeAbiParametersReturnType,
    encodeAbiParameters,
    parseAbiParameters,
    namehash as viemNamehash, // Using viem's namehash
    encodePacked,
} from 'viem';
import { useCallback, useMemo } from 'react';
import { HYPERMAP_ADDRESS as HYPERMAP_ADDRESS_CONST, USDC_BASE_ADDRESS } from '../constants';

// Export viemNamehash so it can be imported directly by other modules
export { viemNamehash };

// -------------------------------------------------------------------------------------------------
// Constants
// -------------------------------------------------------------------------------------------------

// Base Chain ID
export const BASE_CHAIN_ID = 8453; // Ethereum Mainnet = 1, Base = 8453

// Re-export from constants
export const HYPERMAP_ADDRESS: Address = HYPERMAP_ADDRESS_CONST as Address;

// TBA Implementation Addresses
// Old implementation (0x0000000000EDAd72076CBe7b9Cfa3751D5a85C97 was even older, now using:)
export const OLD_TBA_IMPLEMENTATION: Address = '0x000000000046886061414588bb9F63b6C53D8674'; // Works but no gasless support
//export const NEW_TBA_IMPLEMENTATION: Address = '0x19b89306e31D07426E886E3370E62555A0743D96'; // Supports ERC-4337 gasless (was faulty, no delegation)
//export const NEW_TBA_IMPLEMENTATION: Address = '0x70fAa7d49036E155B6A1889f0c856931e129CcCD'; // Supports ERC-4337 gasless (fixed) (not fixed lol)
//export const NEW_TBA_IMPLEMENTATION: Address = '0x73dFF273A33C4BCF95DE2cD8c812BF97931774Ab'; // Supports ERC-4337 gasless (not fixed)
export const NEW_TBA_IMPLEMENTATION: Address =  '0x3950D18044D7DAA56BFd6740fE05B42C95201535'; // actually fixed (final: part deux)

// Default to the new implementation for new deployments (supports gasless)
export const DEFAULT_OPERATOR_TBA_IMPLEMENTATION: Address = NEW_TBA_IMPLEMENTATION;

// ABI for the Hypermap contract (relevant functions)
export const hypermapAbi = parseAbi([
    'function mint(address owner, bytes calldata node, bytes calldata data, address implementation) external returns (address tba)',
    'function note(bytes calldata noteKey, bytes calldata noteValue) external returns (bytes32 labelhash)',
]);

// ABI for the standard 'execute' function on a Token Bound Account (TBA)
export const tbaExecuteAbi = parseAbi([
    'function execute(address target, uint256 value, bytes calldata data, uint8 operation) returns (bytes memory returnData)',
]);

// ABI for ERC20 approve function
export const erc20Abi = parseAbi([
    'function approve(address spender, uint256 amount) returns (bool)',
]);

// Note Keys for Hypergrid
export const HYPERGRID_ACCESS_LIST_NOTE_KEY = "~access-list";
export const HYPERGRID_SIGNERS_NOTE_KEY = "~grid-beta-signers";

// ERC-4337 Constants
export const HYPERWARE_PAYMASTER_ADDRESS: Address = '0x861a1Be40c595db980341e41A7a5D09C772f7c2b'; // Circle's USDC paymaster on Base
export const CIRCLE_PAYMASTER_ADDRESS: Address = '0x0578cFB241215b77442a541325d6A4E6dFE700Ec'; // Circle's USDC paymaster on Base
//export const PIMLICO_PAYMASTER_ADDRESS: Address = '0x888888888888Ec68A58AB8094Cc1AD20Ba3D2402'; // Pimlico's USDC paymaster on Base
export const USDC_ADDRESS_BASE: Address = USDC_BASE_ADDRESS as Address; // USDC on Base
export const DEFAULT_PAYMASTER_APPROVAL_AMOUNT = 100n * 10n ** 6n; // 100 USDC (with 6 decimals)
export const PAYMASTER_ADDRESS: Address = CIRCLE_PAYMASTER_ADDRESS;

// -------------------------------------------------------------------------------------------------
// Encoding Helpers
// -------------------------------------------------------------------------------------------------

/**
 * Encodes the calldata for the Hypermap 'mint' function.
 * @param owner The address that will own the newly minted TBA.
 * @param subLabel The label for the new sub-entry (e.g., "grid-wallet").
 * @param implementationAddress The address of the TBA implementation contract.
 * @param initializationData Optional data for initializing the TBA (defaults to '0x').
 * @returns The encoded function data.
 */
export function encodeHypermapMintCall({
    owner,
    subLabel,
    implementationAddress,
    initializationData = '0x',
}: {
    owner: Address;
    subLabel: string;
    implementationAddress: Address;
    initializationData?: Hex;
}): Hex {
    return encodeFunctionData({
        abi: hypermapAbi,
        functionName: 'mint',
        args: [
            owner,
            stringToHex(subLabel), // The label of the sub-node to mint relative to msg.sender's owned parent node. :)
            initializationData,
            implementationAddress,
        ],
    });
}

/**
 * Encodes the calldata for the Hypermap 'note' function.
 * @param noteKey The key of the note (e.g., "~content").
 * @param noteValue The value of the note, as hex bytes.
 * @returns The encoded function data.
 */
export function encodeHypermapNoteCall({ noteKey, noteValue }: { noteKey: string; noteValue: Hex }): Hex {
    return encodeFunctionData({
        abi: hypermapAbi,
        functionName: 'note',
        args: [stringToHex(noteKey), noteValue],
    });
}

/**
 * Encodes the arguments for a TBA's 'execute' function.
 * @param targetContract The address of the contract the TBA will call.
 * @param callData The encoded function call data for the targetContract.
 * @param value The amount of ETH to send with the call (defaults to 0n).
 * @param operation The operation type (defaults to 0 for CALL).
 * @returns The array of arguments for the 'execute' function.
 */
export function prepareTbaExecuteArgs({
    targetContract,
    callData,
    value = 0n,
    operation = 0, // 0 for CALL, 1 for DELEGATECALL
}: {
    targetContract: Address;
    callData: Hex;
    value?: bigint;
    operation?: number;
}): readonly [Address, bigint, Hex, number] {
    return [targetContract, value, callData, operation] as const;
}

/**
 * ABI-encodes an array of Ethereum addresses.
 * @param addresses Array of addresses (string or Address type).
 * @returns Hex string of the ABI-encoded address array.
 */
export function encodeAddressArray(addresses: Address[]): EncodeAbiParametersReturnType {
    return encodeAbiParameters(parseAbiParameters('address[]'), [addresses]);
}

/**
 * Encodes the calldata for ERC20 approve function.
 * @param spender The address that will be allowed to spend tokens.
 * @param amount The amount of tokens to approve (in smallest units).
 * @returns The encoded function data.
 */
export function encodeERC20Approve({
    spender,
    amount,
}: {
    spender: Address;
    amount: bigint;
}): Hex {
    return encodeFunctionData({
        abi: erc20Abi,
        functionName: 'approve',
        args: [spender, amount],
    });
}

// -------------------------------------------------------------------------------------------------
// Wagmi Interaction Hooks
// -------------------------------------------------------------------------------------------------

// Define a more accurate type for the onSuccess data based on wagmi's useWriteContract
type WriteContractSuccessData = Hex; // The transaction hash

interface UseWriteHypermapContractProps {
    onSuccess?: (data: WriteContractSuccessData) => void; 
    onError?: (error: Error) => void;
    onSettled?: (data: WriteContractSuccessData | undefined, error: Error | null) => void; 
}

/**
 * Custom hook to mint an Operator Sub-Entry (TBA) under a parent TBA (e.g., the node's own identity like pertinent.os).
 * The connected EOA calls `execute()` on the parent TBA, which in turn calls `hypermap.mint()`.
 * This follows the pattern from hypermap-explorer.
 */
export function useMintOperatorSubEntry(props?: UseWriteHypermapContractProps) {
    const { onSuccess, onError, onSettled } = props || {};

    const { data: transactionHash, error, isPending, writeContract, writeContractAsync, reset } = useWriteContract({
        mutation: {
            onSuccess: onSuccess,
            onError: onError,
            onSettled: onSettled,
        },
    });

    const { isLoading: isConfirming, isSuccess: isConfirmed, error: receiptError } =
        useWaitForTransactionReceipt({ hash: transactionHash, chainId: BASE_CHAIN_ID });

    const mintInternal = useCallback(({
        parentTbaAddress, // Address of the parent TBA (e.g., pertinent.os's TBA)
        ownerOfNewSubTba,   // EOA that will own the new sub-TBA
        subLabelToMint,     // Label for the new sub-entry (e.g., "grid-wallet" or "grid-wallet-aa")
        implementationForNewSubTba = DEFAULT_OPERATOR_TBA_IMPLEMENTATION,
    }: {
        parentTbaAddress: Address;
        ownerOfNewSubTba: Address;
        subLabelToMint: string;
        implementationForNewSubTba?: Address;
    }) => {
        if (!parentTbaAddress || !ownerOfNewSubTba || !subLabelToMint) {
            console.error("Missing parentTbaAddress, ownerOfNewSubTba, or subLabelToMint for minting.");
            const err = new Error("Missing required arguments for minting operator sub-entry.");
            if (onError) onError(err);
            // It's good practice to also throw or handle the error flow if the hook user isn't handling onError
            // For now, just logging and calling onError prop.
            return;
        }
        
        console.log(`useMintOperatorSubEntry: Preparing to mint sub-label '${subLabelToMint}'(SHOULD BE 'grid-wallet') under parent TBA ${parentTbaAddress}.`);
        console.log(`  New sub-TBA will be owned by: ${ownerOfNewSubTba}`);
        console.log(`  New sub-TBA implementation: ${implementationForNewSubTba}`);

        // Step 1: Encode the inner Hypermap.mint() call
        const innerMintCallData = encodeFunctionData({
            abi: hypermapAbi,
            functionName: 'mint',
            args: [
                ownerOfNewSubTba,
                encodePacked(["bytes"], [stringToHex(subLabelToMint)]), // Use encodePacked for the label bytes
                "0x", // initializationData for the new sub-TBA
                implementationForNewSubTba,
            ]
        });
        console.log("  Encoded inner mint call data:", innerMintCallData);

        // Step 2: Prepare arguments for parentTbaAddress.execute()
        const executeArgs = prepareTbaExecuteArgs({
            targetContract: HYPERMAP_ADDRESS, // The Hypermap contract is the target of the inner call
            callData: innerMintCallData,
            value: 0n,
            operation: 0, // Standard CALL
        });
        console.log(`  executeArgs for parent TBA (${parentTbaAddress}):`, executeArgs);

        // Step 3: Call execute() on the parentTbaAddress
        writeContract({
            address: parentTbaAddress, // Target the PARENT's TBA address
            abi: tbaExecuteAbi,        // ABI for the 'execute' function
            functionName: 'execute',
            args: executeArgs,
            chainId: BASE_CHAIN_ID,
        });
    }, [writeContract, onError]);

    return useMemo(() => ({
        mint: mintInternal,
        transactionHash,
        isSending: isPending, 
        isConfirming,
        isConfirmed,
        error: error || receiptError, 
        reset, 
    }), [mintInternal, transactionHash, isPending, isConfirming, isConfirmed, error, receiptError, reset]);
}

/**
 * Custom hook for an Operator TBA to set a note on itself via `hypermap.note()`.
 * The EOA owner of the Operator TBA calls `operatorTBA.execute(...)`.
 */
export function useSetOperatorNote(props?: UseWriteHypermapContractProps) {
    const { onSuccess, onError, onSettled } = props || {};

    const { data: transactionHash, error, isPending, writeContract, writeContractAsync, reset } = useWriteContract({
        mutation: {
            onSuccess: onSuccess,
            onError: onError,
            onSettled: onSettled,
        },
    });
    
    const { isLoading: isConfirming, isSuccess: isConfirmed, error: receiptError } =
        useWaitForTransactionReceipt({ hash: transactionHash, chainId: BASE_CHAIN_ID });

    const setNoteInternal = useCallback(({
        operatorTbaAddress,
        noteKey,
        noteValueHex, // Expecting value to be already hex-encoded (e.g. namehash or abi-encoded array)
    }: {
        operatorTbaAddress: Address;
        noteKey: string;
        noteValueHex: Hex;
    }) => {
        if (!operatorTbaAddress || !noteKey) {
            console.error("Missing operatorTbaAddress or noteKey for setting note.");
            if (onError) onError(new Error("Missing operatorTbaAddress or noteKey"));
            return;
        }

        const hypermapNoteCallData = encodeHypermapNoteCall({
            noteKey: noteKey,
            noteValue: noteValueHex,
        });

        const executeArgs = prepareTbaExecuteArgs({
            targetContract: HYPERMAP_ADDRESS,
            callData: hypermapNoteCallData,
        });
        
        console.log(`useSetOperatorNote: Setting note '${noteKey}' on TBA ${operatorTbaAddress} with value ${noteValueHex}`);
        console.log(`   -> executeArgs for TBA: [\\n    target: ${executeArgs[0]},\\n    value: ${executeArgs[1]},\\n    data: ${executeArgs[2]},\\n    operation: ${executeArgs[3]}\\n   ]`);

        writeContract({
            address: operatorTbaAddress,
            abi: tbaExecuteAbi,
            functionName: 'execute',
            args: executeArgs,
            chainId: BASE_CHAIN_ID,
        });
    }, [writeContract, onError]);
    
    // --- Specialized Hypergrid Note Setting Functions ---

    /**
     * Sets the '~access-list' note on the Operator TBA.
     * The value of this note is the namehash of '~grid-beta-signers.OPERATOR_ENTRY_NAME'.
     */
    const setAccessListNoteInternal = useCallback(({ 
        operatorTbaAddress, 
        operatorEntryName 
    }: { 
        operatorTbaAddress: Address; 
        operatorEntryName: string;
    }) => {
        if (!operatorTbaAddress || !operatorEntryName) {
            const err = new Error("Missing operatorTbaAddress or operatorEntryName for setAccessListNote");
            console.error("useSetOperatorNote.setAccessListNote:", err.message);
            if (onError) onError(err);
            return;
        }
        // The access list note stores the *namehash* of the signers note path.
        const signersNotePath = `${HYPERGRID_SIGNERS_NOTE_KEY}.${operatorEntryName}`;
        const valueToStore = viemNamehash(signersNotePath); // This is a bytes32 value

        console.log(`useSetOperatorNote.setAccessListNote: Setting note for Operator TBA ${operatorTbaAddress}`);
        console.log(`  Note Key (simple): ${HYPERGRID_ACCESS_LIST_NOTE_KEY}`);
        console.log(`  Value to store (namehash of signers note path '${signersNotePath}'): ${valueToStore}`);

        setNoteInternal({
            operatorTbaAddress,
            noteKey: HYPERGRID_ACCESS_LIST_NOTE_KEY, // Use the simple base key for the note on the TBA
            noteValueHex: valueToStore,      // The namehash of the full signers note path is the value
        });
    }, [setNoteInternal, onError]);

    /**
     * Sets the '~grid-beta-signers' note on the Operator TBA.
     * The value is an ABI-encoded address array of hot wallet addresses.
     */
    const setSignersNoteInternal = useCallback(({
        operatorTbaAddress,
        operatorEntryName, // Still useful for logging and constructing full paths for external reference
        hotWalletAddresses,
    }: {
        operatorTbaAddress: Address;
        operatorEntryName: string;
        hotWalletAddresses: Address[];
    }) => {
        if (!operatorTbaAddress || !operatorEntryName || !hotWalletAddresses) {
            const err = new Error(
                "Missing operatorTbaAddress, operatorEntryName, or hotWalletAddresses for setSignersNote"
            );
            console.error("useSetOperatorNote.setSignersNote:", err.message);
            if (onError) onError(err);
            return;
        }

        // const signersNotePath = `${HYPERGRID_SIGNERS_NOTE_KEY}.${operatorEntryName}`; // Full path for reference/logging
        const encodedAddresses = encodeAddressArray(hotWalletAddresses);

        console.log(`useSetOperatorNote.setSignersNote: Setting note for Operator TBA ${operatorTbaAddress}`);
        console.log(`  Note Key (simple): ${HYPERGRID_SIGNERS_NOTE_KEY}`);
        console.log(`  (Full conceptual path for this note would be: ${HYPERGRID_SIGNERS_NOTE_KEY}.${operatorEntryName})`);
        console.log(`  Addresses to store: ${hotWalletAddresses.join(', ')}`);
        console.log(`  ABI Encoded Addresses: ${encodedAddresses}`);

        setNoteInternal({
            operatorTbaAddress,
            noteKey: HYPERGRID_SIGNERS_NOTE_KEY, // Use the simple base key for the note on the TBA
            noteValueHex: encodedAddresses, // The ABI-encoded array of addresses
        });
    }, [setNoteInternal, onError]);

    return useMemo(() => ({
        setNote: setNoteInternal, // Generic note setter
        setAccessListNote: setAccessListNoteInternal, // Specialized for Hypergrid access list
        setSignersNote: setSignersNoteInternal,    // Specialized for Hypergrid signers list
        transactionHash,
        isSending: isPending,
        isConfirming,
        isConfirmed,
        error: error || receiptError,
        reset,
    }), [
        setNoteInternal, setAccessListNoteInternal, setSignersNoteInternal,
        transactionHash, isPending, isConfirming, isConfirmed, error, receiptError, reset
    ]);
}

/**
 * Custom hook for approving the paymaster to spend USDC from an Operator TBA.
 * This is a one-time setup step required for ERC-4337 gasless transactions.
 * The EOA owner of the Operator TBA calls `operatorTBA.execute(...)` to approve the paymaster.
 */
export function useApprovePaymaster(props?: UseWriteHypermapContractProps) {
    const { onSuccess, onError, onSettled } = props || {};

    const { data: transactionHash, error, isPending, writeContract, writeContractAsync, reset } = useWriteContract({
        mutation: {
            onSuccess: onSuccess,
            onError: onError,
            onSettled: onSettled,
        },
    });
    
    const { isLoading: isConfirming, isSuccess: isConfirmed, error: receiptError } =
        useWaitForTransactionReceipt({ hash: transactionHash, chainId: BASE_CHAIN_ID });

    const approvePaymasterInternal = useCallback(({
        operatorTbaAddress,
        paymasterAddress = PAYMASTER_ADDRESS,
        usdcAddress = USDC_ADDRESS_BASE,
        approvalAmount = DEFAULT_PAYMASTER_APPROVAL_AMOUNT,
    }: {
        operatorTbaAddress: Address;
        paymasterAddress?: Address;
        usdcAddress?: Address;
        approvalAmount?: bigint;
    }) => {
        if (!operatorTbaAddress) {
            console.error("Missing operatorTbaAddress for paymaster approval.");
            if (onError) onError(new Error("Missing operatorTbaAddress"));
            return;
        }

        console.log(`useApprovePaymaster: Approving paymaster for Operator TBA ${operatorTbaAddress}`);
        console.log(`  Paymaster: ${paymasterAddress}`);
        console.log(`  USDC Contract: ${usdcAddress}`);
        console.log(`  Approval Amount: ${approvalAmount.toString()} (smallest units)`);

        // Step 1: Encode the ERC20 approve call
        const approveCallData = encodeERC20Approve({
            spender: paymasterAddress,
            amount: approvalAmount,
        });

        // Step 2: Prepare arguments for operatorTBA.execute()
        const executeArgs = prepareTbaExecuteArgs({
            targetContract: usdcAddress,
            callData: approveCallData,
            value: 0n,
            operation: 0, // Standard CALL
        });
        
        console.log(`  executeArgs for TBA: [\n    target: ${executeArgs[0]},\n    value: ${executeArgs[1]},\n    data: ${executeArgs[2]},\n    operation: ${executeArgs[3]}\n   ]`);

        // Step 3: Call execute() on the operatorTbaAddress
        writeContract({
            address: operatorTbaAddress,
            abi: tbaExecuteAbi,
            functionName: 'execute',
            args: executeArgs,
            chainId: BASE_CHAIN_ID,
        });
    }, [writeContract, onError]);

    const revokePaymasterInternal = useCallback(({
        operatorTbaAddress,
        paymasterAddress = PAYMASTER_ADDRESS,
        usdcAddress = USDC_ADDRESS_BASE,
    }: {
        operatorTbaAddress: Address;
        paymasterAddress?: Address;
        usdcAddress?: Address;
    }) => {
        if (!operatorTbaAddress) {
            console.error("Missing operatorTbaAddress for paymaster revocation.");
            if (onError) onError(new Error("Missing operatorTbaAddress"));
            return;
        }

        console.log(`useApprovePaymaster: Revoking paymaster approval for Operator TBA ${operatorTbaAddress}`);
        console.log(`  Paymaster: ${paymasterAddress}`);
        console.log(`  USDC Contract: ${usdcAddress}`);
        console.log(`  Approval Amount: 0 (revoke)`);

        // Step 1: Encode the ERC20 approve call with amount = 0 to revoke
        const revokeCallData = encodeERC20Approve({
            spender: paymasterAddress,
            amount: 0n, // Setting amount to 0 revokes the approval
        });

        // Step 2: Prepare arguments for operatorTBA.execute()
        const executeArgs = prepareTbaExecuteArgs({
            targetContract: usdcAddress,
            callData: revokeCallData,
            value: 0n,
            operation: 0, // Standard CALL
        });
        
        console.log(`  executeArgs for TBA: [\n    target: ${executeArgs[0]},\n    value: ${executeArgs[1]},\n    data: ${executeArgs[2]},\n    operation: ${executeArgs[3]}\n   ]`);

        // Step 3: Call execute() on the operatorTbaAddress
        writeContract({
            address: operatorTbaAddress,
            abi: tbaExecuteAbi,
            functionName: 'execute',
            args: executeArgs,
            chainId: BASE_CHAIN_ID,
        });
    }, [writeContract, onError]);

    return useMemo(() => ({
        approvePaymaster: approvePaymasterInternal,
        revokePaymaster: revokePaymasterInternal,
        transactionHash,
        isSending: isPending,
        isConfirming,
        isConfirmed,
        error: error || receiptError,
        reset,
    }), [approvePaymasterInternal, revokePaymasterInternal, transactionHash, isPending, isConfirming, isConfirmed, error, receiptError, reset]);
}

// Example usage 
/*
function MyComponent() {
    const { address: connectedAccount } = useAccount();
    const chainId = useChainId();

    const { mint, transactionHash: mintTxHash, isSending: isMinting, ...mintStatus } = useMintOperatorSubEntry({
        onSuccess: (data) => console.log("Mint successful, tx:", data),
        onError: (err) => console.error("Mint error:", err),
    });

    const { setNote, transactionHash: noteTxHash, ...noteStatus } = useSetOperatorNote();
    const { setAccessListNote, ...accessListNoteStatus } = useSetOperatorNote(); // Can reuse if structured well
    const { setSignersNote, ...signersNoteStatus } = useSetOperatorNote();


    const handleMintOperator = () => {
        if (connectedAccount && chainId === BASE_CHAIN_ID) {
            mint({
                ownerAddress: connectedAccount,
                operatorSubLabel: "grid-beta-wallet"
                // tbaImplementationAddress: can be specified if different from default
            });
        }
    };

    const handleSetAccessNote = (operatorTBA: Address) => {
        if (operatorTBA) {
            // The value for access-list note is the namehash of "~grid-beta-signers"
            const signersNoteKeyNamehash = viemNamehash("~grid-beta-signers") as Hex;
            setNote({
                 operatorTbaAddress: operatorTBA,
                 noteKey: "~access-list",
                 noteValueHex: signersNoteKeyNamehash
            });
            // Or using the specialized helper:
            // setAccessListNote({ operatorTbaAddress: operatorTBA });
        }
    };
    
    const handleSetSigners = (operatorTBA: Address, wallets: Address[]) => {
        if (operatorTBA) {
            const encodedWallets = encodeAddressArray(wallets);
            setNote({
                operatorTbaAddress: operatorTBA,
                noteKey: "~grid-beta-signers",
                noteValueHex: encodedWallets
            });
            // Or using the specialized helper:
            // setSignersNote({ operatorTbaAddress: operatorTBA, hotWalletAddresses: wallets });
        }
    };

    // Render UI, buttons calling these handlers, display status from mintStatus, noteStatus etc.
}
*/

// TODO:
// 1. Ensure all ABIs are complete for the functions used.
// 2. Test namehash generation and encoding for note values thoroughly.
// 3. Consider moving constants to a shared file if they grow numerous or are used elsewhere.
// 4. Add comprehensive JSDoc comments. 
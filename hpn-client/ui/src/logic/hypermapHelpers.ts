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

// Export viemNamehash so it can be imported directly by other modules
export { viemNamehash };

// -------------------------------------------------------------------------------------------------
// Constants - Consider moving to a central constants.ts or abis.ts if not already there
// -------------------------------------------------------------------------------------------------

export const HYPERMAP_ADDRESS: Address = '0x000000000044C6B8Cb4d8f0F889a3E47664EAeda';

// Default implementation address for new Token Bound Accounts (TBAs) created via hypermap.mint()
// This is the HYPER_ACCOUNT_IMPL from the explorer example.
// For HPN, if a *specific HPN operator TBA implementation* is required, this address should be updated.
// export const DEFAULT_OPERATOR_TBA_IMPLEMENTATION: Address = '0x0000000000EDAd72076CBe7b9Cfa3751D5a85C97';

// Using the correct Operator TBA implementation address with delegated signing
export const DEFAULT_OPERATOR_TBA_IMPLEMENTATION: Address = '0x000000000046886061414588bb9F63b6C53D8674';

export const BASE_CHAIN_ID = 8453; // Base Mainnet

// ABI for the Hypermap contract (relevant functions)
export const hypermapAbi = parseAbi([
    'function mint(address owner, bytes calldata node, bytes calldata data, address implementation) external returns (address tba)',
    'function note(bytes calldata noteKey, bytes calldata noteValue) external returns (bytes32 labelhash)',
    // Add other Hypermap functions if needed by other helpers:
    // 'function get(bytes32 node) external view returns (address tba, address owner, bytes memory note)',
    // 'function tbaOf(bytes32 entry) external view returns (address tba)',
    // 'function fact(bytes calldata factKey, bytes calldata factValue) external returns (bytes32 namehash)',
]);

// ABI for the standard 'execute' function on a Token Bound Account (TBA)
export const tbaExecuteAbi = parseAbi([
    'function execute(address target, uint256 value, bytes calldata data, uint8 operation) returns (bytes memory returnData)',
]);

// Note Keys for HPN
export const HPN_ACCESS_LIST_NOTE_KEY = "~access-list";
export const HPN_SIGNERS_NOTE_KEY = "~hpn-beta-signers";

// -------------------------------------------------------------------------------------------------
// Encoding Helpers
// -------------------------------------------------------------------------------------------------

/**
 * Encodes the calldata for the Hypermap 'mint' function.
 * @param owner The address that will own the newly minted TBA.
 * @param subLabel The label for the new sub-entry (e.g., "hpn-beta-wallet").
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
            stringToHex(subLabel), // The label of the sub-node to mint relative to msg.sender's owned parent node
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
    const { data: transactionHash, error, isPending, writeContract, writeContractAsync, reset } = useWriteContract({
        mutation: {
            onSuccess: props?.onSuccess, 
            onError: props?.onError,
            onSettled: props?.onSettled, 
        },
    });

    const { isLoading: isConfirming, isSuccess: isConfirmed, error: receiptError } =
        useWaitForTransactionReceipt({ hash: transactionHash, chainId: BASE_CHAIN_ID });

    const mint = ({
        parentTbaAddress, // Address of the parent TBA (e.g., pertinent.os's TBA)
        ownerOfNewSubTba,   // EOA that will own the new sub-TBA
        subLabelToMint,     // Label for the new sub-entry (e.g., "hpn-op" or "hpn-beta-wallet")
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
            props?.onError?.(err);
            // It's good practice to also throw or handle the error flow if the hook user isn't handling onError
            // For now, just logging and calling onError prop.
            return;
        }
        
        console.log(`useMintOperatorSubEntry: Preparing to mint sub-label '${subLabelToMint}' under parent TBA ${parentTbaAddress}.`);
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
    };

    return {
        mint,
        transactionHash,
        isSending: isPending, 
        isConfirming,
        isConfirmed,
        error: error || receiptError, 
        reset, 
    };
}

/**
 * Custom hook for an Operator TBA to set a note on itself via `hypermap.note()`.
 * The EOA owner of the Operator TBA calls `operatorTBA.execute(...)`.
 */
export function useSetOperatorNote(props?: UseWriteHypermapContractProps) {
    const { data: transactionHash, error, isPending, writeContract, writeContractAsync, reset } = useWriteContract({
        mutation: {
            onSuccess: props?.onSuccess,
            onError: props?.onError,
            onSettled: props?.onSettled,
        },
    });
    
    const { isLoading: isConfirming, isSuccess: isConfirmed, error: receiptError } =
        useWaitForTransactionReceipt({ hash: transactionHash, chainId: BASE_CHAIN_ID });

    const setNote = ({
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
            props?.onError?.(new Error("Missing operatorTbaAddress or noteKey"));
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
        console.log(`   -> executeArgs for TBA: [\n    target: ${executeArgs[0]},\n    value: ${executeArgs[1]},\n    data: ${executeArgs[2]},\n    operation: ${executeArgs[3]}\n   ]`);

        writeContract({
            address: operatorTbaAddress,
            abi: tbaExecuteAbi,
            functionName: 'execute',
            args: executeArgs,
            chainId: BASE_CHAIN_ID,
        });
    };
    
    // --- Specialized HPN Note Setting Functions ---

    /**
     * Sets the '~hpn-beta-access-list' note on the Operator TBA.
     * The value of this note is the namehash of '~hpn-beta-signers.OPERATOR_ENTRY_NAME'.
     */
    const setAccessListNote = ({ 
        operatorTbaAddress, 
        operatorEntryName 
    }: { 
        operatorTbaAddress: Address; 
        operatorEntryName: string;
    }) => {
        if (!operatorTbaAddress || !operatorEntryName) {
            const err = new Error("Missing operatorTbaAddress or operatorEntryName for setAccessListNote");
            console.error("useSetOperatorNote.setAccessListNote:", err.message);
            props?.onError?.(err);
            return;
        }
        // The access list note stores the *namehash* of the signers note path.
        // e.g., ~hpn-beta-access-list (on hpn-beta-wallet.pertinent.os) -> namehash(~hpn-beta-signers.hpn-beta-wallet.pertinent.os)
        const signersNotePath = `${HPN_SIGNERS_NOTE_KEY}.${operatorEntryName}`;
        const valueToStore = viemNamehash(signersNotePath); // This is a bytes32 value

        console.log(`useSetOperatorNote.setAccessListNote: Setting note for Operator TBA ${operatorTbaAddress}`);
        console.log(`  Note Key (simple): ${HPN_ACCESS_LIST_NOTE_KEY}`);
        console.log(`  Value to store (namehash of signers note path '${signersNotePath}'): ${valueToStore}`);

        setNote({
            operatorTbaAddress,
            noteKey: HPN_ACCESS_LIST_NOTE_KEY, // Use the simple base key for the note on the TBA
            noteValueHex: valueToStore,      // The namehash of the full signers note path is the value
        });
    };

    /**
     * Sets the '~hpn-beta-signers' note on the Operator TBA.
     * The value is an ABI-encoded address array of hot wallet addresses.
     */
    const setSignersNote = ({
        operatorTbaAddress,
        operatorEntryName, // Still useful for logging and constructing full paths for external reference
        hotWalletAddresses,
    }: {
        operatorTbaAddress: Address;
        operatorEntryName: string;
        hotWalletAddresses: Address[];
    }) => {
        if (!operatorTbaAddress || !operatorEntryName || !hotWalletAddresses || hotWalletAddresses.length === 0) {
            const err = new Error(
                "Missing operatorTbaAddress, operatorEntryName, or hotWalletAddresses (or empty array) for setSignersNote"
            );
            console.error("useSetOperatorNote.setSignersNote:", err.message);
            props?.onError?.(err);
            return;
        }

        // const signersNotePath = `${HPN_SIGNERS_NOTE_KEY}.${operatorEntryName}`; // Full path for reference/logging
        const encodedAddresses = encodeAddressArray(hotWalletAddresses);

        console.log(`useSetOperatorNote.setSignersNote: Setting note for Operator TBA ${operatorTbaAddress}`);
        console.log(`  Note Key (simple): ${HPN_SIGNERS_NOTE_KEY}`);
        console.log(`  (Full conceptual path for this note would be: ${HPN_SIGNERS_NOTE_KEY}.${operatorEntryName})`);
        console.log(`  Addresses to store: ${hotWalletAddresses.join(', ')}`);
        console.log(`  ABI Encoded Addresses: ${encodedAddresses}`);

        setNote({
            operatorTbaAddress,
            noteKey: HPN_SIGNERS_NOTE_KEY, // Use the simple base key for the note on the TBA
            noteValueHex: encodedAddresses, // The ABI-encoded array of addresses
        });
    };

    return {
        setNote, // Generic note setter
        setAccessListNote, // Specialized for HPN access list
        setSignersNote,    // Specialized for HPN signers list
        transactionHash,
        isSending: isPending,
        isConfirming,
        isConfirmed,
        error: error || receiptError,
        reset,
    };
}

// Example usage (conceptual, would be in a React component):
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
                operatorSubLabel: "hpn-beta-wallet"
                // tbaImplementationAddress: can be specified if different from default
            });
        }
    };

    const handleSetAccessNote = (operatorTBA: Address) => {
        if (operatorTBA) {
            // The value for access-list note is the namehash of "~hpn-beta-signers"
            const signersNoteKeyNamehash = viemNamehash("~hpn-beta-signers") as Hex;
            setNote({
                 operatorTbaAddress: operatorTBA,
                 noteKey: "~hpn-beta-access-list",
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
                noteKey: "~hpn-beta-signers",
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
import React, { useState, useEffect } from 'react';
import { useAccount, useChainId, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { ConnectButton, useConnectModal } from '@rainbow-me/rainbowkit';
import {
    encodeFunctionData,
    parseAbi,
    stringToHex,
    toHex, 
    namehash,
    type Address as ViemAddress,
    bytesToHex,
    encodeAbiParameters,
    parseAbiParameters
} from 'viem';

// --- Constants (Simplified for this component) ---
const BASE_CHAIN_ID = 8453;
const HYPERMAP_ADDRESS = '0x000000000044C6B8Cb4d8f0F889a3E47664EAeda' as ViemAddress;
const DEFAULT_TBA_IMPLEMENTATION = '0x000000000046886061414588bb9F63b6C53D8674' as ViemAddress; 

const hypermapAbi = parseAbi([
  'function note(bytes calldata note, bytes calldata data) external returns (bytes32 labelhash)',
  'function mint(address who, bytes calldata label, bytes calldata initialization, bytes calldata erc721Data, address implementation) external returns (address tba)',
  'function fact(bytes calldata key, bytes calldata value) external returns (bytes32 factHash)' 
]);
const mechAbi = parseAbi([
  'function execute(address target, uint256 value, bytes calldata data, uint8 operation) payable returns (bytes memory returnData)',
]);

interface SetSignersNoteTestProps {
    operatorTbaAddress: ViemAddress | null | undefined;
    hotWalletAddress: string | null | undefined;
    baseNodeName: string | null | undefined;
}

const SetSignersNoteTest: React.FC<SetSignersNoteTestProps> = ({
    operatorTbaAddress,
    hotWalletAddress,
    baseNodeName,
}) => {
    const { address: connectedAddress, isConnected } = useAccount();
    const currentChainId = useChainId();
    const { openConnectModal } = useConnectModal();
    const [localError, setLocalError] = useState<string | null>(null);
    const [localTxHash, setLocalTxHash] = useState<`0x${string}` | undefined>(undefined);
    const [currentOperation, setCurrentOperation] = useState<string | null>(null);

    // --- State for Mint Sub-Entry ---
    const [subLabelForMint, setSubLabelForMint] = useState<string>('');

    // --- State for Generic Add Note ---
    const [genericNoteKey, setGenericNoteKey] = useState<string>('~');
    const [genericNoteValue, setGenericNoteValue] = useState<string>('');

    // --- State for Add Fact ---
    const [factKey, setFactKey] = useState<string>('!');
    const [factValue, setFactValue] = useState<string>('');

    // --- Wagmi Hooks (Scoped to this component) ---
    const { 
        data: hookTxHash, 
        writeContractAsync, 
        isPending: isSending, 
        error: writeHookError, 
        reset 
    } = useWriteContract(); 

    const { 
        isLoading: isConfirming, 
        isSuccess: isConfirmed, 
        error: receiptHookError 
    } = useWaitForTransactionReceipt({ hash: hookTxHash, chainId: BASE_CHAIN_ID });

    // Update local hash state when wagmi hook hash changes
    useEffect(() => {
        if (hookTxHash) {
            setLocalTxHash(hookTxHash);
            setLocalError(null); // Clear previous errors on new tx
        }
    }, [hookTxHash]);

    // Log errors from hooks and clear current operation
    useEffect(() => {
        const combinedError = writeHookError || receiptHookError;
        if (combinedError) {
            console.error("!!! Test Component Error:", combinedError);
            const errorMsg = combinedError instanceof Error ? combinedError.message : 'Unknown error during test hooks.';
            setLocalError(errorMsg);
            // setCurrentOperation(null); // Clear operation on error
        }
    }, [writeHookError, receiptHookError]);

    // Effect to clear operation name when tx is confirmed or fully errored out
    useEffect(() => {
        if (isConfirmed || (receiptHookError && currentOperation)) {
            // setCurrentOperation(null); // Clear after confirmation or final error
        }
    }, [isConfirmed, receiptHookError, currentOperation]);

    // --- Handler for Generic Add Note (This is the core working logic) ---
    const handleAddGenericNoteTest = async (keyOverride?: string, valueOverride?: string) => {
        const currentKey = keyOverride !== undefined ? keyOverride : genericNoteKey;
        const currentValue = valueOverride !== undefined ? valueOverride : genericNoteValue;
        const operationName = keyOverride ? "Set Signers Note (via Generic Logic)" : "Add Generic Note";

        console.log(`--- Test Component: ${operationName} ---`);
        setLocalError(null);
        setLocalTxHash(undefined);
        setCurrentOperation(operationName);
        reset();

        const trimmedKey = currentKey.trim();
        // Validation for the key (e.g., must start with ~, no dots/spaces if that's a general rule for generic notes)
        if (!trimmedKey || !trimmedKey.startsWith('~') || trimmedKey.length <= 1 || (operationName === "Add Generic Note" && (trimmedKey.includes('.') || trimmedKey.includes(' ')))) {
            // Slightly adjusted validation: allow dots if it's the specific signers note test, as the key itself might be specific, but for generic, enforce no dots.
            // For the specific test "~hpn-beta-signers", this validation is fine.
            // If `keyOverride` was `~hpn-beta-signers.some.thing` it would fail here if dots aren't allowed for generic user input.
            // The current use case with "~hpn-beta-signers" passes this.
            alert(`Invalid note key: "${trimmedKey}". Must start with ~, be >1 char. Generic notes usually don't contain dots/spaces.`);
            setCurrentOperation(null);
            return;
        }
        if (!isConnected || currentChainId !== BASE_CHAIN_ID) {
            alert('Please connect wallet to Base network for adding note.');
            setCurrentOperation(null);
            openConnectModal?.();
            return;
        }
        if (!operatorTbaAddress) {
            alert('Note Test Error: Missing Operator TBA (target for note).');
            setCurrentOperation(null);
             return;
        }

        const noteKeyBytes = stringToHex(trimmedKey);
        const noteValueBytes = stringToHex(currentValue.trim()); 

        try {
        const noteCalldata = encodeFunctionData({
            abi: hypermapAbi,
            functionName: 'note',
            args: [noteKeyBytes, noteValueBytes]
        });

        const executeArgs = [
            HYPERMAP_ADDRESS,
            0n,
            noteCalldata,
            0 as const
        ] as const;

            console.log(`${operationName}: Targeting Operator TBA ${operatorTbaAddress}`);
            console.log(`${operationName}: Setting note ${trimmedKey} with value ${currentValue} (hex: ${noteValueBytes})`);
            console.log(`${operationName}: Inner calldata for note: ${noteCalldata}`);

            await writeContractAsync({
                address: operatorTbaAddress,
                abi: mechAbi,
                functionName: 'execute',
                args: executeArgs,
                chainId: BASE_CHAIN_ID
            });
            alert(`${operationName} transaction submitted!`);

        } catch (err) {
            console.error(`!!! ${operationName} Test: Error caught from writeContractAsync:`, err);
            const errorMsg = err instanceof Error ? err.message : `Unknown error during ${operationName} writeContractAsync.`;
            setLocalError(errorMsg);
            alert(`${operationName} Test Failed: ${errorMsg}`);
            setCurrentOperation(null);
        }
    };

    // Function to trigger setting signers note using the generic logic
    const triggerSignersNoteViaGenericLogic = () => {
        if (!hotWalletAddress || !baseNodeName) { // baseNodeName still useful for full context display, though not in key here
            alert("Cannot set signers note: Hot wallet address or base node name is missing for context.");
            return;
        }
        const signersNoteKeyForGenericTest = "~hpn-beta-signers"; 
        console.log(`Attempting to set note with key: "${signersNoteKeyForGenericTest}" and value: "${hotWalletAddress}" using generic note logic.`);
        handleAddGenericNoteTest(signersNoteKeyForGenericTest, hotWalletAddress);
    };

    // --- Handler for Mint Sub-Entry (Adapted from MintSubEntry.js) ---
    const handleMintSubEntryTest = async () => {
        console.log("--- Test Component: handleMintSubEntryTest ---");
        setLocalError(null);
        setLocalTxHash(undefined);
        setCurrentOperation("Mint Sub-Entry");
        reset();

        const trimmedLabel = subLabelForMint.trim();
        if (!trimmedLabel || trimmedLabel.includes('.') || trimmedLabel.includes(' ')) {
            alert('Invalid label for minting. Cannot be empty, contain dots or spaces.');
            setCurrentOperation(null);
            return;
        }
        if (!isConnected || !connectedAddress || currentChainId !== BASE_CHAIN_ID) {
            alert('Please connect wallet to Base network for minting.');
            openConnectModal?.();
            setCurrentOperation(null);
            return;
        }
        if (!operatorTbaAddress) { // This will be the parentTbaAddress
            alert('Mint Test Error: Missing Operator TBA (Parent TBA for minting).');
            setCurrentOperation(null);
            return;
        }

        try {
            console.log(`Mint Test: Minting label '${trimmedLabel}' under parent TBA ${operatorTbaAddress}`);
            
            const mintCalldata = encodeFunctionData({
                abi: hypermapAbi,
                functionName: 'mint',
                args: [
                    connectedAddress, // owner of the new sub-entry's TBA
                    stringToHex(trimmedLabel), // label for the new sub-entry
                    bytesToHex(new Uint8Array([])), // initialization (empty)
                    bytesToHex(new Uint8Array([])), // erc721Data (empty)
                    DEFAULT_TBA_IMPLEMENTATION    // implementation address
                ]
            });

            const executeArgs = [
                HYPERMAP_ADDRESS,
                0n,
                mintCalldata,
                0 as const
            ] as const;

            console.log(`Mint Test: Calling execute on Parent TBA ${operatorTbaAddress} with args:`, executeArgs);
            await writeContractAsync({
                address: operatorTbaAddress, // Minting happens via parent TBA's execute
                abi: mechAbi,
                functionName: 'execute',
                args: executeArgs,
                chainId: BASE_CHAIN_ID
            });
            alert('Mint Sub-Entry transaction submitted!');

        } catch (err) {
            console.error("!!! Mint Test: Error caught from writeContractAsync:", err);
            const errorMsg = err instanceof Error ? err.message : 'Unknown error during mint writeContractAsync.';
            setLocalError(errorMsg);
            alert(`Mint Test Failed: ${errorMsg}`);
            setCurrentOperation(null);
        }
    };

    // --- Handler for Add Fact (Adapted from AddFact.js) ---
    const handleAddFactTest = async () => {
        console.log("--- Test Component: handleAddFactTest ---");
        setLocalError(null);
        setLocalTxHash(undefined);
        setCurrentOperation("Add Fact");
        reset();

        const trimmedKey = factKey.trim();
        const trimmedValue = factValue.trim();

        if (!trimmedKey || !trimmedKey.startsWith('!') || trimmedKey.length <= 1 || trimmedKey.includes('.') || trimmedKey.includes(' ')) {
            alert("Invalid fact key. Must start with !, no dots/spaces, and not be empty.");
            setCurrentOperation(null);
            return;
        }
        if (!trimmedValue) {
            alert("Fact value cannot be empty.");
            setCurrentOperation(null);
            return;
        }
        if (!isConnected || currentChainId !== BASE_CHAIN_ID) {
            alert('Please connect wallet to Base network for adding fact.');
            openConnectModal?.();
            setCurrentOperation(null);
            return;
        }
        if (!operatorTbaAddress) {
            alert('Fact Test Error: Missing Operator TBA (target for fact).');
            setCurrentOperation(null);
            return;
        }

        const factKeyBytes = stringToHex(trimmedKey);
        const factValueBytes = stringToHex(trimmedValue); // Assuming stringToHex for value too, for consistency

        try {
            const factCalldata = encodeFunctionData({
                abi: hypermapAbi,
                functionName: 'fact', // Ensure 'fact' is in hypermapAbi
                args: [factKeyBytes, factValueBytes]
            });

            const executeArgs = [
                HYPERMAP_ADDRESS,
                0n,
                factCalldata,
                0 as const
            ] as const;

            console.log(`Fact Test: Targeting Operator TBA ${operatorTbaAddress}`);
            console.log(`Fact Test: Setting fact ${trimmedKey} with value ${trimmedValue}`);
            console.log(`Fact Test: Inner calldata for fact: ${factCalldata}`);
            
            await writeContractAsync({
                address: operatorTbaAddress, 
                abi: mechAbi, 
                functionName: 'execute', 
                args: executeArgs,
                chainId: BASE_CHAIN_ID
            }); 
            alert('Add Fact transaction submitted!');

        } catch (err) {
            console.error("!!! Fact Test: Error caught from writeContractAsync:", err);
            const errorMsg = err instanceof Error ? err.message : 'Unknown error during fact writeContractAsync.';
            setLocalError(errorMsg);
            alert(`Fact Test Failed: ${errorMsg}`);
            setCurrentOperation(null);
        }
    };

    // Determine button text and disabled state
    let buttonText = "Set Signers Note (Isolated Test)";
    let isButtonDisabled = !operatorTbaAddress || !hotWalletAddress || !baseNodeName || !isConnected || currentChainId !== BASE_CHAIN_ID || isSending || isConfirming;

    if (isSending) buttonText = currentOperation ? `${currentOperation} - Sending...` : "Sending...";
    else if (isConfirming) buttonText = currentOperation ? `${currentOperation} - Confirming...` : "Confirming...";
    else if (isConfirmed && hookTxHash && currentOperation) buttonText = `${currentOperation} - Confirmed!`;
    else if (currentOperation) buttonText = `${currentOperation}`;

    // --- Common Props for Buttons & Inputs ---
    const commonDisabled = !isConnected || currentChainId !== BASE_CHAIN_ID || isSending || isConfirming;
    const sectionStyle = { border: '1px solid #ccc', padding: '15px', margin: '15px 0', borderRadius: '5px' };
    const inputStyle = { width: '90%', padding: '8px', margin: '5px 0', boxSizing: 'border-box' as React.CSSProperties['boxSizing'] };
    const buttonStyle = (customDisabled: boolean) => ({ 
        opacity: customDisabled || commonDisabled ? 0.5 : 1, 
        cursor: customDisabled || commonDisabled ? 'not-allowed' : 'pointer',
        padding: '10px 15px', 
        backgroundColor: '#007bff', 
        color: 'white', 
        border: 'none', 
        borderRadius: '4px',
        marginTop: '10px'
    });

    return (
        <div style={{ border: '2px dashed blue', padding: '15px', margin: '15px' }}>
            <h3>Hypermap Interaction Test Component</h3>
            <p>Operator TBA (Target for ALL actions below): <code>{operatorTbaAddress || 'N/A'}</code></p>
            <p>Hot Wallet (for Signer Note value/Mint Owner): <code>{hotWalletAddress || 'N/A'}</code></p>
            <p>Base Node (for context/note keys, e.g., {baseNodeName || 'your.node'}): <code>{baseNodeName || 'N/A'}</code></p>
            {!isConnected && <ConnectButton />}
            {isConnected && currentChainId !== BASE_CHAIN_ID && <p style={{color: 'red'}}>Please switch to Base network (ID: {BASE_CHAIN_ID}).</p>}
            
            {/* Section 1: Set Specific Signers Note VIA GENERIC NOTE LOGIC (Confirmed Working Method) */}
            <div style={sectionStyle}>
                <h4>1. Set Signers Note (using Generic Note Logic)</h4>
                <p>Target Key on Operator TBA: <code>{"~hpn-beta-signers"}</code></p>
                <p>Target Value (Hot Wallet Address, as simple hex): <code>{hotWalletAddress ? `${hotWalletAddress} (Hex: ${stringToHex(hotWalletAddress)})` : '(Missing Hot Wallet)'}</code></p>
                <p style={{fontSize: '0.9em', color: '#555'}}>This uses the same mechanism as the manual "Add/Update Generic Note" form.</p>
            <button
                    onClick={triggerSignersNoteViaGenericLogic} 
                    disabled={!operatorTbaAddress || !hotWalletAddress || !baseNodeName || commonDisabled} 
                className="button primary-button"
                    style={{ ...buttonStyle(!operatorTbaAddress || !hotWalletAddress || !baseNodeName), backgroundColor: '#28a745' }} // Green for primary working method
                >
                    {currentOperation === "Set Signers Note (via Generic Logic)" && isSending ? "Sending Signers Note..." :
                     currentOperation === "Set Signers Note (via Generic Logic)" && isConfirming ? "Confirming Signers Note..." :
                     currentOperation === "Set Signers Note (via Generic Logic)" && isConfirmed && localTxHash ? "Signers Note Set!" :
                     "Set Signers Note (key: ~hpn-beta-signers)"} 
                </button>
            </div>

            <div style={sectionStyle}>
                <h4>2. Add/Update Generic Note (Manual Form)</h4>
                <p>Action via Operator TBA: <code>{operatorTbaAddress || '(Not Provided)'}</code></p>
                <input
                    type="text"
                    value={genericNoteKey} 
                    onChange={(e) => {
                        const val = e.target.value;
                        if (!val || !val.startsWith('~')) setGenericNoteKey('~' + val.replace(/^~+/, ''));
                        else setGenericNoteKey(val);
                    }}
                    placeholder="Note Key (e.g., ~hpn-beta-signers or ~yourkey)"
                    style={inputStyle}
                    disabled={commonDisabled || !operatorTbaAddress}
                />
                <input
                    type="text"
                    value={genericNoteValue} 
                    onChange={(e) => setGenericNoteValue(e.target.value)}
                    placeholder="Note Value"
                    style={inputStyle}
                    disabled={commonDisabled || !operatorTbaAddress}
                />
                <button
                    onClick={() => handleAddGenericNoteTest()} 
                    style={buttonStyle(!operatorTbaAddress || !genericNoteKey.trim() || genericNoteKey.trim().length <=1)}
                    disabled={commonDisabled || !operatorTbaAddress || !genericNoteKey.trim() || genericNoteKey.trim().length <=1}
                >
                    {currentOperation === "Add Generic Note" && isSending ? "Sending Note..." :
                     currentOperation === "Add Generic Note" && isConfirming ? "Confirming Note..." :
                     currentOperation === "Add Generic Note" && isConfirmed && localTxHash ? "Generic Note Set!" :
                     "Add/Update Generic Note (Manual)"} 
                </button>
            </div>

            <div style={sectionStyle}>
                <h4>3. Mint New Sub-Entry (under Operator TBA)</h4>
                <p>New sub-entry will be owned by: <code>{connectedAddress || '(Connect Wallet)'}</code></p>
                <p>Action via Operator TBA: <code>{operatorTbaAddress || '(Not Provided)'}</code></p>
                <input
                    type="text"
                    value={subLabelForMint}
                    onChange={(e) => setSubLabelForMint(e.target.value)}
                    placeholder="Enter sub-label (no dots/spaces)"
                    style={inputStyle}
                    disabled={commonDisabled || !operatorTbaAddress}
                />
                <button
                    onClick={handleMintSubEntryTest}
                    style={buttonStyle(!operatorTbaAddress || !subLabelForMint.trim())}
                    disabled={commonDisabled || !operatorTbaAddress || !subLabelForMint.trim()}
                >
                    {currentOperation === "Mint Sub-Entry" && isSending ? "Sending Mint..." :
                     currentOperation === "Mint Sub-Entry" && isConfirming ? "Confirming Mint..." :
                     currentOperation === "Mint Sub-Entry" && isConfirmed && localTxHash ? "Sub-Entry Minted!" :
                     "Mint Sub-Entry"}
                </button>
            </div>

            <div style={sectionStyle}>
                <h4>4. Add Fact (to Operator TBA, immutable)</h4>
                <p>Action via Operator TBA: <code>{operatorTbaAddress || '(Not Provided)'}</code></p>
                <input
                    type="text"
                    value={factKey}
                    onChange={(e) => {
                        const val = e.target.value;
                        if (!val || !val.startsWith('!')) setFactKey('!' + val.replace(/^!+/, ''));
                        else setFactKey(val);
                    }}
                    placeholder="Fact Key (must start with !)"
                    style={inputStyle}
                    disabled={commonDisabled || !operatorTbaAddress}
                />
                <input
                    type="text"
                    value={factValue}
                    onChange={(e) => setFactValue(e.target.value)}
                    placeholder="Fact Value (required)"
                    style={inputStyle}
                    disabled={commonDisabled || !operatorTbaAddress}
                />
                <button
                    onClick={handleAddFactTest}
                    style={buttonStyle(!operatorTbaAddress || !factKey.trim() || factKey.trim().length <= 1 || !factValue.trim())}
                    disabled={commonDisabled || !operatorTbaAddress || !factKey.trim() || factKey.trim().length <= 1 || !factValue.trim()}
                >
                   {currentOperation === "Add Fact" && isSending ? "Sending Fact..." :
                    currentOperation === "Add Fact" && isConfirming ? "Confirming Fact..." :
                    currentOperation === "Add Fact" && isConfirmed && localTxHash ? "Fact Added!" :
                    "Add Fact"}
            </button>
            </div>
            
            <div style={{ marginTop: '20px', paddingTop: '10px', borderTop: '1px solid #eee' }}>
                {isSending && <p><strong>Processing Transaction ({currentOperation})...</strong></p>}
                {isConfirming && localTxHash && <p><strong>Confirming Transaction ({currentOperation}) on chain...</strong><br/>Hash: <a href={`https://basescan.org/tx/${localTxHash}`} target="_blank" rel="noopener noreferrer">{localTxHash}</a></p>}
                {isConfirmed && localTxHash && currentOperation && (
                    <p style={{ color: 'green', fontWeight: 'bold' }}>
                        ✅ {currentOperation} Successful! Tx: <a href={`https://basescan.org/tx/${localTxHash}`} target="_blank" rel="noopener noreferrer">{localTxHash}</a>
                    </p>
             )}
             {localError && (
                 <p style={{ color: 'red', fontWeight: 'bold', marginTop: '10px' }}>
                        ❌ Error ({currentOperation || 'Last Operation'}): {localError}
                 </p>
             )}
                {(localError || localTxHash) && !(isSending || isConfirming) && (
                    <button onClick={() => { setLocalError(null); setLocalTxHash(undefined); setCurrentOperation(null); reset(); }} style={{marginTop: '5px'}}>Clear Status</button>
                )}
            </div>
        </div>
    );
};

export default SetSignersNoteTest; 
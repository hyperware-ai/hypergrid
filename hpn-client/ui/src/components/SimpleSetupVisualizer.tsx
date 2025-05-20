import React, { useState, useEffect, useCallback } from 'react';
import { 
    OnboardingStatusResponse, 
    OnboardingCheckDetails, 
    IdentityStatus as TIdentityStatus, // Renaming to avoid conflict if ever used with a local enum
    DelegationStatus as TDelegationStatus,
    FundingStatusDetails as TFundingStatusDetails
} from '../logic/types';
import { useAccount, useChainId, useWriteContract, useWaitForTransactionReceipt, usePublicClient, useContractRead, useConfig } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import {
    encodeFunctionData, 
    parseAbi, 
    stringToHex, 
    bytesToHex, 
    namehash as viemNamehash, 
    type Address as ViemAddress, 
    toHex,
    encodeAbiParameters,
    parseAbiParameters,
    getAddress,
    encodePacked
} from 'viem';
import CopyToClipboardText from './CopyToClipboardText';

// --- Constants (Copied from SetupWizard for now) ---
const BASE_CHAIN_ID = 8453;
const HYPERMAP_ADDRESS = '0x000000000044C6B8Cb4d8f0F889a3E47664EAeda' as ViemAddress;
const OPERATOR_TBA_IMPLEMENTATION = '0x000000000046886061414588bb9F63b6C53D8674' as ViemAddress;

const hypermapAbi = parseAbi([
  'function note(bytes calldata note, bytes calldata data) external returns (bytes32 labelhash)',
  'function mint(address owner, bytes calldata label, bytes calldata initData, address implementation) external returns (address tba)', // Using 4-arg for now, as per last successful test config
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

interface SimpleSetupVisualizerProps {
    onboardingData: OnboardingStatusResponse | null;
    nodeName: string | null; // The main node name like "abracadabra.os"
    nodeTbaAddress: ViemAddress | null | undefined; // TBA of the main nodeName
    nodeTbaOwner: ViemAddress | null | undefined; // Owner of the main nodeName's TBA
    onRefreshStatus: () => void; // Callback to refresh onboarding status
}

const SimpleSetupVisualizer: React.FC<SimpleSetupVisualizerProps> = ({
    onboardingData,
    nodeName,
    nodeTbaAddress,
    nodeTbaOwner,
    onRefreshStatus
}) => {
    const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
    const [onChainTxHash, setOnChainTxHash] = useState<`0x${string}` | undefined>(undefined);
    const [onChainError, setOnChainError] = useState<string | null>(null); 
    const [currentActionName, setCurrentActionName] = useState<string | null>(null);

    const { address: connectedOwnerWalletAddress, isConnected: isOwnerConnected, chain } = useAccount();
    const currentOwnerChainId = useChainId();
    const { data: onChainActionHash, writeContract: executeOnChainAction, isPending, reset, error: writeContractHookError } = useWriteContract(); 
    const { isLoading: isOnChainActionConfirming, isSuccess: isOnChainActionConfirmed, error: txReceiptError } = useWaitForTransactionReceipt({ hash: onChainActionHash, chainId: BASE_CHAIN_ID });

    const showToast = useCallback((type: 'success' | 'error', text: string, duration: number = 4000) => {
        setToastMessage({ type, text });
        setTimeout(() => setToastMessage(null), duration);
    }, [setToastMessage]);

    useEffect(() => {
        if (isOnChainActionConfirmed && onChainActionHash && currentActionName) {
            showToast('success', `Action (${currentActionName}) confirmed! Hash: ${truncateString(onChainActionHash)}`);
            setCurrentActionName(null); setOnChainTxHash(undefined); setOnChainError(null);
            onRefreshStatus(); 
        }
        if (txReceiptError && currentActionName) { 
             const errorMsg = (txReceiptError as Error)?.message || `${currentActionName} tx confirmation failed`;
             setOnChainError(errorMsg);
             showToast('error', `On-chain confirmation error (${currentActionName}): ${errorMsg}`);
             setCurrentActionName(null); 
        }
    }, [isOnChainActionConfirmed, onChainActionHash, txReceiptError, currentActionName, showToast, onRefreshStatus]);
    
    useEffect(() => { if (onChainActionHash) setOnChainTxHash(onChainActionHash); }, [onChainActionHash]);
    useEffect(() => { 
        if (writeContractHookError) { 
            console.error("Visualizer Wagmi Hook Error:", writeContractHookError);
            showToast('error', `Wallet Interaction Error: ${writeContractHookError.message}`);
            setCurrentActionName(null); 
        }
     }, [writeContractHookError, showToast]);

    // --- REVISED Status Text Helper Functions ---
    const getIdentityStatusDisplay = (): string => {
        const checks = onboardingData?.checks;
        if (!checks) return '❓'; // Should not happen if onboardingData is present
        if (!checks.identityStatus) return checks.identityConfigured ? '❓ (Awaiting Details)' : '❌ (Initial Check)';
        
        const is = checks.identityStatus as any;

        // Handle string variants from Rust enum serialization
        if (typeof is === 'string') {
            if (is === 'notFound') return `❌ Not Minted`;
            // Add other simple string variants if any exist in Rust enum
            return `❓ Unknown String Status (${is})`;
        }
        
        // Handle object variants
        if (typeof is === 'object' && is !== null) {
            // Rust enum variants with data are serialized as an object with one key, e.g., { verified: { ... } }
            if ('verified' in is && is.verified) return `✅ Verified (TBA: ${truncateString(checks.operatorTba)})`;
            if ('incorrectImplementation' in is && is.incorrectImplementation) return `❌ Incorrect Implementation (Found: ${truncateString(is.incorrectImplementation.found)})`;
            if ('implementationCheckFailed' in is && is.implementationCheckFailed) return `❓ Error Checking Impl (${is.implementationCheckFailed})`;
            if ('checkError' in is && is.checkError) return `❓ Check Error (${is.checkError})`;
            // If Rust serialized a unit variant as an object like {notFound: null}, this would catch it:
            if ('notFound' in is) return `❌ Not Minted`; 
            return `❓ Unknown Object Status (${JSON.stringify(is)})`;
        }
        return `❓ Invalid Status Format`; // Fallback for unexpected types
    };

    const getDelegationNoteStatusText = (noteType: 'signers' | 'accessList'): string => {
        const checks = onboardingData?.checks;
        if (!checks) return '⚪';
        if (!checks.identityConfigured) return '⚪ (Blocked by Identity)';
        if (!checks.hotWalletSelectedAndActive) return '⚪ (Blocked by Hot Wallet)';
        
        const ds = checks.delegationStatus as any;
        if (!ds) {
            return checks.delegationVerified === null ? '❓ Checking...' : 
                   (checks.delegationVerified === true ? '✅ Set Correctly (No Detail)' : '❓ Unknown');
        }

        if (ds === 'verified') return '✅ Set Correctly';

        // --- Handle Access List Note Status First --- 
        if (ds === 'accessListNoteMissing') {
            return noteType === 'accessList' ? '❌ Missing' : '⚪ (Access List Note Missing)';
        }
        if (typeof ds === 'object' && ds !== null && 'accessListNoteInvalidData' in ds) {
            const reason = ds.accessListNoteInvalidData as string;
            if (reason.toLowerCase().includes("has no data")) { 
                return noteType === 'accessList' ? '❌ Missing (No Data Set)' : '⚪ (Access List Note Missing/Empty)';
            }
            return noteType === 'accessList' ? `❌ Invalid Data (${reason})` : '⚪ (Access List Note Invalid)';
        }

        // --- If Access List is not the primary issue, evaluate based on noteType ---
        if (noteType === 'signers') {
            if (ds === 'signersNoteMissing') return '❌ Missing';
            if (typeof ds === 'object' && ds !== null && 'signersNoteLookupError' in ds) return `❌ Lookup Error (Not Found via Access List Pointer)`;
            if (typeof ds === 'object' && ds !== null && 'signersNoteInvalidData' in ds) return `❌ Invalid Data/Format (${ds.signersNoteInvalidData})`;
            if (ds === 'hotWalletNotInList') return `❌ Incorrect Value (Hot Wallet mismatch)`;
        }
        
        if (typeof ds === 'object' && ds !== null && 'checkError' in ds) return `❓ Check Error (${ds.checkError})`;

        // Fallback: If this note type doesn't have a specific error mentioned above,
        // but delegation is not 'verified', it implies the other note is the issue or it's a general unverified state.
        if (ds !== 'verified') {
            return '⏳ Pending Other Note / Status Unknown';
        }
        
        return `❓ Status Unclear (${JSON.stringify(ds)})`;
    };

    const getFundingText = (type: 'tbaEth' | 'tbaUsdc' | 'hwEth'): string => {
        const checks = onboardingData?.checks;
        if (!checks || !checks.fundingStatus) return '❓ Checking...'; // Changed from just '❓'
        const fs = checks.fundingStatus;
        
        if (type === 'tbaEth') return `${fs.tbaNeedsEth ? '❌ Needs ETH' : '✅ OK'} (${checks.tbaEthBalanceStr || 'N/A'})`;
        if (type === 'tbaUsdc') return `${fs.tbaNeedsUsdc ? '❌ Needs USDC' : '✅ OK'} (${checks.tbaUsdcBalanceStr || 'N/A'})`;
        if (type === 'hwEth') return `${fs.hotWalletNeedsEth ? '❌ Needs ETH' : '✅ OK'} (${checks.hotWalletEthBalanceStr || 'N/A'})`;
        return '❓ Error';
    };
    // --- End Status Text Helpers ---

    // --- Action Handlers (copied and adapted from SetupWizard) ---
    const handleMintOperatorSubEntry = async () => {
        setOnChainError(null); setOnChainTxHash(undefined);
        const checks = onboardingData?.checks;
        let displayHotWalletAddressForNotes = checks?.hotWalletAddress; 

        console.log("Visualizer Mint Pre-check:", { nodeName, hotWalletForNotes: displayHotWalletAddressForNotes, nodeTbaAddress, connectedOwnerWalletAddress, nodeTbaOwner });
        if (!nodeName || /*!displayHotWalletAddressForNotes ||*/ !nodeTbaAddress || !connectedOwnerWalletAddress || !nodeTbaOwner) { 
            showToast('error', 'Mint Error: Missing required info for Visualizer.'); 
            return; 
        }
        if (connectedOwnerWalletAddress.toLowerCase() !== nodeTbaOwner?.toLowerCase()) { 
            showToast('error', 'Mint Error: Connected wallet does not match Node TBA owner.'); 
            return; 
        }
        try {
            setCurrentActionName('mint');
            const subEntryLabelForMint = "hpn-beta-wallet";
            const labelArg = encodePacked(['bytes'], [stringToHex(subEntryLabelForMint)]);
            const initArg = bytesToHex(new Uint8Array([]));
            const implArg = OPERATOR_TBA_IMPLEMENTATION;
            const mintCalldata = encodeFunctionData({ abi: hypermapAbi, functionName: 'mint', args: [connectedOwnerWalletAddress, labelArg, initArg, implArg] });
            const txArgs = [HYPERMAP_ADDRESS, 0n, mintCalldata, 0 as const] as const;
            executeOnChainAction({ address: nodeTbaAddress, abi: mechAbi, functionName: 'execute', args: txArgs, chainId: BASE_CHAIN_ID });
        } catch (err) { 
            console.error("Mint Prep Error (Visualizer):", err);
            showToast('error', `Mint Prep Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
            setCurrentActionName(null);
        }
    };

    const handleSetSignersNote = async () => {
        const operatorTba = onboardingData?.checks?.operatorTba as ViemAddress | undefined;
        let displayHotWalletAddress = onboardingData?.checks?.hotWalletAddress;
        
        if (!operatorTba || !displayHotWalletAddress || !connectedOwnerWalletAddress) { 
            showToast('error', 'Signers Note: Missing opTBA, HotWalletAddr, or Owner not connected'); 
            setCurrentActionName(null);
            return; 
        }
        // displayHotWalletAddress is the string "0x..." here if valid
        const hotWalletAddrString = displayHotWalletAddress; 

        try {
            setCurrentActionName('setSignersNote');
            const signersNoteKey = "~hpn-beta-signers";
            const noteKeyBytes = stringToHex(signersNoteKey);
            
            // --- Use simple stringToHex for the address string value --- 
            const noteValueBytes = stringToHex(hotWalletAddrString); 
            console.log(`SetSignersNote: Using simple stringToHex for hotWalletAddress (${hotWalletAddrString}): ${noteValueBytes}`);
            
            const noteCalldata = encodeFunctionData({ abi: hypermapAbi, functionName: 'note', args: [noteKeyBytes, noteValueBytes] });
            const txArgs = [HYPERMAP_ADDRESS, 0n, noteCalldata, 0 as const] as const;
            console.log(`SetSignersNote: Targeting Operator TBA ${operatorTba} with simple hex value.`);
            executeOnChainAction({ address: operatorTba, abi: mechAbi, functionName: 'execute', args: txArgs, chainId: BASE_CHAIN_ID });
        } catch (err) { 
            console.error("SetSignersNote Prep Error (Visualizer):", err);
            showToast('error', `SetSignersNote Prep Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
            setCurrentActionName(null);
        }
    };

    const handleSetAccessListNote = async () => {
        const operatorTba = onboardingData?.checks?.operatorTba as ViemAddress | undefined;
        const operatorTbaFullName = `hpn-beta-wallet.${nodeName || 'unknown'}`;
        const signersNoteFullNameToHash = `~hpn-beta-signers.${operatorTbaFullName}`;
        if (!nodeName || !operatorTba || !connectedOwnerWalletAddress) { 
             showToast('error', 'AccessList Note: Missing nodeName, opTBA, or Owner not connected'); return; 
        }
        try {
            setCurrentActionName('setAccessListNote');
            const accessListNoteKey = "~hpn-beta-access-list";
            const noteKeyBytes = stringToHex(accessListNoteKey);
            const namehashOfSignersNoteBytes = viemNamehash(signersNoteFullNameToHash);
            const noteDataForAccessList = toHex(namehashOfSignersNoteBytes); 
            const noteCalldata = encodeFunctionData({ abi: hypermapAbi, functionName: 'note', args: [noteKeyBytes, noteDataForAccessList] });
            const txArgs = [HYPERMAP_ADDRESS, 0n, noteCalldata, 0 as const] as const;
            executeOnChainAction({ address: operatorTba, abi: mechAbi, functionName: 'execute', args: txArgs, chainId: BASE_CHAIN_ID });
        } catch (err) { 
             console.error("SetAccessListNote Prep Error (Visualizer):", err);
            showToast('error', `SetAccessListNote Prep Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
            setCurrentActionName(null);
        }
    };
    // --- End Action Handlers ---

    if (!onboardingData) {
        return <div className="visualizer-container"><p>Loading onboarding status...</p></div>;
    }
    const { checks } = onboardingData;

    const isIdentityFullyVerified = typeof checks.identityStatus === 'object' && checks.identityStatus !== null && 'verified' in checks.identityStatus;
    const isHotWalletReady = !!checks.hotWalletSelectedAndActive;
    const opTbaDisplay = checks.operatorTba ? truncateString(checks.operatorTba) : "(Not Set)";

    // Define button disabled states based on props and current component state (isPending)
    const mintButtonDisabled = 
        isPending || 
        !nodeName || 
        !nodeTbaAddress || 
        !connectedOwnerWalletAddress ||
        !nodeTbaOwner;

    const setSignersNoteDisabled = 
        isPending || 
        !checks.operatorTba || 
        !checks.hotWalletAddress ||
        !connectedOwnerWalletAddress;

    const setAccessListNoteDisabled = 
        isPending || 
        !checks.operatorTba || 
        !nodeName ||
        !connectedOwnerWalletAddress;

    return (
        <div className="visualizer-container" style={{ whiteSpace: 'pre', fontFamily: 'monospace', padding: '15px', border: '1px solid #555', background:'#222', color:'#ddd'}}>
            {toastMessage && <div className={`toast-notification ${toastMessage.type}`}>{toastMessage.text}<button onClick={() => setToastMessage(null)}>&times;</button></div>}
            <div>
                Node: {`${nodeName || "(Node?)"} (Node TBA: ${truncateString(nodeTbaAddress)})`}<br/>
                Owner Wallet for Actions: {isOwnerConnected ? truncateString(connectedOwnerWalletAddress) : "(Not Connected)"} 
                {isOwnerConnected && currentOwnerChainId !== BASE_CHAIN_ID && <span style={{color: 'orange'}}> (Wrong Network)</span>}
                {!isOwnerConnected && <ConnectButton label="Connect Owner Wallet" chainStatus="none" accountStatus="address"/>}
            </div>
            <div>  │</div>
            <div>  ├─ Operator Sub-Entry (hpn-beta-wallet.{nodeName || '(Node?)'})</div>
            <div>  │  │ Status: {getIdentityStatusDisplay()}</div>
            <div>  │  │ TBA: {opTbaDisplay}</div>
            {!isIdentityFullyVerified && (
                isOwnerConnected && currentOwnerChainId === BASE_CHAIN_ID ? (
                    <div>  │  └─ Action: <button onClick={handleMintOperatorSubEntry} disabled={mintButtonDisabled}>Mint Operator Sub-Entry</button></div>
                ) : (
                    <div>  │  └─ Action: <ConnectButton label="Connect Owner (Base) to Mint" chainStatus="icon" accountStatus="address" /></div>
                )
            )}
            <div>  │</div>
            <div>  ├─ Hot Wallet</div>
            <div>  │  │ Status: {isHotWalletReady ? '✅ Ready' : '❌ Needs Setup/Activation'}</div>
            <div>  │  │ Address: {checks.hotWalletAddress ? truncateString(checks.hotWalletAddress) : "(None Selected)"}</div>
            {!isHotWalletReady && (
                <div>  │  └─ Action: (Configure in Step 1 of Main Wizard)</div>
            )}
            <div>  │</div>
            {isIdentityFullyVerified && (
                isOwnerConnected && currentOwnerChainId === BASE_CHAIN_ID ? (
                    isHotWalletReady ? (
                        <>
                            <div>  ├─ Delegation Notes (on Operator TBA: {opTbaDisplay})</div>
                            <div>  │  │</div>
                            <div>  │  ├─ Signers Note (~hpn-beta-signers)</div>
                            <div>  │  │  │ Status: {getDelegationNoteStatusText('signers')}</div>
                            <div>  │  │  │ Expected: {checks.hotWalletAddress || "(Hot Wallet Address)"}</div>
                            <div>  │  │  └─ Action: <button onClick={handleSetSignersNote} disabled={setSignersNoteDisabled}>Set Signers Note</button></div>
                            <div>  │  │</div>
                            <div>  │  └─ Access List Note (~hpn-beta-access-list)</div>
                            <div>  │     │ Status: {getDelegationNoteStatusText('accessList')}</div>
                            <div>  │     │ Expected: Namehash of full signers note</div>
                            <div>  │     └─ Action: <button onClick={handleSetAccessListNote} disabled={setAccessListNoteDisabled}>Set Access List Note</button></div>
                        </>
                    ) : (
                        <div>  ├─ Delegation Notes: ⚪ (Blocked by Hot Wallet Setup - See Main Wizard Step 1)</div>
                    )
                ) : (
                    <div>  ├─ Delegation Notes: ⚪ (Connect Owner Wallet to Base to Manage Notes) <ConnectButton label="Connect Owner (Base)" chainStatus="none" accountStatus="address" /></div>
                )
            )}
            {!isIdentityFullyVerified && (
                 <div>  ├─ Delegation Notes: ⚪ (Blocked by Operator Sub-Entry Setup)</div>
            )}
            <div>  │</div>
            <div>  └─ Funding</div>
            {/* Operator TBA Funding */} 
            {checks.operatorTba && (
                <>
                    <div>     │ ├─ Operator TBA: <code>{truncateString(checks.operatorTba)}</code> 
                        <CopyToClipboardText textToCopy={checks.operatorTba}>
                            <button className="button very-small-button" style={{marginLeft: '5px', padding: '2px 5px', fontSize:'0.8em'}}>Copy Addr</button>
                        </CopyToClipboardText>
                    </div>
                    <div>     │ │  ETH : {getFundingText('tbaEth')}</div>
                    <div>     │ │  USDC : {getFundingText('tbaUsdc')}</div>
                </>
            )}
            {/* Hot Wallet Funding */} 
            {checks.hotWalletAddress && (
                 <>
                    <div>     │ {(checks.operatorTba ? '├' : '└') }─ Hot Wallet: <code>{truncateString(checks.hotWalletAddress)}</code> 
                        <CopyToClipboardText textToCopy={checks.hotWalletAddress}>
                            <button className="button very-small-button" style={{marginLeft: '5px', padding: '2px 5px', fontSize:'0.8em'}}>Copy Addr</button>
                        </CopyToClipboardText>
                    </div>
                    <div>     │    │ ETH : {getFundingText('hwEth')}</div>
                </>
            )}
            {/* Display overall funding status and errors */}
            {!checks.operatorTba && !checks.hotWalletAddress && !checks.fundingStatus && (
                 <div>     │ (Funding status pending previous steps)</div>
            )}
            
            <br/>
            {onChainTxHash && <p>Tx Submitted: {truncateString(onChainTxHash)} {isOnChainActionConfirming && "Confirming..."}</p>}
            {onChainError && <p style={{color: 'red'}}>Error: {onChainError}</p>}
        </div>
    );
};

export default SimpleSetupVisualizer; 
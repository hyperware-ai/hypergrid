import React, { useState, useEffect, useCallback } from 'react';
import { WalletSummary, WalletListData, OnboardingStatusResponse, OnboardingStatus, OnboardingCheckDetails } from '../logic/types';
import CopyToClipboardText from './CopyToClipboardText';
import { useAccount, useChainId, useWriteContract, useWaitForTransactionReceipt, useContractRead, useConfig, usePublicClient } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { readContract } from 'wagmi/actions';
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

// --- Constants ---
const BASE_CHAIN_ID = 8453;
const HYPERMAP_ADDRESS = '0x000000000044C6B8Cb4d8f0F889a3E47664EAeda' as ViemAddress;
const OPERATOR_TBA_IMPLEMENTATION = '0x000000000046886061414588bb9F63b6C53D8674' as ViemAddress;
const OLD_HYPER_ACCOUNT_IMPL = '0x0000000000EDAd72076CBe7b9Cfa3751D5a85C97' as ViemAddress;

// --- ABI Change: Use 4-argument mint signature --- 
const hypermapAbi = parseAbi([
  'function note(bytes calldata note, bytes calldata data) external returns (bytes32 labelhash)',
  // Use 4-arg mint matching old explorer
  'function mint(address owner, bytes calldata label, bytes calldata initData, address implementation) external returns (address tba)', 
  'function fact(bytes calldata key, bytes calldata value) external returns (bytes32 factHash)', 
  // Keep get for parent TBA lookup
  'function get(bytes32 node) external view returns (address tba, address owner, bytes memory note)'
]);
// --- End ABI Change ---

const mechAbi = parseAbi([
  'function execute(address target, uint256 value, bytes calldata data, uint8 operation) payable returns (bytes memory returnData)',
]);

// --- API --- 
const callApi = async (endpoint: string, body: any): Promise<any> => {
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'include',
    });
    let data;
    try { data = await response.json(); } catch (e) { data = { error: await response.text() || `API Error: ${response.status}` }; }
    if (!response.ok) { throw new Error(data.error || `API Error: ${response.status}`); }
    return data;
};
const truncateString = (str: string | null | undefined, len: number = 10): string => {
    if (!str) return '-'; 
    if (str.length <= len + 3) return str; 
    const prefix = str.startsWith('0x') ? '0x' : '';
    const addressPart = prefix ? str.substring(2) : str;
    const visibleLen = len - prefix.length - 3; 
    if (visibleLen <= 1) return prefix + '...'; 
    const start = prefix + addressPart.substring(0, Math.ceil(visibleLen / 2));
    const end = addressPart.substring(addressPart.length - Math.floor(visibleLen / 2));
    return `${start}...${end}`;
}
const getApiBasePath = () => {
    const pathParts = window.location.pathname.split('/').filter(p => p);
    console.log("DEBUG: pathParts:", pathParts);
    const processIdPart = pathParts.find(part => part.includes(':'));
    console.log("DEBUG: processIdPart found:", processIdPart);
    const result = processIdPart ? `/${processIdPart}/api` : '/api';
    console.log("DEBUG: getApiBasePath returns:", result);
    return result;
};
const API_BASE_URL = getApiBasePath();
console.log("DEBUG: API_BASE_URL:", API_BASE_URL);
const MCP_ENDPOINT = `${API_BASE_URL}/mcp`;
const ONBOARDING_STATUS_ENDPOINT = `${API_BASE_URL}/onboarding-status`;
console.log("DEBUG: ONBOARDING_STATUS_ENDPOINT:", ONBOARDING_STATUS_ENDPOINT);

// --- Component ---
const SetupWizard: React.FC = () => {
    // --- State --- 
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);
    const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
    const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
    const [onboardingData, setOnboardingData] = useState<OnboardingStatusResponse | null>(null);
    const [newWalletPassword, setNewWalletPassword] = useState<string>('');
    const [confirmNewPassword, setConfirmNewPassword] = useState<string>('');
    const [activationPassword, setActivationPassword] = useState<string>('');
    const [walletsForSelection, setWalletsForSelection] = useState<WalletSummary[]>([]);
    const [selectedForActivationId, setSelectedForActivationId] = useState<string | null>(null);
    const { address: ownerWalletAddress, isConnected: isOwnerWalletConnected } = useAccount();
    const ownerWalletChainId = useChainId();
    const [nodeName, setNodeName] = useState<string | null>(null);
    const [parentTbaAddress, setParentTbaAddress] = useState<ViemAddress | null>(null);
    const [parentTbaOwner, setParentTbaOwner] = useState<ViemAddress | null>(null);
    const [onChainTxHash, setOnChainTxHash] = useState<`0x${string}` | undefined>(undefined);
    const [onChainError, setOnChainError] = useState<string | null>(null); 
    const { data: onChainActionHash, writeContract: executeOnChainAction, writeContractAsync, reset, isPending: isOnChainActionPending, error: writeContractHookError } = useWriteContract(); 
    const { isLoading: isOnChainActionConfirming, isSuccess: isOnChainActionConfirmed, error: txReceiptError } = useWaitForTransactionReceipt({ hash: onChainActionHash, chainId: BASE_CHAIN_ID });
    const [currentActionName, setCurrentActionName] = useState<'mint' | 'setSignersNote' | 'setAccessListNote' | null>(null);
    const [signersNoteFullNameForAccessList, setSignersNoteFullNameForAccessList] = useState<string | null>(null);
    const wagmiConfig = useConfig();
    const [nodeTbaImplementation, setNodeTbaImplementation] = useState<string | null>(null);
    const [isCheckingImpl, setIsCheckingImpl] = useState<boolean>(false);
    const [implCheckError, setImplCheckError] = useState<string | null>(null);

    // Get public client for getStorageAt
    const publicClient = usePublicClient({ chainId: BASE_CHAIN_ID });

    // --- Toast Helper (Memoized) --- 
    const showToast = useCallback((type: 'success' | 'error', text: string, duration: number = 4000) => {
        setToastMessage({ type, text });
        setTimeout(() => setToastMessage(null), duration);
    }, [setToastMessage]); // Dependency on state setter (stable)

    // --- Helper to fetch wallet list (Memoized) ---
    const fetchWalletListForSelection = useCallback(async () => {
        try {
            const walletData = await callApi(MCP_ENDPOINT, { GetWalletSummaryList: {} }) as WalletListData;
            setWalletsForSelection(walletData.wallets || []);
            setSelectedForActivationId(walletData.selected_id || null);
            // Log the fetched wallet data for debugging hot wallet address source
            console.log("Fetched wallet list:", walletData);
        } catch (err) {
            console.error("Error fetching wallet list:", err);
            showToast('error', 'Failed to fetch wallet list.');
        }
    }, [showToast]);

    // --- Fetch Onboarding Status (Depends on Memoized fetchWalletListForSelection) --- 
    const fetchOnboardingStatus = useCallback(async (showErrorToast = false) => {
        console.log("--> fetchOnboardingStatus called");
        setIsLoading(true); 
        if (showErrorToast) setError(null);
        setToastMessage(null);
        console.log("    Set isLoading=true. Fetching from:", ONBOARDING_STATUS_ENDPOINT);
        try {
            const response = await fetch(ONBOARDING_STATUS_ENDPOINT);
            console.log("    Fetch response status:", response.status);
            if (!response.ok) {
                 const errText = await response.text();
                 console.error("    Fetch response NOT ok:", errText);
                 throw new Error(`Onboarding Status Check Failed: ${response.status} - ${errText}`);
            }
            const data: OnboardingStatusResponse = await response.json();
            console.log("Raw onboarding data fetched:", JSON.stringify(data)); 
            setOnboardingData(data);
             // Add log here too
            console.log("Onboarding data state set. checks object:", JSON.stringify(data?.checks));
            setError(null);

            // Existing logic: if hot wallet needed or not set in checks, fetch wallet list
            if (data.status === OnboardingStatus.NeedsHotWallet || (data.status !== OnboardingStatus.Ready && !data.checks?.hotWalletAddress)) {
                console.log("Triggering fetchWalletListForSelection based on onboarding status...");
                fetchWalletListForSelection();
            }
        } catch (err) {
            console.error("!!! Error inside fetchOnboardingStatus try/catch:", err);
            const errorMsg = err instanceof Error ? err.message : 'Unknown error';
            if (showErrorToast) showToast('error', `Failed to get setup status: ${errorMsg}`);
            else setError(errorMsg);
            setOnboardingData(null);
            console.log("    Set onboardingData=null and error state in catch block");
        } finally {
            console.log("--> Setting isLoading=false in finally block");
             setIsLoading(false);
        }
    }, [fetchWalletListForSelection, showToast]); // Add showToast dependency here too

    // Mount effect - now fetchOnboardingStatus should be stable
    useEffect(() => {
        fetchOnboardingStatus();
    }, [fetchOnboardingStatus]);

    // Update useEffect for setting nodeName
    useEffect(() => {
        console.log("DEBUG: Attempting to set nodeName (useEffect)...");
        const windowNodeName = (window as any).our?.node;
        if (windowNodeName) {
            setNodeName(windowNodeName);
            console.log("DEBUG: Set nodeName from window.our.node:", windowNodeName);
            return; 
        } 
        
        const operatorEntry = onboardingData?.checks?.operatorEntry;
        console.log("DEBUG: window.our.node not found, checking operatorEntry:", operatorEntry);
        if (operatorEntry && operatorEntry.startsWith("hpn-beta-wallet.")) {
            const derivedName = operatorEntry.substring("hpn-beta-wallet.".length);
            if (derivedName) {
                setNodeName(derivedName);
                console.log("DEBUG: Set nodeName derived from operatorEntry:", derivedName);
            } else {
                 console.warn("Could not derive node name from operatorEntry (empty after prefix):", operatorEntry);
                 setNodeName(null); 
            }
        } else {
            console.warn("Node name could not be determined from window or operatorEntry.");
            setNodeName(null); 
        }
    }, [onboardingData]); // Dependency remains onboardingData

    // Update useContractRead hook dependencies and usage
    const { 
        data: parentTbaData, 
        isLoading: parentTbaLoading, 
        isError: isParentTbaError,   
        error: parentTbaErrorData   
    } = useContractRead({
        address: HYPERMAP_ADDRESS,
        abi: hypermapAbi,
        functionName: 'get',
        args: nodeName ? [viemNamehash(nodeName)] : undefined,
        chainId: BASE_CHAIN_ID,
    });

    // Update useEffect for processing Parent TBA data dependencies
    useEffect(() => {
        console.log("DEBUG: Parent TBA useEffect running.", { 
            parentTbaData, 
            parentTbaLoading, 
            isParentTbaError,
            parentTbaErrorData 
        });
        if (parentTbaLoading) {
            console.log("DEBUG: Parent TBA data is loading...");
            return; // Wait for loading to finish
        }
        if (isParentTbaError || !parentTbaData) {
             console.error("DEBUG: Error or no data fetching Parent TBA:", parentTbaErrorData);
             setParentTbaAddress(null);
             setParentTbaOwner(null);
        } else if (Array.isArray(parentTbaData) && parentTbaData.length >= 2) {
            const tba = parentTbaData[0] as ViemAddress;
            const owner = parentTbaData[1] as ViemAddress;
            setParentTbaAddress(tba);
            setParentTbaOwner(owner);
            console.log(`DEBUG: Set Parent TBA state: Addr=${tba}, Owner=${owner}`);
        } else {
            console.warn("DEBUG: Parent TBA data received in unexpected format:", parentTbaData);
            setParentTbaAddress(null);
            setParentTbaOwner(null);
        }
    // Use renamed state variable in dependency array
    }, [parentTbaData, nodeName, parentTbaLoading, isParentTbaError, parentTbaErrorData]);

    // --- Step 1 Handlers --- 
    const handleGenerateAndEncrypt = async (e: React.FormEvent) => { /* ... implementation ... */ };
    const handleSelectWalletUIClick = async (walletId: string) => { /* ... implementation ... */ };
    const handleActivateSelectedWallet = async (e: React.FormEvent) => { /* ... implementation ... */ };

    // --- Step 2 Multi-Step Handlers --- 
    const handleMintOperatorSubEntry = async () => {
        setOnChainError(null); setOnChainTxHash(undefined); 
        
        // --- DERIVE displayHotWalletAddress INSIDE the handler ---
        let displayHotWalletAddress: string | null | undefined = onboardingData?.checks?.hotWalletAddress;
        console.log("Mint Handler: Initial displayHotWalletAddress from checks:", displayHotWalletAddress);
        if (!displayHotWalletAddress && walletsForSelection.length > 0 && selectedForActivationId) {
            console.log("Mint Handler: Attempting fallback from walletsForSelection..."); 
            const currentSelected = walletsForSelection.find(w => w.id === selectedForActivationId);
            console.log("Mint Handler Fallback: Found wallet:", currentSelected); 
            if (currentSelected?.is_active && currentSelected?.is_unlocked) { 
                displayHotWalletAddress = currentSelected.address;
                console.log("Mint Handler Fallback: Set displayHotWalletAddress:", displayHotWalletAddress);
            } else {
                 console.log("Mint Handler Fallback: Wallet not active/unlocked.");
            }
        }
        // --- END DERIVATION ---

        console.log("--- Mint Pre-check (Inside Handler) --- ");
        console.log("nodeName:", nodeName);
        console.log("displayHotWalletAddress:", displayHotWalletAddress); // Log the locally derived value
        console.log("parentTbaAddress (Node TBA):", parentTbaAddress);
        console.log("ownerWalletAddress (Connected Owner Wallet):", ownerWalletAddress);
        console.log("parentTbaOwner (Owner of Node TBA):", parentTbaOwner);
        console.log("---------------------------------------");
                
        // Check preconditions using the locally derived displayHotWalletAddress
        if (!nodeName || !displayHotWalletAddress || !parentTbaAddress || !ownerWalletAddress || !parentTbaOwner) { 
            showToast('error', 'Mint Error: Missing required info'); 
            console.error("Mint Error: Precondition failed.", { nodeName, displayHotWalletAddress, parentTbaAddress, ownerWalletAddress, parentTbaOwner });
            return; 
        }
        if (ownerWalletAddress.toLowerCase() !== parentTbaOwner?.toLowerCase()) { 
            showToast('error', 'Mint Error: Connected wallet does not match Node TBA owner.'); 
             console.error("Mint Error: Wallet mismatch.", { ownerWalletAddress, parentTbaOwner });
            return; 
        }
        try {
            setCurrentActionName('mint');
            showToast('success', `Preparing Mint (1/3) [Using 4-arg ABI & Packed Label]...`); 
            console.log("--- Preparing Mint Transaction (Using 4-arg ABI & Packed Label) --- ");

            const subEntryLabelForMint = "hpn-beta-wallet";
            const whoArg = ownerWalletAddress!; // Arg 1: owner
            
            // --- Encoding Change: Use encodePacked for label --- 
            const labelArg = encodePacked(['bytes'], [stringToHex(subEntryLabelForMint)]); // Arg 2: label (bytes, packed)
            // --- End Encoding Change ---
            
            const initArg = bytesToHex(new Uint8Array([])); // Arg 3: initData (bytes)
            const implArg = OPERATOR_TBA_IMPLEMENTATION; // Arg 4: implementation (address) - Still use NEW impl address

            // Prepare inner calldata using 4-arg ABI
            const mintCalldata = encodeFunctionData({ 
                abi: hypermapAbi, 
                functionName: 'mint', 
                // Use 4 arguments matching the modified ABI
                args: [whoArg, labelArg, initArg, implArg]
            }); 
            
            const txAddress = parentTbaAddress!; // Executor (Node TBA)
            const txArgs = [HYPERMAP_ADDRESS, 0n, mintCalldata, 0 as const] as const;

            // --- Log Pertinent Details --- 
            console.log("\n=== Mint Transaction Details (4-arg ABI Test) ===");
            console.log(`  Signer (Owner Wallet): ${ownerWalletAddress}`);
            console.log(`  Executor (Node TBA):   ${txAddress}`);
            console.log(`  Target (Executor Calls): ${txArgs[0]} (Hypermap)`);
            console.log(`  Execute Arg [2] (data):   ${txArgs[2]}`); // Log full calldata
            console.log("    --- Decoded Inner Call (data arg) --- ");
            console.log(`      Target Function: hypermap.mint(address, bytes, bytes, address) [4-arg ABI]`);
            console.log(`      Arg [0] (owner):        ${whoArg}`);
            console.log(`      Arg [1] (label):        (Packed Hex: ${labelArg})`);
            console.log(`      Arg [2] (initData):     (empty) (Hex: ${initArg})`);
            console.log(`      Arg [3] (implementation): ${implArg}`);
            console.log("============================================\n");
            // --- End Log ---
            
            console.log(`Calling executeOnChainAction (Mint - 4-arg ABI Test) on Node TBA ${txAddress}`);
            executeOnChainAction({ address: txAddress, abi: mechAbi, functionName: 'execute', args: txArgs, chainId: BASE_CHAIN_ID });
        } catch (err) { 
            console.error("Mint Prep Error (4-arg ABI Test):", err); 
            setOnChainError(err instanceof Error ? err.message : 'Mint prep error (4-arg ABI Test)'); 
            setCurrentActionName(null); 
        }
    };
    const handleSetSignersNote = async () => {
        const operatorTba = onboardingData?.checks?.operatorTba as ViemAddress | undefined;
        setOnChainError(null); setOnChainTxHash(undefined);
        let displayHotWalletAddress = onboardingData?.checks?.hotWalletAddress; 
        if (!operatorTba || !displayHotWalletAddress) { 
            showToast('error', 'Signers Note Error: Missing Operator TBA or Hot Wallet Address'); 
            setCurrentActionName(null); return; 
        }
        const hotWalletAddr = displayHotWalletAddress as ViemAddress; // Cast for encoding
        try {
            setCurrentActionName('setSignersNote');
            
            const signersNoteKey = "~hpn-beta-signers";
            const operatorTbaFullName = `hpn-beta-wallet.${nodeName || 'unknown'}`;
            const fullSignersNoteNameForAccessListLogic = `~hpn-beta-signers.${operatorTbaFullName}`;
            setSignersNoteFullNameForAccessList(fullSignersNoteNameForAccessListLogic); 

            showToast('success', `Preparing Set Signers Note (2/3)...`); 
            // Update Log Message
            console.log(`--- Step 2/3: Setting Signers Note (Using short key: ${signersNoteKey}, REVERTING to ABI-encoded address[] value) --- `);

            const noteKeyBytes = stringToHex(signersNoteKey); 
            
            // --- REVERT VALUE ENCODING to ABI-encoded address[] ---
            let noteValueBytes: `0x${string}`;
            try {
                noteValueBytes = encodeAbiParameters(
                    parseAbiParameters('address[]'),
                    [[hotWalletAddr]] // Encode the address in an array
                );
                console.log(`   Key Bytes: ${noteKeyBytes}`);
                console.log(`   Value Bytes (ABI-encoded [${hotWalletAddr}]): ${noteValueBytes}`);
            } catch (encodingError) {
                console.error("!!! SetupWizard: Error ABI-encoding hotWalletAddress for Signer Note:", encodingError);
                const errorMsg = encodingError instanceof Error ? encodingError.message : 'Unknown error during ABI encoding.';
                setOnChainError(`ABI Encoding Error: ${errorMsg}`);
                setCurrentActionName(null);
                return;
            }
            // --- End REVERT ---

            const noteCalldata = encodeFunctionData({ abi: hypermapAbi, functionName: 'note', args: [noteKeyBytes, noteValueBytes] }); 
            const txAddress = operatorTba;
            const txArgs = [HYPERMAP_ADDRESS, 0n, noteCalldata, 0 as const] as const;
            // Update Log Message
            console.log(`Calling executeOnChainAction (Set Signers Note with short key, ABI value) on Operator TBA ${txAddress}`);
            executeOnChainAction({ address: txAddress, abi: mechAbi, functionName: 'execute', args: txArgs, chainId: BASE_CHAIN_ID });
        } catch (err) { 
            console.error("SetSignersNote Prep Error:", err); 
            setOnChainError(err instanceof Error ? err.message : 'Signers note prep error'); 
            setCurrentActionName(null); 
        }
    };
    const handleSetAccessListNote = async () => {
        const operatorTba = onboardingData?.checks?.operatorTba as ViemAddress | undefined;
        setOnChainError(null); setOnChainTxHash(undefined);
        
        const operatorTbaFullName = `hpn-beta-wallet.${nodeName || 'unknown'}`;
        const signersNoteFullNameToHash = `~hpn-beta-signers.${operatorTbaFullName}`;

        if (!nodeName || !operatorTba) { 
            showToast('error', 'Access List Note Error: Missing Info (nodeName or OperatorTBA)'); 
            setCurrentActionName(null); return; 
        }
        try {
            setCurrentActionName('setAccessListNote');
            
            const accessListNoteKey = "~hpn-beta-access-list";
            
            showToast('success', `Preparing Set Access List Note (3/3)...`); 
            console.log(`--- Step 3/3: Setting Access List Note (Using short key: ${accessListNoteKey}, hex namehash value) --- `);

            const noteKeyBytes = stringToHex(accessListNoteKey); 

            // Calculate the VALUE (32-byte namehash) and convert to HEX STRING
            const namehashOfSignersNoteBytes = viemNamehash(signersNoteFullNameToHash);
            const noteDataForAccessList = toHex(namehashOfSignersNoteBytes);
            
            console.log(`   Key Bytes (Short Key): ${noteKeyBytes}`);
            console.log(`   Value Bytes (Hex of Namehash of ${signersNoteFullNameToHash}): ${noteDataForAccessList}`);

            const noteCalldata = encodeFunctionData({ 
                abi: hypermapAbi, 
                functionName: 'note', 
                 // Pass hex string for key and hex string for value
                args: [noteKeyBytes, noteDataForAccessList] 
            }); 
            
            const txAddress = operatorTba;
            const txArgs = [HYPERMAP_ADDRESS, 0n, noteCalldata, 0 as const] as const;
            console.log(`Calling executeOnChainAction (Set Access List Note with short key, hex value) on Operator TBA ${txAddress}`);
            executeOnChainAction({ address: txAddress, abi: mechAbi, functionName: 'execute', args: txArgs, chainId: BASE_CHAIN_ID });
        } catch (err) { 
            console.error("SetAccessListNote Prep Error:", err); 
            // Removed specific check for encoding error as we are back to hex string
            setOnChainError(err instanceof Error ? err.message : 'Access list note prep error'); 
            setCurrentActionName(null); 
        }
    };

    // --- Effect for Manual Sequential Flow (No Chaining) --- 
    useEffect(() => {
        let actionCompleted = currentActionName; 
        if (isOnChainActionConfirmed && onChainActionHash && actionCompleted) {
            console.log(`Confirmation received for action: ${actionCompleted}`);
            showToast('success', `Action (${actionCompleted}) confirmed! Hash: ${truncateString(onChainActionHash)}`);
            setCurrentActionName(null); setOnChainTxHash(undefined); setOnChainError(null);
            // Fetch status AFTER confirmed to see if next step is needed
            fetchOnboardingStatus(true); 
        }
        if (txReceiptError && actionCompleted) { 
             const errorMsg = (txReceiptError as Error)?.message || `${actionCompleted} tx confirmation failed`;
             console.error(`Error during ${actionCompleted} tx confirmation:`, txReceiptError);
             setOnChainError(errorMsg);
             showToast('error', `On-chain confirmation error (${actionCompleted}): ${errorMsg}`);
             setCurrentActionName(null); 
        }
    }, [isOnChainActionConfirmed, onChainActionHash, txReceiptError, currentActionName, fetchOnboardingStatus]);
    
    // --- Other Effects --- 
    useEffect(() => { if (onChainActionHash) setOnChainTxHash(onChainActionHash); }, [onChainActionHash]);
    useEffect(() => { 
        if (writeContractHookError) { 
            console.error("!!! Wagmi Hook Error:", writeContractHookError);
            showToast('error', `Wallet Interaction Error: ${writeContractHookError.message}`);
            setCurrentActionName(null); 
        }
     }, [writeContractHookError]);

    // --- Helper Function to Get Status Text for Checklist Item --- 
    const getChecklistItemStatus = (checkType: 'identity' | 'signersNote' | 'accessListNote', checks: OnboardingCheckDetails): React.ReactNode => {
        // Destructure needed fields from checks
        const { identityStatus, delegationStatus, identityConfigured, delegationVerified, fundingStatus, operatorTba, tbaEthBalanceStr, tbaUsdcBalanceStr, hotWalletEthBalanceStr, tbaEthFunded, tbaUsdcFunded, hotWalletEthFunded } = checks;

        switch (checkType) {
            case 'identity':
                if (!identityStatus) return identityConfigured ? '❓ (Unknown Status)' : '❌ (Not Checked/Failed)';
                const is = identityStatus as any;
                if (typeof is === 'object' && is !== null) {
                    if ('verified' in is) return `✅ Verified (TBA: ${truncateString(operatorTba)})`; // Use destructured operatorTba
                    if ('notFound' in is) return `❌ Not Found`;
                    if ('incorrectImplementation' in is) return `❌ Incorrect Implementation (Found: ${truncateString(is.incorrectImplementation.found)})`;
                    if ('implementationCheckFailed' in is) return `❓ Error Checking Implementation (${is.implementationCheckFailed})`;
                    if ('checkError' in is) return `❓ Check Error (${is.checkError})`;
                    return `❓ Unknown (${JSON.stringify(is)})`;
                } else {
                    return `❓ Invalid Status Format`;
                }

            case 'signersNote':
                if (!identityConfigured) return `⚪ (Blocked by Identity)`;
                // Use destructured delegationVerified
                if (!delegationStatus) return delegationVerified === null ? '❓ (Checking...)' : '❓ (Unknown Status)'; 
                const ds_signer = delegationStatus as any;
                 if (typeof ds_signer === 'string' && ds_signer === 'verified') return '✅ Set Correctly';
                 if (typeof ds_signer === 'object' && ds_signer !== null && ('accessListNoteMissing' in ds_signer || 'accessListNoteInvalidData' in ds_signer)) return '✅ Set Correctly';
                 if (typeof ds_signer === 'string' && ds_signer === 'signersNoteMissing') return '❌ Missing';
                 if (typeof ds_signer === 'object' && ds_signer !== null && 'signersNoteLookupError' in ds_signer) return `❌ Lookup Error (${ds_signer.signersNoteLookupError})`;
                 if (typeof ds_signer === 'object' && ds_signer !== null && 'signersNoteInvalidData' in ds_signer) return `❌ Invalid Data (${ds_signer.signersNoteInvalidData})`;
                 if (typeof ds_signer === 'string' && ds_signer === 'hotWalletNotInList') return '❌ Value Mismatch';
                 if (typeof ds_signer === 'object' && ds_signer !== null && 'checkError' in ds_signer) return `❓ Check Error (${ds_signer.checkError})`;
                 if (ds_signer === 'needsIdentity' || ds_signer === 'needsHotWallet') return `⚪ (${ds_signer})`;
                 return `❓ Unknown (${JSON.stringify(ds_signer)})`;
                 
            case 'accessListNote':
                 if (!identityConfigured) return `⚪ (Blocked by Identity)`;
                 // Use destructured delegationVerified
                 if (!delegationStatus) return delegationVerified === null ? '❓ (Checking...)' : '❓ (Unknown Status)'; 
                 const ds_al = delegationStatus as any;
                  if (typeof ds_al === 'string' && ds_al === 'verified') return '✅ Set Correctly';
                  if (typeof ds_al === 'string' && (ds_al === 'signersNoteMissing' || ds_al === 'hotWalletNotInList')) return '✅ Found';
                  if (typeof ds_al === 'object' && ds_al !== null && ('signersNoteInvalidData' in ds_al || 'signersNoteLookupError' in ds_al)) return '✅ Found';
                  if (typeof ds_al === 'string' && ds_al === 'accessListNoteMissing') return '❌ Missing';
                  if (typeof ds_al === 'object' && ds_al !== null && 'accessListNoteInvalidData' in ds_al) return `❌ Invalid Data (${ds_al.accessListNoteInvalidData})`;
                  if (typeof ds_al === 'object' && ds_al !== null && 'checkError' in ds_al) return `❓ Check Error (${ds_al.checkError})`;
                  if (ds_al === 'needsIdentity' || ds_al === 'needsHotWallet') return `⚪ (${ds_al})`;
                  return `❓ Unknown (${JSON.stringify(ds_al)})`;
        }
    };

    // --- Function to Check Node TBA Implementation ---
    const checkNodeTbaImplementation = useCallback(async () => {
        if (!parentTbaAddress) {
            showToast('error', "Node TBA address not available yet.");
            return;
        }
        if (!publicClient) {
             showToast('error', "Blockchain client not available.");
             return;
        }

        setIsCheckingImpl(true);
        setNodeTbaImplementation(null);
        setImplCheckError(null);
        console.log(`Checking implementation for Node TBA: ${parentTbaAddress}`);

        try {
            const storageSlot = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc' as const;
            const result = await publicClient.getStorageAt({
                address: parentTbaAddress,
                slot: storageSlot,
            });

            console.log(`Raw storage result for slot ${storageSlot}:`, result);

            if (result) {
                // Implementation address is last 20 bytes (40 hex chars)
                // Ensure the result is long enough and format it
                if (result.length >= 42) { // 0x + 40 hex chars = 42
                    const addressBytes = result.slice(-40); // Get last 40 hex chars
                    const formattedAddress = getAddress(`0x${addressBytes}`); // Format as checksum address
                    setNodeTbaImplementation(formattedAddress);
                     showToast('success', `Found implementation: ${formattedAddress}`);
                } else {
                     throw new Error("Storage slot data too short for an address.");
                }
            } else {
                throw new Error("No data found at implementation storage slot.");
            }
        } catch (err) {
            console.error("Error checking Node TBA implementation:", err);
            const errorMsg = err instanceof Error ? err.message : "Unknown error";
            setImplCheckError(`Failed: ${errorMsg}`);
            showToast('error', `Failed to check implementation: ${errorMsg}`);
        } finally {
            setIsCheckingImpl(false);
        }
    }, [parentTbaAddress, publicClient, showToast]);

    // --- Render Logic Preparation --- 
    if (isLoading) { 
        return <div className="setup-wizard-container config-section"><p>Loading initial setup status...</p></div>; 
    }
    if (error && !onboardingData) { 
        return <div className="setup-wizard-container config-section error-message"><h2>Error</h2><p>{error}</p><button onClick={() => fetchOnboardingStatus(true)}>Retry</button></div>; 
    }
    if (!onboardingData) { 
        return <div className="setup-wizard-container"><p>Waiting for onboarding data response...</p></div>; 
    }
    
    const { status, checks, errors: backendErrors } = onboardingData!;
    
    // Derivation for display can still happen here, but handlers will re-derive
    let displayHotWalletAddressForRender: string | null | undefined = checks.hotWalletAddress; 
    if (!displayHotWalletAddressForRender && walletsForSelection.length > 0) {
        const currentSelected = walletsForSelection.find(w => w.id === selectedForActivationId);
        if (currentSelected?.is_active && currentSelected?.is_unlocked) {
            displayHotWalletAddressForRender = currentSelected.address;
        }
    }
    const operatorTbaAddress = checks.operatorTba as ViemAddress | undefined;

    // Button disabled states - use the values available at render time 
    // or potentially disable more aggressively if onboardingData is null initially?
    // Using derived values available at render time:
    const mintDisabled = !ownerWalletAddress || !parentTbaAddress || !nodeName || !displayHotWalletAddressForRender || !parentTbaOwner || isOnChainActionPending || isOnChainActionConfirming;
    const setSignersDisabled = !operatorTbaAddress || !displayHotWalletAddressForRender || !ownerWalletAddress || isOnChainActionPending || isOnChainActionConfirming; 
    const setAccessListDisabled = !operatorTbaAddress || !nodeName || !ownerWalletAddress || isOnChainActionPending || isOnChainActionConfirming; 

    // --- Main Render --- 
    console.log("--- Rendering SetupWizard (camelCase check) ---");
    console.log("checks.identityConfigured in render:", checks?.identityConfigured);
    console.log("-----------------------------");

    return (
        <div className="setup-wizard-container config-section">
             <h2>Operator Setup Wizard</h2>
             {toastMessage && <div className={`toast-notification ${toastMessage.type}`}>{toastMessage.text}<button onClick={() => setToastMessage(null)}>&times;</button></div>}
             {backendErrors && backendErrors.length > 0 && 
                <div className="info-message backend-errors" style={{border: '1px solid orange', padding: '10px', margin:'10px 0', borderRadius: '4px'}}>
                    <h4>Status Info / Warnings / Errors:</h4>
                    <ul>{backendErrors.map((e, i) => <li key={i} style={{color: e.startsWith('Warning:') ? 'orange' : 'red'}}>{e}</li>)}</ul>
                </div>
              }
             <p>Welcome! Follow the steps below...</p>
             {/* Step 1: Hot Wallet */}
             <div className={`wizard-step ${status === OnboardingStatus.NeedsHotWallet ? 'active' : (checks.hotWalletSelectedAndActive ? 'complete' : '')}`}>
                 <h3>Step 1: Configure Hot Wallet</h3>
                 {status === OnboardingStatus.NeedsHotWallet && (
                     <div className="step-content">{/* ... Step 1 Form/List ... */}</div>
                 )}
                 {checks.hotWalletSelectedAndActive && displayHotWalletAddressForRender && (
                     <p style={{color: 'green'}}>✅ Hot Wallet Ready: <CopyToClipboardText textToCopy={displayHotWalletAddressForRender}><code>{truncateString(displayHotWalletAddressForRender)}</code></CopyToClipboardText></p>
                 )}
             </div>
             {/* Step 2: On-Chain Setup */} 
             <div className={`wizard-step ${status === OnboardingStatus.NeedsOnChainSetup || status === OnboardingStatus.NeedsFunding || status === OnboardingStatus.Ready ? 'active' : ''}`}>
                 <h3>Step 2: On-Chain Setup (Requires Node Owner Wallet)</h3>
                 {/* Owner Connect Section - Update Label */} 
                 <div className="owner-connect-section"> 
                     <ConnectButton /> 
                     {isOwnerWalletConnected && <p>Owner: <code>{truncateString(ownerWalletAddress)}</code></p>} 
                     {/* Changed label from Parent TBA to Node TBA */} 
                     {parentTbaAddress && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                             <p style={{ margin: '0' }}>Node TBA: <code>{truncateString(parentTbaAddress)}</code></p>
                             <button 
                                 onClick={checkNodeTbaImplementation}
                                 disabled={!parentTbaAddress || isCheckingImpl}
                                 className="button secondary-button small-button"
                                 title="Check ERC-1967 Implementation Slot"
                             >
                                 {isCheckingImpl ? 'Checking...' : 'Check Impl'}
                             </button>
                         </div>
                     )}
                     {/* Display Implementation Check Result */} 
                     {nodeTbaImplementation && <p style={{fontSize: '0.9em', margin:'5px 0 0 0'}}>↳ Implementation: <code>{nodeTbaImplementation}</code></p>}
                     {implCheckError && <p style={{fontSize: '0.9em', margin:'5px 0 0 0', color: 'red'}}>↳ {implCheckError}</p>}
                 </div>
                 
                 {/* Clearer Checklist Status Display Area */} 
                 <div className="step-content status-checklist" style={{marginBottom: '15px'}}>
                     <h4>Configuration Checklist:</h4>
                     {/* Render checklist using helper */} 
                     <ul>
                         <li>Operator Sub-Entry Valid (`hpn-beta-wallet...`): {getChecklistItemStatus('identity', checks)}</li>
                         <li>Signers Note Set (`~hpn-beta-signers`): {getChecklistItemStatus('signersNote', checks)}</li>
                         <li>Access List Note Set (`~hpn-beta-access-list`): {getChecklistItemStatus('accessListNote', checks)}</li>
                     </ul>
                 </div>

                {/* Action Buttons */} 
                <div className="step-content action-buttons">
                     {/* Button 1: Mint Operator TBA (Show only if identityConfigured is false) */} 
                     {!checks.identityConfigured && isOwnerWalletConnected && ownerWalletChainId === BASE_CHAIN_ID && parentTbaAddress && (
                         <button onClick={handleMintOperatorSubEntry} className="button primary-button" disabled={mintDisabled}>
                            {currentActionName === 'mint' && (isOnChainActionPending || isOnChainActionConfirming) ? 'Processing Mint...' : 'Mint Operator TBA (1/3)'}
                         </button>
                      )}
 
                     {/* Buttons 2 & 3: Set Notes (Show only if identityConfigured is true) */} 
                     {checks.identityConfigured && isOwnerWalletConnected && ownerWalletChainId === BASE_CHAIN_ID && (
                         <div style={{display: 'flex', gap: '10px', flexWrap: 'wrap'}}>
                              <button onClick={handleSetSignersNote} className="button primary-button" disabled={setSignersDisabled}>
                                 {currentActionName === 'setSignersNote' && (isOnChainActionPending || isOnChainActionConfirming) ? 'Processing Signers Note...' : 'Set Signers Note (2/3)'}
                              </button>
                              <button onClick={handleSetAccessListNote} className="button primary-button" disabled={setAccessListDisabled}>
                                 {currentActionName === 'setAccessListNote' && (isOnChainActionPending || isOnChainActionConfirming) ? 'Processing Access List...' : 'Set Access List Note (3/3)'}
                              </button>
                         </div>
                          )}
                    
                     {/* Wallet Connection/Network Warnings */} 
                     {!isOwnerWalletConnected && <p style={{color: 'orange', marginTop:'10px'}}>Connect Owner Wallet to proceed with on-chain setup.</p>}
                     {isOwnerWalletConnected && ownerWalletChainId !== BASE_CHAIN_ID && <p style={{color: 'red', marginTop:'10px'}}>Switch Owner Wallet to Base Network (ID: {BASE_CHAIN_ID}).</p>}
                     
                     {/* Transaction Status */} 
                     {onChainTxHash && 
                         <div className="tx-status" style={{marginTop:'15px'}}>
                             <p>Tx Submitted ({currentActionName || 'Action'}): <a href={`https://basescan.org/tx/${onChainTxHash}`} target="_blank" rel="noopener noreferrer">{truncateString(onChainTxHash)}</a></p>
                             {isOnChainActionConfirming && <p>Confirming...</p>}
                         </div>
                     }
                     {onChainError && <p className="error-message" style={{marginTop:'10px'}}>Error: {onChainError}</p>}
                     </div>
                 
                 {/* Overall Step Completion Message */} 
                 {checks.identityConfigured && checks.delegationVerified === true && (
                     <p style={{color: 'green', marginTop: '15px'}}>✅ On-Chain Setup Complete.</p>
                  )}
             </div>
            {/* Step 3: Funding */} 
             <div className={`wizard-step ${status === OnboardingStatus.NeedsFunding ? 'active' : ((checks.tbaEthFunded && checks.hotWalletEthFunded && checks.tbaUsdcFunded) ? 'complete' : '')}`}>
                 <h3>Step 3: Fund Accounts</h3>
                 {status === OnboardingStatus.NeedsFunding || status === OnboardingStatus.Ready ? (
                     <div className="step-content">
                         {/* Add console logs inside the conditional render */} 
                         {(() => {
                            console.log("--- Rendering Step 3 Funding Details ---");
                            console.log("checks.fundingStatus exists?", !!checks.fundingStatus);
                            console.log("checks.fundingStatus:", JSON.stringify(checks.fundingStatus));
                            console.log("tbaEthBalanceStr:", checks.fundingStatus?.tbaEthBalanceStr);
                            console.log("tbaNeedsEth:", checks.fundingStatus?.tbaNeedsEth);
                            console.log("-------------------------------------");
                            return null; // Console log doesn't render anything
                         })()}
                         
                         {checks.fundingStatus ? (
                            <>
                                <p>Operator TBA ({truncateString(operatorTbaAddress)}):<br/>
                                &nbsp;&nbsp;ETH Balance: {checks.fundingStatus.tbaEthBalanceStr || 'N/A'} {checks.fundingStatus.tbaNeedsEth ? <span style={{color:'red'}}>(Needs ETH)</span> : <span style={{color:'green'}}>(OK)</span>}<br/>
                                &nbsp;&nbsp;USDC Balance: {checks.fundingStatus.tbaUsdcBalanceStr || 'N/A'} {checks.fundingStatus.tbaNeedsUsdc ? <span style={{color:'red'}}>(Needs USDC)</span> : <span style={{color:'green'}}>(OK)</span>}
                                </p>
                                <p>Hot Wallet ({truncateString(displayHotWalletAddressForRender)}):<br/>
                                &nbsp;&nbsp;ETH Balance: {checks.fundingStatus.hotWalletEthBalanceStr || 'N/A'} {checks.fundingStatus.hotWalletNeedsEth ? <span style={{color:'red'}}>(Needs ETH)</span> : <span style={{color:'green'}}>(OK)</span>}
                                </p>
                                {checks.fundingStatus.checkError && <p className="error-message">Error checking balances: {checks.fundingStatus.checkError}</p>}
                            </>
                         ) : (
                            <p>
                                TBA ETH Funded: {checks.tbaEthFunded ? '✅' : '❌'} | 
                                TBA USDC Funded: {checks.tbaUsdcFunded ? '✅' : '❌'} | 
                                Hot Wallet ETH Funded: {checks.hotWalletEthFunded ? '✅' : '❌'}
                            </p>
                         )}
                     </div>
                 ) : (
                     <div className="step-content"><p>(Funding check pending previous steps)</p></div>
                 )}
                 {(checks.tbaEthFunded && checks.hotWalletEthFunded && checks.tbaUsdcFunded) && (
                     <p style={{color: 'green'}}>✅ Funding Sufficient.</p>
                 )}
             </div>
             {/* Ready State */} 
             {status === OnboardingStatus.Ready && (
                  <div className="wizard-step complete"><h3>Setup Complete!</h3><p style={{color: 'green'}}>✅ Ready.</p></div>
             )}
        </div>
    );
};

export default SetupWizard; 
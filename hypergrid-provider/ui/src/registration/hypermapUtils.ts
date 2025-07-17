import { useState, useEffect, useCallback } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { encodePacked, stringToHex, decodeEventLog, type Address } from 'viem';
import { 
  GRID_BETA_1_ADDRESS, 
  HYPERMAP_ADDRESS,
  hyperGridNamespaceMinterAbi,
  generateNoteCall,
  tbaExecuteAbi,
  erc6551RegistryAbi,
  PROVIDER_NOTE_KEYS
} from './hypermap';
import { RegisteredProvider } from '../types/hypergrid_provider';

export type ProviderRegistrationStep = 'idle' | 'minting' | 'notes' | 'complete';

export interface ProviderRegistrationState {
  isRegistering: boolean;
  step: ProviderRegistrationStep;
  mintedProviderAddress: Address | null;
  currentNoteIndex: number;
  pendingProviderData: RegisteredProvider | null;
  error: string | null;
  notesToSet: Array<{ key: string; value: string }>;
  processedTxHashes: Set<string>;
  isProcessingNote: boolean;
}

export interface ProviderRegistrationCallbacks {
  onRegistrationComplete: (providerAddress: Address) => void;
  onRegistrationError: (error: string) => void;
}

/**
 * Extract TBA address from transaction receipt logs
 */
function extractTbaAddressFromLogs(logs: any[], providerName: string): Address | null {
  try {
    console.log('Analyzing transaction logs for TBA address...');
    
    for (const [index, log] of logs.entries()) {
      console.log(`Log ${index}:`, {
        address: log.address,
        topics: log.topics,
        data: log.data
      });
      
      // Check if this is an ERC6551AccountCreated event by looking at the event signature
      // ERC6551AccountCreated event signature: 0x79f19b3655ee38b1ce526556b7731a20c8f218fbda4a3990b6cc4172fdf88722
      if (log.topics && log.topics[0] === '0x79f19b3655ee38b1ce526556b7731a20c8f218fbda4a3990b6cc4172fdf88722') {
        console.log(`Found ERC6551AccountCreated event, parsing data field directly...`);
        
        // Parse the data field directly
        // Data structure: account (32 bytes padded) + salt (32 bytes) + chainId (32 bytes)
        // Account is 20 bytes padded to 32 bytes, so we skip first 12 bytes (24 hex chars)
        if (log.data && log.data.length >= 66) { // 0x + 64 chars minimum for first 32 bytes
          const dataWithoutPrefix = log.data.slice(2); // Remove '0x'
          
          // Skip first 24 hex characters (12 bytes of padding) and take next 40 characters (20 bytes)
          const accountHex = '0x' + dataWithoutPrefix.slice(24, 64);
          
          console.log(`Extracted TBA address from data field: ${accountHex}`);
          return accountHex as Address;
        } else {
          console.warn('ERC6551AccountCreated event found but data field is too short');
        }
      }
    }
    
  } catch (error) {
    console.error('Error parsing transaction logs:', error);
  }
  
  return null;
}

export function getRegistrationStepText(
  step: ProviderRegistrationStep,
  currentNoteIndex: number,
  isMinting: boolean,
  isSettingNotes: boolean,
  isMintTxLoading: boolean,
  isNotesTxLoading: boolean,
  totalNotes: number = 5,
): string {
  switch (step) {
    case 'minting':
      if (isMinting) return 'Creating provider entry on blockchain...';
      if (isMintTxLoading) return 'Waiting for transaction confirmation...';
      return 'Preparing to mint...';
    case 'notes':
      if (isSettingNotes) return `Setting metadata note ${currentNoteIndex + 1}/${totalNotes}...`;
      if (isNotesTxLoading) return `Waiting for note ${currentNoteIndex + 1}/${totalNotes} confirmation...`;
      return `Preparing to set note ${currentNoteIndex + 1}/${totalNotes}...`;
    case 'complete':
      return 'Provider successfully registered on-chain!';
    default:
      return 'Initializing...';
  }
}

export function useProviderRegistration(callbacks: ProviderRegistrationCallbacks) {
  const { address: walletAddress, isConnected: isWalletConnected } = useAccount();
  
  const [state, setState] = useState<ProviderRegistrationState>({
    isRegistering: false,
    step: 'idle',
    mintedProviderAddress: null,
    currentNoteIndex: 0,
    pendingProviderData: null,
    error: null,
    notesToSet: [],
    processedTxHashes: new Set(),
    isProcessingNote: false,
  });

  // Contract write hooks
  const { 
    writeContract: mintProvider,
    data: mintTxHash,
    error: mintError,
    isPending: isMinting,
    reset: resetMint
  } = useWriteContract();

  const { 
    writeContract: setNote,
    data: notesTxHash,
    error: notesError,
    isPending: isSettingNotes,
    reset: resetNote
  } = useWriteContract();

  // Transaction receipts
  const { 
    isLoading: isMintTxLoading, 
    isSuccess: isMintTxSuccess,
    data: mintTxReceipt 
  } = useWaitForTransactionReceipt({
    hash: mintTxHash,
  });

  const { 
    isLoading: isNotesTxLoading, 
    isSuccess: isNotesTxSuccess 
  } = useWaitForTransactionReceipt({
    hash: notesTxHash,
  });

  // Handle mint transaction success - extract TBA from logs and move to notes step
  useEffect(() => {
    if (isMintTxSuccess && mintTxReceipt && state.pendingProviderData && state.step === 'minting') {
      console.log('Mint transaction confirmed:', mintTxReceipt.transactionHash);
      
      // Extract TBA from transaction logs
      const extractedTbaAddress = extractTbaAddressFromLogs(
        mintTxReceipt.logs, 
        state.pendingProviderData.provider_name
      );
      
      if (extractedTbaAddress) {
        console.log('TBA address extracted:', extractedTbaAddress);
        setState(prev => ({
          ...prev,
          mintedProviderAddress: extractedTbaAddress,
          step: 'notes',
          currentNoteIndex: 0,
        }));
        // Reset mint transaction state to prevent re-triggering
        resetMint();
      } else {
        const errorMessage = 'Could not extract TBA address from transaction logs.';
        setState(prev => ({ 
          ...prev, 
          isRegistering: false, 
          step: 'idle',
          error: errorMessage,
          processedTxHashes: new Set(),
          isProcessingNote: false,
        }));
        callbacks.onRegistrationError(errorMessage);
        resetMint();
      }
    }
  }, [isMintTxSuccess, mintTxReceipt, state.pendingProviderData, state.step, callbacks, resetMint]);

  // Set up notes array when moving to notes step
  useEffect(() => {
    if (state.step === 'notes' && state.mintedProviderAddress && state.pendingProviderData && state.notesToSet.length === 0) {
      console.log('Preparing notes for sequential setting');
      
      const notesToSet = [
        { key: PROVIDER_NOTE_KEYS.PROVIDER_ID, value: state.pendingProviderData.provider_id },
        { key: PROVIDER_NOTE_KEYS.WALLET, value: state.pendingProviderData.registered_provider_wallet },
        { key: PROVIDER_NOTE_KEYS.DESCRIPTION, value: state.pendingProviderData.description },
        { key: PROVIDER_NOTE_KEYS.INSTRUCTIONS, value: state.pendingProviderData.instructions },
        { key: PROVIDER_NOTE_KEYS.PRICE, value: state.pendingProviderData.price.toString() },
      ];

      setState(prev => ({
        ...prev,
        notesToSet,
        currentNoteIndex: 0,
      }));
    }
  }, [state.step, state.mintedProviderAddress, state.pendingProviderData, state.notesToSet.length]);

    // Set notes sequentially, one at a time
  useEffect(() => {
    if (
      state.step === 'notes' && 
      state.mintedProviderAddress && 
      state.notesToSet.length > 0 && 
      state.currentNoteIndex < state.notesToSet.length &&
      !state.isProcessingNote &&
      !isSettingNotes && 
      !isNotesTxLoading
    ) {
      const currentNote = state.notesToSet[state.currentNoteIndex];
      console.log(`Setting note ${state.currentNoteIndex + 1}/${state.notesToSet.length}: ${currentNote.key} = ${currentNote.value}`);
      
      // Mark that we're processing this note
      setState(prev => ({ ...prev, isProcessingNote: true }));
      
      try {
        // Generate the hypermap note call
        const hypermapNoteCallData = generateNoteCall({ 
          noteKey: currentNote.key, 
          noteValue: currentNote.value 
        });

        // Call TBA.execute(HYPERMAP_ADDRESS, note_calldata)
        setNote({
          address: state.mintedProviderAddress,
          abi: tbaExecuteAbi,
          functionName: 'execute',
          args: [
            HYPERMAP_ADDRESS, // target: Hypermap contract
            0n,              // value: 0 ETH
            hypermapNoteCallData, // data: the note call
            0,               // operation: 0 for CALL
          ],
        } as any);
      } catch (error) {
        console.error('Failed to set note:', error);
        const errorMessage = `Failed to set note ${currentNote.key}: ${(error as Error).message}`;
        setState(prev => ({ 
          ...prev, 
          isRegistering: false, 
          step: 'idle',
          error: errorMessage,
          processedTxHashes: new Set(),
          isProcessingNote: false,
        }));
        callbacks.onRegistrationError(errorMessage);
      }
    }
  }, [state.step, state.mintedProviderAddress, state.notesToSet, state.currentNoteIndex, state.isProcessingNote, isSettingNotes, isNotesTxLoading, setNote, callbacks]);

  // Handle notes transaction success
  useEffect(() => {
    if (isNotesTxSuccess && state.step === 'notes' && notesTxHash && !state.processedTxHashes.has(notesTxHash)) {
      console.log('Processing note success:', {
        currentNoteIndex: state.currentNoteIndex,
        currentNote: state.notesToSet[state.currentNoteIndex],
        txHash: notesTxHash
      });
      
      const nextNoteIndex = state.currentNoteIndex + 1;
      
      console.log(`Note ${state.currentNoteIndex + 1} set successfully (tx: ${notesTxHash})`);
      console.log(`Current note was: ${state.notesToSet[state.currentNoteIndex]?.key}`);
      
      // Mark this transaction as processed
      setState(prev => ({
        ...prev,
        processedTxHashes: new Set([...prev.processedTxHashes, notesTxHash])
      }));
      
      // Reset transaction state to allow next transaction
      resetNote();
      
      if (nextNoteIndex < state.notesToSet.length) {
        // Move to next note
        console.log(`Moving to note ${nextNoteIndex + 1}`);
        setState(prev => ({
          ...prev,
          currentNoteIndex: nextNoteIndex,
          isProcessingNote: false, // Allow next note to be processed
        }));
      } else {
        // All notes set - complete the registration
        console.log('All notes set successfully, completing registration');
        setState(prev => ({
          ...prev,
          step: 'complete',
          isRegistering: false,
        }));
        
        if (state.mintedProviderAddress) {
          callbacks.onRegistrationComplete(state.mintedProviderAddress);
        }
        
        // Reset state for next registration
        setTimeout(() => {
          setState(prev => ({
            ...prev,
            step: 'idle',
            mintedProviderAddress: null,
            currentNoteIndex: 0,
            pendingProviderData: null,
            error: null,
            notesToSet: [],
            processedTxHashes: new Set(),
            isProcessingNote: false,
          }));
        }, 2000); // Give user time to see completion message
      }
    }
  }, [isNotesTxSuccess, state.step, state.currentNoteIndex, state.notesToSet.length, state.mintedProviderAddress, notesTxHash, state.processedTxHashes, callbacks, resetNote]);

  // Handle mint errors
  useEffect(() => {
    if (mintError) {
      console.error('Mint error:', mintError);
      const errorMessage = `Minting failed: ${mintError.message}`;
      setState(prev => ({ 
        ...prev, 
        isRegistering: false, 
        step: 'idle',
        error: errorMessage,
        processedTxHashes: new Set(),
        isProcessingNote: false,
      }));
      callbacks.onRegistrationError(errorMessage);
      resetMint();
    }
  }, [mintError, callbacks, resetMint]);

  // Handle notes errors
  useEffect(() => {
    if (notesError) {
      console.error('Notes error:', notesError);
      const errorMessage = `Setting note ${state.currentNoteIndex + 1} failed: ${notesError.message}`;
      setState(prev => ({ 
        ...prev, 
        isRegistering: false, 
        step: 'idle',
        error: errorMessage,
        processedTxHashes: new Set(),
        isProcessingNote: false,
      }));
      callbacks.onRegistrationError(errorMessage);
      resetNote();
    }
  }, [notesError, state.currentNoteIndex, callbacks, resetNote]);

  // Start blockchain registration
  const startRegistration = useCallback(async (provider: RegisteredProvider) => {
    if (!isWalletConnected || !walletAddress) {
      callbacks.onRegistrationError('Wallet not connected');
      return;
    }

          setState(prev => ({
        ...prev,
        isRegistering: true,
        step: 'minting',
        pendingProviderData: provider,
        error: null,
        processedTxHashes: new Set(),
        isProcessingNote: false,
      }));
    
    try {
      await mintProvider({
        address: GRID_BETA_1_ADDRESS,
        abi: hyperGridNamespaceMinterAbi,
        functionName: 'mint',
        args: [
          walletAddress,
          encodePacked(["bytes"], [stringToHex(provider.provider_name)]),
        ],
      } as any);
    } catch (error) {
      console.error('Failed to initiate blockchain minting:', error);
      const errorMessage = `Failed to start minting: ${(error as Error).message}`;
      setState(prev => ({ 
        ...prev, 
        isRegistering: false, 
        step: 'idle',
        error: errorMessage,
        processedTxHashes: new Set(),
        isProcessingNote: false,
      }));
      callbacks.onRegistrationError(errorMessage);
    }
  }, [isWalletConnected, walletAddress, mintProvider, callbacks]);

  return {
    ...state,
    isMinting,
    isSettingNotes,
    isMintTxLoading,
    isNotesTxLoading,
    mintError,
    notesError,
    startRegistration,
    totalNotesToSet: state.notesToSet.length,
  };
} 
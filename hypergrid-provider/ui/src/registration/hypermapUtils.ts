import { useState, useEffect, useCallback } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { encodePacked, stringToHex, decodeEventLog, type Address } from 'viem';
import { 
  GRID_BETA_1_ADDRESS, 
  hyperGridNamespaceMinterAbi,
  generateProviderNotesCallsArray,
  tbaExecuteAbi,
  erc6551RegistryAbi
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
): string {
  switch (step) {
    case 'minting':
      if (isMinting) return 'Creating provider entry on blockchain...';
      if (isMintTxLoading) return 'Waiting for transaction confirmation...';
      return 'Preparing to mint...';
    case 'notes':
      if (isSettingNotes) return 'Setting provider metadata notes...';
      if (isNotesTxLoading) return 'Waiting for notes transaction confirmation...';
      return 'Preparing to set notes...';
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

    // Set notes after minting - use multicall with DELEGATECALL
  useEffect(() => {
    if (state.step === 'notes' && state.mintedProviderAddress && state.pendingProviderData && !isSettingNotes && !isNotesTxLoading) {
      console.log('Setting notes via multicall with DELEGATECALL');
      
      try {
        const { tbaAddress, executeArgs } = generateProviderNotesCallsArray({
          tbaAddress: state.mintedProviderAddress,
          providerId: state.pendingProviderData.provider_id,
          wallet: state.pendingProviderData.registered_provider_wallet,
          description: state.pendingProviderData.description,
          instructions: state.pendingProviderData.instructions,
          price: state.pendingProviderData.price.toString(),
        });

        console.log('TBA execute args for multicall:', {
          tbaAddress,
          target: executeArgs[0],
          value: executeArgs[1].toString(),
          operation: executeArgs[3], // Should be 1 for DELEGATECALL
        });

        // Call TBA.execute(MULTICALL, multicallData, 0, 1)
        setNote({
          address: tbaAddress,
          abi: tbaExecuteAbi,
          functionName: 'execute',
          args: executeArgs,
          gas: 1000000n, // Match the example
        } as any);
      } catch (error) {
        console.error('Failed to create notes multicall:', error);
        const errorMessage = `Failed to set notes: ${(error as Error).message}`;
        setState(prev => ({ 
          ...prev, 
          isRegistering: false, 
          step: 'idle',
          error: errorMessage,
          processedTxHashes: new Set(),
        }));
        callbacks.onRegistrationError(errorMessage);
      }
    }
  }, [state.step, state.mintedProviderAddress, state.pendingProviderData, isSettingNotes, isNotesTxLoading, setNote, callbacks]);

  // Handle notes transaction success
  useEffect(() => {
    if (isNotesTxSuccess && state.step === 'notes') {
      console.log('All notes set successfully via multicall');
      
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
      }, 2000);
    }
  }, [isNotesTxSuccess, state.step, state.mintedProviderAddress, callbacks]);

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
  };
} 
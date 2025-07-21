import { useState, useEffect, useCallback } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { encodePacked, stringToHex, decodeEventLog, type Address } from 'viem';
import { 
  HYPERGRID_ADDRESS, 
  hyperGridNamespaceMinterAbi,
  generateProviderNotesCallsArray,
  tbaExecuteAbi,
} from './hypermap';
import { RegisteredProvider } from '../types/hypergrid_provider';
import React from 'react';

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

  // Transaction receipts with callbacks
  const { 
    isLoading: isMintTxLoading, 
    isSuccess: isMintTxSuccess,
    data: mintTxReceipt 
  } = useWaitForTransactionReceipt({
    hash: mintTxHash,
    query: {
      enabled: !!mintTxHash,
    }
  });

  const { 
    isLoading: isNotesTxLoading, 
    isSuccess: isNotesTxSuccess 
  } = useWaitForTransactionReceipt({
    hash: notesTxHash,
    query: {
      enabled: !!notesTxHash,
    }
  });

  // Handle mint transaction success
  const handleMintSuccess = useCallback((txReceipt: any, providerData: RegisteredProvider) => {
    console.log('Mint transaction confirmed:', txReceipt.transactionHash);
    
    // Extract TBA from transaction logs
    const extractedTbaAddress = extractTbaAddressFromLogs(
      txReceipt.logs, 
      providerData.provider_name
    );
    
    if (extractedTbaAddress) {
      console.log('TBA address extracted:', extractedTbaAddress);
      setState(prev => ({
        ...prev,
        mintedProviderAddress: extractedTbaAddress,
        step: 'notes',
        currentNoteIndex: 0,
      }));
      resetMint();
      // Start notes transaction immediately
      setProviderNotes(extractedTbaAddress, providerData);
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
  }, [resetMint, callbacks]);

  // Function to set notes
  const setProviderNotes = useCallback(async (tbaAddress: Address, providerData: RegisteredProvider) => {
    console.log('Setting notes via multicall with DELEGATECALL');
    
    try {
      const { tbaAddress: returnedTbaAddress, executeArgs } = generateProviderNotesCallsArray({
        tbaAddress,
        providerId: providerData.provider_id,
        wallet: providerData.registered_provider_wallet,
        description: providerData.description,
        instructions: providerData.instructions,
        price: providerData.price.toString(),
      });

      console.log('TBA execute args for multicall:', {
        tbaAddress: returnedTbaAddress,
        target: executeArgs[0],
        value: executeArgs[1].toString(),
        operation: executeArgs[3], // Should be 1 for DELEGATECALL
      });

      // Call TBA.execute(MULTICALL, multicallData, 0, 1)
      await setNote({
        address: returnedTbaAddress,
        abi: tbaExecuteAbi,
        functionName: 'execute',
        args: executeArgs,
        gas: 1000000n,
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
  }, [setNote, callbacks]);

  // Handle notes transaction success
  const handleNotesSuccess = useCallback((tbaAddress: Address) => {
    console.log('All notes set successfully via multicall');
    
    setState(prev => ({
      ...prev,
      step: 'complete',
      isRegistering: false,
    }));
    
    callbacks.onRegistrationComplete(tbaAddress);
  }, [callbacks]);

  // Watch for mint transaction success
  useEffect(() => {
    if (isMintTxSuccess && mintTxReceipt && state.pendingProviderData && state.step === 'minting') {
      handleMintSuccess(mintTxReceipt, state.pendingProviderData);
    }
  }, [isMintTxSuccess, mintTxReceipt, state.pendingProviderData, state.step, handleMintSuccess]);



  // Watch for notes transaction success
  useEffect(() => {
    if (isNotesTxSuccess && state.step === 'notes' && state.mintedProviderAddress) {
      handleNotesSuccess(state.mintedProviderAddress);
    }
  }, [isNotesTxSuccess, state.step, state.mintedProviderAddress, handleNotesSuccess]);

  // Handle errors
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

  useEffect(() => {
    if (notesError) {
      console.error('Notes error:', notesError);
      const errorMessage = `Setting notes failed: ${notesError.message}`;
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
  }, [notesError, callbacks, resetNote]);

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
        address: HYPERGRID_ADDRESS,
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

/**
 * Custom hook for handling animation triggers based on registration state
 */
export function useRegistrationAnimations(
  step: ProviderRegistrationStep,
  mintedProviderAddress: Address | null,
  onAnimationComplete?: () => void
) {
  const [animationState, setAnimationState] = React.useState<{
    showSuccessAnimation: boolean;
    showConfetti: boolean;
  }>({
    showSuccessAnimation: false,
    showConfetti: false,
  });

  React.useEffect(() => {
    if (step === 'complete' && mintedProviderAddress) {
      // Trigger success animation
      setAnimationState({
        showSuccessAnimation: true,
        showConfetti: true,
      });
      
      // Optional callback after animation
      if (onAnimationComplete) {
        const timer = setTimeout(onAnimationComplete, 3000);
        return () => clearTimeout(timer);
      }
    } else {
      setAnimationState({
        showSuccessAnimation: false,
        showConfetti: false,
      });
    }
  }, [step, mintedProviderAddress, onAnimationComplete]);

  return animationState;
} 
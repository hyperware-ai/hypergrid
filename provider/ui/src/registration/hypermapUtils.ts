import { useState, useEffect, useCallback } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { encodePacked, stringToHex, decodeEventLog, encodeFunctionData, type Address } from 'viem';
import { 
  HYPERGRID_ADDRESS, 
  hyperGridNamespaceMinterAbi,
  generateProviderNotesCallsArray,
  generateNoteCall,
  createTbaExecuteCall,
  createMulticallData,
  HYPERMAP_ADDRESS, 
  MULTICALL_ADDRESS
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

// New type for provider update operations
export type ProviderUpdateStep = 'idle' | 'updating' | 'complete';

export interface ProviderUpdateState {
  isUpdating: boolean;
  step: ProviderUpdateStep;
  error: string | null;
  isProcessingUpdate: boolean;
}

export interface ProviderUpdateCallbacks {
  onUpdateComplete: (success: boolean) => void;
  onUpdateError: (error: string) => void;
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
      await setNote(createTbaExecuteCall(
        returnedTbaAddress,
        executeArgs[0],
        executeArgs[2],
        executeArgs[3],
        1000000n
      ) as any);
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
 * Hook for updating provider notes on-chain
 * Handles both single note updates and multicall for multiple notes
 */
export function useProviderUpdate(callbacks: ProviderUpdateCallbacks) {
  const { address: walletAddress, isConnected: isWalletConnected } = useAccount();
  
  const [state, setState] = useState<ProviderUpdateState>({
    isUpdating: false,
    step: 'idle',
    error: null,
    isProcessingUpdate: false,
  });

  // Contract write hook for updates
  const { 
    writeContract: updateNotes,
    data: updateTxHash,
    error: updateError,
    isPending: isUpdating,
    reset: resetUpdate
  } = useWriteContract();

  // Transaction receipt
  const { 
    isLoading: isUpdateTxLoading, 
    isSuccess: isUpdateTxSuccess 
  } = useWaitForTransactionReceipt({
    hash: updateTxHash,
    query: {
      enabled: !!updateTxHash,
    }
  });

  // Handle update transaction success
  const handleUpdateSuccess = useCallback(() => {
    console.log('Provider notes updated successfully');
    
    setState(prev => ({
      ...prev,
      step: 'complete',
      isUpdating: false,
      isProcessingUpdate: false,
    }));
    
    callbacks.onUpdateComplete(true);
    resetUpdate();
  }, [callbacks, resetUpdate]);

  // Watch for update transaction success
  useEffect(() => {
    if (isUpdateTxSuccess && state.step === 'updating') {
      console.log('✅ Update transaction confirmed as successful');
      handleUpdateSuccess();
    }
  }, [isUpdateTxSuccess, state.step, handleUpdateSuccess]);

  // Watch for transaction hash changes
  useEffect(() => {
    if (updateTxHash) {
      console.log('📄 Update transaction hash received:', updateTxHash);
      console.log('⏳ Waiting for transaction confirmation...');
    }
  }, [updateTxHash]);

  // Watch for transaction loading state changes
  useEffect(() => {
    
    // Check for the case where transaction finished loading but failed
    if (!isUpdateTxLoading && !isUpdateTxSuccess && !updateError && updateTxHash && state.step === 'updating') {
      console.error('❌ Transaction was mined but failed on-chain (reverted)');
      console.error('Transaction hash:', updateTxHash);
      console.error('This usually means the contract call reverted during execution');
      
      const errorMessage = 'Transaction failed on-chain - the contract call reverted';
      setState(prev => ({ 
        ...prev, 
        isUpdating: false, 
        step: 'idle',
        error: errorMessage,
        isProcessingUpdate: false,
      }));
      callbacks.onUpdateError(errorMessage);
      resetUpdate();
    }
  }, [isUpdateTxLoading, isUpdateTxSuccess, updateError, state.step, updateTxHash, callbacks, resetUpdate]);

  // Handle errors
  useEffect(() => {
    if (updateError) {
      console.error('Update error:', updateError);
      const errorMessage = `Update failed: ${updateError.message}`;
      setState(prev => ({ 
        ...prev, 
        isUpdating: false, 
        step: 'idle',
        error: errorMessage,
        isProcessingUpdate: false,
      }));
      callbacks.onUpdateError(errorMessage);
      resetUpdate();
    }
  }, [updateError, callbacks, resetUpdate]);

  /**
   * Update a single note on the provider's TBA
   */
  const updateSingleNote = useCallback(async (
    tbaAddress: Address,
    noteKey: string,
    noteValue: string
  ) => {
    if (!isWalletConnected || !walletAddress) {
      callbacks.onUpdateError('Wallet not connected');
      return;
    }

    setState(prev => ({
      ...prev,
      isUpdating: true,
      step: 'updating',
      error: null,
      isProcessingUpdate: true,
    }));

         try {
       // Use the EXACT pattern from the working example
       console.log('Updating single note with working pattern:', { 
         tbaAddress, 
         noteKey, 
         noteValue
       });

       // Generate note call exactly like the working example
       const noteCalldata = generateNoteCall({ noteKey, noteValue });

       // Log the exact call we're making with full details
       console.log('Making TBA execute call with:', {
         tba: tbaAddress,
         hypermap: HYPERMAP_ADDRESS,
         calldata: noteCalldata,
         calldataFull: noteCalldata, // Force full logging
         decodedNote: {
           key: noteKey,
           value: noteValue
         },
         executeArgs: {
           to: HYPERMAP_ADDRESS,
           value: '0',
           data: noteCalldata,
           operation: 0
         }
       });
       
       // Also log what the working example would send
       console.log('Compare with working example format:', {
         address: tbaAddress,
         abi: 'mechAbi',
         functionName: 'execute',
         args: [
           HYPERMAP_ADDRESS,
           BigInt(0),
           noteCalldata,
           0,
         ]
       });

       // Direct call to TBA.execute - EXACTLY like the working example
       await updateNotes(createTbaExecuteCall(
         tbaAddress,
         HYPERMAP_ADDRESS,
         noteCalldata,
         0
       ) as any);
       
       console.log('Single note update transaction sent (not yet confirmed)');
       console.log('Transaction will be monitored for success/failure...');
    } catch (error: any) {
      console.error('Failed to update single note:', error);
      
      // Log detailed error information
      if (error?.cause) {
        console.error('Error cause:', error.cause);
      }
      if (error?.data) {
        console.error('Error data:', error.data);
      }
      if (error?.shortMessage) {
        console.error('Short message:', error.shortMessage);
      }
      
      // Check if it's an authorization issue
      if (error?.message?.includes('execute') && error?.message?.includes('reverted')) {
        console.error('TBA execute reverted - possible causes:');
        console.error('1. Caller is not authorized (not the TBA owner)');
        console.error('2. TBA implementation doesn\'t support this operation');
        console.error('3. Target contract call failed');
        console.error('Current wallet address:', walletAddress);
        console.error('TBA address:', tbaAddress);
      }
      
      const errorMessage = `Failed to update note: ${(error as Error).message}`;
      setState(prev => ({ 
        ...prev, 
        isUpdating: false, 
        step: 'idle',
        error: errorMessage,
        isProcessingUpdate: false,
      }));
      callbacks.onUpdateError(errorMessage);
    }
  }, [isWalletConnected, walletAddress, updateNotes, callbacks]);

  /**
   * Update multiple notes on the provider's TBA using multicall
   */
  const updateMultipleNotes = useCallback(async (
    tbaAddress: Address,
    notes: Array<{ key: string; value: string }>
  ) => {
    if (!isWalletConnected || !walletAddress) {
      callbacks.onUpdateError('Wallet not connected');
      return;
    }

    setState(prev => ({
      ...prev,
      isUpdating: true,
      step: 'updating',
      error: null,
      isProcessingUpdate: true,
    }));

    try {
      // Generate multicall for all notes
      const multicallData = createMulticallData(notes);

      console.log('Updating multiple notes with multicall via DELEGATECALL');

      // Call TBA.execute(MULTICALL_ADDRESS, multicallData, 0, 1) for multicall - using DELEGATECALL like registration
      await updateNotes(createTbaExecuteCall(
        tbaAddress,
        MULTICALL_ADDRESS,
        multicallData,
        1,
        1500000n
      ) as any);
    } catch (error) {
      console.error('Failed to update multiple notes:', error);
      const errorMessage = `Failed to update notes: ${(error as Error).message}`;
      setState(prev => ({ 
        ...prev, 
        isUpdating: false, 
        step: 'idle',
        error: errorMessage,
        isProcessingUpdate: false,
      }));
      callbacks.onUpdateError(errorMessage);
    }
  }, [isWalletConnected, walletAddress, updateNotes, callbacks]);

  /**
   * Smart update that chooses single or multicall based on number of notes
   */
  const updateProviderNotes = useCallback(async (
    tbaAddress: Address,
    notes: Array<{ key: string; value: string }>
  ) => {
    if (notes.length === 0) {
      console.log('No notes to update');
      callbacks.onUpdateComplete(true);
      return;
    }

    // Always use multicall approach since registration works with multicall
    await updateMultipleNotes(tbaAddress, notes);
  }, [updateSingleNote, updateMultipleNotes, callbacks]);

  return {
    ...state,
    isUpdating,
    isUpdateTxLoading,
    updateError,
    updateProviderNotes,
  };
}

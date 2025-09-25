import React, { useCallback, useMemo, useEffect, useState } from 'react';
import { Address, Hex, encodeFunctionData, encodePacked, stringToHex } from 'viem';
import { useAccount, useWaitForTransactionReceipt, useWriteContract } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';

import {
  viemNamehash,
  encodeHypermapMintCall,
  encodeHypermapNoteCall,
  prepareTbaExecuteArgs,
  hypermapAbi,
  tbaExecuteAbi,
  HYPERMAP_ADDRESS,
  DEFAULT_PAYMASTER_APPROVAL_AMOUNT,
  DEFAULT_OPERATOR_TBA_IMPLEMENTATION,
  BASE_CHAIN_ID,
} from '../../logic/hypermapHelpers';
import { callApiWithRouting } from '../../utils/api-endpoints';

type Props = {
  // Parent (node) TBA that owns the operator sub-entry to be minted (from backend state)
  parentTbaAddress?: Address;
  // Full operator entry name, e.g. 'my-node.os' (from backend state)
  defaultOperatorEntryName?: string;
  // Owner EOA for the node (actual owner of the entry), shown for diagnostics
  ownerEoa?: Address;
  onBootComplete?: () => void; // Called after confirmation
};

const fieldStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

const inputStyle: React.CSSProperties = {
  width: 360,
  padding: 6,
  border: '1px solid #ddd',
};

const OneClickOperatorBoot: React.FC<Props> = ({ parentTbaAddress, defaultOperatorEntryName, ownerEoa, onBootComplete }) => {
  const { address: eoa } = useAccount();
  const operatorSubLabel = 'grid-wallet';
  const [ownerNodeName, setOwnerNodeName] = useState<string>(defaultOperatorEntryName || '');
  
  // Helper to format address for display
  const formatAddress = (address: string | undefined) => {
    if (!address) return '';
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };
  
  // Check if connected wallet matches the owner EOA
  const isCorrectWallet = useMemo(() => {
    if (!eoa || !ownerEoa) return false;
    return eoa.toLowerCase() === ownerEoa.toLowerCase();
  }, [eoa, ownerEoa]);
  
  const isWrongWallet = useMemo(() => {
    return eoa && ownerEoa && !isCorrectWallet;
  }, [eoa, ownerEoa, isCorrectWallet]);
  
  // Debug logs
  console.log('[OneClickOperatorBoot] Component props:', {
    parentTbaAddress,
    defaultOperatorEntryName,
    ownerEoa
  });
  
  useEffect(() => {
    if (!defaultOperatorEntryName && typeof window !== 'undefined') {
      const n = (window as any)?.our?.node;
      if (n && typeof n === 'string') setOwnerNodeName(n);
    }
  }, [defaultOperatorEntryName]);

  const operatorEntryName = ownerNodeName ? `${operatorSubLabel}.${ownerNodeName}` : '';
  const approvalAmount = DEFAULT_PAYMASTER_APPROVAL_AMOUNT;

  const { data: hash, error, isPending, writeContract, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash, chainId: BASE_CHAIN_ID });

  const disabled = useMemo(() => {
    // For fresh nodes without a parent TBA, we can still proceed if we have EOA and entry name
    return !operatorEntryName || !eoa || isWrongWallet || isPending || isConfirming;
  }, [operatorEntryName, eoa, isWrongWallet, isPending, isConfirming]);

  const disabledReasons = useMemo(() => {
    const reasons: string[] = [];
    if (!eoa) reasons.push('wallet not connected - be sure to connect the wallet that owns your Hyperware name');
    if (isWrongWallet && ownerEoa) reasons.push(`wrong wallet connected - please connect ${formatAddress(ownerEoa)}`);
    // For fresh nodes, we might not have a parent TBA yet - that's ok, we'll mint directly
    if (!parentTbaAddress && ownerNodeName) {
      // If we have a node name but no TBA, this might be a fresh node
      console.log('[OneClickOperatorBoot] No parent TBA found for node:', ownerNodeName, '- this might be a fresh node');
    }
    if (!operatorEntryName) reasons.push('operator entry name missing');
    if (isPending) reasons.push('transaction pending');
    if (isConfirming) reasons.push('waiting for confirmation');
    return reasons;
  }, [eoa, isWrongWallet, ownerEoa, parentTbaAddress, operatorEntryName, isPending, isConfirming, ownerNodeName, formatAddress]);

  const buildBundle = useCallback((): 
    | {
        target: Address;
        abi: typeof tbaExecuteAbi;
        functionName: 'execute';
        args: readonly [Address, bigint, Hex, number];
      }
    | {
        target: Address;
        abi: typeof hypermapAbi;
        functionName: 'mint';
        args: readonly [Address, Hex, Hex, Address];
      } => {
    // 1) Inner calls the operator TBA will execute immediately after mint
    // ~access-list => namehash('~grid-beta-signers.<operatorSubLabel>.<ownerNodeEntryName>')
    const accessListValue = viemNamehash(`~grid-beta-signers.${operatorEntryName}`);
    const accessListNoteCall = encodeHypermapNoteCall({
      noteKey: '~access-list',
      noteValue: accessListValue as Hex,
    });
    // 2) Single inner call (no Multicall): operator TBA will call Hypermap.note directly
    const initExecuteArgs = prepareTbaExecuteArgs({
      targetContract: HYPERMAP_ADDRESS,
      callData: accessListNoteCall,
      value: 0n,
      operation: 0, // CALL
    });
    const initCall = encodeFunctionData({ abi: tbaExecuteAbi, functionName: 'execute', args: initExecuteArgs });

    // 4) Encode hypermap.mint(owner=EOA, label=operatorSubLabel, data=initCall, impl=DEFAULT)
    const innerMint = encodeFunctionData({
      abi: hypermapAbi,
      functionName: 'mint',
      args: [
        eoa as Address,
        encodePacked(["bytes"], [stringToHex(operatorSubLabel)]),
        initCall as Hex,
        DEFAULT_OPERATOR_TBA_IMPLEMENTATION,
      ]
    });

    // 5) Final outer call: parent TBA executes Hypermap.mint (CALL)
    const outerArgs = prepareTbaExecuteArgs({
      targetContract: HYPERMAP_ADDRESS,
      callData: innerMint,
      value: 0n,
      operation: 0,
    });

    // If no parent TBA (fresh node), mint directly from EOA
    if (!parentTbaAddress) {
      return {
        target: HYPERMAP_ADDRESS,
        abi: hypermapAbi,
        functionName: 'mint',
        args: [
          eoa as Address, // mint to the EOA since no parent TBA
          encodePacked(['bytes'], [stringToHex(operatorEntryName)]),
          initCall, // initial call data for the new TBA
          DEFAULT_OPERATOR_TBA_IMPLEMENTATION,
        ],
      } as const;
    }

    // Otherwise, use parent TBA to mint (existing logic)
    return {
      target: parentTbaAddress as Address,
      abi: tbaExecuteAbi,
      functionName: 'execute',
      args: outerArgs,
    } as const;
  }, [operatorEntryName, operatorSubLabel, eoa, parentTbaAddress]);

  const onClick = useCallback(() => {
    if (disabled) return;
    const req = buildBundle();
    
    if (req.functionName === 'execute') {
      // TypeScript knows this is the execute variant
      writeContract({
        address: req.target,
        abi: tbaExecuteAbi,
        functionName: 'execute',
        args: req.args as readonly [Address, bigint, Hex, number],
        chainId: BASE_CHAIN_ID,
      });
    } else {
      // TypeScript knows this is the mint variant
      writeContract({
        address: req.target,
        abi: hypermapAbi,
        functionName: 'mint',
        args: req.args as readonly [Address, Hex, Hex, Address],
        chainId: BASE_CHAIN_ID,
      });
    }
  }, [disabled, buildBundle, writeContract]);

  React.useEffect(() => {
    if (isConfirmed) {
      // After confirmation, trigger identity recheck
      setTimeout(async () => {
        try {
          // Call the recheck identity endpoint
          await callApiWithRouting( "RecheckIdentity" );
          console.log('Identity recheck triggered successfully');
        } catch (error) {
          console.error('Error calling recheck identity:', error);
        }
        
        // Call the callback and reset
        onBootComplete?.();
        reset();
      }, 2000);
    }
  }, [isConfirmed, onBootComplete, reset]);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(17,24,39,0.45)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ width: 520, maxWidth: 'min(520px, 100%)', background: '#fff', borderRadius: 12, boxShadow: '0 10px 30px rgba(0,0,0,0.2)', border: '1px solid #e5e7eb' }}>
        <div style={{ padding: 16, borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontWeight: 600 }}>Step 1 · Create operator wallet</div>
        </div>
        <div style={{ padding: 16 }}>
          <div style={{ color: '#4b5563', fontSize: 13, marginBottom: 12 }}>
            Signing this transaction will mint a Hyperwallet for Hypergrid to use. Your Hyperwallet is a smart account, and in the next step we'll authorize Hypergrid to use it send microtransactions on your behalf.
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
            <button
              onClick={onClick}
              disabled={disabled}
              style={{ background: disabled ? '#e5e7eb' : '#111827', color: disabled ? '#9ca3af' : '#ffffff', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8 }}
            >
              {isPending || isConfirming ? 'Confirm in wallet…' : isWrongWallet ? 'Wrong wallet' : 'Create wallet'}
            </button>
            {hash && (
              <a href={`https://basescan.org/tx/${hash}`} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
                view tx
              </a>
            )}
            {error && <div style={{ color: '#b91c1c', fontSize: 12 }}>Error: {error.message}</div>}
          </div>

          {!eoa && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ color: '#b45309', background: '#fffbeb', border: '1px solid #fde68a', padding: 8, borderRadius: 8, fontSize: 12, marginBottom: 8 }}>
                wallet not connected - be sure to connect the wallet that owns your Hyperware name
              </div>
              <ConnectButton />
            </div>
          )}
          {isWrongWallet && ownerEoa && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ color: '#dc2626', background: '#fef2f2', border: '1px solid #fca5a5', padding: 8, borderRadius: 8, fontSize: 12, marginBottom: 8 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>⚠️ Wrong wallet connected</div>
                <div>Current wallet: {formatAddress(eoa)}</div>
                <div>Expected wallet: {formatAddress(ownerEoa)} (owns {ownerNodeName || 'your node'})</div>
                <div style={{ marginTop: 4 }}>Please switch to the correct wallet to continue.</div>
              </div>
              <ConnectButton />
            </div>
          )}
          {eoa && !isWrongWallet && disabled && disabledReasons.length > 0 && (
            <div style={{ color: '#b45309', background: '#fffbeb', border: '1px solid #fde68a', padding: 8, borderRadius: 8, fontSize: 12, marginBottom: 10 }}>
              {disabledReasons.join(', ')}
            </div>
          )}
          {isCorrectWallet && !disabled && (
            <div style={{ color: '#059669', background: '#ecfdf5', border: '1px solid #6ee7b7', padding: 8, borderRadius: 8, fontSize: 12, marginBottom: 10 }}>
              ✅ Correct wallet connected ({formatAddress(eoa)})
            </div>
          )}

          {/* details removed per request */}
        </div>
      </div>
    </div>
  );
};

export default OneClickOperatorBoot;



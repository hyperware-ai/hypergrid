import React, { useCallback, useMemo } from 'react';
import { Address, Hex, encodeFunctionData } from 'viem';
import { useAccount, useWaitForTransactionReceipt, useWriteContract } from 'wagmi';

import {
  encodeAddressArray,
  encodeERC20Approve,
  encodeHypermapNoteCall,
  prepareTbaExecuteArgs,
  tbaExecuteAbi,
  HYPERMAP_ADDRESS,
  USDC_ADDRESS_BASE,
  PAYMASTER_ADDRESS,
  BASE_CHAIN_ID,
} from '../../logic/hypermapHelpers';

import { MULTICALL as MULTICALL_ADDRESS, multicallAbi } from '../../abis';

type Props = {
  operatorTbaAddress?: Address;
  hotWalletAddress?: Address;
  onComplete?: () => void;
};

const OperatorFinalizeSetup: React.FC<Props> = ({ operatorTbaAddress, hotWalletAddress, onComplete }) => {
  const { address: eoa } = useAccount();
  const { data: hash, error, isPending, writeContract, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash, chainId: BASE_CHAIN_ID });

  const disabled = useMemo(() => {
    return !operatorTbaAddress || !hotWalletAddress || !eoa || isPending || isConfirming;
  }, [operatorTbaAddress, hotWalletAddress, eoa, isPending, isConfirming]);

  const disabledReasons = useMemo(() => {
    const reasons: string[] = [];
    if (!eoa) reasons.push('wallet not connected');
    if (!operatorTbaAddress) reasons.push('operator TBA missing');
    if (!hotWalletAddress) reasons.push('hot wallet address missing');
    if (isPending) reasons.push('transaction pending');
    if (isConfirming) reasons.push('waiting for confirmation');
    return reasons;
  }, [eoa, operatorTbaAddress, hotWalletAddress, isPending, isConfirming]);

  const onClick = useCallback(() => {
    if (disabled) return;

    // 1) Build inner calls
    const encodedSigners = encodeAddressArray([hotWalletAddress as Address]) as Hex;
    const signersNoteCall = encodeHypermapNoteCall({
      noteKey: '~grid-beta-signers',
      noteValue: encodedSigners,
    });

    // Approve $200 USDC (6 decimals)
    const approveCall = encodeERC20Approve({
      spender: PAYMASTER_ADDRESS,
      amount: 200n * 10n ** 6n,
    });

    // 2) Pack into Multicall.aggregate
    const multicallData = encodeFunctionData({
      abi: multicallAbi,
      functionName: 'aggregate',
      args: [[
        { target: HYPERMAP_ADDRESS, callData: signersNoteCall },
        { target: USDC_ADDRESS_BASE, callData: approveCall },
      ]],
    });

    // 3) Execute via TBA.execute(..., DELEGATECALL)
    const execArgs = prepareTbaExecuteArgs({
      targetContract: MULTICALL_ADDRESS as Address,
      callData: multicallData,
      value: 0n,
      operation: 1, // DELEGATECALL
    });

    writeContract({
      address: operatorTbaAddress as Address,
      abi: tbaExecuteAbi,
      functionName: 'execute',
      args: execArgs,
      chainId: BASE_CHAIN_ID,
    });
  }, [disabled, operatorTbaAddress, hotWalletAddress, writeContract]);

  React.useEffect(() => {
    if (isConfirmed) {
      setTimeout(() => {
        onComplete?.();
        reset();
      }, 2000);
    }
  }, [isConfirmed, onComplete, reset]);

  return (
    <div style={{ border: '1px solid #ddd', padding: 12, background: '#fafafa' }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>Finalize operator setup</div>
      <div style={{ color: '#555', fontSize: 12, marginBottom: 10 }}>
        Adds '~grid-beta-signers' with one hot wallet and approves $200 USDC for the paymaster in one tx.
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button
          onClick={onClick}
          disabled={disabled}
          style={{ background: disabled ? '#eee' : '#111', color: disabled ? '#888' : '#fff', padding: '6px 12px', border: '1px solid #ddd' }}
        >
          {isPending || isConfirming ? 'Confirm in wallet…' : 'Finalize operator'}
        </button>
        {hash && (
          <a href={`https://basescan.org/tx/${hash}`} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
            view tx
          </a>
        )}
        {error && <div style={{ color: 'red', fontSize: 12 }}>Error: {error.message}</div>}
      </div>
      <div style={{ marginTop: 8, padding: 8, background: '#fff', border: '1px dashed #ddd' }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Details</div>
        {disabled && disabledReasons.length > 0 && (
          <div style={{ color: '#b00', fontSize: 12, marginBottom: 6 }}>Disabled because: {disabledReasons.join(', ')}</div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 6, fontSize: 12 }}>
          <div>Wallet (EOA)</div><div>{eoa || '—'}</div>
          <div>Operator TBA</div><div>{operatorTbaAddress || '—'}</div>
          <div>Hot wallet</div><div>{hotWalletAddress || '—'}</div>
          <div>USDC</div><div>{USDC_ADDRESS_BASE}</div>
          <div>Paymaster</div><div>{PAYMASTER_ADDRESS}</div>
          <div>Multicall</div><div>{MULTICALL_ADDRESS}</div>
          <div>Hypermap</div><div>{HYPERMAP_ADDRESS}</div>
          <div>Chain</div><div>Base ({BASE_CHAIN_ID})</div>
          <div>Tx status</div><div>{isPending ? 'pending' : isConfirming ? 'confirming' : isConfirmed ? 'confirmed' : 'idle'}</div>
          <div>Tx hash</div><div>{hash ? <a href={`https://basescan.org/tx/${hash}`} target="_blank" rel="noreferrer">{hash}</a> : '—'}</div>
          <div>Last error</div><div style={{ color: '#b00' }}>{error?.message || '—'}</div>
        </div>
        <div style={{ marginTop: 6, color: '#666' }}>Plan: operator.execute(MULTICALL via DELEGATECALL) → [HYPERMAP.note('~grid-beta-signers',[hot]), USDC.approve(paymaster, 200 USDC)].</div>
      </div>
    </div>
  );
};

export default OperatorFinalizeSetup;



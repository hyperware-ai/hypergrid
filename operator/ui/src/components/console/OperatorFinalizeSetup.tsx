import React, { useCallback, useMemo } from 'react';
import { Address, Hex, encodeFunctionData } from 'viem';
import { useAccount, useWaitForTransactionReceipt, useWriteContract } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';

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
  autoReload?: boolean; // defaults to true for backward compatibility
};

const OperatorFinalizeSetup: React.FC<Props> = ({ operatorTbaAddress, hotWalletAddress, onComplete, autoReload = true }) => {
  const { address: eoa } = useAccount();
  const { data: hash, error, isPending, writeContract, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash, chainId: BASE_CHAIN_ID });

  const disabled = useMemo(() => {
    return !operatorTbaAddress || !hotWalletAddress || !eoa || isPending || isConfirming;
  }, [operatorTbaAddress, hotWalletAddress, eoa, isPending, isConfirming]);

  const disabledReasons = useMemo(() => {
    const reasons: string[] = [];
    if (!eoa) reasons.push('wallet not connected - be sure to connect the wallet that owns your Hyperware name');
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
        if (autoReload) {
          try { window.location.reload(); } catch {}
        }
      }, 2000);
    }
  }, [isConfirmed, onComplete, reset, autoReload]);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(17,24,39,0.45)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ width: 520, maxWidth: 'min(520px, 100%)', background: '#fff', borderRadius: 12, boxShadow: '0 10px 30px rgba(0,0,0,0.2)', border: '1px solid #e5e7eb' }}>
        <div style={{ padding: 16, borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontWeight: 600 }}>Step 2 · Finalize operator setup</div>
        </div>
        <div style={{ padding: 16 }}>
          <div style={{ color: '#4b5563', fontSize: 13, marginBottom: 12 }}>
            This final setup transaction will authorize your node running Hypergrid to make USDC payments on your behalf without you needing to manually sign each transaction.
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
            <button
              onClick={onClick}
              disabled={disabled}
              style={{ background: disabled ? '#e5e7eb' : '#111827', color: disabled ? '#9ca3af' : '#ffffff', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8 }}
            >
              {isPending || isConfirming ? 'Confirm in wallet…' : 'Finalize operator'}
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
          {eoa && disabled && disabledReasons.length > 0 && (
            <div style={{ color: '#b45309', background: '#fffbeb', border: '1px solid #fde68a', padding: 8, borderRadius: 8, fontSize: 12, marginBottom: 10 }}>
              {disabledReasons.join(', ')}
            </div>
          )}

          {/* details removed per request */}
        </div>
      </div>
    </div>
  );
};

export default OperatorFinalizeSetup;



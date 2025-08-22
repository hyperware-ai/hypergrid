import React, { useCallback, useMemo, useEffect, useState } from 'react';
import { Address, Hex, encodeFunctionData, encodePacked, stringToHex } from 'viem';
import { useAccount, useWaitForTransactionReceipt, useWriteContract } from 'wagmi';

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
  useEffect(() => {
    if (!defaultOperatorEntryName && typeof window !== 'undefined') {
      const n = (window as any)?.our?.node;
      if (n && typeof n === 'string') setOwnerNodeName(n);
    }
  }, [defaultOperatorEntryName]);

  // Robust fallback: fetch owner node name from hypergrid graph if still missing
  useEffect(() => {
    if (ownerNodeName) return;
    try {
      const pathParts = typeof window !== 'undefined' ? window.location.pathname.split('/').filter(Boolean) : [];
      const processIdPart = pathParts.find((p) => p.includes(':'));
      const base = processIdPart ? `/${processIdPart}/api` : '/api';
      fetch(`${base}/hypergrid-graph`).then(async (res) => {
        if (!res.ok) return;
        const graph = await res.json();
        const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
        for (const n of nodes) {
          if (n?.type === 'ownerNode') {
            const data = (n.data && (n.data.ownerNode || n.data)) || {};
            const name = (data.name || data.node_name || data.nodeName) as string | undefined;
            if (name && typeof name === 'string') {
              setOwnerNodeName(name);
              break;
            }
          }
        }
      }).catch(() => {});
    } catch {}
  }, [ownerNodeName]);
  const operatorEntryName = ownerNodeName ? `${operatorSubLabel}.${ownerNodeName}` : '';
  const approvalAmount = DEFAULT_PAYMASTER_APPROVAL_AMOUNT;

  const { data: hash, error, isPending, writeContract, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash, chainId: BASE_CHAIN_ID });

  const disabled = useMemo(() => {
    return !parentTbaAddress || !operatorEntryName || !eoa || isPending || isConfirming;
  }, [parentTbaAddress, operatorEntryName, eoa, isPending, isConfirming]);

  const disabledReasons = useMemo(() => {
    const reasons: string[] = [];
    if (!eoa) reasons.push('wallet not connected');
    if (!parentTbaAddress) reasons.push('owner node TBA not found');
    if (!operatorEntryName) reasons.push('operator entry name missing');
    if (isPending) reasons.push('transaction pending');
    if (isConfirming) reasons.push('waiting for confirmation');
    return reasons;
  }, [eoa, parentTbaAddress, operatorEntryName, isPending, isConfirming]);

  const buildBundle = useCallback((): {
    target: Address;
    abi: typeof tbaExecuteAbi;
    functionName: 'execute';
    args: readonly [Address, bigint, Hex, number];
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
    writeContract({
      address: req.target,
      abi: req.abi,
      functionName: req.functionName,
      args: req.args,
      chainId: BASE_CHAIN_ID,
    });
  }, [disabled, buildBundle, writeContract]);

  React.useEffect(() => {
    if (isConfirmed) {
      setTimeout(() => {
        onBootComplete?.();
        reset();
      }, 2000);
    }
  }, [isConfirmed, onBootComplete, reset]);

  return (
    <div style={{ border: '1px solid #ddd', padding: 12, background: '#fafafa' }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>One-click operator boot</div>
      <div style={{ color: '#555', fontSize: 12, marginBottom: 10 }}>
        This will mint 'grid-wallet' under the node and set '~access-list'.
        Signers and paymaster approval can be done later on-demand to save gas now.
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button
          onClick={onClick}
          disabled={disabled}
          style={{ background: disabled ? '#eee' : '#111', color: disabled ? '#888' : '#fff', padding: '6px 12px', border: '1px solid #ddd' }}
        >
          {isPending || isConfirming ? 'Confirm in wallet…' : 'Boot operator wallet'}
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
          <div>Wallet (EOA - connected)</div><div>{eoa || '—'}</div>
          <div>Owner (EOA - node owner)</div><div>{ownerEoa || '—'}</div>
          <div>Owner node TBA</div><div>{parentTbaAddress || '—'}</div>
          <div>Owner node name</div><div>{ownerNodeName || '—'}</div>
          <div>Operator entry name</div><div>{operatorEntryName || '—'}</div>
          <div>Operator sub-label</div><div>{operatorSubLabel}</div>
          <div>Implementation</div><div>{DEFAULT_OPERATOR_TBA_IMPLEMENTATION}</div>
          <div>Hypermap</div><div>{HYPERMAP_ADDRESS}</div>
          <div>Chain</div><div>Base ({BASE_CHAIN_ID})</div>
          <div>Tx status</div><div>{isPending ? 'pending' : isConfirming ? 'confirming' : isConfirmed ? 'confirmed' : 'idle'}</div>
          <div>Tx hash</div><div>{hash ? <a href={`https://basescan.org/tx/${hash}`} target="_blank" rel="noreferrer">{hash}</a> : '—'}</div>
          <div>Last error</div><div style={{ color: '#b00' }}>{error?.message || '—'}</div>
        </div>
        <div style={{ marginTop: 6, color: '#666' }}>Plan: parent.execute(HYPERMAP, mint(data=init)), and operator.execute(HYPERMAP.note('~access-list', namehash(~grid-beta-signers.entry))).</div>
      </div>
    </div>
  );
};

export default OneClickOperatorBoot;



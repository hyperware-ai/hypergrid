import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Address, createPublicClient, http, namehash as viemNamehash } from 'viem';
import { base } from 'viem/chains';
import BackendDrivenHypergridVisualizerWrapper from '../BackendDrivenHypergridVisualizer';
import OneClickOperatorBoot from './OneClickOperatorBoot';
import OperatorFinalizeSetup from './OperatorFinalizeSetup';
import WelcomeIntro from './WelcomeIntro';
import SetupComplete from './SetupComplete';
import HyperwalletInterface, { HwClient, HwEvent } from './HyperwalletInterface';
import AuthorizedClientConfigModal from '../AuthorizedClientConfigModal';
import ShimApiConfigModal from '../ShimApiConfigModal';
import { HYPERMAP as HYPERMAP_ADDR, hypermapAbi as hypermapAbiFull } from '../../abis';
import { callApiWithRouting } from '../../utils/api-endpoints';

type SpendingLimits = {
  maxPerCall?: string | null;
  maxTotal?: string | null;
  currency?: string | null;
  totalSpent?: string | null;
};

type HotWalletAuthorizedClient = {
  id: string;
  name: string;
  associated_hot_wallet_address: string;
};

type PaymentSuccess = {
  tx_hash: string;
  amount_paid: string;
  currency: string;
};

type PaymentAttemptResult =
  | { Success: PaymentSuccess }
  | { Failed: { error: string; amount_attempted: string; currency: string } }
  | { Skipped: { reason: string } }
  | { LimitExceeded: { limit: string; amount_attempted: string; currency: string } };

type CallRecord = {
  timestamp_start_ms: number;
  provider_lookup_key: string;
  target_provider_id: string;
  call_args_json: string;
  call_success: boolean;
  response_timestamp_ms: number;
  payment_result?: PaymentAttemptResult | null;
  duration_ms: number;
  operator_wallet_id?: string | null;
};

type StateSnapshot = {
  authorized_clients: Record<string, HotWalletAuthorizedClient>;
  wallet_limits_cache: Record<string, SpendingLimits>;
  call_history: CallRecord[];
  operator_tba_address?: string | null;
  operator_entry_name?: string | null;
};

type ActiveAccountDetails = {
  id: string;
  name?: string | null;
  address: string;
  usdc_balance?: string | null;
};

const getApiBasePath = () => {
  const parts = window.location.pathname.split('/').filter(Boolean);
  const processIdPart = parts.find((p) => p.includes(':'));
  return processIdPart ? `/${processIdPart}/api` : '/api';
};

const baseApi = getApiBasePath();

const toNumber = (value?: string | null) => {
  if (!value) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const formatUsdc = (value: number) => {
  return value.toLocaleString(undefined, { maximumFractionDigits: 6 });
};

const monoBox: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
  color: '#111',
};

const sectionStyle: React.CSSProperties = {
  border: '1px solid #ddd',
  background: '#f7f7f7',
  padding: '12px',
};

const subtleText: React.CSSProperties = { color: '#666' };

type SortKey = 'name' | 'spent' | 'usage';
type SortDir = 'asc' | 'desc';

const OperatorConsole: React.FC = () => {
  const [state, setState] = useState<StateSnapshot | null>(null);
  const [active, setActive] = useState<ActiveAccountDetails | null>(null);
  const [selectedClientIds, setSelectedClientIds] = useState<string[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>('spent');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [showGraphView, setShowGraphView] = useState<boolean>(false);
  const [ownerNodeTba, setOwnerNodeTba] = useState<Address | null>(null);
  const [ownerNodeName, setOwnerNodeName] = useState<string | null>(null);
  const [ownerNodeOwnerEoa, setOwnerNodeOwnerEoa] = useState<Address | null>(null);
  const [resolvedOperatorTba, setResolvedOperatorTba] = useState<Address | null>(null);
  const [singleHotWallet, setSingleHotWallet] = useState<Address | null>(null);
  const [isClientModalOpen, setIsClientModalOpen] = useState(false);
  const [clientModalData, setClientModalData] = useState<{ id: string; name: string; hotWallet: string } | null>(null);
  const [isShimModalOpen, setIsShimModalOpen] = useState(false);
  const [operatorUsdcBalance, setOperatorUsdcBalance] = useState<string>('0');
  const [hotWalletForNewClient, setHotWalletForNewClient] = useState<string | null>(null);
  const [isRefreshingUi, setIsRefreshingUi] = useState<boolean>(false);
  const [showIntro, setShowIntro] = useState<boolean>(true);
  const [showSetupComplete, setShowSetupComplete] = useState<boolean>(false);
  // Mock mode state (scoped to this console)
  const [mockMode, setMockMode] = useState<boolean>(false);
  const [mockOperatorTba, setMockOperatorTba] = useState<string>('0xDeaDbeEf00000000000000000000000000000000');
  const [mockUsdcBalance, setMockUsdcBalance] = useState<string>('1333.37');
  const [mockClients, setMockClients] = useState<HwClient[]>([]);
  const [mockEvents, setMockEvents] = useState<HwEvent[]>([]);
  const addMockClient = () => {
    const id = `shim-${Math.random().toString(16).slice(2, 6)}`;
    setMockClients((prev) => [...prev, { id, name: `Shim for ${id}`, status: 'active' } as HwClient]);
  };
  const addMockEvent = () => {
    const cid = mockClients[0]?.id;
    const evt: HwEvent = {
      id: Date.now(),
      timestamp: new Date().toISOString(),
      clientId: cid,
      provider: 'demo-provider',
      tool: 'demo-tool',
      cost: Number((Math.random() * 5 + 1).toFixed(2)),
      txHash: `0x${Math.random().toString(16).slice(2, 8)}`,
    };
    setMockEvents((p) => [evt, ...p]);
  };
  const onSetLimitsMock = async () => {};
  const onToggleClientStatusMock = async (clientId: string) => {
    setMockClients((prev) => prev.map((c) => (c.id === clientId ? { ...c, status: c.status === 'active' ? 'paused' : 'active' } : c)));
  };

  const nodeId = useMemo(() => (window as any)?.our?.node ?? null, []);

  const fetchState = useCallback(async () => {
    const res = await fetch(`${baseApi}/state`, { method: 'GET' });
    const json = (await res.json()) as StateSnapshot;
    setState(json);
  }, []);

  const fetchActive = useCallback(async () => {
    try {
      const data = await callApiWithRouting({ GetActiveAccountDetails: {} });
      setActive(data ?? null);
    } catch {
      setActive(null);
    }
  }, []);

  useEffect(() => {
    fetchState();
    fetchActive();
  }, [fetchState, fetchActive]);

  const refreshAll = useCallback(async () => {
    setIsRefreshingUi(true);
    try {
      await fetchState();
      await fetchActive();
    } finally {
      setIsRefreshingUi(false);
    }
  }, [fetchState, fetchActive]);

  // Global event hook to open graph from header cog
  useEffect(() => {
    const handler = () => setShowGraphView(true);
    document.addEventListener('open-graph-view', handler as any);
    return () => document.removeEventListener('open-graph-view', handler as any);
  }, []);

  // Fetch owner node TBA from the hypergrid graph (legacy-compatible source)
  useEffect(() => {
    const loadOwnerNodeTba = async () => {
      try {
        const res = await fetch(`${baseApi}/hypergrid-graph`);
        if (!res.ok) return;
        const graph = await res.json();
        const coarse = graph?.coarseState || graph?.coarse_state;
        const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
        for (const n of nodes) {
          if (n?.type === 'ownerNode') {
            const data = (n.data && (n.data.ownerNode || n.data)) || {};
            const tba = (data.tba_address || data.tbaAddress) as string | undefined;
            const name = (data.name || data.node_name || data.nodeName) as string | undefined;
            const owner = (data.owner_address || data.ownerAddress) as string | undefined;
            if (tba) {
              setOwnerNodeTba(tba as Address);
            }
            if (name) {
              setOwnerNodeName(name);
            }
            if (owner) {
              setOwnerNodeOwnerEoa(owner as Address);
            }
            if (tba || name || owner) {
              break;
            }
          }
          if (n?.type === 'operatorWalletNode') {
            const data = (n.data && (n.data.operatorWalletNode || n.data)) || {};
            const opTba = (data.tba_address || data.tbaAddress) as string | undefined;
            if (opTba) {
              setResolvedOperatorTba(opTba as Address);
              // don't break; still prefer to capture owner node info further in loop
            }
            const funding = (data.funding_status || data.fundingStatus) as any;
            if (funding?.usdcBalanceStr) setOperatorUsdcBalance(funding.usdcBalanceStr);
          }
        }
        // Store coarse state for rendering decisions
        if (coarse) {
          (window as any).__coarseState = coarse; // optional global for debugging
        }
      } catch {
        // ignore
      }
    };
    loadOwnerNodeTba();
  }, []);

  const clients = useMemo(() => {
    if (!state) return [] as HotWalletAuthorizedClient[];
    return Object.values(state.authorized_clients || {});
  }, [state]);

  useEffect(() => {
    if (clients.length && selectedClientIds.length === 0) {
      setSelectedClientIds(clients.map((c) => c.id));
    }
  }, [clients, selectedClientIds.length]);

  const events = state?.call_history || [];

  const clientStats = useMemo(() => {
    const totals = new Map<string, { name: string; wallet: string; usage: number; spent: number; limits?: SpendingLimits }>();
    for (const c of clients) {
      const limits = state?.wallet_limits_cache?.[c.associated_hot_wallet_address.toLowerCase()] || state?.wallet_limits_cache?.[c.associated_hot_wallet_address] || undefined;
      totals.set(c.id, { name: c.name, wallet: c.associated_hot_wallet_address, usage: 0, spent: 0, limits });
    }
    for (const rec of events) {
      const wallet = (rec.operator_wallet_id || '').toLowerCase();
      if (!wallet) continue;
      const client = clients.find((c) => c.associated_hot_wallet_address.toLowerCase() === wallet);
      if (!client) continue;
      const key = client.id;
      const entry = totals.get(key);
      if (!entry) continue;
      entry.usage += 1;
      const pr = rec.payment_result;
      if (pr && 'Success' in pr) {
        entry.spent += toNumber(pr.Success.amount_paid);
      }
    }
    return Array.from(totals.entries()).map(([id, v]) => ({ id, ...v }));
  }, [clients, events, state?.wallet_limits_cache]);

  const sortedClientStats = useMemo(() => {
    const arr = [...clientStats];
    arr.sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      if (sortKey === 'name') return a.name.localeCompare(b.name) * dir;
      if (sortKey === 'spent') return (a.spent - b.spent) * dir;
      return (a.usage - b.usage) * dir;
    });
    return arr;
  }, [clientStats, sortKey, sortDir]);

  const toggleClientSelected = (id: string) => {
    setSelectedClientIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleSetClientLimits = async (client: { id: string; wallet: string }, newLimits: { maxPerCall?: string; maxTotal?: string }) => {
    try {
      await callApiWithRouting({ SelectWallet: { wallet_id: client.wallet } });
      await callApiWithRouting({ SetWalletLimits: { limits: { maxPerCall: newLimits.maxPerCall ?? null, maxTotal: newLimits.maxTotal ?? null, currency: 'USDC' } } });
      await fetchState();
    } catch (e) {
      console.error('Set limits failed:', e);
    }
  };

  // Graph preparation (very lightweight SVG with event markers by client selection)
  const graphData = useMemo(() => {
    const filtered = events.filter((rec) => {
      const wallet = (rec.operator_wallet_id || '').toLowerCase();
      const client = clients.find((c) => c.associated_hot_wallet_address.toLowerCase() === wallet);
      if (!client) return false;
      return selectedClientIds.includes(client.id);
    });
    const byTime = [...filtered].sort((a, b) => a.timestamp_start_ms - b.timestamp_start_ms);
    const t0 = byTime.length ? byTime[0].timestamp_start_ms : Date.now();
    const t1 = byTime.length ? byTime[byTime.length - 1].timestamp_start_ms : t0 + 1;
    const range = Math.max(1, t1 - t0);
    // Build series of cumulative spend to simulate balance movement
    let cum = 0;
    const points = byTime.map((r) => {
      const amt = r.payment_result && 'Success' in r.payment_result ? toNumber(r.payment_result.Success.amount_paid) : 0;
      cum += amt;
      return { t: r.timestamp_start_ms, v: cum, rec: r };
    });
    const vmax = points.length ? Math.max(...points.map((p) => p.v)) : 1;
    return { points, t0, range, vmax };
  }, [clients, events, selectedClientIds]);

  const renderBalanceGraph = () => {
    const w = 800;
    const h = 180;
    const pad = 20;
    const { points, t0, range, vmax } = graphData;
    const toX = (t: number) => pad + ((t - t0) / range) * (w - pad * 2);
    const toY = (v: number) => h - pad - (vmax ? (v / vmax) * (h - pad * 2) : 0);
    const path = points
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(p.t).toFixed(1)} ${toY(p.v).toFixed(1)}`)
      .join(' ');
    return (
      <div style={{ ...sectionStyle, overflowX: 'auto' }}>
        <div style={{ display: 'flex', gap: 16 }}>
          <div style={{ flex: '1 1 auto' }}>
            <svg width={w} height={h} style={{ background: '#fff', border: '1px solid #e5e5e5' }}>
              <path d={path} stroke="#333" fill="none" strokeWidth={1.5} />
              {points.map((p, idx) => (
                <circle key={idx} cx={toX(p.t)} cy={toY(p.v)} r={3} fill="#999" />
              ))}
            </svg>
            <div style={{ ...subtleText, marginTop: 8 }}>Events shown are aggregated USDC outflow; hover markers with dev tools for details.</div>
          </div>
          <div style={{ width: 280 }}>
            <div style={{ marginBottom: 8 }}>Filter clients</div>
            <div style={{ maxHeight: 160, overflowY: 'auto', border: '1px solid #e5e5e5', background: '#fff' }}>
              {clients.map((c) => (
                <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderBottom: '1px solid #f0f0f0' }}>
                  <input type="checkbox" checked={selectedClientIds.includes(c.id)} onChange={() => toggleClientSelected(c.id)} />
                  <span>{c.name}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const header = (
    <div style={{ ...sectionStyle, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <div>
        <div style={{ fontWeight: 600 }}>{nodeId ? `${nodeId}'s hyperwallet` : "hyperwallet"}</div>
        <div style={subtleText}>address: {active?.address || state?.operator_tba_address || '—'}</div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: 18 }}>{formatUsdc(toNumber(active?.usdc_balance))} USDC</div>
        <button onClick={() => setShowGraphView((v) => !v)} style={{ background: '#eee', border: '1px solid #ddd', padding: '4px 8px' }}>Open Graph View</button>
      </div>
    </div>
  );

  const clientsModule = (
    <div style={sectionStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontWeight: 600 }}>Clients</div>
        <button style={{ background: '#eee', border: '1px solid #ddd', padding: '4px 8px' }} onClick={() => console.log('TODO: add new client flow')}>+ add new client</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 2fr', gap: 8, borderBottom: '1px solid #e5e5e5', paddingBottom: 6 }}>
        <button onClick={() => { setSortKey('name'); setSortDir(sortKey === 'name' && sortDir === 'asc' ? 'desc' : 'asc'); }} style={{ textAlign: 'left', background: 'transparent', border: 'none' }}>name</button>
        <button onClick={() => { setSortKey('spent'); setSortDir(sortKey === 'spent' && sortDir === 'asc' ? 'desc' : 'asc'); }} style={{ textAlign: 'left', background: 'transparent', border: 'none' }}>total spent</button>
        <button onClick={() => { setSortKey('usage'); setSortDir(sortKey === 'usage' && sortDir === 'asc' ? 'desc' : 'asc'); }} style={{ textAlign: 'left', background: 'transparent', border: 'none' }}>usage</button>
        <div>limits</div>
      </div>
      <div>
        {sortedClientStats.map((c) => (
          <ClientRow key={c.id} client={c} onSetLimits={handleSetClientLimits} />
        ))}
      </div>
    </div>
  );

  const rawEvents = useMemo(() => {
    return [...events].sort((a, b) => b.timestamp_start_ms - a.timestamp_start_ms);
  }, [events]);

  const rawEventsTable = (
    <div style={sectionStyle}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>Raw client events</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', borderBottom: '1px solid #e5e5e5', padding: '6px 8px' }}>time</th>
              <th style={{ textAlign: 'left', borderBottom: '1px solid #e5e5e5', padding: '6px 8px' }}>client</th>
              <th style={{ textAlign: 'left', borderBottom: '1px solid #e5e5e5', padding: '6px 8px' }}>provider</th>
              <th style={{ textAlign: 'left', borderBottom: '1px solid #e5e5e5', padding: '6px 8px' }}>cost</th>
              <th style={{ textAlign: 'left', borderBottom: '1px solid #e5e5e5', padding: '6px 8px' }}>tx</th>
            </tr>
          </thead>
          <tbody>
            {rawEvents.map((r, i) => {
              const wallet = (r.operator_wallet_id || '').toLowerCase();
              const client = clients.find((c) => c.associated_hot_wallet_address.toLowerCase() === wallet);
              const pr = r.payment_result;
              const success = pr && 'Success' in pr ? pr.Success : undefined;
              const amount = success ? `${success.amount_paid} ${success.currency}` : r.payment_result && 'Failed' in r.payment_result ? `failed` : r.payment_result && 'Skipped' in r.payment_result ? 'skipped' : '';
              const time = new Date(r.timestamp_start_ms).toLocaleString();
              const tx = success?.tx_hash;
              const txHref = tx ? `https://basescan.org/tx/${tx}` : undefined;
              return (
                <tr key={i}>
                  <td style={{ borderBottom: '1px solid #f0f0f0', padding: '6px 8px', whiteSpace: 'nowrap' }}>{time}</td>
                  <td style={{ borderBottom: '1px solid #f0f0f0', padding: '6px 8px' }}>{client?.name || '—'}</td>
                  <td style={{ borderBottom: '1px solid #f0f0f0', padding: '6px 8px' }}>{r.provider_lookup_key}</td>
                  <td style={{ borderBottom: '1px solid #f0f0f0', padding: '6px 8px' }}>{amount}</td>
                  <td style={{ borderBottom: '1px solid #f0f0f0', padding: '6px 8px' }}>{txHref ? <a href={txHref} target="_blank" rel="noreferrer">{tx}</a> : ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );

  const operatorEntryName = useMemo(() => {
    return state?.operator_entry_name || ownerNodeName || (nodeId ? `${nodeId}` : '');
  }, [state?.operator_entry_name, ownerNodeName, nodeId]);
  const operatorSubLabel = 'grid-wallet';
  const operatorFullEntry = useMemo(() => {
    return operatorEntryName ? `${operatorSubLabel}.${operatorEntryName}` : '';
  }, [operatorEntryName]);

  // Resolve operator TBA from Hypermap if not present in state
  useEffect(() => {
    if (!operatorFullEntry || resolvedOperatorTba || state?.operator_tba_address) return;
    const client = createPublicClient({ chain: base, transport: http() });
    (async () => {
      try {
        const nh = viemNamehash(operatorFullEntry);
        const addr = await client.readContract({
          address: HYPERMAP_ADDR as Address,
          abi: hypermapAbiFull as any,
          functionName: 'tbaOf',
          args: [nh],
        }) as Address;
        if (addr && addr !== '0x0000000000000000000000000000000000000000') {
          setResolvedOperatorTba(addr);
        }
      } catch (e) {
        // ignore; stays null
      }
    })();
  }, [operatorFullEntry, resolvedOperatorTba, state?.operator_tba_address]);
  const operatorTbaFromState = (state?.operator_tba_address as Address | undefined | null) || resolvedOperatorTba;

  // Decide which actions to render using coarse state from backend
  const [coarseState, setCoarseState] = useState<string | null>(null);
  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`${baseApi}/hypergrid-graph`);
        if (!res.ok) return;
        const graph = await res.json();
        const coarse = graph?.coarseState || graph?.coarse_state || null;
        setCoarseState(coarse);
        const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
        for (const n of nodes) {
          if (n?.type === 'operatorWalletNode') {
            const data = (n.data && (n.data.operatorWalletNode || n.data)) || {};
            const opTba = (data.tba_address || data.tbaAddress) as string | undefined;
            if (opTba) {
              setResolvedOperatorTba(opTba as Address);
              break;
            }
          }
        }
        const opNode = nodes.find((n: any) => n?.type === 'operatorWalletNode');
        const funding = opNode && (opNode.data?.funding_status || opNode.data?.fundingStatus);
        if (funding?.usdcBalanceStr) setOperatorUsdcBalance(funding.usdcBalanceStr as string);
      } catch {}
    };
    load();
  }, [fetchState, fetchActive]);

  const isBefore = coarseState === 'beforeWallet' || coarseState === 'BeforeWallet' || coarseState === 'before_wallet';
  const isAfterNoClients = coarseState === 'afterWalletNoClients' || coarseState === 'AfterWalletNoClients' || coarseState === 'after_wallet_no_clients';
  const isAfterWithClients = coarseState === 'afterWalletWithClients' || coarseState === 'AfterWalletWithClients' || coarseState === 'after_wallet_with_clients';

  const fetchLinkedWallets = useCallback(async (): Promise<Address | null> => {
    try {
      const res = await fetch(`${baseApi}/linked-wallets`);
      if (!res.ok) return null;
      const j = await res.json();
      const arr = Array.isArray(j?.linked_wallets) ? j.linked_wallets : [];
      const pick = arr.find((w: any) => w?.is_managed) || arr[0];
      if (pick?.address) {
        const addr = pick.address as Address;
        setSingleHotWallet(addr);
        return addr;
      }
      return null;
    } catch {
      return null;
    }
  }, [baseApi]);

  useEffect(() => {
    if (isAfterNoClients) fetchLinkedWallets();
  }, [isAfterNoClients, fetchLinkedWallets]);

  const handleGenerateHotWallet = useCallback(async () => {
    try {
      await callApiWithRouting({ GenerateWallet: {} });
      await fetchLinkedWallets();
      await fetchState();
    } catch {}
  }, [fetchLinkedWallets, fetchState]);

  // Build live props for HyperwalletInterface when after_wallet_with_clients
  const buildHwProps = () => {
    // operatorTba & usdcBalance from graph
    // We already read graph at load; read again quickly for safety
    const operatorTba = (operatorTbaFromState as string) || '';
    const usdcBalance = operatorUsdcBalance || '0';

    // Clients from state.authorized_clients
    const authClients: any = (state?.authorized_clients as any) || {};
    const clientArr: HwClient[] = Object.values(authClients).map((c: any) => {
      const lims = (state as any)?.client_limits_cache?.[c.id] || {};
      const spent = lims.total_spent ?? lims.totalSpent ?? '0';
      const max = lims.max_total ?? lims.maxTotal ?? null;
      const wlKey = (c.associated_hot_wallet_address || '').toLowerCase?.() || c.associated_hot_wallet_address;
      const wlLims = (state as any)?.wallet_limits_cache?.[wlKey] || (state as any)?.wallet_limits_cache?.[c.associated_hot_wallet_address] || {};
      const fallbackMax = wlLims.max_total ?? wlLims.maxTotal ?? null;
      return {
        id: c.id,
        name: c.name,
        status: 'active',
        monthlyLimit: max != null ? Number(max) : (fallbackMax != null ? Number(fallbackMax) : undefined),
        monthlySpent: Number(spent || '0'),
        dailyLimit: undefined,
        dailySpent: undefined,
      } as HwClient;
    });

    // Events from state.call_history
    const history: any[] = (state?.call_history || []) as any[];
    const evArr: HwEvent[] = history.map((r: any) => {
      const success = r.payment_result && r.payment_result.Success ? r.payment_result.Success : null;
      const failed = r.payment_result && r.payment_result.Failed ? r.payment_result.Failed : null;
      const skipped = r.payment_result && r.payment_result.Skipped ? r.payment_result.Skipped : null;
      let status: 'success' | 'failed' | 'skipped' | undefined = undefined;
      if (success) status = 'success';
      else if (skipped) status = 'skipped';
      else if (r.call_success === false || failed) status = 'failed';

      let parsedArgs: any = undefined;
      try { parsedArgs = r.call_args_json ? JSON.parse(r.call_args_json) : undefined; } catch {}

      const providerNameFromArgs = parsedArgs?.providerName;
      const providerIdFromArgs = parsedArgs?.providerId;
      const providerNameFromRecord = r.provider_name || r.providerName;
      const providerIdFromRecord = r.target_provider_id || r.targetProviderId || r.provider_lookup_key;

      // Prefer ledger total cost (incl. gas) if present; fallback to provider amount
      const providerAmount = success ? Number(success.amount_paid) : 0;
      const ledgerCandidates = [
        (r as any)?.total_cost_usdc,
        (r as any)?.total_cost,
        (r as any)?.ledger_total_usdc,
        (r as any)?.ledger_total_cost,
        (r as any)?.cost_total_usdc,
        (r as any)?.cost_total,
        (r as any)?.spent_total_usdc,
        (r as any)?.spent_total,
      ];
      const ledgerValRaw = ledgerCandidates.find((v) => v !== undefined && v !== null);
      const ledgerAmount = ledgerValRaw != null ? Number(ledgerValRaw) : NaN;
      const effectiveCost = Number.isFinite(ledgerAmount) ? ledgerAmount : providerAmount;

      // Pull ledger-enriched total if embedded in response_json as total_cost_usdc
      let ledgerCostFromJson: number | undefined = undefined;
      if (typeof r.response_json === 'string' && r.response_json.length) {
        try {
          const blob = JSON.parse(r.response_json);
          const val = blob?.total_cost_usdc;
          if (val != null) ledgerCostFromJson = Number(val);
        } catch {}
      }

      return {
        id: r.timestamp_start_ms,
        timestamp: new Date(r.timestamp_start_ms).toISOString(),
        clientId: r.client_id || (() => {
          const ow = (r.operator_wallet_id || '').toLowerCase();
          for (const [cid, ac] of Object.entries(authClients)) {
            const addr = (ac as any)?.associated_hot_wallet_address?.toLowerCase?.();
            if (addr && addr === ow) return cid as string;
          }
          return undefined;
        })(),
        provider: providerIdFromArgs || providerIdFromRecord || r.provider_lookup_key || r.target_provider_id,
        providerName: providerNameFromArgs || providerNameFromRecord || r.provider_lookup_key || r.target_provider_id,
        cost: Number.isFinite(ledgerCostFromJson as any) ? (ledgerCostFromJson as number) : effectiveCost,
        providerCost: providerAmount,
        txHash: success ? success.tx_hash : '',
        status,
        skippedReason: skipped ? skipped.reason : undefined,
        errorMessage: failed ? failed.error : undefined,
        durationMs: r.duration_ms,
        request: parsedArgs ? { callArgs: parsedArgs, providerId: providerIdFromArgs || providerIdFromRecord || r.provider_lookup_key || r.target_provider_id, providerName: providerNameFromArgs || providerNameFromRecord || r.provider_lookup_key || r.target_provider_id } : { providerId: providerIdFromArgs || providerIdFromRecord || r.provider_lookup_key || r.target_provider_id, providerName: providerNameFromArgs || providerNameFromRecord || r.provider_lookup_key || r.target_provider_id },
        response: (() => {
          if (typeof r.response_json === 'string' && r.response_json.length) {
            try { return JSON.parse(r.response_json); } catch { return r.response_json; }
          }
          return undefined;
        })(),
      } as HwEvent;
    });

    return { operatorTba, usdcBalance, clients: clientArr, events: evArr };
  };

  const onSetLimits = async (clientId: string, limits: { maxPerCall?: string; maxTotal?: string }) => {
    try {
      await fetch(`${baseApi}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ SetClientLimits: { client_id: clientId, limits: { maxPerCall: limits.maxPerCall ?? null, maxTotal: limits.maxTotal ?? null, currency: 'USDC' } } }),
      });
      await fetchState();
    } catch {}
  };

  const onToggleClientStatus = async (_clientId: string) => {
    // placeholder: backend flag can be added later; no-op for now
  };

  const onOpenClientSettings = (clientId: string, clientName: string) => {
    const hotWallet = (state?.authorized_clients as any)?.[clientId]?.associated_hot_wallet_address || '';
    setClientModalData({ id: clientId, name: clientName, hotWallet });
    setIsClientModalOpen(true);
  };

  const onAddClient = async () => {
    // Prefer the existing managed hot wallet; create one if none exists
    let hw = singleHotWallet as string | null;
    if (!hw) {
      // Try to derive from existing authorized clients
      const firstClient = state && state.authorized_clients ? (Object.values(state.authorized_clients as any)[0] as any) : null;
      if (firstClient?.associated_hot_wallet_address) hw = firstClient.associated_hot_wallet_address as string;
    }
    if (!hw) {
      // Try to fetch linked wallets
      const fetched = await fetchLinkedWallets();
      if (fetched) hw = fetched as string;
    }
    if (!hw) {
      // Generate a new managed wallet, then refetch
      await handleGenerateHotWallet();
      const fetched = await fetchLinkedWallets();
      if (fetched) hw = fetched as string;
    }
    if (!hw) return; // Still none; backend will populate soon
    setSingleHotWallet(hw as Address);
    setHotWalletForNewClient(hw);
    setIsShimModalOpen(true);
  };

  return (
    <div style={{ ...monoBox, display: 'flex', flexDirection: 'column', gap: 12, padding: 16 }}>
      {isBefore && showIntro && (
        <WelcomeIntro
          onContinue={() => setShowIntro(false)}
        />
      )}
      {isBefore && !showIntro && (
        <OneClickOperatorBoot
          parentTbaAddress={ownerNodeTba as any}
          defaultOperatorEntryName={operatorEntryName}
          ownerEoa={ownerNodeOwnerEoa as any}
          onBootComplete={() => {
            fetchState();
            fetchActive();
            setCoarseState(null); // force refetch via effect
          }}
        />
      )}
      {isAfterNoClients && !showSetupComplete && (
        <OperatorFinalizeSetup
          operatorTbaAddress={operatorTbaFromState as any}
          hotWalletAddress={singleHotWallet as any}
          autoReload={false}
          onComplete={() => {
            fetchState();
            fetchActive();
            setShowSetupComplete(true);
          }}
        />
      )}
      {isAfterNoClients && showSetupComplete && (
        <SetupComplete
          onDone={() => {
            setCoarseState(null);
            window.location.reload();
          }}
        />
      )}
      {isAfterNoClients && (
        <div style={{ display: 'none' }} />
      )}
      {/* Mock panel hidden in production UI */}

      {mockMode ? (
        <HyperwalletInterface
          operatorTba={mockOperatorTba}
          usdcBalance={mockUsdcBalance}
          clients={mockClients}
          events={mockEvents}
          onSetLimits={onSetLimitsMock}
          onToggleClientStatus={onToggleClientStatusMock}
          onOpenClientSettings={() => {}}
          onAddClient={addMockClient}
          onOpenGraphView={() => setShowGraphView(true)}
        />
      ) : isAfterWithClients ? (
        <>
          <HyperwalletInterface
            operatorTba={buildHwProps().operatorTba}
            usdcBalance={buildHwProps().usdcBalance}
            clients={(buildHwProps().clients || []).map((c) => ({ ...c }))}
            events={(buildHwProps().events || []).map((e) => ({ ...e }))}
            onSetLimits={onSetLimits}
            onToggleClientStatus={onToggleClientStatus}
            onOpenClientSettings={onOpenClientSettings}
            onAddClient={onAddClient}
            onOpenGraphView={() => setShowGraphView(true)}
            nodeName={ownerNodeName || nodeId || undefined}
            isLoading={isRefreshingUi || !state}
          />
          {isClientModalOpen && clientModalData && (
            <AuthorizedClientConfigModal
              isOpen={isClientModalOpen}
              onClose={(refresh) => { setIsClientModalOpen(false); if (refresh) fetchState(); }}
              clientId={clientModalData.id}
              clientName={clientModalData.name}
              hotWalletAddress={clientModalData.hotWallet}
              onClientUpdate={() => fetchState()}
            />
          )}
          {isShimModalOpen && (
            <ShimApiConfigModal
              isOpen={isShimModalOpen}
              onClose={(_refresh) => {
                setIsShimModalOpen(false);
                setHotWalletForNewClient(null);
                window.location.reload();
              }}
              hotWalletAddress={(hotWalletForNewClient || (singleHotWallet as any) || '') as any}
              onClientCreated={(clientId) => {
                // Optimistically add to React state immutably; then refetch to sync
                setState((prev) => {
                  if (!prev) {
                    return {
                      authorized_clients: {
                        [clientId]: { id: clientId, name: clientId, associated_hot_wallet_address: (singleHotWallet as any) || '' },
                      },
                      wallet_limits_cache: {},
                      call_history: [],
                    } as any;
                  }
                  const prevAC: any = prev.authorized_clients || {};
                  if (prevAC[clientId]) return prev;
                  return {
                    ...prev,
                    authorized_clients: {
                      ...prevAC,
                      [clientId]: {
                        id: clientId,
                        name: clientId,
                        associated_hot_wallet_address: (singleHotWallet as any) || '',
                      },
                    },
                  } as any;
                });
                refreshAll();
              }}
            />
          )}
        </>
      ) : (
        <HyperwalletInterface
          operatorTba={(state?.operator_tba_address as any) || ''}
          usdcBalance={'0'}
          clients={[]}
          events={[]}
          onSetLimits={onSetLimits}
          onToggleClientStatus={onToggleClientStatus}
          onOpenClientSettings={() => {}}
          onAddClient={onAddClient}
          onOpenGraphView={() => setShowGraphView(true)}
          nodeName={ownerNodeName || nodeId || undefined}
          isLoading={true}
        />
      )}
      {showGraphView && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', padding: 24 }}>
          <div style={{ background: '#fff', height: '100%', overflow: 'hidden', padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontWeight: 600 }}>Graph View</div>
              <button onClick={() => setShowGraphView(false)} style={{ background: '#eee', border: '1px solid #ddd', padding: '4px 8px' }}>Close</button>
            </div>
            <div style={{ height: 'calc(100% - 40px)' }}>
              <BackendDrivenHypergridVisualizerWrapper />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const ClientRow: React.FC<{
  client: { id: string; name: string; wallet: string; usage: number; spent: number; limits?: SpendingLimits };
  onSetLimits: (client: { id: string; wallet: string }, newLimits: { maxPerCall?: string; maxTotal?: string }) => void;
}> = ({ client, onSetLimits }) => {
  const [editing, setEditing] = useState(false);
  const [maxPerCall, setMaxPerCall] = useState<string>(client.limits?.maxPerCall ?? '');
  const [maxTotal, setMaxTotal] = useState<string>(client.limits?.maxTotal ?? '');

  useEffect(() => {
    setMaxPerCall(client.limits?.maxPerCall ?? '');
    setMaxTotal(client.limits?.maxTotal ?? '');
  }, [client.limits?.maxPerCall, client.limits?.maxTotal]);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 2fr', gap: 8, alignItems: 'center', borderBottom: '1px solid #f0f0f0', padding: '6px 0' }}>
      <div>
        <div>{client.name}</div>
        <div style={{ color: '#888', fontSize: 12 }}>{client.wallet}</div>
      </div>
      <div>{formatUsdc(client.spent)} USDC</div>
      <div>{client.usage}</div>
      <div>
        {!editing && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ color: '#444' }}>per-call: {client.limits?.maxPerCall ?? '—'}</div>
            <div style={{ color: '#444' }}>total: {client.limits?.maxTotal ?? '—'}</div>
            <button style={{ background: '#eee', border: '1px solid #ddd', padding: '2px 6px' }} onClick={() => setEditing(true)}>set</button>
          </div>
        )}
        {editing && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input value={maxPerCall} onChange={(e) => setMaxPerCall(e.target.value)} placeholder="max per call" style={{ width: 120, padding: 4, border: '1px solid #ddd', background: '#fff' }} />
            <input value={maxTotal} onChange={(e) => setMaxTotal(e.target.value)} placeholder="max total" style={{ width: 120, padding: 4, border: '1px solid #ddd', background: '#fff' }} />
            <button style={{ background: '#eee', border: '1px solid #ddd', padding: '2px 6px' }} onClick={async () => { await onSetLimits({ id: client.id, wallet: client.wallet }, { maxPerCall, maxTotal }); setEditing(false); }}>save</button>
            <button style={{ background: '#fafafa', border: '1px solid #ddd', padding: '2px 6px' }} onClick={() => setEditing(false)}>cancel</button>
          </div>
        )}
      </div>
    </div>
  );
};

export default OperatorConsole;



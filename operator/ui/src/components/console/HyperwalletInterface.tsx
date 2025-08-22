import React, { useMemo, useState } from 'react';

export type HwClient = {
  id: string;
  name: string;
  status: 'active' | 'paused';
  monthlyLimit?: number;
  dailyLimit?: number;
  monthlySpent?: number;
  dailySpent?: number;
};

export type HwEvent = {
  id: string | number;
  timestamp: string;
  clientId?: string;
  provider?: string; // host node id (e.g., gooberware.os)
  providerName?: string; // human tool name (e.g., haiku-message-answering-machine)
  providerId?: string; // explicit id if available
  tool?: string;
  cost: number;
  txHash?: string;
  status?: 'success' | 'failed' | 'skipped';
  skippedReason?: string;
  errorMessage?: string;
  durationMs?: number;
  request?: any; // { callArgs?: any, providerId?: string, providerName?: string }
  response?: any; // preview/raw
};

type Props = {
  operatorTba: string;
  usdcBalance: string;
  clients: HwClient[];
  events: HwEvent[];
  onSetLimits: (clientId: string, limits: { maxPerCall?: string; maxTotal?: string }) => Promise<void> | void;
  onToggleClientStatus: (clientId: string) => Promise<void> | void;
  onOpenClientSettings: (clientId: string, clientName: string) => void;
  onAddClient: () => void;
  onOpenGraphView?: () => void;
  nodeName?: string;
};

const HyperwalletInterface: React.FC<Props> = ({ operatorTba, usdcBalance, clients, events, onSetLimits, onToggleClientStatus, onOpenClientSettings, onAddClient, onOpenGraphView, nodeName: nodeNameProp }) => {
  const [selectedClients, setSelectedClients] = useState<Set<string>>(new Set(['openai', 'anthropic', 'google']));
  const [expandedClient, setExpandedClient] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'totalSpent' | 'usage' | 'name'>('totalSpent');
  // Event sorting (tri-state per column)
  const [eventSortKey, setEventSortKey] = useState<'time' | 'client' | 'provider' | 'status' | 'cost' | 'tx'>('time');
  const [eventSortDir, setEventSortDir] = useState<'asc' | 'desc' | 'none'>('desc');
  const [editingLimits, setEditingLimits] = useState<Record<string, boolean>>({});
  // Optimistic overlays for immediate UX feedback
  const [optimistic, setOptimistic] = useState<Record<string, Partial<HwClient>>>({});

  const updateLimit = async (clientId: string, limitType: string, value: string) => {
    if (limitType === 'total') {
      const parsed = Number(value || '0');
      setOptimistic((prev) => ({ ...prev, [clientId]: { ...(prev[clientId] || {}), monthlyLimit: isNaN(parsed) ? 0 : parsed } }));
    }
    await onSetLimits(clientId, { [limitType === 'total' ? 'maxTotal' : 'maxPerCall']: value });
  };
  const toggleClientStatus = async (clientId: string) => {
    const base = clients.find((c) => c.id === clientId);
    const current = (optimistic[clientId]?.status || base?.status || 'active');
    const next = current === 'active' ? 'paused' : 'active';
    setOptimistic((prev) => ({ ...prev, [clientId]: { ...(prev[clientId] || {}), status: next } }));
    await onToggleClientStatus(clientId);
  };

  const hwClients = clients || [];
  const hwEvents = events || [];

  const balanceHistory = useMemo(() => {
    let runningBalance = 3500;
    const sortedEvents = [...hwEvents].sort((a, b) => Number(new Date(a.timestamp)) - Number(new Date(b.timestamp)));
    return sortedEvents.map((event) => ({ timestamp: event.timestamp, balance: (runningBalance -= event.cost), event, client: event.clientId }));
  }, []);

  const sortedClients = useMemo(() => {
    return [...hwClients].sort((a: any, b: any) => {
      switch (sortBy) {
        case 'name':
          return a.name.localeCompare(b.name);
        case 'usage':
          return (b.monthlySpent || 0) / (b.monthlyLimit || 1) - (a.monthlySpent || 0) / (a.monthlyLimit || 1);
        case 'totalSpent':
        default:
          return (b.monthlySpent || 0) - (a.monthlySpent || 0);
      }
    });
  }, [sortBy]);

  const filteredEvents = useMemo(() => {
    const arr = [...hwEvents];
    const dir = eventSortDir;
    if (dir === 'none') {
      // Default to time desc for readability
      return arr.sort((a, b) => Number(new Date(b.timestamp)) - Number(new Date(a.timestamp)));
    }
    const mul = dir === 'asc' ? 1 : -1;
    const getClientName = (id?: string) => {
      const nm = hwClients.find((c) => c.id === id)?.name || '';
      return nm.toLowerCase();
    };
    const getStatusRank = (e: HwEvent) => {
      const s = getStatusInfo(e).status;
      return s === 'success' ? 3 : s === 'skipped' ? 2 : s === 'failed' ? 1 : 0;
    };
    const getTxRank = (e: HwEvent) => (e.txHash ? 1 : 0);
    const getProviderName = (e: HwEvent) => (e as any).providerName || e.provider || '';
    arr.sort((a, b) => {
      switch (eventSortKey) {
        case 'time': {
          const va = Number(new Date(a.timestamp));
          const vb = Number(new Date(b.timestamp));
          if (va === vb) return 0;
          return va < vb ? -1 * mul : 1 * mul;
        }
        case 'client': {
          const va = getClientName(a.clientId);
          const vb = getClientName(b.clientId);
          if (va === vb) return 0;
          return va < vb ? -1 * mul : 1 * mul;
        }
        case 'provider': {
          const va = (getProviderName(a) || '').toLowerCase();
          const vb = (getProviderName(b) || '').toLowerCase();
          if (va === vb) return 0;
          return va < vb ? -1 * mul : 1 * mul;
        }
        case 'status': {
          const va = getStatusRank(a);
          const vb = getStatusRank(b);
          if (va === vb) return 0;
          return va < vb ? -1 * mul : 1 * mul;
        }
        case 'cost': {
          const va = a.cost || 0;
          const vb = b.cost || 0;
          if (va === vb) return 0;
          return va < vb ? -1 * mul : 1 * mul;
        }
        case 'tx': {
          const va = getTxRank(a);
          const vb = getTxRank(b);
          if (va === vb) return 0;
          return va < vb ? -1 * mul : 1 * mul;
        }
        default:
          return 0;
      }
    });
    return arr;
  }, [hwEvents, hwClients, eventSortKey, eventSortDir]);

  const toggleSort = (key: 'time' | 'client' | 'provider' | 'status' | 'cost' | 'tx') => {
    if (eventSortKey !== key) {
      // Choose sensible defaults per column
      const initial: Record<string, 'asc' | 'desc'> = {
        time: 'desc',
        client: 'asc',
        provider: 'asc',
        status: 'desc', // success first
        cost: 'desc',   // highest spend first
        tx: 'desc',     // with tx first
      };
      setEventSortKey(key);
      setEventSortDir(initial[key]);
      return;
    }
    // cycle current key: asc → desc → none → asc
    setEventSortDir((prev) => (prev === 'asc' ? 'desc' : prev === 'desc' ? 'none' : 'asc'));
  };

  const toggleClient = (clientId: string) => {
    const next = new Set(selectedClients);
    if (next.has(clientId)) next.delete(clientId);
    else next.add(clientId);
    setSelectedClients(next);
  };

  const formatAddress = (address?: string) => (address ? `${address.slice(0, 6)}...${address.slice(-4)}` : '—');
  const formatTimestamp = (timestamp: string) => new Date(timestamp).toLocaleString();
  const colorPalette = ['#10b981', '#3b82f6', '#ef4444', '#f59e0b', '#8b5cf6', '#06b6d4'];
  const getClientColor = (clientId: string) => {
    const idx = hwClients.findIndex((c) => c.id === clientId);
    return colorPalette[(idx + colorPalette.length) % colorPalette.length] || '#666';
  };

  const getStatusInfo = (e: HwEvent) => {
    let status: 'success' | 'failed' | 'skipped' | 'unknown' = 'unknown';
    if (e.status) status = e.status;
    else if (typeof e.cost === 'number' && e.cost > 0) status = 'success';
    else if (e.txHash) status = 'success';
    else if (e.skippedReason) status = 'skipped';
    else if (e.errorMessage) status = 'failed';
    const label = status === 'unknown' ? '—' : status.charAt(0).toUpperCase() + status.slice(1);
    const classes =
      status === 'success'
        ? 'bg-green-100 text-green-700'
        : status === 'failed'
        ? 'bg-red-100 text-red-700'
        : status === 'skipped'
        ? 'bg-yellow-100 text-yellow-700'
        : 'bg-gray-100 text-gray-600';
    return { status, label, classes };
  };

  const [expandedEventId, setExpandedEventId] = useState<string | number | null>(null);
  const copyToClipboard = async (text: string) => {
    try { await navigator.clipboard.writeText(text); } catch {}
  };

  const nodeName = nodeNameProp || (window as any)?.our?.node || '';
  const balanceNum = (() => {
    const n = Number(usdcBalance || '0');
    return Number.isFinite(n) ? n : 0;
  })();
  const isLowBalance = balanceNum < 1;
  const [copied, setCopied] = useState<boolean>(false);

  return (
    <div className="min-h-screen bg-gray-50 font-sans text-sm">
      <div className="max-w-7xl mx-auto p-6 space-y-8">
        <section className="bg-white rounded-2xl shadow-sm p-4 relative w-full max-w-[400px] aspect-[1.586] overflow-visible">
          {/* Top-left: Hypergrid logo */}
          <div className="absolute left-4 top-3 flex items-center gap-2">
            <img src={`${import.meta.env.BASE_URL}/Logomark.svg`} alt="HYPERGRID" className="h-6 w-auto" />
          </div>
          {/* Top-right: node.os name */}
          <div className="absolute right-4 top-3 text-sm text-gray-900 font-medium">
            {nodeName || '—'}
          </div>
          {/* Center: balance */}
          <div className="absolute inset-0 flex items-center justify-center text-gray-900">
            <span className="font-semibold text-4xl align-middle">{balanceNum.toLocaleString()}</span>
            <span className="ml-2 text-sm align-middle">USDC</span>
            {isLowBalance && (
              <div className="relative group ml-2">
                <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-yellow-400 text-white text-sm font-bold align-middle">!</span>
                <div className="absolute left-full top-1/2 ml-2 -translate-y-1/2 whitespace-nowrap rounded bg-yellow-300 text-black text-xs px-3 py-1.5 shadow-lg z-50 opacity-0 group-hover:opacity-100 transition-opacity duration-0">
                  Add funds by sending USDC on Base to your address {formatAddress(operatorTba)}
                </div>
              </div>
            )}
          </div>
          {/* Bottom-left: full address, click-to-copy */}
          <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 text-gray-600">
            <button
              title={copied ? 'Copied' : 'Click to copy'}
              onClick={async () => { await copyToClipboard(operatorTba); setCopied(true); setTimeout(() => setCopied(false), 1200); }}
              className="font-mono text-sm tracking-wide hover:underline cursor-pointer text-center whitespace-nowrap relative"
            >
              {operatorTba || '—'}
              {copied && (
                <span className="absolute -top-8 left-1/2 transform -translate-x-1/2 bg-gray-800 text-white text-xs px-2 py-1 rounded shadow-lg z-50">
                  Copied
                </span>
              )}
            </button>
          </div>
        </section>


        <section className="bg-white rounded-2xl shadow-sm p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="font-medium text-gray-900">Clients</h2>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value as any)} className="border border-gray-300 px-2 py-1 text-xs">
              <option value="totalSpent">Total Spent</option>
              <option value="usage">Current Usage</option>
              <option value="name">Name</option>
            </select>
          </div>

          <div className="space-y-1 divide-y divide-gray-200">
            {sortedClients.map((client: any) => {
              const overlay = optimistic[client.id] || {};
              const merged = { ...client, ...overlay } as HwClient & { lastActivity?: string };
              const monthlyUsage = ((merged.monthlySpent || 0) / (merged.monthlyLimit || 1)) * 100;
              const isExpanded = expandedClient === merged.id;
              return (
                <div key={client.id}>
                  <div className={`flex items-center justify-between p-3 cursor-pointer hover:bg-gray-50 rounded-md border border-gray-200`} onClick={() => setExpandedClient(isExpanded ? null : merged.id)}>
                    <div className="flex items-center gap-3">
                      <div className="w-4 h-4 rounded-sm" style={{ backgroundColor: getClientColor(merged.id) }} />
                      <span className="font-medium">{merged.name}</span>
                      <div className={`px-2 py-1 text-xs rounded-full ${merged.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>{merged.status}</div>
                    </div>
                    <div className="flex items-center gap-6 text-xs text-gray-600">
                      <span>Spent: ${(merged.monthlySpent || 0).toLocaleString()}</span>
                      <span>Limit: {(merged.monthlyLimit || 0).toLocaleString()}</span>
                      <span className="text-gray-400">{isExpanded ? '−' : '+'}</span>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="ml-3 pl-4 border-l border-gray-100 bg-gray-50/60 rounded-xl">
                      <div className="p-4">
                        <div className="mb-4">
                          <div>
                            <div className="flex items-center justify-between mb-2">
                              <label className="text-xs font-medium text-gray-700">Total Spending Limit</label>
                              <div className="flex items-center gap-2">
                                {editingLimits[`${merged.id}-total`] ? (
                                  <input type="number" defaultValue={merged.monthlyLimit} className="w-24 px-2 py-1 text-xs border border-gray-300 rounded-md" onBlur={(e) => { updateLimit(merged.id, 'total', e.target.value); setEditingLimits((prev) => ({ ...prev, [`${merged.id}-total`]: false })); }} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} autoFocus />
                                ) : (
                                  <button onClick={() => setEditingLimits((prev) => ({ ...prev, [`${merged.id}-total`]: true }))} className="text-xs text-blue-600 hover:text-blue-800">Limit: ${Number(merged.monthlyLimit || 0).toLocaleString()}</button>
                                )}
                              </div>
                            </div>
                            <div className="w-full bg-gray-200 rounded-full h-2">
                              <div className={`h-2 rounded-full transition-all ${monthlyUsage > 90 ? 'bg-red-500' : monthlyUsage > 70 ? 'bg-yellow-500' : 'bg-green-500'}`} style={{ width: `${Math.min(monthlyUsage, 100)}%` }} />
                            </div>
                            <div className="text-xs text-gray-600 mt-1">${(merged.monthlySpent || 0).toLocaleString()} / ${(merged.monthlyLimit || 0).toLocaleString()} ({monthlyUsage.toFixed(1)}%)</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 pb-2">
                          <button onClick={() => toggleClientStatus(merged.id)} className={`px-3 py-1 text-xs border rounded-md ${merged.status === 'active' ? 'border-red-300 text-red-700 hover:bg-red-50' : 'border-green-300 text-green-700 hover:bg-green-50'}`}>{merged.status === 'active' ? 'Halt' : 'Resume'}</button>
                          {/* remove client button hidden for now */}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            <div className="flex items-center justify-between p-3 border border-gray-200 cursor-pointer hover:bg-gray-50 rounded-lg text-gray-600 hover:text-gray-800" onClick={onAddClient}>
              <div className="flex items-center gap-3">
                <div className="w-4 h-4 rounded-sm bg-gray-300" />
                <span className="font-medium">Add Client</span>
              </div>
              <span className="text-xs">+</span>
            </div>
          </div>
        </section>

        <section className="bg-white rounded-2xl shadow-sm p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="font-medium text-gray-900">All Events</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs table-fixed">
              <colgroup>
                <col style={{ width: '180px' }} />
                <col style={{ width: '220px' }} />
                <col style={{ width: '280px' }} />
                <col style={{ width: '120px' }} />
                <col style={{ width: '100px' }} />
                <col style={{ width: '140px' }} />
              </colgroup>
              <thead className="border-b border-gray-200">
                <tr className="text-left text-gray-600">
                  {([
                    { key: 'time', label: 'Time' },
                    { key: 'client', label: 'Client' },
                    { key: 'provider', label: 'Provider Name' },
                    { key: 'status', label: 'Status' },
                    { key: 'cost', label: 'Cost' },
                    { key: 'tx', label: 'Transaction' },
                  ] as Array<{ key: any; label: string }>).map((col) => {
                    const active = eventSortKey === col.key;
                    const dir = active ? eventSortDir : 'none';
                    const icon = dir === 'asc' ? '▲' : dir === 'desc' ? '▼' : '';
                    return (
                      <th key={col.key as string} className="py-2 whitespace-nowrap">
                        <button onClick={() => toggleSort(col.key)} className="inline-flex items-center gap-1 text-left">
                          <span>{col.label}</span>
                          <span className="text-gray-500 text-[10px] inline-block w-3 text-center">{icon}</span>
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {filteredEvents.map((event) => {
                  const status = getStatusInfo(event);
                  const isExpanded = expandedEventId === event.id;
                  const clientName = hwClients.find((c) => c.id === event.clientId)?.name;
                  return (
                    <>
                      <tr key={String(event.id)} className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer" onClick={() => setExpandedEventId(isExpanded ? null : event.id)}>
                        <td className="py-2 whitespace-nowrap">{formatTimestamp(event.timestamp)}</td>
                        <td className="py-2 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: getClientColor(event.clientId || '') }} />
                            {clientName}
                          </div>
                        </td>
                        <td className="py-2"><span className="block max-w-[220px] truncate" title={event.providerName || event.provider || ''}>{event.providerName || event.provider || '—'}</span></td>
                        <td className="py-2 whitespace-nowrap"><span className={`px-2 py-0.5 rounded ${status.classes}`}>{status.label}</span></td>
                        <td className="py-2 font-medium whitespace-nowrap">${(event.cost || 0).toLocaleString()}</td>
                        <td className="py-2 whitespace-nowrap">
                          {event.txHash ? (
                            <a href={`https://basescan.org/tx/${event.txHash}`} target="_blank" rel="noreferrer" className="text-blue-600 hover:text-blue-800">
                              {formatAddress(event.txHash)}
                            </a>
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td className="py-3 bg-gray-50" colSpan={6}>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div>
                                <div className="text-xs text-gray-500 mb-1">Request</div>
                                <pre className="bg-white border border-gray-200 p-2 text-[10px] overflow-x-auto max-h-40">{JSON.stringify(event.request || { providerName: event.providerName, providerId: event.provider || event.providerId, clientId: event.clientId }, null, 2)}</pre>
                                <button className="mt-1 text-xs text-blue-600" onClick={(e) => { e.stopPropagation(); copyToClipboard(JSON.stringify(event.request || {}, null, 2)); }}>Copy request</button>
                              </div>
                              <div>
                                <div className="text-xs text-gray-500 mb-1">Response</div>
                                <pre className="bg-white border border-gray-200 p-2 text-[10px] overflow-x-auto max-h-40">{event.errorMessage ? event.errorMessage : JSON.stringify(event.response || {}, null, 2)}</pre>
                                <button className="mt-1 text-xs text-blue-600" onClick={(e) => { e.stopPropagation(); copyToClipboard(event.errorMessage || JSON.stringify(event.response || {}, null, 2)); }}>Copy response</button>
                              </div>
                            </div>
                            <div className="mt-2 text-xs text-gray-600 flex flex-wrap gap-4">
                              <div>Duration: {event.durationMs ? `${(event.durationMs / 1000).toFixed(2)}s` : '—'}</div>
                              {event.skippedReason && <div>Payment: Skipped ({event.skippedReason})</div>}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
};

export default HyperwalletInterface;



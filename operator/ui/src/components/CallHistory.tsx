import React, { useState, useEffect, useCallback } from 'react';
import { format } from 'date-fns'; // Using date-fns for timestamp formatting
// Import shared types
import { CallRecord, PaymentAttemptResult } from '../logic/types';
import { API_ACTIONS_ENDPOINT } from '../utils/api-endpoints';

// Add props interface
interface CallHistoryProps {
    selectedAccountId: string | null;
    isNonCollapsible?: boolean; // New prop
}

// --- API Endpoint ---
const getApiBasePath = () => {
    const pathParts = window.location.pathname.split('/').filter(p => p);
    const processIdPart = pathParts.find(part => part.includes(':'));
    return processIdPart ? `/${processIdPart}/api` : '/api';
};
const API_BASE_URL = getApiBasePath();
const MCP_ENDPOINT = `${API_BASE_URL}/mcp`; // Use client's MCP endpoint

// --- Helper Functions ---
const formatTimestamp = (ms: number): string => {
    if (!ms) return '-';
    try {
        // Ensure ms is treated as a number before passing to Date
        return format(new Date(Number(ms)), 'yyyy-MM-dd HH:mm:ss');
    } catch (e) {
        console.error("Invalid timestamp for formatting:", ms, e);
        return 'Invalid Date';
    }
};

const formatDuration = (ms: number): string => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
};

const truncateString = (str: string | null | undefined, len: number = 10): string => {
    if (!str) return '-';
    if (str.length <= len + 3) return str;
    const prefix = str.startsWith('0x') ? '0x' : '';
    const addressPart = prefix ? str.substring(2) : str;
    const visibleLen = len - prefix.length - 3;
    if (visibleLen <= 1) return prefix + '...';
    const start = prefix + addressPart.substring(0, Math.ceil(visibleLen / 2));
    const end = addressPart.substring(addressPart.length - Math.floor(visibleLen / 2));
    return `${start}...${end}`;
}

const renderPaymentResult = (result: PaymentAttemptResult | null | undefined) => {
    if (!result) return <span className="text-gray-400">N/A</span>;

    if ('Success' in result && result.Success) {
        const successData = result.Success;
        const txUrl = `https://basescan.org/tx/${successData.tx_hash}`;

        // Function to copy text to clipboard (keep for potential future use?)
        // const copyToClipboard = (text: string) => { ... };

        return (
            <span className="text-green-600">
                Success ({successData.amount_paid} {successData.currency},
                {/* Make hash a link to Basescan */}
                <a
                    href={txUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={`View Tx on Basescan: ${successData.tx_hash}`}
                    className="tx-hash-link"
                    style={{ marginLeft: '0.25em' }} // Add some spacing
                >
                    <code className='text-xs'>{truncateString(successData.tx_hash, 10)}</code>
                </a>
                )
            </span>
        );
    }
    if ('Failed' in result && result.Failed) {
        const failedData = result.Failed;
        return <span className="text-red-600" title={failedData.error}>Failed ({failedData.amount_attempted} {failedData.currency})</span>;
    }
    if ('LimitExceeded' in result && result.LimitExceeded) {
        const limitData = result.LimitExceeded;
        return <span className="text-yellow-600" title={`Attempted: ${limitData.amount_attempted} ${limitData.currency}`}>Limit Exceeded ({limitData.limit})</span>;
    }
    if ('Skipped' in result && result.Skipped) {
        return <span className="text-gray-500">Skipped ({result.Skipped.reason})</span>;
    }
    return <span className="text-gray-400">Unknown</span>;
}

// Helper to format JSON arguments
const formatArgs = (argsJson: string): React.ReactNode => {
    try {
        const args = JSON.parse(argsJson);
        // Pretty print with 2-space indentation
        const formatted = JSON.stringify(args, null, 2);
        // Wrap in <pre> for formatting and <code> for styling
        return <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}><code>{formatted}</code></pre>;
    } catch (e) {
        // If parsing fails, return the original string truncated
        return <code title={argsJson}>{truncateString(argsJson, 30)}</code>;
    }
};

// --- Component ---
const CallHistory: React.FC<CallHistoryProps> = ({ selectedAccountId, isNonCollapsible = false }) => { // Accept props
    const [allHistory, setAllHistory] = useState<CallRecord[]>([]); // Store all fetched history
    const [filteredHistory, setFilteredHistory] = useState<CallRecord[]>([]); // History filtered for selected account
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);
    const [isCollapsed, setIsCollapsed] = useState<boolean>(isNonCollapsible ? false : false);

    // Fetch ALL history
    const fetchHistory = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        // setAllHistory([]); // Don't clear immediately, wait for fetch
        try {
            const requestBody = { GetCallHistory: {} };
            const response = await fetch(API_ACTIONS_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody),
            });
            if (!response.ok) {
                const errData = await response.json().catch(() => ({ error: `HTTP error! Status: ${response.status}` }));
                throw new Error(errData.error || `Failed to fetch history: ${response.statusText}`);
            }
            const data: CallRecord[] = await response.json();
            console.log('CallHistory data:', data);
            setAllHistory(data.reverse()); // Store all history, newest first
        } catch (err) {
            setError(err instanceof Error ? err.message : 'An unknown error occurred');
            setAllHistory([]); // Clear on error
        } finally {
            setIsLoading(false);
        }
    }, []);

    // Effect to fetch history once on mount
    useEffect(() => {
        fetchHistory();
    }, [fetchHistory]);

    // Effect to filter history whenever allHistory or selectedAccountId changes
    useEffect(() => {
        console.log(`[CallHistory Filter] Active. Selected Account ID: "${selectedAccountId}"`);
        console.log(`[CallHistory Filter] Total records in allHistory before filtering: ${allHistory.length}`);

        if (allHistory.length > 0 && selectedAccountId) {
            // Log a sample of operator_wallet_ids from allHistory for diagnosis
            const sampleIds = allHistory.slice(0, Math.min(5, allHistory.length)).map(r => r.operator_wallet_id);
            console.log(`[CallHistory Filter] Sample operator_wallet_ids from allHistory (first 5):`, sampleIds);
            // Log if the current selectedAccountId is found in these samples
            const isSelectedIdInSample = sampleIds.includes(selectedAccountId);
            console.log(`[CallHistory Filter] Is selectedAccountId ("${selectedAccountId}") present in the first 5 samples? ${isSelectedIdInSample}`);
        }

        if (selectedAccountId) {
            const newFilteredHistory = allHistory.filter(record => {
                const match = record.operator_wallet_id === selectedAccountId;
                // To avoid excessive logging, this detailed comparison log is commented out by default.
                // Uncomment if you need to see every comparison:
                // console.log(`[CallHistory Filter] Comparing: record.operator_wallet_id ("${record.operator_wallet_id}") === selectedAccountId ("${selectedAccountId}") -> ${match}`);
                return match;
            });
            setFilteredHistory(newFilteredHistory);
            console.log(`[CallHistory Filter] Filtered. Records count for "${selectedAccountId}": ${newFilteredHistory.length}`);
        } else {
            setFilteredHistory([]);
            console.log('[CallHistory Filter] No account selected or allHistory empty. Filtered history set to empty array.');
        }
    }, [allHistory, selectedAccountId]);

    const thClass = "border border-dark-gray px-3 py-2 text-left bg-gray text-dark-gray dark:text-gray dark:bg-dark-gray font-medium"
    const tdClass = "border border-gray dark:border-dark-gray px-3 py-2 text-left align-top"
    return (
        <div className="history-container">
            {/* Header is now conditional based on isNonCollapsible */}
            {!isNonCollapsible && (
                <div className="history-header" onClick={() => setIsCollapsed(!isCollapsed)}>
                    <h3>
                        Call History {selectedAccountId ? `for ${truncateString(selectedAccountId, 12)}` : ''}
                        <span className="collapse-indicator" style={{ marginLeft: '0.5em' }}>
                            {isCollapsed ? '[+]' : '[-]'}
                        </span>
                    </h3>
                    <div className="header-actions">
                        <button
                            onClick={(e) => { e.stopPropagation(); fetchHistory(); }}
                            disabled={isLoading}
                            className="button refresh-button icon-button px-2 py-1 text-sm"
                            title="Refresh History"
                        >
                            {isLoading ? '...' : '↻'}
                        </button>
                    </div>
                </div>
            )}

            {/* Content rendering logic now respects isCollapsed OR isNonCollapsible */}
            {(isNonCollapsible || !isCollapsed) && (
                <div className={isNonCollapsible ? "history-content-non-collapsible" : "history-content"}>
                    {error && <div className="text-red-900 bg-red-200 border border-red-300 rounded p-6 text-center">{error}</div>}

                    {/* Loading/Empty checks based on filteredHistory */}
                    {isLoading ? (
                        <p className="text-dark-gray dark:text-gray text-base p-6 text-center">Loading history...</p>
                    ) : filteredHistory.length === 0 && !error ? (
                        <p className="text-dark-gray dark:text-gray text-base p-6 text-center">
                            {selectedAccountId
                                ? 'No call history recorded for this account.'
                                : (isNonCollapsible ? 'No call history available for this wallet.' : 'Select an account to view its history.')}
                        </p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full border-collapse mt-4 text-sm">
                                <thead>
                                    <tr>
                                        <th className={thClass}>Time</th>
                                        <th className={thClass}>Provider</th>
                                        <th className={thClass}>Args</th>
                                        <th className={thClass}>Duration</th>
                                        <th className={thClass}>Status</th>
                                        <th className={thClass}>Payment</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {/* Map over filteredHistory */}
                                    {filteredHistory.map((record, index) => (
                                        <tr key={`${record.timestamp_start_ms}-${index}-${record.operator_wallet_id}`} className="even:bg-gray dark:even:bg-dark-gray"> {/* Add account to key */}
                                            <td className={tdClass} title={`Start: ${record.timestamp_start_ms}, End: ${record.response_timestamp_ms}`}>{formatTimestamp(record.timestamp_start_ms)}</td>
                                            <td className={tdClass} title={record.target_provider_id}>{truncateString(record.provider_lookup_key, 25)}</td>
                                            <td className={tdClass}>{formatArgs(record.call_args_json)}</td>
                                            <td className={tdClass}>{formatDuration(record.duration_ms)}</td>
                                            <td className={tdClass}>
                                                <span className={record.call_success ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>
                                                    {record.call_success ? 'Success' : 'Failed'}
                                                </span>
                                            </td>
                                            <td className={tdClass}>{renderPaymentResult(record.payment_result)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

export default CallHistory;
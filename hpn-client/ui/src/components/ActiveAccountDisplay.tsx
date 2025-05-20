import React, { useState, useEffect, useCallback } from 'react';
import { format } from 'date-fns';
import CopyToClipboardText from './CopyToClipboardText';
// Import shared types
import { WalletSummary, ActiveAccountDetails, PaymentAttemptResult } from '../logic/types';

// --- API Endpoint --- 
const getApiBasePath = () => {
    const pathParts = window.location.pathname.split('/').filter(p => p);
    const processIdPart = pathParts.find(part => part.includes(':'));
    return processIdPart ? `/${processIdPart}/api` : '/api';
};
const API_BASE_URL = getApiBasePath();
const MCP_ENDPOINT = `${API_BASE_URL}/mcp`;

// --- Helper Functions --- 
const formatTimestamp = (ms: number): string => {
    if (!ms) return '-';
    try {
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

// Restore truncateString helper
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

// Add Props interface
interface ActiveAccountDisplayProps {
    activeAccountDetails: ActiveAccountDetails | null;
    isLoading: boolean;
    error: string | null;
    onRetry: () => void; // Function to retry fetching
}

// --- Component --- 
// Accept props
const ActiveAccountDisplay: React.FC<ActiveAccountDisplayProps> = ({ 
    activeAccountDetails, 
    isLoading, 
    error, 
    onRetry 
}) => {
    // Decide what to render based on props
    let content;
    if (isLoading && !activeAccountDetails && !error) { 
        content = <p className="loading-message small">Loading active account status...</p>;
    } else if (error && !activeAccountDetails) { 
        content = (
             <div className="error-message small">
                 Error: {error} 
                 <button onClick={onRetry} className='button action-button'>Retry</button> {/* Use onRetry prop */}
             </div>
        );
    } else if (activeAccountDetails) {
        // Account details are available, render structure
        content = (
            <div className="status-content compact active-account-details">
                {/* Account Info */}
                <div className="account-info">
                    <strong>Active Wallet:</strong> 
                    <span style={{ marginLeft: '0.5em' }}>{activeAccountDetails.name || truncateString(activeAccountDetails.address)}</span>
                    <CopyToClipboardText
                        textToCopy={activeAccountDetails.address}
                        className="wallet-address-short"
                        style={{marginLeft: '0.5em'}}
                    >
                       <code title="">{truncateString(activeAccountDetails.address)}</code>
                    </CopyToClipboardText>
                    <span className={`status-dot active`} style={{marginLeft: '0.5em'}} title="Active & Unlocked"></span>
                 </div>
                 {/* Balances - Show balances directly from prop if available */}
                 <div className="account-balances">
                     <span className="balance-item eth-balance" title={activeAccountDetails.eth_balance ?? 'ETH Balance N/A'}>
                         <span className="token-icon eth">Ξ</span> 
                         {activeAccountDetails.eth_balance ? activeAccountDetails.eth_balance.replace(' ETH','') : '--'} ETH
                     </span>
                     <span className="balance-item usdc-balance" title={activeAccountDetails.usdc_balance ?? 'USDC Balance N/A'}>
                         <span className="token-icon usdc">U</span> 
                         {activeAccountDetails.usdc_balance ? activeAccountDetails.usdc_balance.replace(' USDC','') : '--'} USDC
                     </span>
                 </div>
            </div>
        );
    } else {
        // Not loading, no error, but no active account found (e.g., none selected/unlocked)
        content = <p className="info-message small">No account ready for payments. Select and unlock an account via the 'Account' menu.</p>;
    }

    return (
        <section className="content-section active-account-display">
            {/* <h2 className="section-title">Active Account</h2> // Optional title */}
            {content}
        </section>
    );
}

export default ActiveAccountDisplay; 
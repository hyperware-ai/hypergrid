import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import SearchPage from "./components/HpnSearch.tsx";
import AccountManager from "./components/AccountManager.tsx";
import CallHistory from "./components/CallHistory.tsx";
import ActiveAccountDisplay from "./components/ActiveAccountDisplay.tsx";
// Import the new wizard component
import SetupWizard from "./components/SetupWizard.tsx"; 
// Import the test component
import SetSignersNoteTest from "./components/SetSignersNoteTest.tsx";
// Import the new visualizer component
// import SimpleSetupVisualizer from "./components/SimpleSetupVisualizer.tsx"; 
// Import the new HpnVisualManager component
import HpnVisualManager from "./components/HpnVisualManager.tsx"; 
import BackendDrivenHpnVisualizerWrapper from "./components/BackendDrivenHpnVisualizer.tsx";
// Import GraphStateTester
import GraphStateTester from "./components/GraphStateTester.tsx"; 
// Import required types
import { ActiveAccountDetails, OnboardingStatusResponse } from "./logic/types";
// Corrected viem import
import { type Address as ViemAddress, parseAbi, namehash as viemNamehash } from "viem"; 
// Import wagmi hooks separately
import { useConfig, useContractRead } from 'wagmi'; 
// Import ConnectButton from RainbowKit
import { ConnectButton } from '@rainbow-me/rainbowkit';

// Constants for API, not for contract reads here anymore
// const BASE_CHAIN_ID = 8453; // Not needed directly in App.tsx for this
// const HYPERMAP_ADDRESS = '0x000000000044C6B8Cb4d8f0F889a3E47664EAeda' as ViemAddress; // Not needed
// const hypermapAbiMinimalForGet = parseAbi([ // Not needed
//     'function get(bytes32 node) external view returns (address tba, address owner, bytes memory note)'
// ]);

// Add back API endpoint
const getApiBasePath = () => {
    const pathParts = window.location.pathname.split('/').filter(p => p);
    const processIdPart = pathParts.find(part => part.includes(':'));
    return processIdPart ? `/${processIdPart}/api` : '/api';
};
const API_BASE_URL = getApiBasePath();
const MCP_ENDPOINT = `${API_BASE_URL}/mcp`;
const ONBOARDING_STATUS_ENDPOINT = `${API_BASE_URL}/onboarding-status`;

function App() {
  // Popover state
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
  const accountButtonRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null); 

  // Tab state - Set 'visualsetup' as the default
  const [activeTab, setActiveTab] = useState('graphvisualizer'); 

  // State for ACTIVE account details (fetched by App)
  const [activeAccountDetails, setActiveAccountDetails] = useState<ActiveAccountDetails | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null); // For active details fetch
  const [isFetchingActiveDetails, setIsFetchingActiveDetails] = useState<boolean>(true);

  // State for Onboarding Data
  const [onboardingData, setOnboardingData] = useState<OnboardingStatusResponse | null>(null);
  const [isOnboardingLoading, setIsOnboardingLoading] = useState<boolean>(true);
  const [onboardingError, setOnboardingError] = useState<string | null>(null);

  // Renamed derived variable
  const derivedNodeName = useMemo(() => {
    const windowNodeName = (window as any).our?.node;
    if (windowNodeName) return windowNodeName;
    if (onboardingData?.checks?.operatorEntry && onboardingData.checks.operatorEntry.startsWith("hpn-beta-wallet.")) {
        const namePart = onboardingData.checks.operatorEntry.substring("hpn-beta-wallet.".length);
        if (namePart) return namePart;
    }
    return null;
  }, [onboardingData]);

  // Need to fetch Node TBA Address and Owner for SimpleSetupVisualizer if not already done for SetupWizard
  // Re-adding minimal constants and useContractRead for this purpose in App.tsx
  const wagmiConfig = useConfig(); // For useContractRead
  const BASE_CHAIN_ID = 8453;
  const HYPERMAP_ADDRESS = '0x000000000044C6B8Cb4d8f0F889a3E47664EAeda' as ViemAddress;
  const hypermapAbiForNodeTba = parseAbi([
    'function get(bytes32 node) external view returns (address tba, address owner, bytes memory note)'
  ]);

  const { 
    data: nodeTbaContractData, 
    isLoading: isNodeTbaLoading, 
    error: nodeTbaError 
  } = useContractRead({
    address: HYPERMAP_ADDRESS,
    abi: hypermapAbiForNodeTba,
    functionName: 'get',
    args: derivedNodeName ? [viemNamehash(derivedNodeName)] : undefined,
    chainId: BASE_CHAIN_ID,
    config: wagmiConfig,
    query: {
        enabled: !!derivedNodeName, 
    }
  });

  const [appNodeTbaAddress, setAppNodeTbaAddress] = useState<ViemAddress | null>(null);
  const [appNodeTbaOwner, setAppNodeTbaOwner] = useState<ViemAddress | null>(null);

  useEffect(() => {
    if (nodeTbaContractData && Array.isArray(nodeTbaContractData) && nodeTbaContractData.length >= 2) {
        setAppNodeTbaAddress(nodeTbaContractData[0] as ViemAddress);
        setAppNodeTbaOwner(nodeTbaContractData[1] as ViemAddress);
    } else if (nodeTbaError) {
        console.error("App.tsx: Error fetching node TBA for Visualizer:", nodeTbaError);
        setAppNodeTbaAddress(null);
        setAppNodeTbaOwner(null);
    }
  }, [nodeTbaContractData, nodeTbaError]);

  // Fetch ACTIVE account details
  const fetchActiveDetails = useCallback(async () => {
    setIsFetchingActiveDetails(true); // Indicate loading START
    setFetchError(null);
    try {
        const requestBody = { GetActiveAccountDetails: {} }; // Use new action
        const response = await fetch(MCP_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
        });
        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            // Don't throw, just set error state
            // throw new Error(errData.error || `Failed to fetch active account details: ${response.statusText}`);
            setFetchError(errData.error || `Failed to fetch active account details: ${response.statusText}`);
            setActiveAccountDetails(null);
        } else {
            const data: ActiveAccountDetails | null = await response.json();
            setActiveAccountDetails(data); 
            setFetchError(null); // Clear error on success
        }
    } catch (err) {
        console.error("Error fetching active account details:", err);
        setFetchError(err instanceof Error ? err.message : 'Unknown error');
        setActiveAccountDetails(null); 
    } finally {
        setIsFetchingActiveDetails(false); // Indicate loading END
    }
  }, []);

  // Fetch Onboarding Status
  const fetchOnboardingStatus = useCallback(async () => {
    setIsOnboardingLoading(true);
    setOnboardingError(null);
    try {
        console.log("App.tsx: Fetching from:", ONBOARDING_STATUS_ENDPOINT);
        const response = await fetch(ONBOARDING_STATUS_ENDPOINT);
        if (!response.ok) {
             const errText = await response.text();
             console.error("App.tsx: Onboarding status fetch NOT ok:", errText);
             throw new Error(`Onboarding Status Check Failed: ${response.status} - ${errText}`);
        }
        const data: OnboardingStatusResponse = await response.json();
        console.log("App.tsx: Onboarding status fetch success:", data);
        setOnboardingData(data);
    } catch (err) {
        console.error("App.tsx: Error fetching onboarding status:", err);
        const errorMsg = err instanceof Error ? err.message : 'Unknown error during onboarding status fetch';
        setOnboardingError(errorMsg);
        setOnboardingData(null); 
    } finally {
        setIsOnboardingLoading(false);
    }
}, []);

  // Fetch initial data on mount
  useEffect(() => {
      fetchActiveDetails();
      fetchOnboardingStatus(); // Fetch onboarding status alongside active details
  }, [fetchActiveDetails, fetchOnboardingStatus]);

  // Close popover effect (Keep)
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        modalRef.current &&
        !modalRef.current.contains(event.target as Node) &&
        accountButtonRef.current &&
        !accountButtonRef.current.contains(event.target as Node)
      ) {
        setIsAccountModalOpen(false); 
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [modalRef, accountButtonRef]);

  // Helper to determine status text - REMOVED
  // const getSelectedStatusText = () => { ... }

  return (
    <div className="app-container">
      <header className="app-header">
        <h1 className="app-title">
            Hyperware Provider Network
        </h1>
        {/* Account Trigger Button & Status Section - Simplified */}
        <div className="account-header-section">
            {/* REMOVED: Selected Account Status Display */} 
            
            {/* Connect Wallet Button - Added here */}
            <ConnectButton />

            {/* Account Button and Popover */}
             <div style={{ position: 'relative', display: 'inline-block', marginLeft: '10px' }}> 
              <button 
                ref={accountButtonRef} 
                onClick={() => setIsAccountModalOpen(prev => !prev)}
                className="button header-button primary-button" 
                title="Account Management" 
              >
                Account 
              </button>
               {isAccountModalOpen && ( 
                  <div 
                      ref={modalRef} 
                      className="wallet-popover" 
                  >
                     <div className="popover-body">
                       {/* AccountManager now fetches its own data, no props needed */}
                       <AccountManager /> 
                     </div>
                  </div>
                )}
             </div>
         </div>
      </header>

      {/* NEW: Wrapper for Tabs and Content */}
      <div className="main-wrapper">
        {/* Tab Navigation */} 
        <nav className="tab-navigation">
           <button 
              className={`tab-button ${activeTab === 'graphvisualizer' ? 'active' : ''}`}
              onClick={() => setActiveTab('graphvisualizer')}
           >
              Graph Visualizer
           </button>
           <button 
              className={`tab-button ${activeTab === 'dashboard' ? 'active' : ''}`}
              onClick={() => setActiveTab('dashboard')}
           >
              Dashboard
           </button>
           <button 
              className={`tab-button ${activeTab === 'lookup' ? 'active' : ''}`}
              onClick={() => setActiveTab('lookup')}
           >
              Provider Lookup
           </button>
           {/* Add Visual Setup Tab Button */}
           <button 
              className={`tab-button ${activeTab === 'visualsetup' ? 'active' : ''}`}
              onClick={() => setActiveTab('visualsetup')}
           >
              Visual Setup {/* Label can remain or change, e.g., "Operator Setup (Visual)" */}
           </button>
           {/* Add Graph Visualizer Tab Button */}
           {/* Add Graph State Tester Tab Button */}
           <button
              className={`tab-button ${activeTab === 'graphtester' ? 'active' : ''}`}
              onClick={() => setActiveTab('graphtester')}
           >
              Graph Tester
           </button>
        </nav>

        {/* Main Content Area - Conditional Rendering based on activeTab */}
        <main className="main-content">
          {activeTab === 'dashboard' && (
            <div className="dashboard-content">
                {/* Pass onboardingData to ActiveAccountDisplay */}
               <ActiveAccountDisplay 
                  activeAccountDetails={activeAccountDetails} 
                  isLoading={isFetchingActiveDetails}
                  error={fetchError}
                  onRetry={fetchActiveDetails}
               />
                {/* Pass fetchActiveDetails to CallHistory */}
                   <CallHistory selectedAccountId={activeAccountDetails?.id || null} /> 
             </div>
          )}
          {activeTab === 'lookup' && <SearchPage />}
          {/* Render HpnVisualManager for 'visualsetup' tab */}
          {activeTab === 'visualsetup' && 
            <HpnVisualManager 
                onboardingData={onboardingData} 
                onRefreshStatus={fetchOnboardingStatus}
                nodeTbaAddress={appNodeTbaAddress}
                nodeTbaOwner={appNodeTbaOwner} 
                nodeName={derivedNodeName}
            />
          }
          {/* Render BackendDrivenHpnVisualizerWrapper for 'graphvisualizer' tab */}
          {activeTab === 'graphvisualizer' && (
                <BackendDrivenHpnVisualizerWrapper 
                    // No initialGraphData, will fetch from backend
                />
            )}

            {/* NEW: Render GraphStateTester when 'graphtester' tab is active */}
            {activeTab === 'graphtester' && (
                <GraphStateTester />
            )}
        </main>
      </div>
    </div>
  );
}

export default App;

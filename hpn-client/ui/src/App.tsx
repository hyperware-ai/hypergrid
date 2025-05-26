import  { useState, useEffect, useRef, useCallback, useMemo } from "react";
// SearchPage is no longer directly rendered here by default, but keep import if used elsewhere or if needed later.
// import SearchPage from "./components/HpnSearch.tsx"; 
import BackendDrivenHpnVisualizerWrapper from "./components/BackendDrivenHpnVisualizer.tsx";
import HeaderSearch from "./components/HeaderSearch.tsx";

// Import required types
import { ActiveAccountDetails, OnboardingStatusResponse } from "./logic/types";
// Corrected viem import
import { type Address as ViemAddress, parseAbi, namehash as viemNamehash } from "viem"; 
// Import wagmi hooks separately
import { useConfig, useContractRead } from 'wagmi'; 
// Import ConnectButton from RainbowKit
import { ConnectButton } from '@rainbow-me/rainbowkit';

// Add back API endpoint
//const getApiBasePath = () => {
//    const pathParts = window.location.pathname.split('/').filter(p => p);
//    const processIdPart = pathParts.find(part => part.includes(':'));
//    return processIdPart ? `/${processIdPart}/api` : '/api';
//};
//const API_BASE_URL = getApiBasePath();
//const MCP_ENDPOINT = `${API_BASE_URL}/mcp`;
//const ONBOARDING_STATUS_ENDPOINT = `${API_BASE_URL}/onboarding-status`;

function App() {
  // Popover state
  //const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
  const accountButtonRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null); 

  // Tab state - Set 'visualsetup' as the default - REMOVED
  // const [activeTab, setActiveTab] = useState('graphvisualizer'); 

  // State for ACTIVE account details (fetched by App)
  //const [activeAccountDetails, setActiveAccountDetails] = useState<ActiveAccountDetails | null>(null);
  //const [fetchError, setFetchError] = useState<string | null>(null); // For active details fetch
  //const [isFetchingActiveDetails, setIsFetchingActiveDetails] = useState<boolean>(true);

  // State for Onboarding Data
  const [onboardingData, setOnboardingData] = useState<OnboardingStatusResponse | null>(null);
  //const [isOnboardingLoading, setIsOnboardingLoading] = useState<boolean>(true);
  //const [onboardingError, setOnboardingError] = useState<string | null>(null);

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

  //const [appNodeTbaAddress, setAppNodeTbaAddress] = useState<ViemAddress | null>(null);
  //const [appNodeTbaOwner, setAppNodeTbaOwner] = useState<ViemAddress | null>(null);

  //useEffect(() => {
  //  if (nodeTbaContractData && Array.isArray(nodeTbaContractData) && nodeTbaContractData.length >= 2) {
  //      setAppNodeTbaAddress(nodeTbaContractData[0] as ViemAddress);
  //      setAppNodeTbaOwner(nodeTbaContractData[1] as ViemAddress);
  //  } else if (nodeTbaError) {
  //      console.error("App.tsx: Error fetching node TBA for Visualizer:", nodeTbaError);
  //      setAppNodeTbaAddress(null);
  //      setAppNodeTbaOwner(null);
  //  }
  //}, [nodeTbaContractData, nodeTbaError]);

  // Fetch ACTIVE account details
  //const fetchActiveDetails = useCallback(async () => {
  //  setIsFetchingActiveDetails(true); // Indicate loading START
  //  setFetchError(null);
  //  try {
  //      const requestBody = { GetActiveAccountDetails: {} }; // Use new action
  //      const response = await fetch(MCP_ENDPOINT, {
  //          method: 'POST',
  //          headers: { 'Content-Type': 'application/json' },
  //          body: JSON.stringify(requestBody),
  //      });
  //      if (!response.ok) {
  //          const errData = await response.json().catch(() => ({}));
  //          // Don't throw, just set error state
  //          // throw new Error(errData.error || `Failed to fetch active account details: ${response.statusText}`);
  //          setFetchError(errData.error || `Failed to fetch active account details: ${response.statusText}`);
  //          setActiveAccountDetails(null);
  //      } else {
  //          const data: ActiveAccountDetails | null = await response.json();
  //          setActiveAccountDetails(data); 
  //          setFetchError(null); // Clear error on success
  //      }
  //  } catch (err) {
  //      console.error("Error fetching active account details:", err);
  //      setFetchError(err instanceof Error ? err.message : 'Unknown error');
  //      setActiveAccountDetails(null); 
  //  } finally {
  //      setIsFetchingActiveDetails(false); // Indicate loading END
  //  }
  //}, []);

  // Fetch Onboarding Status
//  const fetchOnboardingStatus = useCallback(async () => {
//    setIsOnboardingLoading(true);
//    setOnboardingError(null);
//    try {
//        console.log("App.tsx: Fetching from:", ONBOARDING_STATUS_ENDPOINT);
//        const response = await fetch(ONBOARDING_STATUS_ENDPOINT);
//        if (!response.ok) {
//             const errText = await response.text();
//             console.error("App.tsx: Onboarding status fetch NOT ok:", errText);
//             throw new Error(`Onboarding Status Check Failed: ${response.status} - ${errText}`);
//        }
//        const data: OnboardingStatusResponse = await response.json();
//        console.log("App.tsx: Onboarding status fetch success:", data);
//        setOnboardingData(data);
//    } catch (err) {
//        console.error("App.tsx: Error fetching onboarding status:", err);
//        const errorMsg = err instanceof Error ? err.message : 'Unknown error during onboarding status fetch';
//        setOnboardingError(errorMsg);
//        setOnboardingData(null); 
//    } finally {
//        setIsOnboardingLoading(false);
//    }
//}, []);

  // Fetch initial data on mount
  //useEffect(() => {
  //    fetchActiveDetails();
  //    fetchOnboardingStatus(); // Fetch onboarding status alongside active details
  //}, [fetchActiveDetails, fetchOnboardingStatus]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        modalRef.current &&
        !modalRef.current.contains(event.target as Node) &&
        accountButtonRef.current &&
        !accountButtonRef.current.contains(event.target as Node)
      ) {
        //setIsAccountModalOpen(false); 
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [modalRef, accountButtonRef]);

  return (
    <div className="app-container">
      <header className="app-header">
        <h1 className="app-title">
            Hypergrid Operator
        </h1>
        <div className="account-header-section" style={{ flexGrow: 1, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <HeaderSearch /> 
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <ConnectButton />
        </div>
      </header>

      <div className="main-wrapper">
        <main className="main-content">
          <BackendDrivenHpnVisualizerWrapper 
            // perhaps show the latest fetched graph state until the new one comes in?
          />
        </main>
      </div>
    </div>
  );
}

export default App;

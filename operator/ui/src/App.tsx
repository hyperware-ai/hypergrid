import { useState, useEffect, useRef, useCallback, useMemo } from "react";

// SearchPage is no longer directly rendered here by default, but keep import if used elsewhere or if needed later.
import OperatorConsole from "./components/console/OperatorConsole";
import HeaderSearch from "./components/HeaderSearch.tsx";
import AppSwitcher from "./components/AppSwitcher.tsx";
import SpiderChat from "./components/SpiderChat.tsx";

// Import required types
import { ActiveAccountDetails, OnboardingStatusResponse } from "./logic/types.ts";
// Corrected viem import
import { type Address as ViemAddress, parseAbi, namehash as viemNamehash } from "viem";
// Import wagmi hooks separately
import { useConfig, useContractRead } from 'wagmi';
// Import ConnectButton from RainbowKit
import { ConnectButton } from '@rainbow-me/rainbowkit';
// Import constants
import { HYPERMAP_ADDRESS } from './constants';
import { ToastContainer } from "react-toastify";
import NotificationBell from './components/NotificationBell';
import { callApiWithRouting } from './utils/api-endpoints';

function App() {
  // Popover state
  const accountButtonRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  // State for Onboarding Data
  const [onboardingData, setOnboardingData] = useState<OnboardingStatusResponse | null>(null);

  const [spiderApiKey, setSpiderApiKey] = useState<string | null>(null);


  // Renamed derived variable
  const derivedNodeName = useMemo(() => {
    const windowNodeName = (window as any).our?.node;
    if (windowNodeName) return windowNodeName;
    if (onboardingData?.checks?.operatorEntry && onboardingData.checks.operatorEntry.startsWith("grid-wallet.")) {
      const namePart = onboardingData.checks.operatorEntry.substring("grid-wallet.".length);
      if (namePart) return namePart;
    }
    return null;
  }, [onboardingData]);

  const wagmiConfig = useConfig(); // For useContractRead
  const BASE_CHAIN_ID = 8453;

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

  // Check spider connection status on mount
  useEffect(() => {
    callApiWithRouting({ SpiderStatus: {} })
      .then(data => {
        // Handle Result<T, E> wrapper
        const status = data.Ok || data;
        if (status.has_api_key) {
          // If already connected, get the key
          callApiWithRouting({ SpiderConnect: null }) // null means don't force new
            .then(data => {
              // Handle Result<T, E> wrapper
              if (data.Ok && data.Ok.api_key) {
                setSpiderApiKey(data.Ok.api_key);
              }
            })
            .catch(console.error);
        }
      })
      .catch(console.error);
  }, []);

  const handleSpiderConnect = async () => {
    try {
      console.log('Calling SpiderConnect...');
      const data = await callApiWithRouting({ SpiderConnect: null }); // null means don't force new
      console.log('SpiderConnect response:', data);
      
      // Handle Result<T, E> wrapper from Rust
      if (data.Ok && data.Ok.api_key) {
        console.log('Setting spider API key:', data.Ok.api_key);
        setSpiderApiKey(data.Ok.api_key);
      } else if (data.Err) {
        throw new Error(data.Err);
      } else {
        console.log('No API key in response');
      }
    } catch (error: any) {
      console.error('Error connecting to Spider:', error);
      // Show user-friendly error message
      alert(error.message || 'Failed to connect to Spider. The Spider service may not be installed.');
    }
  };

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
    <div className="flex h-screen">
      <header className="flex flex-col py-8 px-6 dark:bg-black bg-white shadow-2xl relative flex-shrink-0 gap-8 max-w-sm w-full items-start">
        <img src={`${import.meta.env.BASE_URL}/Logomark.svg`} alt="Hypergrid Logo" className="h-10" />
        <HeaderSearch />
        <AppSwitcher currentApp="operator" />
        <div className="flex-1 w-full overflow-hidden">
          <SpiderChat 
            spiderApiKey={spiderApiKey} 
            onConnectClick={handleSpiderConnect}
            onApiKeyRefreshed={(newKey) => setSpiderApiKey(newKey)}
          />
        </div>
      </header>

      <div className="flex flex-col flex-grow overflow-hidden relative bg-gray-50">
        <div className="flex items-center gap-3 absolute top-4 right-4 z-10">
          <NotificationBell />
          <ConnectButton />
        </div>
        <button
          aria-label="Open Graph"
          title="Open Graph"
          onClick={() => document.dispatchEvent(new CustomEvent('open-graph-view'))}
          className="fixed bottom-4 right-4 z-20 w-9 h-9 flex items-center justify-center rounded-full border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 shadow"
        >
          ⚙︎
        </button>
        <main className="flex-grow flex flex-col overflow-y-auto">
          <OperatorConsole />
        </main>
      </div>
      <ToastContainer
        position="top-right"
        autoClose={3000}
        closeOnClick
        rtl={false}
        pauseOnFocusLoss
        draggable
        pauseOnHover
      />
    </div>
  );
}

export default App;

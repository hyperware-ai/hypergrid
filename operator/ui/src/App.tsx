import  { useState, useEffect, useRef, useCallback, useMemo } from "react";
// SearchPage is no longer directly rendered here by default, but keep import if used elsewhere or if needed later.
import BackendDrivenHypergridVisualizerWrapper from "./components/BackendDrivenHypergridVisualizer.tsx";
import HeaderSearch from "./components/HeaderSearch.tsx";
import AppSwitcher from "./components/AppSwitcher.tsx";

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


function App() {
  // Popover state
  const accountButtonRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null); 

  // State for Onboarding Data
  const [onboardingData, setOnboardingData] = useState<OnboardingStatusResponse | null>(null);

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
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <AppSwitcher currentApp="operator" />
          <h1 className="app-title" style={{ margin: 0 }}>
              Hypergrid Operator
          </h1>
        </div>
        <div className="account-header-section" style={{ flexGrow: 1, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <HeaderSearch /> 
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <ConnectButton />
        </div>
      </header>

      <div className="main-wrapper">
        <main className="main-content">
          <BackendDrivenHypergridVisualizerWrapper 
            // TODO: perhaps show the latest fetched graph state until the new one comes in?
          />
        </main>
      </div>
    </div>
  );
}

export default App;

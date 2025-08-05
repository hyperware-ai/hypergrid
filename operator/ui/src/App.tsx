import { useState, useEffect, useRef, useCallback, useMemo } from "react";
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
import { ToastContainer } from "react-toastify";
import NotificationBell from './components/NotificationBell';

const BASE_URL = import.meta.env.VITE_BASE_URL;


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
      <header className="flex flex-col py-8 px-6  bg-white shadow-2xl relative flex-shrink-0 gap-8 max-w-sm w-full items-start">
        <img src={`${import.meta.env.BASE_URL}/Logomark.svg`} alt="Hypergrid Logo" className="h-10" />
        <HeaderSearch />
        <AppSwitcher currentApp="operator" />
      </header>

      <div className="flex flex-col flex-grow overflow-hidden relative">
        <div className="flex items-center gap-3 absolute top-4 right-4 z-10">
          <NotificationBell />
          <ConnectButton />
        </div>
        <main className="flex-grow flex flex-col overflow-y-auto">
          <BackendDrivenHypergridVisualizerWrapper
          />
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

import { useState, useEffect, useCallback } from "react";
import HyperwareClientApi from "@hyperware-ai/client-api";
import { FaPlus, FaBars, FaX } from "react-icons/fa6";

import '@rainbow-me/rainbowkit/styles.css';
import {
  getDefaultConfig,
  RainbowKitProvider,
} from '@rainbow-me/rainbowkit';
import { WagmiProvider } from 'wagmi';
import {
  base,
} from 'wagmi/chains';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';

import useHypergridProviderStore from "./store/hypergrid_provider";
import {
  RegisteredProvider,
  IndexedProvider
} from "./types/hypergrid_provider";
import {
  fetchRegisteredProvidersApi,
  registerProviderApi,
} from "./utils/api";
import ProviderConfigModal from "./components/ProviderConfigModal";
import RegisteredProviderView from './components/RegisteredProviderView';

import { useAccount, usePublicClient } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { updateProviderApi } from "./utils/api";
import { useProviderRegistration, useProviderUpdate } from "./registration/hypermapUtils";
import { lookupProviderTbaAddressFromBackend } from "./registration/hypermap";
import AppSwitcher from "./components/AppSwitcher";
import ProviderSearch from "./components/ProviderSearch";

// Import logos
import classNames from "classnames";
import { BsArrowClockwise } from "react-icons/bs";
import { FiPlusCircle } from "react-icons/fi";

const BASE_URL = import.meta.env.BASE_URL;
if (window.our) window.our.process = BASE_URL?.replace("/", "");

const PROXY_TARGET = `${(import.meta.env.VITE_NODE_URL || "http://localhost:8080")}${BASE_URL}`;

// This env also has BASE_URL which should match the process + package name
const WEBSOCKET_URL = import.meta.env.DEV
  ? `${PROXY_TARGET.replace('http', 'ws')}/ws`
  : undefined;


// RainbowKit configuration
const config = getDefaultConfig({
  appName: 'Hypergrid Provider',
  projectId: 'YOUR_PROJECT_ID', // Get from https://cloud.walletconnect.com
  chains: [base],
  ssr: false,
});

const queryClient = new QueryClient();

function AppContent() {
  const { registeredProviders, setRegisteredProviders } = useHypergridProviderStore();
  const [nodeConnected, setNodeConnected] = useState(true);
  const [_wsApiInstance, setWsApiInstance] = useState<HyperwareClientApi | undefined>();

  // Blockchain integration
  const { isConnected: isWalletConnected } = useAccount();
  const publicClient = usePublicClient();

  // Blockchain registration
  const providerRegistration = useProviderRegistration({
    onRegistrationComplete: async (providerAddress) => {
      // Blockchain registration succeeded, now register in backend
      if (providerRegistration.pendingProviderData) {
        try {
          // TODO: Update to handle new cURL template + metadata format
          const response = await registerProviderApi(providerRegistration.pendingProviderData);

          if (response.Ok) {
            console.log('Provider registered in backend after hypergrid registration success:', response.Ok);
            loadAndSetProviders();
            resetEditState();
            handleCloseAddNewModal();
          } else {
            console.error('Failed to register in backend after hypergrid registration success:', response.Err);
            alert(`Blockchain registration succeeded but backend registration failed: ${response.Err}`);
          }
        } catch (error) {
          console.error('Error registering in backend after hypergrid registration success:', error);
          alert('Blockchain registration succeeded but backend registration failed.');
        }
      }
    },
    onRegistrationError: (error) => {
      alert(`Blockchain registration failed: ${error}`);
    }
  });

  // Blockchain provider updates
  const providerUpdate = useProviderUpdate({
    onUpdateComplete: (success) => {
      if (success) {
        console.log('Provider notes updated successfully on blockchain');
        // Reload providers to reflect changes
        loadAndSetProviders();
        resetEditState();
        handleCloseAddNewModal();
        alert('Provider updated successfully!');
      }
    },
    onUpdateError: (error) => {
      alert(`Blockchain update failed: ${error}`);
    }
  });

  // Modal state
  const [showForm, setShowForm] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [desktopMenuOpen, setDesktopMenuOpen] = useState(false);

  // Edit mode state
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingProvider, setEditingProvider] = useState<RegisteredProvider | null>(null);
  const [isLoadingProviders, setIsLoadingProviders] = useState(false);

  // Provider view state (keeping for potential future use)
  const [indexedProviders, setIndexedProviders] = useState<IndexedProvider[]>([]);

  // Provider loading state
  const [providersLoading, setProvidersLoading] = useState(false);
  const [providersError, setProvidersError] = useState<string | null>(null);

  // Close menus on escape key and click outside
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (mobileMenuOpen) setMobileMenuOpen(false);
        if (desktopMenuOpen) setDesktopMenuOpen(false);
      }
    };

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Check if click is outside desktop menu
      if (desktopMenuOpen && !target.closest('.desktop-menu-container')) {
        setDesktopMenuOpen(false);
      }
      // Check if click is outside mobile menu
      if (mobileMenuOpen &&
        !target.closest('.mobile-menu-overlay') &&
        !target.closest('.mobile-action-button')) {
        setMobileMenuOpen(false);
      }
    };

    if (mobileMenuOpen || desktopMenuOpen) {
      document.addEventListener('keydown', handleEscape);
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('keydown', handleEscape);
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [mobileMenuOpen, desktopMenuOpen]);

  const resetEditState = () => {
    setIsEditMode(false);
    setEditingProvider(null);
  };


  const handleOpenAddNewModal = () => {
    console.log('Opening new modal - isEditMode:', isEditMode);
    if (isEditMode) {
      resetEditState();
    }
    setShowForm(true);
  };

  const handleCloseAddNewModal = () => {
    setShowForm(false);
    resetEditState();
  };

  const loadAndSetProviders = useCallback(async () => {
    setProvidersLoading(true);
    setProvidersError(null);
    try {
      const providers = await fetchRegisteredProvidersApi();
      setRegisteredProviders(providers);
      console.log("Fetched registered providers:", providers);
    } catch (error) {
      console.error("Failed to load registered providers in App:", error);
      setProvidersError(error instanceof Error ? error.message : 'Failed to load providers');
      setRegisteredProviders([]);
      // alert(`Error fetching providers: ${(error as Error).message}`);
    } finally {
      setTimeout(() => setIsLoadingProviders(false), 1000);
    }
  }, [setRegisteredProviders]);

  const handleProviderUpdated = useCallback((updatedProvider: RegisteredProvider) => {
    // Update the provider in the local state
    const updatedProviders = registeredProviders.map(provider =>
      provider.provider_name === updatedProvider.provider_name
        ? updatedProvider
        : provider
    );
    setRegisteredProviders(updatedProviders);
    console.log("Provider updated locally:", updatedProvider);
  }, [registeredProviders, setRegisteredProviders]);



  // Effect to auto-refresh providers
  useEffect(() => {
    // Initial load
    loadAndSetProviders();

    // Set up periodic refresh (every 60 seconds)
    const interval = setInterval(loadAndSetProviders, 60000);

    return () => clearInterval(interval);
  }, [loadAndSetProviders]);

  

  const handleEditProvider = useCallback((provider: RegisteredProvider) => {
    setEditingProvider(provider);
    setIsEditMode(true);
    setShowForm(true);
  }, []);

  const handleProviderRegistration = useCallback(async (provider: RegisteredProvider) => {
    console.log("Starting registration for provider:", provider);

    if (isWalletConnected) {
      providerRegistration.startRegistration(provider);
    } else {
      alert('Please connect your wallet to complete provider registration on the hypergrid.');
    }
  }, [isWalletConnected, providerRegistration]);

  const handleProviderUpdate = useCallback(async (updatedProvider: RegisteredProvider) => {
    console.log('Provider update completed:', updatedProvider);
    
    // Refresh the providers list to show updated data
    loadAndSetProviders();
    
    // Close the edit modal
    setIsEditMode(false);
    setShowForm(false);
  }, [loadAndSetProviders]);



  useEffect(() => {
    loadAndSetProviders();
    if (window.our?.node && window.our?.process) {
      const wsInstance = new HyperwareClientApi({
        uri: WEBSOCKET_URL,
        nodeId: window.our.node,
        processId: window.our.process,
        onOpen: () => console.log("Connected to Hyperware WebSocket"),
        onMessage: (json) => { console.log('WEBSOCKET MESSAGE RECEIVED', json); },
        onClose: () => console.log("WebSocket connection closed"),
        onError: (error) => console.error("WebSocket error:", error)
      });
      setWsApiInstance(wsInstance);
    } else {
      console.warn("Node or process ID not found, cannot connect WebSocket.");
      setNodeConnected(false);
    }
    return () => { console.log("Closing WebSocket connection (if open).") };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadAndSetProviders]);

  return (
    <div className={`min-h-screen bg-gray flex grow self-stretch w-full h-screen overflow-hidden`}>
      <header className="flex flex-col py-8 px-6  bg-white dark:bg-black shadow-2xl relative flex-shrink-0 gap-8 max-w-sm w-full items-start">
        <img src={`${import.meta.env.BASE_URL}/Logomark.svg`} alt="Hypergrid Logo" className="h-10" />
        <ProviderSearch />
        <AppSwitcher currentApp="provider" />

        {/* Mobile node info */}
        <div className="md:hidden text-sm text-dark-gray dark:text-gray">
          {nodeConnected
            ? <strong className="font-mono text-xs max-w-[150px] truncate inline-block">{window.our?.node || "N/A"}</strong>
            : <strong className="text-red-600">Offline</strong>
          }
        </div>
      </header>
      <main className="pt-20 pb-24 px-8 md:pb-8 flex flex-col grow self-stretch overflow-y-auto">

        <div className="flex items-center gap-3 absolute top-4 right-4 z-10">
          <div className={classNames(" shadow-xl dark:shadow-white/10 flex items-center gap-2 rounded-xl px-4 py-2", {
            'bg-red-500 text-white': !nodeConnected,
            'bg-black text-cyan': nodeConnected
          })}>
            <span className="font-bold ">
              {nodeConnected ? window.our?.node || "N/A" : "Node not connected"}
            </span>
          </div>
          <ConnectButton />
        </div>
        <div className="max-w-md min-h-[30vh] p-8 bg-white rounded-lg flex flex-col gap-2">
          <h2 className="text-2xl font-bold">Hypergrid Provider Registry</h2>

          {registeredProviders.length > 0 ? (
            <div className="flex flex-col gap-2">
              {registeredProviders.map((provider) => (
                <RegisteredProviderView
                  key={provider.provider_id || provider.provider_name}
                  provider={provider}
                  onEdit={handleEditProvider}
                />
              ))}
            </div>
          ) : (
            <p className="">No API providers registered. Click "Add New Provider Configuration" to start.</p>
          )}

          <button
            onClick={loadAndSetProviders}
            className="px-6 py-3 bg-mid-gray/25 !rounded-full ml-auto mt-auto font-bold"
          >
            <span>Refresh list</span>
            <BsArrowClockwise className={classNames("text-2xl", {
              'animate-spin': isLoadingProviders
            })}
            />
          </button>
        </div>

        <div className="flex items-center gap-2 absolute bottom-4 right-4">

          <button
            onClick={handleOpenAddNewModal}
            className="px-6 py-3 !rounded-full bg-mid-gray font-bold animate-pulse"
          >
            <span>Add new provider</span>
            <FiPlusCircle className="text-2xl" />
          </button>
        </div>


        {/* Mobile bottom action bar */}
        <div className="fixed bottom-0 left-0 right-0 bg-white dark:bg-black border-t border-gray-200 px-4 py-3 md:hidden z-40">
          <div className="flex gap-3">
            <button
              onClick={handleOpenAddNewModal}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-cyan text-black rounded-lg hover:bg-blue-700 transition-colors"
            >
              <FaPlus />
              <span>Add Provider</span>
            </button>
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className=" px-4 py-3 bg-white dark:bg-black rounded-lg"
              aria-label="Toggle menu"
            >
              <FaBars />
              <span>Menu</span>
            </button>
          </div>
        </div>

        {/* Mobile menu dropdown - now appears from bottom */}
        {mobileMenuOpen && (
          <div className="fixed inset-0 bg-black/50 dark:bg-white/50 z-50 md:hidden" onClick={() => setMobileMenuOpen(false)}>
            <div className="absolute bottom-0 left-0 right-0 bg-white dark:bg-black rounded-t-lg max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between p-4 border-b border-gray-200">
                <h3 className="text-lg font-semibold">Settings</h3>
                <button
                  className="p-2 text-gray-400 hover:text-gray-600"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <FaX />
                </button>
              </div>
              <div className="p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700">App</span>
                  <AppSwitcher currentApp="provider" />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700">Wallet</span>
                  <ConnectButton />
                </div>
                <div className="border-t border-gray-200 pt-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-700">Node Status</span>
                    <div className="text-sm text-gray-600">
                      {nodeConnected
                        ? (
                          <div className="flex items-center gap-2">
                            <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                            Connected: <strong className="font-mono text-xs">{window.our?.node || "N/A"}</strong>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <span className="w-2 h-2 bg-red-500 rounded-full"></span>
                            <strong>Node not connected</strong>
                          </div>
                        )
                      }
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700">App Version</span>
                  <span className="text-sm text-gray-600">1.0.0</span>
                </div>
              </div>
            </div>
          </div>
        )}

        <ProviderConfigModal
          isOpen={showForm}
          onClose={handleCloseAddNewModal}
          isEditMode={isEditMode}
          editingProvider={editingProvider}
          isWalletConnected={isWalletConnected}
          onProviderRegistration={handleProviderRegistration}
          onProviderUpdate={handleProviderUpdate}
          providerRegistration={providerRegistration}
          providerUpdate={providerUpdate}
        />
      </main>
    </div>
  );
}

function App() {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>
          <AppContent />
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

export default App;


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
  HttpMethod,
  RegisterProviderResponse,
  RegisteredProvider
} from "./types/hypergrid_provider";
import { fetchRegisteredProvidersApi, registerProviderApi } from "./utils/api";
import ProviderConfigModal from "./components/ProviderConfigModal";
import RegisteredProviderView from './components/RegisteredProviderView';
import {
  processRegistrationResponse,
  populateFormFromProvider,
  ProviderFormData,
  processUpdateResponse,
  createSmartUpdatePlan
} from "./utils/providerFormUtils";
import { useAccount, usePublicClient } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { updateProviderApi } from "./utils/api";
import { useProviderRegistration, useProviderUpdate } from "./registration/hypermapUtils";
import { lookupProviderTbaAddressFromBackend } from "./registration/hypermap";
import AppSwitcher from "./components/AppSwitcher";

// Import logos
import logoGlow from './assets/logo_glow.png';
import logoIris from './assets/logo_iris.png';
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
          const response = await registerProviderApi(providerRegistration.pendingProviderData);
          const feedback = processRegistrationResponse(response);

          if (response.Ok) {
            console.log('Provider registered in backend after hypergrid registration success:', response.Ok);
            loadAndSetProviders();
            resetEditState();
            handleCloseAddNewModal();
          } else {
            console.error('Failed to register in backend after hypergrid registration success:', feedback.message);
            alert(`Blockchain registration succeeded but backend registration failed: ${feedback.message}`);
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

  // Theme state
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const storedTheme = localStorage.getItem('theme');
    return (storedTheme as 'light' | 'dark') || 'light'; // Default to light theme
  });

  // Effect to update localStorage and body class when theme changes
  useEffect(() => {
    localStorage.setItem('theme', theme);
    document.documentElement.setAttribute('data-theme', theme); // Or apply to app-container
  }, [theme]);

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

  const toggleTheme = () => {
    setTheme(prevTheme => (prevTheme === 'light' ? 'dark' : 'light'));
  };

  const resetEditState = () => {
    setIsEditMode(false);
    setEditingProvider(null);
  };


  const handleOpenAddNewModal = () => {
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
    setIsLoadingProviders(true);
    try {
      const providers = await fetchRegisteredProvidersApi();
      setRegisteredProviders(providers);
      console.log("Fetched registered providers:", providers);
    } catch (error) {
      console.error("Failed to load registered providers in App:", error);
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

  const handleCopyProviderMetadata = useCallback(async (provider: RegisteredProvider) => {
    const hnsName = (provider.provider_name.trim() || "[ProviderName]") + ".grid-beta.hypr";
    const metadata = {
      "~description": provider.description,
      "~instructions": provider.instructions,
      "~price": provider.price.toString(),
      "~wallet": provider.registered_provider_wallet,
      "~provider-id": provider.provider_id,
      "~site": provider.endpoint.base_url_template,
    };
    const structuredDataToCopy = {
      [hnsName]: metadata,
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(structuredDataToCopy, null, 2));
      alert(`Metadata for '${provider.provider_name}' copied!`);
    } catch (err) {
      console.error('Failed to copy metadata: ', err);
      alert('Failed to copy metadata.');
    }
  }, []);

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

  const handleProviderUpdate = useCallback(async (provider: RegisteredProvider, formData: ProviderFormData) => {
    // This will handle the smart update system
    try {
      const updatePlan = createSmartUpdatePlan(provider, formData);

      // Warn about instructions if config changed but instructions weren't updated
      if (updatePlan.shouldWarnAboutInstructions) {
        const confirmUpdate = confirm(
          'You\'ve made changes to the API configuration but haven\'t updated the instructions. ' +
          'This might create a mismatch between your actual API and the instructions users see. ' +
          'Do you want to continue with the update anyway?'
        );
        if (!confirmUpdate) {
          return;
        }
      }

      // Check if wallet is needed for on-chain updates
      if (updatePlan.needsOnChainUpdate && !isWalletConnected) {
        alert('Please connect your wallet to update Hypergrid metadata on the blockchain.');
        return;
      }

      console.log('Update plan:', updatePlan);

      // Step 1: Update off-chain data (backend) if needed
      if (updatePlan.needsOffChainUpdate) {
        console.log('Updating off-chain data...');
        const response = await updateProviderApi(provider.provider_name, updatePlan.updatedProvider);
        const feedback = processUpdateResponse(response);

        if (!response.Ok) {
          alert(feedback.message);
          return;
        }

        // Update local state
        handleProviderUpdated(response.Ok);
      }

      // Step 2: Update on-chain data (blockchain notes) if needed
      if (updatePlan.needsOnChainUpdate) {
        console.log('Updating on-chain notes...', updatePlan.onChainNotes);

        try {
          // Look up the actual TBA address for this provider from backend
          const tbaAddress = await lookupProviderTbaAddressFromBackend(provider.provider_name, publicClient);

          if (!tbaAddress) {
            alert(`No blockchain entry found for provider "${provider.provider_name}". Please register on the hypergrid first.`);
            return;
          }

          console.log(`Found TBA address: ${tbaAddress} for provider: ${provider.provider_name}`);

          // Execute the blockchain update
          await providerUpdate.updateProviderNotes(tbaAddress, updatePlan.onChainNotes);

          // Success will be handled by the providerUpdate.onUpdateComplete callback
        } catch (error) {
          console.error('Error during blockchain update:', error);
          alert(`Failed to update blockchain metadata: ${(error as Error).message}`);
        }
      } else {
        // Only off-chain updates needed
        resetEditState();
        handleCloseAddNewModal();
        alert(`Provider "${updatePlan.updatedProvider.provider_name}" updated successfully!`);
      }
    } catch (err) {
      console.error('Failed to update provider: ', err);
      alert('Failed to update provider.');
    }
  }, [isWalletConnected, handleProviderUpdated, publicClient, providerUpdate, resetEditState, handleCloseAddNewModal]);



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
      <header className="flex flex-col py-8 px-6  bg-white shadow-2xl relative flex-shrink-0 gap-8 max-w-sm w-full items-start">
        <img src={`${import.meta.env.BASE_URL}/Logomark.svg`} alt="Hypergrid Logo" className="h-10" />
        <AppSwitcher currentApp="provider" />

        {/* Mobile node info */}
        <div className="md:hidden text-sm text-gray-600">
          {nodeConnected
            ? <strong className="font-mono text-xs max-w-[150px] truncate inline-block">{window.our?.node || "N/A"}</strong>
            : <strong className="text-red-600">Offline</strong>
          }
        </div>
      </header>
      <main className="pt-20 pb-24 px-8 md:pb-8 flex flex-col grow self-stretch overflow-y-auto">

        <div className="flex items-center gap-3 absolute top-4 right-4 z-10">
          <div className={classNames(" shadow-xl  flex items-center gap-2 rounded-xl px-4 py-2", {
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
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-3 md:hidden z-40">
          <div className="flex gap-3">
            <button
              onClick={handleOpenAddNewModal}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <FaPlus />
              <span>Add Provider</span>
            </button>
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="flex items-center justify-center gap-2 px-4 py-3 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
              aria-label="Toggle menu"
            >
              <FaBars />
              <span>Menu</span>
            </button>
          </div>
        </div>

        {/* Mobile menu dropdown - now appears from bottom */}
        {mobileMenuOpen && (
          <div className="fixed inset-0 bg-black/50 z-50 md:hidden" onClick={() => setMobileMenuOpen(false)}>
            <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-lg max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
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


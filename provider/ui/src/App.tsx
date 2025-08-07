import { useState, useEffect, useCallback } from "react";
import HyperwareClientApi from "@hyperware-ai/client-api";
import { FaPlus, FaBars } from "react-icons/fa6";

// RainbowKit and wagmi imports
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
import CurlVisualizer from "./components/curlVisualizer";
import ValidationPanel from "./components/ValidationPanel";
import SelectionModal from "./components/SelectionModal";
import APIConfigForm from "./components/APIConfigForm";
import HypergridEntryForm from "./components/HypergridEntryForm";
import RegisteredProviderView from './components/RegisteredProviderView';
import {
  validateProviderConfig,
  buildProviderPayload,
  ProviderFormData,
  processRegistrationResponse,
  populateFormFromProvider,
  buildUpdateProviderPayload,
  processUpdateResponse,
  createSmartUpdatePlan
} from "./utils/providerFormUtils";
import { useAccount, usePublicClient } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { updateProviderApi } from "./utils/api";
import { useProviderRegistration, useProviderUpdate } from "./registration/hypermapUtils";
import { lookupProviderTbaAddressFromBackend } from "./registration/hypermap";
import ProviderRegistrationOverlay from "./components/ProviderRegistrationOverlay";
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

// Define top-level request types
export type TopLevelRequestType = "getWithPath" | "getWithQuery" | "postWithJson";
export type AuthChoice = "none" | "query" | "header";

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
        resetFormFields();
        handleCloseAddNewModal();
        alert('Provider updated successfully!');
      }
    },
    onUpdateError: (error) => {
      alert(`Blockchain update failed: ${error}`);
    }
  });

  // New Form State
  const [showForm, setShowForm] = useState(false);
  const [apiCallFormatSelected, setApiCallFormatSelected] = useState(false);

  // Validation state
  const [showValidation, setShowValidation] = useState(false);
  const [providerToValidate, setProviderToValidate] = useState<RegisteredProvider | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [desktopMenuOpen, setDesktopMenuOpen] = useState(false);

  // Edit mode state
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingProvider, setEditingProvider] = useState<RegisteredProvider | null>(null);

  // Step 1: Auth & Request Structure
  const [topLevelRequestType, setTopLevelRequestType] = useState<TopLevelRequestType>("getWithPath");
  const [authChoice, setAuthChoice] = useState<AuthChoice>("query");
  const [apiKeyQueryParamName, setApiKeyQueryParamName] = useState("");
  const [apiKeyHeaderName, setApiKeyHeaderName] = useState("");
  const [endpointApiParamKey, setEndpointApiKey] = useState(""); // Actual API key value (Moved to Step 1 conceptually)

  // Step 2: Details (some of these were previously Step 3 or derived)
  const [providerName, setProviderName] = useState("");
  const [providerDescription, setProviderDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [registeredProviderWallet, setRegisteredProviderWallet] = useState("");
  const [endpointBaseUrl, setEndpointBaseUrl] = useState("");

  // Parameter Keys - now arrays
  const [pathParamKeys, setPathParamKeys] = useState<string[]>([]);
  const [queryParamKeys, setQueryParamKeys] = useState<string[]>([]);
  const [headerKeys, setHeaderKeys] = useState<string[]>([]);
  const [bodyKeys, setBodyKeys] = useState<string[]>([]); // For POST JSON body keys
  const [price, setPrice] = useState<string>(""); // New state for Price

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

  const resetFormFields = () => {
    setTopLevelRequestType("getWithPath");
    setAuthChoice("query");
    setApiKeyQueryParamName("");
    setApiKeyHeaderName("");
    setEndpointApiKey("");
    setApiCallFormatSelected(false);

    setProviderName("");
    setProviderDescription("");
    setInstructions("");
    setEndpointBaseUrl("");
    setPathParamKeys([]);
    setQueryParamKeys([]);
    setHeaderKeys([]);
    setBodyKeys([]);
    setRegisteredProviderWallet("");
    setPrice("");

    // Reset validation state
    setShowValidation(false);
    setProviderToValidate(null);

    // Reset edit mode state
    setIsEditMode(false);
    setEditingProvider(null);
  };

  const populateFormWithProvider = (provider: RegisteredProvider) => {
    const formData = populateFormFromProvider(provider);

    setTopLevelRequestType(formData.topLevelRequestType || "getWithPath");
    setAuthChoice(formData.authChoice || "query");
    setApiKeyQueryParamName(formData.apiKeyQueryParamName || "");
    setApiKeyHeaderName(formData.apiKeyHeaderName || "");
    setEndpointApiKey(formData.endpointApiParamKey || "");
    setApiCallFormatSelected(true);

    setProviderName(formData.providerName || "");
    setProviderDescription(formData.providerDescription || "");
    setInstructions(formData.instructions || "");
    setEndpointBaseUrl(formData.endpointBaseUrl || "");
    setPathParamKeys(formData.pathParamKeys || []);
    setQueryParamKeys(formData.queryParamKeys || []);
    setHeaderKeys(formData.headerKeys || []);
    setBodyKeys(formData.bodyKeys || []);
    setRegisteredProviderWallet(formData.registeredProviderWallet || "");
    setPrice(formData.price || "");
  };

  const handleOpenAddNewModal = () => {
    // Don't reset form fields here - preserve state for better UX
    // Only reset when starting fresh (not when re-opening)
    // If we're transitioning from edit mode to add mode, reset the form
    if (isEditMode) {
      resetFormFields();
    }
    setShowForm(true);
  };

  const handleCloseAddNewModal = () => {
    setShowForm(false);
    setShowValidation(false);
    setProviderToValidate(null);
  };

  const loadAndSetProviders = useCallback(async () => {
    try {
      const providers = await fetchRegisteredProvidersApi();
      setRegisteredProviders(providers);
      console.log("Fetched registered providers:", providers);
    } catch (error) {
      console.error("Failed to load registered providers in App:", error);
      setRegisteredProviders([]);
      // alert(`Error fetching providers: ${(error as Error).message}`);
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
    populateFormWithProvider(provider);
    setShowForm(true);
  }, []);

  const handleProviderRegistration = useCallback(async () => {
    // Consolidate form data into an object matching ProviderFormData
    const formData: ProviderFormData = {
      providerName,
      providerDescription,
      providerId: isEditMode ? editingProvider?.provider_id || "" : (window.our?.node || ""), // Use node ID for new providers
      instructions, // Add instructions field
      registeredProviderWallet,
      price,
      topLevelRequestType,
      endpointBaseUrl,
      pathParamKeys,
      queryParamKeys,
      headerKeys,
      bodyKeys,
      endpointApiParamKey,
      authChoice,
      apiKeyQueryParamName,
      apiKeyHeaderName,
    };

    // Validate using the utility function
    const validationResult = validateProviderConfig(formData);
    if (!validationResult.isValid) {
      alert(validationResult.error); // Display error from validation util
      return;
    }

    // Check if wallet is connected for new registrations
    if (!isEditMode && !isWalletConnected) {
      alert('Please connect your wallet to register on the hypergrid');
      return;
    }

    if (isEditMode && editingProvider) {
      // Smart update system - handles both on-chain and off-chain updates automatically
      try {
        const updatePlan = createSmartUpdatePlan(editingProvider, formData);

        // Warn about instructions if config changed but instructions weren't updated
        if (updatePlan.shouldWarnAboutInstructions) {
          const confirmUpdate = confirm(
            'You\'ve made changes to the API configuration but haven\'t updated the instructions. ' +
            'This might create a mismatch between your actual API and the instructions users see. ' +
            'Do you want to continue with the update anyway?'
          );
          if (!confirmUpdate) {
            return; // User cancelled the update
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
          const response = await updateProviderApi(editingProvider.provider_name, updatePlan.updatedProvider);
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
            const tbaAddress = await lookupProviderTbaAddressFromBackend(editingProvider.provider_name, publicClient);

            if (!tbaAddress) {
              alert(`No blockchain entry found for provider "${editingProvider.provider_name}". Please register on the hypergrid first.`);
              return;
            }

            console.log(`Found TBA address: ${tbaAddress} for provider: ${editingProvider.provider_name}`);

            // Execute the blockchain update
            await providerUpdate.updateProviderNotes(tbaAddress, updatePlan.onChainNotes);

            // Success will be handled by the providerUpdate.onUpdateComplete callback
          } catch (error) {
            console.error('Error during blockchain update:', error);
            alert(`Failed to update blockchain metadata: ${(error as Error).message}`);
          }
        } else {
          // Only off-chain updates needed
          resetFormFields();
          handleCloseAddNewModal();
          alert(`Provider "${updatePlan.updatedProvider.provider_name}" updated successfully!`);
        }
      } catch (err) {
        console.error('Failed to update provider: ', err);
        alert('Failed to update provider.');
      }
    } else {
      // Handle registration for new provider
      const payload = buildProviderPayload(formData);
      const providerToValidate = payload.RegisterProvider;

      // Move to validation step instead of directly registering
      setProviderToValidate(providerToValidate);
      setShowValidation(true);
    }
  }, [
    providerName, providerDescription, instructions, topLevelRequestType,
    endpointBaseUrl, pathParamKeys, queryParamKeys, headerKeys, bodyKeys,
    endpointApiParamKey, authChoice, apiKeyQueryParamName, apiKeyHeaderName,
    registeredProviderWallet, price, isEditMode, editingProvider, handleProviderUpdated,
    isWalletConnected
  ]);

  const handleValidationSuccess = useCallback(async (providerToRegister: RegisteredProvider) => {
    console.log("Starting registration for provider:", providerToRegister);

    // Start hypergrid registration if wallet is connected
    if (isWalletConnected) {
      providerRegistration.startRegistration(providerToRegister);
    } else {
      // No wallet connected - show message and don't proceed
      alert('Please connect your wallet to complete provider registration on the hypergrid.');
      // Reset back to config form so user can connect wallet and try again
      setShowValidation(false);
      setProviderToValidate(null);
    }
  }, [isWalletConnected, providerRegistration]);

  const handleValidationError = useCallback((error: string) => {
    console.error("Validation failed:", error);
    alert(`Validation failed: ${error}`);
  }, []);

  const handleValidationCancel = useCallback(() => {
    setShowValidation(false);
    setProviderToValidate(null);
  }, []);



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
          <div className={classNames("flex items-center gap-2 rounded-xl px-4 py-2", {
            'bg-red-500 text-white': !nodeConnected,
            'bg-dark-gray/25': nodeConnected
          })}>
            <span className="font-bold">
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
            <BsArrowClockwise className="text-2xl" />
          </button>
        </div>

        <div className="flex items-center gap-2 absolute bottom-4 right-4">

          <button
            onClick={handleOpenAddNewModal}
            className="px-6 py-3 !rounded-full bg-mid-gray font-bold"
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
                  ✕
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

        <SelectionModal
          isOpen={showForm}
          onClose={handleCloseAddNewModal}
          title={showValidation ? "Validate Provider Configuration" : (isEditMode ? "Edit API Provider" : "Configure New API Provider")}
          maxWidth={showValidation ? "min(500px, 95vw)" : "min(1200px, 95vw)"}
        >
          <div className="relative">
            {showValidation && providerToValidate ? (
              <ValidationPanel
                provider={providerToValidate}
                onValidationSuccess={handleValidationSuccess}
                onValidationError={handleValidationError}
                onCancel={handleValidationCancel}
              />
            ) : (
              <>
                <div className="grid grid-cols-1  gap-6">
                  <div className="space-y-6">
                    <HypergridEntryForm
                      nodeId={window.our?.node || "N/A"}
                      providerName={providerName}
                      setProviderName={setProviderName}
                      providerDescription={providerDescription}
                      setProviderDescription={setProviderDescription}
                      instructions={instructions}
                      setInstructions={setInstructions}
                      registeredProviderWallet={registeredProviderWallet}
                      setRegisteredProviderWallet={setRegisteredProviderWallet}
                      price={price}
                      setPrice={setPrice}
                    />
                    <CurlVisualizer
                      providerName={providerName}
                      endpointMethod={topLevelRequestType === "postWithJson" ? HttpMethod.POST : HttpMethod.GET}
                      endpointBaseUrl={endpointBaseUrl}
                      pathParamKeys={pathParamKeys}
                      queryParamKeys={queryParamKeys}
                      headerKeys={headerKeys}
                      bodyKeys={topLevelRequestType === "postWithJson" ? bodyKeys : []}
                      apiKey={endpointApiParamKey}
                      apiKeyQueryParamName={authChoice === 'query' ? apiKeyQueryParamName : undefined}
                      apiKeyHeaderName={authChoice === 'header' ? apiKeyHeaderName : undefined}
                    />
                  </div>

                  <div className="flex flex-col">
                    <APIConfigForm
                      topLevelRequestType={topLevelRequestType}
                      setTopLevelRequestType={setTopLevelRequestType}
                      authChoice={authChoice}
                      setAuthChoice={setAuthChoice}
                      apiKeyQueryParamName={apiKeyQueryParamName}
                      setApiKeyQueryParamName={setApiKeyQueryParamName}
                      apiKeyHeaderName={apiKeyHeaderName}
                      setApiKeyHeaderName={setApiKeyHeaderName}
                      endpointApiParamKey={endpointApiParamKey}
                      setEndpointApiKey={setEndpointApiKey}
                      endpointBaseUrl={endpointBaseUrl}
                      setEndpointBaseUrl={setEndpointBaseUrl}
                      pathParamKeys={pathParamKeys}
                      setPathParamKeys={setPathParamKeys}
                      queryParamKeys={queryParamKeys}
                      setQueryParamKeys={setQueryParamKeys}
                      headerKeys={headerKeys}
                      setHeaderKeys={setHeaderKeys}
                      bodyKeys={bodyKeys}
                      setBodyKeys={setBodyKeys}
                      apiCallFormatSelected={apiCallFormatSelected}
                      setApiCallFormatSelected={setApiCallFormatSelected}
                      onRegisterProvider={handleProviderRegistration}
                      submitButtonText={isEditMode ? "Update Provider" : "Register Provider Configuration"}
                      isWalletConnected={isWalletConnected}
                    />
                  </div>
                </div>
              </>
            )}

            {/* Hypergrid Registration Progress Overlay - Outside conditional so it persists */}
            <ProviderRegistrationOverlay
              isVisible={providerRegistration.isRegistering}
              step={providerRegistration.step}
              currentNoteIndex={providerRegistration.currentNoteIndex}
              mintedProviderAddress={providerRegistration.mintedProviderAddress}
              isMinting={providerRegistration.isMinting}
              isSettingNotes={providerRegistration.isSettingNotes}
              isMintTxLoading={providerRegistration.isMintTxLoading}
              isNotesTxLoading={providerRegistration.isNotesTxLoading}
              mintError={providerRegistration.mintError}
              notesError={providerRegistration.notesError}
              onClose={() => {
                // Close validation panel when registration overlay closes
                setShowValidation(false);
                setProviderToValidate(null);
                resetFormFields();
                handleCloseAddNewModal();
              }}
            />

            {/* Simple Provider Update Progress Overlay */}
            {providerUpdate.isUpdating && (
              <div className="fixed inset-0 bg-black/90 flex flex-col justify-center items-center z-50 p-5">
                <div className="bg-gray/95 p-10 rounded-xl shadow-2xl max-w-md w-full text-center">
                  <h3 className="text-white mb-8 text-2xl font-medium">
                    Updating Provider
                  </h3>
                  <div className="text-gray-400 mb-5 text-sm">
                    Updating provider metadata on blockchain...
                  </div>
                  <div className="mb-5">
                    <div className="w-10 h-10 mx-auto border-4 border-gray-600 border-t-green-400 rounded-full animate-spin" />
                  </div>
                </div>
              </div>
            )}
          </div>
        </SelectionModal>
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


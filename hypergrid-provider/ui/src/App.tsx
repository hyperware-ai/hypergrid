import { useState, useEffect, useCallback } from "react";
import HyperwareClientApi from "@hyperware-ai/client-api";
import "./App.css";
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
import ProviderConfigForm from "./components/ProviderConfigForm";
import HypergridEntryForm from "./components/HypergridEntryForm";
import RegisteredProviderView from './components/RegisteredProviderView';
import { 
  validateProviderConfig, 
  buildProviderPayload, 
  ProviderFormData,
  processRegistrationResponse,
  populateFormFromProvider,
  buildUpdateProviderPayload,
  processUpdateResponse
} from "./utils/providerFormUtils";
import { updateProviderApi } from "./utils/api";

// Import logos
import logoGlow from './assets/logo_glow.png';
import logoIris from './assets/logo_iris.png';

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

function App() {
  const { registeredProviders, setRegisteredProviders } = useHypergridProviderStore();
  const [nodeConnected, setNodeConnected] = useState(true);
  const [_wsApiInstance, setWsApiInstance] = useState<HyperwareClientApi | undefined>();

  // New Form State
  const [showForm, setShowForm] = useState(false);
  const [apiCallFormatSelected, setApiCallFormatSelected] = useState(false);

  // Validation state
  const [showValidation, setShowValidation] = useState(false);
  const [providerToValidate, setProviderToValidate] = useState<RegisteredProvider | null>(null);
  
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
  
  const handleCopyFormData = useCallback(async () => {
    // Validation check
    if (!providerName.trim() || 
        !registeredProviderWallet.trim() || 
        !price.trim() || 
        !providerDescription.trim()) {
      alert("Please fill all required metadata fields (Provider Name, Wallet, Price, Description) before copying.");
      return;
    }

    const hnsName = (providerName.trim() || "[YourProviderName]") + ".grid-beta.hypr";

    const metadataFields = {
      "~provider-id": window.our?.node || "N/A",
      "~wallet": registeredProviderWallet,
      "~price": price,
      "~description": providerDescription,
      "~instructions": instructions,
    };

    const structuredDataToCopy = {
      [hnsName]: metadataFields,
    };

    try {
      await navigator.clipboard.writeText(JSON.stringify(structuredDataToCopy, null, 2));
      alert('Provider metadata (HNS structure) copied to clipboard!');
    } catch (err) {
      console.error('Failed to copy structured metadata: ', err);
      alert('Failed to copy structured metadata. See console for details.');
    }
  }, [
    providerName, providerDescription, registeredProviderWallet, price, instructions, endpointBaseUrl
  ]);

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
      providerId: isEditMode ? editingProvider?.provider_id || "" : "", // Use existing ID when editing
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

    if (isEditMode && editingProvider) {
      // Handle update for existing provider
      try {
        const updatedProvider = buildUpdateProviderPayload(formData);
        const response = await updateProviderApi(editingProvider.provider_name, updatedProvider);
        const feedback = processUpdateResponse(response);
        
        if (response.Ok) {
          handleProviderUpdated(response.Ok);
          resetFormFields();
          handleCloseAddNewModal();
          alert(`Provider "${response.Ok.provider_name}" successfully updated!`);
        } else {
          alert(feedback.message);
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
    registeredProviderWallet, price, isEditMode, editingProvider, handleProviderUpdated
  ]);

  const handleValidationSuccess = useCallback((registeredProvider: RegisteredProvider) => {
    console.log("Provider validated and registered successfully:", registeredProvider);
    
    resetFormFields();
    handleCloseAddNewModal();
    loadAndSetProviders();
    
    alert(`Provider "${registeredProvider.provider_name}" successfully validated and registered!`);
  }, [loadAndSetProviders]);

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
    return () => { console.log("Closing WebSocket connection (if open).")};
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadAndSetProviders]);

  return (
    <div className={`app-container ${theme}`}>
      <header className="app-header" style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 1000 }}>
        <div>
          <img 
            src={theme === 'dark' ? logoGlow : logoIris} 
            alt="App Logo" 
            className="app-logo" 
          />
        </div>
        <div className="header-controls">
            <div className="node-info">
              {nodeConnected 
                ? <>Node ID: <strong>{window.our?.node || "N/A"}</strong></>
                : <div className="node-not-connected-banner"><p><strong>Node not connected.</strong></p></div>
              }
            </div>
            <button onClick={toggleTheme} className="theme-toggle-button">
                Theme: {theme === 'light' ? 'Dark' : 'Light'}
            </button>
        </div>
      </header>
      <main className="main-content">
        <section className="card providers-display-section">
            <div className="providers-header">
              <h2>Hypergrid Provider Registry</h2>
              <button onClick={handleOpenAddNewModal} className="toggle-form-button">
                Add New Provider Configuration
              </button>
            </div>
            {registeredProviders.length > 0 ? (
              <ul className="provider-list">
                {registeredProviders.map((provider) => (
                  <li key={provider.provider_id || provider.provider_name} className="provider-item" style={{ listStyleType: 'none', marginBottom: '0'}}>
                    <RegisteredProviderView provider={provider} onEdit={handleEditProvider} />
                  </li>
                ))}
              </ul>
            ) : (
              <p>No API providers registered. Click "Add New Provider Configuration" to start.</p>
            )}
            <button onClick={loadAndSetProviders} style={{ marginTop: '1em' }}>Refresh List</button>
          </section>

        <SelectionModal 
          isOpen={showForm} 
          onClose={handleCloseAddNewModal} 
          title={showValidation ? "Validate Provider Configuration" : (isEditMode ? "Edit API Provider" : "Configure New API Provider")}
          maxWidth={showValidation ? "500px" : "1200px"}
        >
          {showValidation && providerToValidate ? (
            <ValidationPanel
              provider={providerToValidate}
              onValidationSuccess={handleValidationSuccess}
              onValidationError={handleValidationError}
              onCancel={handleValidationCancel}
            />
          ) : (
            <>
              {/* Add Clear Form button when not in validation mode */}
              {!showValidation && (
                <div style={{ 
                  display: 'flex', 
                  justifyContent: 'flex-end', 
                  marginBottom: '16px',
                  paddingRight: '20px'
                }}>
                  <button 
                    onClick={resetFormFields}
                    style={{
                      padding: '8px 16px',
                      backgroundColor: '#f44336',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '14px',
                      fontWeight: '500',
                      transition: 'background-color 0.2s',
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#d32f2f'}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#f44336'}
                  >
                    🗑️ Clear Form
                  </button>
                </div>
              )}
              <div className="modal-content-columns" style={{ display: 'flex', flexDirection: 'row', gap: '20px' }}>
                <div className="modal-left-column" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '20px' }}>
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
                    onCopyMetadata={handleCopyFormData}
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

                <div className="modal-right-column" style={{ flex: 1, overflowY: 'auto' }}>
                  <ProviderConfigForm
                    providerName={providerName}
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
                  />
                </div>
              </div>
            </>
          )}
        </SelectionModal>
      </main>
    </div>
  );
}

export default App;


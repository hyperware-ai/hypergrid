import { useState, useEffect } from "react";
import Modal from './Modal';
import ValidationPanel from "./ValidationPanel";
import APIConfigForm from "./APIConfigForm";
import HypergridEntryForm from "./HypergridEntryForm";
import CurlVisualizer from "./curlVisualizer";
import ProviderRegistrationOverlay from "./ProviderRegistrationOverlay";
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { RegisteredProvider, HttpMethod, TopLevelRequestType, AuthChoice } from "../types/hypergrid_provider";
import {
  validateProviderConfig,
  buildProviderPayload,
  ProviderFormData,
  processRegistrationResponse,
  populateFormFromProvider,
  buildUpdateProviderPayload,
  processUpdateResponse,
  createSmartUpdatePlan
} from "../utils/providerFormUtils";
import { ImSpinner8 } from "react-icons/im";

interface ProviderConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  isEditMode: boolean;
  editingProvider: RegisteredProvider | null;
  isWalletConnected: boolean;
  onProviderRegistration: (provider: RegisteredProvider) => void;
  onProviderUpdate: (provider: RegisteredProvider, formData: ProviderFormData) => void;
  providerRegistration: any;
  providerUpdate: any;
}

const ProviderConfigModal: React.FC<ProviderConfigModalProps> = ({
  isOpen,
  onClose,
  isEditMode,
  editingProvider,
  isWalletConnected,
  onProviderRegistration,
  onProviderUpdate,
  providerRegistration,
  providerUpdate
}) => {
  const [showValidation, setShowValidation] = useState(false);
  const [providerToValidate, setProviderToValidate] = useState<RegisteredProvider | null>(null);

  // Form state
  const [apiCallFormatSelected, setApiCallFormatSelected] = useState(false);
  const [topLevelRequestType, setTopLevelRequestType] = useState<TopLevelRequestType>("getWithPath");
  const [authChoice, setAuthChoice] = useState<AuthChoice>("query");
  const [apiKeyQueryParamName, setApiKeyQueryParamName] = useState("");
  const [apiKeyHeaderName, setApiKeyHeaderName] = useState("");
  const [endpointApiParamKey, setEndpointApiKey] = useState("");

  const [providerName, setProviderName] = useState("");
  const [providerDescription, setProviderDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [registeredProviderWallet, setRegisteredProviderWallet] = useState("");
  const [endpointBaseUrl, setEndpointBaseUrl] = useState("");

  const [pathParamKeys, setPathParamKeys] = useState<string[]>([]);
  const [queryParamKeys, setQueryParamKeys] = useState<string[]>([]);
  const [headerKeys, setHeaderKeys] = useState<string[]>([]);
  const [bodyKeys, setBodyKeys] = useState<string[]>([]);
  const [price, setPrice] = useState<string>("");

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

    setShowValidation(false);
    setProviderToValidate(null);
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

  const handleProviderRegistration = async () => {
    const formData: ProviderFormData = {
      providerName,
      providerDescription,
      providerId: isEditMode ? editingProvider?.provider_id || "" : (window.our?.node || ""),
      instructions,
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

    const validationResult = validateProviderConfig(formData);
    if (!validationResult.isValid) {
      alert(validationResult.error);
      return;
    }

    if (!isEditMode && !isWalletConnected) {
      alert('Please connect your wallet to register on the hypergrid');
      return;
    }

    if (isEditMode && editingProvider) {
      // For updates, we pass both the provider and form data to the parent's update handler
      onProviderUpdate(editingProvider, formData);
    } else {
      const payload = buildProviderPayload(formData);
      const providerToValidate = payload.RegisterProvider;
      setProviderToValidate(providerToValidate);
      setShowValidation(true);
    }
  };

  const handleValidationSuccess = async (providerToRegister: RegisteredProvider) => {
    if (isWalletConnected) {
      providerRegistration.startRegistration(providerToRegister);
    } else {
      alert('Please connect your wallet to complete provider registration on the hypergrid.');
      setShowValidation(false);
      setProviderToValidate(null);
    }
  };

  const handleValidationError = (error: string) => {
    alert(`Validation failed: ${error}`);
  };

  const handleValidationCancel = () => {
    setShowValidation(false);
    setProviderToValidate(null);
  };

  const handleClose = () => {
    resetFormFields();
    onClose();
  };

  const handleRegistrationOverlayClose = () => {
    setShowValidation(false);
    setProviderToValidate(null);
    resetFormFields();
    onClose();
  };

  // Populate form when editing
  useEffect(() => {
    if (isEditMode && editingProvider) {
      populateFormWithProvider(editingProvider);
    } else if (!isEditMode) {
      resetFormFields();
    }
  }, [isEditMode, editingProvider]);

  // Handle escape key
  useEffect(() => {
    const handleEscapeKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isOpen) {
        handleClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscapeKey);
    }

    return () => {
      document.removeEventListener('keydown', handleEscapeKey);
    };
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  const title = showValidation
    ? "Validate Provider Configuration"
    : (isEditMode ? "Edit API Provider" : "Configure New API Provider");

  return (
    <Modal
      title={title}
      onClose={handleClose}
      preventAccidentalClose={true}
    >
      <div className="relative" style={{ maxWidth: showValidation ? "min(500px, 95vw)" : "min(1200px, 95vw)" }}>
        {!isWalletConnected ? (
          <div className="flex flex-col gap-6 items-center text-center p-8">
            <h3 className="text-xl font-semibold">Connect Wallet to Add a Provider</h3>
            <p className="text-gray-600">You need to connect your wallet to register and manage API providers on the Hypergrid.</p>
            <ConnectButton />
          </div>
        ) : (
          <>
            {/* Main content wrapped in fragment */}
            {showValidation && providerToValidate ? (
              <ValidationPanel
                provider={providerToValidate}
                onValidationSuccess={handleValidationSuccess}
                onValidationError={handleValidationError}
                onCancel={handleValidationCancel}
              />
            ) : (
              <div className="flex flex-col items-stretch  gap-6">
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
            )}

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
              onClose={handleRegistrationOverlayClose}
            />

            {providerUpdate.isUpdating && (
              <div className="fixed inset-0 bg-gray flex flex-col justify-center items-center z-50 p-5">
                <div className="bg-white p-10 rounded-xl max-w-md w-full text-center flex flex-col gap-8">
                  <h3 className="text-2xl font-medium">
                    Updating Provider
                  </h3>
                  <div className="text-sm">
                    Updating provider metadata on blockchain...
                  </div>
                  <ImSpinner8 className="animate-spin" />
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
};

export default ProviderConfigModal;
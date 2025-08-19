import { useState, useEffect } from "react";
import Modal from './Modal';
import ValidationPanel from "./ValidationPanel";
import HypergridEntryForm from "./HypergridEntryForm";
import EnhancedCurlImportModal from "./EnhancedCurlImportModal";
import ProviderRegistrationOverlay from "./ProviderRegistrationOverlay";
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { RegisteredProvider, HttpMethod, TopLevelRequestType, AuthChoice } from "../types/hypergrid_provider";
import {
  validateProviderConfig,
  buildProviderPayload,
  ProviderFormData,
  populateFormFromProvider,
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
  const [curlTemplateToValidate, setCurlTemplateToValidate] = useState<any>(null);
  const [showCurlImport, setShowCurlImport] = useState(false);
  const [showModifyExisting, setShowModifyExisting] = useState(false);

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
  const [exampleValues, setExampleValues] = useState<Record<string, string>>({});

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
    setExampleValues({});

    setShowValidation(false);
    setCurlTemplateToValidate(null);
    setShowCurlImport(false);
    setShowModifyExisting(false);
  };

  const handleCurlImport = (curlTemplateData: any) => {
    // Move to validation step with the cURL template
    setCurlTemplateToValidate(curlTemplateData);
    setShowCurlImport(false);
    setShowValidation(true);
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
      setCurlTemplateToValidate(providerToValidate);
      setShowValidation(true);
    }
  };

  const handleValidationSuccess = async (curlTemplate: any) => {
    if (isWalletConnected) {
      providerRegistration.startRegistration(curlTemplate);
    } else {
      alert('Please connect your wallet to complete provider registration on the hypergrid.');
      setShowValidation(false);
      setCurlTemplateToValidate(null);
    }
  };

  const handleValidationError = (error: string) => {
    alert(`Validation failed: ${error}`);
  };

  const handleValidationCancel = () => {
    setShowValidation(false);
    setCurlTemplateToValidate(null);
  };

  const handleClose = () => {
    resetFormFields();
    onClose();
  };

  const handleRegistrationOverlayClose = () => {
    setShowValidation(false);
    setCurlTemplateToValidate(null);
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
      <div className="relative mx-auto" style={{ maxWidth: showValidation ? "min(800px, 95vw)" : "min(1200px, 95vw)" }}>
        {!isWalletConnected ? (
          <div className="flex flex-col gap-6 items-center text-center p-8">
            <h3 className="text-xl font-semibold">Connect Wallet to Add a Provider</h3>
            <p className="text-gray-600">You need to connect your wallet to register and manage API providers on the Hypergrid.</p>
            <ConnectButton />
          </div>
        ) : (
          <>
            {/* Main content wrapped in fragment */}
            {showValidation && curlTemplateToValidate ? (
              <ValidationPanel
                curlTemplate={curlTemplateToValidate}
                onValidationSuccess={handleValidationSuccess}
                onValidationError={handleValidationError}
                onCancel={handleValidationCancel}
              />
            ) : (
              <div className="flex flex-col items-center gap-6 p-8">
                <h3 className="text-xl font-semibold text-center">
                  {isEditMode ? "Update API Provider" : "Configure New API Provider"}
                </h3>
                <p className="text-gray-600 dark:text-gray-400 text-center max-w-lg">
                  {isEditMode 
                    ? "Choose how to update your provider: import a new cURL command or modify existing settings"
                    : "Paste a cURL command to automatically configure your API provider"
                  }
                </p>
                
                {isEditMode ? (
                  <div className="flex flex-col sm:flex-row gap-4">
                    <button
                      onClick={() => setShowCurlImport(true)}
                      className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    >
                      Import New cURL
                    </button>
                    <button
                      onClick={() => {
                        setShowModifyExisting(true);
                      }}
                      className="px-6 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
                    >
                      Modify Existing
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowCurlImport(true)}
                    className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    Import from cURL
                  </button>
                )}
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

            <EnhancedCurlImportModal
              isOpen={showCurlImport}
              onClose={() => setShowCurlImport(false)}
              onImport={handleCurlImport}
            />

            {/* Modify Existing Provider Modal */}
            {showModifyExisting && editingProvider && (
              <Modal
                title="Modify Existing Provider"
                onClose={() => setShowModifyExisting(false)}
                titleChildren={<div className="text-sm text-gray-500">Edit your provider's cURL template and parameters</div>}
              >
                <div className="space-y-6">
                  <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
                    <p className="text-sm text-yellow-800 dark:text-yellow-200">
                      <strong>Note:</strong> Modifying the provider will update its configuration. 
                      You can change parameter names, add/remove modifiable fields, or update constants.
                    </p>
                  </div>
                  
                  {/* Show existing provider info */}
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Provider Name
                      </label>
                      <input
                        type="text"
                        value={editingProvider.provider_name}
                        disabled
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-gray-50 dark:bg-gray-800 text-gray-500"
                      />
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Current Endpoint
                      </label>
                      <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-md font-mono text-sm">
                        {editingProvider.endpoint.base_url_template || 'No template available'}
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
                    <button
                      onClick={() => setShowModifyExisting(false)}
                      className="px-4 py-2 text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => {
                        // TODO: Convert existing provider to cURL template format and show in validation
                        // For now, just proceed to validation with existing data
                        setCurlTemplateToValidate(editingProvider);
                        setShowModifyExisting(false);
                        setShowValidation(true);
                      }}
                      className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                    >
                      Proceed to Validation
                    </button>
                  </div>
                </div>
              </Modal>
            )}

            {providerUpdate.isUpdating && (
              <div className="fixed inset-0 bg-gray dark:bg-dark-gray flex flex-col justify-center items-center z-50 p-5">
                <div className="bg-white dark:bg-black p-10 rounded-xl max-w-md w-full text-center flex flex-col gap-8">
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
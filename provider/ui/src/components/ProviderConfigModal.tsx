import { useState, useEffect, useRef, useCallback } from "react";
import Modal from './Modal';
import ValidationPanel from "./ValidationPanel";
import ProviderConfigurationForm from "./ProviderConfigurationForm";
import ProviderRegistrationOverlay from "./ProviderRegistrationOverlay";
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { RegisteredProvider } from "../types/hypergrid_provider";
import { ProviderRegistrationStep } from "../registration/hypermapUtils";
import { ImSpinner8 } from "react-icons/im";
import { Address } from "viem";
import { useAccount } from 'wagmi';

interface ProviderConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  isEditMode: boolean;
  editingProvider?: RegisteredProvider;
  isWalletConnected: boolean;
  onProviderRegistration: (provider: RegisteredProvider) => void;
  onProviderUpdate: (provider: RegisteredProvider, formData: any) => void;
  providerRegistration: {
    isRegistering: boolean;
    step: ProviderRegistrationStep;
    currentNoteIndex: number;
    mintedProviderAddress: Address | null;
    isMinting: boolean;
    isSettingNotes: boolean;
    isMintTxLoading: boolean;
    isNotesTxLoading: boolean;
    mintError: Error | null;
    notesError: Error | null;
    startRegistration: (curlTemplateData: any) => void; // Accepts cURL template + metadata
  };
  providerUpdate: {
    isUpdating: boolean;
    updateProviderNotes: (tbaAddress: `0x${string}`, notes: Array<{ key: string; value: string }>) => Promise<void>;
  };
  publicClient?: any;
  handleProviderUpdated: (provider: RegisteredProvider) => void;
  processUpdateResponse: (response: any) => { success: boolean; message: string };
  resetEditState: () => void;
  handleCloseAddNewModal: () => void;
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
  providerUpdate,
  publicClient,
  handleProviderUpdated,
  processUpdateResponse,
  resetEditState,
  handleCloseAddNewModal
}) => {
  // ===== State =====
  const { address: connectedWalletAddress } = useAccount();
  
  // Validation flow state
  const [showValidation, setShowValidation] = useState(false);
  const [curlTemplateToValidate, setCurlTemplateToValidate] = useState<any>(null);
  const [configuredCurlTemplate, setConfiguredCurlTemplate] = useState<any>(null);
  
  // cURL component state preservation
  const [preservedCurlState, setPreservedCurlState] = useState<{
    curlCommand: string;
    parsedRequest: any;
    potentialFields: any[];
    modifiableFields: any[];
    parseError: string | null;
    activeTab: 'viewer' | 'modifiable';
  } | null>(null);
  const [currentCurlState, setCurrentCurlState] = useState<any>(null);

  // Provider metadata state
  const [providerName, setProviderName] = useState("");
  const [providerDescription, setProviderDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [registeredProviderWallet, setRegisteredProviderWallet] = useState("");
  const [price, setPrice] = useState<string>("");

  // ===== Callbacks =====
  const formatPriceForInput = useCallback((price: number): string => {
    if (typeof price !== 'number' || isNaN(price)) return '0';
    
    // Convert to string and check if it's in scientific notation
    const priceStr = price.toString();
    if (priceStr.includes('e') || priceStr.includes('E')) {
      // For scientific notation, use a high precision toFixed to preserve the full value
      // Use up to 20 decimal places to ensure we don't lose precision
      return price.toFixed(20).replace(/\.?0+$/, '');
    }
    
    // If it's not in scientific notation, return as-is
    return priceStr;
  }, []);

  const handleModifyExistingProvider = useCallback(() => {
    if (!editingProvider) return;

    // Pre-populate all the metadata fields from the existing provider
    setProviderName(editingProvider.provider_name);
    setProviderDescription(editingProvider.description);
    setInstructions(editingProvider.instructions);
    setRegisteredProviderWallet(editingProvider.registered_provider_wallet);
    setPrice(formatPriceForInput(editingProvider.price));

    // Convert the existing provider's endpoint back to a cURL template format
    const reconstructedCurlTemplate = {
      original_curl: editingProvider.endpoint.original_curl,
      method: editingProvider.endpoint.method,
      base_url: editingProvider.endpoint.base_url,
      url_template: editingProvider.endpoint.url_template,
      original_headers: editingProvider.endpoint.original_headers,
      original_body: editingProvider.endpoint.original_body,
      parameters: editingProvider.endpoint.parameters,
      parameter_names: editingProvider.endpoint.parameter_names
    };

    // Set this as the configured template so the register button appears
    setConfiguredCurlTemplate(reconstructedCurlTemplate);

    // Create preserved state for the cURL component to restore the original cURL
    // We need to create a minimal parsedRequest to prevent the auto-parser from clearing modifiable fields
    const preservedState = {
      curlCommand: editingProvider.endpoint.original_curl,
      parsedRequest: {
        fullCurl: editingProvider.endpoint.original_curl,
        method: editingProvider.endpoint.method,
        url: editingProvider.endpoint.original_curl.match(/https?:\/\/[^\s"']+/)?.[0] || '',
        headers: Object.fromEntries(editingProvider.endpoint.original_headers),
        body: editingProvider.endpoint.original_body ? JSON.parse(editingProvider.endpoint.original_body) : null,
        queryParams: {},
        pathSegments: [],
        baseUrl: editingProvider.endpoint.base_url,
        pathname: new URL(editingProvider.endpoint.base_url).pathname
      },
      potentialFields: editingProvider.endpoint.parameters.map(param => ({
        jsonPointer: param.json_pointer,
        fieldType: param.location,
        name: param.parameter_name,
        value: JSON.parse(param.example_value),
        description: `${param.location} parameter: ${param.parameter_name}`
      })),
      modifiableFields: editingProvider.endpoint.parameters.map(param => ({
        jsonPointer: param.json_pointer,
        fieldType: param.location,
        name: param.parameter_name,
        value: JSON.parse(param.example_value),
        description: `${param.location} parameter: ${param.parameter_name}`
      })),
      parseError: null,
      activeTab: 'modifiable' as const
    };

    setPreservedCurlState(preservedState);
  }, [editingProvider, formatPriceForInput]);

  const resetFormFields = useCallback(() => {
    setProviderName("");
    setProviderDescription("");
    setInstructions("");
    setRegisteredProviderWallet("");
    setPrice("");
    setShowValidation(false);
    setCurlTemplateToValidate(null);
    setConfiguredCurlTemplate(null);
    setPreservedCurlState(null);
    setCurrentCurlState(null);
  }, []);

  const handleCurlImport = useCallback((curlTemplateData: any) => {
    // Store the configured cURL template - this now happens automatically
    // Can be null when cURL is cleared
    setConfiguredCurlTemplate(curlTemplateData);
    
    // Auto-populate instructions when cURL template is configured
    if (curlTemplateData && curlTemplateData.parameters) {
      const parameterNames = curlTemplateData.parameters.map((param: any) => param.parameter_name);
      const callArgsExample = parameterNames.map((name: string) => `["${name}", "{${name}_value}"]`).join(', ');
      
      const instructionTemplate = `This provider should be called using the following format: {"callArgs": [${callArgsExample}], "providerId": "${window.our?.node || '{node_id}'}", "providerName": "${providerName || '{provider_name}'}"}`;
      
      setInstructions(instructionTemplate);
    } else if (!curlTemplateData) {
      // Clear instructions when cURL is cleared
      setInstructions("");
    }
  }, [providerName]);

  const handleProviderNameChange = useCallback((newName: string) => {
    setProviderName(newName);
    
    if (configuredCurlTemplate && configuredCurlTemplate.parameters) {
      const parameterNames = configuredCurlTemplate.parameters.map((param: any) => param.parameter_name);
      const callArgsExample = parameterNames.map((name: string) => `["${name}", "{${name}_value}"]`).join(', ');
      const instructionTemplate = `This provider should be called using the following format: {"callArgs": [${callArgsExample}], "providerId": "${window.our?.node || '{node_id}'}.os", "providerName": "${newName || '{provider_name}'}"}`;
      setInstructions(instructionTemplate);
    }
  }, [configuredCurlTemplate]);

  const handleFinalRegistration = useCallback((validatedProvider: RegisteredProvider) => {
    if (!isWalletConnected) {
      const action = isEditMode ? 'update' : 'registration';
      alert(`Please connect your wallet to complete provider ${action} on the hypergrid.`);
      return;
    }

    if (isEditMode && editingProvider) {
      onProviderUpdate(editingProvider, validatedProvider);
    } else {
      onProviderRegistration(validatedProvider);
    }
  }, [isWalletConnected, isEditMode, editingProvider, onProviderUpdate, onProviderRegistration]);

  const handleValidationSuccess = useCallback(async (validatedProvider: any) => {
    setShowValidation(false);
    setPreservedCurlState(null);
    handleFinalRegistration(validatedProvider);
  }, [handleFinalRegistration]);

  const handleRegisterProvider = useCallback(() => {
    if (!configuredCurlTemplate) {
      alert('Please configure your cURL template first');
      return;
    }

    if (!providerName || !price || !registeredProviderWallet) {
      alert('Please fill in all required metadata fields');
      return;
    }

    if (currentCurlState) {
      setPreservedCurlState(currentCurlState);
    }

    setCurlTemplateToValidate(configuredCurlTemplate);
    setShowValidation(true);
  }, [configuredCurlTemplate, providerName, price, registeredProviderWallet, currentCurlState]);

  const handleUpdateProvider = useCallback(() => {
    if (!isEditMode || !editingProvider) {
      console.error('Update called but not in edit mode or no provider to edit');
      return;
    }

    if (!configuredCurlTemplate) {
      alert('Please configure your cURL template first');
      return;
    }

    if (!providerName || !price || !registeredProviderWallet) {
      alert('Please fill in all required metadata fields');
      return;
    }

    if (currentCurlState) {
      setPreservedCurlState(currentCurlState);
    }

    setCurlTemplateToValidate(configuredCurlTemplate);
    setShowValidation(true);
  }, [isEditMode, editingProvider, configuredCurlTemplate, providerName, price, registeredProviderWallet, currentCurlState]);

  const handleValidationError = useCallback((error: string) => {
    alert(`Validation failed: ${error}`);
  }, []);

  const handleValidationCancel = useCallback(() => {
    setShowValidation(false);
    setCurlTemplateToValidate(null);
  }, []);

  const handleRegistrationOverlayClose = useCallback(() => {
    setShowValidation(false);
    setCurlTemplateToValidate(null);
    if (providerRegistration.step === 'complete') {
      resetFormFields();
    }
    onClose();
  }, [providerRegistration.step, resetFormFields, onClose]);

  const handleForceClose = useCallback(() => {
    const hasFormData = providerName || providerDescription || instructions || 
                       registeredProviderWallet || price || configuredCurlTemplate;
    
    if (hasFormData) {
      const confirmClose = confirm('You have unsaved changes. Are you sure you want to close?');
      if (!confirmClose) return;
    }
    
    resetFormFields();
    onClose();
  }, [providerName, providerDescription, instructions, registeredProviderWallet, price, configuredCurlTemplate, resetFormFields, onClose]);

  // ===== Effects =====
  // Auto-load existing provider data when in edit mode
  useEffect(() => {
    if (isEditMode && editingProvider && isOpen) {
      handleModifyExistingProvider();
    }
  }, [isEditMode, editingProvider, isOpen, handleModifyExistingProvider]);

  // Reset form when modal closes
  useEffect(() => {
    if (!isOpen) {
      setTimeout(() => {
        resetFormFields();
      }, 0);
    }
  }, [isOpen, resetFormFields]);

  // Reset form when switching from edit mode to new mode
  useEffect(() => {
    if (!isEditMode && isOpen) {
      resetFormFields();
    }
  }, [isEditMode, isOpen, resetFormFields]);

  // Auto-populate wallet with connected wallet address
  useEffect(() => {
    if (configuredCurlTemplate && connectedWalletAddress && !registeredProviderWallet) {
      setRegisteredProviderWallet(connectedWalletAddress);
    }
  }, [configuredCurlTemplate, connectedWalletAddress, registeredProviderWallet]);

  // Handle escape key with confirmation
  useEffect(() => {
    const handleEscapeKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isOpen) {
        handleForceClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscapeKey);
    }

    return () => {
      document.removeEventListener('keydown', handleEscapeKey);
    };
  }, [isOpen, handleForceClose]);

  // ===== Render =====
  if (!isOpen) {
    return null;
  }

  const title = showValidation
    ? "🔍 Validate Provider Configuration"
    : (isEditMode ? "✏️ Edit API Provider" : "🚀 Create New API Provider");

  return (
    <Modal
      title={title}
      onClose={handleForceClose}
      preventAccidentalClose={true}
    >
      <div className="relative mx-auto w-full" style={{ maxWidth: showValidation ? "min(900px, 95vw)" : "min(1400px, 95vw)" }}>
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
                providerMetadata={{
                  providerName: isEditMode && editingProvider ? editingProvider.provider_name : providerName,
                  providerDescription,
                  instructions,
                  registeredProviderWallet,
                  price: parseFloat(price) || 0
                }}
                onValidationSuccess={handleValidationSuccess}
                onValidationError={handleValidationError}
                onCancel={handleValidationCancel}
                isEditMode={isEditMode}
                originalProviderName={editingProvider?.provider_name}
              />
            ) : (
              <div className="flex flex-col items-stretch gap-3">
                {/* Provider Configuration Form */}
                <ProviderConfigurationForm
                  onCurlImport={handleCurlImport}
                  onParseSuccess={() => {}}
                  onParseClear={() => {
                    setConfiguredCurlTemplate(null);
                  }}
                  originalCurlCommand=""
                  onCurlStateChange={setCurrentCurlState}
                  preservedCurlState={preservedCurlState}
                  configuredCurlTemplate={configuredCurlTemplate}
                  nodeId={window.our?.node || "auto-generated"}
                  providerName={providerName}
                  setProviderName={handleProviderNameChange}
                  providerDescription={providerDescription}
                  setProviderDescription={setProviderDescription}
                  instructions={instructions}
                  setInstructions={setInstructions}
                  registeredProviderWallet={registeredProviderWallet}
                  setRegisteredProviderWallet={setRegisteredProviderWallet}
                  price={price}
                  setPrice={setPrice}
                  isEditMode={isEditMode}
                />

                {/* Register Button - Only shows when all fields are filled */}
                {configuredCurlTemplate && providerName && price && registeredProviderWallet && (
                  <div className="flex justify-center">
                    <button
                      onClick={isEditMode ? handleUpdateProvider : handleRegisterProvider}
                      className="px-8 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 
                               transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                    >
                      {isEditMode ? 'Validate Update' : 'Validate Provider'}
                    </button>
                  </div>
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





            {providerUpdate.isUpdating && (
              <div className="fixed inset-0 bg-black/50 flex justify-center items-center z-50">
                <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-xl max-w-sm mx-4 text-center">
                  <div className="flex flex-col items-center gap-4">
                    <ImSpinner8 className="animate-spin text-blue-600 text-2xl" />
                    <div>
                      <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">
                        Updating Provider
                      </h3>
                      <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                        Updating metadata on blockchain...
                      </p>
                    </div>
                  </div>
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
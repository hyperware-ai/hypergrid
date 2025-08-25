import { useState, useEffect, useRef, useCallback } from "react";
import Modal from './Modal';
import ValidationPanel from "./ValidationPanel";
import UnifiedTerminalInterface from "./UnifiedTerminalInterface";
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
  const { address: connectedWalletAddress } = useAccount();
  const [showValidation, setShowValidation] = useState(false);
  const [curlTemplateToValidate, setCurlTemplateToValidate] = useState<any>(null);
  const [configuredCurlTemplate, setConfiguredCurlTemplate] = useState<any>(null);
  
  // Preserve complete state for navigation back from validation
  const [preservedCurlState, setPreservedCurlState] = useState<{
    curlCommand: string;
    parsedRequest: any;
    potentialFields: any[];
    modifiableFields: any[];
    parseError: string | null;
    activeTab: 'viewer' | 'modifiable';
  } | null>(null);
  
  // Track current state of the cURL component
  const [currentCurlState, setCurrentCurlState] = useState<any>(null);

  // Hypergrid metadata state (only what we need)
  const [providerName, setProviderName] = useState("");
  const [providerDescription, setProviderDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [registeredProviderWallet, setRegisteredProviderWallet] = useState("");
  const [price, setPrice] = useState<string>("");

  // Helper function to format price and avoid scientific notation while preserving full precision
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

  // Auto-load existing provider data when in edit mode
  useEffect(() => {
    if (isEditMode && editingProvider && isOpen) {
      // Load the existing provider data immediately
      handleModifyExistingProvider();
    }
  }, [isEditMode, editingProvider, isOpen, handleModifyExistingProvider]);

  const resetFormFields = () => {
    // Reset metadata form
    setProviderName("");
    setProviderDescription("");
    setInstructions("");
    setRegisteredProviderWallet("");
    setPrice("");

    // Reset flow state
    setShowValidation(false);
    setCurlTemplateToValidate(null);
    setConfiguredCurlTemplate(null);
    setPreservedCurlState(null);
    setCurrentCurlState(null);
  };

  // Reset form when modal closes or when switching between edit/new modes
  useEffect(() => {
    if (!isOpen) {
      // Modal is closing - reset everything immediately
      setTimeout(() => {
        resetFormFields();
      }, 0);
    }
  }, [isOpen]);

  // Reset form when switching from edit mode to new mode
  useEffect(() => {
    if (!isEditMode && isOpen) {
      // Switched to new provider mode - reset form
      resetFormFields();
    }
  }, [isEditMode, isOpen]);

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

  // Update instructions when provider name changes (to keep the template current)
  const handleProviderNameChange = (newName: string) => {
    setProviderName(newName);
    
    // Update instructions template if we have a configured cURL template
    if (configuredCurlTemplate && configuredCurlTemplate.parameters) {
      const parameterNames = configuredCurlTemplate.parameters.map((param: any) => param.parameter_name);
      const callArgsExample = parameterNames.map((name: string) => `["${name}", "{${name}_value}"]`).join(', ');
      
      const instructionTemplate = `This provider should be called using the following format: {"callArgs": [${callArgsExample}], "providerId": "${window.our?.node || '{node_id}'}.os", "providerName": "${newName || '{provider_name}'}"}`;
      
      setInstructions(instructionTemplate);
    }
  };

  const handleValidationSuccess = async (validatedProvider: any) => {
    // After validation succeeds, prepare for registration/update
    setShowValidation(false);
    setPreservedCurlState(null); // Clear preserved state since we're moving forward
    
    // Proceed to registration or update with the validated provider object
    handleFinalRegistration(validatedProvider);
  };

  const handleRegisterProvider = () => {
    if (!configuredCurlTemplate) {
      alert('Please configure your cURL template first');
      return;
    }

    if (!providerName || !price || !registeredProviderWallet) {
      alert('Please fill in all required metadata fields');
      return;
    }

    // Preserve the complete cURL component state before going to validation
    if (currentCurlState) {
      setPreservedCurlState(currentCurlState);
    }

    // Move to validation step
    setCurlTemplateToValidate(configuredCurlTemplate);
    setShowValidation(true);
  };

  const handleUpdateProvider = () => {
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

    // Preserve the complete cURL component state before going to validation
    if (currentCurlState) {
      setPreservedCurlState(currentCurlState);
    }

    // Move to validation step for updates (same validation flow as registration)
    setCurlTemplateToValidate(configuredCurlTemplate);
    setShowValidation(true);
  };

  const handleFinalRegistration = (validatedProvider: RegisteredProvider) => {
    if (!isWalletConnected) {
      const action = isEditMode ? 'update' : 'registration';
      alert(`Please connect your wallet to complete provider ${action} on the hypergrid.`);
      return;
    }

    if (isEditMode && editingProvider) {
      // Handle provider update with smart update logic
      handleProviderUpdateFlow(validatedProvider);
    } else {
      // Handle new provider registration - use the callback to trigger parent's registration flow
      onProviderRegistration(validatedProvider);
    }
  };

  const handleProviderUpdateFlow = async (validatedProvider: RegisteredProvider) => {
    if (!editingProvider) return;

    // Use the comprehensive update flow from App.tsx
    // This integrates with the TBA system properly
    await onProviderUpdate(editingProvider, validatedProvider);
  };

  const handleValidationError = (error: string) => {
    alert(`Validation failed: ${error}`);
  };

  const handleValidationCancel = () => {
    setShowValidation(false);
    setCurlTemplateToValidate(null);
    // Form fields and configuredCurlTemplate are automatically preserved
    // The preservedCurlState will be passed to the component to restore the textarea
  };

  const handleMetadataCancel = () => {
    setConfiguredCurlTemplate(null);
  };



  const handleClose = () => {
    // Only reset if user explicitly confirms or if successful registration
    onClose();
  };

  const handleRegistrationOverlayClose = () => {
    setShowValidation(false);
    setCurlTemplateToValidate(null);
    // Only reset form if registration was successful
    if (providerRegistration.step === 'complete') {
      resetFormFields();
    }
    onClose();
  };

  const handleForceClose = () => {
    // Explicit close with confirmation if form has data
    const hasFormData = providerName || providerDescription || instructions || 
                       registeredProviderWallet || price || configuredCurlTemplate;
    
    if (hasFormData) {
      const confirmClose = confirm('You have unsaved changes. Are you sure you want to close?');
      if (!confirmClose) return;
    }
    
    resetFormFields();
    onClose();
  };



  // Auto-populate wallet with connected wallet address when form becomes visible
  useEffect(() => {
    if (configuredCurlTemplate && connectedWalletAddress && !registeredProviderWallet) {
      setRegisteredProviderWallet(connectedWalletAddress);
    }
  }, [configuredCurlTemplate, connectedWalletAddress]);

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
  }, [isOpen, providerName, providerDescription, instructions, registeredProviderWallet, price, configuredCurlTemplate]);

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
                {/* Unified Terminal Interface */}
                <UnifiedTerminalInterface
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
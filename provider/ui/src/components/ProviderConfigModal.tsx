import { useState, useEffect, useRef, useCallback } from "react";
import Modal from './Modal';
import ValidationPanel from "./ValidationPanel";
import HypergridEntryForm from "./HypergridEntryForm";
import EnhancedCurlImportModal from "./EnhancedCurlImportModal";
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
  onProviderUpdate: (updatedProvider: RegisteredProvider) => void;
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
  };
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
  const { address: connectedWalletAddress } = useAccount();
  const [showValidation, setShowValidation] = useState(false);
  const [curlTemplateToValidate, setCurlTemplateToValidate] = useState<any>(null);
  const [validatedCurlTemplate, setValidatedCurlTemplate] = useState<any>(null);
  const [showCurlImport, setShowCurlImport] = useState(false);
  const [showModifyExisting, setShowModifyExisting] = useState(false);
  const [configuredCurlTemplate, setConfiguredCurlTemplate] = useState<any>(null);
  const [hasParsedCurl, setHasParsedCurl] = useState(false);

  // Hypergrid metadata state (only what we need)
  const [providerName, setProviderName] = useState("");
  const [providerDescription, setProviderDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [registeredProviderWallet, setRegisteredProviderWallet] = useState("");
  const [price, setPrice] = useState<string>("");

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
    setValidatedCurlTemplate(null);
    setShowCurlImport(false);
    setShowModifyExisting(false);
    setConfiguredCurlTemplate(null);
    setHasParsedCurl(false);
    console.log('RESET FORM FIELDS - showCurlImport set to false');
  };

  const handleCurlImport = useCallback((curlTemplateData: any) => {
    // Store the configured cURL template - this now happens automatically
    // Can be null when cURL is cleared
    setConfiguredCurlTemplate(curlTemplateData);
    
    // Auto-populate instructions when cURL template is configured
    if (curlTemplateData && curlTemplateData.parameters) {
      const parameterNames = curlTemplateData.parameters.map((param: any) => param.parameter_name);
      const callArgsExample = parameterNames.map((name: string) => `["${name}", "{${name}_value}"]`).join(', ');
      
      const instructionTemplate = `This provider should be called using the following format: {"callArgs": [${callArgsExample}], "providerId": "${window.our?.node || '{node_id}'}.os", "providerName": "${providerName || '{provider_name}'}"}`;
      
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
    // After validation succeeds, prepare for registration
    setValidatedCurlTemplate(validatedProvider.endpoint);
    setShowValidation(false);
    
    // Proceed to registration with the validated provider object
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

    // Move to validation step
    setCurlTemplateToValidate(configuredCurlTemplate);
      setShowValidation(true);
  };

  const handleFinalRegistration = (validatedProvider: RegisteredProvider) => {
    if (!isWalletConnected) {
      alert('Please connect your wallet to complete provider registration on the hypergrid.');
      return;
    }

    // Use the validated provider object directly for registration
    // This ensures consistency between validation, on-chain minting, and backend registration
    providerRegistration.startRegistration(validatedProvider);
  };

  const handleValidationError = (error: string) => {
    alert(`Validation failed: ${error}`);
  };

  const handleValidationCancel = () => {
    setShowValidation(false);
    setCurlTemplateToValidate(null);
  };

  const handleMetadataCancel = () => {
    setConfiguredCurlTemplate(null);
    setValidatedCurlTemplate(null);
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

  // Populate form when editing
  useEffect(() => {
    if (isEditMode && editingProvider) {
      // Populate metadata from existing provider
      setProviderName(editingProvider.provider_name || "");
      setProviderDescription(editingProvider.description || "");
      setInstructions(editingProvider.instructions || "");
      setRegisteredProviderWallet(editingProvider.registered_provider_wallet || "");
      setPrice(editingProvider.price?.toString() || "");
    } else if (!isEditMode) {
      resetFormFields();
    }
  }, [isEditMode, editingProvider]);

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
                  providerName,
                  providerDescription,
                  instructions,
                  registeredProviderWallet,
                  price: parseFloat(price) || 0
                }}
                onValidationSuccess={handleValidationSuccess}
                onValidationError={handleValidationError}
                onCancel={handleValidationCancel}
              />
            ) : isEditMode ? (
              <div className="flex flex-col items-center gap-6 p-8">
                <h3 className="text-xl font-semibold text-center">Update API Provider</h3>
                <p className="text-gray-600 dark:text-gray-400 text-center max-w-lg">
                  Choose how to update your provider: import a new cURL command or modify existing settings
                </p>
                
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
              </div>
            ) : (
              <div className="flex flex-col items-stretch gap-3">
                {/* Unified Terminal Interface */}
                <UnifiedTerminalInterface
                  onCurlImport={handleCurlImport}
                  onParseSuccess={() => setHasParsedCurl(true)}
                  onParseClear={() => {
                    setHasParsedCurl(false);
                    setConfiguredCurlTemplate(null);
                  }}
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
                />

                {/* Register Button - Only shows when all fields are filled */}
                {configuredCurlTemplate && providerName && price && registeredProviderWallet && (
                  <div className="flex justify-center">
                    <button
                      onClick={handleRegisterProvider}
                      className="px-8 py-3 bg-gradient-to-r from-cyan to-blue-400 text-gray-900 font-bold rounded-lg hover:from-cyan/90 hover:to-blue-400/90 transition-all shadow-lg shadow-cyan/25"
                    >
                      Register Provider
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
                        {editingProvider.endpoint.url_template || 'No template available'}
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
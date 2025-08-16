import { useState, useEffect } from "react";
import Modal from './Modal';
import ValidationPanel from "./ValidationPanel";
import CurlTemplateEditor from "./CurlTemplateEditor";
import HypergridEntryForm from "./HypergridEntryForm";
import CurlImportModal from "./CurlImportModal";
import ProviderRegistrationOverlay from "./ProviderRegistrationOverlay";
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { RegisteredProvider, Variable } from "../types/hypergrid_provider";
import { ImSpinner8 } from "react-icons/im";

interface ProviderConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  isEditMode: boolean;
  editingProvider: RegisteredProvider | null;
  isWalletConnected: boolean;
  onProviderRegistration: (provider: RegisteredProvider) => void;
  onProviderUpdate: (provider: RegisteredProvider) => void;
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
  const [showCurlImport, setShowCurlImport] = useState(false);

  // Form state
  const [providerName, setProviderName] = useState("");
  const [providerDescription, setProviderDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [registeredProviderWallet, setRegisteredProviderWallet] = useState("");
  const [price, setPrice] = useState<string>("");
  
  // Curl template state
  const [curlTemplate, setCurlTemplate] = useState("");
  const [variables, setVariables] = useState<Variable[]>([]);

  const resetFormFields = () => {
    setProviderName("");
    setProviderDescription("");
    setInstructions("");
    setRegisteredProviderWallet("");
    setPrice("");
    setCurlTemplate("");
    setVariables([]);
    
    setShowValidation(false);
    setProviderToValidate(null);
    setShowCurlImport(false);
  };

  const handleCurlImport = (template: string, importedVariables: Variable[]) => {
    // Set the imported curl template and variables
    setCurlTemplate(template);
    setVariables(importedVariables);
  };

  const populateFormWithProvider = (provider: RegisteredProvider) => {
    setProviderName(provider.provider_name);
    setProviderDescription(provider.description);
    setInstructions(provider.instructions);
    setRegisteredProviderWallet(provider.registered_provider_wallet);
    setPrice(provider.price.toString());
    setCurlTemplate(provider.endpoint.curl_template);
    setVariables(provider.endpoint.variables);
  };

  const handleProviderRegistration = async () => {
    // Basic validation
    if (!providerName.trim() || !curlTemplate.trim()) {
      alert("Provider Name and Curl Template are required.");
      return;
    }

    if (!isEditMode && !isWalletConnected) {
      alert('Please connect your wallet to register on the hypergrid');
      return;
    }

    // Build provider object
    const provider: RegisteredProvider = {
      provider_name: providerName,
      provider_id: isEditMode ? editingProvider?.provider_id || "" : (window.our?.node || ""),
      description: providerDescription,
      instructions: instructions,
      registered_provider_wallet: registeredProviderWallet,
      price: parseFloat(price) || 0,
      endpoint: {
        name: providerName,
        curl_template: curlTemplate,
        variables: variables
      }
    };

    if (isEditMode) {
      onProviderUpdate(provider);
    } else {
      setProviderToValidate(provider);
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
            {showValidation && providerToValidate ? (
              <ValidationPanel
                provider={providerToValidate}
                onValidationSuccess={handleValidationSuccess}
                onValidationError={handleValidationError}
                onCancel={handleValidationCancel}
              />
            ) : (
              <div className="flex flex-col items-stretch gap-6">
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
                
                <div className="border border-gray-200 rounded-lg p-4">
                  <CurlTemplateEditor
                    value={curlTemplate}
                    variables={variables}
                    onChange={(template, vars) => {
                      setCurlTemplate(template);
                      setVariables(vars);
                    }}
                  />
                </div>

                <div className="flex gap-3 justify-end">
                  {!isEditMode && (
                    <button
                      onClick={() => setShowCurlImport(true)}
                      className="px-4 py-2 bg-gray-200 text-gray-700 font-medium rounded-lg
                               hover:bg-gray-300 transition-colors"
                    >
                      Import from Curl
                    </button>
                  )}
                  <button
                    onClick={handleProviderRegistration}
                    className="px-4 py-2 bg-gray-900 text-white font-medium rounded-lg
                             hover:bg-gray-800 transition-colors"
                  >
                    {isEditMode ? "Update Provider" : "Register Provider Configuration"}
                  </button>
                </div>
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

            <CurlImportModal
              isOpen={showCurlImport}
              onClose={() => setShowCurlImport(false)}
              onImport={handleCurlImport}
            />

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
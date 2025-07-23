import React from 'react';
import { type Address } from 'viem';
import { 
  ProviderRegistrationStep,
  getRegistrationStepText 
} from '../registration/hypermapUtils';

interface ProviderRegistrationOverlayProps {
  isVisible: boolean;
  step: ProviderRegistrationStep;
  currentNoteIndex: number;
  mintedProviderAddress: Address | null;
  isMinting: boolean;
  isSettingNotes: boolean;
  isMintTxLoading: boolean;
  isNotesTxLoading: boolean;
  mintError: Error | null;
  notesError: Error | null;
  onClose?: () => void; // Add optional close callback
}

export const ProviderRegistrationOverlay: React.FC<ProviderRegistrationOverlayProps> = ({
  isVisible,
  step,
  mintedProviderAddress,
  isMinting,
  isSettingNotes,
  isMintTxLoading,
  isNotesTxLoading,
  mintError,
  notesError,
  onClose,
}) => {
  // Auto-close when registration completes successfully
  React.useEffect(() => {
    // Only trigger auto-close if the overlay is visible AND registration is complete
    if (isVisible && step === 'complete' && mintedProviderAddress) {
      console.log('🎉 Registration complete! TBA:', mintedProviderAddress);
      
      // Auto-close after showing success briefly
      if (onClose) {
        const timer = setTimeout(() => {
          onClose();
        }, 2000); // Show success for 2 seconds then close
        
        return () => clearTimeout(timer);
      }
    }
  }, [isVisible, step, mintedProviderAddress, onClose]);

  if (!isVisible) return null;

  const isLoading = isMinting || isSettingNotes || isMintTxLoading || isNotesTxLoading;
  const hasError = !!(mintError || notesError);

  return (
    <div className="provider-registration-overlay">
      <div className="provider-registration-content">
        <h3 className="provider-registration-title">
          Blockchain Registration
        </h3>
        
        {/* Progress Steps */}
        <div className="provider-registration-steps">
          <Step 
            number={1} 
            label="Mint" 
            isActive={step === 'minting'}
            isComplete={step === 'notes' || step === 'complete'}
          />
          <Step 
            number={2} 
            label="Metadata" 
            isActive={step === 'notes'}
            isComplete={step === 'complete'}
          />
        </div>

        {/* Status Message */}
        <div className="provider-registration-status">
          {step === 'minting' && 'Creating provider entry on blockchain...'}
          {step === 'notes' && 'Setting provider metadata...'}
          {step === 'complete' && 'Registration complete!'}
        </div>

        {/* Loading Indicator */}
        {isLoading && !hasError && (
          <div className="provider-registration-loader-container">
            <div className="provider-registration-loader" />
          </div>
        )}

        {/* Success State */}
        {step === 'complete' && mintedProviderAddress && (
          <div className="provider-registration-success">
            <div className="provider-registration-success-message">
              ✓ Provider registered successfully
            </div>
            <div className="provider-registration-address">
              {mintedProviderAddress}
            </div>
            {onClose && (
              <button
                onClick={onClose}
                className="provider-registration-continue-btn"
              >
                Continue to Dashboard
              </button>
            )}
          </div>
        )}
        
        {/* Error Display */}
        {hasError && (
          <div className="provider-registration-error">
            {(mintError || notesError)?.message}
          </div>
        )}
      </div>
      
    </div>
  );
};

// Simple step indicator component
const Step: React.FC<{
  number: number;
  label: string;
  isActive: boolean;
  isComplete: boolean;
}> = ({ number, label, isActive, isComplete }) => (
  <div className="registration-step">
    <div className={`registration-step-circle ${isComplete ? 'complete' : isActive ? 'active' : 'inactive'}`}>
      {isComplete ? '✓' : number}
    </div>
    <span className={`registration-step-label ${isComplete ? 'complete' : isActive ? 'active' : 'inactive'}`}>
      {label}
    </span>
  </div>
);

export default ProviderRegistrationOverlay; 
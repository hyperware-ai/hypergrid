import React from 'react';
import { type Address } from 'viem';
import {
  ProviderRegistrationStep,
  getRegistrationStepText
} from '../registration/hypermapUtils';
import { ImSpinner8 } from 'react-icons/im';

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
    <div className="fixed inset-0 bg-white flex flex-col justify-center items-center z-50 p-5">
      <div className="bg-gray p-10 rounded-xl max-w-md w-full text-center flex flex-col gap-4">
        <h3 className="text-2xl font-bold">
          Blockchain Registration
        </h3>

        {/* Progress Steps */}
        <div className="flex justify-center gap-10">
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
        <div className="text-sm">
          {step === 'minting' && 'Creating provider entry on blockchain...'}
          {step === 'notes' && 'Setting provider metadata...'}
          {step === 'complete' && 'Registration complete!'}
        </div>

        {/* Loading Indicator */}
        {isLoading && !hasError && (
          <ImSpinner8 className="animate-spin" />
        )}

        {/* Success State */}
        {step === 'complete' && mintedProviderAddress && (
          <div className="flex flex-col gap-2">
            <div className="text-green-400 text-lg">
              ✓ Provider registered successfully
            </div>
            <div className="font-mono text-xs break-all p-3 bg-white/5 rounded-md">
              {mintedProviderAddress}
            </div>
            {onClose && (
              <button
                onClick={onClose}
                className="px-5 py-2 bg-black text-cyan"
              >
                Continue to Dashboard
              </button>
            )}
          </div>
        )}

        {/* Error Display */}
        {hasError && (
          <div className="text-red-400 p-4 bg-red-400/10 rounded-md text-sm">
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
  <div className="flex flex-col items-center gap-2">
    <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold transition-all ${isComplete
        ? 'bg-green-400 text-white'
        : isActive
          ? 'bg-blue-500 text-white'
          : 'bg-gray-600 text-gray-400'
      }`}>
      {isComplete ? '✓' : number}
    </div>
    <span className={`text-xs font-medium transition-colors ${isComplete
        ? 'text-green-400'
        : isActive
          ? 'text-gray-900'
          : 'text-gray-500'
      }`}>
      {label}
    </span>
  </div>
);

export default ProviderRegistrationOverlay;
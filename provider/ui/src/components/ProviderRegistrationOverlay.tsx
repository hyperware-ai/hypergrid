import React from 'react';
import { type Address } from 'viem';
import {
  ProviderRegistrationStep
} from '../registration/hypermapUtils';
import { ImSpinner8 } from 'react-icons/im';

interface ProviderRegistrationOverlayProps {
  isVisible: boolean;
  step: ProviderRegistrationStep;
  mintedProviderAddress: Address | null;
  isMinting: boolean;
  isMintTxLoading: boolean;
  mintError: Error | null;
  onClose?: () => void; // Add optional close callback
}

export const ProviderRegistrationOverlay: React.FC<ProviderRegistrationOverlayProps> = ({
  isVisible,
  step,
  mintedProviderAddress,
  isMinting,
  isMintTxLoading,
  mintError,
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

  const isLoading = isMinting || isMintTxLoading;
  const hasError = !!mintError;

  return (
    <div className="fixed inset-0 bg-black/50 flex justify-center items-center z-50">
      <div className="bg-white dark:bg-gray-800 p-8 rounded-lg shadow-xl max-w-md mx-4 text-center">
        <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-6">
          Blockchain Registration
        </h3>

        {/* Single Step Registration */}
        <div className="flex justify-center">
          <Step
            number={1}
            label="Register"
            isActive={step === 'registering'}
            isComplete={step === 'complete'}
          />
        </div>

        {/* Status Message and Loading */}
        <div className="flex flex-col items-center gap-4 my-6">
          {isLoading && !hasError && (
            <ImSpinner8 className="animate-spin text-blue-600 text-2xl" />
          )}
          <div className="text-sm text-gray-600 dark:text-gray-400">
            {step === 'registering' && 'Registering provider on blockchain...'}
            {step === 'complete' && 'Registration complete!'}
          </div>
        </div>

        {/* Success State */}
        {step === 'complete' && mintedProviderAddress && (
          <div className="flex flex-col gap-2">
            <div className="text-green-400 dark:text-green-400 text-lg">
              ✓ Provider registered successfully
            </div>
            <div className="font-mono text-xs break-all p-3 bg-white/5 dark:bg-black/5 rounded-md">
              {mintedProviderAddress}
            </div>
            {onClose && (
              <button
                onClick={onClose}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Continue to Dashboard
              </button>
            )}
          </div>
        )}

        {/* Error Display */}
        {hasError && (
          <div className="text-red-400 p-4 bg-red-400/10 dark:bg-red-400/10 rounded-md text-sm">
            {mintError?.message}
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
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
    if (step === 'complete' && mintedProviderAddress) {
      console.log('🎉 Registration complete! TBA:', mintedProviderAddress);
      
      // Auto-close after showing success briefly
      if (onClose) {
        const timer = setTimeout(() => {
          onClose();
        }, 2000); // Show success for 2 seconds then close
        
        return () => clearTimeout(timer);
      }
    }
  }, [step, mintedProviderAddress, onClose]);

  if (!isVisible) return null;

  const isLoading = isMinting || isSettingNotes || isMintTxLoading || isNotesTxLoading;
  const hasError = !!(mintError || notesError);

  return (
    <div style={{
      position: 'absolute',
      top: '-20px',
      left: '-25px',
      right: '-25px',
      bottom: '-25px',
      backgroundColor: 'rgba(0, 0, 0, 0.9)',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      zIndex: 1000,
      borderRadius: '12px',
      padding: '20px'
    }}>
      <div style={{
        backgroundColor: '#1a1a1a',
        padding: '40px',
        borderRadius: '12px',
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)',
        maxWidth: '400px',
        width: '100%',
        textAlign: 'center'
      }}>
        <h3 style={{ 
          color: '#fff', 
          marginBottom: '30px',
          fontSize: '1.5rem',
          fontWeight: '500'
        }}>
          Blockchain Registration
        </h3>
        
        {/* Progress Steps */}
        <div style={{ 
          marginBottom: '30px',
          display: 'flex',
          justifyContent: 'center',
          gap: '40px'
        }}>
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
        <div style={{ 
          color: '#888', 
          marginBottom: '20px',
          fontSize: '0.9rem'
        }}>
          {step === 'minting' && 'Creating provider entry on blockchain...'}
          {step === 'notes' && 'Setting provider metadata...'}
          {step === 'complete' && 'Registration complete!'}
        </div>

        {/* Loading Indicator */}
        {isLoading && !hasError && (
          <div style={{ marginBottom: '20px' }}>
            <div style={{
              width: '40px',
              height: '40px',
              margin: '0 auto',
              border: '3px solid #333',
              borderTopColor: '#4ade80',
              borderRadius: '50%',
              // Removed animation
            }} />
          </div>
        )}

        {/* Success State */}
        {step === 'complete' && mintedProviderAddress && (
          <div style={{ marginTop: '20px' }}>
            <div style={{ 
              color: '#4ade80',
              marginBottom: '10px',
              fontSize: '1.1rem'
            }}>
              ✓ Provider registered successfully
            </div>
            <div style={{ 
              fontFamily: 'monospace', 
              fontSize: '0.8rem',
              color: '#666',
              wordBreak: 'break-all',
              padding: '10px',
              backgroundColor: 'rgba(255, 255, 255, 0.05)',
              borderRadius: '6px',
              marginBottom: '15px'
            }}>
              {mintedProviderAddress}
            </div>
            {onClose && (
              <button
                onClick={onClose}
                style={{
                  padding: '10px 20px',
                  backgroundColor: '#4ade80',
                  color: '#000',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: '500',
                  fontSize: '0.9rem'
                }}
              >
                Continue to Dashboard
              </button>
            )}
          </div>
        )}
        
        {/* Error Display */}
        {hasError && (
          <div style={{ 
            color: '#ef4444', 
            marginTop: '20px',
            padding: '15px',
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            borderRadius: '6px',
            fontSize: '0.9rem'
          }}>
            {(mintError || notesError)?.message}
          </div>
        )}
      </div>
      
      <style>
        {`
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}
      </style>
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
  <div style={{
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '8px'
  }}>
    <div style={{
      width: '40px',
      height: '40px',
      borderRadius: '50%',
      backgroundColor: isComplete ? '#4ade80' : isActive ? '#3b82f6' : '#333',
      color: isComplete || isActive ? '#fff' : '#666',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontWeight: 'bold',
      transition: 'all 0.3s ease',
      position: 'relative'
    }}>
      {isComplete ? '✓' : number}
    </div>
    <span style={{ 
      fontSize: '0.8rem', 
      color: isComplete ? '#4ade80' : isActive ? '#fff' : '#666',
      transition: 'color 0.3s ease'
    }}>
      {label}
    </span>
  </div>
);

export default ProviderRegistrationOverlay; 
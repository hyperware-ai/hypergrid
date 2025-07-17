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
}) => {
  if (!isVisible) return null;

  const isLoading = isMinting || isSettingNotes || isMintTxLoading || isNotesTxLoading;
  const hasError = !!(mintError || notesError);

  return (
    <div style={{
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.9)',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      zIndex: 1000,
      borderRadius: '8px',
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
              animation: 'spin 0.8s linear infinite'
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
              borderRadius: '6px'
            }}>
              {mintedProviderAddress}
            </div>
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
      width: '32px',
      height: '32px',
      borderRadius: '50%',
      backgroundColor: isComplete ? '#4ade80' : isActive ? '#3b82f6' : '#333',
      border: `2px solid ${isComplete ? '#4ade80' : isActive ? '#3b82f6' : '#444'}`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: '0.9rem',
      fontWeight: '600',
      color: isComplete || isActive ? '#fff' : '#666',
      transition: 'all 0.3s ease'
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
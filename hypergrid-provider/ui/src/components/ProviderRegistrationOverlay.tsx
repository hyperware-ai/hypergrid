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
  currentNoteIndex,
  mintedProviderAddress,
  isMinting,
  isSettingNotes,
  isMintTxLoading,
  isNotesTxLoading,
  mintError,
  notesError,
}) => {
  if (!isVisible) return null;

  const statusText = getRegistrationStepText(
    step,
    currentNoteIndex,
    isMinting,
    isSettingNotes,
    isMintTxLoading,
    isNotesTxLoading
  );

  // Fun animation components
  const MintingAnimation = () => (
    <div style={{ fontSize: '40px', marginBottom: '10px' }}>
      <span style={{ 
        display: 'inline-block', 
        animation: 'hammer 0.8s ease-in-out infinite' 
      }}>🔨</span>
      <span style={{ marginLeft: '10px', marginRight: '10px' }}>⚒️</span>
      <span style={{ 
        display: 'inline-block', 
        animation: 'forge 1s ease-in-out infinite' 
      }}>🔥</span>
    </div>
  );

  const NotesAnimation = () => (
    <div style={{ fontSize: '35px', marginBottom: '10px' }}>
      <span style={{ 
        display: 'inline-block', 
        animation: 'stamp 1.2s ease-in-out infinite' 
      }}>📝</span>
      <span style={{ marginLeft: '8px', marginRight: '8px' }}>✏️</span>
      <span style={{ 
        display: 'inline-block', 
        animation: 'paperWork 1.5s ease-in-out infinite' 
      }}>📋</span>
    </div>
  );

  const CompleteAnimation = () => (
    <div style={{ fontSize: '50px', marginBottom: '10px' }}>
      <span style={{ 
        display: 'inline-block', 
        animation: 'celebrate 0.6s ease-in-out infinite' 
      }}>🎉</span>
      <span style={{ marginLeft: '10px', marginRight: '10px' }}>✨</span>
      <span style={{ 
        display: 'inline-block', 
        animation: 'celebrate 0.8s ease-in-out infinite reverse' 
      }}>🚀</span>
    </div>
  );

  return (
    <div style={{
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      zIndex: 1000,
      borderRadius: '8px',
      padding: '20px'
    }}>
      <h2 style={{ color: 'white', marginBottom: '20px' }}>
        Blockchain Registration
      </h2>
      
      {/* Fun Animations based on step */}
      {step === 'minting' && <MintingAnimation />}
      {step === 'notes' && <NotesAnimation />}
      {step === 'complete' && <CompleteAnimation />}
      
      <div style={{ color: 'white', textAlign: 'center' }}>
        {/* Status Text */}
        <div style={{ whiteSpace: 'pre-line', marginBottom: '20px' }}>
          {statusText}
        </div>
        
        {/* Provider Address (when complete) */}
        {step === 'complete' && mintedProviderAddress && (
          <>
            <div style={{ marginTop: '10px' }}>Provider registered at:</div>
            <div style={{ 
              fontFamily: 'monospace', 
              marginTop: '5px',
              padding: '8px',
              backgroundColor: 'rgba(255, 255, 255, 0.1)',
              borderRadius: '4px',
              wordBreak: 'break-all'
            }}>
              {mintedProviderAddress}
            </div>
          </>
        )}
        
        {/* Error Display */}
        {(mintError || notesError) && (
          <div style={{ 
            color: '#ff6b6b', 
            marginTop: '20px',
            padding: '10px',
            backgroundColor: 'rgba(255, 107, 107, 0.1)',
            borderRadius: '4px'
          }}>
            <strong>Error:</strong> {(mintError || notesError)?.message}
          </div>
        )}
        
        {/* Progress Indicator */}
        {(step === 'minting' || step === 'notes' || step === 'complete') && (
          <div style={{ marginTop: '20px' }}>
            <div style={{ marginBottom: '10px' }}>Progress:</div>
            <div style={{ 
              display: 'flex', 
              gap: '15px', 
              justifyContent: 'center',
              alignItems: 'center'
            }}>
              {/* Step 1: Minting */}
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '5px'
              }}>
                <div style={{
                  width: '30px',
                  height: '30px',
                  borderRadius: '50%',
                  backgroundColor: step === 'complete' || step === 'notes' ? '#4ade80' : 
                                 step === 'minting' ? '#fbbf24' : 
                                 'rgba(255, 255, 255, 0.3)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '14px',
                  fontWeight: 'bold',
                  color: step === 'complete' || step === 'notes' ? '#000' : '#fff'
                }}>
                  {step === 'complete' || step === 'notes' ? '✓' : '1'}
                </div>
                <div style={{ fontSize: '12px', color: 'white', textAlign: 'center' }}>
                  Mint Provider
                </div>
              </div>

              {/* Arrow */}
              <div style={{ color: 'white', fontSize: '20px' }}>→</div>

              {/* Step 2: Notes */}
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '5px'
              }}>
                <div style={{
                  width: '30px',
                  height: '30px',
                  borderRadius: '50%',
                  backgroundColor: step === 'complete' ? '#4ade80' : 
                                 step === 'notes' ? '#fbbf24' : 
                                 'rgba(255, 255, 255, 0.3)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '14px',
                  fontWeight: 'bold',
                  color: step === 'complete' ? '#000' : 
                           step === 'notes' ? '#000' : '#fff'
                }}>
                  {step === 'complete' ? '✓' : '2'}
                </div>
                <div style={{ fontSize: '12px', color: 'white', textAlign: 'center' }}>
                  Set Metadata
                </div>
              </div>
            </div>
          </div>
        )}
        
        {/* Fun Loading Animation */}
        {(isMinting || isSettingNotes || isMintTxLoading || isNotesTxLoading) && (
          <div style={{ 
            marginTop: '20px',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            gap: '10px'
          }}>
            <div style={{
              fontSize: '25px',
              animation: 'spin 2s linear infinite'
            }}>⚙️</div>
            <div style={{
              fontSize: '20px',
              animation: 'spin 1.5s linear infinite reverse'
            }}>🔧</div>
            <div style={{
              fontSize: '25px',
              animation: 'spin 1.8s linear infinite'
            }}>⚙️</div>
          </div>
        )}
      </div>
      
      <style>
        {`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
          
          @keyframes hammer {
            0%, 100% { transform: translateY(0) rotate(-10deg); }
            50% { transform: translateY(-8px) rotate(-25deg); }
          }
          
          @keyframes forge {
            0%, 100% { transform: scale(1) rotate(-2deg); opacity: 0.8; }
            25% { transform: scale(1.1) rotate(2deg); opacity: 1; }
            50% { transform: scale(0.95) rotate(-1deg); opacity: 0.9; }
            75% { transform: scale(1.05) rotate(1deg); opacity: 1; }
          }
          
          @keyframes stamp {
            0%, 100% { transform: translateY(0) rotate(0deg); }
            30% { transform: translateY(-5px) rotate(-2deg); }
            60% { transform: translateY(3px) rotate(1deg); }
          }
          
          @keyframes paperWork {
            0%, 100% { transform: rotate(-1deg) translateX(0); }
            25% { transform: rotate(1deg) translateX(2px); }
            50% { transform: rotate(-0.5deg) translateX(-1px); }
            75% { transform: rotate(0.5deg) translateX(1px); }
          }
          
          @keyframes celebrate {
            0%, 100% { transform: translateY(0) scale(1) rotate(0deg); }
            25% { transform: translateY(-10px) scale(1.1) rotate(-5deg); }
            50% { transform: translateY(-5px) scale(1.05) rotate(5deg); }
            75% { transform: translateY(-8px) scale(1.08) rotate(-3deg); }
          }
        `}
      </style>
    </div>
  );
};

export default ProviderRegistrationOverlay; 
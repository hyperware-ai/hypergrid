import React from 'react';
import { RegisteredProvider } from '../types/hypergrid_provider';

export interface ProviderInfoDisplayProps {
  provider: RegisteredProvider;
}

const USDC_DECIMALS = 6; // Assuming 6 decimals for USDC

const ProviderInfoDisplay: React.FC<ProviderInfoDisplayProps> = ({ provider }) => {
  const sharedBaseStyle: React.CSSProperties = {
    fontFamily: 'monospace',
    fontSize: '0.9em',
    color: 'var(--text-color)', // Use theme text color
  };

  // Styles adapted from ProviderMetadataForm.tsx
  const containerStyle: React.CSSProperties = {
    ...sharedBaseStyle,
    padding: '10px 15px', // Slightly less padding than the form
    border: '1px solid var(--card-border)', 
    background: 'var(--card-bg)',
    // marginBottom: '10px', // Margin will be handled by the list item in App.tsx
    position: 'relative',
    borderRadius: '6px',
  };

  const hnsNameStyle: React.CSSProperties = { 
    ...sharedBaseStyle, 
    color: 'var(--heading-color)', // Use theme heading color
    marginBottom: '8px', 
    fontSize: '1.05em', 
    fontWeight: 'bold', 
    textAlign: 'left' 
  };

  const copyButtonStyle: React.CSSProperties = {
    position: 'absolute',
    top: '8px',
    right: '8px',
    padding: '3px 6px',
    fontSize: '0.7em',
    backgroundColor: 'var(--button-secondary-bg)', 
    color: 'var(--button-secondary-text)', 
    border: '1px solid var(--input-border)',
    borderRadius: '4px',
    cursor: 'pointer',
    zIndex: 1,
  };

  const treeLineStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'baseline',
    minHeight: '1.5em', 
    marginBottom: '1px',   
    paddingLeft: '10px', // Adjusted indent for display component   
  };

  const treeCharSpanStyle: React.CSSProperties = { 
    color: 'var(--text-color)', // Use theme text color, maybe slightly muted
    opacity: 0.7,
    minWidth: '25px',      
    marginRight: '5px',    
    whiteSpace: 'pre',      
    textAlign: 'left',
    flexShrink: 0,
  };

  const fieldLabelStyle: React.CSSProperties = {
    color: 'var(--text-color)', // Use theme text color
    opacity: 0.8,
    marginRight: '5px',
    minWidth: '120px', // Adjusted for potentially shorter labels or consistency     
    whiteSpace: 'pre',
    flexShrink: 0,
    fontWeight: '500',
  };
  
  const displayValueStyle: React.CSSProperties = { 
    ...sharedBaseStyle,
    color: 'var(--text-color)', // Use theme text color
    flexGrow: 1,
    wordBreak: 'break-all', // Prevent overflow for long values like wallet addresses
  };
  
  const trunkConnectorStyle: React.CSSProperties = {
    ...treeLineStyle,
    minHeight: '0.7em', 
    marginBottom: '1px',
  };

  const formatPrice = (priceU64: number) => {
    if (typeof priceU64 !== 'number') return 'N/A';
    const divisor = Math.pow(10, USDC_DECIMALS);
    // Show 2 decimal places for typical display, but ensure it's not NaN
    const value = (priceU64 / divisor);
    return isNaN(value) ? 'N/A' : value.toFixed(2); 
  };

  const handleCopyProviderMetadata = async () => {
    const hnsName = (provider.provider_name.trim() || "[ProviderName]") + ".grid-beta.hypr";
    const metadataFields = {
      "~provider-name": provider.provider_name,
      "~provider-id": provider.provider_id,
      "~wallet": provider.registered_provider_wallet,
      "~price": provider.price, // Copy the raw u64 price
      "~description": provider.description,
    };
    const structuredDataToCopy = {
      [hnsName]: metadataFields,
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(structuredDataToCopy, null, 2));
      alert(`Metadata for '${provider.provider_name}' copied!`);
    } catch (err) {
      console.error('Failed to copy metadata: ', err);
      alert('Failed to copy metadata.');
    }
  };

  return (
    <div style={containerStyle}>
      <button onClick={handleCopyProviderMetadata} style={copyButtonStyle} title="Copy Metadata">📋 Copy</button>
      
      <div style={hnsNameStyle}>{(provider.provider_name.trim() || "[ProviderName]") + ".grid-beta.hypr"}</div>

      <div style={trunkConnectorStyle}><span style={treeCharSpanStyle}>│</span></div>

      <div style={treeLineStyle}>
        <span style={treeCharSpanStyle}>├─</span>
        <span style={fieldLabelStyle}>~provider-id:</span>
        <span style={displayValueStyle}>{provider.provider_id ? provider.provider_id.substring(0,10) + '...' : 'N/A'}</span>
      </div>
      
      <div style={trunkConnectorStyle}><span style={treeCharSpanStyle}>│</span></div>

      <div style={treeLineStyle}>
        <span style={treeCharSpanStyle}>├─</span>
        <span style={fieldLabelStyle}>~wallet:</span>
        <span style={displayValueStyle}>{provider.registered_provider_wallet}</span>
      </div>

      <div style={trunkConnectorStyle}><span style={treeCharSpanStyle}>│</span></div>
      
      <div style={treeLineStyle}>
        <span style={treeCharSpanStyle}>├─</span>
        <span style={fieldLabelStyle}>~price:</span>
        <span style={displayValueStyle}>{formatPrice(provider.price)} USDC</span>
      </div>

      <div style={trunkConnectorStyle}><span style={treeCharSpanStyle}>│</span></div>

      <div style={{...treeLineStyle, alignItems: 'flex-start'}}>
        <span style={treeCharSpanStyle}>├─</span>
        <span style={{...fieldLabelStyle, paddingTop: '1px'}}>~description:</span>
        <span style={displayValueStyle}>{provider.description || "No description."}</span>
      </div>
    </div>
  );
};

export default ProviderInfoDisplay; 
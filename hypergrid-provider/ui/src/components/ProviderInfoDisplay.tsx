import React, { useState } from 'react';
import { RegisteredProvider } from '../types/hypergrid_provider';
import { 
  populateFormFromProvider, 
  buildUpdateProviderPayload, 
  validateProviderConfig,
  processUpdateResponse,
  ProviderFormData 
} from '../utils/providerFormUtils';
import { updateProviderApi } from '../utils/api';

export interface ProviderInfoDisplayProps {
  provider: RegisteredProvider;
  onProviderUpdated?: (updatedProvider: RegisteredProvider) => void;
}

const USDC_DECIMALS = 6; // Assuming 6 decimals for USDC

const ProviderInfoDisplay: React.FC<ProviderInfoDisplayProps> = ({ provider, onProviderUpdated }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState<Partial<ProviderFormData>>(() => 
    populateFormFromProvider(provider)
  );

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
    const value = (priceU64 / divisor);
    if (isNaN(value)) return 'N/A';
    
    // For small values, show more decimal places to avoid showing 0.00
    if (value < 0.01) {
      return value.toFixed(6); // Show up to 6 decimal places for small values
    } else {
      return value.toFixed(2); // Show 2 decimal places for typical values
    }
  };

  const handleCopyProviderMetadata = async () => {
    const hnsName = (provider.provider_name.trim() || "[ProviderName]") + ".grid-beta.hypr";
    const metadataFields = {
      "~provider-name": provider.provider_name,
      "~provider-id": provider.provider_id,
      "~wallet": provider.registered_provider_wallet,
      "~price": provider.price, // Copy the raw u64 price
      "~description": provider.description,
      "~instructions": provider.instructions,
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

  const handleEdit = () => {
    setIsEditing(true);
  };

  const handleSave = async () => {
    // Ensure we have complete form data
    const completeFormData = { ...populateFormFromProvider(provider), ...formData } as ProviderFormData;
    
    const validationResult = validateProviderConfig(completeFormData);
    if (!validationResult.isValid) {
      alert(validationResult.error);
      return;
    }
    
    try {
      const updatedProvider = buildUpdateProviderPayload(completeFormData);
      const response = await updateProviderApi(provider.provider_name, updatedProvider);
      const feedback = processUpdateResponse(response);
      
      if (response.Ok) {
        onProviderUpdated?.(response.Ok);
        setIsEditing(false);
        alert(feedback.message);
      } else {
        alert(feedback.message);
      }
    } catch (err) {
      console.error('Failed to update provider: ', err);
      alert('Failed to update provider.');
    }
  };

  const handleCancel = () => {
    setIsEditing(false);
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

      <div style={trunkConnectorStyle}><span style={treeCharSpanStyle}>│</span></div>

      <div style={{...treeLineStyle, alignItems: 'flex-start'}}>
        <span style={treeCharSpanStyle}>└─</span>
        <span style={{...fieldLabelStyle, paddingTop: '1px'}}>~instructions:</span>
        <span style={displayValueStyle}>{provider.instructions || "No instructions."}</span>
      </div>

      {isEditing && (
        <div style={{ marginTop: '10px', padding: '10px', border: '1px solid var(--card-border)', borderRadius: '6px', backgroundColor: 'var(--card-bg)' }}>
          <h4 style={{ margin: '0 0 10px 0', color: 'var(--heading-color)' }}>Edit Provider</h4>
          
          <div style={{ marginBottom: '10px' }}>
            <label style={{ display: 'block', marginBottom: '5px', color: 'var(--text-color)', fontSize: '0.9em' }}>
              Wallet Address:
            </label>
            <input
              type="text"
              value={formData.registeredProviderWallet || ''}
              onChange={(e) => setFormData({ ...formData, registeredProviderWallet: e.target.value })}
              style={{ 
                width: '100%', 
                padding: '5px', 
                fontSize: '0.9em',
                backgroundColor: 'var(--input-bg)',
                color: 'var(--text-color)',
                border: '1px solid var(--input-border)',
                borderRadius: '4px'
              }}
            />
          </div>

          <div style={{ marginBottom: '10px' }}>
            <label style={{ display: 'block', marginBottom: '5px', color: 'var(--text-color)', fontSize: '0.9em' }}>
              Price (USDC):
            </label>
            <input
              type="text"
              value={formData.price || ''}
              onChange={(e) => setFormData({ ...formData, price: e.target.value })}
              placeholder="e.g., 0.01"
              style={{ 
                width: '100%', 
                padding: '5px', 
                fontSize: '0.9em',
                backgroundColor: 'var(--input-bg)',
                color: 'var(--text-color)',
                border: '1px solid var(--input-border)',
                borderRadius: '4px'
              }}
            />
          </div>

          <div style={{ marginBottom: '10px' }}>
            <label style={{ display: 'block', marginBottom: '5px', color: 'var(--text-color)', fontSize: '0.9em' }}>
              Description:
            </label>
            <textarea
              value={formData.providerDescription || ''}
              onChange={(e) => setFormData({ ...formData, providerDescription: e.target.value })}
              rows={3}
              style={{ 
                width: '100%', 
                padding: '5px', 
                fontSize: '0.9em',
                backgroundColor: 'var(--input-bg)',
                color: 'var(--text-color)',
                border: '1px solid var(--input-border)',
                borderRadius: '4px',
                resize: 'vertical'
              }}
            />
          </div>

          <div style={{ marginBottom: '10px' }}>
            <label style={{ display: 'block', marginBottom: '5px', color: 'var(--text-color)', fontSize: '0.9em' }}>
              Instructions:
            </label>
            <textarea
              value={formData.instructions || ''}
              onChange={(e) => setFormData({ ...formData, instructions: e.target.value })}
              rows={3}
              style={{ 
                width: '100%', 
                padding: '5px', 
                fontSize: '0.9em',
                backgroundColor: 'var(--input-bg)',
                color: 'var(--text-color)',
                border: '1px solid var(--input-border)',
                borderRadius: '4px',
                resize: 'vertical'
              }}
            />
          </div>

          <div style={{ marginTop: '15px' }}>
            <button onClick={handleSave} style={{ marginRight: '10px', padding: '5px 10px', backgroundColor: 'var(--button-primary-bg)', color: 'var(--button-primary-text)', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
              Save Changes
            </button>
            <button onClick={handleCancel} style={{ padding: '5px 10px', backgroundColor: 'var(--button-secondary-bg)', color: 'var(--button-secondary-text)', border: '1px solid var(--input-border)', borderRadius: '4px', cursor: 'pointer' }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {!isEditing && (
        <button onClick={handleEdit} style={{ marginTop: '10px', padding: '5px 10px', backgroundColor: 'var(--button-secondary-bg)', color: 'var(--button-secondary-text)', border: '1px solid var(--input-border)', borderRadius: '4px', cursor: 'pointer' }}>
          ✏️ Edit Provider
        </button>
      )}
    </div>
  );
};

export default ProviderInfoDisplay; 
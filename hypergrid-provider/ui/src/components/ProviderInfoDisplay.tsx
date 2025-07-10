import React from 'react';
import { RegisteredProvider } from '../types/hypergrid_provider';

export interface ProviderInfoDisplayProps {
  provider: RegisteredProvider;
  onProviderUpdated?: (updatedProvider: RegisteredProvider) => void;
  onEdit?: (provider: RegisteredProvider) => void;
}

const ProviderInfoDisplay: React.FC<ProviderInfoDisplayProps> = ({ provider, onProviderUpdated, onEdit }) => {

  const containerStyle: React.CSSProperties = {
    padding: '20px',
    border: '1px solid var(--card-border)', 
    background: 'var(--card-bg)',
    position: 'relative',
    borderRadius: '12px',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
  };

  const headerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '24px',
    paddingBottom: '16px',
    borderBottom: '2px solid var(--card-border)',
  };

  const providerNameStyle: React.CSSProperties = { 
    fontSize: '1.4em', 
    fontWeight: '600',
    color: 'var(--heading-color)',
    margin: 0,
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  };

  const statusBadgeStyle: React.CSSProperties = {
    backgroundColor: '#10B981',
    color: 'white',
    padding: '4px 12px',
    borderRadius: '12px',
    fontSize: '0.75em',
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  };

  const copyButtonStyle: React.CSSProperties = {
    padding: '8px 12px',
    fontSize: '0.85em',
    backgroundColor: 'var(--button-secondary-bg)', 
    color: 'var(--button-secondary-text)', 
    border: '1px solid var(--input-border)',
    borderRadius: '6px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    transition: 'all 0.2s ease',
  };

  const gridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
    gap: '20px',
    marginBottom: '20px',
  };

  const sectionStyle: React.CSSProperties = {
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    border: '1px solid var(--card-border)',
    borderRadius: '8px',
    padding: '16px',
  };

  const sectionTitleStyle: React.CSSProperties = {
    fontSize: '1.1em',
    fontWeight: '600',
    color: 'var(--heading-color)',
    marginBottom: '12px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  };

  const fieldRowStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '8px',
    minHeight: '24px',
  };

  const fieldLabelStyle: React.CSSProperties = {
    color: 'var(--text-color)',
    opacity: 0.7,
    fontSize: '0.9em',
    fontWeight: '500',
    minWidth: '100px',
    textTransform: 'capitalize',
  };
  
  const fieldValueStyle: React.CSSProperties = {
    color: 'var(--text-color)',
    fontSize: '0.9em',
    flex: 1,
    textAlign: 'right',
    wordBreak: 'break-all',
    fontFamily: 'monospace',
  };

  const longTextStyle: React.CSSProperties = {
    ...fieldValueStyle,
    textAlign: 'left',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    padding: '8px',
    borderRadius: '4px',
    marginTop: '4px',
    border: '1px solid var(--card-border)',
    fontSize: '0.85em',
    lineHeight: '1.4',
  };

  const formatPrice = (price: number) => {
    if (typeof price !== 'number') return 'N/A';
    if (isNaN(price)) return 'N/A';
    
    // For small values, show more decimal places to avoid showing 0.00
    if (price < 0.01) {
      return price.toFixed(6); // Show up to 6 decimal places for small values
    } else {
      return price.toFixed(2); // Show 2 decimal places for typical values
    }
  };

  const handleCopyProviderMetadata = async () => {
    const hnsName = (provider.provider_name.trim() || "[ProviderName]") + ".grid-beta.hypr";
    const metadata = {
      "~description": provider.description,
      "~instructions": provider.instructions,
      "~price": provider.price.toString(),
      "~wallet": provider.registered_provider_wallet,
      "~provider-id": provider.provider_id,
      "~site": provider.endpoint.base_url_template,
    };
    const structuredDataToCopy = {
      [hnsName]: metadata,
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
    onEdit?.(provider);
  };

  return (
    <div style={containerStyle}>
      {/* Header with provider name and actions */}
      <div style={headerStyle}>
        <div>
          <h3 style={providerNameStyle}>
            🔌 {provider.provider_name}.grid-beta.hypr
            <span style={statusBadgeStyle}>Active</span>
          </h3>
        </div>
        <button onClick={handleCopyProviderMetadata} style={copyButtonStyle} title="Copy Metadata">
          📋 Copy Metadata
        </button>
      </div>

      {/* Main content grid */}
      <div style={gridStyle}>
        {/* Basic Information */}
        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>
            ℹ️ Basic Information
          </div>
          <div style={fieldRowStyle}>
            <span style={fieldLabelStyle}>Provider ID:</span>
            <span style={fieldValueStyle}>{provider.provider_id ? provider.provider_id.substring(0,12) + '...' : 'N/A'}</span>
          </div>
          <div style={fieldRowStyle}>
            <span style={fieldLabelStyle}>Wallet:</span>
            <span style={fieldValueStyle}>{provider.registered_provider_wallet}</span>
          </div>
          <div style={fieldRowStyle}>
            <span style={fieldLabelStyle}>Price:</span>
            <span style={fieldValueStyle}>{formatPrice(provider.price)} USDC</span>
          </div>
        </div>

        {/* API Configuration */}
        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>
            🔧 API Configuration
          </div>
          <div style={fieldRowStyle}>
            <span style={fieldLabelStyle}>Method:</span>
            <span style={fieldValueStyle}>{provider.endpoint.method}</span>
          </div>
          <div style={fieldRowStyle}>
            <span style={fieldLabelStyle}>Structure:</span>
            <span style={fieldValueStyle}>{provider.endpoint.request_structure.replace(/([A-Z])/g, ' $1').trim()}</span>
          </div>
          <div style={fieldRowStyle}>
            <span style={fieldLabelStyle}>Base URL:</span>
          </div>
          <div style={longTextStyle}>{provider.endpoint.base_url_template}</div>
          
          {provider.endpoint.api_key && (
            <div style={fieldRowStyle}>
              <span style={fieldLabelStyle}>API Key:</span>
              <span style={fieldValueStyle}>••••••••{provider.endpoint.api_key.slice(-4)}</span>
            </div>
          )}
        </div>

        {/* Parameters */}
        {(provider.endpoint.path_param_keys?.length || 
          provider.endpoint.query_param_keys?.length || 
          provider.endpoint.header_keys?.length || 
          provider.endpoint.body_param_keys?.length) && (
          <div style={sectionStyle}>
            <div style={sectionTitleStyle}>
              📝 Parameters
            </div>
            {provider.endpoint.path_param_keys?.length > 0 && (
              <div style={fieldRowStyle}>
                <span style={fieldLabelStyle}>Path Params:</span>
                <span style={fieldValueStyle}>{provider.endpoint.path_param_keys.join(', ')}</span>
              </div>
            )}
            {provider.endpoint.query_param_keys?.length > 0 && (
              <div style={fieldRowStyle}>
                <span style={fieldLabelStyle}>Query Params:</span>
                <span style={fieldValueStyle}>{provider.endpoint.query_param_keys.join(', ')}</span>  
              </div>
            )}
            {provider.endpoint.header_keys?.length > 0 && (
              <div style={fieldRowStyle}>
                <span style={fieldLabelStyle}>Headers:</span>
                <span style={fieldValueStyle}>{provider.endpoint.header_keys.join(', ')}</span>
              </div>
            )}
            {provider.endpoint.body_param_keys?.length > 0 && (
              <div style={fieldRowStyle}>
                <span style={fieldLabelStyle}>Body Params:</span>
                <span style={fieldValueStyle}>{provider.endpoint.body_param_keys.join(', ')}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Description and Instructions */}
      {(provider.description || provider.instructions) && (
        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>
            📄 Documentation
          </div>
          {provider.description && (
            <>
              <div style={fieldRowStyle}>
                <span style={fieldLabelStyle}>Description:</span>
              </div>
              <div style={longTextStyle}>{provider.description}</div>
            </>
          )}
          {provider.instructions && (
            <>
              <div style={fieldRowStyle}>
                <span style={fieldLabelStyle}>Instructions:</span>
              </div>
              <div style={longTextStyle}>{provider.instructions}</div>
            </>
          )}
        </div>
      )}

      <button onClick={handleEdit} style={{ marginTop: '10px', padding: '8px 16px', backgroundColor: 'var(--button-primary-bg)', color: 'var(--button-primary-text)', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
        ✏️ Edit Provider
      </button>
    </div>
  );
};

export default ProviderInfoDisplay; 
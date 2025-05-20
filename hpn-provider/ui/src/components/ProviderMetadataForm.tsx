import React from 'react';

export interface ProviderMetadataFormProps {
  nodeId: string;
  providerName: string;
  setProviderName: (value: string) => void;
  providerDescription: string;
  setProviderDescription: (value: string) => void;
  registeredProviderWallet: string;
  setRegisteredProviderWallet: (value: string) => void;
  price: string;
  setPrice: (value: string) => void;
  onCopyMetadata: () => void;
}

const ProviderMetadataForm: React.FC<ProviderMetadataFormProps> = ({
  nodeId,
  providerName, setProviderName,
  providerDescription, setProviderDescription,
  registeredProviderWallet, setRegisteredProviderWallet,
  price, setPrice,
  onCopyMetadata,
}) => {
  const sharedBaseStyle: React.CSSProperties = {
    fontFamily: 'monospace',
    fontSize: '0.9em',
  };
  const containerStyle: React.CSSProperties = {
    ...sharedBaseStyle,
    padding: '15px',
    border: '1px solid #444',
    background: '#2a2a2a',
    marginBottom: '20px',
    position: 'relative',
  };
  const titleStyle: React.CSSProperties = { marginTop: 0, marginBottom: '15px', color: '#ccc', textAlign: 'left' };
  const hnsNameStyle: React.CSSProperties = { ...sharedBaseStyle, color: '#ccc', marginBottom: '5px', fontSize: '1.1em', fontWeight: 'bold', textAlign: 'left' };

  const copyButtonStyle: React.CSSProperties = {
    position: 'absolute',
    top: '10px',
    right: '10px',
    padding: '4px 8px',
    fontSize: '0.75em',
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
    minHeight: '1.6em',     // Ensures space for inputs
    marginBottom: '1px',    // Minimal space between lines of the tree
    paddingLeft: '20px',    // Common indent for the entire tree structure
  };

  const treeCharSpanStyle: React.CSSProperties = { // For the span holding │ or ├─
    color: '#777',
    minWidth: '30px',       // Ensures enough space for "├─ " prefix
    marginRight: '8px',     // Space after the tree character(s) before label
    whiteSpace: 'pre',      // Preserve spaces if used within the char string (e.g., "  │")
    textAlign: 'left',
    flexShrink: 0,
  };

  const fieldLabelStyle: React.CSSProperties = {
    color: '#aaa',
    marginRight: '5px',
    minWidth: '125px',      // Adjust as needed for longest label
    whiteSpace: 'pre',
    flexShrink: 0,
  };

  const inputStyle: React.CSSProperties = {
    ...sharedBaseStyle, // Inherit font family and base size
    background: 'transparent',
    color: '#eee',
    border: 'none',
    borderBottom: '1px dashed #666',
    padding: '2px 0px',
    flexGrow: 1,
    width: '100%', // Try to make it fill remaining space
  };
  
  const displayValueStyle: React.CSSProperties = { // Style for non-editable displayed values in the tree
    ...sharedBaseStyle,
    color: '#eee',
    padding: '2px 0px',
    flexGrow: 1,
    borderBottom: '1px dashed #444', // Slightly different border to indicate non-editable
  };

  const trunkConnectorStyle: React.CSSProperties = { // Specific style for the simple trunk lines
    ...treeLineStyle,
    minHeight: '0.8em', // Make trunk connectors shorter
    marginBottom: '1px',
  };
  return (
    <div style={containerStyle}>
      <button onClick={onCopyMetadata} style={copyButtonStyle} title="Copy Metadata">📋 Copy</button>
      <h4 style={titleStyle}>Provider Registration Mint Outline</h4>
      <div style={hnsNameStyle}>{(providerName.trim() || "[YourProviderName]") + ".hpn-beta.hypr"}</div>

      {/* Trunk line from HNS name down to the first branch */}
      <div style={trunkConnectorStyle}>
        <span style={treeCharSpanStyle}>│</span>
      </div>

      {/* Provider Name Input */}
      <div style={treeLineStyle}>
        <span style={treeCharSpanStyle}>├─</span>
        <label htmlFor="pform-providerName" style={{...fieldLabelStyle, textAlign: 'left'}}>~provider-name:</label>
        <input id="pform-providerName" type="text" value={providerName} onChange={(e) => setProviderName(e.target.value)} placeholder="Enter unique name" style={inputStyle} />
      </div>

      {/* Trunk Connector */}
      <div style={trunkConnectorStyle}>
        <span style={treeCharSpanStyle}>│</span>
      </div>
      
      {/* Provider ID (Node ID) Display */}
      <div style={{...treeLineStyle, textAlign: 'left'}}>
        <span style={treeCharSpanStyle}>├─</span>
        <span style={{...fieldLabelStyle, textAlign: 'left'}}>~provider-id:</span>
        <span style={displayValueStyle}>{nodeId || "(Node ID N/A)"}</span>
      </div>

      {/* Trunk Connector */}
      <div style={trunkConnectorStyle}>
        <span style={treeCharSpanStyle}>│</span>
      </div>

      {/* Wallet Input */}
      <div style={treeLineStyle}>
        <span style={treeCharSpanStyle}>├─</span>
        <label htmlFor="pform-wallet" style={{...fieldLabelStyle, textAlign: 'left'}}>~wallet:</label>
        <input id="pform-wallet" type="text" value={registeredProviderWallet} onChange={(e) => setRegisteredProviderWallet(e.target.value)} placeholder="0x... (ETH Address on Base)" style={inputStyle} />
      </div>

      {/* Trunk Connector */}
      <div style={trunkConnectorStyle}>
        <span style={treeCharSpanStyle}>│</span>
      </div>

      {/* Price Input */}
      <div style={treeLineStyle}>
        <span style={treeCharSpanStyle}>├─</span>
        <label htmlFor="pform-price" style={{...fieldLabelStyle, textAlign: 'left'}}>~price:</label>
        <input 
          id="pform-price" 
          type="text"
          value={price} 
          onChange={(e) => setPrice(e.target.value)} 
          placeholder="e.g., 0.01 (USDC)" 
          inputMode="decimal"
          pattern="[0-9]*\.?[0-9]*"
          style={inputStyle} 
        />
      </div>

      {/* Trunk Connector */}
      <div style={trunkConnectorStyle}>
        <span style={treeCharSpanStyle}>│</span>
      </div>

      {/* Description Input - Changed to textarea */}
      <div style={{...treeLineStyle, alignItems: 'flex-start'}}>
        <span style={treeCharSpanStyle}>├─</span>
        <label htmlFor="pform-description" style={{...fieldLabelStyle, textAlign: 'left', paddingTop: '2px'}}>~description:</label>
        <textarea 
          id="pform-description" 
          value={providerDescription} 
          onChange={(e) => setProviderDescription(e.target.value)} 
          placeholder="Purpose of this provider (can be multiple lines)" 
          rows={3}
          style={{...inputStyle, resize: 'vertical'}} 
        />
      </div>
      

    </div>
  );
};

export default ProviderMetadataForm; 
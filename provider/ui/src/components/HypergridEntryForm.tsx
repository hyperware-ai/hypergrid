import React from 'react';

export interface HypergridEntryFormProps {
  nodeId: string;
  providerName: string;
  setProviderName: (value: string) => void;
  providerDescription: string;
  setProviderDescription: (value: string) => void;
  instructions: string;
  setInstructions: (value: string) => void;
  registeredProviderWallet: string;
  setRegisteredProviderWallet: (value: string) => void;
  price: string;
  setPrice: (value: string) => void;
}

const HypergridEntryForm: React.FC<HypergridEntryFormProps> = ({
  nodeId,
  providerName, setProviderName,
  providerDescription, setProviderDescription,
  instructions, setInstructions,
  registeredProviderWallet, setRegisteredProviderWallet,
  price, setPrice,
}) => {
  // All tree styles moved to CSS classes in styles/02-components/tree.css
  return (
    <div className="tree-container">

      <h3 className="tree-title">Hypergrid Registration Form</h3>
      <div className="tree-hns-name">
          <input
            id="pform-providerName"
            type="text"
            value={providerName}
            onChange={(e) => setProviderName(e.target.value)}
            placeholder="provider-name"
            style={{
              fontFamily: 'monospace',
              fontSize: '1.1em',
              fontWeight: 'bold',
              background: 'transparent',
              color: '#eee',
              border: 'none',
              borderBottom: '1px dashed #666',
              padding: '1px 0px',
              outline: 'none',
              textAlign: 'left',
              width: `${providerName.length || 13}ch`, // Use actual length or placeholder length
            }}
          />
        <span>.obfusc-grid123.hypr</span>
      </div>

      {/* Trunk line from HNS name down to the first branch */}
      <div style={{display: 'flex', alignItems: 'baseline', minHeight: '0.8em', marginBottom: '1px', paddingLeft: '5px'}}>
        <span style={{color: '#777', minWidth: '20px', marginRight: '4px', whiteSpace: 'pre', textAlign: 'left', flexShrink: 0}}>│</span>
      </div>
      
      {/* Provider ID (Node ID) Display */}
      <div style={{display: 'flex', alignItems: 'baseline', minHeight: '1.6em', marginBottom: '1px', paddingLeft: '5px', textAlign: 'left'}}>
        <span style={{color: '#777', minWidth: '20px', marginRight: '1px', whiteSpace: 'pre', textAlign: 'left', flexShrink: 0}}>├─</span>
        <span style={{color: '#aaa', minWidth: '105px', whiteSpace: 'pre', flexShrink: 0, textAlign: 'left'}}>~provider-id:</span>
        <span style={{fontFamily: 'monospace', fontSize: '0.9em', color: '#eee', padding: '2px 0px', flexGrow: 1, borderBottom: '1px dashed #444'}}>{nodeId || "(Node ID N/A)"}</span>
      </div>

      {/* Trunk Connector */}
      <div style={{display: 'flex', alignItems: 'baseline', minHeight: '0.8em', marginBottom: '1px', paddingLeft: '5px'}}>
        <span style={{color: '#777', minWidth: '20px', marginRight: '4px', whiteSpace: 'pre', textAlign: 'left', flexShrink: 0}}>│</span>
      </div>

      {/* Wallet Input */}
      <div style={{display: 'flex', alignItems: 'baseline', minHeight: '1.6em', marginBottom: '1px', paddingLeft: '5px'}}>
        <span style={{color: '#777', minWidth: '20px', marginRight: '1px', whiteSpace: 'pre', textAlign: 'left', flexShrink: 0}}>├─</span>
        <label htmlFor="pform-wallet" style={{color: '#aaa', minWidth: '105px', whiteSpace: 'pre', flexShrink: 0, textAlign: 'left'}}>~wallet:</label>
        <input id="pform-wallet" type="text" value={registeredProviderWallet} onChange={(e) => setRegisteredProviderWallet(e.target.value)} placeholder="0x... (ETH Address on Base)" style={{fontFamily: 'monospace', fontSize: '0.9em', background: 'transparent', color: '#eee', border: 'none', borderBottom: '1px dashed #666', padding: '2px 0px', flexGrow: 1, width: '100%'}} />
      </div>

      {/* Trunk Connector */}
      <div style={{display: 'flex', alignItems: 'baseline', minHeight: '0.8em', marginBottom: '1px', paddingLeft: '5px'}}>
        <span style={{color: '#777', minWidth: '20px', marginRight: '4px', whiteSpace: 'pre', textAlign: 'left', flexShrink: 0}}>│</span>
      </div>

      {/* Price Input */}
      <div style={{display: 'flex', alignItems: 'baseline', minHeight: '1.6em', marginBottom: '1px', paddingLeft: '5px'}}>
        <span style={{color: '#777', minWidth: '20px', marginRight: '1px', whiteSpace: 'pre', textAlign: 'left', flexShrink: 0}}>├─</span>
        <label htmlFor="pform-price" style={{color: '#aaa', minWidth: '105px', whiteSpace: 'pre', flexShrink: 0, textAlign: 'left'}}>~price:</label>
        <input 
          id="pform-price" 
          type="text"
          value={price} 
          onChange={(e) => setPrice(e.target.value)} 
          placeholder="e.g., 0.01 (USDC)" 
          inputMode="decimal"
          pattern="[0-9]*\.?[0-9]*"
          style={{fontFamily: 'monospace', fontSize: '0.9em', background: 'transparent', color: '#eee', border: 'none', borderBottom: '1px dashed #666', padding: '2px 0px', flexGrow: 1, width: '100%'}} 
        />
      </div>

      {/* Trunk Connector */}
      <div style={{display: 'flex', alignItems: 'baseline', minHeight: '0.8em', marginBottom: '1px', paddingLeft: '5px'}}>
        <span style={{color: '#777', minWidth: '20px', marginRight: '4px', whiteSpace: 'pre', textAlign: 'left', flexShrink: 0}}>│</span>
      </div>

      {/* Description Input - Changed to textarea */}
      <div style={{display: 'flex', alignItems: 'flex-start', minHeight: '1.6em', marginBottom: '1px', paddingLeft: '5px'}}>
        <span style={{color: '#777', minWidth: '20px', marginRight: '1px', whiteSpace: 'pre', textAlign: 'left', flexShrink: 0}}>├─</span>
        <label htmlFor="pform-description" style={{color: '#aaa', minWidth: '105px', whiteSpace: 'pre', flexShrink: 0, textAlign: 'left', paddingTop: '2px'}}>~description:</label>
        <textarea 
          id="pform-description" 
          value={providerDescription} 
          onChange={(e) => setProviderDescription(e.target.value)} 
          placeholder="Purpose of this provider (can be multiple lines)" 
          rows={3}
          style={{fontFamily: 'monospace', fontSize: '0.9em', background: 'transparent', color: '#eee', border: 'none', borderBottom: '1px dashed #666', padding: '2px 0px', flexGrow: 1, width: '100%', resize: 'vertical', height: 'var(--form-textarea-height)'}} 
        />
      </div>

      {/* Trunk Connector */}
      <div style={{display: 'flex', alignItems: 'baseline', minHeight: '0.8em', marginBottom: '1px', paddingLeft: '5px'}}>
        <span style={{color: '#777', minWidth: '20px', marginRight: '1px', whiteSpace: 'pre', textAlign: 'left', flexShrink: 0}}>│</span>
      </div>
      
      {/* Instructions Input */}
      <div style={{display: 'flex', alignItems: 'flex-start', minHeight: '1.6em', marginBottom: '1px', paddingLeft: '5px'}}>
        <span style={{color: '#777', minWidth: '20px', marginRight: '1px', whiteSpace: 'pre', textAlign: 'left', flexShrink: 0}}>├─</span>
          <label htmlFor="pform-instructions" style={{color: '#aaa', minWidth: '105px', whiteSpace: 'pre', flexShrink: 0, textAlign: 'left', paddingTop: '0px'}}>~instructions:</label>
        <textarea 
          id="pform-instructions" 
          value={instructions} 
          onChange={(e) => setInstructions(e.target.value)} 
          placeholder="Instructions for the provider" 
          rows={3}
          style={{fontFamily: 'monospace', fontSize: '0.9em', background: 'transparent', color: '#eee', border: 'none', borderBottom: '1px dashed #666', padding: '2px 0px', flexGrow: 1, width: '100%', resize: 'vertical', height: 'var(--form-textarea-height)'}} 
        />
      </div>

    </div>
  );
};

export default HypergridEntryForm; 
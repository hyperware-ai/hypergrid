import React, { useState } from 'react';
import { TopLevelRequestType, AuthChoice } from '../App'; // Assuming types are exported from App.tsx or moved to a types file

// Props interface for APIConfigForm
export interface APIConfigFormProps {
  // nodeId: string; // Removed, handled by ProviderMetadataForm
  topLevelRequestType: TopLevelRequestType;
  setTopLevelRequestType: (value: TopLevelRequestType) => void;
  
  authChoice: AuthChoice;
  setAuthChoice: (value: AuthChoice) => void;
  
  apiKeyQueryParamName: string;
  setApiKeyQueryParamName: (value: string) => void;
  
  apiKeyHeaderName: string;
  setApiKeyHeaderName: (value: string) => void;
  
  endpointApiParamKey: string;
  setEndpointApiKey: (value: string) => void;
  
  providerName: string; // Keep for endpointName logic
  // setProviderName: (value: string) => void; // Removed setter if not directly changed here
  
  // providerDescription: string; // Removed
  // setProviderDescription: (value: string) => void; // Removed
  
  endpointBaseUrl: string;
  setEndpointBaseUrl: (value: string) => void;
  
  pathParamKeys: string[];
  setPathParamKeys: (keys: string[]) => void;
  
  queryParamKeys: string[];
  setQueryParamKeys: (keys: string[]) => void;
  
  headerKeys: string[];
  setHeaderKeys: (keys: string[]) => void;
  
  bodyKeys: string[];
  setBodyKeys: (keys: string[]) => void;
  
  // registeredProviderWallet: string; // Removed
  // setRegisteredProviderWallet: (value: string) => void; // Removed

  // price: string; // Removed
  // setPrice: (value: string) => void; // Removed

  apiCallFormatSelected: boolean;
  setApiCallFormatSelected: (value: boolean) => void;
  onRegisterProvider: () => void;
  submitButtonText?: string; // Optional prop for button text
  showSubmitButton?: boolean; // Optional prop to control button visibility
  isWalletConnected?: boolean; // Optional prop to control button enabled state 
}

const APIConfigForm: React.FC<APIConfigFormProps> = ({
  // nodeId, // Removed
  topLevelRequestType, setTopLevelRequestType,
  authChoice, setAuthChoice,
  apiKeyQueryParamName, setApiKeyQueryParamName,
  apiKeyHeaderName, setApiKeyHeaderName,
  endpointApiParamKey, setEndpointApiKey,
  providerName, // Kept for endpointName logic
  // providerDescription, setProviderDescription, // Removed
  // registeredProviderWallet, setRegisteredProviderWallet, // Removed
  endpointBaseUrl, setEndpointBaseUrl,
  pathParamKeys, setPathParamKeys,
  queryParamKeys, setQueryParamKeys,
  headerKeys, setHeaderKeys,
  bodyKeys, setBodyKeys,
  // price, setPrice, // Removed
  apiCallFormatSelected,
  setApiCallFormatSelected,
  onRegisterProvider,
  submitButtonText = "Register Provider Configuration", // Default value for backward compatibility
  showSubmitButton = true, // Default to showing the button for backward compatibility
  isWalletConnected = true, // Default to enabled for backward compatibility
}) => {

  // Local state for individual key inputs
  const [currentPathKeyInput, setCurrentPathKeyInput] = useState('');
  const [currentQueryKeyInput, setCurrentQueryKeyInput] = useState('');
  const [currentHeaderKeyInput, setCurrentHeaderKeyInput] = useState('');
  const [currentBodyKeyInput, setCurrentBodyKeyInput] = useState('');
  // New local state for API Key Name inputs
  const [currentApiKeyQueryNameInput, setCurrentApiKeyQueryNameInput] = useState('');
  const [currentApiKeyHeaderNameInput, setCurrentApiKeyHeaderNameInput] = useState('');

  // Compact styling adjustments - now using CSS variables
  const compactFormSectionStyle: React.CSSProperties = { marginBottom: '15px' }; 
  const compactInputColumnStyle: React.CSSProperties = { marginBottom: '10px' }; 
  const compactLabelStyle: React.CSSProperties = { fontSize: '0.85em', marginBottom: '2px', textAlign: 'left' }; 
  const compactInputStyle: React.CSSProperties = { 
    padding: 'var(--form-input-padding)', 
    fontSize: 'var(--form-input-font-size)',
    height: 'var(--form-input-height)',
    lineHeight: 'var(--form-line-height)',
    boxSizing: 'border-box',
    minHeight: 'unset'
  };
  const compactButtonStyle: React.CSSProperties = {
    padding: 'var(--form-button-padding)',
    fontSize: 'var(--form-button-font-size)', 
    height: 'var(--form-button-height)',
    lineHeight: 'var(--form-line-height)',
    boxSizing: 'border-box',
    minHeight: 'unset',
    display: 'inline-flex',
    alignItems: 'center'
  };
  const compactHelperTextStyle: React.CSSProperties = { fontSize: '0.75em', marginTop: '2px', marginBottom: '0px' }; 
  const compactH5Style: React.CSSProperties = { fontSize: '1em', marginBottom: '12px', marginTop: '0' }; 

  const selectionCardStyle: React.CSSProperties = {
    backgroundColor: 'var(--card-bg)',
    border: '1px solid var(--card-border)',
    borderRadius: '8px',
    padding: '20px',
    marginBottom: '15px',
    cursor: 'pointer',
    transition: 'box-shadow 0.3s ease-in-out, transform 0.2s ease-in-out, border-color 0.3s ease-in-out',
    boxShadow: 'var(--card-shadow)',
  };

  const handleSelectFormat = (format: TopLevelRequestType) => {
    setTopLevelRequestType(format);
    setApiCallFormatSelected(true); // Update state in App.tsx via this prop
  };

  const overallFormContainerStyle: React.CSSProperties = {
    backgroundColor: 'var(--card-bg)',
    border: '1px solid var(--card-border)',
    borderRadius: '8px',
    padding: '1rem',
    boxShadow: 'var(--card-shadow)',
    fontSize: '0.9em',
    display: 'flex', 
    flexDirection: 'column',
    height: '100%' // Make it fill the parent height
  };
  const formContentStyle: React.CSSProperties = {
    flexGrow: 1,
    display: 'flex',
    flexDirection: 'column'
  };

  // Style for API Key Placement options (radio-like buttons)
  const apiKeyPlacementOptionStyle: React.CSSProperties = {
    padding: '8px 12px',
    border: '1px solid var(--input-border)',
    borderRadius: '4px',
    cursor: 'pointer',
    backgroundColor: 'var(--input-bg)',
    color: 'var(--text-color)',
    marginRight: '10px',
    marginBottom: '10px', // For wrapping
    fontSize: '0.9em',
    transition: 'background-color 0.2s, border-color 0.2s',
  };

  const apiKeyPlacementOptionSelectedStyle: React.CSSProperties = {
    backgroundColor: 'var(--button-primary-bg)',
    color: 'var(--button-primary-text)',
    borderColor: 'var(--button-primary-bg)',
  };

  // Generic function to add a key to a list
  const addKeyToList = (key: string, list: string[], setter: (newList: string[]) => void) => {
    if (key.trim() && !list.includes(key.trim())) {
      setter([...list, key.trim()]);
    }
  };

  // Generic function to remove a key from a list
  const removeKeyFromList = (keyToRemove: string, list: string[], setter: (newList: string[]) => void) => {
    setter(list.filter(key => key !== keyToRemove));
  };

  // Style for key tags/chips
  const keyTagStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    backgroundColor: 'var(--button-secondary-bg)',
    color: 'var(--button-secondary-text)',
    padding: '3px 8px',
    borderRadius: '4px',
    marginRight: '5px',
    marginBottom: '5px',
    fontSize: '0.85em'
  };

  const removeKeyButtonStyle: React.CSSProperties = {
    marginLeft: '6px',
    background: 'transparent',
    border: 'none',
    color: 'var(--modal-close-color)',
    cursor: 'pointer',
    fontSize: '1.2rem',
    fontWeight: '400',
    padding: '0',
    lineHeight: '1',
    height: 'auto',
    minHeight: 'unset',
    display: 'inline-flex',
    alignItems: 'center',
    verticalAlign: 'middle',
    transition: 'color 0.2s ease',
    opacity: '0.7'
  };
  
  // Helper to render a key input section
  const renderKeyInputSection = (
    label: string, 
    currentValue: string, 
    setter: (value: string) => void, 
    keyList: string[], 
    listSetter: (keys: string[]) => void,
    placeholder: string = "Enter key name"
  ) => (
    <div style={compactInputColumnStyle}>
      <label style={{...compactLabelStyle, textAlign: 'left', display: 'block', marginBottom: '8px'}}>{label}</label>
      <div className="key-input-row" style={{ display: 'flex', gap: '8px', alignItems: 'center', justifyContent: 'flex-start' }}>
        <input 
          type="text" 
          value={currentValue} 
          onChange={(e) => setter(e.target.value)} 
          placeholder={placeholder}
          style={{...compactInputStyle, flexGrow: 0, width: '70%' }}
          onKeyPress={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addKeyToList(currentValue, keyList, listSetter);
              setter('');
            }
          }}
        />
        <button 
          type="button" 
          onClick={() => { addKeyToList(currentValue, keyList, listSetter); setter(''); }} 
          style={{...compactButtonStyle, flexShrink: 0 }}
          className="button-primary"
        >
          Add
        </button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', marginTop: '8px', justifyContent: 'flex-start' }}>
        {keyList.map(key => (
          <span key={key} style={keyTagStyle}>
            {key}
            <button onClick={() => removeKeyFromList(key, keyList, listSetter)} style={removeKeyButtonStyle} title={`Remove ${key}`}>&times;</button>
          </span>
        ))}
      </div>
    </div>
  );

  if (!apiCallFormatSelected) {
    return (
      <div style={overallFormContainerStyle}>
        <div className="api-format-selection-pane" style={formContentStyle}>
          <h5 style={{...compactH5Style, textAlign: 'center', marginBottom: '15px'}}>Select API Call Format</h5>
          
          <div 
            style={selectionCardStyle} 
            onClick={() => handleSelectFormat("getWithPath")} 
            onMouseEnter={(e) => {
              e.currentTarget.style.boxShadow = '0 6px 12px rgba(0,0,0,0.2)';
              e.currentTarget.style.transform = 'translateY(-3px)';
              e.currentTarget.style.borderColor = 'var(--link-color)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.boxShadow = 'var(--card-shadow)';
              e.currentTarget.style.transform = 'translateY(0px)';
              e.currentTarget.style.borderColor = 'var(--card-border)';
            }}
          >
            <h6 style={{marginTop: 0, marginBottom: '10px', fontSize: '1.1em', color: 'var(--heading-color)'}}>🛤️ GET with Path Parameters</h6>
            <p style={{fontSize: '0.85em', margin: '0 0 10px 0', color: 'var(--text-color)', opacity: 0.9}}>Use for APIs where primary identifiers are part of the URL path.</p>
            <pre style={{fontSize: '0.8em', padding: '8px', backgroundColor: 'var(--scaffold-bg)', color: 'var(--scaffold-code-default-color)', border: '1px solid var(--card-border)', borderRadius: '4px', margin: 0}}>
              <code>GET /api/users/{'{user_id}'}/profile</code>
            </pre>
          </div>

          <div 
            style={selectionCardStyle} 
            onClick={() => handleSelectFormat("getWithQuery")} 
            onMouseEnter={(e) => {
              e.currentTarget.style.boxShadow = '0 6px 12px rgba(0,0,0,0.2)';
              e.currentTarget.style.transform = 'translateY(-3px)';
              e.currentTarget.style.borderColor = 'var(--link-color)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.boxShadow = 'var(--card-shadow)';
              e.currentTarget.style.transform = 'translateY(0px)';
              e.currentTarget.style.borderColor = 'var(--card-border)';
            }}
          >
            <h6 style={{marginTop: 0, marginBottom: '10px', fontSize: '1.1em', color: 'var(--heading-color)'}}>❓ GET with Query Parameters</h6>
            <p style={{fontSize: '0.85em', margin: '0 0 10px 0', color: 'var(--text-color)', opacity: 0.9}}>Use for APIs that accept filters or options as URL query parameters.</p>
            <pre style={{fontSize: '0.8em', padding: '8px', backgroundColor: 'var(--scaffold-bg)', color: 'var(--scaffold-code-default-color)', border: '1px solid var(--card-border)', borderRadius: '4px', margin: 0}}>
              <code>GET /api/search?q={'{searchTerm}'}&limit={'{limit}'}</code>
            </pre>
          </div>

          <div 
            style={selectionCardStyle} 
            onClick={() => handleSelectFormat("postWithJson")} 
            onMouseEnter={(e) => {
              e.currentTarget.style.boxShadow = '0 6px 12px rgba(0,0,0,0.2)';
              e.currentTarget.style.transform = 'translateY(-3px)';
              e.currentTarget.style.borderColor = 'var(--link-color)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.boxShadow = 'var(--card-shadow)';
              e.currentTarget.style.transform = 'translateY(0px)';
              e.currentTarget.style.borderColor = 'var(--card-border)';
            }}
          >
            <h6 style={{marginTop: 0, marginBottom: '10px', fontSize: '1.1em', color: 'var(--heading-color)'}}>📦 POST with JSON Body</h6>
            <p style={{fontSize: '0.85em', margin: '0 0 10px 0', color: 'var(--text-color)', opacity: 0.9}}>Use for APIs that create or update resources using a JSON payload.</p>
            <pre style={{fontSize: '0.8em', padding: '8px', backgroundColor: 'var(--scaffold-bg)', color: 'var(--scaffold-code-default-color)', border: '1px solid var(--card-border)', borderRadius: '4px', margin: 0}}>
              <code>POST /api/orders</code>
              <code>{`{ "product_id": "123", "quantity": 2 }`}</code>
            </pre>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={overallFormContainerStyle}>
      <div style={formContentStyle}>
        <button 
          type="button" 
          onClick={() => setApiCallFormatSelected(false)} 
          style={{
            marginBottom: '20px', 
            padding: '8px 15px',
            fontSize: '0.9em',
            backgroundColor: 'var(--button-secondary-bg)', 
            color: 'var(--button-secondary-text)', 
            border: '1px solid var(--input-border)',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          &larr; Change API Call Format
        </button>

        <div style={{ marginBottom: '20px', fontSize: '0.95em', color: 'var(--text-color)' }}>
          <strong>Selected API Format:</strong> 
          {
            topLevelRequestType === 'getWithPath' ? 'GET with Path Parameters' :
            topLevelRequestType === 'getWithQuery' ? 'GET with Query Parameters' :
            topLevelRequestType === 'postWithJson' ? 'POST with JSON Body' : ''
          }
        </div>

        <div style={compactFormSectionStyle}>
          <h5 style={compactH5Style}>API Key Placement</h5>
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '10px' }}>
            {([
              { value: 'query', label: 'Query Param' },
              { value: 'header', label: 'HTTP Header' },
            ] as { value: AuthChoice; label: string }[]).map(({ value, label }) => (
              <div
                key={value}
                onClick={() => setAuthChoice(value)}
                style={authChoice === value ? { ...apiKeyPlacementOptionStyle, ...apiKeyPlacementOptionSelectedStyle } : apiKeyPlacementOptionStyle}
                title={label}
              >
                {label}
              </div>
            ))}
          </div>
        </div>

        {/* --- MODIFIED: New container for the inline inputs --- */}
        <div className="form-row-container" style={{ display: 'flex', gap: '20px', alignItems: 'stretch' }}>
          
          {/* --- Left Side: Conditional Param Name --- */}
          <div style={{...compactInputColumnStyle, flex: 1, minWidth: 0 }}>
            {(authChoice === 'query' || authChoice === 'header') && (
              <div>
                <label htmlFor={authChoice === 'query' ? "apiKeyQueryParamName" : "apiKeyHeaderName"} style={{...compactLabelStyle, display:'block', marginBottom:'4px'}}>API Key Identifier:</label>
                {!(authChoice === 'query' ? apiKeyQueryParamName : apiKeyHeaderName) ? (
                  <div className="key-input-row" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input 
                      id={authChoice === 'query' ? "apiKeyQueryParamNameInput" : "apiKeyHeaderNameInput"} 
                      type="text" 
                      value={authChoice === 'query' ? currentApiKeyQueryNameInput : currentApiKeyHeaderNameInput} 
                      onChange={(e) => authChoice === 'query' ? setCurrentApiKeyQueryNameInput(e.target.value) : setCurrentApiKeyHeaderNameInput(e.target.value)} 
                      placeholder={authChoice === 'query' ? "e.g., api_key" : "e.g., X-API-Key"} 
                      style={{...compactInputStyle, flexGrow: 1 }}
                    />
                    <button 
                      type="button" 
                      onClick={() => {
                        if (authChoice === 'query' && currentApiKeyQueryNameInput.trim()) {
                          setApiKeyQueryParamName(currentApiKeyQueryNameInput.trim()); 
                          setCurrentApiKeyQueryNameInput('');
                        } else if (authChoice === 'header' && currentApiKeyHeaderNameInput.trim()) {
                          setApiKeyHeaderName(currentApiKeyHeaderNameInput.trim()); 
                          setCurrentApiKeyHeaderNameInput('');
                        }
                      }} 
                      className="button-primary" 
                      style={{...compactButtonStyle, flexShrink: 0 }}
                    >
                      Set
                    </button>
                  </div>
                ) : (
                   <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                     <span style={keyTagStyle}>
                       {authChoice === 'query' ? apiKeyQueryParamName : apiKeyHeaderName}
                       <button 
                         onClick={() => authChoice === 'query' ? setApiKeyQueryParamName('') : setApiKeyHeaderName('')} 
                         style={removeKeyButtonStyle} 
                         title={`Remove ${authChoice === 'query' ? apiKeyQueryParamName : apiKeyHeaderName}`}
                       >
                         &times;
                       </button>
                     </span>
                   </div>
                )}
              </div>
            )}
            {/* This empty div acts as a placeholder when no placement is selected, maintaining alignment */}
            {authChoice !== 'query' && authChoice !== 'header' && (
              <div>
                <label style={{...compactLabelStyle, display:'block', marginBottom:'4px', visibility: 'hidden'}}>Placeholder</label>
                <div style={{height: '34px'}}></div> {/* Match height of input+button row */}
              </div>
            )}
          </div>

          {/* --- Right Side: API Key Value --- */}
          <div style={{...compactInputColumnStyle, flex: 1, minWidth: 0 }}>
            <label htmlFor="endpointApiKey" style={{...compactLabelStyle, display: 'block', marginBottom: '4px' }}>API Key Value (Secret)</label>
            <div className="input-row-for-help" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input id="endpointApiKey" type="password" value={endpointApiParamKey} onChange={(e) => setEndpointApiKey(e.target.value)} placeholder="Enter secret API Key" style={{...compactInputStyle, flexGrow: 1}}/>
              <span className="help-icon" title="The actual secret API key. It will be stored securely by the backend." style={{fontSize: '0.8em', marginLeft: '5px'}}>?</span>
            </div>
          </div>
        </div>

        <div style={compactFormSectionStyle}>
          <h5 style={compactH5Style}>API Endpoint Details</h5>
          <div style={compactInputColumnStyle}>
            <div className="input-row-for-help" style={{ display: 'flex', alignItems: 'center' }}>
              <label htmlFor="endpointBaseUrl" style={{...compactLabelStyle, marginRight: '5px'}}>Base URL Template</label>
              <input id="endpointBaseUrl" type="url" value={endpointBaseUrl} onChange={(e) => setEndpointBaseUrl(e.target.value)} placeholder="https://api.example.com/{id}" style={{...compactInputStyle, flexGrow: 1}} />
              <span className="help-icon" title="The full URL structure, including scheme (http/https). Use {placeholder_name} for dynamic path segments that will be filled at runtime (e.g., https://api.example.com/users/{userId}/posts)." style={{fontSize: '0.8em', marginLeft: '5px'}}>?</span>
            </div>
          </div>
        </div>

        <div style={compactFormSectionStyle}>
          <h5 style={compactH5Style}>Request Parameters Configuration</h5>
          
          {/* All parameters in a row */}
          <div className={`parameter-sections-container ${topLevelRequestType === "postWithJson" ? 'with-json-body' : ''}`}>
            { (topLevelRequestType === "getWithPath" || topLevelRequestType === "postWithJson") && 
              <div className="parameter-section-item">
                {renderKeyInputSection("Path Parameter Keys", currentPathKeyInput, setCurrentPathKeyInput, pathParamKeys, setPathParamKeys, "e.g., userId")}
              </div>
            }

            { (topLevelRequestType === "getWithQuery" || topLevelRequestType === "postWithJson") && 
              <div className="parameter-section-item">
                {renderKeyInputSection("Query Parameter Keys", currentQueryKeyInput, setCurrentQueryKeyInput, queryParamKeys, setQueryParamKeys, "e.g., searchTerm, limit")}
              </div>
            }

            <div className="parameter-section-item">
              {renderKeyInputSection("Additional Header Keys", currentHeaderKeyInput, setCurrentHeaderKeyInput, headerKeys, setHeaderKeys, "e.g., X-Request-ID")}
            </div>

            {/* JSON Body Keys now inside the container */}
            {topLevelRequestType === "postWithJson" && 
              <div className="parameter-section-item">
                {renderKeyInputSection("JSON Body Keys", currentBodyKeyInput, setCurrentBodyKeyInput, bodyKeys, setBodyKeys, "e.g., name, email")}
              </div>
            }
          </div>
        </div>
      </div>

      {showSubmitButton && (
        <div className="form-navigation modal-form-navigation" style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0', paddingTop: '5px' }}>
          <button 
            type="button" 
            onClick={onRegisterProvider} 
            className="button-primary submit-button"
            disabled={!isWalletConnected}
            style={{
              opacity: isWalletConnected ? 1 : 0.5,
              cursor: isWalletConnected ? 'pointer' : 'not-allowed',
            }}
            title={!isWalletConnected ? 'Connect your wallet to register provider' : ''}
          >
            {isWalletConnected ? submitButtonText : 'Connect Wallet to Register'}
          </button>
        </div>
      )}
    </div>
  );
};

export default APIConfigForm; 
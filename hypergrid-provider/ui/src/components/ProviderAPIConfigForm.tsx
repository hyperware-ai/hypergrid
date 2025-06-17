import React, { useState } from 'react';
import { TopLevelRequestType, AuthChoice } from '../App'; // Assuming types are exported from App.tsx or moved to a types file

// Props interface for ProviderConfigForm
export interface ProviderConfigFormProps {
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
}

const ProviderConfigForm: React.FC<ProviderConfigFormProps> = ({
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
}) => {

  // Local state for individual key inputs
  const [currentPathKeyInput, setCurrentPathKeyInput] = useState('');
  const [currentQueryKeyInput, setCurrentQueryKeyInput] = useState('');
  const [currentHeaderKeyInput, setCurrentHeaderKeyInput] = useState('');
  const [currentBodyKeyInput, setCurrentBodyKeyInput] = useState('');
  // New local state for API Key Name inputs
  const [currentApiKeyQueryNameInput, setCurrentApiKeyQueryNameInput] = useState('');
  const [currentApiKeyHeaderNameInput, setCurrentApiKeyHeaderNameInput] = useState('');

  // Compact styling adjustments
  const compactFormSectionStyle: React.CSSProperties = { marginBottom: '15px' }; 
  const compactInputColumnStyle: React.CSSProperties = { marginBottom: '10px' }; 
  const compactLabelStyle: React.CSSProperties = { fontSize: '0.85em', marginBottom: '2px' }; 
  const compactInputStyle: React.CSSProperties = { padding: '4px 6px', fontSize: '0.9em' };
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
    padding: '1.5rem', // Consistent with .card padding
    boxShadow: 'var(--card-shadow)',
    flex: 1,
    fontSize: '0.9em',
    display: 'flex', 
    flexDirection: 'column' 
  };
  const formContentStyle: React.CSSProperties = {
    flexGrow: 1 
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
    marginLeft: '8px',
    background: 'none',
    border: 'none',
    color: 'var(--button-secondary-text)',
    cursor: 'pointer',
    fontSize: '1.1em',
    padding: '0',
    lineHeight: '1'
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
      <label style={compactLabelStyle}>{label}</label>
      <div style={{ display: 'flex', gap: '10px', marginBottom: '5px', alignItems: 'center' }}>
        <input 
          type="text" 
          value={currentValue} 
          onChange={(e) => setter(e.target.value)} 
          placeholder={placeholder}
          style={{...compactInputStyle, flexGrow: 1, minWidth: '160px' }}
        />
        <button 
          type="button" 
          onClick={() => { addKeyToList(currentValue, keyList, listSetter); setter(''); }} 
          style={{...compactInputStyle, backgroundColor: 'var(--button-primary-bg)', color: 'var(--button-primary-text)', border: 'none', flexShrink: 0, padding: '6px 12px' }}
        >
          Add
        </button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap' }}>
        {keyList.map(key => (
          <span key={key} style={keyTagStyle}>
            {key}
            <button onClick={() => removeKeyFromList(key, keyList, listSetter)} style={removeKeyButtonStyle} title={`Remove ${key}`}>&times;</button>
          </span>
        ))}
      </div>
      {/* <p className="helper-text" style={compactHelperTextStyle}>Helper text for this section.</p> */}
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

        <div style={{...compactInputColumnStyle, marginBottom: '15px'}}>
          <label style={{...compactLabelStyle, marginBottom: '8px', display: 'block'}}>API Key Placement:</label>
          <div style={{ display: 'flex', flexWrap: 'wrap' }}>
            {([
              { value: 'query', label: 'Query Param', description: 'Key in URL (e.g., ?apiKey=...)' },
              { value: 'header', label: 'HTTP Header', description: 'Key in request header (e.g., X-Api-Key: ...)' },
            ] as Array<{value: AuthChoice, label: string, description: string}>).map(option => (
              <div 
                key={option.value}
                onClick={() => {
                  setAuthChoice(option.value);
                  if (option.value === 'query') setApiKeyHeaderName('');
                  if (option.value === 'header') setApiKeyQueryParamName('');
                }}
                style={{
                  ...apiKeyPlacementOptionStyle,
                  ...(authChoice === option.value ? apiKeyPlacementOptionSelectedStyle : {}),
                }}
                title={option.description}
              >
                {option.label}
              </div>
            ))}
          </div>
        </div>

        {authChoice === 'query' && (
          <div style={compactInputColumnStyle}>
            <label htmlFor="apiKeyQueryParamName" style={{...compactLabelStyle, display:'block', marginBottom:'2px'}}>API Key Query Param Name:</label>
            {!apiKeyQueryParamName ? (
              <div className="input-row-for-help" style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <input 
                  id="apiKeyQueryParamNameInput" 
                  type="text" 
                  value={currentApiKeyQueryNameInput} 
                  onChange={(e) => setCurrentApiKeyQueryNameInput(e.target.value)} 
                  placeholder="e.g., api_key"
                  style={{...compactInputStyle, flexGrow: 1, padding: '4px 6px'}} 
                />
                <button 
                  type="button" 
                  onClick={() => { 
                    if(currentApiKeyQueryNameInput.trim()) {
                        setApiKeyQueryParamName(currentApiKeyQueryNameInput.trim()); 
                        setCurrentApiKeyQueryNameInput(''); 
                    }
                  }}
                  style={{...compactInputStyle, backgroundColor: 'var(--button-primary-bg)', color: 'var(--button-primary-text)', border: 'none', flexShrink: 0, padding: '6px 10px'}}
                >
                  Set
                </button>
                <span className="help-icon" title="Enter the name of the query parameter for the API key." style={{fontSize: '0.8em', marginLeft: '5px'}}>?</span>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '5px' }}>
                <span style={keyTagStyle}>{apiKeyQueryParamName}</span>
                <button onClick={() => setApiKeyQueryParamName('')} style={removeKeyButtonStyle} title={`Remove ${apiKeyQueryParamName}`}>&times;</button>
              </div>
            )}
          </div>
        )}
        {authChoice === 'header' && (
          <div style={compactInputColumnStyle}>
            <label htmlFor="apiKeyHeaderName" style={{...compactLabelStyle, display:'block', marginBottom:'2px'}}>API Key Header Name:</label>
            {!apiKeyHeaderName ? (
              <div className="input-row-for-help" style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <input 
                  id="apiKeyHeaderNameInput" 
                  type="text" 
                  value={currentApiKeyHeaderNameInput} 
                  onChange={(e) => setCurrentApiKeyHeaderNameInput(e.target.value)} 
                  placeholder="e.g., X-API-Key"
                  style={{...compactInputStyle, flexGrow: 1, padding: '4px 6px'}} 
                />
                <button 
                  type="button" 
                  onClick={() => { 
                    if(currentApiKeyHeaderNameInput.trim()){
                        setApiKeyHeaderName(currentApiKeyHeaderNameInput.trim()); 
                        setCurrentApiKeyHeaderNameInput(''); 
                    }
                  }}
                  style={{...compactInputStyle, backgroundColor: 'var(--button-primary-bg)', color: 'var(--button-primary-text)', border: 'none', flexShrink: 0, padding: '6px 10px'}}
                >
                  Set
                </button>
                <span className="help-icon" title="Enter the name of the HTTP header for the API key." style={{fontSize: '0.8em', marginLeft: '5px'}}>?</span>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '5px' }}>
                <span style={keyTagStyle}>{apiKeyHeaderName}</span>
                <button onClick={() => setApiKeyHeaderName('')} style={removeKeyButtonStyle} title={`Remove ${apiKeyHeaderName}`}>&times;</button>
              </div>
            )}
          </div>
        )}
        <div style={compactInputColumnStyle}>
          <div className="input-row-for-help" style={{ display: 'flex', alignItems: 'center' }}>
            <label htmlFor="endpointApiKey" style={{...compactLabelStyle, marginRight: '5px'}}>API Key Value (Secret)</label>
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
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '20px' }}>
          { (topLevelRequestType === "getWithPath" || topLevelRequestType === "postWithJson") && 
            <div style={{ flex: '1 1 250px', minWidth: '230px' }}>
              {renderKeyInputSection("Path Parameter Keys", currentPathKeyInput, setCurrentPathKeyInput, pathParamKeys, setPathParamKeys, "e.g., userId")}
            </div>
          }

          { (topLevelRequestType === "getWithQuery" || topLevelRequestType === "postWithJson") && 
            <div style={{ flex: '1 1 250px', minWidth: '230px' }}>
              {renderKeyInputSection("Query Parameter Keys", currentQueryKeyInput, setCurrentQueryKeyInput, queryParamKeys, setQueryParamKeys, "e.g., searchTerm, limit")}
            </div>
          }
          
          {topLevelRequestType === "postWithJson" && 
            <div style={{ flex: '1 1 250px', minWidth: '230px' }}>
              {renderKeyInputSection("JSON Body Keys", currentBodyKeyInput, setCurrentBodyKeyInput, bodyKeys, setBodyKeys, "e.g., name, email")}
            </div>
          }

          <div style={{ flex: '1 1 250px', minWidth: '230px' }}>
            {renderKeyInputSection("Additional Header Keys", currentHeaderKeyInput, setCurrentHeaderKeyInput, headerKeys, setHeaderKeys, "e.g., X-Request-ID")}
          </div>
        </div>
      </div>

      {showSubmitButton && (
        <div className="form-navigation modal-form-navigation" style={{ display: 'flex', justifyContent: 'flex-end', /*gap: '10px',*/ marginTop: 'auto', paddingTop: '20px' }}>
          <button 
            type="button" 
            onClick={onRegisterProvider} 
            className="button-primary submit-button"
            style={{ /* className should handle most styling */ }}
          >
            {submitButtonText}
          </button>
        </div>
      )}
    </div>
  );
};

export default ProviderConfigForm; 
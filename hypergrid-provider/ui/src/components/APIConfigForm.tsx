import React, { useState } from 'react';
import { TopLevelRequestType, AuthChoice } from '../App'; // Assuming types are exported from App.tsx or moved to a types file

// Props interface for APIConfigForm
export interface APIConfigFormProps {
  
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
  

  apiCallFormatSelected: boolean;
  setApiCallFormatSelected: (value: boolean) => void;
  onRegisterProvider: () => void;
  submitButtonText?: string; // Optional prop for button text
  showSubmitButton?: boolean; // Optional prop to control button visibility
  isWalletConnected?: boolean; // Optional prop to control button enabled state 
}

const APIConfigForm: React.FC<APIConfigFormProps> = ({
  
  topLevelRequestType, setTopLevelRequestType,
  authChoice, setAuthChoice,
  apiKeyQueryParamName, setApiKeyQueryParamName,
  apiKeyHeaderName, setApiKeyHeaderName,
  endpointApiParamKey, setEndpointApiKey, 
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

  // Mobile-friendly help icon component
  const HoverHelpIcon: React.FC<{ helpText: string }> = ({ helpText }) => {
    const [isVisible, setIsVisible] = React.useState(false);
    const [isMobile, setIsMobile] = React.useState(false);
    const iconRef = React.useRef<HTMLDivElement>(null);
    
    // Detect if user is on mobile/touch device
    React.useEffect(() => {
      setIsMobile('ontouchstart' in window || navigator.maxTouchPoints > 0);
    }, []);
    
    const handleMouseEnter = () => {
      if (!isMobile) setIsVisible(true);
    };
    
    const handleMouseLeave = () => {
      if (!isMobile) setIsVisible(false);
    };
    
    const handleClick = (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (isMobile) {
        setIsVisible(!isVisible);
      }
    };
    
    return (
      <div 
        ref={iconRef}
        style={{ 
          position: 'relative', 
          display: 'inline-block',
          marginLeft: '6px',
          verticalAlign: 'left'
        }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
      >
        <div
          style={{
            width: isMobile ? '24px' : '14px',
            height: isMobile ? '24px' : '14px',
            borderRadius: '50%',
            backgroundColor: isVisible ? '#0056b3' : '#007bff',
            color: 'white',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: isMobile ? '12px' : '10px',
            fontWeight: 'bold',
            cursor: isMobile ? 'pointer' : 'help',
            flexShrink: 0,
            transition: 'background-color 0.1s ease',
            border: isMobile ? '2px solid rgba(255,255,255,0.3)' : 'none',
          }}
        >
          ?
        </div>
        {isVisible && (
          <div
            style={{
              position: 'fixed',
              top: iconRef.current ? iconRef.current.getBoundingClientRect().top - 10 : '50%',
              left: iconRef.current ? iconRef.current.getBoundingClientRect().right + 8 : '10px',
              right: 'auto',
              transform: 'none',
              padding: isMobile ? '16px 20px' : '12px 16px',
              backgroundColor: '#1a1a1a',
              color: '#ffffff',
              fontSize: isMobile ? '14px' : '13px',
              borderRadius: '8px',
              width: isMobile ? '250px' : '280px',
              maxWidth: isMobile ? '250px' : '280px',
              whiteSpace: 'normal',
              boxShadow: '0 8px 24px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.1)',
              zIndex: 10001,
              pointerEvents: isMobile ? 'auto' : 'none',
              textAlign: 'left',
              lineHeight: '1.5',
              fontWeight: '400',
            }}
            onClick={isMobile ? handleClick : undefined}
          >
            {helpText}
            {isMobile && (
              <div style={{
                marginTop: '12px',
                textAlign: 'center',
                fontSize: '12px',
                opacity: 0.7
              }}>
                Tap to close
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  // All styling now handled by CSS classes 


  const handleSelectFormat = (format: TopLevelRequestType) => {
    setTopLevelRequestType(format);
    setApiCallFormatSelected(true); // Update state in App.tsx via this prop
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

  
  // Helper to render a key input section
  const renderKeyInputSection = (
    label: string, 
    currentValue: string, 
    setter: (value: string) => void, 
    keyList: string[], 
    listSetter: (keys: string[]) => void,
    placeholder: string = "Enter key name"
  ) => (
    <div className="form-compact-input-column">
      <label className="form-compact-label">{label}</label>
      <div className="key-input-row">
        <input 
          type="text" 
          value={currentValue} 
          onChange={(e) => setter(e.target.value)} 
          placeholder={placeholder}
          className="form-compact-input"
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
          className="form-compact-button button-primary"
        >
          Add
        </button>
      </div>
      <div className="key-list">
        {keyList.map(key => (
          <span key={key} className="key-tag">
            {key}
            <button 
              onClick={() => removeKeyFromList(key, keyList, listSetter)} 
              className="key-tag-remove" 
              title={`Remove ${key}`}
            >
              &times;
            </button>
          </span>
        ))}
      </div>
    </div>
  );

  if (!apiCallFormatSelected) {
    return (
      <div className="form-compact">
        <div className="form-compact-content api-format-selection-pane">
          <h5 style={{textAlign: 'center', marginBottom: '15px'}}>Select API Call Format</h5>
          
          <div 
            className="api-selection-card"
            onClick={() => handleSelectFormat("getWithPath")}
          >
            <h6 style={{marginTop: 0, marginBottom: '10px', fontSize: '1.1em', color: 'var(--heading-color)'}}>🛤️ GET with Path Parameters</h6>
            <p style={{fontSize: '0.85em', margin: '0 0 10px 0', color: 'var(--text-color)', opacity: 0.9}}>Use for APIs where primary identifiers are part of the URL path.</p>
            <pre style={{fontSize: '0.8em', padding: '8px', backgroundColor: 'var(--scaffold-bg)', color: 'var(--scaffold-code-default-color)', border: '1px solid var(--card-border)', borderRadius: '4px', margin: 0}}>
              <code>GET /api/users/{'{user_id}'}/profile</code>
            </pre>
          </div>

          <div 
            className="api-selection-card"
            onClick={() => handleSelectFormat("getWithQuery")}
          >
            <h6 style={{marginTop: 0, marginBottom: '10px', fontSize: '1.1em', color: 'var(--heading-color)'}}>❓ GET with Query Parameters</h6>
            <p style={{fontSize: '0.85em', margin: '0 0 10px 0', color: 'var(--text-color)', opacity: 0.9}}>Use for APIs that accept filters or options as URL query parameters.</p>
            <pre style={{fontSize: '0.8em', padding: '8px', backgroundColor: 'var(--scaffold-bg)', color: 'var(--scaffold-code-default-color)', border: '1px solid var(--card-border)', borderRadius: '4px', margin: 0}}>
              <code>GET /api/search?q={'{searchTerm}'}&limit={'{limit}'}</code>
            </pre>
          </div>

          <div 
            className="api-selection-card"
            onClick={() => handleSelectFormat("postWithJson")}
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
    <div className="form-compact">
      <div className="form-compact-content">
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

        <div className="selected-api-format">
          <strong>Selected API Format:</strong> 
          {
            topLevelRequestType === 'getWithPath' ? 'GET with Path Parameters' :
            topLevelRequestType === 'getWithQuery' ? 'GET with Query Parameters' :
            topLevelRequestType === 'postWithJson' ? 'POST with JSON Body' : ''
          }
        </div>

        <div className="form-compact-section">
          <h5>API Key Placement</h5>
          <div className="api-key-placement-options">
            {([
              { value: 'query', label: 'Query Param' },
              { value: 'header', label: 'HTTP Header' },
            ] as { value: AuthChoice; label: string }[]).map(({ value, label }) => (
              <div
                key={value}
                onClick={() => setAuthChoice(value)}
                className={`api-key-placement-option ${authChoice === value ? 'selected' : ''}`}
                title={label}
              >
                {label}
              </div>
            ))}
          </div>
        </div>

        {/* --- MODIFIED: New container for the inline inputs --- */}
        <div className="form-row-container">
          
          {/* --- Left Side: Conditional Param Name --- */}
          <div className="form-compact-input-column">
            {(authChoice === 'query' || authChoice === 'header') && (
              <div>
                <label htmlFor={authChoice === 'query' ? "apiKeyQueryParamName" : "apiKeyHeaderName"} className="form-compact-label">API Key Identifier:</label>
                {!(authChoice === 'query' ? apiKeyQueryParamName : apiKeyHeaderName) ? (
                  <div className="key-input-row">
                    <input 
                      id={authChoice === 'query' ? "apiKeyQueryParamNameInput" : "apiKeyHeaderNameInput"} 
                      type="text" 
                      value={authChoice === 'query' ? currentApiKeyQueryNameInput : currentApiKeyHeaderNameInput} 
                      onChange={(e) => authChoice === 'query' ? setCurrentApiKeyQueryNameInput(e.target.value) : setCurrentApiKeyHeaderNameInput(e.target.value)} 
                      placeholder={authChoice === 'query' ? "e.g., api_key" : "e.g., X-API-Key"} 
                      className="form-compact-input"
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
                      className="form-compact-button button-primary"
                    >
                      Set
                    </button>
                  </div>
                ) : (
                   <div className="key-display-row">
                     <span className="key-tag">
                       {authChoice === 'query' ? apiKeyQueryParamName : apiKeyHeaderName}
                       <button 
                         onClick={() => authChoice === 'query' ? setApiKeyQueryParamName('') : setApiKeyHeaderName('')} 
                         className="key-tag-remove" 
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
              <div className="form-placeholder">
                <label className="form-compact-label form-placeholder-label">Placeholder</label>
                <div className="form-placeholder-spacer"></div>
              </div>
            )}
          </div>

          {/* --- Right Side: API Key Value --- */}
          <div className="form-compact-input-column">
            <label htmlFor="endpointApiKey" className="form-compact-label">API Key Value (Secret)</label>
            <div className="input-row-for-help">
              <input id="endpointApiKey" type="password" value={endpointApiParamKey} onChange={(e) => setEndpointApiKey(e.target.value)} placeholder="Super Secret API Key" className="form-compact-input" />
                              <HoverHelpIcon helpText="Your secret API key that proves you have permission to access this service. Keep this private!" />
            </div>
          </div>
        </div>

        <div className="form-compact-section">
          <h5>API Endpoint Details</h5>
          <div className="form-compact-input-column">
            <div className="input-row-for-help">
              <label htmlFor="endpointBaseUrl" className="form-compact-label">Base URL Template</label>
              <input id="endpointBaseUrl" type="url" value={endpointBaseUrl} onChange={(e) => setEndpointBaseUrl(e.target.value)} placeholder="https://api.example.com/{id}" className="form-compact-input" />
                              <HoverHelpIcon
                  helpText="Enter the complete web address for your API. For dynamic parts like user IDs, use placeholders like {userId} and make sure to add 'userId' as a Path Parameter below."
                />
            </div>
          </div>
        </div>

        <div className="form-compact-section">
          <h5>Request Parameters Configuration</h5>
          
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
        <div className="form-navigation modal-form-navigation">
          <button 
            type="button" 
            onClick={onRegisterProvider} 
            className={`button-primary submit-button ${!isWalletConnected ? 'disabled' : ''}`}
            disabled={!isWalletConnected}
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
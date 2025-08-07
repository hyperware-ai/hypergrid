import React, { useState } from 'react';
import classNames from 'classnames';
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
    <div className="space-y-3">
      <label className="block text-sm font-medium text-gray-700">{label}</label>
      <div className="flex gap-2">
        <input
          type="text"
          value={currentValue}
          onChange={(e) => setter(e.target.value)}
          placeholder={placeholder}
          className="flex-1 p-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          onKeyDown={(e) => {
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
          className="px-3 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 transition-colors"
        >
          Add
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {keyList.map(key => (
          <span key={key} className="inline-flex items-center px-3 py-1 bg-gray-100 border border-gray-300 rounded-md text-sm">
            {key}
            <button
              onClick={() => removeKeyFromList(key, keyList, listSetter)}
              className="ml-2 text-gray-500 hover:text-gray-700"
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
      <div className="p-6">
        <div className="space-y-4">
          <h5 className="text-center text-lg font-semibold mb-6">Select API Call Format</h5>

          <div
            className="bg-white p-4 rounded-lg border border-gray-200 hover:border-blue-300 hover:shadow-md cursor-pointer transition-all"
            onClick={() => handleSelectFormat("getWithPath")}
          >
            <h6 className="text-lg font-medium text-dark-gray mb-2 flex items-center gap-2">
              🛤️ GET with Path Parameters
            </h6>
            <p className="text-sm text-gray-600 mb-3">
              Use for APIs where primary identifiers are part of the URL path.
            </p>
            <pre className="text-xs p-2 bg-gray-50 text-gray-700 border border-gray-200 rounded overflow-x-auto">
              <code>GET /api/users/{'{user_id}'}/profile</code>
            </pre>
          </div>

          <div
            className="bg-white p-4 rounded-lg border border-gray-200 hover:border-blue-300 hover:shadow-md cursor-pointer transition-all"
            onClick={() => handleSelectFormat("getWithQuery")}
          >
            <h6 className="text-lg font-medium text-dark-gray mb-2 flex items-center gap-2">
              ❓ GET with Query Parameters
            </h6>
            <p className="text-sm text-gray-600 mb-3">
              Use for APIs that accept filters or options as URL query parameters.
            </p>
            <pre className="text-xs p-2 bg-gray-50 text-gray-700 border border-gray-200 rounded overflow-x-auto">
              <code>GET /api/search?q={'{searchTerm}'}&limit={'{limit}'}</code>
            </pre>
          </div>

          <div
            className="bg-white p-4 rounded-lg border border-gray-200 hover:border-blue-300 hover:shadow-md cursor-pointer transition-all"
            onClick={() => handleSelectFormat("postWithJson")}
          >
            <h6 className="text-lg font-medium text-dark-gray mb-2 flex items-center gap-2">
              📦 POST with JSON Body
            </h6>
            <p className="text-sm text-gray-600 mb-3">
              Use for APIs that create or update resources using a JSON payload.
            </p>
            <pre className="text-xs p-2 bg-gray-50 text-gray-700 border border-gray-200 rounded overflow-x-auto space-y-1">
              <code className="block">POST /api/orders</code>
              <code className="block">{`{ "product_id": "123", "quantity": 2 }`}</code>
            </pre>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <button
          type="button"
          onClick={() => setApiCallFormatSelected(false)}
          className="mb-5 px-4 py-2 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 border border-gray-300 rounded-md cursor-pointer transition-colors flex items-center gap-2"
        >
          &larr; Change API Call Format
        </button>

        <div className="bg-blue-50 p-3 rounded-md border border-blue-200 mb-6">
          <strong className="text-blue-800">Selected API Format:</strong>
          <span className="text-blue-700 ml-2">
            {
              topLevelRequestType === 'getWithPath' ? 'GET with Path Parameters' :
              topLevelRequestType === 'getWithQuery' ? 'GET with Query Parameters' :
              topLevelRequestType === 'postWithJson' ? 'POST with JSON Body' : ''
            }
          </span>
        </div>

        <div className="space-y-4">
          <h5 className="text-lg font-medium text-dark-gray">API Key Placement</h5>
          <div className="flex gap-3">
            {([
              { value: 'query', label: 'Query Param' },
              { value: 'header', label: 'HTTP Header' },
            ] as { value: AuthChoice; label: string }[]).map(({ value, label }) => (
              <div
                key={value}
                onClick={() => setAuthChoice(value)}
                className={classNames(
                  "px-4 py-2 rounded-md border cursor-pointer transition-all text-sm font-medium",
                  authChoice === value
                    ? 'bg-blue-100 border-blue-300 text-blue-800'
                    : 'bg-white border-gray-300 text-gray-700 hover:border-gray-400'
                )}
                title={label}
              >
                {label}
              </div>
            ))}
          </div>
        </div>

        {/* API Key Configuration */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

          {/* Left Side: API Key Identifier */}
          <div className="space-y-3">
            {(authChoice === 'query' || authChoice === 'header') && (
              <div>
                <label htmlFor={authChoice === 'query' ? "apiKeyQueryParamName" : "apiKeyHeaderName"} className="block text-sm font-medium text-gray-700 mb-2">
                  API Key Identifier:
                </label>
                {!(authChoice === 'query' ? apiKeyQueryParamName : apiKeyHeaderName) ? (
                  <div className="flex gap-2">
                    <input
                      id={authChoice === 'query' ? "apiKeyQueryParamNameInput" : "apiKeyHeaderNameInput"}
                      type="text"
                      value={authChoice === 'query' ? currentApiKeyQueryNameInput : currentApiKeyHeaderNameInput}
                      onChange={(e) => authChoice === 'query' ? setCurrentApiKeyQueryNameInput(e.target.value) : setCurrentApiKeyHeaderNameInput(e.target.value)}
                      placeholder={authChoice === 'query' ? "e.g., api_key" : "e.g., X-API-Key"}
                      className="flex-1 p-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
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
                      className="px-3 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 transition-colors"
                    >
                      Set
                    </button>
                  </div>
                ) : (
                   <div className="flex items-center">
                     <span className="inline-flex items-center px-3 py-1 bg-gray-100 border border-gray-300 rounded-md text-sm">
                       {authChoice === 'query' ? apiKeyQueryParamName : apiKeyHeaderName}
                       <button
                         onClick={() => authChoice === 'query' ? setApiKeyQueryParamName('') : setApiKeyHeaderName('')}
                         className="ml-2 text-gray-500 hover:text-gray-700"
                         title={`Remove ${authChoice === 'query' ? apiKeyQueryParamName : apiKeyHeaderName}`}
                       >
                         &times;
                       </button>
                     </span>
                   </div>
                )}
              </div>
            )}
          </div>

          {/* Right Side: API Key Value */}
          <div className="space-y-3">
            <label htmlFor="endpointApiKey" className="block text-sm font-medium text-gray-700 mb-2">
              API Key Value (Secret)
            </label>
            <div className="flex items-center gap-2">
              <input
                id="endpointApiKey"
                type="password"
                value={endpointApiParamKey}
                onChange={(e) => setEndpointApiKey(e.target.value)}
                placeholder="Super Secret API Key"
                className="flex-1 p-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              <HoverHelpIcon helpText="Your secret API key that proves you have permission to access this service. Keep this private!" />
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <h5 className="text-lg font-medium text-dark-gray">API Endpoint Details</h5>
          <div className="space-y-3">
            <label htmlFor="endpointBaseUrl" className="block text-sm font-medium text-gray-700">
              Base URL Template
            </label>
            <div className="flex items-center gap-2">
              <input
                id="endpointBaseUrl"
                type="url"
                value={endpointBaseUrl}
                onChange={(e) => setEndpointBaseUrl(e.target.value)}
                placeholder="https://api.example.com/{id}"
                className="flex-1 p-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              <HoverHelpIcon
                helpText="Enter the complete web address for your API. For dynamic parts like user IDs, use placeholders like {userId} and make sure to add 'userId' as a Path Parameter below."
              />
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <h5 className="text-lg font-medium text-dark-gray">Request Parameters Configuration</h5>

          {/* All parameters in a responsive grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-6">
            { (topLevelRequestType === "getWithPath" || topLevelRequestType === "postWithJson") &&
              <div>
                {renderKeyInputSection("Path Parameter Keys", currentPathKeyInput, setCurrentPathKeyInput, pathParamKeys, setPathParamKeys, "e.g., userId")}
              </div>
            }

            { (topLevelRequestType === "getWithQuery" || topLevelRequestType === "postWithJson") &&
              <div>
                {renderKeyInputSection("Query Parameter Keys", currentQueryKeyInput, setCurrentQueryKeyInput, queryParamKeys, setQueryParamKeys, "e.g., searchTerm, limit")}
              </div>
            }

            <div>
              {renderKeyInputSection("Additional Header Keys", currentHeaderKeyInput, setCurrentHeaderKeyInput, headerKeys, setHeaderKeys, "e.g., X-Request-ID")}
            </div>

            {/* JSON Body Keys */}
            {topLevelRequestType === "postWithJson" &&
              <div>
                {renderKeyInputSection("JSON Body Keys", currentBodyKeyInput, setCurrentBodyKeyInput, bodyKeys, setBodyKeys, "e.g., name, email")}
              </div>
            }
          </div>
        </div>
      </div>

      {showSubmitButton && (
        <div className="border-t border-gray-200 pt-6 mt-6">
          <button
            type="button"
            onClick={onRegisterProvider}
            className={classNames(
              "w-full px-6 py-3 rounded-lg font-medium text-sm transition-all",
              isWalletConnected
                ? 'bg-blue-600 hover:bg-blue-700 text-white'
                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
            )}
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
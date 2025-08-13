import React, { useState } from 'react';
import classNames from 'classnames';
import { TopLevelRequestType, AuthChoice } from '../types/hypergrid_provider';
import { BsX } from 'react-icons/bs';
import { FaCirclePlus, FaRegHandPointLeft, FaX } from 'react-icons/fa6';
import { FiCheck, FiPlusCircle } from 'react-icons/fi';

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
        className="relative ml-2 "
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
      >
        <div
          className={classNames(
            "w-4 h-4 rounded-full flex items-center justify-center font-bold cursor-pointer flex-shrink-0 transition-all border",
            isVisible ? 'bg-black text-white' : 'bg-gray text-dark-gray'
          )}
        >
          ?
        </div>
        {isVisible && (
          <div
            className="absolute top-0 right-0 bg-black text-white rounded-lg p-2 z-10001 text-center"
            onClick={isMobile ? handleClick : undefined}
          >
            {helpText}
            {isMobile && (
              <div className="mt-2 text-center text-xs opacity-75">
                Tap to close.
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
    <div className="flex flex-col gap-2">
      <label>{label}</label>
      <div className="flex gap-2">
        <input
          type="text"
          value={currentValue}
          onChange={(e) => setter(e.target.value)}
          placeholder={placeholder}
          className="bg-white rounded-lg px-2 py-1 self-stretch  grow"
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
          className="px-3 py-2 bg-black text-cyan rounded-md text-sm self-stretch"
        >
          <span className='text-sm'>Add</span>
          <FiPlusCircle />
        </button>
      </div>
      <div className="flex items-center flex-wrap gap-2">
        {keyList.map(key => (
          <button
            key={key}
            className="px-3 py-1 bg-mid-gray text-sm"
            onClick={() => removeKeyFromList(key, keyList, listSetter)}
            title={`Remove ${key}`}
          >
            <span>{key}</span>
            <BsX className='text-xl' />
          </button>
        ))}
      </div>
    </div>
  );

  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  if (!apiCallFormatSelected) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <h5 className="text-center text-lg font-semibold col-span-3">Select API Call Format</h5>

        <button
          onMouseEnter={() => setHoveredIndex(0)}
          onMouseLeave={() => setHoveredIndex(null)}
          className={classNames("p-4 rounded-lg flex-col text-left !justify-start !items-start", {
            'bg-white': hoveredIndex !== 0,
            '!opacity-100 bg-cyan/30': hoveredIndex === 0,
          })}
          onClick={() => handleSelectFormat("getWithPath")}
        >
          <h6 className="text-lg font-semibold text-dark-gray flex gap-2 items-start">
            <span>GET with Path Parameters</span>
            <span className='bg-mid-gray py-1 px-2 rounded-full animate-pulse'>
              <FaRegHandPointLeft />
            </span>
          </h6>
          <p className="text-sm">
            Use for APIs where primary identifiers are part of the URL path.
          </p>
          <pre className="text-xs p-2 bg-gray rounded whitespace-pre-wrap">
            <code>GET /api/users/{'{user_id}'}/profile</code>
          </pre>
        </button>

        <button
          onMouseEnter={() => setHoveredIndex(1)}
          onMouseLeave={() => setHoveredIndex(null)}
          className={classNames("p-4 rounded-lg flex-col text-left !justify-start !items-start", {
            'bg-white': hoveredIndex !== 1,
            '!opacity-100 bg-cyan/30': hoveredIndex === 1,
          })}
          onClick={() => handleSelectFormat("getWithQuery")}
        >
          <h6 className="text-lg font-semibold flex gap-2 items-start">
            <span>GET with Query Parameters</span>
            <span className='bg-mid-gray py-1 px-2 rounded-full animate-pulse'>
              <FaRegHandPointLeft />
            </span>
          </h6>
          <p className="text-sm">
            Use for APIs that accept filters or options as URL query parameters.
          </p>
          <pre className="text-xs p-2 bg-gray rounded whitespace-pre-wrap">
            <code>GET /api/search?q={'{searchTerm}'}&limit={'{limit}'}</code>
          </pre>
        </button>

        <button
          onMouseEnter={() => setHoveredIndex(2)}
          onMouseLeave={() => setHoveredIndex(null)}
          className={classNames("p-4 rounded-lg flex-col text-left !justify-start !items-start", {
            'bg-white': hoveredIndex !== 2,
            '!opacity-100 bg-cyan/30': hoveredIndex === 2,
          })}
          onClick={() => handleSelectFormat("postWithJson")}
        >
          <h6 className="text-lg font-semibold flex gap-2 items-start">
            <span>POST with JSON Body</span>
            <span className='bg-mid-gray py-1 px-2 rounded-full animate-pulse'>
              <FaRegHandPointLeft />
            </span>
          </h6>
          <p className="text-sm">
            Use for APIs that create or update resources using a JSON payload.
          </p>
          <pre className="text-xs p-2 bg-gray rounded whitespace-pre-wrap">
            <code className="block">POST /api/orders</code>
            <code className="block">{`{ "product_id": "123", "quantity": 2 }`}</code>
          </pre>
        </button>
      </div>
    );
  }

  return (
    <div className="p-6 flex flex-col gap-6">
      <button
        type="button"
        onClick={() => setApiCallFormatSelected(false)}
        className="px-4 py-2 text-sm bg-gray rounded-md self-start"
      >
        &larr; Change API Call Format
      </button>

      <div className="flex flex-col gap-6">
        <h3 className="text-black text-xl flex gap-2 items-center">
          <span className="font-bold">Selected API Format: </span>
          <span>{
            topLevelRequestType === 'getWithPath' ? 'GET with Path Parameters' :
              topLevelRequestType === 'getWithQuery' ? 'GET with Query Parameters' :
                topLevelRequestType === 'postWithJson' ? 'POST with JSON Body' : ''
          }</span>
        </h3>

        <div className="flex flex-col gap-4 bg-gray rounded-lg p-4">
          <h4 className="text-black text-lg font-bold">API Key Placement</h4>
          <div className="flex  gap-2 cursor-pointer">

            {([
              { value: 'query', label: 'Query Param' },
              { value: 'header', label: 'HTTP Header' },
            ] as { value: AuthChoice; label: string }[]).map(({ value, label }) => (
              <div
                key={value}
                onClick={() => setAuthChoice(value)}
                className={classNames(
                  "flex items-center gap-2 rounded-xl px-2 py-1",
                  authChoice === value
                    ? 'bg-cyan text-black border-cyan'
                    : 'bg-white border-black text-black hover:opacity-75'
                )}
                title={label}
              >
                <button className={classNames('rounded-full', {
                  'bg-cyan': authChoice === value,
                  '!border-black': authChoice !== value,
                })}>
                  <FiCheck className={classNames("text-xl", {
                    'opacity-100': authChoice === value,
                    'opacity-0': authChoice !== value,
                  })} />
                </button>

                <span className='text-sm'>{label}</span>
              </div>
            ))}
          </div>
        </div>
        {/* API Key Configuration */}
        <div className="flex flex-col gap-4 bg-gray rounded-lg p-4">

          <div className="flex flex-col gap-2">
            {(authChoice === 'query' || authChoice === 'header') && (
              <div className="flex flex-col gap-2">
                <label htmlFor={authChoice === 'query' ? "apiKeyQueryParamName" : "apiKeyHeaderName"} className="block text-black font-bold">
                  API Key Identifier
                </label>
                {!(authChoice === 'query' ? apiKeyQueryParamName : apiKeyHeaderName) ? (
                  <div className="flex gap-2">
                    <input
                      id={authChoice === 'query' ? "apiKeyQueryParamNameInput" : "apiKeyHeaderNameInput"}
                      type="text"
                      value={authChoice === 'query' ? currentApiKeyQueryNameInput : currentApiKeyHeaderNameInput}
                      onChange={(e) => authChoice === 'query' ? setCurrentApiKeyQueryNameInput(e.target.value) : setCurrentApiKeyHeaderNameInput(e.target.value)}
                      placeholder={authChoice === 'query' ? "e.g., api_key" : "e.g., X-API-Key"}
                      className="self-stretch grow p-2 bg-white rounded-md text-sm"
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
                      className="px-3 py-2 bg-black text-white rounded-md text-sm hover:opacity-75 transition-colors"
                    >
                      Set
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center">
                    <span className="inline-flex items-center px-3 py-1 bg-gray border border-black rounded-md text-sm">
                      {authChoice === 'query' ? apiKeyQueryParamName : apiKeyHeaderName}
                      <button
                        onClick={() => authChoice === 'query' ? setApiKeyQueryParamName('') : setApiKeyHeaderName('')}
                        className="text-dark-gray hover:opacity-75"
                        title={`Remove ${authChoice === 'query' ? apiKeyQueryParamName : apiKeyHeaderName}`}
                      >
                        <BsX />
                      </button>
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right Side: API Key Value */}
          <div className="flex flex-col gap-2">
            <label htmlFor="endpointApiKey" className="block text-black font-bold">
              API Key Value (Secret)
            </label>
            <div className="flex flex-col items-stretch gap-2">
              <input
                id="endpointApiKey"
                type="password"
                value={endpointApiParamKey}
                onChange={(e) => setEndpointApiKey(e.target.value)}
                placeholder="Super Secret API Key"
                className="self-stretch p-2 bg-white rounded-md text-sm"
              />
              <span className='text-sm'>Your secret API key that proves you have permission to access this service. Keep this private!</span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2 bg-gray rounded-lg p-4">
        <h5 className="text-lg font-bold text-black">API Endpoint Details</h5>
        <div className="flex flex-col gap-2">
          <label htmlFor="endpointBaseUrl" className="block text-black font-bold">
            Base URL Template
          </label>
          <div className="flex flex-col items-stretch gap-2">
            <input
              id="endpointBaseUrl"
              type="url"
              value={endpointBaseUrl}
              onChange={(e) => setEndpointBaseUrl(e.target.value)}
              placeholder="https://api.example.com/{id}"
              className="self-stretch p-2 bg-white rounded-md text-sm"
            />
            <span className='text-sm'>Enter the complete web address for your API. For dynamic parts like user IDs, use placeholders like {`{userId}`} and make sure to add 'userId' as a Path Parameter below.</span>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4 bg-gray rounded-lg p-4">
        <h5 className="text-lg font-bold text-black">Request Parameters Configuration</h5>

        {/* All parameters in a responsive grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-4">
          {(topLevelRequestType === "getWithPath" || topLevelRequestType === "postWithJson") &&
            <div>
              {renderKeyInputSection("Path Parameter Keys", currentPathKeyInput, setCurrentPathKeyInput, pathParamKeys, setPathParamKeys, "e.g., userId")}
            </div>
          }

          {(topLevelRequestType === "getWithQuery" || topLevelRequestType === "postWithJson") &&
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

      {showSubmitButton && (
        <div className="border-t border-black pt-6">
          <button
            type="button"
            onClick={onRegisterProvider}
            className={classNames(
              "w-full px-6 py-3 rounded-lg font-medium text-sm transition-all",
              isWalletConnected
                ? 'bg-black text-white hover:opacity-75'
                : 'bg-gray text-dark-gray cursor-not-allowed'
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
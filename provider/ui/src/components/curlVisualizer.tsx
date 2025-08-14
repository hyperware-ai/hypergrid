import React from 'react';
import { HttpMethod } from '../types/hypergrid_provider'; // Updated imports
import { FaCopy } from 'react-icons/fa6';

// Reinstating API Patterns
// REMOVE apiPatterns array

// Reverted CurlVisualizerProps
interface CurlVisualizerProps {
  providerName: string; // Used for placeholder if endpointName is empty
  endpointMethod: HttpMethod;
  endpointBaseUrl: string;
  pathParamKeys: string[]; // New: from form
  queryParamKeys: string[]; // New: from form, distinct from auth key
  headerKeys: string[]; // New: from form, distinct from auth/version headers
  bodyKeys?: string[]; // New: for POST JSON body keys

  // API Key Auth details
  apiKey?: string;
  apiKeyQueryParamName?: string;
  apiKeyHeaderName?: string;

  // Dynamic args example (simulated for preview)
  exampleDynamicArgs?: { [key: string]: string };
}

const CurlVisualizer: React.FC<CurlVisualizerProps> = ({
  providerName,
  endpointMethod,
  endpointBaseUrl,
  pathParamKeys = [],
  queryParamKeys = [],
  headerKeys = [],
  bodyKeys = [],
  apiKey,
  apiKeyQueryParamName,
  apiKeyHeaderName,
  exampleDynamicArgs = {},
}) => {
  let displayUrl = endpointBaseUrl || "{BASE_URL}";
  const opName = providerName || "";

  // Generate smart example values for parameters
  const generateExampleValue = (key: string): string => {
    // Check if user provided a value
    if (exampleDynamicArgs[key]) {
      return exampleDynamicArgs[key];
    }
    
    // Generate smart defaults based on parameter name
    const lowerKey = key.toLowerCase();
    if (lowerKey.includes('id')) {
      return '123';
    } else if (lowerKey.includes('name') || lowerKey.includes('title')) {
      return 'example';
    } else if (lowerKey.includes('email')) {
      return 'user@example.com';
    } else if (lowerKey.includes('limit') || lowerKey.includes('count') || lowerKey.includes('size')) {
      return '10';
    } else if (lowerKey.includes('page') || lowerKey.includes('offset')) {
      return '1';
    } else if (lowerKey.includes('format')) {
      return 'json';
    } else if (lowerKey.includes('include') || lowerKey.includes('fields')) {
      return 'details';
    } else if (lowerKey.includes('sort')) {
      return 'name';
    } else if (lowerKey.includes('order')) {
      return 'asc';
    } else {
      return 'value';
    }
  };

  // Simulate path parameter substitution for preview
  (pathParamKeys || []).forEach(key => {
    const placeholder = `{${key}}`;
    const value = generateExampleValue(key);
    displayUrl = displayUrl.replace(placeholder, value);
  });

  const queryParts: string[] = [];
  (queryParamKeys || []).forEach(key => {
    const value = generateExampleValue(key);
    queryParts.push(`${key}=${value}`);
  });

  if (apiKey && apiKeyQueryParamName) {
    queryParts.push(`${apiKeyQueryParamName}=${apiKey ? apiKey.substring(0, 3) + '********' : '{API_KEY}'}`);
  }

  const displayQuery = queryParts.length > 0 ? `?${queryParts.join('&')}` : "";

  const headersToShow: { key: string, value: string }[] = [];
  if (endpointMethod === HttpMethod.POST) {
    headersToShow.push({ key: "Content-Type", value: "application/json" });
  }

  (headerKeys || []).forEach(key => {
    const value = generateExampleValue(key);
    headersToShow.push({ key: key, value: value });
  });

  if (apiKey && apiKeyHeaderName) {
    headersToShow.push({ key: apiKeyHeaderName, value: `${apiKey ? apiKey.substring(0, 3) + '********' : '{API_KEY}'}` });
  }

  let exampleBody = {};
  if (endpointMethod === HttpMethod.POST && bodyKeys.length > 0) {
    exampleBody = bodyKeys.reduce((acc, key) => {
      acc[key] = generateExampleValue(key);
      return acc;
    }, {} as { [key: string]: string });
  }

  // Construct the cURL command
  let curlCommand = "curl";

  if (endpointMethod === HttpMethod.POST) {
    curlCommand += " -X POST";
  } else {
    curlCommand += " -X GET"; // Explicitly add -X GET
  }

  headersToShow.forEach(h => {
    curlCommand += ` \\\n  -H "${h.key}: ${h.value}"`;
  });

  if (endpointMethod === HttpMethod.POST && Object.keys(exampleBody).length > 0) {
    // For the -d field, it's often better to have compact JSON.
    // Using single quotes around the JSON data payload is safer for shell.
    curlCommand += ` \\\n  -d '${JSON.stringify(exampleBody)}'`;
  }

  curlCommand += ` \\\n  "${displayUrl}${displayQuery}"`;

  return (
    <div className="flex flex-col gap-4 bg-white rounded-lg p-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold">API Structure Preview</h3>
        <button 
          className="text-xs bg-gray-200 hover:bg-gray-300 rounded px-3 py-1.5 flex items-center gap-1.5 transition-colors" 
          onClick={() => {
            navigator.clipboard.writeText(curlCommand);
          }}
        >
          📋 Copy
        </button>
      </div>
      <div className="relative">
        <pre className="font-mono text-sm p-4 bg-gray-50 border border-gray-200 rounded-lg overflow-x-auto whitespace-pre-wrap break-all">
          <code>
            {curlCommand}
          </code>
        </pre>
      </div>
    </div>
  );
};

export default CurlVisualizer; 
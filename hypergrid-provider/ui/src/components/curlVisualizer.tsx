import React from 'react';
import {HttpMethod} from '../types/hypergrid_provider'; // Updated imports

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
  exampleDynamicArgs = { arg1: "value1", path_id: "123" },
}) => {
  let displayUrl = endpointBaseUrl || "{BASE_URL}";
  const opName = providerName || "";

  // Simulate path parameter substitution for preview
  (pathParamKeys || []).forEach(key => {
    const placeholder = `{${key}}`;
    let value = exampleDynamicArgs[key] || `{${key}_value}`;
    displayUrl = displayUrl.replace(placeholder, value);
  });

  const queryParts: string[] = [];
  (queryParamKeys || []).forEach(key => {
    queryParts.push(`${key}=${exampleDynamicArgs[key] || `{${key}_value}`}`);
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
    headersToShow.push({ key: key, value: exampleDynamicArgs[key] || `{${key}_value}` });
  });

  if (apiKey && apiKeyHeaderName) {
    headersToShow.push({ key: apiKeyHeaderName, value: `${apiKey ? apiKey.substring(0, 3) + '********' : '{API_KEY}'}` });
  }

  let exampleBody = {};
  if (endpointMethod === HttpMethod.POST && bodyKeys.length > 0) {
    exampleBody = bodyKeys.reduce((acc, key) => {
      acc[key] = exampleDynamicArgs[key] || `{${key}_value}`;
      return acc;
    }, {} as {[key: string]: string});
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
    <div className="api-scaffold-container form-section">
      <h3>API Structure Preview</h3>
      <div className="horizontal-scroll">
        <pre className="api-scaffold-content">
          <code>
            {curlCommand}
          </code>
        </pre>
      </div>
    </div>
  );
};

export default CurlVisualizer; 
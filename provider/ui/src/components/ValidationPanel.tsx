import React, { useState, useEffect } from 'react';
import { RegisteredProvider } from '../types/hypergrid_provider';
import { HttpMethod, RequestStructureType } from '../types/hypergrid_provider';
import { validateProviderApi } from '../utils/api';

interface ValidationPanelProps {
  provider: RegisteredProvider;
  onValidationSuccess: (provider: RegisteredProvider) => void; // Pass original provider for blockchain registration
  onValidationError: (error: string) => void;
  onCancel: () => void;
}

interface ValidationArgs {
  [key: string]: string;
}

const ValidationPanel: React.FC<ValidationPanelProps> = ({
  provider,
  onValidationSuccess,
  onValidationError,
  onCancel,
}) => {
  const [validationArgs, setValidationArgs] = useState<ValidationArgs>({});
  const [isValidating, setIsValidating] = useState(false);

  // Generate sample values for placeholders
  const getSampleValue = (key: string, paramType: 'path' | 'query' | 'header' | 'body'): string => {
    switch (paramType) {
      case 'path':
        return key === 'id' ? '123' : `sample_${key}`;
      case 'query':
        return key === 'limit' ? '10' : `sample_${key}`;
      case 'header':
        return key.toLowerCase().includes('version') ? '1.0' : `sample_${key}`;
      case 'body':
        return `sample_${key}`;
      default:
        return `sample_${key}`;
    }
  };

  const generateCurlPreview = (): string => {
    let url = provider.endpoint.base_url_template;
    const queryParams: string[] = [];
    const headers: string[] = [];
    let bodyData: { [key: string]: string } = {};

    switch (provider.endpoint.request_structure) {
      case RequestStructureType.GetWithPath:
        if (provider.endpoint.path_param_keys) {
          provider.endpoint.path_param_keys.forEach(key => {
            const value = validationArgs[key] || getSampleValue(key, 'path');
            url = url.replace(`{${key}}`, value);
          });
        }
        break;

      case RequestStructureType.GetWithQuery:
        if (provider.endpoint.query_param_keys) {
          provider.endpoint.query_param_keys.forEach(key => {
            const value = validationArgs[key] || getSampleValue(key, 'query');
            queryParams.push(`${key}=${encodeURIComponent(value)}`);
          });
        }
        break;

      case RequestStructureType.PostWithJson:
        if (provider.endpoint.path_param_keys) {
          provider.endpoint.path_param_keys.forEach(key => {
            const value = validationArgs[key] || getSampleValue(key, 'path');
            url = url.replace(`{${key}}`, value);
          });
        }
        if (provider.endpoint.query_param_keys) {
          provider.endpoint.query_param_keys.forEach(key => {
            const value = validationArgs[key] || getSampleValue(key, 'query');
            queryParams.push(`${key}=${encodeURIComponent(value)}`);
          });
        }
        if (provider.endpoint.body_param_keys) {
          provider.endpoint.body_param_keys.forEach(key => {
            bodyData[key] = validationArgs[key] || getSampleValue(key, 'body');
          });
        }
        break;
    }

    if (provider.endpoint.api_key && provider.endpoint.api_key_query_param_name) {
      queryParams.push(`${provider.endpoint.api_key_query_param_name}=${provider.endpoint.api_key.substring(0, 3)}...`);
    }

    if (provider.endpoint.method === HttpMethod.POST) {
      headers.push('-H "Content-Type: application/json"');
    }

    if (provider.endpoint.header_keys) {
      provider.endpoint.header_keys.forEach(key => {
        const value = validationArgs[key] || getSampleValue(key, 'header');
        headers.push(`-H "${key}: ${value}"`);
      });
    }

    if (provider.endpoint.api_key && provider.endpoint.api_key_header_name) {
      headers.push(`-H "${provider.endpoint.api_key_header_name}: ${provider.endpoint.api_key.substring(0, 3)}..."`);
    }

    const finalUrl = queryParams.length > 0 ? `${url}?${queryParams.join('&')}` : url;

    let curlCommand = `curl -X ${provider.endpoint.method}`;

    if (headers.length > 0) {
      curlCommand += ` \\\n  ${headers.join(' \\\n  ')}`;
    }

    if (provider.endpoint.method === HttpMethod.POST && Object.keys(bodyData).length > 0) {
      curlCommand += ` \\\n  -d '${JSON.stringify(bodyData)}'`;
    }

    curlCommand += ` \\\n  "${finalUrl}"`;

    return curlCommand;
  };

  const handleValidationArgChange = (key: string, value: string) => {
    setValidationArgs(prev => ({
      ...prev,
      [key]: value
    }));
  };

  const handleValidate = async () => {
    setIsValidating(true);

    try {
      const validationArguments: [string, string][] = Object.entries(validationArgs);

      // Validate and cache the provider in backend
      const result = await validateProviderApi(provider, validationArguments);

      if (result.success) {
        onValidationSuccess(provider);
      } else {
        onValidationError(result.error || 'Validation failed');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown validation error';
      onValidationError(errorMessage);
    } finally {
      setIsValidating(false);
    }
  };

  const getAllParamKeysWithTypes = (): Array<{ key: string; type: 'path' | 'query' | 'header' | 'body' }> => {
    const params: Array<{ key: string; type: 'path' | 'query' | 'header' | 'body' }> = [];

    if (provider.endpoint.path_param_keys) {
      provider.endpoint.path_param_keys.forEach(key => params.push({ key, type: 'path' }));
    }
    if (provider.endpoint.query_param_keys) {
      provider.endpoint.query_param_keys.forEach(key => params.push({ key, type: 'query' }));
    }
    if (provider.endpoint.header_keys) {
      provider.endpoint.header_keys.forEach(key => params.push({ key, type: 'header' }));
    }
    if (provider.endpoint.body_param_keys && provider.endpoint.method === HttpMethod.POST) {
      provider.endpoint.body_param_keys.forEach(key => params.push({ key, type: 'body' }));
    }

    return params;
  };

  const allParams = getAllParamKeysWithTypes();

  return (
    <div className="flex flex-col">
      {/* Header Section */}
      <div className="text-center mb-8">
        <h1 className="text-xl font-bold text-dark-gray dark:text-gray mb-2">Validate Your Provider</h1>
        <p className="text-dark-gray dark:text-gray max-w-lg mx-auto">
          Let's test your API endpoint to make sure it is configured correctly:
        </p>
      </div>

      {/* Main Content */}
      <div className="flex flex-col items-center space-y-6">
        {/* Test Parameters Section */}
        {allParams.length > 0 && (
          <div className="w-full max-w-xl">
            <div className="bg-gradient-to-b from-gray-50 to-white dark:to-black border border-gray-200 rounded-xl shadow-md p-6">
              <h3 className="text-lg font-bold text-dark-gray dark:text-gray text-center mb-6">Test Parameters</h3>
              <div className={allParams.length === 1 ? "flex justify-center" : "grid grid-cols-1 md:grid-cols-2 gap-4"}>
                {allParams.map(({ key, type }) => (
                  <div key={key} className={allParams.length === 1 ? "w-full max-w-xs" : "group"}>
                    <label
                      htmlFor={`validation-${key}`}
                      className="block text-sm font-semibold text-dark-gray dark:text-gray mb-1.5 text-center"
                    >
                      {key} <span className="text-dark-gray dark:text-gray font-normal">({type})</span>
                    </label>
                    <input
                      id={`validation-${key}`}
                      type="text"
                      value={validationArgs[key] || ''}
                      onChange={(e) => handleValidationArgChange(key, e.target.value)}
                      placeholder={getSampleValue(key, type)}
                      className="w-full px-4 py-2.5 text-center border border-gray-200 rounded-lg
                               bg-white text-dark-gray dark:bg-black dark:text-gray
                                transition-all duration-200
                               shadow-sm focus:shadow-md"
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Preview API Call Section */}
        <div className="w-full max-w-xl">
          <div className="bg-gradient-to-b from-gray-50 to-white dark:to-black border border-gray-200 dark:border-white rounded-xl shadow-md p-6">
            <h3 className="text-lg font-bold text-dark-gray dark:text-gray text-center mb-4">Preview API Call</h3>
            <div className="bg-gray dark:bg-dark-gray rounded-lg p-4 overflow-x-auto shadow-inner">
              <pre className="text-green-400 dark:text-green-400 text-sm font-mono whitespace-pre-wrap text-center">
                <code>{generateCurlPreview()}</code>
              </pre>
            </div>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex justify-center gap-3 mt-6 pt-4 border-t border-gray-100">
        <button
          type="button"
          onClick={handleValidate}
          disabled={isValidating}
          className="px-6 py-2.5 bg-gray-900 text-white font-medium rounded-lg
                   hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2
                   disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200
                   shadow-sm hover:shadow-md"
        >
          {isValidating ? 'Validating...' : 'Validate & Register'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isValidating}
          className="px-6 py-2.5 bg-white text-gray-700 font-medium rounded-lg border border-gray-300
                   hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2
                   disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200
                   shadow-sm hover:shadow-md"
        >
          Back to Configuration
        </button>
      </div>
    </div>
  );
};

export default ValidationPanel;
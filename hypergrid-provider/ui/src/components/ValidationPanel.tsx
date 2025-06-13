import React, { useState, useEffect } from 'react';
import { RegisteredProvider, ValidateAndRegisterRequest } from '../types/hypergrid_provider';
import { HttpMethod, RequestStructureType } from '../types/hypergrid_provider';
import { validateAndRegisterProviderApi } from '../utils/api';
import { processRegistrationResponse } from '../utils/providerFormUtils';
import type { ApiResponseFeedback } from '../utils/providerFormUtils';

interface ValidationPanelProps {
  provider: RegisteredProvider;
  onValidationSuccess: (registeredProvider: RegisteredProvider) => void;
  onValidationError: (error: string) => void;
  onCancel: () => void;
}

interface ValidationArgs {
  [key: string]: string;
}

export const ValidationPanel: React.FC<ValidationPanelProps> = ({
  provider,
  onValidationSuccess,
  onValidationError,
  onCancel,
}) => {
  const [validationArgs, setValidationArgs] = useState<ValidationArgs>({});
  const [isValidating, setIsValidating] = useState(false);
  const [feedback, setFeedback] = useState<ApiResponseFeedback | null>(null);

  // Initialize validation args with sample values
  useEffect(() => {
    const initialArgs: ValidationArgs = {};
    
    // Add path params
    if (provider.endpoint.path_param_keys) {
      provider.endpoint.path_param_keys.forEach(key => {
        initialArgs[key] = key === 'id' ? '123' : `sample_${key}`;
      });
    }
    
    // Add query params
    if (provider.endpoint.query_param_keys) {
      provider.endpoint.query_param_keys.forEach(key => {
        initialArgs[key] = key === 'limit' ? '10' : `sample_${key}`;
      });
    }
    
    // Add headers
    if (provider.endpoint.header_keys) {
      provider.endpoint.header_keys.forEach(key => {
        initialArgs[key] = key.toLowerCase().includes('version') ? '1.0' : `sample_${key}`;
      });
    }
    
    // Add body params for POST
    if (provider.endpoint.body_param_keys && provider.endpoint.method === HttpMethod.POST) {
      provider.endpoint.body_param_keys.forEach(key => {
        initialArgs[key] = `sample_${key}`;
      });
    }
    
    setValidationArgs(initialArgs);
  }, [provider]);

  // Generate curl preview
  const generateCurlPreview = (): string => {
    let url = provider.endpoint.base_url_template;
    const queryParams: string[] = [];
    const headers: string[] = [];
    let bodyData: { [key: string]: string } = {};

    // Process based on request structure
    switch (provider.endpoint.request_structure) {
      case RequestStructureType.GetWithPath:
        // Replace path parameters
        if (provider.endpoint.path_param_keys) {
          provider.endpoint.path_param_keys.forEach(key => {
            const value = validationArgs[key] || `{${key}}`;
            url = url.replace(`{${key}}`, value);
          });
        }
        break;
      
      case RequestStructureType.GetWithQuery:
        // Add query parameters
        if (provider.endpoint.query_param_keys) {
          provider.endpoint.query_param_keys.forEach(key => {
            const value = validationArgs[key] || `{${key}}`;
            queryParams.push(`${key}=${encodeURIComponent(value)}`);
          });
        }
        break;
      
      case RequestStructureType.PostWithJson:
        // Replace path parameters
        if (provider.endpoint.path_param_keys) {
          provider.endpoint.path_param_keys.forEach(key => {
            const value = validationArgs[key] || `{${key}}`;
            url = url.replace(`{${key}}`, value);
          });
        }
        // Add query parameters
        if (provider.endpoint.query_param_keys) {
          provider.endpoint.query_param_keys.forEach(key => {
            const value = validationArgs[key] || `{${key}}`;
            queryParams.push(`${key}=${encodeURIComponent(value)}`);
          });
        }
        // Add body parameters
        if (provider.endpoint.body_param_keys) {
          provider.endpoint.body_param_keys.forEach(key => {
            bodyData[key] = validationArgs[key] || `{${key}}`;
          });
        }
        break;
    }

    // Add API key to query if configured
    if (provider.endpoint.api_key && provider.endpoint.api_key_query_param_name) {
      queryParams.push(`${provider.endpoint.api_key_query_param_name}=${provider.endpoint.api_key.substring(0, 3)}...`);
    }

    // Add headers
    if (provider.endpoint.method === HttpMethod.POST) {
      headers.push('-H "Content-Type: application/json"');
    }
    
    if (provider.endpoint.header_keys) {
      provider.endpoint.header_keys.forEach(key => {
        const value = validationArgs[key] || `{${key}}`;
        headers.push(`-H "${key}: ${value}"`);
      });
    }
    
    if (provider.endpoint.api_key && provider.endpoint.api_key_header_name) {
      headers.push(`-H "${provider.endpoint.api_key_header_name}: ${provider.endpoint.api_key.substring(0, 3)}..."`);
    }

    // Build final URL
    const finalUrl = queryParams.length > 0 ? `${url}?${queryParams.join('&')}` : url;
    
    // Build curl command
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
    setFeedback(null);

    try {
      // Convert validationArgs to the format expected by the API
      const validationArguments: [string, string][] = Object.entries(validationArgs);
      
      const payload: ValidateAndRegisterRequest = {
        ValidateAndRegisterProvider: {
          provider,
          validation_arguments: validationArguments,
        },
      };

      const response = await validateAndRegisterProviderApi(payload);
      const feedback = processRegistrationResponse(response);
      
      if (feedback.status === 'success' && response.Ok) {
        onValidationSuccess(response.Ok);
      } else {
        onValidationError(feedback.message);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown validation error';
      onValidationError(errorMessage);
    } finally {
      setIsValidating(false);
    }
  };

  // Get all parameter keys that need values
  const getAllParamKeys = (): string[] => {
    const keys = new Set<string>();
    
    if (provider.endpoint.path_param_keys) {
      provider.endpoint.path_param_keys.forEach(key => keys.add(key));
    }
    if (provider.endpoint.query_param_keys) {
      provider.endpoint.query_param_keys.forEach(key => keys.add(key));
    }
    if (provider.endpoint.header_keys) {
      provider.endpoint.header_keys.forEach(key => keys.add(key));
    }
    if (provider.endpoint.body_param_keys && provider.endpoint.method === HttpMethod.POST) {
      provider.endpoint.body_param_keys.forEach(key => keys.add(key));
    }
    
    return Array.from(keys);
  };

  const paramKeys = getAllParamKeys();

  return (
    <div className="validation-panel form-section">
      <h3>Validate Your Provider</h3>
      <p>Before registering, let's test your API endpoint to make sure it works correctly. Fill in sample values for the parameters below:</p>
      
      {/* Parameter inputs */}
      {paramKeys.length > 0 && (
        <div className="validation-inputs">
          <h4>Test Parameters</h4>
          {paramKeys.map(key => (
            <div key={key} className="form-group">
              <label htmlFor={`validation-${key}`}>
                {key}:
              </label>
              <input
                id={`validation-${key}`}
                type="text"
                value={validationArgs[key] || ''}
                onChange={(e) => handleValidationArgChange(key, e.target.value)}
                placeholder={`Enter value for ${key}`}
              />
            </div>
          ))}
        </div>
      )}
      
      {/* Curl preview */}
      <div className="curl-preview">
        <h4>Preview API Call</h4>
        <pre className="api-scaffold-content">
          <code>{generateCurlPreview()}</code>
        </pre>
      </div>
      
      {/* Feedback display */}
      {feedback && (
        <div className={`feedback ${feedback.status}`}>
          {feedback.message}
        </div>
      )}
      
      {/* Action buttons */}
      <div className="validation-actions">
        <button
          type="button"
          onClick={handleValidate}
          disabled={isValidating}
          className="btn-primary"
        >
          {isValidating ? 'Validating...' : 'Validate & Register'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isValidating}
          className="btn-secondary"
        >
          Back to Configuration
        </button>
      </div>
    </div>
  );
}; 
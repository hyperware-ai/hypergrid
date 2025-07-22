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
    <div className="validation-panel form-section">
      <h3 style={{ marginTop: 0 }}>Validate Your Provider</h3>
      <p>Let's test your API endpoint to make sure it is configured correctly:</p>
      
      <div className="validation-columns">
        {allParams.length > 0 && (
          <div className="validation-inputs">
            <h4>Test Parameters</h4>
            <div className="validation-params-grid">
              {allParams.map(({ key, type }) => (
                <div key={key} className="validation-param-item">
                  <label htmlFor={`validation-${key}`} className="validation-param-label">
                    {key} ({type})
                  </label>
                  <input
                    id={`validation-${key}`}
                    type="text"
                    value={validationArgs[key] || ''}
                    onChange={(e) => handleValidationArgChange(key, e.target.value)}
                    placeholder={getSampleValue(key, type)}
                    className="validation-param-input"
                  />
                </div>
              ))}
            </div>
          </div>
        )}
        
        <div className="curl-preview">
          <h4>Preview API Call</h4>
          <pre className="api-scaffold-content">
            <code>{generateCurlPreview()}</code>
          </pre>
        </div>
              </div>
        
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

export default ValidationPanel; 
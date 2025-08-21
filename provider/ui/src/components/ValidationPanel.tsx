import React, { useState, useEffect, useMemo } from 'react';
import { validateProviderApi } from '../utils/api';

interface ValidationPanelProps {
  curlTemplate: any; // The backend format from EnhancedCurlImportModal
  providerMetadata: {
    providerName: string;
    providerDescription: string;
    instructions: string;
    registeredProviderWallet: string;
    price: number;
  };
  onValidationSuccess: (validatedProvider: any) => void;
  onValidationError: (error: string) => void;
  onCancel: () => void;
}

interface ValidationArgs {
  [key: string]: string;
}

const ValidationPanel: React.FC<ValidationPanelProps> = ({
  curlTemplate,
  providerMetadata,
  onValidationSuccess,
  onValidationError,
  onCancel,
}) => {
  const [validationArgs, setValidationArgs] = useState<ValidationArgs>(() => {
    // Pre-populate with example values from the cURL template
    const initialArgs: ValidationArgs = {};
    curlTemplate.parameters?.forEach((param: any) => {
      let exampleValue = param.example_value || '';
      
      // If the example value is a JSON string (has quotes around it), 
      // extract the inner value for user-friendly display
      if (typeof exampleValue === 'string' && 
          exampleValue.startsWith('"') && 
          exampleValue.endsWith('"') && 
          exampleValue.length > 1) {
        try {
          // Parse to remove the JSON quotes
          exampleValue = JSON.parse(exampleValue);
        } catch (e) {
          // If parsing fails, keep the original value
        }
      }
      
      initialArgs[param.parameter_name] = String(exampleValue);
    });
    return initialArgs;
  });
  const [isValidating, setIsValidating] = useState(false);
  const [validationSuccessful, setValidationSuccessful] = useState(false);
  const [validationMessage, setValidationMessage] = useState<string>('');

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



  const handleValidationArgChange = (key: string, value: string) => {
    console.log('DEBUG: ValidationPanel - arg changed:', key, '=', value);
    setValidationArgs(prev => {
      const newArgs = {
        ...prev,
        [key]: value
      };
      console.log('DEBUG: New validationArgs:', newArgs);
      return newArgs;
    });
  };

  const handleValidate = async () => {
    setIsValidating(true);

    try {
      // Prepare arguments for validation as array of tuples
      const argumentValues: [string, string][] = [];
      curlTemplate.parameters?.forEach((param: any) => {
        const value = validationArgs[param.parameter_name] || param.example_value;
        argumentValues.push([param.parameter_name, String(value)]);
      });

      // Create the provider object for validation
      const provider = {
        provider_name: providerMetadata.providerName,
        provider_id: (window as any).our?.node || '', // Will be set by backend
        description: providerMetadata.providerDescription,
        instructions: providerMetadata.instructions,
        registered_provider_wallet: providerMetadata.registeredProviderWallet,
        price: providerMetadata.price,
        endpoint: curlTemplate // The curlTemplate IS the new EndpointDefinition
      };

      // Send provider object and arguments for validation
      const result = await validateProviderApi(provider, argumentValues);

      if (result.success && result.validatedProvider) {
        // Set success state and message
        setValidationSuccessful(true);
        setValidationMessage('Validation successful! You can now register your provider.');
        // Store the validated provider for later use
        (window as any).validatedProvider = result.validatedProvider;
      } else {
        setValidationSuccessful(false);
        setValidationMessage(result.error || 'Validation failed');
        onValidationError(result.error || 'Validation failed');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown validation error';
      setValidationSuccessful(false);
      setValidationMessage(errorMessage);
      onValidationError(errorMessage);
    } finally {
      setIsValidating(false);
    }
  };

  // Get all parameters from the cURL template
  const allParams = curlTemplate.parameters || [];

  // Helper function to format cURL commands for better display
  const formatCurlCommand = (curl: string): string => {
    return curl
      .replace(/\s+/g, ' ') // Normalize whitespace
      .replace(/\s*\\\s*/g, ' \\\n  ') // Format line continuations
      .replace(/(-[A-Za-z])\s+/g, '$1 ') // Ensure single space after flags
      .trim();
  };

  // Generate a substituted cURL template for preview
  const substitutedCurl = useMemo(() => {
    console.log('DEBUG: useMemo called at', Date.now(), 'with validationArgs:', validationArgs);
    let result = curlTemplate.original_curl || '';
    
    // Simple approach: just replace parameter values directly in the string
    allParams.forEach((param: any) => {
      const currentValue = validationArgs[param.parameter_name] || param.example_value || '';
      const originalValue = param.example_value || '';
      
              // Only substitute if we have different values and they exist
        if (originalValue && currentValue && currentValue !== originalValue) {
          if (param.location === 'body') {
            // For JSON body parameters, ensure proper quoting
            // Look for the pattern: "key": "originalValue" and replace with "key": "currentValue"
            const quotedPattern = `"${param.parameter_name}": "${originalValue}"`;
            const quotedReplacement = `"${param.parameter_name}": "${currentValue}"`;
            
            if (result.includes(quotedPattern)) {
              result = result.split(quotedPattern).join(quotedReplacement);
            } else {
              // Alternative: look for unquoted pattern and fix it
              const unquotedPattern = `"${param.parameter_name}": ${originalValue}`;
              const fixedReplacement = `"${param.parameter_name}": "${currentValue}"`;
              
              if (result.includes(unquotedPattern)) {
                result = result.split(unquotedPattern).join(fixedReplacement);
              } else {
                // Final fallback: replace just the value but ensure it gets quoted
                const valuePattern = `"${originalValue}"`;
                const valueReplacement = `"${currentValue}"`;
                if (result.includes(valuePattern)) {
                  result = result.split(valuePattern).join(valueReplacement);
                }
              }
            }
          } else {
            // For headers, query params, etc., do direct replacement
            result = result.split(originalValue).join(currentValue);
          }
        }
    });
    
    console.log('DEBUG: Final result:', result);
    
    // Format the cURL for better readability
    return formatCurlCommand(result);
  }, [validationArgs, curlTemplate, allParams, JSON.stringify(validationArgs)]);

  return (
    <div className="flex flex-col items-center max-w-2xl mx-auto">
      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
          Validate Provider
        </h1>
        <p className="text-gray-600 dark:text-gray-400">
          Test your API endpoint to ensure it's configured correctly
        </p>
      </div>

      {/* Parameters Section */}
      {allParams.length > 0 && (
        <div className="w-full mb-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            Test Parameters
          </h3>
          <div className="space-y-4">
            {allParams.map((param: any) => (
              <div key={param.parameter_name}>
                <label
                  htmlFor={`validation-${param.parameter_name}`}
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                >
                  {param.parameter_name}
                  <span className="text-gray-500 ml-1">({param.location})</span>
                </label>
                <input
                  id={`validation-${param.parameter_name}`}
                  type="text"
                  value={validationArgs[param.parameter_name] || ''}
                  onChange={(e) => handleValidationArgChange(param.parameter_name, e.target.value)}
                  placeholder={(() => {
                    let placeholder = param.example_value || '';
                    if (typeof placeholder === 'string' && 
                        placeholder.startsWith('"') && 
                        placeholder.endsWith('"') && 
                        placeholder.length > 1) {
                      try {
                        placeholder = JSON.parse(placeholder);
                      } catch (e) {
                        // Keep original if parsing fails
                      }
                    }
                    return String(placeholder);
                  })()}
                  className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg
                           bg-white dark:bg-gray-800 text-gray-900 dark:text-white
                           focus:ring-2 focus:ring-blue-500 focus:border-blue-500
                           transition-colors duration-200"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* cURL Preview */}
      <div className="w-full mb-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Generated Request
        </h3>
        <div className="bg-gray-900 dark:bg-gray-800 rounded-lg p-4 overflow-x-auto">
          <pre className="text-green-400 text-sm font-mono whitespace-pre-wrap">
            <code>{substitutedCurl}</code>
          </pre>
        </div>
      </div>

      {/* Validation Result */}
      {validationMessage && (
        <div className={`w-full mb-6 p-4 rounded-lg ${
          validationSuccessful 
            ? 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200 border border-green-200 dark:border-green-800'
            : 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200 border border-red-200 dark:border-red-800'
        }`}>
          <div className="flex items-center">
            <div className={`w-2 h-2 rounded-full mr-3 ${
              validationSuccessful ? 'bg-green-500' : 'bg-red-500'
            }`}></div>
            {validationMessage}
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex gap-3 w-full">
        <button
          type="button"
          onClick={onCancel}
          disabled={isValidating}
          className="flex-1 px-4 py-3 text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 
                   border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700
                   focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2
                   disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200"
        >
          Back to Configuration
        </button>
        
        {!validationSuccessful ? (
          <button
            type="button"
            onClick={handleValidate}
            disabled={isValidating}
            className="flex-1 px-4 py-3 bg-blue-600 text-white font-medium rounded-lg
                     hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
                     disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200"
          >
            {isValidating ? 'Validating...' : 'Validate'}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onValidationSuccess((window as any).validatedProvider)}
            className="flex-1 px-4 py-3 bg-green-600 text-white font-medium rounded-lg
                     hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2
                     transition-colors duration-200"
          >
            Register Provider
          </button>
        )}
      </div>
    </div>
  );
};

export default ValidationPanel;
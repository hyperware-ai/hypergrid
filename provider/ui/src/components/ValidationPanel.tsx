import React, { useState, useEffect } from 'react';
import { RegisteredProvider } from '../types/hypergrid_provider';
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

  // Generate sample value for a variable
  const getSampleValue = (variableName: string): string => {
    const variable = provider.endpoint.variables.find(v => v.name === variableName);
    if (variable?.example_value) {
      return variable.example_value;
    }
    // Default sample values based on common patterns
    if (variableName.toLowerCase().includes('id')) return '123';
    if (variableName.toLowerCase().includes('limit')) return '10';
    if (variableName.toLowerCase().includes('version')) return '1.0';
    return `sample_${variableName}`;
  };

  const generateCurlPreview = (): string => {
    // Simple variable substitution on the curl template
    let preview = provider.endpoint.curl_template;
    
    provider.endpoint.variables.forEach(variable => {
      const value = validationArgs[variable.name] || getSampleValue(variable.name);
      const placeholder = `{{${variable.name}}}`;
      preview = preview.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), value);
    });
    
    return preview;
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

  const variables = provider.endpoint.variables || [];

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
        {variables.length > 0 && (
          <div className="w-full max-w-xl">
            <div className="bg-gradient-to-b from-gray-50 to-white dark:to-black border border-gray-200 rounded-xl shadow-md p-6">
              <h3 className="text-lg font-bold text-dark-gray dark:text-gray text-center mb-6">Test Parameters</h3>
              <div className={variables.length === 1 ? "flex justify-center" : "grid grid-cols-1 md:grid-cols-2 gap-4"}>
                {variables.map((variable) => (
                  <div key={variable.name} className={variables.length === 1 ? "w-full max-w-xs" : "group"}>
                    <label
                      htmlFor={`validation-${variable.name}`}
                      className="block text-sm font-semibold text-dark-gray dark:text-gray mb-1.5 text-center"
                    >
                      {variable.name}
                    </label>
                    <input
                      id={`validation-${variable.name}`}
                      type="text"
                      value={validationArgs[variable.name] || ''}
                      onChange={(e) => handleValidationArgChange(variable.name, e.target.value)}
                      placeholder={variable.example_value || getSampleValue(variable.name)}
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
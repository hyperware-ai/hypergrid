import React, { useState, useEffect } from 'react';
import { validateProviderApi } from '../utils/api';

interface ValidationPanelProps {
  curlTemplate: any; // The backend format from EnhancedCurlImportModal
  onValidationSuccess: (curlTemplate: any) => void;
  onValidationError: (error: string) => void;
  onCancel: () => void;
}

interface ValidationArgs {
  [key: string]: string;
}

const ValidationPanel: React.FC<ValidationPanelProps> = ({
  curlTemplate,
  onValidationSuccess,
  onValidationError,
  onCancel,
}) => {
  const [validationArgs, setValidationArgs] = useState<ValidationArgs>(() => {
    // Pre-populate with example values from the cURL template
    const initialArgs: ValidationArgs = {};
    curlTemplate.parameters?.forEach((param: any) => {
      initialArgs[param.parameter_name] = String(param.example_value || '');
    });
    return initialArgs;
  });
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



  const handleValidationArgChange = (key: string, value: string) => {
    setValidationArgs(prev => ({
      ...prev,
      [key]: value
    }));
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

      // Send both template and arguments for validation
      const result = await validateProviderApi(curlTemplate, argumentValues);

      if (result.success) {
        // Pass the template back for registration
        onValidationSuccess(curlTemplate);
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

  // Get all parameters from the cURL template
  const allParams = curlTemplate.parameters || [];

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
                {allParams.map((param: any) => (
                  <div key={param.parameter_name} className={allParams.length === 1 ? "w-full max-w-xs" : "group"}>
                    <label
                      htmlFor={`validation-${param.parameter_name}`}
                      className="block text-sm font-semibold text-dark-gray dark:text-gray mb-1.5 text-center"
                    >
                      {param.parameter_name} <span className="text-dark-gray dark:text-gray font-normal">({param.location})</span>
                    </label>
                    <input
                      id={`validation-${param.parameter_name}`}
                      type="text"
                      value={validationArgs[param.parameter_name] || ''}
                      onChange={(e) => handleValidationArgChange(param.parameter_name, e.target.value)}
                      placeholder={String(param.example_value || '')}
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

        {/* Original cURL Template */}
        <div className="w-full max-w-xl">
          <div className="bg-gradient-to-b from-gray-50 to-white dark:to-black border border-gray-200 dark:border-white rounded-xl shadow-md p-6">
            <h3 className="text-lg font-bold text-dark-gray dark:text-gray text-center mb-4">Original cURL Template</h3>
            <div className="bg-gray dark:bg-dark-gray rounded-lg p-4 overflow-x-auto shadow-inner">
              <pre className="text-green-400 dark:text-green-400 text-sm font-mono whitespace-pre-wrap text-center">
                <code>{curlTemplate.original_curl}</code>
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
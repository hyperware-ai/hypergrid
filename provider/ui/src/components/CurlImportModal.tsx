import React, { useState } from 'react';
import Modal from './Modal';
import { parseCurlCommand, curlToFormData } from '../utils/curlParser.ts';
import type { CurlToFormMapping } from '../utils/curlParser.ts';
import { FiCheckCircle, FiAlertTriangle, FiXCircle } from 'react-icons/fi';
import { FaCopy } from 'react-icons/fa6';

interface CurlImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (formData: Partial<CurlToFormMapping>) => void;
}

const CurlImportModal: React.FC<CurlImportModalProps> = ({
  isOpen,
  onClose,
  onImport
}) => {
  const [curlInput, setCurlInput] = useState('');
  const [parseResult, setParseResult] = useState<CurlToFormMapping | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  const handleParseCurl = () => {
    if (!curlInput.trim()) return;
    
    const parsed = parseCurlCommand(curlInput.trim());
    const formMapping = curlToFormData(parsed);
    setParseResult(formMapping);
    setShowPreview(true);
  };

  const handleImport = () => {
    if (!parseResult) return;
    
    // Convert to the format expected by the form
    const formData: Partial<CurlToFormMapping> = {
      endpointBaseUrl: parseResult.endpointBaseUrl,
      topLevelRequestType: parseResult.topLevelRequestType,
      pathParamKeys: parseResult.pathParamKeys,
      queryParamKeys: parseResult.queryParamKeys,
      headerKeys: parseResult.headerKeys,
      bodyKeys: parseResult.bodyKeys,
      endpointApiParamKey: parseResult.endpointApiParamKey,
      authChoice: parseResult.authChoice,
      apiKeyQueryParamName: parseResult.apiKeyQueryParamName,
      apiKeyHeaderName: parseResult.apiKeyHeaderName,
    };
    
    onImport(formData);
    handleClose();
  };

  const handleClose = () => {
    setCurlInput('');
    setParseResult(null);
    setShowPreview(false);
    onClose();
  };

  const exampleCurl = `curl -X GET \\
  -H "X-API-Key: your-api-key" \\
  -H "Content-Type: application/json" \\
  "https://api.example.com/v1/users/123/profile?include=email&format=json"`;

  if (!isOpen) return null;

  return (
    <Modal title="Import from Curl Command" onClose={handleClose}>
      <div className="max-w-4xl mx-auto">
        {!showPreview ? (
          // Step 1: Curl Input
          <div className="flex flex-col gap-6">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <FiCheckCircle className="text-blue-600 mt-0.5 flex-shrink-0" />
                <div>
                  <h4 className="font-medium text-blue-900">How to use Curl Import</h4>
                  <p className="text-sm text-blue-700 mt-1">
                    Paste a curl command below and we'll automatically extract the API configuration. 
                    This works best with standard REST APIs using GET or POST methods.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="curl-input" className="text-sm font-medium text-gray-700">
                Curl Command
              </label>
              <textarea
                id="curl-input"
                value={curlInput}
                onChange={(e) => setCurlInput(e.target.value)}
                placeholder="Paste your curl command here..."
                className="w-full h-32 p-3 border border-gray-300 rounded-lg font-mono text-sm resize-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <h5 className="text-sm font-medium text-gray-700">Example:</h5>
                <button
                  onClick={() => setCurlInput(exampleCurl)}
                  className="text-xs bg-gray-200 hover:bg-gray-300 px-2 py-1 rounded flex items-center gap-1"
                >
                  <FaCopy className="text-xs" />
                  Use Example
                </button>
              </div>
              <pre className="text-xs text-gray-600 overflow-x-auto">
                <code>{exampleCurl}</code>
              </pre>
            </div>

            <div className="flex gap-3 pt-4 border-t">
              <button
                onClick={handleParseCurl}
                disabled={!curlInput.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
              >
                Parse Curl Command
              </button>
              <button
                onClick={handleClose}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          // Step 2: Preview Results
          <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-medium">Import Preview</h3>
              <button
                onClick={() => setShowPreview(false)}
                className="text-sm text-blue-600 hover:text-blue-800"
              >
                ← Edit Curl Command
              </button>
            </div>

            {parseResult?.warnings && parseResult.warnings.length > 0 && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <FiAlertTriangle className="text-yellow-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <h4 className="font-medium text-yellow-900">Parsing Warnings</h4>
                    <ul className="text-sm text-yellow-700 mt-1 list-disc list-inside">
                      {parseResult.warnings.map((warning, index) => (
                        <li key={index}>{warning}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}

            {parseResult && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Basic Configuration */}
                <div className="bg-gray-50 rounded-lg p-4">
                  <h4 className="font-medium text-gray-900 mb-3">Basic Configuration</h4>
                  <div className="space-y-3 text-sm">
                    <div>
                      <span className="text-gray-600">Request Type:</span>
                      <span className="ml-2 font-mono bg-white px-2 py-1 rounded">
                        {parseResult.topLevelRequestType === 'getWithPath' ? 'GET with Path Parameters' :
                         parseResult.topLevelRequestType === 'getWithQuery' ? 'GET with Query Parameters' :
                         'POST with JSON Body'}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-600">Base URL:</span>
                      <div className="mt-1 font-mono bg-white px-2 py-1 rounded text-xs break-all">
                        {parseResult.endpointBaseUrl}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Authentication */}
                <div className="bg-gray-50 rounded-lg p-4">
                  <h4 className="font-medium text-gray-900 mb-3">Authentication</h4>
                  <div className="space-y-3 text-sm">
                    <div>
                      <span className="text-gray-600">API Key Location:</span>
                      <span className="ml-2 font-mono bg-white px-2 py-1 rounded">
                        {parseResult.authChoice === 'header' ? 'Header' :
                         parseResult.authChoice === 'query' ? 'Query Parameter' :
                         'None detected'}
                      </span>
                    </div>
                    {parseResult.authChoice === 'header' && parseResult.apiKeyHeaderName && (
                      <div>
                        <span className="text-gray-600">Header Name:</span>
                        <span className="ml-2 font-mono bg-white px-2 py-1 rounded text-xs">
                          {parseResult.apiKeyHeaderName}
                        </span>
                      </div>
                    )}
                    {parseResult.authChoice === 'query' && parseResult.apiKeyQueryParamName && (
                      <div>
                        <span className="text-gray-600">Query Param:</span>
                        <span className="ml-2 font-mono bg-white px-2 py-1 rounded text-xs">
                          {parseResult.apiKeyQueryParamName}
                        </span>
                      </div>
                    )}
                    {parseResult.endpointApiParamKey && (
                      <div>
                        <span className="text-gray-600">API Key:</span>
                        <span className="ml-2 font-mono bg-white px-2 py-1 rounded text-xs">
                          {parseResult.endpointApiParamKey.substring(0, 8)}...
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Parameters */}
                <div className="bg-gray-50 rounded-lg p-4">
                  <h4 className="font-medium text-gray-900 mb-3">Parameters</h4>
                  <div className="space-y-3 text-sm">
                    {parseResult.pathParamKeys.length > 0 && (
                      <div>
                        <span className="text-gray-600">Path Parameters:</span>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {parseResult.pathParamKeys.map((key, index) => (
                            <span key={index} className="font-mono bg-white px-2 py-1 rounded text-xs">
                              {key}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {parseResult.queryParamKeys.length > 0 && (
                      <div>
                        <span className="text-gray-600">Query Parameters:</span>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {parseResult.queryParamKeys.map((key, index) => (
                            <span key={index} className="font-mono bg-white px-2 py-1 rounded text-xs">
                              {key}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {parseResult.headerKeys.length > 0 && (
                      <div>
                        <span className="text-gray-600">Custom Headers:</span>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {parseResult.headerKeys.map((key, index) => (
                            <span key={index} className="font-mono bg-white px-2 py-1 rounded text-xs">
                              {key}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {parseResult.bodyKeys.length > 0 && (
                      <div>
                        <span className="text-gray-600">JSON Body Keys:</span>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {parseResult.bodyKeys.map((key, index) => (
                            <span key={index} className="font-mono bg-white px-2 py-1 rounded text-xs">
                              {key}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Summary */}
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <FiCheckCircle className="text-green-600 mt-0.5 flex-shrink-0" />
                    <div>
                      <h4 className="font-medium text-green-900">Ready to Import</h4>
                      <p className="text-sm text-green-700 mt-1">
                        The curl command was successfully parsed. Click "Import Configuration" to populate the form with these settings.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="flex gap-3 pt-4 border-t">
              <button
                onClick={handleImport}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
              >
                Import Configuration
              </button>
              <button
                onClick={handleClose}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default CurlImportModal;

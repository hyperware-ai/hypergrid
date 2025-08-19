import React, { useState, useEffect, useRef } from 'react';
import Modal from './Modal';
import CurlJsonViewer from './CurlJsonViewer';
import ModifiableFieldsList from './ModifiableFieldsList';
import {
  parseCurlCommand,
  identifyPotentialFields,
  createCurlTemplate,
  curlTemplateToBackendFormat,
  ParsedCurlRequest,
  ModifiableField,
  CurlTemplate
} from '../utils/enhancedCurlParser';

interface EnhancedCurlImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (curlTemplate: any) => void;
  isInline?: boolean; // New prop to control inline rendering
}

const EnhancedCurlImportModal: React.FC<EnhancedCurlImportModalProps> = ({
  isOpen,
  onClose,
  onImport,
  isInline = false
}) => {
  const [curlCommand, setCurlCommand] = useState('');
  const [parsedRequest, setParsedRequest] = useState<ParsedCurlRequest | null>(null);
  const [potentialFields, setPotentialFields] = useState<ModifiableField[]>([]);
  const [modifiableFields, setModifiableFields] = useState<ModifiableField[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'viewer' | 'modifiable'>('viewer');
  const parsedContentRef = useRef<HTMLDivElement>(null);

  const handleParseCurl = (curlText: string) => {
    if (!curlText.trim()) {
      // Clear everything when input is empty
      setParsedRequest(null);
      setPotentialFields([]);
      setModifiableFields([]);
      setParseError(null);
      return;
    }

    try {
      const parsed = parseCurlCommand(curlText);
      const potential = identifyPotentialFields(parsed);
      
      setParsedRequest(parsed);
      setPotentialFields(potential);
      setModifiableFields([]);
      setParseError(null);
      
      // Auto-scroll to parsed content after a brief delay for state update
      setTimeout(() => {
        if (parsedContentRef.current) {
          parsedContentRef.current.scrollIntoView({ 
            behavior: 'smooth', 
            block: 'start' 
          });
        }
      }, 100);
    } catch (error) {
      setParseError(error instanceof Error ? error.message : 'Failed to parse curl command');
      setParsedRequest(null);
      setPotentialFields([]);
      setModifiableFields([]);
    }
  };

  // Auto-parse when cURL input changes
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      handleParseCurl(curlCommand);
    }, 500); // Debounce for 500ms

    return () => clearTimeout(timeoutId);
  }, [curlCommand]);

  const handleFieldToggleModifiable = (field: ModifiableField) => {
    const isAlreadyModifiable = modifiableFields.some(f => f.jsonPointer === field.jsonPointer);
    
    if (isAlreadyModifiable) {
      // Simple removal - just remove this specific field
      setModifiableFields(modifiableFields.filter(f => f.jsonPointer !== field.jsonPointer));
    } else {
      // Simple addition - just add this specific field
      // Remove any conflicting parent/child relationships first
      let newModifiableFields = modifiableFields.filter(f => {
        // Remove if this field is a parent of the new field
        if (field.jsonPointer.startsWith(f.jsonPointer + '/')) return false;
        // Remove if this field is a child of the new field
        if (f.jsonPointer.startsWith(field.jsonPointer + '/')) return false;
        return true;
      });
      
      // Add the new field
      newModifiableFields.push(field);
      setModifiableFields(newModifiableFields);
    }
  };

  const handleFieldRemove = (field: ModifiableField) => {
    setModifiableFields(modifiableFields.filter(f => f.jsonPointer !== field.jsonPointer));
  };

  const handleFieldNameChange = (field: ModifiableField, newName: string) => {
    setModifiableFields(modifiableFields.map(f => 
      f.jsonPointer === field.jsonPointer ? { ...f, name: newName } : f
    ));
  };

  const handleImport = () => {
    if (!parsedRequest) return;
    
    const template = createCurlTemplate(parsedRequest, modifiableFields);
    const backendFormat = curlTemplateToBackendFormat(template);
    onImport(backendFormat);
    
    // Reset state
    setCurlCommand('');
    setParsedRequest(null);
    setPotentialFields([]);
    setModifiableFields([]);
    setParseError(null);
    setActiveTab('viewer');
    onClose();
  };

  const handleClose = () => {
    setCurlCommand('');
    setParsedRequest(null);
    setPotentialFields([]);
    setModifiableFields([]);
    setParseError(null);
    setActiveTab('viewer');
    onClose();
  };

  // If inline, render without modal wrapper
  const content = (
    <div className="flex flex-col gap-4">
        {/* cURL Input Section */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            Paste your cURL command
            <span className="text-xs text-gray-500 ml-2">(auto-parses as you type)</span>
          </label>
          <textarea
            value={curlCommand}
            onChange={(e) => setCurlCommand(e.target.value)}
            placeholder="curl -X GET 'https://api.example.com/users/123' -H 'Authorization: Bearer token'"
            className="w-full h-32 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-800 dark:text-gray-100 font-mono text-sm"
          />
        </div>

        {/* Error Display */}
        {parseError && (
          <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
            <p className="text-red-700 dark:text-red-300 text-sm">{parseError}</p>
          </div>
        )}

        {/* Parsed Request Display */}
        {parsedRequest && (
          <div ref={parsedContentRef}>
            {/* Tab Navigation */}
            <div className="flex gap-2 border-b border-gray-200 dark:border-gray-700">
              <button
                onClick={() => setActiveTab('viewer')}
                className={`px-4 py-2 font-medium text-sm ${
                  activeTab === 'viewer'
                    ? 'text-blue-600 border-b-2 border-blue-600'
                    : 'text-gray-600 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
                }`}
              >
                Request Details
              </button>
              <button
                onClick={() => setActiveTab('modifiable')}
                className={`px-4 py-2 font-medium text-sm ${
                  activeTab === 'modifiable'
                    ? 'text-blue-600 border-b-2 border-blue-600'
                    : 'text-gray-600 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
                }`}
              >
                Modifiable Fields {modifiableFields.length > 0 && `(${modifiableFields.length})`}
              </button>
            </div>

            {/* Tab Content */}
            <div className="min-h-[400px]">
              {activeTab === 'viewer' && (
                <CurlJsonViewer
                  parsedRequest={parsedRequest}
                  potentialFields={potentialFields}
                  modifiableFields={modifiableFields}
                  onFieldToggleModifiable={handleFieldToggleModifiable}
                />
              )}
              
              {activeTab === 'modifiable' && (
                <ModifiableFieldsList
                  modifiableFields={modifiableFields}
                  onFieldRemove={handleFieldRemove}
                  onFieldNameChange={handleFieldNameChange}
                />
              )}
            </div>



            {/* Action Buttons */}
            <div className="flex justify-between pt-4 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={() => {
                  if (parsedRequest) {
                    const template = { originalCurl: curlCommand, parsedRequest, modifiableFields };
                    const backendData = curlTemplateToBackendFormat(template);
                    console.log('Backend data structure:', backendData);
                    console.log('JSON string:', JSON.stringify(backendData, null, 2));
                  }
                }}
                disabled={!parsedRequest}
                className="px-4 py-2 text-sm bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Debug: Print to Console
              </button>
              <div className="flex gap-3">
                <button
                  onClick={handleClose}
                  className="px-4 py-2 text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  Cancel
                </button>
                <button
                  onClick={handleImport}
                  disabled={!parsedRequest}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                >
                  Import API Configuration
                </button>
              </div>
            </div>
          </div>
        )}
    </div>
  );

  // Return content wrapped in Modal for normal use, or just content for inline use
  if (isInline) {
    return content;
  }

  return (
    <Modal
      title="Import API from cURL"
      onClose={handleClose}
      titleChildren={<div className="text-sm text-gray-500">Paste your cURL command to import an API configuration</div>}
    >
      {content}
    </Modal>
  );
};

export default EnhancedCurlImportModal;

import React, { useState } from 'react';
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
}

const EnhancedCurlImportModal: React.FC<EnhancedCurlImportModalProps> = ({
  isOpen,
  onClose,
  onImport
}) => {
  const [curlCommand, setCurlCommand] = useState('');
  const [parsedRequest, setParsedRequest] = useState<ParsedCurlRequest | null>(null);
  const [potentialFields, setPotentialFields] = useState<ModifiableField[]>([]);
  const [modifiableFields, setModifiableFields] = useState<ModifiableField[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'viewer' | 'modifiable'>('viewer');

  const handleParseCurl = () => {
    try {
      const parsed = parseCurlCommand(curlCommand);
      const potential = identifyPotentialFields(parsed);
      

      
      setParsedRequest(parsed);
      setPotentialFields(potential);
      setModifiableFields([]);
      setParseError(null);
    } catch (error) {
      setParseError(error instanceof Error ? error.message : 'Failed to parse curl command');
      setParsedRequest(null);
      setPotentialFields([]);
      setModifiableFields([]);
    }
  };

  const handleFieldToggleModifiable = (field: ModifiableField) => {
    const isAlreadyModifiable = modifiableFields.some(f => f.jsonPointer === field.jsonPointer);
    
    if (isAlreadyModifiable) {
      // Removing this field - also remove any children that were auto-selected
      setModifiableFields(modifiableFields.filter(f => 
        !f.jsonPointer.startsWith(field.jsonPointer)
      ));
    } else {
      // Check if this field has children that are currently selected
      const childFields = modifiableFields.filter(f => 
        f.jsonPointer.startsWith(field.jsonPointer + '/')
      );
      
      if (childFields.length > 0) {
        // If clicking on a parent that has selected children, deselect all children
        setModifiableFields(modifiableFields.filter(f => 
          !f.jsonPointer.startsWith(field.jsonPointer + '/')
        ));
        return;
      }
      
      // Check if this is a complex type (object or array)
      if (typeof field.value === 'object' && field.value !== null) {
        // Find all leaf fields under this path
        const leafFields = potentialFields.filter(f => {
          // Field must be under this path
          if (!f.jsonPointer.startsWith(field.jsonPointer + '/')) return false;
          
          // Field must be a leaf (primitive value)
          return typeof f.value !== 'object' || f.value === null;
        });
        
        if (leafFields.length > 0) {
          // Remove any existing fields that conflict
          let newModifiableFields = modifiableFields.filter(f => {
            // Remove fields that are parents or children of any leaf we're adding
            return !leafFields.some(leaf => 
              f.jsonPointer.startsWith(leaf.jsonPointer) || 
              leaf.jsonPointer.startsWith(f.jsonPointer)
            );
          });
          
          // Add all leaf fields
          newModifiableFields.push(...leafFields);
          setModifiableFields(newModifiableFields);
          
          // Visual feedback happens automatically through the UI update
          return;
        }
      }
      
      // For primitive values or empty objects/arrays, just add the field itself
      let newModifiableFields = [...modifiableFields];
      
      // Remove any conflicting fields
      newModifiableFields = newModifiableFields.filter(f => {
        return !f.jsonPointer.startsWith(field.jsonPointer + '/') && 
               !field.jsonPointer.startsWith(f.jsonPointer + '/');
      });
      
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

  return (
    <Modal
      title="Import API from cURL"
      onClose={handleClose}
      titleChildren={<div className="text-sm text-gray-500">Paste your cURL command to import an API configuration</div>}
    >
      <div className="flex flex-col gap-4">
        {/* cURL Input Section */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            Paste your cURL command
          </label>
          <textarea
            value={curlCommand}
            onChange={(e) => setCurlCommand(e.target.value)}
            placeholder="curl -X GET 'https://api.example.com/users/123' -H 'Authorization: Bearer token'"
            className="w-full h-32 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-800 dark:text-gray-100 font-mono text-sm"
          />
          <button
            onClick={handleParseCurl}
            disabled={!curlCommand.trim()}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            Parse cURL
          </button>
        </div>

        {/* Error Display */}
        {parseError && (
          <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
            <p className="text-red-700 dark:text-red-300 text-sm">{parseError}</p>
          </div>
        )}

        {/* Parsed Request Display */}
        {parsedRequest && (
          <>
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
          </>
        )}
      </div>
    </Modal>
  );
};

export default EnhancedCurlImportModal;

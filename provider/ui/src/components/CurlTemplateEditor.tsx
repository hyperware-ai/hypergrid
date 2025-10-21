import React, { useState, useEffect, useRef, useCallback } from 'react';
import Modal from './Modal';
import CurlRequestInspector from './CurlRequestInspector';
import ModifiableFieldsList from './ModifiableFieldsList';
import {
  parseCurlCommand,
  identifyPotentialFields,
  createCurlTemplate,
  curlTemplateToBackendFormat,
  ParsedCurlRequest,
  ModifiableField,
} from '../utils/enhancedCurlParser';

interface CurlTemplateEditorProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (curlTemplate: any) => void;
  onParseSuccess?: () => void;
  onParseClear?: () => void;
  isInline?: boolean;
  initialCurlCommand?: string;
  onStateChange?: (state: any) => void;
  preservedState?: any;
}

const CurlTemplateEditor: React.FC<CurlTemplateEditorProps> = ({
  isOpen,
  onClose,
  onImport,
  onParseSuccess,
  onParseClear,
  isInline = false,
  initialCurlCommand = "",
  onStateChange,
  preservedState
}) => {
  // ===== State =====
  const [curlCommand, setCurlCommand] = useState(initialCurlCommand);
  const [parsedRequest, setParsedRequest] = useState<ParsedCurlRequest | null>(null);
  const [potentialFields, setPotentialFields] = useState<ModifiableField[]>([]);
  const [modifiableFields, setModifiableFields] = useState<ModifiableField[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'viewer' | 'modifiable'>('viewer');

  // ===== Refs =====
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ===== Callbacks =====
  const handleParseCurl = useCallback((curlText: string) => {
    if (!curlText.trim()) {
      setParsedRequest(null);
      setPotentialFields([]);
      setModifiableFields([]);
      setParseError(null);
      onParseClear?.();
      return;
    }

    try {
      const parsed = parseCurlCommand(curlText);
      const potential = identifyPotentialFields(parsed);
      
      // Only clear modifiableFields if this is a new/different cURL command
      const isSameCurl = parsedRequest && parsedRequest.fullCurl === parsed.fullCurl;
      
      setParsedRequest(parsed);
      setPotentialFields(potential);
      
      if (!isSameCurl) {
        setModifiableFields([]);
      }
      
      setParseError(null);
      onParseSuccess?.();
    } catch (error) {
      setParseError(error instanceof Error ? error.message : 'Failed to parse curl command');
      setParsedRequest(null);
      setPotentialFields([]);
      setModifiableFields([]);
    }
  }, [parsedRequest, onParseSuccess, onParseClear]);

  const handleFieldToggleModifiable = useCallback((field: ModifiableField) => {
    const isAlreadyModifiable = modifiableFields.some(f => f.jsonPointer === field.jsonPointer);
    
    if (isAlreadyModifiable) {
      setModifiableFields(modifiableFields.filter(f => f.jsonPointer !== field.jsonPointer));
    } else {
      // Remove any conflicting parent/child relationships
      let newModifiableFields = modifiableFields.filter(f => {
        if (field.jsonPointer.startsWith(f.jsonPointer + '/')) return false;
        if (f.jsonPointer.startsWith(field.jsonPointer + '/')) return false;
        return true;
      });
      
      newModifiableFields.push(field);
      setModifiableFields(newModifiableFields);
    }
  }, [modifiableFields]);

  const handleFieldRemove = useCallback((field: ModifiableField) => {
    setModifiableFields(prev => prev.filter(f => f.jsonPointer !== field.jsonPointer));
  }, []);

  const handleFieldNameChange = useCallback((field: ModifiableField, newName: string) => {
    setModifiableFields(prev => prev.map(f => 
      f.jsonPointer === field.jsonPointer ? { ...f, name: newName } : f
    ));
  }, []);

  const handleImport = useCallback(() => {
    if (!parsedRequest) return;
    
    const template = createCurlTemplate(parsedRequest, modifiableFields);
    const backendFormat = curlTemplateToBackendFormat(template);
    onImport(backendFormat);
    
    setCurlCommand('');
    setParsedRequest(null);
    setPotentialFields([]);
    setModifiableFields([]);
    setParseError(null);
    setActiveTab('viewer');
    onClose();
  }, [parsedRequest, modifiableFields, onImport, onClose]);

  const handleClose = useCallback(() => {
    setCurlCommand('');
    setParsedRequest(null);
    setPotentialFields([]);
    setModifiableFields([]);
    setParseError(null);
    setActiveTab('viewer');
    onClose();
  }, [onClose]);

  // ===== Effects =====
  // Restore from preserved state
  useEffect(() => {
    if (preservedState) {
      setCurlCommand(preservedState.curlCommand || "");
      setParsedRequest(preservedState.parsedRequest || null);
      setPotentialFields(preservedState.potentialFields || []);
      setModifiableFields(preservedState.modifiableFields || []);
      setParseError(preservedState.parseError || null);
      setActiveTab(preservedState.activeTab || 'viewer');
    } else if (initialCurlCommand) {
      setCurlCommand(initialCurlCommand);
    }
  }, [preservedState, initialCurlCommand]);

  // Notify parent of state changes
  useEffect(() => {
    onStateChange?.({
      curlCommand,
      parsedRequest,
      potentialFields,
      modifiableFields,
      parseError,
      activeTab
    });
  }, [curlCommand, parsedRequest, potentialFields, modifiableFields, parseError, activeTab, onStateChange]);

  // Auto-parse when cURL input changes (debounced)
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      handleParseCurl(curlCommand);
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [curlCommand, handleParseCurl]);

  // Auto-import when modifiable fields change
  useEffect(() => {
    if (parsedRequest && modifiableFields.length >= 0) {
      const template = createCurlTemplate(parsedRequest, modifiableFields);
      const backendFormat = curlTemplateToBackendFormat(template);
      onImport(backendFormat);
    }
  }, [parsedRequest, modifiableFields, onImport]);

  // Clear import when parsing is cleared
  useEffect(() => {
    if (!parsedRequest) {
      onImport(null);
    }
  }, [parsedRequest, onImport]);

  // Keep textarea scrolled to top
  useEffect(() => {
    if (textareaRef.current && curlCommand) {
      textareaRef.current.scrollTop = 0;
    }
  }, [curlCommand]);

  // ===== Render =====

  // If inline, render without modal wrapper
  const content = (
    <div className="flex flex-col gap-4">
        {/* cURL Input Section */}
        <div className="space-y-3">
          <div className="flex items-start gap-0">
            <span className="text-cyan-600 dark:text-cyan font-medium">$</span>
            <textarea
              ref={textareaRef}
              value={curlCommand}
              onChange={(e) => setCurlCommand(e.target.value)}
              placeholder="curl -X GET 'https://api.example.com/users/123' -H 'Authorization: Bearer token'"
              className="flex-1 ml-2 bg-transparent border-none outline-none resize-none text-green-600 dark:text-green-400 placeholder-stone-500 dark:placeholder-gray-600 font-mono text-sm min-h-[2.5rem] max-h-24"
              rows={curlCommand ? Math.min(Math.max(2, Math.ceil(curlCommand.length / 80)), 6) : 2}
            />
          </div>
        </div>

        {/* Error Display */}
        {parseError && (
          <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
            <p className="text-red-700 dark:text-red-300 text-sm">{parseError}</p>
          </div>
        )}

        {/* Parsed Request Display */}
        {parsedRequest && (
          <div>
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
                <CurlRequestInspector
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

export default CurlTemplateEditor;


import React, { useState, useRef, useEffect } from 'react';
import { Variable } from '../types/hypergrid_provider';
import { BsTrash, BsPencil, BsPlus, BsCheck, BsX } from 'react-icons/bs';

interface CurlTemplateEditorProps {
  value: string;
  variables: Variable[];
  onChange: (template: string, variables: Variable[]) => void;
}

const CurlTemplateEditor: React.FC<CurlTemplateEditorProps> = ({
  value,
  variables,
  onChange,
}) => {
  const [template, setTemplate] = useState(value);
  const [localVariables, setLocalVariables] = useState<Variable[]>(variables);
  const [selection, setSelection] = useState<{ start: number; end: number; text: string } | null>(null);
  const [creatingVariable, setCreatingVariable] = useState(false);
  const [newVariableName, setNewVariableName] = useState('');
  const [editingVariable, setEditingVariable] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setTemplate(value);
  }, [value]);

  useEffect(() => {
    setLocalVariables(variables);
  }, [variables]);

  const handleTextSelection = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = textarea.value.substring(start, end);

    if (selectedText.length > 0) {
      setSelection({ start, end, text: selectedText });
    } else {
      setSelection(null);
    }
  };

  const createVariable = () => {
    if (!selection || !newVariableName.trim()) return;

    // Replace selected text with {{variableName}}
    const newTemplate = 
      template.substring(0, selection.start) + 
      `{{${newVariableName.trim()}}}` + 
      template.substring(selection.end);

    // Add to variables list
    const newVariable: Variable = {
      name: newVariableName.trim(),
      example_value: selection.text,
    };

    const updatedVariables = [...localVariables, newVariable];
    
    setTemplate(newTemplate);
    setLocalVariables(updatedVariables);
    onChange(newTemplate, updatedVariables);
    
    // Reset state
    setSelection(null);
    setCreatingVariable(false);
    setNewVariableName('');
  };

  const deleteVariable = (name: string) => {
    // Remove from variables list
    const updatedVariables = localVariables.filter(v => v.name !== name);
    
    // Optionally replace {{name}} back with example value in template
    let updatedTemplate = template;
    const variable = localVariables.find(v => v.name === name);
    if (variable?.example_value) {
      updatedTemplate = template.replace(new RegExp(`\\{\\{${name}\\}\\}`, 'g'), variable.example_value);
    }
    
    setLocalVariables(updatedVariables);
    setTemplate(updatedTemplate);
    onChange(updatedTemplate, updatedVariables);
  };

  const renameVariable = (oldName: string, newName: string) => {
    if (!newName.trim() || oldName === newName) {
      setEditingVariable(null);
      return;
    }

    // Update in variables list
    const updatedVariables = localVariables.map(v => 
      v.name === oldName ? { ...v, name: newName.trim() } : v
    );
    
    // Update in template
    const updatedTemplate = template.replace(
      new RegExp(`\\{\\{${oldName}\\}\\}`, 'g'), 
      `{{${newName.trim()}}}`
    );
    
    setLocalVariables(updatedVariables);
    setTemplate(updatedTemplate);
    onChange(updatedTemplate, updatedVariables);
    setEditingVariable(null);
    setEditingName('');
  };

  const updateExampleValue = (name: string, exampleValue: string) => {
    const updatedVariables = localVariables.map(v => 
      v.name === name ? { ...v, example_value: exampleValue } : v
    );
    
    setLocalVariables(updatedVariables);
    onChange(template, updatedVariables);
  };

  const getPreview = () => {
    let preview = template;
    localVariables.forEach(variable => {
      const placeholder = `{{${variable.name}}}`;
      const value = variable.example_value || `<${variable.name}>`;
      preview = preview.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), value);
    });
    return preview;
  };

  return (
    <div className="space-y-4">
      {/* Curl Template Input */}
      <div>
        <label className="block text-sm font-semibold text-dark-gray dark:text-gray mb-2">
          Curl Template
        </label>
        <textarea
          ref={textareaRef}
          value={template}
          onChange={(e) => {
            setTemplate(e.target.value);
            onChange(e.target.value, localVariables);
          }}
          onSelect={handleTextSelection}
          className="w-full h-32 px-3 py-2 border border-gray-200 rounded-lg
                   bg-white text-dark-gray dark:bg-black dark:text-gray
                   font-mono text-sm resize-none
                   focus:outline-none focus:ring-2 focus:ring-gray-900"
          placeholder="curl https://api.example.com/v1/chat -H 'Authorization: Bearer sk-123' -d '{&quot;messages&quot;: []}''"
        />
        
        {/* Variable Creation Button */}
        {selection && !creatingVariable && (
          <div className="mt-2">
            <button
              onClick={() => setCreatingVariable(true)}
              className="px-3 py-1 bg-gray-900 text-white text-sm rounded-lg
                       hover:bg-gray-800 transition-colors"
            >
              <BsPlus className="inline mr-1" />
              Create Variable from Selection
            </button>
            <span className="ml-2 text-sm text-gray-500">
              Selected: "{selection.text}"
            </span>
          </div>
        )}

        {/* Variable Name Input */}
        {creatingVariable && selection && (
          <div className="mt-2 flex items-center gap-2">
            <input
              type="text"
              value={newVariableName}
              onChange={(e) => setNewVariableName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') createVariable();
                if (e.key === 'Escape') {
                  setCreatingVariable(false);
                  setNewVariableName('');
                }
              }}
              placeholder="Variable name"
              className="px-3 py-1 border border-gray-200 rounded-lg
                       bg-white text-dark-gray dark:bg-black dark:text-gray
                       text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
              autoFocus
            />
            <button
              onClick={createVariable}
              className="p-1 text-green-600 hover:text-green-700"
            >
              <BsCheck className="text-xl" />
            </button>
            <button
              onClick={() => {
                setCreatingVariable(false);
                setNewVariableName('');
              }}
              className="p-1 text-red-600 hover:text-red-700"
            >
              <BsX className="text-xl" />
            </button>
          </div>
        )}
      </div>

      {/* Variables List */}
      {localVariables.length > 0 && (
        <div>
          <label className="block text-sm font-semibold text-dark-gray dark:text-gray mb-2">
            Variables
          </label>
          <div className="space-y-2">
            {localVariables.map((variable) => (
              <div key={variable.name} className="flex items-center gap-2 p-2 border border-gray-200 rounded-lg">
                {editingVariable === variable.name ? (
                  <>
                    <input
                      type="text"
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') renameVariable(variable.name, editingName);
                        if (e.key === 'Escape') setEditingVariable(null);
                      }}
                      className="px-2 py-1 border border-gray-200 rounded
                               bg-white text-dark-gray dark:bg-black dark:text-gray
                               text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                      autoFocus
                    />
                    <button
                      onClick={() => renameVariable(variable.name, editingName)}
                      className="p-1 text-green-600 hover:text-green-700"
                    >
                      <BsCheck />
                    </button>
                    <button
                      onClick={() => setEditingVariable(null)}
                      className="p-1 text-red-600 hover:text-red-700"
                    >
                      <BsX />
                    </button>
                  </>
                ) : (
                  <>
                    <span className="font-mono text-sm font-semibold text-dark-gray dark:text-gray">
                      {`{{${variable.name}}}`}
                    </span>
                    <input
                      type="text"
                      value={variable.example_value || ''}
                      onChange={(e) => updateExampleValue(variable.name, e.target.value)}
                      placeholder="Example value"
                      className="flex-1 px-2 py-1 border border-gray-200 rounded
                               bg-white text-dark-gray dark:bg-black dark:text-gray
                               text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                    />
                    <button
                      onClick={() => {
                        setEditingVariable(variable.name);
                        setEditingName(variable.name);
                      }}
                      className="p-1 text-gray-600 hover:text-gray-700"
                    >
                      <BsPencil />
                    </button>
                    <button
                      onClick={() => deleteVariable(variable.name)}
                      className="p-1 text-red-600 hover:text-red-700"
                    >
                      <BsTrash />
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Preview */}
      <div>
        <label className="block text-sm font-semibold text-dark-gray dark:text-gray mb-2">
          Preview with Example Values
        </label>
        <div className="p-3 bg-gray-50 dark:bg-gray-900 rounded-lg">
          <pre className="text-green-600 dark:text-green-400 text-sm font-mono whitespace-pre-wrap">
            {getPreview()}
          </pre>
        </div>
      </div>
    </div>
  );
};

export default CurlTemplateEditor;
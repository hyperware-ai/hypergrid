import React from 'react';
import { ModifiableField } from '../utils/enhancedCurlParser';
import { MdDelete, MdEdit } from 'react-icons/md';

interface ModifiableFieldsListProps {
  modifiableFields: ModifiableField[];
  onFieldRemove: (field: ModifiableField) => void;
  onFieldNameChange: (field: ModifiableField, newName: string) => void;
}

// Helper to group fields by their parent path
function groupFieldsByParent(fields: ModifiableField[]) {
  const groups: Record<string, ModifiableField[]> = {};
  
  fields.forEach(field => {
    // Find the parent path (everything before the last segment)
    const parts = field.jsonPointer.split('/');
    const parentPath = parts.slice(0, -1).join('/');
    
    if (!groups[parentPath]) {
      groups[parentPath] = [];
    }
    groups[parentPath].push(field);
  });
  
  return groups;
}

const ModifiableFieldsList: React.FC<ModifiableFieldsListProps> = ({
  modifiableFields,
  onFieldRemove,
  onFieldNameChange
}) => {
  const [editingField, setEditingField] = React.useState<string | null>(null);
  const [editingName, setEditingName] = React.useState<string>('');

  const startEditing = (field: ModifiableField) => {
    setEditingField(field.jsonPointer);
    setEditingName(field.name);
  };

  const saveEdit = (field: ModifiableField) => {
    if (editingName.trim()) {
      onFieldNameChange(field, editingName.trim());
    }
    setEditingField(null);
    setEditingName('');
  };

  const cancelEdit = () => {
    setEditingField(null);
    setEditingName('');
  };

  const getFieldTypeColor = (fieldType: string) => {
    switch (fieldType) {
      case 'path':
        return 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300';
      case 'query':
        return 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300';
      case 'header':
        return 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300';
      case 'body':
        return 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300';
      default:
        return 'bg-gray-100 text-gray-700 dark:bg-gray-900 dark:text-gray-300';
    }
  };

  const getFieldTypeIcon = (fieldType: string) => {
    switch (fieldType) {
      case 'path':
        return '/';
      case 'query':
        return '?';
      case 'header':
        return 'H';
      case 'body':
        return '{}';
      default:
        return '•';
    }
  };

  if (modifiableFields.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500 dark:text-gray-400">
        <p>No modifiable fields selected.</p>
        <p className="text-sm mt-2">Click on values in the JSON viewer above to mark them as modifiable.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300 mb-4">
        Modifiable Fields ({modifiableFields.length})
      </h3>
      
      <div className="grid gap-2">
        {modifiableFields.map((field) => {
          const isEditing = field.jsonPointer === editingField;
          
          return (
            <div
              key={field.jsonPointer}
              className="flex items-center justify-between p-3 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 hover:shadow-sm transition-shadow"
            >
              <div className="flex items-center gap-3 flex-1">
                <span
                  className={`inline-flex items-center justify-center w-8 h-8 rounded-full text-sm font-semibold ${getFieldTypeColor(
                    field.fieldType
                  )}`}
                  title={`${field.fieldType} parameter`}
                >
                  {getFieldTypeIcon(field.fieldType)}
                </span>
                
                <div className="flex-1">
                  {isEditing ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveEdit(field);
                          if (e.key === 'Escape') cancelEdit();
                        }}
                        className="px-2 py-1 text-sm border rounded dark:bg-gray-700 dark:border-gray-600"
                        autoFocus
                      />
                      <button
                        onClick={() => saveEdit(field)}
                        className="text-green-600 hover:text-green-700"
                        title="Save"
                      >
                        ✓
                      </button>
                      <button
                        onClick={cancelEdit}
                        className="text-red-600 hover:text-red-700"
                        title="Cancel"
                      >
                        ✗
                      </button>
                    </div>
                  ) : (
                    <>
                                        <div className="font-medium text-gray-900 dark:text-gray-100">
                    {field.name}
                    {(typeof field.value === 'object' && field.value !== null) && (
                      <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
                        {Array.isArray(field.value) 
                          ? `(array with ${field.value.length} item${field.value.length !== 1 ? 's' : ''})`
                          : `(object with ${Object.keys(field.value).length} field${Object.keys(field.value).length !== 1 ? 's' : ''})`
                        }
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    {field.description || field.jsonPointer}
                  </div>
                    </>
                  )}
                </div>
                
                <div className="text-sm text-gray-600 dark:text-gray-400 font-mono bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded">
                  {typeof field.value === 'string' ? field.value : JSON.stringify(field.value)}
                </div>
              </div>
              
              <div className="flex items-center gap-2 ml-4">
                {!isEditing && (
                  <button
                    onClick={() => startEditing(field)}
                    className="p-2 text-gray-600 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
                    title="Edit name"
                  >
                    <MdEdit size={18} />
                  </button>
                )}
                <button
                  onClick={() => onFieldRemove(field)}
                  className="p-2 text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
                  title="Remove field"
                >
                  <MdDelete size={18} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
      
      <div className="mt-4">
        <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
          <p className="text-sm text-blue-700 dark:text-blue-300">
            <strong>Tip:</strong> These fields will become dynamic parameters in your API endpoint. 
            Users will be able to provide values for these fields when making requests.
          </p>
        </div>
      </div>
    </div>
  );
};

export default ModifiableFieldsList;

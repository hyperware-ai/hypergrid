import React, { useState, useCallback } from 'react';
import { ModifiableField, ParsedCurlRequest, redactApiKey } from '../utils/enhancedCurlParser';
import { MdCode, MdCheck, MdRemove, MdSecurity } from 'react-icons/md';

interface CurlRequestInspectorProps {
  parsedRequest: ParsedCurlRequest;
  potentialFields: ModifiableField[];
  modifiableFields: ModifiableField[];
  onFieldToggleModifiable: (field: ModifiableField) => void;
}

const CurlRequestInspector: React.FC<CurlRequestInspectorProps> = ({
  parsedRequest,
  potentialFields,
  modifiableFields,
  onFieldToggleModifiable
}) => {


  const isFieldModifiable = useCallback((jsonPointer: string) => {
    return modifiableFields.some(f => f.jsonPointer === jsonPointer);
  }, [modifiableFields]);

  const getFieldByPointer = useCallback((pointer: string) => {
    return potentialFields.find(f => f.jsonPointer === pointer);
  }, [potentialFields]);

  const getModifiableFieldByPointer = useCallback((pointer: string) => {
    return modifiableFields.find(f => f.jsonPointer === pointer);
  }, [modifiableFields]);
  
  const hasModifiableParent = useCallback((jsonPointer: string) => {
    return modifiableFields.some(f => 
      jsonPointer.startsWith(f.jsonPointer + '/') && f.jsonPointer !== jsonPointer
    );
  }, [modifiableFields]);
  
  const hasModifiableChildren = useCallback((jsonPointer: string) => {
    return modifiableFields.some(f => 
      f.jsonPointer.startsWith(jsonPointer + '/') && f.jsonPointer !== jsonPointer
    );
  }, [modifiableFields]);
  




  const renderValue = (value: any, path: string, depth: number = 0): JSX.Element => {
    const potentialField = getFieldByPointer(path);
    const modifiableField = getModifiableFieldByPointer(path);
    const isModifiable = !!modifiableField;
    const canBeModifiable = !!potentialField;

    const isPartOfDynamicParent = hasModifiableParent(path);

    const indent = depth * 20;

    if (value === null) return <span className="text-gray-500">null</span>;
    if (value === undefined) return <span className="text-gray-500">undefined</span>;

    if (typeof value === 'object' && !Array.isArray(value)) {
      // Check if this object itself is a potential field (e.g., in an array)
      const objectField = getFieldByPointer(path);
      const objectModifiableField = getModifiableFieldByPointer(path);
      const isObjectModifiable = !!objectModifiableField;
      const canObjectBeModifiable = !!objectField;
      const objectHasModifiableChildren = hasModifiableChildren(path);
      
      return (
        <div style={{ marginLeft: `${indent}px` }} className="group">
          <div className="inline-flex items-center gap-2">
            <span className="text-gray-600">{`{`}</span>
                        {canObjectBeModifiable && path.includes('/') && (
              <span className="opacity-0 group-hover:opacity-100 transition-opacity text-xs">
                {!isObjectModifiable && !objectHasModifiableChildren ? (
                                                                  <button
                          onClick={() => onFieldToggleModifiable(objectField)}
                          className="p-0.5 rounded-full bg-slate-200/50 dark:bg-slate-700/30 text-slate-600 dark:text-slate-400 hover:bg-slate-300/50 dark:hover:bg-slate-600/40 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
                          title={`Select all fields in this object as individual parameters`}
                        >
                          <MdCode size={12} />
                        </button>
                ) : (
                  <button
                    onClick={() => onFieldToggleModifiable(objectField)}
                    className="p-0.5 rounded-full bg-red-200/50 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-300/50 dark:hover:bg-red-800/40 hover:text-red-700 dark:hover:text-red-300 transition-colors"
                    title={isObjectModifiable ? `"${objectModifiableField.name}" is a dynamic parameter (click to make constant)` : `Deselect all fields in this object`}
                  >
                    <MdRemove size={12} />
                  </button>
                )}
              </span>
            )}
          </div>
          <div style={{ marginLeft: '20px' }}>
            {Object.entries(value).map(([key, val], index, arr) => (
              <div key={key} className="my-1">
                <span className="text-blue-600">"{key}"</span>
                <span className="text-gray-600">: </span>
                {renderValue(val, `${path}/${key}`, depth + 1)}
                {index < arr.length - 1 && <span className="text-gray-600">,</span>}
              </div>
            ))}
          </div>
          <span className="text-gray-600">{`}`}</span>
        </div>
      );
    }

    if (Array.isArray(value)) {
      // Check if the array itself is a potential field
      const arrayField = getFieldByPointer(path);
      const arrayModifiableField = getModifiableFieldByPointer(path);
      const isArrayModifiable = !!arrayModifiableField;
      const canArrayBeModifiable = !!arrayField;
      const arrayHasModifiableChildren = hasModifiableChildren(path);
      
      return (
        <div style={{ marginLeft: `${indent}px` }} className="group">
          <div className="inline-flex items-center gap-2">
            <span className="text-gray-600">[</span>
                        {canArrayBeModifiable && (
              <span className="opacity-0 group-hover:opacity-100 transition-opacity text-xs">
                {!isArrayModifiable && !arrayHasModifiableChildren ? (
                                          <button
                          onClick={() => onFieldToggleModifiable(arrayField)}
                          className="p-0.5 rounded-full bg-slate-200/50 dark:bg-slate-700/30 text-slate-600 dark:text-slate-400 hover:bg-slate-300/50 dark:hover:bg-slate-600/40 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
                            title={`Select all fields in "${arrayField.name}" array items as individual parameters`}
                        >
                          <MdCode size={12} />
                        </button>
                ) : (
                  <button
                    onClick={() => onFieldToggleModifiable(arrayField)}
                    className="p-0.5 rounded-full bg-red-200/50 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-300/50 dark:hover:bg-red-800/40 hover:text-red-700 dark:hover:text-red-300 transition-colors"
                    title={isArrayModifiable ? `"${arrayModifiableField.name}" is a dynamic parameter (click to make constant)` : `Deselect all fields in this array`}
                  >
                    <MdRemove size={12} />
                  </button>
                )}
              </span>
            )}
          </div>
          <div style={{ marginLeft: '20px' }}>
            {value.map((item, index) => (
              <div key={index} className="my-1">
                {renderValue(item, `${path}/${index}`, depth + 1)}
                {index < value.length - 1 && <span className="text-gray-600">,</span>}
              </div>
            ))}
          </div>
          <span className="text-gray-600">]</span>
        </div>
      );
    }

    // Primitive value
    const isString = typeof value === 'string';
    const isRedacted = isString && redactApiKey(value) !== value;
    const redactedValue = isString ? redactApiKey(value) : value;
    const valueDisplay = isString ? `"${redactedValue}"` : String(redactedValue);
    const valueClass = isString ? 'text-green-600' : 'text-orange-600';

    return (
      <div className={`inline-flex items-center gap-2 ${canBeModifiable && !isPartOfDynamicParent ? 'group' : ''}`}>
        <span 
          className={`${valueClass} ${canBeModifiable && !isPartOfDynamicParent ? 'cursor-pointer hover:bg-yellow-100 px-1 rounded' : ''} ${isModifiable ? 'bg-blue-100' : ''} ${isPartOfDynamicParent ? 'opacity-50' : ''}`}
          onClick={() => canBeModifiable && !isModifiable && !isPartOfDynamicParent && onFieldToggleModifiable(potentialField)}
          title={isPartOfDynamicParent ? 'Part of a dynamic parent - cannot be individually modified' : isRedacted ? 'API key redacted for security' : ''}
        >
          {isModifiable ? `{${modifiableField.name}}` : valueDisplay}
        </span>
        {isRedacted && !isModifiable && (
          <MdSecurity size={14} className="text-gray-400" title="API key redacted for security" />
        )}
        {canBeModifiable && !isPartOfDynamicParent && (
          <div className="inline-flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {!isModifiable && (
              <button
                onClick={() => onFieldToggleModifiable(potentialField)}
                                 className="p-0.5 rounded-full bg-slate-200/50 dark:bg-slate-700/30 text-slate-600 dark:text-slate-400 hover:bg-slate-300/50 dark:hover:bg-slate-600/40 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
                title="Add as parameter"
              >
                <MdCode size={14} />
              </button>
            )}
            {isModifiable && (
              <>
                <button
                  onClick={() => onFieldToggleModifiable(modifiableField)}
                  className="p-0.5 rounded-full bg-red-200/50 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-300/50 dark:hover:bg-red-800/40 hover:text-red-700 dark:hover:text-red-300 transition-colors"
                  title="Remove parameter"
                >
                  <MdRemove size={12} />
                </button>

              </>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 overflow-auto">
      <div className="mb-3 text-sm text-gray-600 dark:text-gray-400 space-y-1">
        <div className="flex items-center gap-1">
          <MdCode size={14} className="text-gray-500" /> 
          <span>= Add parameter</span>
        </div>
        <div className="text-xs">Select what argument should be a parameter by clicking on it.</div>
      </div>
      
      <div className="space-y-4">
        {/* Method and URL */}
        <div>
          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Request</h4>
          <div className="font-mono text-sm">
            <div className="flex items-center gap-2">
              <span className="text-blue-600 font-semibold">{parsedRequest.method}</span>
              <span className="text-gray-700 dark:text-gray-300">{parsedRequest.baseUrl}</span>
            </div>
            {parsedRequest.pathname && (
              <div className="ml-4">
                <span className="text-gray-600">Path: </span>
                {parsedRequest.pathSegments.map((segment, index) => {
                  const pathPointer = `/pathSegments/${index}`;
                  const potentialField = getFieldByPointer(pathPointer);
                  const modifiableField = getModifiableFieldByPointer(pathPointer);
                  const isModifiable = !!modifiableField;

                  return (
                    <span key={index} className="group inline-flex items-center">
                      <span className="text-gray-600">/</span>
                      <span 
                        className={`cursor-pointer hover:bg-yellow-100 px-1 rounded transition-colors ${
                                                     isModifiable ? 'bg-blue-100' : ''
                        }`}
                        onClick={() => potentialField && !isModifiable && onFieldToggleModifiable(potentialField)}
                      >
                        {isModifiable ? (
                          <span className="text-blue-600 font-semibold">{`{${modifiableField.name}}`}</span>
                        ) : (
                          <span className="text-gray-700">{segment}</span>
                        )}
                      </span>
                      {!isModifiable && (
                        <button
                          onClick={() => potentialField && onFieldToggleModifiable(potentialField)}
                          className="ml-1 p-0.5 rounded-full opacity-0 group-hover:opacity-100 transition-all bg-slate-200/50 dark:bg-slate-700/30 text-slate-600 dark:text-slate-400 hover:bg-slate-300/50 dark:hover:bg-slate-600/40 hover:text-slate-700 dark:hover:text-slate-300"
                          title="Add as parameter"
                        >
                          <MdCode size={12} />
                        </button>
                      )}
                      {isModifiable && (
                        <button
                          onClick={() => onFieldToggleModifiable(modifiableField)}
                          className="ml-1 p-0.5 rounded-full opacity-0 group-hover:opacity-100 transition-all bg-red-200/50 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-300/50 dark:hover:bg-red-800/40 hover:text-red-700 dark:hover:text-red-300"
                          title="Remove parameter"
                        >
                          <MdRemove size={12} />
                        </button>
                      )}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Query Parameters */}
        {Object.keys(parsedRequest.queryParams).length > 0 && (
          <div>
            <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Query Parameters</h4>
            <div className="font-mono text-sm space-y-1">
              {Object.entries(parsedRequest.queryParams).map(([key, value]) => {
                const field = getFieldByPointer(`/queryParams/${key}`);
                const modifiableField = getModifiableFieldByPointer(`/queryParams/${key}`);
                const isModifiable = !!modifiableField;

                return (
                  <div key={key} className="flex items-center gap-2 group">
                    <span className="text-blue-600">{key}:</span>
                    {isModifiable ? (
                      <span className="px-2 py-0.5 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 rounded font-medium">
                        {`{${modifiableField.name}}`}
                      </span>
                    ) : (
                      <span 
                        className="text-green-600 cursor-pointer hover:bg-yellow-100 dark:hover:bg-yellow-900/20 px-1 rounded transition-colors"
                        onClick={() => field && onFieldToggleModifiable(field)}
                        title="Click to make this query parameter a parameter"
                      >
                        "{redactApiKey(value)}"
                      </span>
                    )}
                    {field && !isModifiable && (
                      <button
                        onClick={() => onFieldToggleModifiable(field)}
                        className="ml-1 p-0.5 rounded-full opacity-0 group-hover:opacity-100 transition-all bg-slate-200/50 dark:bg-slate-700/30 text-slate-600 dark:text-slate-400 hover:bg-slate-300/50 dark:hover:bg-slate-600/40 hover:text-slate-700 dark:hover:text-slate-300"
                        title="Add as parameter"
                      >
                        <MdCode size={14} />
                      </button>
                    )}
                    {isModifiable && (
                      <button
                        onClick={() => onFieldToggleModifiable(modifiableField)}
                        className="ml-1 p-0.5 rounded-full opacity-0 group-hover:opacity-100 transition-all bg-red-200/50 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-300/50 dark:hover:bg-red-800/40 hover:text-red-700 dark:hover:text-red-300"
                        title="Remove parameter"
                      >
                        <MdRemove size={12} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Headers */}
        {Object.keys(parsedRequest.headers).length > 0 && (
          <div>
            <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Headers</h4>
            <div className="font-mono text-sm space-y-1">
              {Object.entries(parsedRequest.headers).map(([key, value]) => {
                const field = getFieldByPointer(`/headers/${key}`);
                const modifiableField = getModifiableFieldByPointer(`/headers/${key}`);
                const isModifiable = !!modifiableField;

                return (
                  <div key={key} className="flex items-center gap-2 group">
                    <span className="text-blue-600">{key}:</span>
                    {isModifiable ? (
                      <span className="px-2 py-0.5 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 rounded font-medium">
                        {`{${modifiableField.name}}`}
                      </span>
                    ) : (
                      <span 
                        className="text-green-600 cursor-pointer hover:bg-yellow-100 dark:hover:bg-yellow-900/20 px-1 rounded transition-colors"
                        onClick={() => field && onFieldToggleModifiable(field)}
                        title="Click to make this header a parameter"
                      >
                        "{redactApiKey(value)}"
                      </span>
                    )}
                    {field && !isModifiable && (
                      <button
                        onClick={() => onFieldToggleModifiable(field)}
                        className="ml-1 p-0.5 rounded-full opacity-0 group-hover:opacity-100 transition-all bg-slate-200/50 dark:bg-slate-700/30 text-slate-600 dark:text-slate-400 hover:bg-slate-300/50 dark:hover:bg-slate-600/40 hover:text-slate-700 dark:hover:text-slate-300"
                        title="Add as parameter"
                      >
                        <MdCode size={14} />
                      </button>
                    )}
                    {isModifiable && (
                      <button
                        onClick={() => onFieldToggleModifiable(modifiableField)}
                        className="ml-1 p-0.5 rounded-full opacity-0 group-hover:opacity-100 transition-all bg-red-200/50 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-300/50 dark:hover:bg-red-800/40 hover:text-red-700 dark:hover:text-red-300"
                        title="Remove parameter"
                      >
                        <MdRemove size={12} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Body */}
        {parsedRequest.body && (
          <div>
            <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Body</h4>
            <div className="font-mono text-sm">
              {(() => {
                // Try to parse string bodies as JSON for display
                let bodyToRender = parsedRequest.body;
                if (typeof parsedRequest.body === 'string') {
                  try {
                    bodyToRender = JSON.parse(parsedRequest.body);
                  } catch (e) {
                    // If not JSON, display as string
                    return (
                      <pre className="bg-gray-100 dark:bg-gray-800 p-2 rounded overflow-auto">
                        {parsedRequest.body}
                      </pre>
                    );
                  }
                }
                return renderValue(bodyToRender, '/body');
              })()}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CurlRequestInspector;
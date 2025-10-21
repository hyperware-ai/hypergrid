import * as jsonpointer from 'json-pointer';
import { parse } from '@annatarhe/curl-to-js';

/**
 * Detects if a string looks like an API key or sensitive token
 */
export function looksLikeApiKey(value: string): boolean {
  if (typeof value !== 'string' || value.length < 20) return false;
  
  // Common API key patterns
  const patterns = [
    /^sk-[a-zA-Z0-9_-]{20,}$/,                  // OpenAI style (with dashes/underscores)
    /^[a-zA-Z0-9]{32,}$/,                       // Generic long alphanumeric
    /^[a-zA-Z0-9_-]{40,}$/,                     // With dashes/underscores
    /^Bearer\s+[a-zA-Z0-9._-]{20,}$/i,         // Bearer tokens
    /^[a-f0-9]{40,64}$/,                        // Hex tokens (SHA)
    /api[_-]?key/i,                             // Contains "api_key" or similar
    /^pk_[a-zA-Z0-9]{20,}$/,                    // Stripe-style public keys
    /^sk_[a-zA-Z0-9]{20,}$/,                    // Stripe-style secret keys
  ];
  
  return patterns.some(pattern => pattern.test(value));
}

/**
 * Redacts a potential API key for display
 */
export function redactApiKey(value: string): string {
  if (!looksLikeApiKey(value)) return value;
  
  // Show first 8 and last 4 characters
  if (value.length > 20) {
    return `${value.slice(0, 8)}...${value.slice(-4)}`;
  }
  
  // For shorter keys, show less
  return `${value.slice(0, 4)}...`;
}

/**
 * Helper function to describe the structure of a value for documentation
 */
function describeStructure(value: any): any {
  if (value === null || value === undefined) {
    return 'null';
  }
  
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '[]';
    }
    return [`array of ${describeStructure(value[0])}`];
  }
  
  if (typeof value === 'object') {
    const structure: Record<string, any> = {};
    for (const [key, val] of Object.entries(value)) {
      structure[key] = describeStructure(val);
    }
    return structure;
  }
  
  return typeof value;
}



export interface ParsedCurlRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: any;
  queryParams: Record<string, string>;
  pathSegments: string[];
  fullCurl: string;
  baseUrl: string;
  pathname: string;
}

export interface ModifiableField {
  jsonPointer: string;
  fieldType: 'path' | 'query' | 'header' | 'body';
  name: string;
  value: any;
  description?: string;
}

export interface CurlTemplate {
  originalCurl: string;
  parsedRequest: ParsedCurlRequest;
  modifiableFields: ModifiableField[];
}

/**
 * Parses a curl command using @annatarhe/curl-to-js library
 */
export function parseCurlCommand(curlString: string): ParsedCurlRequest {
  try {
    // First normalize the curl string - handle line continuations
    const normalizedCurl = curlString.replace(/\\\s*\n\s*/g, ' ').trim();
    
    // Use @annatarhe/curl-to-js to parse the curl command
    const parsedData = parse(normalizedCurl);
    
    // The parser returns a URL object, extract components
    const urlObj = parsedData.url;
    if (!urlObj) {
      throw new Error('No URL found in curl command');
    }
    
    // Handle body - check if it's already parsed
    let body = parsedData.body || null;
    
    // If body is a string, try to parse it as JSON
    if (typeof body === 'string' && body.trim()) {
      try {
        body = JSON.parse(body);
      } catch (e) {
        // Keep as string if not valid JSON
        console.log('Body is not valid JSON, keeping as string');
      }
    }
    
    const queryParams: Record<string, string> = {};
    
    // Extract query parameters from the URL object
    urlObj.searchParams.forEach((value, key) => {
      queryParams[key] = value;
    });
    
    // Extract path segments
    const pathSegments = urlObj.pathname.split('/').filter(segment => segment.length > 0);
    
    // Create base URL without query parameters
    const baseUrl = `${urlObj.protocol}//${urlObj.host}`;
    
    // Headers are already in the right format from this parser
    const headers = parsedData.headers || {};
    
    // Infer method - cURL defaults to POST if there's data, GET otherwise
    let method = parsedData.method;
    if (!method || (method === 'GET' && body)) {
      // If no method specified, or if method is GET but there's data, infer from presence of body
      // cURL defaults to POST if there's data, GET otherwise
      method = body ? 'POST' : 'GET';
    }

    return {
      method: method,
      url: urlObj.href,
      headers,
      body: body,  // Use the processed body
      queryParams,
      pathSegments,
      fullCurl: curlString,
      baseUrl,
      pathname: urlObj.pathname
    };
  } catch (error) {
    throw new Error(`Failed to parse curl command: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}


/**
 * Identifies all potential fields that could be made modifiable in the parsed request
 */
export function identifyPotentialFields(parsedRequest: ParsedCurlRequest): ModifiableField[] {
  const fields: ModifiableField[] = [];
  
  // Make ALL path segments potential fields - let the user decide which ones should be dynamic
  parsedRequest.pathSegments.forEach((segment, index) => {
    fields.push({
      jsonPointer: `/pathSegments/${index}`,
      fieldType: 'path',
      name: suggestParameterName(segment, index, parsedRequest.pathSegments),
      value: segment,
      description: `Path segment: /${segment}`
    });
  });
  
  // Add all query parameters
  Object.entries(parsedRequest.queryParams).forEach(([key, value]) => {
    fields.push({
      jsonPointer: `/queryParams/${key}`,
      fieldType: 'query',
      name: key,
      value: value,
      description: `Query parameter: ${key}`
    });
  });
  
  // Add non-standard headers
  Object.entries(parsedRequest.headers).forEach(([key, value]) => {
    if (!isStandardHeader(key)) {
      fields.push({
        jsonPointer: `/headers/${key}`,
        fieldType: 'header',
        name: key,
        value: value,
        description: `Header: ${key}`
      });
    }
  });
  
  // Add body fields if body is an object
  if (parsedRequest.body && typeof parsedRequest.body === 'object') {
    addBodyFields(parsedRequest.body, '/body', fields);
  }
  
  return fields;
}

/**
 * Recursively adds body fields to the modifiable fields list
 */
function addBodyFields(obj: any, basePath: string, fields: ModifiableField[], depth: number = 0): void {
  if (depth > 5) return; // Prevent infinite recursion
  
  Object.entries(obj).forEach(([key, value]) => {
    const pointer = `${basePath}/${key}`;
    
    if (value === null || value === undefined) {
      // Still add null/undefined values as they might need to be dynamic
      fields.push({
        jsonPointer: pointer,
        fieldType: 'body',
        name: key,
        value: value,
        description: `Body field: ${pointer.substring(6)} (entire value)` // Remove '/body' prefix
      });
      return;
    }
    
    if (Array.isArray(value)) {
      // Add the array itself as a modifiable field
      fields.push({
        jsonPointer: pointer,
        fieldType: 'body',
        name: key,
        value: value,
        description: `Body field: ${pointer.substring(6)} (entire array)` // Remove '/body' prefix
      });
      
      // Also process array elements
      value.forEach((item, index) => {
        const itemPointer = `${pointer}/${index}`;
        
        if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
          // For objects in arrays, add the object itself as modifiable
          fields.push({
            jsonPointer: itemPointer,
            fieldType: 'body',
            name: `${key}[${index}]`,
            value: item,
            description: `Body field: ${itemPointer.substring(6)}`
          });
          
          // And recursively add its properties
          addBodyFields(item, itemPointer, fields, depth + 1);
        } else if (typeof item === 'object' && item !== null && Array.isArray(item)) {
          // Nested array
          fields.push({
            jsonPointer: itemPointer,
            fieldType: 'body',
            name: `${key}[${index}]`,
            value: item,
            description: `Body field: ${itemPointer.substring(6)}`
          });
          // Could recursively process nested arrays here if needed
        } else {
          // Primitive values in arrays
          fields.push({
            jsonPointer: itemPointer,
            fieldType: 'body',
            name: `${key}[${index}]`,
            value: item,
            description: `Body field: ${itemPointer.substring(6)}`
          });
        }
      });
    } else if (typeof value === 'object') {
      // Recursively process nested objects
      addBodyFields(value, pointer, fields, depth + 1);
    } else {
      // Add primitive values as modifiable fields
      fields.push({
        jsonPointer: pointer,
        fieldType: 'body',
        name: key,
        value: value,
        description: `Body field: ${pointer.substring(6)}` // Remove '/body' prefix
      });
    }
  });
}


/**
 * Suggests a parameter name based on the segment and context
 */
function suggestParameterName(segment: string, index: number, allSegments: string[]): string {
  // If it's already a placeholder, extract the name
  if (/^\{([^}]+)\}$/.test(segment)) {
    return segment.slice(1, -1);
  }
  if (/^:(.+)$/.test(segment)) {
    return segment.slice(1);
  }
  
  // Simple pattern-based names
  if (/^\d+$/.test(segment)) return 'id';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment)) return 'uuid';
  
  // Use generic argument names
  return `argument${index + 1}`;
}

/**
 * Checks if a header is a standard HTTP header
 */
function isStandardHeader(headerName: string): boolean {
  const standardHeaders = [
    'content-type', 'accept', 'user-agent', 'host', 'connection', 'cache-control',
    'accept-encoding', 'accept-language', 'origin', 'referer', 'content-length',
    'transfer-encoding', 'upgrade', 'via', 'warning'
  ];
  return standardHeaders.includes(headerName.toLowerCase());
}

/**
 * Creates a curl template with specified modifiable fields
 */
export function createCurlTemplate(
  parsedRequest: ParsedCurlRequest,
  selectedFields: ModifiableField[]
): CurlTemplate {
  return {
    originalCurl: parsedRequest.fullCurl,
    parsedRequest,
    modifiableFields: selectedFields
  };
}

/**
 * Applies values to a curl template to create an executable request
 */
export function applyCurlTemplateValues(
  template: CurlTemplate,
  values: Record<string, any>
): ParsedCurlRequest {
  // Deep clone the parsed request
  const request = JSON.parse(JSON.stringify(template.parsedRequest));
  
  // Apply each modifiable field value
  template.modifiableFields.forEach(field => {
    if (values.hasOwnProperty(field.name)) {
      try {
        // For body fields, we need to ensure the body object exists
        if (field.fieldType === 'body' && field.jsonPointer.startsWith('/body')) {
          if (!request.body) {
            request.body = {};
          }
        }
        
        jsonpointer.set(request, field.jsonPointer, values[field.name]);
      } catch (error) {
        console.error(`Failed to set value for ${field.jsonPointer}:`, error);
      }
    }
  });
  
  // Rebuild the URL if path or query parameters were modified
  const urlObj = new URL(request.baseUrl);
  
  // Update path if segments were modified
  if (request.pathSegments.length > 0) {
    urlObj.pathname = '/' + request.pathSegments.join('/');
  }
  
  // Update query parameters
  urlObj.search = '';
  Object.entries(request.queryParams).forEach(([key, value]) => {
    urlObj.searchParams.set(key, String(value));
  });
  
  request.url = urlObj.toString();
  
  return request;
}

/**
 * Formats a cURL command for display
 */
export function formatCurlCommand(curl: string): string {
  return curl
    .replace(/\s+/g, ' ') // Normalize whitespace
    .replace(/\s*\\\s*/g, ' \\\n  ') // Format line continuations
    .replace(/(-[A-Za-z])\s+/g, '$1 ') // Ensure single space after flags
    .trim();
}

/**
 * Converts a curl template to the format expected by the backend
 */
export function curlTemplateToBackendFormat(template: CurlTemplate): any {
  const { parsedRequest, modifiableFields } = template;
  
  // Create explicit parameter definitions
  const parameters = modifiableFields.map(field => {
    const baseDefinition = {
      // Unique identifier for this parameter
      parameter_name: field.name,
      
      // Where to find this parameter in the original request structure
      json_pointer: field.jsonPointer,
      
      // What type of parameter it is
      location: field.fieldType, // 'path' | 'query' | 'header' | 'body'
      
      // The example value from the original curl
      example_value: JSON.stringify(field.value),
      
      // Data type for validation
      value_type: typeof field.value === 'object' ? 
        (Array.isArray(field.value) ? 'array' : 'object') : 
        typeof field.value
    };

    // For complex types, just include the example
    if (typeof field.value === 'object' && field.value !== null) {
      baseDefinition['example_structure'] = field.value;
    }

    return baseDefinition;
  });
  
  // Create URL template with parameter placeholders
  let url_template = parsedRequest.baseUrl + parsedRequest.pathname;
  
  // Replace path segments with parameter names
  modifiableFields
    .filter(f => f.fieldType === 'path')
    .forEach(field => {
      const segmentIndex = parseInt(field.jsonPointer.split('/').pop() || '0');
      const segment = parsedRequest.pathSegments[segmentIndex];
      if (segment) {
        url_template = url_template.replace(`/${segment}`, `/{${field.name}}`);
      }
    });
  
  return {
    // Original curl for reference
    original_curl: template.originalCurl,
    
    // Basic request info
    method: parsedRequest.method,
    base_url: parsedRequest.baseUrl,
    url_template: url_template,
    
    // All headers, body, etc. from original request (with example values)
    original_headers: Object.entries(parsedRequest.headers),
    original_body: parsedRequest.body ? JSON.stringify(parsedRequest.body) : undefined,
    
    // Explicit list of what can be modified
    parameters: parameters,
    
    // Parameter names only (for quick validation)
    parameter_names: modifiableFields.map(f => f.name)
  };
}

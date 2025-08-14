import { TopLevelRequestType, AuthChoice } from '../types/hypergrid_provider';

export interface CurlParseResult {
  method: 'GET' | 'POST';
  url: string;
  headers: Record<string, string>;
  body?: any;
  queryParams: Record<string, string>;
  pathSegments: string[];
  success: boolean;
  errors: string[];
}

export interface CurlToFormMapping {
  endpointBaseUrl: string;
  topLevelRequestType: TopLevelRequestType;
  pathParamKeys: string[];
  queryParamKeys: string[];
  headerKeys: string[];
  bodyKeys: string[];
  endpointApiParamKey: string;
  authChoice: AuthChoice;
  apiKeyQueryParamName: string;
  apiKeyHeaderName: string;
  detectedApiKeyLocation?: 'header' | 'query' | 'none';
  warnings: string[];
  exampleValues?: Record<string, string>; // Original values from the curl command for preview
}

/**
 * Normalizes a curl command by handling line continuations and common variations
 */
function normalizeCurlCommand(curlString: string): string {
  return curlString
    .replace(/\\\s*\n\s*/g, ' ') // Handle line continuations
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();
}

/**
 * Extracts HTTP method from curl command
 */
function extractMethod(curl: string): 'GET' | 'POST' {
  const methodMatch = curl.match(/-X\s+([A-Z]+)|--request\s+([A-Z]+)/i);
  if (methodMatch) {
    const method = (methodMatch[1] || methodMatch[2]).toUpperCase();
    return method === 'POST' ? 'POST' : 'GET';
  }
  
  // If no explicit method but has data, assume POST
  if (curl.includes('-d ') || curl.includes('--data')) {
    return 'POST';
  }
  
  return 'GET';
}

/**
 * Extracts headers from curl command
 */
function extractHeaders(curl: string): Record<string, string> {
  const headers: Record<string, string> = {};
  
  // Match -H "Header: Value" or --header "Header: Value"
  const headerMatches = curl.matchAll(/-H\s+["']([^"']+)["']|--header\s+["']([^"']+)["']/g);
  
  for (const match of headerMatches) {
    const headerString = match[1] || match[2];
    const colonIndex = headerString.indexOf(':');
    if (colonIndex > 0) {
      const key = headerString.substring(0, colonIndex).trim();
      const value = headerString.substring(colonIndex + 1).trim();
      headers[key] = value;
    }
  }
  
  return headers;
}

/**
 * Extracts JSON body from curl command
 */
function extractBody(curl: string): any {
  // Match -d '{}' or --data '{}'
  const dataMatches = [
    ...curl.matchAll(/-d\s+["']([^"']+)["']/g),
    ...curl.matchAll(/--data\s+["']([^"']+)["']/g),
    ...curl.matchAll(/-d\s+([^"'\s]+)/g),
    ...curl.matchAll(/--data\s+([^"'\s]+)/g)
  ];
  
  for (const match of dataMatches) {
    const data = match[1];
    try {
      return JSON.parse(data);
    } catch (e) {
      // If not JSON, return as string
      return data;
    }
  }
  
  return undefined;
}

/**
 * Extracts URL from curl command (should be the last argument)
 */
function extractUrl(curl: string): string {
  // URL is typically the last argument, often quoted
  const urlMatches = curl.match(/["']([^"']*(?:https?:\/\/|\/)[^"']*)["'](?:\s*$)|([^\s]*(?:https?:\/\/|\/)[^\s]*)(?:\s*$)/);
  if (urlMatches) {
    return urlMatches[1] || urlMatches[2];
  }
  
  // Fallback: look for anything that looks like a URL
  const fallbackMatch = curl.match(/(https?:\/\/[^\s]+)/);
  return fallbackMatch ? fallbackMatch[1] : '';
}

/**
 * Parses URL to extract components
 */
function parseUrl(url: string): { baseUrl: string; queryParams: Record<string, string>; pathSegments: string[] } {
  try {
    const urlObj = new URL(url);
    const queryParams: Record<string, string> = {};
    
    // Extract query parameters
    urlObj.searchParams.forEach((value, key) => {
      queryParams[key] = value;
    });
    
    // Extract path segments (filter out empty segments)
    const pathSegments = urlObj.pathname.split('/').filter(segment => segment.length > 0);
    
    // Create base URL without query parameters but with the pathname
    const baseUrl = `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}`;
    
    return { baseUrl, queryParams, pathSegments };
  } catch (e) {
    return { baseUrl: url, queryParams: {}, pathSegments: [] };
  }
}

/**
 * Main curl parsing function
 */
export function parseCurlCommand(curlString: string): CurlParseResult {
  const errors: string[] = [];
  
  try {
    const normalizedCurl = normalizeCurlCommand(curlString);
    
    if (!normalizedCurl.toLowerCase().startsWith('curl')) {
      errors.push('Command must start with "curl"');
    }
    
    const method = extractMethod(normalizedCurl);
    const headers = extractHeaders(normalizedCurl);
    const body = extractBody(normalizedCurl);
    const url = extractUrl(normalizedCurl);
    
    if (!url) {
      errors.push('Could not extract URL from curl command');
    }
    
    const { baseUrl, queryParams, pathSegments } = parseUrl(url);
    
    return {
      method,
      url: baseUrl,
      headers,
      body,
      queryParams,
      pathSegments,
      success: errors.length === 0,
      errors
    };
  } catch (e) {
    errors.push(`Parsing error: ${e instanceof Error ? e.message : 'Unknown error'}`);
    return {
      method: 'GET',
      url: '',
      headers: {},
      queryParams: {},
      pathSegments: [],
      success: false,
      errors
    };
  }
}

/**
 * Converts parsed curl result to form data
 */
export function curlToFormData(parseResult: CurlParseResult): CurlToFormMapping {
  const warnings: string[] = [];
  
  if (!parseResult.success) {
    warnings.push(...parseResult.errors);
  }
  
  // Determine request type
  let topLevelRequestType: TopLevelRequestType = 'getWithQuery';
  if (parseResult.method === 'POST' && parseResult.body) {
    topLevelRequestType = 'postWithJson';
  } else if (parseResult.method === 'GET' && parseResult.pathSegments.length > 0) {
    // Check if path has dynamic segments (numbers that could be IDs)
    const hasDynamicSegments = parseResult.pathSegments.some(segment => 
      /^\d+$/.test(segment) || segment.length > 10
    );
    if (hasDynamicSegments) {
      topLevelRequestType = 'getWithPath';
    }
  }
  
  // Extract parameter keys
  const queryParamKeys = Object.keys(parseResult.queryParams);
  const headerKeys = Object.keys(parseResult.headers).filter(key => 
    !isAuthHeader(key) && !isStandardHeader(key)
  );
  const bodyKeys = parseResult.body && typeof parseResult.body === 'object' 
    ? Object.keys(parseResult.body) 
    : [];
  
  // Detect API key location and extract
  const apiKeyDetection = detectApiKey(parseResult.headers, parseResult.queryParams);
  
  // Generate path parameter keys and create URL template if this looks like a path-based API
  const pathParamKeys: string[] = [];
  const exampleValues: Record<string, string> = {};
  let endpointBaseUrl = parseResult.url;
  
  // Extract example values from query parameters and headers
  Object.entries(parseResult.queryParams).forEach(([key, value]) => {
    exampleValues[key] = value;
  });
  
  Object.entries(parseResult.headers).forEach(([key, value]) => {
    if (!isAuthHeader(key) && !isStandardHeader(key)) {
      exampleValues[key] = value;
    }
  });
  
  // Extract example values from body
  if (parseResult.body && typeof parseResult.body === 'object') {
    Object.entries(parseResult.body).forEach(([key, value]) => {
      exampleValues[key] = String(value);
    });
  }
  
  if (topLevelRequestType === 'getWithPath') {
    // First pass: identify dynamic segments and generate parameter names
    const dynamicSegmentInfo: Array<{index: number, paramName: string, originalValue: string}> = [];
    
    parseResult.pathSegments.forEach((segment, index) => {
      if (/^\d+$/.test(segment)) {
        // Numeric segment - likely an ID
        // Look at the previous segment for context
        const prevSegment = index > 0 ? parseResult.pathSegments[index - 1] : null;
        let paramName = 'id';
        if (prevSegment && prevSegment !== 'v1' && prevSegment !== 'api') {
          // Remove plural 's' if present and create meaningful parameter name
          const singular = prevSegment.endsWith('s') ? prevSegment.slice(0, -1) : prevSegment;
          paramName = `${singular}Id`;
        }
        pathParamKeys.push(paramName);
        exampleValues[paramName] = segment; // Store the original value
        dynamicSegmentInfo.push({index, paramName, originalValue: segment});
      } else if (segment.length > 15) {
        // Very long segment - might be a UUID or complex ID
        const paramName = `param${pathParamKeys.length}`;
        pathParamKeys.push(paramName);
        exampleValues[paramName] = segment; // Store the original value
        dynamicSegmentInfo.push({index, paramName, originalValue: segment});
      }
    });
    
    // Second pass: create URL template by replacing dynamic segments
    if (dynamicSegmentInfo.length > 0) {
      // Start with the original URL and carefully replace only the path segments
      try {
        const urlObj = new URL(parseResult.url);
        const segments = parseResult.pathSegments.slice(); // Copy the array
        
        // Replace the dynamic segments with template variables
        dynamicSegmentInfo.forEach(({index, paramName}) => {
          segments[index] = `{${paramName}}`;
        });
        
        // Reconstruct pathname
        const newPathname = '/' + segments.join('/');
        endpointBaseUrl = `${urlObj.protocol}//${urlObj.host}${newPathname}`;
      } catch (e) {
        // Fallback: keep original URL if reconstruction fails
        console.warn('Failed to reconstruct URL template:', e);
        endpointBaseUrl = parseResult.url;
      }
    }
  }
  
  return {
    endpointBaseUrl,
    topLevelRequestType,
    pathParamKeys,
    queryParamKeys: queryParamKeys.filter(key => key !== apiKeyDetection.queryParamName),
    headerKeys,
    bodyKeys,
    endpointApiParamKey: apiKeyDetection.apiKey,
    authChoice: apiKeyDetection.location,
    apiKeyQueryParamName: apiKeyDetection.queryParamName || '',
    apiKeyHeaderName: apiKeyDetection.headerName || '',
    detectedApiKeyLocation: apiKeyDetection.location,
    warnings,
    exampleValues
  };
}

/**
 * Detects API key in headers or query parameters
 */
function detectApiKey(headers: Record<string, string>, queryParams: Record<string, string>) {
  // Common API key header names
  const apiKeyHeaders = ['authorization', 'x-api-key', 'apikey', 'api-key', 'x-auth-token', 'access-token'];
  
  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();
    if (apiKeyHeaders.includes(lowerKey)) {
      let apiKey = value;
      
      // Handle Bearer tokens
      if (lowerKey === 'authorization' && value.startsWith('Bearer ')) {
        apiKey = value.substring(7);
      }
      
      return {
        location: 'header' as AuthChoice,
        headerName: key,
        queryParamName: undefined,
        apiKey
      };
    }
  }
  
  // Common API key query parameter names
  const apiKeyParams = ['api_key', 'apikey', 'key', 'token', 'access_token'];
  
  for (const [key, value] of Object.entries(queryParams)) {
    const lowerKey = key.toLowerCase();
    if (apiKeyParams.includes(lowerKey)) {
      return {
        location: 'query' as AuthChoice,
        headerName: undefined,
        queryParamName: key,
        apiKey: value
      };
    }
  }
  
  return {
    location: 'none' as AuthChoice,
    headerName: undefined,
    queryParamName: undefined,
    apiKey: ''
  };
}

/**
 * Checks if a header is an authentication header
 */
function isAuthHeader(headerName: string): boolean {
  const authHeaders = ['authorization', 'x-api-key', 'apikey', 'api-key', 'x-auth-token', 'access-token'];
  return authHeaders.includes(headerName.toLowerCase());
}

/**
 * Checks if a header is a standard HTTP header that shouldn't be in the custom headers list
 */
function isStandardHeader(headerName: string): boolean {
  const standardHeaders = [
    'content-type', 'accept', 'user-agent', 'host', 'connection', 'cache-control',
    'accept-encoding', 'accept-language', 'origin', 'referer'
  ];
  return standardHeaders.includes(headerName.toLowerCase());
}

// Default export to ensure module is recognized
export default { parseCurlCommand, curlToFormData };

// Utility functions for API endpoint routing

const getApiBasePath = () => {
    const pathParts = window.location.pathname.split('/').filter(p => p);
    const packagePath = pathParts.find(p => p.includes(':'));
    return packagePath ? `/${packagePath}/api` : '/api';
};

// Determine the correct endpoint based on the operation
export const getEndpointForOperation = (operation: string): string => {
    const pathParts = window.location.pathname.split('/').filter(p => p);
    const packagePath = pathParts.find(p => p.includes(':'));
    const basePath = packagePath ? `/${packagePath}` : '';
    
    
    // All other operations go to the standard /api endpoint
    return `${basePath}/api`;
};

// Helper to make API calls with automatic endpoint routing
export const callApiWithRouting = async (body: any) => {
    // Extract the operation name from the request body
    const operation = Object.keys(body)[0];
    const endpoint = getEndpointForOperation(operation);
    
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    
    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.error || `API Error: ${response.statusText}`);
    }
    return data;
};

// Legacy function - kept for backwards compatibility but logs deprecation warning
export const callMcpApi = async (endpoint: string, body: any) => {
    console.warn('callMcpApi is deprecated. Use callApiWithRouting instead.');
    return callApiWithRouting(body);
};

// Export endpoints for direct use if needed
export const API_ENDPOINT = getApiBasePath();
export const SHIM_MCP_ENDPOINT = (() => {
    const pathParts = window.location.pathname.split('/').filter(p => p);
    const packagePath = pathParts.find(p => p.includes(':'));
    const basePath = packagePath ? `/${packagePath}` : '';
    return `${basePath}/shim/mcp`;
})(); 
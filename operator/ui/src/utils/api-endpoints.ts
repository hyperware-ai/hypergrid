// Utility functions for API endpoint routing

const getApiBasePath = () => {
    const pathParts = window.location.pathname.split('/').filter(p => p);
    const packagePath = pathParts.find(p => p.includes(':'));
    return packagePath ? `/${packagePath}/api` : '/api';
};

// Operations that are actual MCP (Model Context Provider) operations
const MCP_OPERATIONS = ['SearchRegistry', 'CallProvider'];

// Determine the correct endpoint based on the operation
export const getEndpointForOperation = (operation: string): string => {
    const basePath = getApiBasePath();
    
    // Check if it's an actual MCP operation
    if (MCP_OPERATIONS.includes(operation)) {
        return `${basePath}/mcp`;
    }
    
    // All other operations go to the /api/actions endpoint
    return `${basePath}/actions`;
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
export const MCP_ENDPOINT = `${getApiBasePath()}/mcp`;
export const API_ACTIONS_ENDPOINT = `${getApiBasePath()}/actions`; 
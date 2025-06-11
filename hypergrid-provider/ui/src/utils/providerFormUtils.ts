import { HttpMethod, EndpointDefinition, RegisteredProvider, RegisterProviderResponse, RequestStructureType, UpdateProviderResponse } from '../types/hypergrid_provider';
import { TopLevelRequestType, AuthChoice } from '../App'; // Assuming types are exported

// Interface for the data object passed to utility functions
// This collects all relevant form state needed by the utils
export interface ProviderFormData {
  providerName: string;
  providerDescription: string;
  providerId: string;
  instructions: string;
  registeredProviderWallet: string;
  price: string;
  topLevelRequestType: TopLevelRequestType;
  endpointBaseUrl: string;
  pathParamKeys: string[];
  queryParamKeys: string[];
  headerKeys: string[];
  bodyKeys: string[];
  endpointApiParamKey: string;
  authChoice: AuthChoice;
  apiKeyQueryParamName: string;
  apiKeyHeaderName: string;
}

interface ValidationResult {
  isValid: boolean;
  error?: string;
}

// New interface for API response feedback
export interface ApiResponseFeedback {
  status: 'success' | 'error' | 'info';
  message: string;
}

export function validateProviderConfig(data: ProviderFormData): ValidationResult {
  if (!data.providerName.trim() || !data.endpointBaseUrl.trim()) {
    return { isValid: false, error: "Provider Name and Base URL Template are required." };
  }
  if (data.endpointApiParamKey.trim() && data.authChoice === 'query' && !data.apiKeyQueryParamName.trim()) {
    return { isValid: false, error: "API Key Query Parameter Name is required when API Key is provided and auth method is Query." };
  }
  if (data.endpointApiParamKey.trim() && data.authChoice === 'header' && !data.apiKeyHeaderName.trim()) {
    return { isValid: false, error: "API Key Header Name is required when API Key is provided and auth method is Header." };
  }
  // Add any other general validations if needed
  return { isValid: true };
}

export function buildProviderPayload(data: ProviderFormData): { RegisterProvider: RegisteredProvider } {
  const finalEndpointName = data.providerName.trim();

  let derivedHttpMethod: HttpMethod;
  let requestStructure: RequestStructureType;

  switch (data.topLevelRequestType) {
    case "getWithPath":
      derivedHttpMethod = HttpMethod.GET;
      requestStructure = RequestStructureType.GetWithPath;
      break;
    case "getWithQuery":
      derivedHttpMethod = HttpMethod.GET;
      requestStructure = RequestStructureType.GetWithQuery;
      break;
    case "postWithJson":
      derivedHttpMethod = HttpMethod.POST;
      requestStructure = RequestStructureType.PostWithJson;
      break;
    default:
      // Fallback or error - should ideally not happen with UI validation
      console.error("Invalid topLevelRequestType in buildProviderPayload!");
      // Defaulting - consider throwing an error or using a default structure type
      derivedHttpMethod = HttpMethod.GET; 
      requestStructure = RequestStructureType.GetWithQuery; // Arbitrary default
      break;
  }

  const pathKeys = data.pathParamKeys.filter(k => k.trim());
  const queryKeys = data.queryParamKeys.filter(k => k.trim());
  const headerKeys = data.headerKeys.filter(k => k.trim());
  const bodyKeys = data.topLevelRequestType === "postWithJson" ? data.bodyKeys.filter(k => k.trim()) : [];

  const endpointDef: EndpointDefinition = {
    name: finalEndpointName,
    method: derivedHttpMethod,
    request_structure: requestStructure,
    base_url_template: data.endpointBaseUrl,
    path_param_keys: pathKeys.length > 0 ? pathKeys : undefined,
    query_param_keys: queryKeys.length > 0 ? queryKeys : undefined,
    header_keys: headerKeys.length > 0 ? headerKeys : undefined,
    body_param_keys: bodyKeys.length > 0 ? bodyKeys : undefined,
    api_key: data.endpointApiParamKey.trim() || undefined,
    api_key_query_param_name: data.authChoice === 'query' && data.apiKeyQueryParamName.trim() ? data.apiKeyQueryParamName.trim() : undefined,
    api_key_header_name: data.authChoice === 'header' && data.apiKeyHeaderName.trim() ? data.apiKeyHeaderName.trim() : undefined,
  };

  const providerToRegister: RegisteredProvider = {
    provider_name: data.providerName,
    provider_id: "",
    description: data.providerDescription,
    instructions: data.instructions || "",
    registered_provider_wallet: data.registeredProviderWallet.trim(),
    price: parseFloat(data.price) || 0,
    endpoint: endpointDef,
  };

  return { RegisterProvider: providerToRegister };
}

// New function to process API registration response
export function processRegistrationResponse(response: RegisterProviderResponse): ApiResponseFeedback {
  if (response.Ok) {
    return { 
      status: 'success', 
      message: `Provider "${response.Ok.provider_name}" registered successfully!` 
    };
  } else if (response.Err) {
    return { 
      status: 'error', 
      message: `Failed to register provider: ${response.Err}` 
    };
  } else {
    return { 
      status: 'info', 
      message: `Provider registration submitted. Response structure unexpected: ${JSON.stringify(response)}` 
    };
  }
}

// Function to populate form data from an existing provider (for editing)
export function populateFormFromProvider(provider: RegisteredProvider): Partial<ProviderFormData> {
  // Convert the provider back to form data structure
  let topLevelRequestType: TopLevelRequestType = 'getWithQuery'; // default
  
  if (provider.endpoint.request_structure === RequestStructureType.GetWithPath) {
    topLevelRequestType = 'getWithPath';
  } else if (provider.endpoint.request_structure === RequestStructureType.GetWithQuery) {
    topLevelRequestType = 'getWithQuery';
  } else if (provider.endpoint.request_structure === RequestStructureType.PostWithJson) {
    topLevelRequestType = 'postWithJson';
  }

  // Determine auth choice based on which auth field is set
  let authChoice: AuthChoice = 'none';
  if (provider.endpoint.api_key_query_param_name) {
    authChoice = 'query';
  } else if (provider.endpoint.api_key_header_name) {
    authChoice = 'header';
  }

  return {
    providerName: provider.provider_name,
    providerDescription: provider.description,
    providerId: provider.provider_id,
    instructions: provider.instructions,
    registeredProviderWallet: provider.registered_provider_wallet,
    price: provider.price.toString(),
    topLevelRequestType,
    endpointBaseUrl: provider.endpoint.base_url_template,
    pathParamKeys: provider.endpoint.path_param_keys || [],
    queryParamKeys: provider.endpoint.query_param_keys || [],
    headerKeys: provider.endpoint.header_keys || [],
    bodyKeys: provider.endpoint.body_param_keys || [],
    endpointApiParamKey: provider.endpoint.api_key || '',
    authChoice,
    apiKeyQueryParamName: provider.endpoint.api_key_query_param_name || '',
    apiKeyHeaderName: provider.endpoint.api_key_header_name || '',
  };
}

// Function to build update payload (similar to register but for updates)
export function buildUpdateProviderPayload(data: ProviderFormData): RegisteredProvider {
  const finalEndpointName = data.providerName.trim();

  let derivedHttpMethod: HttpMethod;
  let requestStructure: RequestStructureType;

  switch (data.topLevelRequestType) {
    case "getWithPath":
      derivedHttpMethod = HttpMethod.GET;
      requestStructure = RequestStructureType.GetWithPath;
      break;
    case "getWithQuery":
      derivedHttpMethod = HttpMethod.GET;
      requestStructure = RequestStructureType.GetWithQuery;
      break;
    case "postWithJson":
      derivedHttpMethod = HttpMethod.POST;
      requestStructure = RequestStructureType.PostWithJson;
      break;
    default:
      console.error("Invalid topLevelRequestType in buildUpdateProviderPayload!");
      derivedHttpMethod = HttpMethod.GET; 
      requestStructure = RequestStructureType.GetWithQuery;
      break;
  }

  const pathKeys = data.pathParamKeys.filter(k => k.trim());
  const queryKeys = data.queryParamKeys.filter(k => k.trim());
  const headerKeys = data.headerKeys.filter(k => k.trim());
  const bodyKeys = data.topLevelRequestType === "postWithJson" ? data.bodyKeys.filter(k => k.trim()) : [];

  const endpointDef: EndpointDefinition = {
    name: finalEndpointName,
    method: derivedHttpMethod,
    request_structure: requestStructure,
    base_url_template: data.endpointBaseUrl,
    path_param_keys: pathKeys.length > 0 ? pathKeys : undefined,
    query_param_keys: queryKeys.length > 0 ? queryKeys : undefined,
    header_keys: headerKeys.length > 0 ? headerKeys : undefined,
    body_param_keys: bodyKeys.length > 0 ? bodyKeys : undefined,
    api_key: data.endpointApiParamKey.trim() || undefined,
    api_key_query_param_name: data.authChoice === 'query' && data.apiKeyQueryParamName.trim() ? data.apiKeyQueryParamName.trim() : undefined,
    api_key_header_name: data.authChoice === 'header' && data.apiKeyHeaderName.trim() ? data.apiKeyHeaderName.trim() : undefined,
  };

  const updatedProvider: RegisteredProvider = {
    provider_name: data.providerName,
    provider_id: data.providerId, // This will be preserved by the backend
    description: data.providerDescription,
    instructions: data.instructions || "",
    registered_provider_wallet: data.registeredProviderWallet.trim(),
    price: parseFloat(data.price) || 0,
    endpoint: endpointDef,
  };

  return updatedProvider;
}

// Function to process API update response
export function processUpdateResponse(response: UpdateProviderResponse): ApiResponseFeedback {
  if (response.Ok) {
    return { 
      status: 'success', 
      message: `Provider "${response.Ok.provider_name}" updated successfully!` 
    };
  } else if (response.Err) {
    return { 
      status: 'error', 
      message: `Failed to update provider: ${response.Err}` 
    };
  } else {
    return { 
      status: 'info', 
      message: `Provider update submitted. Response structure unexpected: ${JSON.stringify(response)}` 
    };
  }
} 
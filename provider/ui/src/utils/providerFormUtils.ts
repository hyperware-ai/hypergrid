import { HttpMethod, EndpointDefinition, RegisteredProvider, RegisterProviderResponse, RequestStructureType, UpdateProviderResponse } from '../types/hypergrid_provider';
import { TopLevelRequestType, AuthChoice } from '../types/hypergrid_provider';

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

// New types for smart update system
export interface UpdateDetectionResult {
  hasOnChainChanges: boolean;
  hasOffChainChanges: boolean;
  hasConfigChanges: boolean;
  onChainChanges: Array<{ key: string; oldValue: string; newValue: string }>;
  offChainChanges: Array<{ field: string; oldValue: any; newValue: any }>;
  configChanges: Array<{ field: string; oldValue: any; newValue: any }>;
}

export interface SmartUpdatePlan {
  needsOnChainUpdate: boolean;
  needsOffChainUpdate: boolean;
  shouldWarnAboutInstructions: boolean;
  onChainNotes: Array<{ key: string; value: string }>;
  updatedProvider: RegisteredProvider;
}

// On-chain note keys (must match the ones in hypermap.ts)
export const ON_CHAIN_NOTE_KEYS = {
  PROVIDER_ID: '~provider-id',
  WALLET: '~wallet', 
  DESCRIPTION: '~description',
  INSTRUCTIONS: '~instructions',
  PRICE: '~price',
} as const;

// Fields that affect API configuration and might require instruction updates
const CONFIG_FIELDS = [
  'topLevelRequestType',
  'endpointBaseUrl', 
  'pathParamKeys',
  'queryParamKeys',
  'headerKeys',
  'bodyKeys',
  'endpointApiParamKey',
  'authChoice',
  'apiKeyQueryParamName',
  'apiKeyHeaderName'
] as const;

/**
 * Analyzes what changed between original and updated provider data
 */
export function detectProviderChanges(
  originalProvider: RegisteredProvider,
  formData: ProviderFormData
): UpdateDetectionResult {
  const onChainChanges: Array<{ key: string; oldValue: string; newValue: string }> = [];
  const offChainChanges: Array<{ field: string; oldValue: any; newValue: any }> = [];
  const configChanges: Array<{ field: string; oldValue: any; newValue: any }> = [];

  // Check on-chain fields
  if (originalProvider.provider_id !== formData.providerId) {
    onChainChanges.push({
      key: ON_CHAIN_NOTE_KEYS.PROVIDER_ID,
      oldValue: originalProvider.provider_id,
      newValue: formData.providerId
    });
  }

  if (originalProvider.registered_provider_wallet !== formData.registeredProviderWallet.trim()) {
    onChainChanges.push({
      key: ON_CHAIN_NOTE_KEYS.WALLET,
      oldValue: originalProvider.registered_provider_wallet,
      newValue: formData.registeredProviderWallet.trim()
    });
  }

  if (originalProvider.description !== formData.providerDescription) {
    onChainChanges.push({
      key: ON_CHAIN_NOTE_KEYS.DESCRIPTION,
      oldValue: originalProvider.description,
      newValue: formData.providerDescription
    });
  }

  if (originalProvider.instructions !== formData.instructions) {
    onChainChanges.push({
      key: ON_CHAIN_NOTE_KEYS.INSTRUCTIONS,
      oldValue: originalProvider.instructions,
      newValue: formData.instructions
    });
  }

  const newPrice = parseFloat(formData.price) || 0;
  if (originalProvider.price !== newPrice) {
    onChainChanges.push({
      key: ON_CHAIN_NOTE_KEYS.PRICE,
      oldValue: originalProvider.price.toString(),
      newValue: newPrice.toString()
    });
  }

  // Check off-chain fields (provider name)
  if (originalProvider.provider_name !== formData.providerName) {
    offChainChanges.push({
      field: 'provider_name',
      oldValue: originalProvider.provider_name,
      newValue: formData.providerName
    });
  }

  // Check endpoint configuration fields
  const originalFormData = populateFormFromProvider(originalProvider);
  
  CONFIG_FIELDS.forEach(field => {
    const oldValue = originalFormData[field];
    const newValue = formData[field];
    
    // Handle array comparison
    if (Array.isArray(oldValue) && Array.isArray(newValue)) {
      if (JSON.stringify(oldValue.sort()) !== JSON.stringify(newValue.sort())) {
        configChanges.push({ field, oldValue, newValue });
      }
    } else if (oldValue !== newValue) {
      configChanges.push({ field, oldValue, newValue });
    }
  });

  return {
    hasOnChainChanges: onChainChanges.length > 0,
    hasOffChainChanges: offChainChanges.length > 0,
    hasConfigChanges: configChanges.length > 0,
    onChainChanges,
    offChainChanges,
    configChanges
  };
}

/**
 * Creates a smart update plan based on detected changes
 */
export function createSmartUpdatePlan(
  originalProvider: RegisteredProvider,
  formData: ProviderFormData
): SmartUpdatePlan {
  const changes = detectProviderChanges(originalProvider, formData);
  const updatedProvider = buildUpdateProviderPayload(formData);

  return {
    needsOnChainUpdate: changes.hasOnChainChanges,
    needsOffChainUpdate: changes.hasOffChainChanges || changes.hasConfigChanges || changes.hasOnChainChanges, // Also update backend when on-chain data changes
    shouldWarnAboutInstructions: changes.hasConfigChanges && !changes.onChainChanges.some(c => c.key === ON_CHAIN_NOTE_KEYS.INSTRUCTIONS),
    onChainNotes: changes.onChainChanges.map(change => ({
      key: change.key,
      value: change.newValue
    })),
    updatedProvider
  };
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
    provider_id: data.providerId,
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
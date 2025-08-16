import { RegisteredProvider, Variable } from '../types/hypergrid_provider';

// Simple validation for provider configuration
export function validateProviderConfig(provider: RegisteredProvider): { isValid: boolean; error?: string } {
  if (!provider.provider_name.trim() || !provider.endpoint.curl_template.trim()) {
    return { isValid: false, error: "Provider Name and Curl Template are required." };
  }
  
  if (!provider.registered_provider_wallet.trim()) {
    return { isValid: false, error: "Provider wallet address is required." };
  }
  
  return { isValid: true };
}

// Build provider payload from form data
export function buildProviderPayload(
  providerName: string,
  providerDescription: string,
  providerId: string,
  instructions: string,
  registeredProviderWallet: string,
  price: string,
  curlTemplate: string,
  variables: Variable[]
): { RegisterProvider: RegisteredProvider } {
  const provider: RegisteredProvider = {
    provider_name: providerName.trim(),
    provider_id: providerId,
    description: providerDescription,
    instructions: instructions,
    registered_provider_wallet: registeredProviderWallet.trim(),
    price: parseFloat(price) || 0,
    endpoint: {
      name: providerName.trim(),
      curl_template: curlTemplate,
      variables: variables
    }
  };

  return { RegisterProvider: provider };
}

// Build update provider payload
export function buildUpdateProviderPayload(
  providerName: string,
  providerDescription: string,
  providerId: string,
  instructions: string,
  registeredProviderWallet: string,
  price: string,
  curlTemplate: string,
  variables: Variable[]
): RegisteredProvider {
  return {
    provider_name: providerName.trim(),
    provider_id: providerId,
    description: providerDescription,
    instructions: instructions,
    registered_provider_wallet: registeredProviderWallet.trim(),
    price: parseFloat(price) || 0,
    endpoint: {
      name: providerName.trim(),
      curl_template: curlTemplate,
      variables: variables
    }
  };
}

// Populate form data from an existing provider
export function populateFormFromProvider(provider: RegisteredProvider) {
  return {
    providerName: provider.provider_name,
    providerDescription: provider.description,
    providerId: provider.provider_id,
    instructions: provider.instructions,
    registeredProviderWallet: provider.registered_provider_wallet,
    price: provider.price.toString(),
    curlTemplate: provider.endpoint.curl_template,
    variables: provider.endpoint.variables
  };
}

// Process registration response
export function processRegistrationResponse(response: any) {
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

// Process update response
export function processUpdateResponse(response: any) {
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

// Smart update detection for blockchain updates
export interface UpdateDetectionResult {
  hasOnChainChanges: boolean;
  hasOffChainChanges: boolean;
  onChainChanges: Array<{ key: string; oldValue: string; newValue: string }>;
  offChainChanges: Array<{ field: string; oldValue: any; newValue: any }>;
}

export const ON_CHAIN_NOTE_KEYS = {
  PROVIDER_ID: '~provider-id',
  WALLET: '~wallet', 
  DESCRIPTION: '~description',
  INSTRUCTIONS: '~instructions',
  PRICE: '~price',
} as const;

export function detectProviderChanges(
  originalProvider: RegisteredProvider,
  updatedProvider: RegisteredProvider
): UpdateDetectionResult {
  const onChainChanges: Array<{ key: string; oldValue: string; newValue: string }> = [];
  const offChainChanges: Array<{ field: string; oldValue: any; newValue: any }> = [];

  // Check on-chain fields
  if (originalProvider.provider_id !== updatedProvider.provider_id) {
    onChainChanges.push({
      key: ON_CHAIN_NOTE_KEYS.PROVIDER_ID,
      oldValue: originalProvider.provider_id,
      newValue: updatedProvider.provider_id
    });
  }

  if (originalProvider.registered_provider_wallet !== updatedProvider.registered_provider_wallet) {
    onChainChanges.push({
      key: ON_CHAIN_NOTE_KEYS.WALLET,
      oldValue: originalProvider.registered_provider_wallet,
      newValue: updatedProvider.registered_provider_wallet
    });
  }

  if (originalProvider.description !== updatedProvider.description) {
    onChainChanges.push({
      key: ON_CHAIN_NOTE_KEYS.DESCRIPTION,
      oldValue: originalProvider.description,
      newValue: updatedProvider.description
    });
  }

  if (originalProvider.instructions !== updatedProvider.instructions) {
    onChainChanges.push({
      key: ON_CHAIN_NOTE_KEYS.INSTRUCTIONS,
      oldValue: originalProvider.instructions,
      newValue: updatedProvider.instructions
    });
  }

  if (originalProvider.price !== updatedProvider.price) {
    onChainChanges.push({
      key: ON_CHAIN_NOTE_KEYS.PRICE,
      oldValue: originalProvider.price.toString(),
      newValue: updatedProvider.price.toString()
    });
  }

  // Check off-chain fields
  if (originalProvider.provider_name !== updatedProvider.provider_name) {
    offChainChanges.push({
      field: 'provider_name',
      oldValue: originalProvider.provider_name,
      newValue: updatedProvider.provider_name
    });
  }

  if (originalProvider.endpoint.curl_template !== updatedProvider.endpoint.curl_template) {
    offChainChanges.push({
      field: 'curl_template',
      oldValue: originalProvider.endpoint.curl_template,
      newValue: updatedProvider.endpoint.curl_template
    });
  }

  if (JSON.stringify(originalProvider.endpoint.variables) !== JSON.stringify(updatedProvider.endpoint.variables)) {
    offChainChanges.push({
      field: 'variables',
      oldValue: originalProvider.endpoint.variables,
      newValue: updatedProvider.endpoint.variables
    });
  }

  return {
    hasOnChainChanges: onChainChanges.length > 0,
    hasOffChainChanges: offChainChanges.length > 0,
    onChainChanges,
    offChainChanges
  };
}

export function createSmartUpdatePlan(
  originalProvider: RegisteredProvider,
  updatedProvider: RegisteredProvider
) {
  const changes = detectProviderChanges(originalProvider, updatedProvider);

  return {
    needsOnChainUpdate: changes.hasOnChainChanges,
    needsOffChainUpdate: changes.hasOffChainChanges || changes.hasOnChainChanges,
    onChainNotes: changes.onChainChanges.map(change => ({
      key: change.key,
      value: change.newValue
    })),
    updatedProvider
  };
}
import { RegisteredProvider} from '../types/hypergrid_provider';


export interface SmartUpdatePlan {
  needsOnChainUpdate: boolean;
  needsOffChainUpdate: boolean;
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
  IS_LIVE: '~is-live',
} as const;

/**
 * Creates a smart update plan that determines what needs onchain vs offchain updates
 * Onchain updates: provider_id, wallet, description, instructions, price (the hypergrid entry form fields)
 * Offchain updates: endpoint configuration (cURL template and related data)
 */
export function createSmartUpdatePlan(
  originalProvider: RegisteredProvider,
  updatedProvider: RegisteredProvider
): SmartUpdatePlan {
  const onChainNotes: Array<{ key: string; value: string }> = [];
  let needsOnChainUpdate = false;
  let needsOffChainUpdate = false;

  // Check onchain fields that can be updated
  const onChainFields = [
    {
      key: ON_CHAIN_NOTE_KEYS.WALLET,
      originalValue: originalProvider.registered_provider_wallet,
      updatedValue: updatedProvider.registered_provider_wallet,
    },
    {
      key: ON_CHAIN_NOTE_KEYS.DESCRIPTION,
      originalValue: originalProvider.description,
      updatedValue: updatedProvider.description,
    },
    {
      key: ON_CHAIN_NOTE_KEYS.INSTRUCTIONS,
      originalValue: originalProvider.instructions,
      updatedValue: updatedProvider.instructions,
    },
    {
      key: ON_CHAIN_NOTE_KEYS.PRICE,
      originalValue: originalProvider.price?.toString(),
      updatedValue: updatedProvider.price?.toString(),
    },
    {
      key: ON_CHAIN_NOTE_KEYS.IS_LIVE,
      originalValue: originalProvider.is_live?.toString(),
      updatedValue: updatedProvider.is_live?.toString(),
    },
  ];

  // Check each onchain field for changes
  for (const field of onChainFields) {
    if (field.originalValue !== field.updatedValue) {
      needsOnChainUpdate = true;
      onChainNotes.push({
        key: field.key,
        value: field.updatedValue || '',
      });
    }
  }

  // Check offchain fields (endpoint configuration)
  const offChainFields = [
    'endpoint', // cURL template configuration
    'provider_name', // name changes require both onchain and offchain updates
  ];

  for (const field of offChainFields) {
    const originalValue = (originalProvider as any)[field];
    const updatedValue = (updatedProvider as any)[field];
    
    if (JSON.stringify(originalValue) !== JSON.stringify(updatedValue)) {
      needsOffChainUpdate = true;

      // Provider name changes also require onchain updates
      if (field === 'provider_name') {
        needsOnChainUpdate = true;
        // Note: Provider name changes are handled separately as they require re-minting
      }
    }
  }

  return {
    needsOnChainUpdate,
    needsOffChainUpdate,
    onChainNotes,
    updatedProvider,
  };
}

/**
 * Prepares a provider object for seamless updating by loading original cURL + metadata
 * This creates a new provider object that can be used for registration-like flow
 */
export function prepareProviderForSeamlessUpdate(
  originalProvider: RegisteredProvider,
  updatedMetadata: Partial<RegisteredProvider>
): RegisteredProvider {
  // Create new provider object with updated metadata but preserving structure
  const updatedProvider: RegisteredProvider = {
    ...originalProvider,
    ...updatedMetadata,
    // Always preserve the original provider_id (node identity)
    provider_id: originalProvider.provider_id,
  };

  return updatedProvider;
}

/**
 * Determines if an update should use the fast path (backend only) or full path (onchain + backend)
 */
export function shouldUseFastUpdatePath(updatePlan: SmartUpdatePlan): boolean {
  // Use fast path if only offchain updates are needed
  return !updatePlan.needsOnChainUpdate && updatePlan.needsOffChainUpdate;
}




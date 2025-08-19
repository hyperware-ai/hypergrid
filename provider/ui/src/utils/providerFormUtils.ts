import { RegisteredProvider} from '../types/hypergrid_provider';


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




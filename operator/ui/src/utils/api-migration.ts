// API Migration Adapter Layer
// This module helps transition from the old REST API patterns to the new hyperapp RPC pattern

// Re-export all caller-utils functions and types
export * from '../../../target/ui/caller-utils';

// Import specific items we need for migration helpers
import { 
  search_providers_public,
  type ProviderInfo,
  ApiError
} from '../../../target/ui/caller-utils';

// Import Result type from the main types file
import type { Result } from '../logic/types';

export interface ProcessState {
  // This is a simplified version - add fields as needed
  configured: boolean;
  // Add other state fields from the old API as needed
}

export interface ProviderJson {
  id: string;
  name: string;
  description: string;
  site?: string;
  wallet?: string;
  price?: string;
  hash: string;
}

// Migration helper functions that maintain the old API patterns
// while using the new caller-utils underneath

/**
 * Migrate from fetchState() to new status endpoints
 */
export async function fetchStateMigrated(): Promise<Result<ProcessState>> {
  try {
    // Convert SetupStatus to ProcessState format
    const state: ProcessState = {
      configured: true,
      // Add other mappings as needed
    };
    return { ok: state };
  } catch (error) {
    return { error: handleError(error) };
  }
}

///**
// * Migrate from fetchAll() to get_all_providers()
// */
//export async function fetchAllMigrated(): Promise<Result<ProviderJson[]>> {
//  try {
//    const providers = await get_all_providers();
//    // Convert ProviderInfo[] to ProviderJson[]
//    const providerJsons: ProviderJson[] = providers.map((p: ProviderInfo) => ({
//      id: p.provider_id || p.id?.toString() || '',
//      name: p.name,
//      description: p.description || '',
//      site: p.site || undefined,
//      wallet: p.wallet || undefined,
//      price: p.price || undefined,
//      hash: p.hash,
//    }));
//    return { ok: providerJsons };
//  } catch (error) {
//    return { error: handleError(error) };
//  }
//}

/**
 * Migrate from searchDB() to search_providers_public()
 */
export async function searchDBMigrated(query: string): Promise<Result<ProviderJson[]>> {
  try {
    const providers = await search_providers_public(query);
    console.log('providers', providers);
    // Convert ProviderInfo[] to ProviderJson[]
    const providerJsons: ProviderJson[] = providers.map((p: ProviderInfo) => ({
      id: p.provider_id || p.id?.toString() || '',
      name: p.name,
      description: p.description || '',
      site: p.site || undefined,
      wallet: p.wallet || undefined,
      price: p.price || undefined,
      hash: p.hash,
    }));
    return { ok: providerJsons };
  } catch (error) {
    return { error: handleError(error) };
  }
}

// Error handling helper
function handleError(error: unknown): string {
  if (error instanceof ApiError) {
    // Handle structured API errors
    const details = error.details as any;
    return details?.toString() || error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'An unknown error occurred';
}

// Auth context placeholder
// TODO: Implement proper auth context for endpoints that require authentication
export interface AuthCredentials {
  clientId: string;
  token: string;
}

let authCredentials: AuthCredentials | null = null;

export function setAuthCredentials(creds: AuthCredentials) {
  authCredentials = creds;
}

export function getAuthCredentials(): AuthCredentials | null {
  return authCredentials;
}

// Feature flag for gradual migration
export const USE_NEW_API = import.meta.env.VITE_USE_NEW_API === 'true' || true; // Default to true

// Helper to log migration progress
export function logMigration(oldEndpoint: string, newFunction?: any) {
  if (import.meta.env.DEV) {
    console.log(`[API Migration] ${oldEndpoint}`, newFunction || '');
  }
}

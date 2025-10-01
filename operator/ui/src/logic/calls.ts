import type {
  AllProviders,
  AsyncRes,
  ProcessState,
  Provider,
  ProviderJson,
  Result,
} from "./types";
import { PUBLISHER } from "../constants";
import {
  fetchStateMigrated,
  //fetchAllMigrated,
  searchDBMigrated,
  USE_NEW_API,
  logMigration,
  call_provider,
  getAuthCredentials,
  type KeyValue,
} from "../utils/api-migration";

export const API_PATH = `/operator:hypergrid:${PUBLISHER}/api`;

export async function fetchState(): AsyncRes<ProcessState> {
  if (USE_NEW_API) {
    logMigration('/state', 'get_setup_status');
    // fetchStateMigrated already returns Promise<AsyncRes<ProcessState>>
    // but this function signature expects AsyncRes<ProcessState> (which is Promise<Result<ProcessState>>)
    // so we just return the promise directly
    return fetchStateMigrated();
  }
  
  try {
    const response = await fetch(API_PATH + "/state");
    const j = await response.json();
    return { ok: j };
  } catch (e) {
    return { error: `${e}` };
  }
}

export async function fetchAll(): AsyncRes<Provider[]> {
  if (USE_NEW_API) {
    logMigration('/all', 'get_all_providers');
    // fetchAllMigrated returns ProviderJson[], we need Provider[]
    // For now, cast it - ideally update the types to match
    //return fetchAllMigrated() as AsyncRes<Provider[]>;
    return { error: 'Not implemented' };
  }
  
  try {
    const response = await fetch(API_PATH + "/all");
    const j = await response.json();
    return { ok: j };
  } catch (e) {
    return { error: `${e}` };
  }
}

export async function fetchCategory(cat: string): AsyncRes<Provider[]> {
  if (USE_NEW_API) {
    logMigration('/cat', 'client-side filtering from get_all_providers');
    // For now, fetch all and filter client-side
    // TODO: Add get_providers_by_category endpoint to operator
    //const allResult = await fetchAllMigrated();
    const allResult = { error: 'Not implemented' };
    if ('error' in allResult) {
      return allResult;
    }
    // Filter by category client-side
    //const filtered = allResult.ok?.filter((p: any) => 
    //  p.category === cat || (p.facts && p.facts.category && p.facts.category.includes(cat))
    //);
    //return { ok: filtered as unknown as Provider[] };
    return { ok: [] };
  }
  
  try {
    const response = await fetch(API_PATH + "/cat?cat=" + cat);
    const j = await response.json();
    return { ok: j };
  } catch (e) {
    return { error: `${e}` };
  }
}
export async function searchDB(query: string): AsyncRes<ProviderJson[]> {
  if (USE_NEW_API) {
    logMigration('/search', 'search_providers_public');
    return searchDBMigrated(query);
  }
  
  try {
    const response = await fetch(API_PATH + "/search?q=" + query);
    const j = await response.json();
    return { ok: j };
  } catch (e) {
    return { error: `${e}` };
  }
}

export async function callProvider(provider: ProviderJson, args: any) {
  if (USE_NEW_API) {
    logMigration('/call', 'call_provider');
    
    // Check if we have auth credentials
    const auth = getAuthCredentials();
    if (!auth) {
      return { error: 'Authentication required. Please authorize first.' };
    }
    
    try {
      // Convert args object to KeyValue array
      const keyValueArgs: KeyValue[] = Object.entries(args).map(([key, value]) => ({
        key,
        value: String(value)
      }));
      
      const result = await call_provider(
        provider.id,
        provider.name,
        keyValueArgs,
        auth.clientId,
        auth.token
      );
      
      return { ok: result };
    } catch (error: any) {
      return { error: error.message || 'Provider call failed' };
    }
  }
  
  try {
    const body = {
      CallProvider: {
        providerId: provider.id,
        providerName: provider.name,
        arguments: args,
      },
    };
    const response = await fetch(API_PATH + "/call", {
      method: "POST",
      headers: {
        "Content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const j = await response.json();
    return { ok: j };
  } catch (e) {
    return { error: `${e}` };
  }
}

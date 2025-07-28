import type {
  AllProviders,
  AsyncRes,
  ProcessState,
  Provider,
  ProviderJson,
  Result,
} from "./types";

export const API_PATH = "/operator:hypergrid:grid.hypr/api";

export async function fetchState(): AsyncRes<ProcessState> {
  try {
    const response = await fetch(API_PATH + "/state");
    const j = await response.json();
    return { ok: j };
  } catch (e) {
    return { error: `${e}` };
  }
}

export async function fetchAll(): AsyncRes<Provider[]> {
  try {
    const response = await fetch(API_PATH + "/all");
    const j = await response.json();
    return { ok: j };
  } catch (e) {
    return { error: `${e}` };
  }
}

export async function fetchCategory(cat: string): AsyncRes<Provider[]> {
  try {
    const response = await fetch(API_PATH + "/cat?cat=" + cat);
    const j = await response.json();
    return { ok: j };
  } catch (e) {
    return { error: `${e}` };
  }
}
export async function searchDB(query: string): AsyncRes<ProviderJson[]> {
  try {
    const response = await fetch(API_PATH + "/search?q=" + query);
    const j = await response.json();
    return { ok: j };
  } catch (e) {
    return { error: `${e}` };
  }
}

export async function callProvider(provider: ProviderJson, args: any) {
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

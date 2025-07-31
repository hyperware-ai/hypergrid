// --- Response Types ---
// Generic response wrapper for Rust Result<T, E> where E is String
interface RustResponse<T> {
  Ok?: T;
  Err?: string;
}

// Enum for HTTP methods, matching Rust's HttpMethod
export enum HttpMethod {
  GET = "GET",
  POST = "POST",
}

// --- Added Enum for Request Structure (Matches Rust) ---
export enum RequestStructureType {
  GetWithPath = "GetWithPath",
  GetWithQuery = "GetWithQuery",
  PostWithJson = "PostWithJson",
}

// Interface for EndpointDefinition, matching Rust's struct
export interface EndpointDefinition {
  name: string;
  method: HttpMethod;
  request_structure: RequestStructureType; // Added field
  base_url_template: string;
  path_param_keys?: string[]; // Changed to optional
  query_param_keys?: string[]; // Changed to optional
  header_keys?: string[];      // Changed to optional
  body_param_keys?: string[];

  api_key?: string;

  // API Key Authentication
  api_key_query_param_name?: string;
  api_key_header_name?: string;
}

// Interface for RegisteredProvider, matching Rust's struct
export interface RegisteredProvider {
  provider_name: string; // Unique name for this provider configuration
  provider_id: string; // Will be an Address on Rust side, initially empty string from UI
  description: string;
  instructions: string;
  registered_provider_wallet: string; // Eth address as string
  price: number; // Price per call
  endpoint: EndpointDefinition;
}

// Request body for the register_provider endpoint
export interface RegisterProviderRequest {
  RegisterProvider: RegisteredProvider; // Just the provider, no validation arguments
}



// Response type for the register_provider endpoint
export type RegisterProviderResponse = RustResponse<RegisteredProvider>;

// Request body for the get_registered_providers endpoint
export interface GetRegisteredProvidersRequest {
  GetRegisteredProviders: null; // Key matches the Rust function name, value is null since no parameters needed
}

// Response type for the get_registered_providers endpoint
export type GetRegisteredProvidersResponse = RustResponse<RegisteredProvider[]>;

// Request body for the update_provider endpoint
export interface UpdateProvider {
  provider_name: string;
  updated_provider: RegisteredProvider;
}

// Response type for the update_provider endpoint
export type UpdateProviderResponse = RustResponse<RegisteredProvider>;

// --- HypergridProviderState (matches Rust struct, using JS naming convention for store) ---
export interface HypergridProviderState {
  registeredProviders: RegisteredProvider[];
}

// New API type for namehash lookup
export interface GetProviderNamehashResponse {
  Ok?: string;
  Err?: string;
}

// --- Indexed Provider Types ---
// Interface for indexed providers from the operator's database
// Note: These are generic JSON objects from the database, might have different structure than RegisteredProvider
export interface IndexedProvider {
  provider_id: string;
  name: string;
  description?: string;
  price?: number | string; // Can be string from database or number
  [key: string]: any; // Allow additional dynamic fields from the database
}

// Response types for indexed provider endpoints
// Note: Backend now returns JSON as strings, so we get string responses that need to be parsed
export type GetIndexedProvidersResponse = RustResponse<string>; // Backend returns JSON string
export type SearchIndexedProvidersResponse = RustResponse<string>; // Backend returns JSON string
export type GetIndexedProviderDetailsResponse = RustResponse<string>; // Backend returns JSON string

// Provider sync status types
export interface ProviderSyncStatus {
  is_synchronized: boolean;
  summary: string;
  total_local: number;
  missing_from_index: string[];
  mismatched: string[];
  has_issues: boolean;
}

export type GetProviderSyncStatusResponse = RustResponse<string>; // Backend returns JSON string




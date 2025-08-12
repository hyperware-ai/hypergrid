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

// Define top-level request types for forms
export type TopLevelRequestType = "getWithPath" | "getWithQuery" | "postWithJson";
export type AuthChoice = "none" | "query" | "header";




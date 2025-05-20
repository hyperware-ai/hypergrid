import { 
  RegisteredProvider,
  GetRegisteredProvidersRequest,
  GetRegisteredProvidersResponse,
  RegisterProviderRequest,
  RegisterProviderResponse,
} from '../types/hpn_provider';

const BASE_URL = import.meta.env.BASE_URL; // Assuming BASE_URL is accessible here or passed in

export const fetchRegisteredProvidersApi = async (): Promise<RegisteredProvider[]> => {
  const requestData = { GetRegisteredProviders: {} } as any;
  try {
    const result = await fetch(`${BASE_URL}/api`, {
      method: "POST",
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestData),
    });
    if (!result.ok) {
      const errorText = await result.text();
      console.error(`HTTP request failed: ${result.status} ${result.statusText}. Response:`, errorText);
      throw new Error(`Failed to fetch providers: ${result.statusText} - ${errorText}`);
    }
    const responseData = await result.json() as GetRegisteredProvidersResponse;
    if (responseData.Ok) {
      return responseData.Ok;
    } else {
      throw new Error(responseData.Err || "Unknown error fetching providers");
    }
  } catch (error) {
    console.error("Failed to fetch registered providers:", error);
    throw error; // Re-throw to be caught by the caller
  }
};

export const registerProviderApi = async (payload: RegisterProviderRequest): Promise<RegisterProviderResponse> => {
  try {
    const result = await fetch(`${BASE_URL}/api`, {
      method: "POST",
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!result.ok) {
      const errorText = await result.text();
      console.error(`HTTP request failed: ${result.status} ${result.statusText}. Response:`, errorText);
      throw new Error(`Failed to register provider: ${result.statusText} - ${errorText}`);
    }

    const responseData = await result.json() as RegisterProviderResponse;

    return responseData;
  } catch (error) {
    console.error("Failed to register provider:", error);
    if (error instanceof Error) {
        throw error;
    }
    throw new Error("Unknown error during provider registration.");
  }
}; 
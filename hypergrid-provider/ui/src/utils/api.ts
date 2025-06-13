import { 
  RegisteredProvider,
  GetRegisteredProvidersResponse,
  RegisterProviderRequest,
  RegisterProviderResponse,
  UpdateProvider,
  UpdateProviderResponse,
  ValidateAndRegisterRequest,
} from '../types/hypergrid_provider';

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

export const validateAndRegisterProviderApi = async (payload: ValidateAndRegisterRequest): Promise<RegisterProviderResponse> => {
  try {
    const result = await fetch(`${BASE_URL}/api`, {
      method: "POST",
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!result.ok) {
      const errorText = await result.text();
      console.error(`HTTP request failed: ${result.status} ${result.statusText}. Response:`, errorText);
      throw new Error(`Failed to validate and register provider: ${result.statusText} - ${errorText}`);
    }

    const responseData = await result.json() as RegisterProviderResponse;

    return responseData;
  } catch (error) {
    console.error("Failed to validate and register provider:", error);
    if (error instanceof Error) {
        throw error;
    }
    throw new Error("Unknown error during provider validation and registration.");
  }
};

export const updateProviderApi = async (providerName: string, updatedProvider: RegisteredProvider): Promise<UpdateProviderResponse> => {
  console.log("Updating provider:", providerName, updatedProvider);
  
  try {
    const requestData = { UpdateProvider: [ providerName, updatedProvider ] } as any;

    const result = await fetch(`${BASE_URL}/api`, {
      method: "POST",
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestData),
    });

    if (!result.ok) {
      const errorText = await result.text();
      console.error(`HTTP request failed: ${result.status} ${result.statusText}. Response:`, errorText);
      throw new Error(`Failed to update provider: ${result.statusText} - ${errorText}`);
    }

    const responseData = await result.json() as UpdateProviderResponse;

    return responseData;
  } catch (error) {
    console.error("Failed to update provider:", error);
    if (error instanceof Error) {
        throw error;
    }
    throw new Error("Unknown error during provider update.");
  }
}; 
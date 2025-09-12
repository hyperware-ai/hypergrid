import { 
  RegisteredProvider,
  GetRegisteredProvidersResponse,
  RegisterProviderRequest,
  RegisterProviderResponse,
  UpdateProviderResponse,
  IndexedProvider,
  SearchIndexedProvidersResponse,
  ProviderSyncStatus,
  GetProviderSyncStatusResponse,

} from '../types/hypergrid_provider';

const BASE_URL = import.meta.env.BASE_URL; 

export const fetchRegisteredProvidersApi = async (): Promise<RegisteredProvider[]> => {
  const requestData = { GetRegisteredProviders: null };
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

export const fetchProvidersNeedingConfigurationApi = async (): Promise<RegisteredProvider[]> => {
  const requestData = { GetProvidersNeedingConfiguration: null };
  try {
    const result = await fetch(`${BASE_URL}/api`, {
      method: "POST",
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestData),
    });
    if (!result.ok) {
      const errorText = await result.text();
      console.error(`HTTP request failed: ${result.status} ${result.statusText}. Response:`, errorText);
      throw new Error(`Failed to fetch providers needing configuration: ${result.statusText} - ${errorText}`);
    }
    const responseData = await result.json() as GetRegisteredProvidersResponse;
    if (responseData.Ok) {
      return responseData.Ok;
    } else {
      throw new Error(responseData.Err || "Unknown error fetching providers needing configuration");
    }
  } catch (error) {
    console.error("Failed to fetch providers needing configuration:", error);
    throw error; // Re-throw to be caught by the caller
  }
};

export const getProviderNamehashApi = async (providerName: string): Promise<string> => {
  const requestData = { GetProviderNamehash: providerName } as any;
  try {
    const result = await fetch(`${BASE_URL}/api`, {
      method: "POST",
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestData),
    });
    if (!result.ok) {
      const errorText = await result.text();
      console.error(`HTTP request failed: ${result.status} ${result.statusText}. Response:`, errorText);
      throw new Error(`Failed to get provider namehash: ${result.statusText} - ${errorText}`);
    }
    const responseData = await result.json();
    if (responseData.Ok) {
      return responseData.Ok;
    } else {
      throw new Error(responseData.Err || "Unknown error getting provider namehash");
    }
  } catch (error) {
    console.error("Failed to get provider namehash:", error);
    throw error;
  }
};

export const registerProviderApi = async (
  provider: RegisteredProvider
): Promise<RegisterProviderResponse> => {
  try {
    const payload: RegisterProviderRequest = {
      RegisterProvider: provider,
    };

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

// Validate provider endpoint and cache for later registration
export const validateProviderApi = async (
  provider: RegisteredProvider, 
  validationArguments: [string, string][] = []
): Promise<{ success: boolean; error?: string; validatedProvider?: RegisteredProvider; validationResult?: string }> => {
  try {
    const payload = {
      ValidateProvider: [provider, validationArguments],
    };

    const result = await fetch(`${BASE_URL}/api`, {
      method: "POST",
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!result.ok) {
      const errorText = await result.text();
      console.error(`Validation request failed: ${result.status} ${result.statusText}. Response:`, errorText);
      return { 
        success: false, 
        error: `Validation failed: ${result.statusText} - ${errorText}` 
      };
    }

    const responseText = await result.text();
    console.log('Validation response text:', responseText);
    
    try {
      // First parse the Rust Result format
      const rustResult = JSON.parse(responseText);
      
      if (rustResult.Ok) {
        // Parse the inner JSON from the Ok field
        const responseData = JSON.parse(rustResult.Ok);
        return { 
          success: true, 
          validatedProvider: responseData.provider,
          validationResult: responseData.validation_result 
        };
      } else if (rustResult.Err) {
        return {
          success: false,
          error: rustResult.Err
        };
      } else {
        return {
          success: false,
          error: 'Unknown response format'
        };
      }
    } catch (parseError) {
      // Fallback for backward compatibility
      console.warn('Failed to parse validation response as JSON, treating as plain text:', parseError);
      return { success: false, error: 'Failed to parse response' };
    }
  } catch (error) {
    console.error("Failed to validate provider:", error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown validation error' 
    };
  }
};




// Validate provider endpoint for updates (skips "already registered" check)
export const validateProviderUpdateApi = async (
  providerName: string,
  updatedProvider: RegisteredProvider, 
  validationArguments: [string, string][] = []
): Promise<{ success: boolean; error?: string; validatedProvider?: RegisteredProvider; validationResult?: string }> => {
  try {
    const payload = {
      ValidateProviderUpdate: [providerName, updatedProvider, validationArguments],
    };

    const result = await fetch(`${BASE_URL}/api`, {
      method: "POST",
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!result.ok) {
      const errorText = await result.text();
      console.error(`Update validation request failed: ${result.status} ${result.statusText}. Response:`, errorText);
      return { 
        success: false, 
        error: `Update validation failed: ${result.statusText} - ${errorText}` 
      };
    }

    const responseText = await result.text();
    console.log('Update validation response text:', responseText);
    
    try {
      // First parse the Rust Result format
      const rustResult = JSON.parse(responseText);
      
      if (rustResult.Ok) {
        // Parse the inner JSON from the Ok field
        const responseData = JSON.parse(rustResult.Ok);
        return { 
          success: true, 
          validatedProvider: responseData.provider,
          validationResult: responseData.validation_result 
        };
      } else if (rustResult.Err) {
        return {
          success: false,
          error: rustResult.Err
        };
      } else {
        return {
          success: false,
          error: 'Unknown response format'
        };
      }
    } catch (parseError) {
      // Fallback for backward compatibility
      console.warn('Failed to parse update validation response as JSON, treating as plain text:', parseError);
      return { success: false, error: 'Failed to parse response' };
    }
  } catch (error) {
    console.error("Failed to validate provider update:", error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
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



export const searchIndexedProvidersApi = async (query: string): Promise<IndexedProvider[]> => {
  const requestData = { SearchIndexedProviders: query };
  try {
    const result = await fetch(`${BASE_URL}/api`, {
      method: "POST",
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestData),
    });
    if (!result.ok) {
      const errorText = await result.text();
      console.error(`HTTP request failed: ${result.status} ${result.statusText}. Response:`, errorText);
      throw new Error(`Failed to search indexed providers: ${result.statusText} - ${errorText}`);
    }
    const responseData = await result.json() as SearchIndexedProvidersResponse;
    if (responseData.Ok) {
      // Parse the JSON string response
      return JSON.parse(responseData.Ok) as IndexedProvider[];
    } else {
      throw new Error(responseData.Err || "Unknown error searching indexed providers");
    }
  } catch (error) {
    console.error("Failed to search indexed providers:", error);
    throw error;
  }
};

export const getProviderSyncStatusApi = async (): Promise<ProviderSyncStatus> => {
  const requestData = { GetProviderSyncStatus: null };
  try {
    const result = await fetch(`${BASE_URL}/api`, {
      method: "POST",
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestData),
    });
    if (!result.ok) {
      const errorText = await result.text();
      console.error(`HTTP request failed: ${result.status} ${result.statusText}. Response:`, errorText);
      throw new Error(`Failed to get provider sync status: ${result.statusText} - ${errorText}`);
    }
    const responseData = await result.json() as GetProviderSyncStatusResponse;
    if (responseData.Ok) {
      // Parse the JSON string response
      return JSON.parse(responseData.Ok) as ProviderSyncStatus;
    } else {
      throw new Error(responseData.Err || "Unknown error getting provider sync status");
    }
  } catch (error) {
    console.error("Failed to get provider sync status:", error);
    throw error;
  }
}; 
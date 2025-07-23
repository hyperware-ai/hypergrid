import { create } from 'zustand'
import { HypergridProviderState, RegisteredProvider } from '../types/hypergrid_provider' // HypergridProviderState is now defined
import { persist, createJSONStorage } from 'zustand/middleware'

export interface HypergridProviderStore extends HypergridProviderState { // HypergridProviderState provides registeredProviders
  // registeredProviders: RegisteredProvider[]; // This is now inherited from HypergridProviderState
  setRegisteredProviders: (providers: RegisteredProvider[]) => void; // Action to set registered providers
  get: () => HypergridProviderStore;
  set: (partial: HypergridProviderStore | Partial<HypergridProviderStore>) => void;
}

// Kept store hook name the same for simplicity, but could be renamed e.g. useTodoStore
const useHypergridProviderStore = create<HypergridProviderStore>()( 
  persist(
    (set, get) => ({
      registeredProviders: [], // Initialize registeredProviders, fulfilling HypergridProviderState
      setRegisteredProviders: (newProviders: RegisteredProvider[]) => {
        set({ registeredProviders: newProviders });
      },
      get,
      set,
    }),
    {
      name: 'hypergrid-provider-store', // Changed persistence key for clarity
      storage: createJSONStorage(() => sessionStorage), 
    }
  )
)

export default useHypergridProviderStore;
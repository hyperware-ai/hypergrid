import { create } from 'zustand'
import { HpnProviderState, RegisteredProvider } from '../types/hpn_provider' // HpnProviderState is now defined
import { persist, createJSONStorage } from 'zustand/middleware'

export interface HpnProviderStore extends HpnProviderState { // HpnProviderState provides registeredProviders
  // registeredProviders: RegisteredProvider[]; // This is now inherited from HpnProviderState
  setRegisteredProviders: (providers: RegisteredProvider[]) => void; // Action to set registered providers
  get: () => HpnProviderStore;
  set: (partial: HpnProviderStore | Partial<HpnProviderStore>) => void;
}

// Kept store hook name the same for simplicity, but could be renamed e.g. useTodoStore
const useHpnProviderStore = create<HpnProviderStore>()( 
  persist(
    (set, get) => ({
      registeredProviders: [], // Initialize registeredProviders, fulfilling HpnProviderState
      setRegisteredProviders: (newProviders: RegisteredProvider[]) => {
        set({ registeredProviders: newProviders });
      },
      get,
      set,
    }),
    {
      name: 'hpn-provider-store', // Changed persistence key for clarity
      storage: createJSONStorage(() => sessionStorage), 
    }
  )
)

export default useHpnProviderStore; 
import { parseAbi, Address, encodeFunctionData, stringToHex, encodePacked, Hex } from 'viem';
import { HYPERMAP_ADDRESS, HYPERGRID_ADDRESS, HYPERGRID_NAMESPACE_MINTER_ADDRESS } from '../constants';

// Re-export from constants for backwards compatibility
export { HYPERMAP_ADDRESS, HYPERGRID_ADDRESS, HYPERGRID_NAMESPACE_MINTER_ADDRESS };
export const MULTICALL_ADDRESS: Address = '0xcA11bde05977b3631167028862bE2a173976CA11';

// Note keys for provider metadata
export const PROVIDER_NOTE_KEYS = {
    PROVIDER_ID: '~provider-id',
    WALLET: '~wallet',
    DESCRIPTION: '~description',
    INSTRUCTIONS: '~instructions',
    PRICE: '~price',
} as const;

// Default parent namehash - can be overridden when calling functions
export const DEFAULT_PARENT_NAMEHASH = (import.meta.env.VITE_PARENT_NAMEHASH || '0x0000000000000000000000000000000000000000000000000000000000000000') as `0x${string}`; // Replace with your actual parent namehash

// ABIs - Using the same pattern as operator code
export const hypermapAbi = parseAbi([
    'function mint(address owner, bytes calldata node, bytes calldata data, address implementation) external returns (address tba)',
    'function note(bytes calldata noteKey, bytes calldata noteValue) external returns (bytes32 labelhash)',
    'function tbaOf(bytes32 entry) external view returns (address)',
    'function leaf(bytes32 parenthash, bytes calldata label) external pure returns (bytes32 namehash, bytes32 labelhash)',
]);

export const hyperGridNamespaceMinterAbi = parseAbi([
    'function mint(address owner, bytes calldata label) external returns (address)',
    'function getChildImplementation() external view returns (address)',
    // Common events that might be emitted during minting
    'event AccountCreated(address indexed account, address indexed implementation, uint256 chainId, address indexed tokenContract, uint256 tokenId)',
    'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
]);

export const multicallAbi = parseAbi([
    'function aggregate(Call[] calls) external payable returns (uint256 blockNumber, bytes[] returnData)',
    'struct Call { address target; bytes callData; }',
]);

// TBA (Token Bound Account) ABI for execute function - matching the working mechAbi exactly
export const tbaExecuteAbi = parseAbi([
    'function execute(address to, uint256 value, bytes calldata data, uint8 operation) returns (bytes memory returnData)',
]);


/**
 * Simplified TBA lookup that gets namehash from backend:
 * This ensures consistency and enforces that provider exists in both systems
 */
export async function lookupProviderTbaAddressFromBackend(
  providerName: string,
  publicClient: any // viem PublicClient
): Promise<Address | null> {
  try {
    // Step 1: Get namehash from backend (this also validates provider exists)
    const { getProviderNamehashApi } = await import('../utils/api');
    const namehash = await getProviderNamehashApi(providerName);
    
    console.log('Got namehash from backend for provider:', {
      providerName,
      namehash
    });
    
    // Step 2: Query the Hypermap contract for the TBA address
    const tbaAddress = await publicClient.readContract({
      address: HYPERMAP_ADDRESS,
      abi: hypermapAbi,
      functionName: 'tbaOf',
      args: [namehash],
    }) as Address;
    
    // Step 3: Check if TBA exists (non-zero address)
    if (tbaAddress === '0x0000000000000000000000000000000000000000') {
      console.log('No TBA found for provider:', providerName);
      return null;
    }
    
    console.log('Found TBA address:', tbaAddress, 'for provider:', providerName);
    return tbaAddress;
  } catch (error) {
    console.error('Error looking up TBA address from backend:', error);
    return null;
  }
}

/**
 * Generates the calldata for setting a note on a provider entry
 */
export function generateNoteCall({
    noteKey,
    noteValue,
}: {
    noteKey: string;
    noteValue: string;
}): Hex {
    return encodeFunctionData({
        abi: hypermapAbi,
        functionName: 'note',
        args: [
            encodePacked(["bytes"], [stringToHex(noteKey)]),
            encodePacked(["bytes"], [stringToHex(noteValue)]),
        ]
    });
}

/**
 * Generates TBA execute arguments for setting provider notes via multicall
 * Uses DELEGATECALL pattern from the example code
 */
export function generateProviderNotesCallsArray({
    tbaAddress,
    providerId,
    wallet,
    description,
    instructions,
    price,
}: {
    tbaAddress: Address;
    providerId: string;
    wallet: string;
    description: string;
    instructions: string;
    price: string;
}) {
    // 1. Generate individual note calls
    const noteCalls = [
        generateNoteCall({ noteKey: PROVIDER_NOTE_KEYS.PROVIDER_ID, noteValue: providerId }),
        generateNoteCall({ noteKey: PROVIDER_NOTE_KEYS.WALLET, noteValue: wallet }),
        generateNoteCall({ noteKey: PROVIDER_NOTE_KEYS.DESCRIPTION, noteValue: description }),
        generateNoteCall({ noteKey: PROVIDER_NOTE_KEYS.INSTRUCTIONS, noteValue: instructions }),
        generateNoteCall({ noteKey: PROVIDER_NOTE_KEYS.PRICE, noteValue: price }),
    ];

    // 2. Create multicall data
    const calls = noteCalls.map(calldata => ({
        target: HYPERMAP_ADDRESS,
        callData: calldata,
    }));

    const multicallData = encodeFunctionData({
        abi: multicallAbi,
        functionName: 'aggregate',
        args: [calls]
    });

    // 3. Return TBA execute arguments (not encoded)
    return {
        tbaAddress,
        executeArgs: [
            MULTICALL_ADDRESS, // target: Multicall contract
            0n,               // value: 0 ETH
            multicallData,    // data: the multicall
            1,                // operation: 1 for DELEGATECALL (critical!)
        ] as const
    };
}

/**
 * Validates a provider name
 */
export function validateProviderName(name: string): { valid: boolean; error?: string } {
    if (!name) {
        return { valid: false, error: 'Provider name is required' };
    }
    
    if (name.length < 3) {
        return { valid: false, error: 'Provider name must be at least 3 characters' };
    }
    
    if (name.length > 32) {
        return { valid: false, error: 'Provider name must be 32 characters or less' };
    }
    
    // Check for valid characters (alphanumeric and hyphens)
    if (!/^[a-zA-Z0-9-]+$/.test(name)) {
        return { valid: false, error: 'Provider name can only contain letters, numbers, and hyphens' };
    }
    
    return { valid: true };
} 

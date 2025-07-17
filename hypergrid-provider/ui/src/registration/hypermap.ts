import {
    encodeFunctionData,
    encodePacked,
    stringToHex,
    parseAbi,
    type Hex,
    type Address,
} from 'viem';

// Contract addresses
export const HYPERMAP_ADDRESS: Address = '0x000000000044C6B8Cb4d8f0F889a3E47664EAeda';
export const GRID_BETA_1_ADDRESS: Address = '0x688b85652575764DaEF194DD040B9EDbF178539B';
export const HYPERGRID_NAMESPACE_MINTER_ADDRESS: Address = '0x44a8Bd4f9370b248c91d54773Ac4a457B3454b50';
export const MULTICALL_ADDRESS: Address = '0xcA11bde05977b3631167028862bE2a173976CA11';

// Note keys for provider metadata
export const PROVIDER_NOTE_KEYS = {
    PROVIDER_ID: '~provider-id',
    WALLET: '~wallet',
    DESCRIPTION: '~description',
    INSTRUCTIONS: '~instructions',
    PRICE: '~price',
} as const;

// ABIs - Using the same pattern as operator code
export const hypermapAbi = parseAbi([
    'function mint(address owner, bytes calldata node, bytes calldata data, address implementation) external returns (address tba)',
    'function note(bytes calldata noteKey, bytes calldata noteValue) external returns (bytes32 labelhash)',
]);

export const hyperGridNamespaceMinterAbi = parseAbi([
    'function mint(address owner, bytes calldata label) external returns (address)',
    'function getChildImplementation() external view returns (address)',
    // Common events that might be emitted during minting
    'event AccountCreated(address indexed account, address indexed implementation, uint256 chainId, address indexed tokenContract, uint256 tokenId)',
    'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
]);

// ERC6551 Registry ABI for decoding AccountCreated events
export const erc6551RegistryAbi = parseAbi([
    'event AccountCreated(address account, address indexed implementation, uint256 chainId, address indexed tokenContract, uint256 indexed tokenId)',
]);

export const multicallAbi = parseAbi([
    'function aggregate(Call[] calls) external payable returns (uint256 blockNumber, bytes[] returnData)',
    'struct Call { address target; bytes callData; }',
]);

// TBA (Token Bound Account) ABI for execute function
export const tbaExecuteAbi = parseAbi([
    'function execute(address target, uint256 value, bytes calldata data, uint8 operation) external payable returns (bytes memory)',
]);

// Helper functions

/**
 * Generates the calldata for minting a new provider entry
 */
export function generateProviderMintCall({
    owner,
    providerName,
}: {
    owner: Address;
    providerName: string;
}): Hex {
    return encodeFunctionData({
        abi: hyperGridNamespaceMinterAbi,
        functionName: 'mint',
        args: [
            owner,
            encodePacked(["bytes"], [stringToHex(providerName)]),
        ]
    });
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
 * Prepares all note calls for provider metadata
 */
export function prepareProviderNoteCalls({
    providerId,
    wallet,
    description,
    instructions,
    price,
}: {
    providerId: string;
    wallet: string;
    description: string;
    instructions: string;
    price: string;
}): Array<{ key: string; value: string; calldata: Hex }> {
    return [
        {
            key: PROVIDER_NOTE_KEYS.PROVIDER_ID,
            value: providerId,
            calldata: generateNoteCall({ noteKey: PROVIDER_NOTE_KEYS.PROVIDER_ID, noteValue: providerId }),
        },
        {
            key: PROVIDER_NOTE_KEYS.WALLET,
            value: wallet,
            calldata: generateNoteCall({ noteKey: PROVIDER_NOTE_KEYS.WALLET, noteValue: wallet }),
        },
        {
            key: PROVIDER_NOTE_KEYS.DESCRIPTION,
            value: description,
            calldata: generateNoteCall({ noteKey: PROVIDER_NOTE_KEYS.DESCRIPTION, noteValue: description }),
        },
        {
            key: PROVIDER_NOTE_KEYS.INSTRUCTIONS,
            value: instructions,
            calldata: generateNoteCall({ noteKey: PROVIDER_NOTE_KEYS.INSTRUCTIONS, noteValue: instructions }),
        },
        {
            key: PROVIDER_NOTE_KEYS.PRICE,
            value: price,
            calldata: generateNoteCall({ noteKey: PROVIDER_NOTE_KEYS.PRICE, noteValue: price }),
        },
    ];
}

/**
 * Generates a multicall for setting all provider notes in a single transaction
 */
export function generateProviderNotesMulticall({
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
}): Hex {
    const noteCalls = [
        generateNoteCall({ noteKey: PROVIDER_NOTE_KEYS.PROVIDER_ID, noteValue: providerId }),
        generateNoteCall({ noteKey: PROVIDER_NOTE_KEYS.WALLET, noteValue: wallet }),
        generateNoteCall({ noteKey: PROVIDER_NOTE_KEYS.DESCRIPTION, noteValue: description }),
        generateNoteCall({ noteKey: PROVIDER_NOTE_KEYS.INSTRUCTIONS, noteValue: instructions }),
        generateNoteCall({ noteKey: PROVIDER_NOTE_KEYS.PRICE, noteValue: price }),
    ];

    // Each call targets HYPERMAP_ADDRESS directly (not through TBA.execute)
    const calls = noteCalls.map(calldata => ({
        target: HYPERMAP_ADDRESS,
        callData: calldata,
    }));

    return encodeFunctionData({
        abi: multicallAbi,
        functionName: 'aggregate',
        args: [calls]
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
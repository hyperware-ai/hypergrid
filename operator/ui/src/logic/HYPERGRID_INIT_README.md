# Hypergrid Operator Initialization Functions

This directory contains extracted functions for initializing Hypergrid operators during node boot process.

## Files

- `hypergridInitHelpers.ts` - Core encoding functions for Hypergrid operations
- `nodeInitWithHypergridExample.ts` - Example integration with node initialization

## Key Functions

### 1. `generateOperatorSubEntryMintCall()`
Generates calldata for minting the `hpn-grid-beta` operator wallet as a sub-entry.

```typescript
const mintCall = generateOperatorSubEntryMintCall({
    ownerOfNewSubTba: '0x...', // Who will own the operator wallet
    subLabelToMint: 'hpn-grid-beta', // Optional, defaults to 'hpn-grid-beta'
    implementationForNewSubTba: '0x...', // Optional, defaults to 0x000000000046886061414588bb9F63b6C53D8674
});
```

### 2. `generateAccessListNoteCall()`
Generates calldata for setting the `~access-list` note with the namehash of the signers path.

```typescript
const noteCall = generateAccessListNoteCall({
    operatorEntryName: 'my-node.os', // The node's name
});
```

## Integration Examples

### Simple Integration
Add these calls to your existing multicall array during node initialization:

```typescript
import { generateOperatorSubEntryMintCall, generateAccessListNoteCall, HYPERMAP_ADDRESS } from './hypergridInitHelpers';

// In your node initialization multicall
const hypergridCalls = [
    { 
        target: HYPERMAP_ADDRESS, 
        callData: generateOperatorSubEntryMintCall({ 
            ownerOfNewSubTba: nodeOwnerAddress 
        }) 
    },
    { 
        target: HYPERMAP_ADDRESS, 
        callData: generateAccessListNoteCall({ 
            operatorEntryName: 'my-node.os' 
        }) 
    },
];

// Add to your existing calls
const allCalls = [...networkingCalls, ...hypergridCalls, ...otherCalls];
```

### Complete Example with Networking
See `nodeInitWithHypergridExample.ts` for a full example that combines networking setup with Hypergrid initialization.

## Important Notes

1. **Order Matters**: The mint call must come before the note call since the note is set on the newly minted operator wallet.

2. **TBA Context**: If these calls need to be executed by a parent TBA (not directly by an EOA), wrap them in a TBA execute call using `wrapInTbaExecute()`.

3. **Constants**: The following are exported and can be customized:
   - `HYPERMAP_ADDRESS`: The Hypermap contract address
   - `DEFAULT_OPERATOR_TBA_IMPLEMENTATION`: The implementation address for operator TBAs
   - `HYPERGRID_ACCESS_LIST_NOTE_KEY`: The key for access-list notes (`~access-list`)
   - `HYPERGRID_SIGNERS_NOTE_KEY`: The key for signers notes (`~grid-beta-signers`)

## Minimal External Usage

For use in a completely separate codebase, you only need:
1. The viem library (`npm install viem`)
2. Copy the core functions from `hypergridInitHelpers.ts`
3. Integrate the calls into your multicall array

The functions are designed to be self-contained with minimal dependencies. 
import type { Address } from 'viem';

export type AsyncRes<T> = Promise<Result<T>>;
export type Result<T> = { ok: T } | { error: string };

export type ProcessState = { indexers: string[]; indexer: string };
export type AllProviders = Record<Category, Array<Provider>>;
export type Category = string;
export type Provider = {
  category: Category;
  site: string;
  description: string;
  name: string;
  providerName: string;
  providerId: string;
  price: string;
  // db data
  created?: number;
  id?: number;
};
export type ProviderJson = {
  category: Category;
  site: string;
  description: string;
  name: string;
  provider_name: string;
  provider_id: string;
  price: string;
  // db data
  created?: number;
  id?: number;
  arguments?: Record<string, any>;
};

export interface SpendingLimits {
    maxPerCall: string | null;
    maxTotal: string | null;
    currency: string | null;
    totalSpent?: string; // Total amount spent so far (optional field from hyperwallet)
}

// Exported for use in App.tsx and AccountManager.tsx
export interface WalletSummary {
    id: string;
    name: string | null;
    address: string;
    is_active: boolean;
    is_encrypted: boolean;
    is_selected: boolean;
    is_unlocked: boolean;
}

export interface WalletListData {
    selected_id: string | null;
    wallets: WalletSummary[];
}

// Exported for use in ActiveAccountDisplay.tsx and CallHistory.tsx
export interface PaymentAttemptResultSuccess {
    tx_hash: string;
    amount_paid: string;
    currency: string;
}
export interface PaymentAttemptResultFailed {
    error: string;
    amount_attempted: string;
    currency: string;
}
export interface PaymentAttemptResultSkipped {
    reason: string;
}
export interface PaymentAttemptResultLimitExceeded {
     limit: string;
     amount_attempted: string;
     currency: string;
}
export type PaymentAttemptResult =
    | { Success: PaymentAttemptResultSuccess }
    | { Failed: PaymentAttemptResultFailed }
    | { Skipped: PaymentAttemptResultSkipped }
    | { LimitExceeded: PaymentAttemptResultLimitExceeded };

export interface CallRecord {
   timestamp_start_ms: number; 
   provider_lookup_key: string;
   target_provider_id: string;
   call_args_json: string;
   call_success: boolean;
   response_timestamp_ms: number;
   payment_result?: PaymentAttemptResult | null;
   duration_ms: number;
   operator_wallet_id?: string | null; 
}

// Exported for use in ActiveAccountDisplay.tsx
export interface ActiveAccountDetails extends WalletSummary {
    eth_balance: string | null;
    usdc_balance: string | null;
}

// --- NEW DETAILED STATUS TYPES (Mirroring Rust backend) ---

// Matches IdentityStatus enum in Rust
export type IdentityStatus = 
    | { type: 'verified', entryName: string, tbaAddress: string, ownerAddress: string }
    | { type: 'notFound' }
    | { type: 'implementationCheckFailed', error: string }
    | { type: 'incorrectImplementation', found: string, expected: string }
    | { type: 'checkError', error: string };

// Matches DelegationStatus enum in Rust
export type DelegationStatus = 
    | 'verified' 
    | 'needsIdentity' 
    | 'needsHotWallet' 
    | 'accessListNoteMissing' 
    | { type: 'accessListNoteInvalidData', reason: string }
    | { type: 'signersNoteLookupError', reason: string } 
    | 'signersNoteMissing' 
    | { type: 'signersNoteInvalidData', reason: string } 
    | 'hotWalletNotInList' 
    | { type: 'checkError', error: string }; 
    // Note: Using string literals for simple variants and objects for variants with data.
    // Serde should handle this mapping with appropriate struct/enum attributes in Rust.
    // Need to adjust Rust enum definition slightly if using `#[serde(tag = "type", content = "reason")]` etc.
    // For now, assuming the Rust side serializes complex variants as objects.

// Matches FundingStatusDetails struct in Rust
export interface FundingStatusDetails {
    tbaNeedsEth: boolean;
    tbaNeedsUsdc: boolean;
    hotWalletNeedsEth: boolean;
    checkError?: string | null;
    tbaEthBalanceStr?: string | null;
    tbaUsdcBalanceStr?: string | null;
    hotWalletEthBalanceStr?: string | null;
}

// --- END NEW DETAILED STATUS TYPES ---

// Existing OnboardingStatus enum (matches Rust)
export enum OnboardingStatus {
    NeedsHotWallet = 'NeedsHotWallet',
    NeedsOnChainSetup = 'NeedsOnChainSetup',
    NeedsFunding = 'NeedsFunding',
    Ready = 'Ready',
    Loading = 'Loading',
    Error = 'Error' 
}

// Updated OnboardingCheckDetails interface
export interface OnboardingCheckDetails {
    // Use camelCase to match Rust serde output
    identityConfigured: boolean;
    hotWalletSelectedAndActive: boolean;
    delegationVerified?: boolean | null;
    tbaEthFunded?: boolean | null;
    tbaUsdcFunded?: boolean | null;
    hotWalletEthFunded?: boolean | null;
    operatorEntry?: string | null;
    operatorTba?: string | null;
    hotWalletAddress?: string | null;
    tbaEthBalanceStr?: string | null;
    tbaUsdcBalanceStr?: string | null;
    hotWalletEthBalanceStr?: string | null;

    // Detailed Status Fields (also camelCase)
    identityStatus?: IdentityStatus | null;
    delegationStatus?: DelegationStatus | null;
    fundingStatus?: FundingStatusDetails | null;
}

// OnboardingStatusResponse remains the same structure
export interface OnboardingStatusResponse {
    status: OnboardingStatus;
    checks: OnboardingCheckDetails;
    errors: string[];
}

// Interface for the backend response when configuring an authorized client
export interface ConfigureAuthorizedClientResponse {
    client_id: string;
    raw_token: string;
    api_base_path: string;
    node_name: string;
}

// --- Backend-Driven Hypergrid Graph Visualizer Types ---

export interface INodePosition {
    x: number;
    y: number;
}

export interface IOperatorWalletFundingInfo {
    ethBalanceStr?: string | null;
    usdcBalanceStr?: string | null;
    needsEth: boolean;
    needsUsdc: boolean;
    errorMessage?: string | null;
}

export interface IHotWalletFundingInfo {
    ethBalanceStr?: string | null;
    needsEth: boolean;
    errorMessage?: string | null;
}

export interface INoteInfo {
    statusText: string;
    details?: string | null;
    isSet: boolean;
    actionNeeded: boolean;
    actionId?: string | null; // e.g., "trigger_set_signers_note"
}

// Variants for GraphNodeData
export interface IOwnerNodeData {
    type: "OwnerNode"; // To discriminate union
    name: string;
    tbaAddress?: string | null;
    ownerAddress?: string | null;
}

export interface IOperatorWalletNodeData {
    type: "OperatorWalletNode";
    name: string;
    tbaAddress: string;
    fundingStatus: IOperatorWalletFundingInfo;
    signersNote: INoteInfo;
    accessListNote: INoteInfo;
    gaslessEnabled?: boolean;
    paymasterApproved?: boolean;
}

export interface IHotWalletNodeData {
    type: "HotWalletNode";
    address: Address;
    name: string | null;
    statusDescription: string;
    isActiveInMcp: boolean;
    isEncrypted: boolean;
    isUnlocked: boolean;
    fundingInfo: IHotWalletFundingInfo | null;
    authorizedClients: string[];
    limits: SpendingLimits | null;
}

export interface IAuthorizedClientNodeData {
    type: "AuthorizedClientNode";
    clientId: string;
    clientName: string;
    associatedHotWalletAddress: string;
}

export interface IAddHotWalletActionNodeData {
    type: "AddHotWalletActionNode";
    label: string;
    operatorTbaAddress?: string | null;
    actionId: string; // e.g., "trigger_manage_wallets_modal"
}

export interface IAddAuthorizedClientActionNodeData {
    type: "AddAuthorizedClientActionNode";
    label: string;
    targetHotWalletAddress: string;
    actionId: string; // e.g., "trigger_add_client_modal"
}

export interface IMintOperatorWalletActionNodeData {
    type: "MintOperatorWalletActionNode";
    label: string;
    ownerNodeName: string;
    actionId: string; // e.g., "trigger_mint_operator_wallet"
}

export type IGraphNodeData = 
    | IOwnerNodeData
    | IOperatorWalletNodeData
    | IHotWalletNodeData
    | IAuthorizedClientNodeData
    | IAddHotWalletActionNodeData
    | IAddAuthorizedClientActionNodeData
    | IMintOperatorWalletActionNodeData;

export interface IGraphNode {
    id: string;
    type: string; // Corresponds to 'type' in Rust GraphNode, which is serialized as "type"
    data: IGraphNodeData;
    position?: INodePosition | null;
}

export interface IGraphEdge {
    id: string;
    source: string;
    target: string;
    styleType?: string | null;
    animated?: boolean | null;
}

export interface IHypergridGraphResponse {
    nodes: IGraphNode[];
    edges: IGraphEdge[];
}

// --- End Backend-Driven Hypergrid Graph Visualizer Types ---

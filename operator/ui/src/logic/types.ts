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

// ========================================================================================
// HYPERWALLET CLIENT TYPES - TypeScript equivalents of Rust hyperwallet_client types
// ========================================================================================

// Core type aliases
export type ProcessAddress = string;
export type WalletAddress = string;
export type ChainId = number;
export type SessionId = string;
export type UserOperationHash = string;
export type Signature = number[];

// Operation enum - matches Rust Operation
export enum Operation {
    Handshake = 'Handshake',
    UnlockWallet = 'UnlockWallet',
    RegisterProcess = 'RegisterProcess',
    UpdateSpendingLimits = 'UpdateSpendingLimits',
    CreateWallet = 'CreateWallet',
    ImportWallet = 'ImportWallet',
    DeleteWallet = 'DeleteWallet',
    RenameWallet = 'RenameWallet',
    ExportWallet = 'ExportWallet',
    EncryptWallet = 'EncryptWallet',
    DecryptWallet = 'DecryptWallet',
    GetWalletInfo = 'GetWalletInfo',
    ListWallets = 'ListWallets',
    SetWalletLimits = 'SetWalletLimits',
    SendEth = 'SendEth',
    SendToken = 'SendToken',
    ApproveToken = 'ApproveToken',
    CallContract = 'CallContract',
    SignTransaction = 'SignTransaction',
    SignMessage = 'SignMessage',
    ExecuteViaTba = 'ExecuteViaTba',
    CheckTbaOwnership = 'CheckTbaOwnership',
    SetupTbaDelegation = 'SetupTbaDelegation',
    BuildAndSignUserOperationForPayment = 'BuildAndSignUserOperationForPayment',
    SubmitUserOperation = 'SubmitUserOperation',
    BuildUserOperation = 'BuildUserOperation',
    SignUserOperation = 'SignUserOperation',
    BuildAndSignUserOperation = 'BuildAndSignUserOperation',
    EstimateUserOperationGas = 'EstimateUserOperationGas',
    GetUserOperationReceipt = 'GetUserOperationReceipt',
    ConfigurePaymaster = 'ConfigurePaymaster',
    ResolveIdentity = 'ResolveIdentity',
    CreateNote = 'CreateNote',
    ReadNote = 'ReadNote',
    SetupDelegation = 'SetupDelegation',
    VerifyDelegation = 'VerifyDelegation',
    MintEntry = 'MintEntry',
    GetBalance = 'GetBalance',
    GetTokenBalance = 'GetTokenBalance',
    GetTransactionHistory = 'GetTransactionHistory',
    EstimateGas = 'EstimateGas',
    GetGasPrice = 'GetGasPrice',
    GetTransactionReceipt = 'GetTransactionReceipt',
    BatchOperations = 'BatchOperations',
    ScheduleOperation = 'ScheduleOperation',
    CancelOperation = 'CancelOperation',
}

// OperationCategory enum - matches Rust OperationCategory  
export enum OperationCategory {
    System = 'System',
    ProcessManagement = 'ProcessManagement',
    WalletManagement = 'WalletManagement',
    Ethereum = 'Ethereum',
    TokenBoundAccount = 'TokenBoundAccount',
    ERC4337 = 'ERC4337',
    Hypermap = 'Hypermap',
    Query = 'Query',
    Advanced = 'Advanced',
}

// ErrorCode enum - matches Rust ErrorCode
export enum ErrorCode {
    PermissionDenied = 'PermissionDenied',
    WalletNotFound = 'WalletNotFound',
    InsufficientFunds = 'InsufficientFunds',
    InvalidOperation = 'InvalidOperation',
    InvalidParams = 'InvalidParams',
    SpendingLimitExceeded = 'SpendingLimitExceeded',
    ChainNotAllowed = 'ChainNotAllowed',
    BlockchainError = 'BlockchainError',
    InternalError = 'InternalError',
    AuthenticationFailed = 'AuthenticationFailed',
    WalletLocked = 'WalletLocked',
    OperationNotSupported = 'OperationNotSupported',
    VersionMismatch = 'VersionMismatch',
}

// MessageType enum for signing
export enum MessageType {
    PlainText = 'PlainText',
    Eip191 = 'Eip191',
}

export interface MessageTypeEip712 {
    Eip712: {
        domain: any;
        types: any;
    };
}

export type MessageTypeUnion = MessageType | MessageTypeEip712;

// Core structs
export interface OperationError {
    code: ErrorCode;
    message: string;
    details?: any;
}

export interface HyperwalletSpendingLimits {
    per_tx_eth?: string;
    daily_eth?: string;
    per_tx_usdc?: string;
    daily_usdc?: string;
    daily_reset_at: number;
    spent_today_eth: string;
    spent_today_usdc: string;
}

export interface PaymasterConfig {
    is_circle_paymaster: boolean;
    paymaster_address: string;
    paymaster_verification_gas: string;
    paymaster_post_op_gas: string;
}

export interface HyperwalletBalance {
    formatted: string;
    raw: string;
}

export interface HyperwalletWallet {
    address: WalletAddress;
    name?: string;
    chain_id: ChainId;
    encrypted: boolean;
    created_at?: string;
    last_used?: string;
    spending_limits?: WalletSpendingLimits;
}

export interface WalletSpendingLimits {
    max_per_call?: string;
    max_total?: string;
    currency: string;
    total_spent: string;
    set_at?: string;
    updated_at?: string;
}

// Handshake types
export type HandshakeStep =
    | {
          ClientHello: {
              client_version: string;
              client_name: string;
          };
      }
    | {
          ServerWelcome: {
              server_version: string;
              supported_operations: Operation[];
              supported_chains: number[];
              features: string[];
          };
      }
    | {
          Register: {
              required_operations: Operation[];
              spending_limits?: HyperwalletSpendingLimits;
          };
      }
    | {
          Complete: {
              registered_permissions: ProcessPermissions;
              session_id: string;
          };
      };

export interface ProcessPermissions {
    address: ProcessAddress;
    allowed_operations: Operation[];
    spending_limits?: HyperwalletSpendingLimits;
    updatable_settings: UpdatableSetting[];
    registered_at: number;
}

export enum UpdatableSetting {
    SpendingLimits = 'SpendingLimits',
}

export interface SessionInfo {
    server_version: string;
    session_id: SessionId;
    registered_permissions: ProcessPermissions;
    initial_chain_id: ChainId;
}

// Request types
export interface CreateWalletRequest {
    name: string;
    password?: string;
}

export interface ImportWalletRequest {
    name: string;
    private_key: string;
    password?: string;
}

export interface RenameWalletRequest {
    wallet_id: string;
    new_name: string;
}

export interface DeleteWalletRequest {
    wallet_id: string;
}

export interface ExportWalletRequest {
    wallet_id: string;
    password?: string;
}

export interface UnlockWalletRequest {
    session_id: SessionId;
    wallet_id: string;
    password: string;
}

export interface GetWalletInfoRequest {
    wallet_id: string;
}

export interface GetBalanceRequest {
    wallet_id: string;
}

export interface SendEthRequest {
    wallet_id: string;
    to: string;
    amount: string;
}

export interface SendTokenRequest {
    wallet_id: string;
    token_address: string;
    to: string;
    amount: string;
}

export interface GetTokenBalanceRequest {
    wallet_id: string;
    token_address: string;
}

export interface ExecuteViaTbaRequest {
    tba_address: string;
    target: string;
    call_data: string;
    value?: string;
}

export interface BuildAndSignUserOperationForPaymentRequest {
    eoa_wallet_id: string;
    tba_address: string;
    target: string;
    call_data: string;
    use_paymaster: boolean;
    paymaster_config?: PaymasterConfig;
    password?: string;
}

export interface SubmitUserOperationRequest {
    signed_user_operation: any;
    entry_point: string;
    bundler_url?: string;
}

export interface GetUserOperationReceiptRequest {
    user_op_hash: string;
}

// Response types
export interface HyperwalletResponse<T> {
    success: boolean;
    data?: T;
    error?: OperationError;
    request_id?: string;
}

export interface CreateWalletResponse {
    wallet_id: string;
    address: string;
    name: string;
}

export interface ImportWalletResponse {
    wallet_id: string;
    address: string;
    name: string;
}

export interface DeleteWalletResponse {
    success: boolean;
    wallet_id: string;
    message: string;
}

export interface ExportWalletResponse {
    address: string;
    private_key: string;
}

export interface UnlockWalletResponse {
    success: boolean;
    wallet_id: string;
    message: string;
}

export interface GetWalletInfoResponse {
    wallet_id: string;
    address: string;
    name: string;
    chain_id: ChainId;
    is_locked: boolean;
}

export interface GetBalanceResponse {
    balance: HyperwalletBalance;
    wallet_id: string;
    chain_id: ChainId;
}

export interface ListWalletsResponse {
    process: string;
    wallets: HyperwalletWallet[];
    total: number;
}

export interface SendEthResponse {
    tx_hash: string;
    from_address: string;
    to_address: string;
    amount: string;
    chain_id: ChainId;
}

export interface SendTokenResponse {
    tx_hash: string;
    from_address: string;
    to_address: string;
    token_address: string;
    amount: string;
    chain_id: ChainId;
}

export interface GetTokenBalanceResponse {
    balance: string;
    formatted?: string;
    decimals?: number;
}

export interface ExecuteViaTbaResponse {
    tx_hash: string;
    tba_address: string;
    target_address: string;
    success: boolean;
}

export interface BuildAndSignUserOperationResponse {
    signed_user_operation: any;
    entry_point: string;
    ready_to_submit: boolean;
}

export interface SubmitUserOperationResponse {
    user_op_hash: string;
}

export interface UserOperationReceiptResponse {
    receipt?: any;
    user_op_hash: string;
    status: string;
}

export interface CreateNoteResponse {
    note_id: string;
    content_hash: string;
    created_at: number;
}

// Message wrappers
export interface HyperwalletRequest<T> {
    data: T;
    session_id: SessionId;
}

export interface HandshakeRequest<T> {
    step: T;
}

// Message enum - matches Rust HyperwalletMessage  
export type HyperwalletMessage =
    | { operation: 'Handshake'; data: HandshakeRequest<HandshakeStep> }
    | { operation: 'UnlockWallet'; data: HyperwalletRequest<UnlockWalletRequest> }
    | { operation: 'CreateWallet'; data: HyperwalletRequest<CreateWalletRequest> }
    | { operation: 'ImportWallet'; data: HyperwalletRequest<ImportWalletRequest> }
    | { operation: 'DeleteWallet'; data: HyperwalletRequest<DeleteWalletRequest> }
    | { operation: 'RenameWallet'; data: HyperwalletRequest<RenameWalletRequest> }
    | { operation: 'ExportWallet'; data: HyperwalletRequest<ExportWalletRequest> }
    | { operation: 'ListWallets'; data: HyperwalletRequest<{}> }
    | { operation: 'GetWalletInfo'; data: HyperwalletRequest<GetWalletInfoRequest> }
    | { operation: 'GetBalance'; data: HyperwalletRequest<GetBalanceRequest> }
    | { operation: 'SendEth'; data: HyperwalletRequest<SendEthRequest> }
    | { operation: 'SendToken'; data: HyperwalletRequest<SendTokenRequest> }
    | { operation: 'GetTokenBalance'; data: HyperwalletRequest<GetTokenBalanceRequest> }
    | { operation: 'ExecuteViaTba'; data: HyperwalletRequest<ExecuteViaTbaRequest> }
    | { operation: 'BuildAndSignUserOperationForPayment'; data: HyperwalletRequest<BuildAndSignUserOperationForPaymentRequest> }
    | { operation: 'SubmitUserOperation'; data: HyperwalletRequest<SubmitUserOperationRequest> }
    | { operation: 'GetUserOperationReceipt'; data: HyperwalletRequest<GetUserOperationReceiptRequest> };

// ========================================================================================
// END HYPERWALLET CLIENT TYPES 
// ========================================================================================

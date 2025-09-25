// WebSocket message types for Operator state streaming and Spider chat

// Client -> Server messages
export type WsClientMessage = 
  | SubscribeMessage 
  | UnsubscribeMessage
  | AuthMessage
  | ChatMessage
  | CancelMessage
  | PingMessage;

export interface SubscribeMessage {
  type: 'subscribe';
  topics?: StateUpdateTopic[];
}

export interface UnsubscribeMessage {
  type: 'unsubscribe';
  topics?: StateUpdateTopic[];
}

export interface PingMessage {
  type: 'ping';
}

// Chat-related messages
export interface AuthMessage {
  type: 'auth';
  apiKey: string;
}

export interface ChatMessage {
  type: 'chat';
  payload: {
    messages: SpiderMessage[];
    llmProvider?: string;
    model?: string;
    mcpServers?: string[];
    metadata?: ConversationMetadata;
  };
}

export interface CancelMessage {
  type: 'cancel';
}

// Topics that clients can subscribe to
export type StateUpdateTopic = 
  | 'wallets'
  | 'transactions' 
  | 'providers'
  | 'authorization'
  | 'graph_state'
  | 'all';

// Server -> Client messages
export type WsServerMessage =
  | SubscribedMessage
  | StateUpdateMessage
  | StateSnapshotMessage
  | AuthSuccessMessage
  | AuthErrorMessage
  | StatusMessage
  | StreamMessage
  | MessageUpdate
  | ChatCompleteMessage
  | ErrorMessage
  | PongMessage;

export interface SubscribedMessage {
  type: 'subscribed';
  topics: StateUpdateTopic[];
}

export interface StateUpdateMessage {
  type: 'state_update';
  topic: StateUpdateTopic;
  data: StateUpdateData;
}

export interface StateSnapshotMessage {
  type: 'state_snapshot';
  state: StateSnapshotData;
}

export interface ErrorMessage {
  type: 'error';
  error: string;
}

export interface PongMessage {
  type: 'pong';
}

// Chat-related server messages
export interface AuthSuccessMessage {
  type: 'auth_success';
  message: string;
}

export interface AuthErrorMessage {
  type: 'auth_error';
  error: string;
}

export interface StatusMessage {
  type: 'status';
  status: string;
  message?: string;
}

export interface StreamMessage {
  type: 'stream';
  iteration: number;
  message: string;
  tool_calls?: string | null;
}

export interface MessageUpdate {
  type: 'message';
  message: SpiderMessage;
}

export interface ChatCompleteMessage {
  type: 'chat_complete';
  payload: ChatResponse;
}

// State update data types
export type StateUpdateData =
  | WalletUpdateData
  | NewTransactionData
  | ProviderUpdateData
  | AuthorizationUpdateData
  | GraphStateUpdateData
  | BalanceUpdateData;

export interface WalletUpdateData {
  update_type: 'wallet_update';
  wallets: WalletSummary[];
  selected_wallet_id: string | null;
  active_signer_wallet_id: string | null;
  active_account?: ActiveAccountDetails | null;
}

export interface NewTransactionData {
  update_type: 'new_transaction';
  record: CallRecord;
}

export interface ProviderUpdateData {
  update_type: 'provider_update';
  update_info: string;
}

export interface AuthorizationUpdateData {
  update_type: 'authorization_update';
  clients: Array<[string, HotWalletAuthorizedClient]>;
}

export interface GraphStateUpdateData {
  update_type: 'graph_state_update';
  coarse_state: string;
  operator_tba_address: string | null;
  operator_entry_name: string | null;
  paymaster_approved?: boolean | null;
}

export interface BalanceUpdateData {
  update_type: 'balance_update';
  wallet_id: string;
  eth_balance: string | null;
  usdc_balance: string | null;
}

// State snapshot data
export interface StateSnapshotData {
  wallets: WalletSummary[];
  selected_wallet_id: string | null;
  active_account: ActiveAccountDetails | null;
  recent_transactions: CallRecord[];
  authorized_clients: Array<[string, HotWalletAuthorizedClient]>;
  coarse_state: string;
  operator_tba_address: string | null;
  operator_entry_name: string | null;
  gasless_enabled?: boolean | null;
  paymaster_approved?: boolean | null;
  client_limits_cache?: Array<[string, any]>;
}

// Import types from existing files (these should match your Rust structs)
export interface WalletSummary {
  id: string;
  name?: string | null;
  address: string;
  is_encrypted: boolean;
  is_selected: boolean;
  is_unlocked: boolean;
}

export interface ActiveAccountDetails {
  id: string;
  name?: string | null;
  address: string;
  is_encrypted: boolean;
  is_selected: boolean;
  is_unlocked: boolean;
  eth_balance?: string | null;
  usdc_balance?: string | null;
}

export interface CallRecord {
  timestamp_start_ms: number;
  provider_lookup_key: string;
  target_provider_id: string;
  call_args_json: string;
  response_json?: string | null;
  call_success: boolean;
  response_timestamp_ms: number;
  payment_result?: any | null;
  duration_ms: number;
  operator_wallet_id?: string | null;
  client_id?: string | null;
  provider_name?: string | null;
}

export interface HotWalletAuthorizedClient {
  id: string;
  name: string;
  associated_hot_wallet_address: string;
}

// Chat-related types
export interface SpiderMessage {
  role: string;
  content: string;
  toolCallsJson?: string | null;
  toolResultsJson?: string | null;
  timestamp: number;
}

export interface ConversationMetadata {
  startTime: string;
  client: string;
  fromStt: boolean;
}

export interface McpServerDetails {
  id: string;
  name: string;
  tools: McpToolInfo[];
}

export interface McpToolInfo {
  name: string;
  description: string;
}

export interface ChatResponse {
  conversationId: string;
  response: SpiderMessage;
  allMessages: SpiderMessage[];
  refreshedApiKey?: string;  // This is added by operator backend
}

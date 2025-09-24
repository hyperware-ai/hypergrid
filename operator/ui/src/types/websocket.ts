// WebSocket message types for Operator state streaming

// Client -> Server messages
export type WsClientMessage = 
  | SubscribeMessage 
  | UnsubscribeMessage
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

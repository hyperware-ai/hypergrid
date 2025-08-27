// WebSocket message types for Spider chat

// Client -> Server messages
export type WsClientMessage = 
  | AuthMessage 
  | ChatMessage 
  | CancelMessage
  | PingMessage;

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

export interface PingMessage {
  type: 'ping';
}

// Server -> Client messages
export type WsServerMessage =
  | AuthSuccessMessage
  | AuthErrorMessage
  | StatusMessage
  | StreamMessage
  | MessageUpdate
  | ChatCompleteMessage
  | ErrorMessage
  | PongMessage;

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

export interface ErrorMessage {
  type: 'error';
  error: string;
}

export interface PongMessage {
  type: 'pong';
}

// Types matching spider/spider/src/types.rs exactly
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
import { 
  WsClientMessage, 
  WsServerMessage,
  AuthMessage,
  ChatMessage,
  CancelMessage,
  PingMessage,
  SpiderMessage,
  ConversationMetadata
} from '../types/websocket';

export type MessageHandler = (message: WsServerMessage) => void;

class WebSocketService {
  private ws: WebSocket | null = null;
  private messageHandlers: Set<MessageHandler> = new Set();
  private reconnectTimeout: number | null = null;
  private url: string = '';
  private isAuthenticated: boolean = false;
  private pingInterval: number | null = null;
  
  connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }
      
      this.url = url;
      this.ws = new WebSocket(url);
      
      this.ws.onopen = () => {
        console.log('WebSocket connected');
        this.clearReconnectTimeout();
        this.startPingInterval();
        resolve();
      };
      
      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        reject(error);
      };
      
      this.ws.onclose = () => {
        console.log('WebSocket disconnected');
        this.isAuthenticated = false;
        this.stopPingInterval();
        this.scheduleReconnect();
      };
      
      this.ws.onmessage = (event) => {
        try {
          console.log('WebSocket raw message received:', event.data);
          const message = JSON.parse(event.data) as WsServerMessage;
          console.log('WebSocket parsed message:', message);
          this.handleMessage(message);
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error, 'Raw data:', event.data);
        }
      };
    });
  }
  
  private handleMessage(message: WsServerMessage) {
    // Notify all handlers
    this.messageHandlers.forEach(handler => handler(message));
  }
  
  authenticate(apiKey: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket not connected'));
        return;
      }
      
      console.log('WebSocket authenticate: sending auth message with key:', apiKey);
      
      // Set up timeout for auth response
      const authTimeout = window.setTimeout(() => {
        console.error('WebSocket auth timeout - no response received');
        this.removeMessageHandler(authHandler);
        reject(new Error('Authentication timeout - no response from server'));
      }, 5000); // 5 second timeout
      
      // Set up one-time handler for auth response
      const authHandler = (message: WsServerMessage) => {
        console.log('WebSocket received message during auth:', message);
        if (message.type === 'auth_success') {
          console.log('WebSocket auth success received');
          window.clearTimeout(authTimeout);
          this.isAuthenticated = true;
          this.removeMessageHandler(authHandler);
          resolve();
        } else if (message.type === 'auth_error') {
          console.log('WebSocket auth error received:', message.error);
          window.clearTimeout(authTimeout);
          this.removeMessageHandler(authHandler);
          // Pass the exact error message so we can detect invalid API key
          reject(new Error(message.error || 'Authentication failed'));
        }
      };
      
      // Add handler BEFORE sending message
      this.addMessageHandler(authHandler);
      
      // Send auth message - use correct format
      const authMsg: AuthMessage = {
        type: 'auth',
        apiKey
      };
      console.log('WebSocket sending auth:', JSON.stringify(authMsg));
      this.send(authMsg);
    });
  }
  
  sendChatMessage(
    messages: SpiderMessage[], 
    llmProvider?: string, 
    model?: string, 
    mcpServers?: string[], 
    metadata?: ConversationMetadata
  ): void {
    if (!this.isAuthenticated) {
      throw new Error('Not authenticated');
    }
    
    const chatMsg: ChatMessage = {
      type: 'chat',
      payload: {
        messages,
        llmProvider,
        model,
        mcpServers,
        metadata
      }
    };
    this.send(chatMsg);
  }
  
  sendCancel(): void {
    if (!this.isAuthenticated) {
      throw new Error('Not authenticated');
    }
    
    const cancelMsg: CancelMessage = {
      type: 'cancel'
    };
    this.send(cancelMsg);
  }
  
  send(data: WsClientMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }
    
    this.ws.send(JSON.stringify(data));
  }
  
  addMessageHandler(handler: MessageHandler): void {
    this.messageHandlers.add(handler);
  }
  
  removeMessageHandler(handler: MessageHandler): void {
    this.messageHandlers.delete(handler);
  }
  
  disconnect(): void {
    this.clearReconnectTimeout();
    this.stopPingInterval();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isAuthenticated = false;
  }
  
  private scheduleReconnect(): void {
    if (this.reconnectTimeout) return;
    
    this.reconnectTimeout = window.setTimeout(() => {
      console.log('Attempting to reconnect WebSocket...');
      this.connect(this.url).catch(error => {
        console.error('Reconnection failed:', error);
      });
    }, 3000);
  }
  
  private clearReconnectTimeout(): void {
    if (this.reconnectTimeout) {
      window.clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }
  
  private startPingInterval(): void {
    this.stopPingInterval();
    
    // Send an immediate ping for testing
    if (this.isConnected) {
      console.log('Sending immediate ping for testing');
      const pingMsg: PingMessage = { type: 'ping' };
      try {
        this.send(pingMsg);
      } catch (error) {
        console.error('Failed to send ping:', error);
      }
    }
    
    this.pingInterval = window.setInterval(() => {
      if (this.isConnected) {
        const pingMsg: PingMessage = { type: 'ping' };
        try {
          console.log('Sending periodic ping');
          this.send(pingMsg);
        } catch (error) {
          console.error('Failed to send ping:', error);
        }
      }
    }, 30000); // Send ping every 30 seconds
  }
  
  private stopPingInterval(): void {
    if (this.pingInterval) {
      window.clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }
  
  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
  
  get isReady(): boolean {
    return this.isConnected && this.isAuthenticated;
  }
}

export const webSocketService = new WebSocketService();
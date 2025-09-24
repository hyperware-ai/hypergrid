import { 
  WsClientMessage, 
  WsServerMessage,
  SubscribeMessage,
  PingMessage,
  StateUpdateTopic
} from '../types/websocket';

export type MessageHandler = (message: WsServerMessage) => void;

class WebSocketService {
  private ws: WebSocket | null = null;
  private messageHandlers: Set<MessageHandler> = new Set();
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private url: string = '';
  private isSubscribed: boolean = false;
  private subscribedTopics: StateUpdateTopic[] = [];
  
  connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }
      
      this.url = url;
      this.ws = new WebSocket(url);
      
      this.ws.onopen = () => {
        console.log('WebSocket connected to operator');
        this.clearReconnectTimeout();
        resolve();
      };
      
      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        reject(error);
      };
      
      this.ws.onclose = () => {
        console.log('WebSocket disconnected from operator');
        this.isSubscribed = false;
        this.scheduleReconnect();
      };
      
      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as WsServerMessage;
          this.handleMessage(message);
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      };
    });
  }
  
  private handleMessage(message: WsServerMessage) {
    // Handle subscribed confirmation
    if (message.type === 'subscribed') {
      this.isSubscribed = true;
      this.subscribedTopics = message.topics;
      console.log('Subscribed to operator state topics:', message.topics);
    }
    
    // Notify all handlers
    this.messageHandlers.forEach(handler => handler(message));
  }
  
  subscribe(topics?: StateUpdateTopic[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }
    
    const subscribeMsg: SubscribeMessage = {
      type: 'subscribe',
      topics: topics || ['all']
    };
    this.send(subscribeMsg);
  }
  
  unsubscribe(topics?: StateUpdateTopic[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    
    const unsubscribeMsg = {
      type: 'unsubscribe' as const,
      topics
    };
    this.send(unsubscribeMsg);
  }
  
  sendPing(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    
    const pingMsg: PingMessage = {
      type: 'ping'
    };
    this.send(pingMsg);
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
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isSubscribed = false;
    this.subscribedTopics = [];
  }
  
  private scheduleReconnect(): void {
    if (this.reconnectTimeout) return;
    
    this.reconnectTimeout = setTimeout(() => {
      console.log('Attempting to reconnect WebSocket to operator...');
      this.connect(this.url)
        .then(() => {
          // Re-subscribe after reconnect
          if (this.subscribedTopics.length > 0) {
            this.subscribe(this.subscribedTopics);
          }
        })
        .catch(error => {
          console.error('Reconnection failed:', error);
        });
    }, 3000);
  }
  
  private clearReconnectTimeout(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }
  
  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
  
  get isReady(): boolean {
    return this.isConnected && this.isSubscribed;
  }
}

export const webSocketService = new WebSocketService();

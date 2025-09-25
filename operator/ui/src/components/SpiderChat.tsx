import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { webSocketService } from '../services/websocket';
import { WsServerMessage, SpiderMessage, ConversationMetadata, McpServerDetails } from '../types/websocket';
import { callApiWithRouting } from '../utils/api-endpoints';

// Types
interface Conversation {
  id: string;
  messages: SpiderMessage[];
  metadata: ConversationMetadata;
  llmProvider: string;
  model?: string;
  mcpServers: string[];
  mcpServersDetails?: McpServerDetails[] | null;
}

interface ToolCall {
  id: string;
  tool_name: string;
  parameters: string;
}

interface ToolResult {
  tool_call_id: string;
  result: string;
}

interface SpiderChatProps {
  spiderApiKey: string | null;
  onConnectClick: () => void;
  onApiKeyRefreshed?: (newKey: string) => void;
}

export default function SpiderChat({ spiderApiKey, onConnectClick, onApiKeyRefreshed }: SpiderChatProps) {
  const [message, setMessage] = useState('');
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [useWebSocket, setUseWebSocket] = useState(true);
  const [wsConnected, setWsConnected] = useState(false);
  const [currentRequestId, setCurrentRequestId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const messageHandlerRef = useRef<((message: WsServerMessage) => void) | null>(null);

  const isActive = !!spiderApiKey;

  // Auto-scroll to bottom when new messages arrive
  const scrollToBottom = (smooth: boolean = true) => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ 
        behavior: smooth ? 'smooth' : 'auto', 
        block: 'end' 
      });
    }
  };

  // Scroll on new messages
  useEffect(() => {
    const timer = setTimeout(() => {
      scrollToBottom();
    }, 100);
    return () => clearTimeout(timer);
  }, [conversation?.messages?.length, isLoading]);

  // Auto-focus input when loading completes
  useEffect(() => {
    if (!isLoading && inputRef.current && isActive) {
      inputRef.current.focus();
    }
  }, [isLoading, isActive]);

  // Connect to WebSocket when API key is available
  useEffect(() => {
    let timer: number | undefined;
    
    if (spiderApiKey && useWebSocket) {
      // Add a small delay to ensure the component is ready
      timer = window.setTimeout(() => {
        connectWebSocket();
      }, 100);
    }
    
    return () => {
      if (timer) {
        clearTimeout(timer);
      }
      if (messageHandlerRef.current) {
        webSocketService.removeMessageHandler(messageHandlerRef.current);
        messageHandlerRef.current = null;
      }
      if (wsConnected) {
        webSocketService.disconnect();
        setWsConnected(false);
      }
    };
  }, [spiderApiKey, useWebSocket]);

  const connectWebSocket = async (apiKey?: string) => {
    const keyToUse = apiKey || spiderApiKey;
    if (!keyToUse) return;
    
    try {
      // Determine WebSocket URL - connect to spider service endpoint
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      const wsUrl = `${protocol}//${host}/spider:spider:sys/ws`;
      
      console.log('Connecting to WebSocket at:', wsUrl);
      await webSocketService.connect(wsUrl);
      
      // Set up message handler for progressive updates
      const messageHandler = (message: WsServerMessage) => {
        switch (message.type) {
          case 'message':
            // Progressive message update from tool loop
            setConversation(prev => {
              if (!prev) return prev;
              const updated = { ...prev };
              updated.messages = [...updated.messages];
              // Check if we already have this message (by timestamp or content)
              const lastMsg = updated.messages[updated.messages.length - 1];
              if (!lastMsg || lastMsg.timestamp !== message.message.timestamp) {
                updated.messages.push(message.message);
              }
              return updated;
            });
            break;
            
          case 'stream':
            // Handle streaming updates (partial message content)
            setConversation(prev => {
              if (!prev) return prev;
              const updated = { ...prev };
              updated.messages = [...updated.messages];
              
              // Find or create assistant message for streaming
              let assistantMsgIndex = updated.messages.length - 1;
              if (assistantMsgIndex < 0 || updated.messages[assistantMsgIndex].role !== 'assistant') {
                // Create new assistant message
                updated.messages.push({
                  role: 'assistant',
                  content: message.message || '',
                  toolCallsJson: message.tool_calls,
                  timestamp: Date.now(),
                });
              } else {
                // Update existing assistant message
                updated.messages[assistantMsgIndex] = {
                  ...updated.messages[assistantMsgIndex],
                  content: message.message || updated.messages[assistantMsgIndex].content,
                  toolCallsJson: message.tool_calls || updated.messages[assistantMsgIndex].toolCallsJson,
                };
              }
              return updated;
            });
            break;
            
          case 'chat_complete':
            // Final response received
            if (message.payload) {
              setConversation(prev => {
                if (!prev) return prev;
                const updated = { ...prev };
                updated.id = message.payload.conversationId;
                
                // If we have allMessages, replace the conversation messages
                if (message.payload.allMessages && message.payload.allMessages.length > 0) {
                  // Keep user messages and replace assistant responses
                  const userMessageCount = updated.messages.filter(m => m.role === 'user').length;
                  const baseMessages = updated.messages.slice(0, userMessageCount);
                  updated.messages = [...baseMessages, ...message.payload.allMessages];
                } else if (message.payload.response) {
                  // Just add the final response if not already present
                  const lastMsg = updated.messages[updated.messages.length - 1];
                  if (!lastMsg || lastMsg.role !== 'assistant') {
                    updated.messages.push(message.payload.response);
                  }
                }
                
                return updated;
              });
              
              // Handle refreshed API key
              if (message.payload.refreshedApiKey && onApiKeyRefreshed) {
                onApiKeyRefreshed(message.payload.refreshedApiKey);
              }
            }
            setIsLoading(false);
            setCurrentRequestId(null);
            break;
            
          case 'error':
            setError(message.error || 'WebSocket error occurred');
            setIsLoading(false);
            setCurrentRequestId(null);
            break;
            
          case 'status':
            console.log('Status:', message.status, message.message);
            break;
        }
      };
      
      messageHandlerRef.current = messageHandler;
      webSocketService.addMessageHandler(messageHandler);
      
      // Authenticate with spider API key
      console.log('Authenticating with API key:', keyToUse);
      await webSocketService.authenticate(keyToUse);
      console.log('Authentication successful');
      
      setWsConnected(true);
      setError(null);
    } catch (error: any) {
      console.error('Failed to connect WebSocket:', error);
      
      // Check if it's an auth error (invalid API key)
      if (error.message && (error.message.includes('Invalid API key') || error.message.includes('lacks write permission'))) {
        console.log('API key is invalid, requesting a new one...');
        
        // Don't retry if we already tried with a fresh key (to prevent infinite loop)
        if (apiKey) {
          console.error('Already tried with a fresh API key, giving up');
          setWsConnected(false);
          setUseWebSocket(false);
          setError('Unable to authenticate with Spider. Falling back to HTTP.');
          return;
        }
        
        // Request a new API key
        try {
          const data = await callApiWithRouting({ 
            SpiderConnect: true // force_new = true
          });
          
          if (data.api_key) {
            console.log('Got new API key:', data.api_key, 'retrying WebSocket connection...');
            // Update the API key in parent component
            if (onApiKeyRefreshed) {
              onApiKeyRefreshed(data.api_key);
            }
            
            // Disconnect current connection
            webSocketService.disconnect();
            // Small delay to ensure disconnect completes
            await new Promise(resolve => setTimeout(resolve, 100));
            // CRITICAL: Explicitly pass the NEW key to prevent using stale closure value
            await connectWebSocket(data.api_key);
            return;
          } else {
            throw new Error('Failed to get new API key');
          }
        } catch (refreshError: any) {
          console.error('Failed to refresh API key:', refreshError);
          setWsConnected(false);
          setUseWebSocket(false);
          setError('Failed to refresh API key. Falling back to HTTP.');
        }
      } else {
        // Other errors - just fall back to HTTP
        setWsConnected(false);
        setUseWebSocket(false);
        setError('Failed to connect WebSocket. Falling back to HTTP.');
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() || isLoading || !isActive) return;

    const requestId = Math.random().toString(36).substring(7);
    setCurrentRequestId(requestId);
    setError(null);
    setIsLoading(true);

    try {
      // Create or update conversation
      let updatedConversation = conversation || {
        id: '',
        messages: [],
        metadata: {
          startTime: new Date().toISOString(),
          client: 'operator-ui',
          fromStt: false,
        },
        llmProvider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        mcpServers: [],
      };

      // Add user message
      const userMessage: SpiderMessage = {
        role: 'user',
        content: message,
        timestamp: Date.now(),
      };
      
      updatedConversation.messages.push(userMessage);
      setConversation({ ...updatedConversation });
      setMessage('');

      // Check if we should use WebSocket
      console.log('WebSocket check - useWebSocket:', useWebSocket, 'isReady:', webSocketService.isReady, 'isConnected:', webSocketService.isConnected);
      if (useWebSocket && webSocketService.isReady) {
        // Send via WebSocket for progressive updates
        console.log('Sending chat message via WebSocket');
        webSocketService.sendChatMessage(
          updatedConversation.messages,
          updatedConversation.llmProvider,
          updatedConversation.model,
          updatedConversation.mcpServers,
          updatedConversation.metadata
        );
        // WebSocket responses will be handled by the message handler
        return;
      }
      console.log('Falling back to HTTP');

      // Fallback to HTTP
      const data = await callApiWithRouting({
        SpiderChat: {
          api_key: spiderApiKey,
          messages: updatedConversation.messages,
          llm_provider: updatedConversation.llmProvider,
          model: updatedConversation.model,
          mcp_servers: updatedConversation.mcpServers,
          metadata: updatedConversation.metadata,
        }
      });
      
      // Only update if this request hasn't been cancelled
      if (currentRequestId === requestId) {
        // Update conversation with response
        if (data.conversation_id) {
          updatedConversation.id = data.conversation_id;
        }
        
        if (data.all_messages && data.all_messages.length > 0) {
          updatedConversation.messages.push(...data.all_messages);
        } else if (data.response) {
          updatedConversation.messages.push(data.response);
        }

        setConversation({ ...updatedConversation });
        
        // If the API key was refreshed, update it in the parent component
        // Note: The backend doesn't currently return refreshedApiKey in SpiderChatResult
        // This functionality would need to be added to the backend if needed
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        // Request was cancelled
      } else {
        setError(err.message || 'Failed to send message');
        console.error('Chat error:', err);
      }
    } finally {
      if (currentRequestId === requestId) {
        setIsLoading(false);
        setCurrentRequestId(null);
      }
    }
  };

  const handleCancel = () => {
    if (useWebSocket && webSocketService.isReady) {
      try {
        webSocketService.sendCancel();
      } catch (error) {
        console.error('Failed to send cancel:', error);
      }
    }
    setCurrentRequestId(null);
    setIsLoading(false);
  };

  const handleNewConversation = () => {
    setConversation(null);
    setError(null);
    setMessage('');
  };

  const toggleWebSocket = () => {
    const newState = !useWebSocket;
    setUseWebSocket(newState);
    
    if (newState) {
      connectWebSocket();
    } else {
      webSocketService.disconnect();
      setWsConnected(false);
    }
  };

  const getToolEmoji = () => '🔧';

  // Inactive state - show connect button
  if (!isActive) {
    return (
      <div className="flex flex-col h-full p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-800">Spider Chat</h2>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <p className="text-gray-500 mb-4">Connect to Spider to enable chat</p>
            <button
              onClick={onConnectClick}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Connect to Spider
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Active state - show chat interface
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-4 border-b">
        <h2 className="text-lg font-semibold text-gray-800">Spider Chat</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleWebSocket}
            className={`p-2 rounded-lg transition-colors ${
              useWebSocket 
                ? wsConnected 
                  ? 'bg-green-100 text-green-700 hover:bg-green-200' 
                  : 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
            title={useWebSocket ? (wsConnected ? 'WebSocket Connected' : 'Connecting...') : 'Using HTTP'}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              {useWebSocket ? (
                // WebSocket icon
                <path d="M12 2L2 7L12 12L22 7L12 2Z M2 17L12 22L22 17 M2 12L12 17L22 12"/>
              ) : (
                // HTTP icon
                <path d="M21 12H3 M21 6H3 M21 18H3"/>
              )}
            </svg>
          </button>
          <button
            onClick={handleNewConversation}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            title="New Conversation"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 20h9"/>
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
              <path d="M15 5L19 9"/>
            </svg>
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border-b border-red-200">
          <p className="text-red-600 text-sm">{error}</p>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4">
        {conversation?.messages.map((msg, index) => {
          const toolCalls = msg.toolCallsJson ? JSON.parse(msg.toolCallsJson) as ToolCall[] : null;
          const nextMsg = conversation.messages[index + 1];

          return (
            <React.Fragment key={index}>
              {msg.role !== 'tool' && msg.content && msg.content.trim() && (
                <div className={`mb-4 ${msg.role === 'user' ? 'text-right' : 'text-left'}`}>
                  <div 
                    className={`inline-block max-w-[80%] px-4 py-2 rounded-lg ${
                      msg.role === 'user' 
                        ? 'bg-blue-600 text-white' 
                        : 'bg-gray-100 text-gray-800'
                    }`}
                  >
                    {msg.role === 'user' ? (
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                    ) : (
                      <div className="prose prose-sm max-w-none">
                        <ReactMarkdown>
                          {msg.content}
                        </ReactMarkdown>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {toolCalls && toolCalls.map((toolCall, toolIndex) => {
                const isLastMessage = index === conversation.messages.length - 1;
                const isWaitingForResult = isLastMessage && isLoading;

                return (
                  <div key={`tool-${index}-${toolIndex}`} className="mb-2 text-left">
                    <div className="inline-flex items-center gap-2 px-3 py-1 bg-gray-50 rounded-lg text-sm text-gray-600">
                      <span>{getToolEmoji()}</span>
                      <span>{toolCall.tool_name}</span>
                      {isWaitingForResult && (
                        <span className="animate-pulse">...</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </React.Fragment>
          );
        }) || (
          <div className="text-center text-gray-500">
            <p>Start a conversation by typing a message below</p>
          </div>
        )}
        
        {isLoading && conversation && (
          <div className="mb-4 text-left">
            <div className="inline-block px-4 py-2 bg-gray-100 rounded-lg">
              <div className="flex items-center gap-2 text-gray-600">
                <span className="animate-pulse">●</span>
                <span>Thinking...</span>
              </div>
            </div>
          </div>
        )}
        
        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSubmit} className="p-4 border-t">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={isLoading ? "Thinking..." : "Type your message..."}
            disabled={isLoading}
            className="flex-1 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
          />
          {isLoading ? (
            <button
              type="button"
              onClick={handleCancel}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
            >
              Cancel
            </button>
          ) : (
            <button
              type="submit"
              disabled={!message.trim()}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              Send
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
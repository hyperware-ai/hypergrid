import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { webSocketService } from '../services/websocket';
import { WsServerMessage, SpiderMessage, ConversationMetadata, McpServerDetails } from '../types/websocket';

// Types
interface Conversation {
  id: string;
  messages: SpiderMessage[];
  metadata: ConversationMetadata;
  llmProvider: string;
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

const formatMessageContent = (content: SpiderMessage['content']): string => {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if ('Text' in content && typeof content.Text === 'string') {
    return content.Text;
  }
  if ('BaseSixFourAudio' in content) {
    return '[Audio message]';
  }
  if ('Audio' in content) {
    return '[Audio message]';
  }
  return '';
};

// Tool Call Modal Component
function ToolCallModal({ toolCall, toolResult, onClose }: {
  toolCall: ToolCall;
  toolResult?: ToolResult;
  onClose: () => void;
}) {
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      // Could add a toast notification here
    }).catch(err => {
      console.error('Failed to copy:', err);
    });
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b flex items-center justify-between">
          <h3 className="text-lg font-semibold">Tool Call Details: {toolCall.tool_name}</h3>
          <button className="text-gray-500 hover:text-gray-700 text-2xl leading-none" onClick={onClose}>×</button>
        </div>
        <div className="p-4 overflow-y-auto flex-1">
          <div className="mb-6">
            <div className="flex justify-between items-center mb-2">
              <h4 className="text-md font-medium">Tool Call</h4>
              <button
                className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded"
                onClick={() => copyToClipboard(JSON.stringify(toolCall, null, 2))}
                title="Copy to clipboard"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
              </button>
            </div>
            <pre className="bg-gray-50 p-3 rounded overflow-x-auto text-sm">
              {JSON.stringify(toolCall, null, 2)}
            </pre>
          </div>
          {toolResult && (
            <div>
              <div className="flex justify-between items-center mb-2">
                <h4 className="text-md font-medium">Tool Result</h4>
                <button
                  className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded"
                  onClick={() => copyToClipboard(JSON.stringify(toolResult, null, 2))}
                  title="Copy to clipboard"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                  </svg>
                </button>
              </div>
              <pre className="bg-gray-50 p-3 rounded overflow-x-auto text-sm">
                {JSON.stringify(toolResult, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
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
  const [connectedMcpServers, setConnectedMcpServers] = useState<string[]>([]);
  const [selectedToolCall, setSelectedToolCall] = useState<{call: ToolCall, result?: ToolResult} | null>(null);
  const [spiderUnavailable, setSpiderUnavailable] = useState(false);
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

  // Fetch MCP servers when API key is available
  const fetchMcpServers = async (apiKey: string) => {
    try {
      const apiBase = import.meta.env.VITE_BASE_URL || window.location.pathname.replace(/\/$/, '');
      const response = await fetch(`${apiBase}/api/spider-mcp-servers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ apiKey }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.servers) {
          // Filter for connected servers and get their IDs
          const connectedServerIds = data.servers
            .filter((server: any) => server.connected)
            .map((server: any) => server.id);
          setConnectedMcpServers(connectedServerIds);
          console.log('Connected MCP servers:', connectedServerIds);
        }
      }
    } catch (error) {
      console.error('Failed to fetch MCP servers:', error);
    }
  };

  // Connect to WebSocket when API key is available
  useEffect(() => {
    let timer: number | undefined;

    if (spiderApiKey) {
      // Fetch MCP servers
      fetchMcpServers(spiderApiKey);

      if (useWebSocket) {
        // Add a small delay to ensure the component is ready
        timer = window.setTimeout(() => {
          connectWebSocket();
        }, 100);
      }
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

              // Add the new message if we don't have it yet
              const messageExists = updated.messages.some(m =>
                m.timestamp === message.message.timestamp &&
                m.role === message.message.role
              );

              if (!messageExists) {
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
                // Keep the same conversation ID if it exists
                updated.id = message.payload.conversationId || updated.id;

                // If we have allMessages, they contain all the assistant's messages including tool calls
                if (message.payload.allMessages && message.payload.allMessages.length > 0) {
                  // Find the last user message index
                  let lastUserMessageIndex = -1;
                  for (let i = updated.messages.length - 1; i >= 0; i--) {
                    if (updated.messages[i].role === 'user') {
                      lastUserMessageIndex = i;
                      break;
                    }
                  }

                  // Replace everything after the last user message with the complete response
                  if (lastUserMessageIndex >= 0) {
                    updated.messages = [
                      ...updated.messages.slice(0, lastUserMessageIndex + 1),
                      ...message.payload.allMessages
                    ];
                  } else {
                    // If no user message found, append all messages
                    updated.messages.push(...message.payload.allMessages);
                  }
                } else if (message.payload.response) {
                  // Just add the final response if not already present
                  const lastMsg = updated.messages[updated.messages.length - 1];
                  if (!lastMsg || lastMsg.role !== 'assistant' || !lastMsg.content) {
                    updated.messages.push(message.payload.response);
                  } else {
                    // Update the last assistant message with final content
                    updated.messages[updated.messages.length - 1] = message.payload.response;
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
            // Only log, don't show "Processing iteration" messages in UI
            if (message.message && !message.message.includes('Processing iteration')) {
              console.log('Status:', message.status, message.message);
            }
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

      // Check if it's a timeout or connection error (Spider not installed)
      if (error.message?.includes('timeout') ||
          (error.name === 'TypeError' && error.message?.includes('Failed to fetch'))) {
        console.error('Cannot reach Spider service - may not be installed');
        setWsConnected(false);
        setUseWebSocket(false);
        setError('Cannot reach Spider service. Is Spider installed?');
        setSpiderUnavailable(true);
        return;
      }

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
          const apiBase = import.meta.env.VITE_BASE_URL || window.location.pathname.replace(/\/$/, '');
          const response = await fetch(`${apiBase}/api/spider-connect`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ force_new: true }), // Force creation of a new key
            signal: AbortSignal.timeout(5000) // 5 second timeout
          });
          const data = await response.json();

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

          // Check if the refresh failed due to timeout (Spider not available)
          if (refreshError.name === 'AbortError' || refreshError.message?.includes('timeout')) {
            setSpiderUnavailable(true);
            setError('Cannot reach Spider service. Is Spider installed?');
          } else {
            setError('Failed to refresh API key. Falling back to HTTP.');
          }

          setWsConnected(false);
          setUseWebSocket(false);
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
      // Continue existing conversation or create new one
      let updatedConversation = conversation ? {
        ...conversation,
        mcpServers: connectedMcpServers, // Update MCP servers in case they changed
      } : {
        id: '',
        messages: [],
        metadata: {
          startTime: new Date().toISOString(),
          client: 'operator-ui',
          fromStt: false,
        },
        llmProvider: 'anthropic',
        mcpServers: connectedMcpServers,
      };

      // Model is sent separately in the chat payload, not part of Conversation
      const model = 'claude-sonnet-4-20250514';

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
          model,  // Pass model separately
          updatedConversation.mcpServers,
          updatedConversation.metadata,
          updatedConversation.id // Pass conversation ID to continue existing conversation
        );
        // WebSocket responses will be handled by the message handler
        return;
      }
      console.log('Falling back to HTTP');

      // Fallback to HTTP
      const apiBase = import.meta.env.VITE_BASE_URL || window.location.pathname.replace(/\/$/, '');
      const response = await fetch(`${apiBase}/api/spider-chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          apiKey: spiderApiKey,
          messages: updatedConversation.messages,
          llmProvider: updatedConversation.llmProvider,
          model: model,  // Pass model separately
          metadata: updatedConversation.metadata,
          mcpServers: updatedConversation.mcpServers,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to send message: ${response.statusText}`);
      }

      const data = await response.json();

      // Only update if this request hasn't been cancelled
      if (currentRequestId === requestId) {
        // Update conversation with response
        if (data.conversationId) {
          updatedConversation.id = data.conversationId;
        }

        if (data.allMessages && data.allMessages.length > 0) {
          updatedConversation.messages.push(...data.allMessages);
        } else if (data.response) {
          updatedConversation.messages.push(data.response);
        }

        setConversation({ ...updatedConversation });

        // If the API key was refreshed, update it in the parent component
        if (data.refreshedApiKey && onApiKeyRefreshed) {
          onApiKeyRefreshed(data.refreshedApiKey);
          // Reconnect WebSocket with new key
          if (useWebSocket) {
            await connectWebSocket();
          }
        }
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


  const getToolEmoji = () => '🔧';

  // Check Spider availability when attempting to connect
  const handleConnectWithTimeout = async () => {
    try {
      // Set a timeout for the connection attempt
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000); // 5 second timeout

      const apiBase = import.meta.env.VITE_BASE_URL || window.location.pathname.replace(/\/$/, '');
      const response = await fetch(`${apiBase}/api/spider-status`, {
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (response.ok) {
        setSpiderUnavailable(false);
        onConnectClick();
      } else {
        setSpiderUnavailable(true);
      }
    } catch (error: any) {
      if (error.name === 'AbortError' || error.message?.includes('timeout')) {
        setSpiderUnavailable(true);
      } else {
        console.error('Error checking Spider status:', error);
        setSpiderUnavailable(true);
      }
    }
  };

  // Inactive state - show connect button or unavailable message
  if (!isActive || spiderUnavailable) {
    return (
      <div className="flex flex-col h-full p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-400">Spider Chat</h2>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            {spiderUnavailable ? (
              <>
                <p className="text-gray-500 mb-2">Could not contact Spider</p>
                <p className="text-gray-400 text-sm">Is Spider installed?</p>
              </>
            ) : (
              <>
                <p className="text-gray-500 mb-4">Connect to Spider to enable chat and test out the Hypergrid tools</p>
                <button
                  onClick={handleConnectWithTimeout}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Connect to Spider
                </button>
              </>
            )}
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
          <div
            className={`p-2 rounded-lg cursor-default ${
              useWebSocket
                ? wsConnected
                  ? 'bg-green-100 text-green-700'
                  : 'bg-yellow-100 text-yellow-700'
                : 'bg-gray-100 text-gray-700'
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
          </div>
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
          const toolResults = nextMsg?.role === 'tool' && nextMsg.toolResultsJson
            ? JSON.parse(nextMsg.toolResultsJson) as ToolResult[]
            : null;
          const displayContent = formatMessageContent(msg.content);
          const trimmedContent = displayContent.trim();
          const shouldShowMessage =
            msg.role !== 'tool' &&
            trimmedContent.length > 0 &&
            !displayContent.includes('Processing iteration') &&
            !displayContent.includes('[Tool calls pending]') &&
            !displayContent.includes('Executing tool calls');

          return (
            <React.Fragment key={index}>
              {shouldShowMessage && (
                <div className={`mb-4 ${msg.role === 'user' ? 'text-right' : 'text-left'}`}>
                  <div
                    className={`inline-block max-w-[80%] px-4 py-2 rounded-lg ${
                      msg.role === 'user'
                        ? 'bg-blue-600 text-white text-left'
                        : 'bg-gray-100 text-gray-800'
                    }`}
                    style={{
                      wordWrap: 'break-word',
                      overflowWrap: 'break-word',
                      wordBreak: 'break-word'
                    }}
                  >
                    {msg.role === 'user' ? (
                      <p className="whitespace-pre-wrap break-words">{displayContent}</p>
                    ) : (
                      <div className="prose prose-sm max-w-none break-words">
                        <ReactMarkdown>
                          {displayContent || ''}
                        </ReactMarkdown>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {toolCalls && toolCalls.map((toolCall, toolIndex) => {
                const isLastMessage = index === conversation.messages.length - 1;
                const toolResult = toolResults?.find(r => r.tool_call_id === toolCall.id);
                const isWaitingForResult = isLastMessage && isLoading && !toolResult;

                return (
                  <div key={`tool-${index}-${toolIndex}`} className="mb-2 text-left">
                    <div className="inline-flex items-center gap-2 px-3 py-1 bg-gray-50 rounded-lg text-sm text-gray-600">
                      <span>{getToolEmoji()}</span>
                      {isWaitingForResult ? (
                        <>
                          <span>{toolCall.tool_name}</span>
                          <span className="animate-pulse">...</span>
                        </>
                      ) : (
                        <button
                          className="hover:underline cursor-pointer"
                          onClick={() => setSelectedToolCall({ call: toolCall, result: toolResult })}
                        >
                          {toolCall.tool_name}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </React.Fragment>
          );
        }) || (
          <div className="text-center text-gray-500">
            <p>Use this chat window to test out searching for and calling Hypergrid providers!</p>
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

      {selectedToolCall && (
        <ToolCallModal
          toolCall={selectedToolCall.call}
          toolResult={selectedToolCall.result}
          onClose={() => setSelectedToolCall(null)}
        />
      )}

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

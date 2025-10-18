# Chat Interface with useChat Hook

## Overview

The `useChat` hook provides everything needed to build a chat interface:
- Message state management
- Streaming support
- Loading states
- Error handling
- Tool call observability

## Basic Usage

```typescript
'use client';
import { useChat } from 'ai/react';

export default function Chat() {
  const { messages, input, handleInputChange, handleSubmit } = useChat();

  return (
    <div>
      {/* Display messages */}
      {messages.map(m => (
        <div key={m.id}>{m.role}: {m.content}</div>
      ))}

      {/* Input form */}
      <form onSubmit={handleSubmit}>
        <input value={input} onChange={handleInputChange} />
        <button type="submit">Send</button>
      </form>
    </div>
  );
}
```

## useChat API Reference

### Import

```typescript
import { useChat } from 'ai/react';
```

### Parameters

```typescript
const chat = useChat({
  // API endpoint (default: '/api/chat')
  api: '/api/agent',

  // Initial messages
  initialMessages: [],

  // Unique chat ID (for persistence)
  id: 'chat-1',

  // Called when tool is invoked
  onToolCall: ({ toolCall }) => {
    console.log('Tool called:', toolCall.toolName);
  },

  // Called when response finishes
  onFinish: (message) => {
    console.log('Finished:', message.content);
  },

  // Called on error
  onError: (error) => {
    console.error('Error:', error);
  },

  // Custom headers
  headers: {
    'Custom-Header': 'value',
  },

  // Custom body (merged with messages)
  body: {
    customData: 'value',
  },
});
```

### Return Values

```typescript
const {
  // Current messages
  messages: Message[],

  // Current input value
  input: string,

  // Chat status
  status: 'ready' | 'submitted' | 'streaming' | 'error',

  // Is currently loading
  isLoading: boolean,

  // Current error
  error: Error | undefined,

  // Update input value
  setInput: (value: string) => void,

  // Handle input change
  handleInputChange: (e: ChangeEvent<HTMLInputElement>) => void,

  // Submit message
  handleSubmit: (e: FormEvent) => void,

  // Send message programmatically
  sendMessage: (content: string) => void,

  // Reload last assistant message
  reload: () => void,

  // Stop current generation
  stop: () => void,

  // Add tool result
  addToolResult: (options: {
    toolCallId: string;
    result: any;
  }) => void,
} = useChat();
```

## Message Object Structure

```typescript
type Message = {
  id: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
  createdAt?: Date;

  // Tool invocations (when agent uses tools)
  toolInvocations?: ToolInvocation[];

  // Custom metadata
  metadata?: Record<string, any>;
};

type ToolInvocation = {
  state: 'call' | 'result' | 'partial-call';
  toolCallId: string;
  toolName: string;
  args: any;
  result?: any;
};
```

## Displaying Messages

### Basic Message Display

```typescript
{messages.map(message => (
  <div key={message.id} className={message.role}>
    <strong>{message.role}:</strong> {message.content}
  </div>
))}
```

### With User/Assistant Styling

```typescript
{messages.map(message => (
  <div
    key={message.id}
    className={message.role === 'user' ? 'user-message' : 'assistant-message'}
  >
    <div className="role">{message.role === 'user' ? 'You' : 'Agent'}</div>
    <div className="content">{message.content}</div>
  </div>
))}
```

### With Tool Invocations (Observability)

```typescript
{messages.map(message => (
  <div key={message.id}>
    <div>{message.content}</div>

    {/* Show tool calls */}
    {message.toolInvocations?.map((tool, idx) => (
      <div key={idx} className="tool-call">
        <div className="tool-name">🔧 {tool.toolName}</div>
        <div className="tool-args">Args: {JSON.stringify(tool.args)}</div>
        {tool.result && (
          <div className="tool-result">
            ✓ Result: {JSON.stringify(tool.result)}
          </div>
        )}
      </div>
    ))}
  </div>
))}
```

## Loading States

### Show "Typing" Indicator

```typescript
{isLoading && (
  <div className="typing-indicator">
    <span>Agent is thinking</span>
    <span className="animate-pulse">...</span>
  </div>
)}
```

### Disable Input While Loading

```typescript
<button type="submit" disabled={isLoading}>
  {isLoading ? 'Sending...' : 'Send'}
</button>
```

### Show Status

```typescript
<div className="status">
  Status: {status}
  {/* 'ready' | 'submitted' | 'streaming' | 'error' */}
</div>
```

## Error Handling

### Display Error Message

```typescript
{error && (
  <div className="error">
    <strong>Error:</strong> {error.message}
    <button onClick={() => reload()}>Retry</button>
  </div>
)}
```

### Error Callback

```typescript
const { messages } = useChat({
  onError: (error) => {
    console.error('Chat error:', error);

    // Show toast notification
    toast.error(error.message);

    // Log to error tracking
    logError(error);
  },
});
```

## Advanced Features

### Auto-scroll to Bottom

```typescript
import { useEffect, useRef } from 'react';

export default function Chat() {
  const { messages } = useChat();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="messages">
      {messages.map(m => <Message key={m.id} message={m} />)}
      <div ref={messagesEndRef} />
    </div>
  );
}
```

### Message Timestamps

```typescript
{messages.map(message => (
  <div key={message.id}>
    <div>{message.content}</div>
    {message.createdAt && (
      <div className="timestamp">
        {new Date(message.createdAt).toLocaleTimeString()}
      </div>
    )}
  </div>
))}
```

### Stop Generation

```typescript
const { stop, isLoading } = useChat();

return (
  <div>
    {isLoading && (
      <button onClick={stop}>Stop Generating</button>
    )}
  </div>
);
```

### Regenerate Response

```typescript
const { reload } = useChat();

return (
  <button onClick={reload}>
    Regenerate Last Response
  </button>
);
```

### Send Message Programmatically

```typescript
const { sendMessage } = useChat();

// Send without form submission
const handleQuickAction = () => {
  sendMessage('List all my Podio organizations');
};

return (
  <button onClick={handleQuickAction}>
    Quick: List Organizations
  </button>
);
```

## Complete Example for Podio Agent

```typescript
'use client';

import { useChat } from 'ai/react';
import { useEffect, useRef } from 'react';

export default function PodioAgentChat() {
  const {
    messages,
    input,
    handleInputChange,
    handleSubmit,
    isLoading,
    error,
    reload,
    stop,
  } = useChat({
    api: '/api/agent',
    onToolCall: ({ toolCall }) => {
      console.log(`[Tool] ${toolCall.toolName}`, toolCall.args);
    },
    onFinish: (message) => {
      console.log('[Finished]', message.content);
    },
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="flex flex-col h-screen max-w-4xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">Podio Migration Agent</h1>

      {/* Messages Container */}
      <div className="flex-1 overflow-y-auto space-y-4 mb-4">
        {messages.map(message => (
          <div
            key={message.id}
            className={`p-4 rounded-lg ${
              message.role === 'user'
                ? 'bg-blue-100 ml-auto max-w-[80%]'
                : 'bg-gray-100 mr-auto max-w-[80%]'
            }`}
          >
            <div className="font-semibold mb-1">
              {message.role === 'user' ? 'You' : 'Agent'}
            </div>

            <div className="whitespace-pre-wrap">{message.content}</div>

            {/* Tool Invocations */}
            {message.toolInvocations?.map((tool, idx) => (
              <div key={idx} className="mt-2 p-2 bg-white rounded text-sm">
                <div className="font-mono text-green-600">
                  🔧 {tool.toolName}
                </div>
                <div className="text-gray-600 text-xs mt-1">
                  {JSON.stringify(tool.args, null, 2)}
                </div>
                {tool.result && (
                  <div className="text-blue-600 text-xs mt-1">
                    ✓ Completed
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}

        {isLoading && (
          <div className="bg-gray-100 p-4 rounded-lg max-w-[80%]">
            <div className="flex items-center gap-2">
              <div className="animate-pulse">Agent is working...</div>
              <button
                onClick={stop}
                className="text-sm text-red-600 hover:underline"
              >
                Stop
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="bg-red-100 p-4 rounded-lg">
            <div className="font-semibold text-red-800">Error</div>
            <div className="text-red-600">{error.message}</div>
            <button
              onClick={reload}
              className="mt-2 text-sm text-red-600 hover:underline"
            >
              Retry
            </button>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Form */}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          value={input}
          onChange={handleInputChange}
          placeholder="Ask me to migrate Podio workflows..."
          className="flex-1 p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          disabled={isLoading}
        />
        <button
          type="submit"
          disabled={isLoading}
          className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400"
        >
          {isLoading ? 'Sending...' : 'Send'}
        </button>
      </form>
    </div>
  );
}
```

## Styling Tips

### Markdown Support

```bash
npm install react-markdown
```

```typescript
import ReactMarkdown from 'react-markdown';

{messages.map(message => (
  <div key={message.id}>
    <ReactMarkdown>{message.content}</ReactMarkdown>
  </div>
))}
```

### Code Highlighting

```bash
npm install react-syntax-highlighter
```

```typescript
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';

<ReactMarkdown
  components={{
    code({ node, inline, className, children, ...props }) {
      const match = /language-(\w+)/.exec(className || '');
      return !inline && match ? (
        <SyntaxHighlighter language={match[1]}>
          {String(children)}
        </SyntaxHighlighter>
      ) : (
        <code className={className} {...props}>
          {children}
        </code>
      );
    },
  }}
>
  {message.content}
</ReactMarkdown>
```

## Best Practices

1. **Always show tool calls** - Users should see what agent is doing
2. **Handle errors gracefully** - Provide retry button
3. **Auto-scroll to bottom** - Keep latest message visible
4. **Disable input while loading** - Prevent duplicate submissions
5. **Show loading state** - Users should know agent is working
6. **Add stop button** - Allow canceling long operations
7. **Use proper ARIA labels** - For accessibility

## Common Patterns

### Suggested Prompts

```typescript
const suggestions = [
  'List my Podio organizations',
  'Show apps in workspace X',
  'Migrate workflows from space A to space B',
];

return (
  <div className="suggestions">
    {suggestions.map(prompt => (
      <button
        key={prompt}
        onClick={() => sendMessage(prompt)}
        className="suggestion-button"
      >
        {prompt}
      </button>
    ))}
  </div>
);
```

### Clear Chat

```typescript
const { setMessages } = useChat();

const clearChat = () => {
  if (confirm('Clear chat history?')) {
    setMessages([]);
  }
};
```

### Save/Load Chat History

```typescript
// Save to localStorage
useEffect(() => {
  localStorage.setItem('chat-history', JSON.stringify(messages));
}, [messages]);

// Load from localStorage
const initialMessages = JSON.parse(
  localStorage.getItem('chat-history') || '[]'
);

const chat = useChat({ initialMessages });
```

## Next Steps

- **Backend**: See `04-streamtext-api.md` for API route setup
- **Tools**: See `05-tool-calling.md` to add Podio operations
- **Agents**: See `07-agents.md` for multi-step workflows

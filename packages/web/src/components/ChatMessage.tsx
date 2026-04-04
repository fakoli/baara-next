import type { ChatMessage as ChatMessageType } from '../types.ts';
import ToolIndicator from './ToolIndicator.tsx';
import InlineCard from './InlineCard.tsx';
import { useChatStore } from '../stores/chat-store.ts';

interface ChatMessageProps {
  message: ChatMessageType;
}

export default function ChatMessage({ message }: ChatMessageProps) {
  const { sendMessage } = useChatStore();
  const isUser = message.role === 'user';

  function handleCardAction(action: string, id: string) {
    // Card actions post a follow-up message to keep the interaction unified
    const actionMessages: Record<string, string> = {
      run:    `Run task ${id} now`,
      edit:   `Edit task ${id}`,
      toggle: `Toggle task ${id}`,
      retry:  `Retry execution ${id}`,
      cancel: `Cancel execution ${id}`,
      view:   `Show details for execution ${id}`,
    };
    const msg = actionMessages[action];
    if (msg) void sendMessage(msg);
  }

  function handleHitlRespond(requestId: string, response: string) {
    void sendMessage(`Respond to input request ${requestId} with: ${response}`);
  }

  if (isUser) {
    return (
      <div
        style={{
          display: 'flex',
          gap: 10,
          maxWidth: 680,
          alignSelf: 'flex-end',
          flexDirection: 'row-reverse',
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 11,
            fontWeight: 600,
            flexShrink: 0,
            marginTop: 2,
            background: 'var(--bg-active)',
            color: 'var(--text-secondary)',
            border: '1px solid var(--border)',
          }}
        >
          You
        </div>
        <div
          style={{
            padding: '10px 14px',
            borderRadius: 12,
            borderTopRightRadius: 4,
            fontSize: 13.5,
            lineHeight: 1.55,
            background: 'var(--accent)',
            color: 'white',
          }}
        >
          {message.text}
        </div>
      </div>
    );
  }

  // Agent message
  return (
    <div
      style={{
        display: 'flex',
        gap: 10,
        maxWidth: 680,
        alignSelf: 'flex-start',
      }}
    >
      {/* Agent avatar */}
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 11,
          fontWeight: 600,
          flexShrink: 0,
          marginTop: 2,
          background: 'var(--accent)',
          color: 'white',
        }}
      >
        B
      </div>

      {/* Content column */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Tool call indicators */}
        {message.toolCalls.map((tc, i) => (
          <ToolIndicator
            key={i}
            name={tc.name}
            detail={extractToolDetail(tc)}
            completed={tc.output !== null}
          />
        ))}

        {/* Inline cards for tool results */}
        {message.toolCalls
          .filter((tc) => tc.output !== null)
          .map((tc, i) => (
            <InlineCard
              key={i}
              data={tc.output}
              onAction={handleCardAction}
              onHitlRespond={handleHitlRespond}
            />
          ))}

        {/* Text bubble */}
        {message.text && (
          <div
            style={{
              padding: '10px 14px',
              borderRadius: 12,
              borderTopLeftRadius: 4,
              fontSize: 13.5,
              lineHeight: 1.55,
              color: 'var(--text-primary)',
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              marginTop: message.toolCalls.length > 0 ? 8 : 0,
            }}
            className={message.streaming && !message.text.endsWith(' ') ? 'streaming-cursor' : ''}
          >
            {message.text}
          </div>
        )}

        {/* Streaming empty state */}
        {message.streaming && !message.text && message.toolCalls.length === 0 && (
          <div
            style={{
              padding: '10px 14px',
              borderRadius: 12,
              borderTopLeftRadius: 4,
              fontSize: 13.5,
              lineHeight: 1.55,
              color: 'var(--text-muted)',
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <div className="streaming-cursor" style={{ display: 'inline-block', width: 4 }} />
          </div>
        )}
      </div>
    </div>
  );
}

/** Extract a short human-readable detail label from a tool call's input */
function extractToolDetail(tc: { name: string; input: Record<string, unknown> }): string | undefined {
  const input = tc.input;
  // Common patterns: name, id, task_name, task_id
  const nameKey = ['name', 'task_name', 'id', 'task_id', 'execution_id'].find(
    (k) => typeof input[k] === 'string'
  );
  if (nameKey) return String(input[nameKey]);
  return undefined;
}

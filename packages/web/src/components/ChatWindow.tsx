import { useEffect, useRef } from 'react';
import { useChatStore } from '../stores/chat-store.ts';
import ChatMessage from './ChatMessage.tsx';
import ChatInput from './ChatInput.tsx';

export default function ChatWindow() {
  const { messages } = useChatStore();
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-deep)',
        minWidth: 0,
        overflow: 'hidden',
      }}
    >
      {/* Messages area */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '20px 24px',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        {messages.length === 0 && <EmptyState />}
        {messages.map((msg) => (
          <ChatMessage key={msg.id} message={msg} />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <ChatInput />
    </div>
  );
}

function EmptyState() {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '60px 24px',
        gap: 12,
        textAlign: 'center',
      }}
    >
      <div
        style={{
          width: 48,
          height: 48,
          background: 'var(--accent-glow)',
          border: '1px solid rgba(99,102,241,0.3)',
          borderRadius: 12,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--accent)"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M13 10V3L4 14h7v7l9-11h-7z"
          />
        </svg>
      </div>
      <div>
        <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
          BAARA Next
        </p>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', maxWidth: 360 }}>
          Describe a task in natural language and I'll create, run, and monitor it for you.
          You have access to 27 tools for full control of your task execution engine.
        </p>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', marginTop: 8 }}>
        {[
          'Create a health check task',
          'List running executions',
          'What failed in the last hour?',
          'Show queue status',
        ].map((hint) => (
          <SuggestionChip key={hint} text={hint} />
        ))}
      </div>
    </div>
  );
}

function SuggestionChip({ text }: { text: string }) {
  const { sendMessage } = useChatStore();
  return (
    <button
      onClick={() => void sendMessage(text)}
      style={{
        background: 'var(--bg-raised)',
        border: '1px solid var(--border)',
        borderRadius: 20,
        padding: '6px 14px',
        fontSize: 12,
        color: 'var(--text-secondary)',
        cursor: 'pointer',
        transition: 'all 0.12s',
        fontFamily: 'var(--font-body)',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--accent)';
        (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-primary)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)';
        (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-secondary)';
      }}
    >
      {text}
    </button>
  );
}

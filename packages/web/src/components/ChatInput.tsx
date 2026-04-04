import { useRef, useEffect } from 'react';
import { useChatStore } from '../stores/chat-store.ts';

interface ChatInputProps {
  toolCount?: number;
}

export default function ChatInput({ toolCount = 27 }: ChatInputProps) {
  const { streaming, sessionCostUsd, sendMessage } = useChatStore();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Auto-resize textarea
  function autoResize() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }

  useEffect(() => {
    if (!streaming) textareaRef.current?.focus();
  }, [streaming]);

  // Abort any in-flight request when the component unmounts.
  useEffect(() => () => { abortRef.current?.abort(); }, []);

  function handleSend() {
    const el = textareaRef.current;
    const text = el?.value.trim();
    if (!text || streaming) return;

    if (el) {
      el.value = '';
      el.style.height = 'auto';
    }

    abortRef.current = new AbortController();
    void sendMessage(text, abortRef.current.signal);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div
      style={{
        padding: '12px 20px 16px',
        borderTop: '1px solid var(--border-subtle)',
        background: 'var(--bg-surface)',
        flexShrink: 0,
      }}
    >
      {/* Input row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: 8,
          background: 'var(--bg-raised)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          padding: '8px 12px',
          transition: 'border-color 0.15s',
        }}
        onFocusCapture={(e) => {
          (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--accent)';
        }}
        onBlurCapture={(e) => {
          (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border)';
        }}
      >
        <textarea
          ref={textareaRef}
          rows={1}
          placeholder="Message BAARA Next..."
          disabled={streaming}
          onInput={autoResize}
          onKeyDown={handleKeyDown}
          style={{
            flex: 1,
            background: 'none',
            border: 'none',
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-body)',
            fontSize: 13.5,
            outline: 'none',
            resize: 'none',
            lineHeight: 1.4,
            minHeight: 20,
            maxHeight: 120,
            overflowY: 'auto',
          }}
        />
        <button
          onClick={handleSend}
          disabled={streaming}
          style={{
            width: 30,
            height: 30,
            background: streaming ? 'var(--bg-active)' : 'var(--accent)',
            border: 'none',
            borderRadius: 8,
            color: 'white',
            cursor: streaming ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            opacity: streaming ? 0.5 : 1,
            transition: 'opacity 0.12s',
          }}
          title="Send message"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>

      {/* Meta row */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 6,
          padding: '0 4px',
        }}
      >
        <div style={{ display: 'flex', gap: 10, fontSize: 11, color: 'var(--text-muted)' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span
              style={{
                width: 5,
                height: 5,
                background: 'var(--green)',
                borderRadius: '50%',
                display: 'inline-block',
              }}
            />
            {toolCount} tools
          </span>
          <span>·</span>
          <span>sonnet 4.6</span>
        </div>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          ${sessionCostUsd.toFixed(2)} this session
        </span>
      </div>
    </div>
  );
}

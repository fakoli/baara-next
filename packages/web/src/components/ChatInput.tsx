import { useRef, useEffect, useState } from 'react';
import { useChatStore } from '../stores/chat-store.ts';
import type { PermissionMode } from '../types.ts';

interface ChatInputProps {
  toolCount?: number;
}

// Ordered cycle: auto -> ask -> locked -> auto
const PERMISSION_MODES: PermissionMode[] = ['auto', 'ask', 'locked'];

// ---------------------------------------------------------------------------
// System Instructions presets
// ---------------------------------------------------------------------------

const SYSTEM_PRESETS: { label: string; value: string }[] = [
  { label: 'Default', value: '' },
  {
    label: 'Concise responses',
    value: 'Be as concise as possible. Skip preamble. Answer directly.',
  },
  {
    label: 'Detailed explanations',
    value: 'Explain your reasoning step by step. Include examples where helpful.',
  },
  {
    label: 'Code-focused',
    value: 'Prefer code over prose. Show working code snippets with comments.',
  },
];

const PERMISSION_MODE_CONFIG: Record<
  PermissionMode,
  { label: string; dotColor: string; title: string }
> = {
  auto: {
    label: 'Auto',
    dotColor: '#22c55e',
    title: 'Auto mode: all tools execute immediately',
  },
  ask: {
    label: 'Ask',
    dotColor: '#eab308',
    title: 'Ask mode: tools require approval before executing',
  },
  locked: {
    label: 'Locked',
    dotColor: '#ef4444',
    title: 'Locked mode: only previously-approved tools can execute',
  },
};

export default function ChatInput({ toolCount = 27 }: ChatInputProps) {
  const { streaming, sessionCostUsd, sendMessage, permissionMode, setPermissionMode, systemInstructions, setSystemInstructions } = useChatStore();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [sysInstrOpen, setSysInstrOpen] = useState(false);
  const [draftInstructions, setDraftInstructions] = useState(systemInstructions);
  const popoverRef = useRef<HTMLDivElement>(null);

  function cyclePermissionMode() {
    const idx = PERMISSION_MODES.indexOf(permissionMode);
    const next = PERMISSION_MODES[(idx + 1) % PERMISSION_MODES.length]!;
    setPermissionMode(next);
  }

  const modeConfig = PERMISSION_MODE_CONFIG[permissionMode];
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

  // Sync draft text when the popover opens
  useEffect(() => {
    if (sysInstrOpen) setDraftInstructions(systemInstructions);
  }, [sysInstrOpen, systemInstructions]);

  // Close popover on outside click
  useEffect(() => {
    if (!sysInstrOpen) return;
    function handleClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setSysInstrOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [sysInstrOpen]);

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
          position: 'relative',
        }}
      >
        <div style={{ display: 'flex', gap: 10, fontSize: 11, color: 'var(--text-muted)', alignItems: 'center' }}>
          {/* Permission mode toggle */}
          <button
            onClick={cyclePermissionMode}
            title={modeConfig.title}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              background: 'var(--bg-active)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: '2px 8px',
              cursor: 'pointer',
              fontSize: 11,
              color: 'var(--text-secondary)',
              fontFamily: 'var(--font-body)',
              transition: 'border-color 0.12s',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--accent)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)';
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                background: modeConfig.dotColor,
                borderRadius: '50%',
                display: 'inline-block',
                flexShrink: 0,
              }}
            />
            <span>{modeConfig.label}</span>
            <span style={{ opacity: 0.5, fontSize: 9 }}>▾</span>
          </button>

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
          {/* Model selector */}
          <select
            value={useChatStore.getState().model ?? 'claude-sonnet-4-20250514'}
            onChange={(e) => useChatStore.getState().setModel(e.target.value)}
            style={{
              background: 'var(--bg-active)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: '1px 4px',
              color: 'var(--text-secondary)',
              fontSize: 11,
              fontFamily: 'var(--font-body)',
              cursor: 'pointer',
              outline: 'none',
            }}
            title="Select Claude model for chat"
          >
            <option value="claude-sonnet-4-20250514">sonnet 4.6</option>
            <option value="claude-opus-4-20250514">opus 4.6</option>
            <option value="claude-haiku-4-20250414">haiku 4.5</option>
          </select>
          <span>·</span>

          {/* System Instructions button */}
          <div style={{ position: 'relative' }} ref={popoverRef}>
            <button
              onClick={() => setSysInstrOpen((o) => !o)}
              title="System Instructions"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                background: systemInstructions ? 'rgba(99,102,241,0.12)' : 'var(--bg-active)',
                border: `1px solid ${systemInstructions ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: 6,
                padding: '2px 8px',
                cursor: 'pointer',
                fontSize: 11,
                color: systemInstructions ? 'var(--accent)' : 'var(--text-secondary)',
                fontFamily: 'var(--font-body)',
                transition: 'border-color 0.12s',
              }}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
              System
              <span style={{ opacity: 0.5, fontSize: 9 }}>▾</span>
            </button>

            {sysInstrOpen && (
              <div
                style={{
                  position: 'absolute',
                  bottom: 'calc(100% + 6px)',
                  left: 0,
                  width: 320,
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 10,
                  padding: 12,
                  zIndex: 50,
                  boxShadow: '0 4px 24px rgba(0,0,0,0.25)',
                }}
              >
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>
                  System Instructions
                </div>

                {/* Presets */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
                  {SYSTEM_PRESETS.map((preset) => (
                    <button
                      key={preset.label}
                      onClick={() => setDraftInstructions(preset.value)}
                      style={{
                        fontSize: 10,
                        padding: '2px 8px',
                        background: draftInstructions === preset.value ? 'var(--accent)' : 'var(--bg-active)',
                        border: `1px solid ${draftInstructions === preset.value ? 'var(--accent)' : 'var(--border)'}`,
                        borderRadius: 4,
                        color: draftInstructions === preset.value ? 'white' : 'var(--text-secondary)',
                        cursor: 'pointer',
                        fontFamily: 'var(--font-body)',
                        transition: 'all 0.1s',
                      }}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>

                {/* Text area */}
                <textarea
                  value={draftInstructions}
                  onChange={(e) => setDraftInstructions(e.target.value)}
                  rows={4}
                  placeholder="Custom directives prepended to every system prompt..."
                  style={{
                    width: '100%',
                    background: 'var(--bg-raised)',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    padding: '6px 8px',
                    color: 'var(--text-primary)',
                    fontFamily: 'var(--font-body)',
                    fontSize: 12,
                    outline: 'none',
                    resize: 'vertical',
                    minHeight: 80,
                    boxSizing: 'border-box',
                  }}
                />

                {/* Actions */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 8 }}>
                  <button
                    onClick={() => setSysInstrOpen(false)}
                    style={{
                      padding: '3px 10px',
                      background: 'transparent',
                      border: '1px solid var(--border)',
                      borderRadius: 5,
                      color: 'var(--text-secondary)',
                      fontSize: 11,
                      cursor: 'pointer',
                      fontFamily: 'var(--font-body)',
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      setSystemInstructions(draftInstructions);
                      setSysInstrOpen(false);
                    }}
                    style={{
                      padding: '3px 10px',
                      background: 'var(--accent)',
                      border: 'none',
                      borderRadius: 5,
                      color: 'white',
                      fontSize: 11,
                      cursor: 'pointer',
                      fontFamily: 'var(--font-body)',
                    }}
                  >
                    Save
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          ${sessionCostUsd.toFixed(2)} this session
        </span>
      </div>
    </div>
  );
}

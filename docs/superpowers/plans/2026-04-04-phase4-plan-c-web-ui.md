# Plan C: Web UI Rewrite

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Complete rewrite of `packages/web` to the chat-centric three-zone layout described in the Phase 4 design spec: left thread sidebar, center SSE chat window, right tabbed control panel, collapsible on both sides.

**Architecture:** React + Zustand + Tailwind + Pretext. Three Zustand stores (`thread-store`, `chat-store`, updated `execution-store`). Pretext used for variable-height message, log, and event rendering. Dark CSS-variable theme.

**Tech Stack:** React 18, Vite, Zustand, Tailwind, `@chenglou/pretext`, TypeScript

**Depends on:** Plan B (chat SSE endpoint) must be complete and returning events before the UI can be tested end-to-end. The UI can be built in parallel but integration testing requires Plan B.

---

### Task 1: Install Pretext and add Google Fonts

**Files:**
- Modify: `packages/web/package.json`
- Modify: `packages/web/index.html`

- [ ] **Step 1: Add `@chenglou/pretext` as a dependency.** Run from `packages/web`:

```bash
bun add @chenglou/pretext
```

- [ ] **Step 2: Add DM Sans and JetBrains Mono to `index.html`.** Insert inside `<head>` before the existing `<link>` tags:

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link
  href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600&family=JetBrains+Mono:wght@400;500&display=swap"
  rel="stylesheet"
/>
```

---

### Task 2: Set up CSS variables and global dark theme

**Files:**
- Rewrite: `packages/web/src/index.css`

- [ ] **Step 1: Replace all existing CSS with the dark token system.**

```css
/* BAARA Next — global styles and design tokens */

@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  /* Backgrounds */
  --bg-deep:    #0a0a12;
  --bg-surface: #111119;
  --bg-raised:  #1a1a25;
  --bg-hover:   #22223a;

  /* Accent */
  --accent:     #6366f1;
  --accent-dim: #4f52c9;

  /* Semantic status */
  --green:      #22c55e;
  --yellow:     #eab308;
  --red:        #ef4444;
  --blue:       #3b82f6;

  /* Text */
  --text-primary:   #f0f0f8;
  --text-secondary: #9090a8;
  --text-muted:     #5050688;

  /* Borders */
  --border:      rgba(255, 255, 255, 0.08);
  --border-soft: rgba(255, 255, 255, 0.04);

  /* Fonts */
  --font-body: 'DM Sans', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', monospace;

  /* Transitions */
  --transition-panel: 200ms ease;
  --transition-hover: 120ms ease;
}

*, *::before, *::after {
  box-sizing: border-box;
}

html, body, #root {
  height: 100%;
  margin: 0;
  padding: 0;
}

body {
  background: var(--bg-deep);
  color: var(--text-primary);
  font-family: var(--font-body);
  font-size: 14px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

/* Scrollbar styling */
::-webkit-scrollbar {
  width: 4px;
  height: 4px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.12);
  border-radius: 2px;
}
::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.2);
}

/* Utility: status glow dots */
.glow-green { box-shadow: 0 0 6px var(--green); }
.glow-yellow { box-shadow: 0 0 6px var(--yellow); }
.glow-red    { box-shadow: 0 0 6px var(--red); }
.glow-blue   { box-shadow: 0 0 6px var(--blue); }

/* Utility: monospace data */
.mono { font-family: var(--font-mono); }
```

---

### Task 3: Add new types to src/types.ts

**Files:**
- Modify: `packages/web/src/types.ts`

- [ ] **Step 1: Append the following new types** to the end of `src/types.ts`.

```typescript
// ---------------------------------------------------------------------------
// Thread
// ---------------------------------------------------------------------------

export interface Thread {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Chat / SSE
// ---------------------------------------------------------------------------

export type SSEEventType =
  | 'system'
  | 'text_delta'
  | 'tool_use'
  | 'tool_result'
  | 'result'
  | 'error'
  | 'done';

export interface SSESystemEvent {
  type: 'system';
  sessionId: string;
  threadId: string | null;
  toolCount: number;
}

export interface SSETextDeltaEvent {
  type: 'text_delta';
  delta: string;
}

export interface SSEToolUseEvent {
  type: 'tool_use';
  name: string;
  input: Record<string, unknown>;
}

export interface SSEToolResultEvent {
  type: 'tool_result';
  name: string;
  output: unknown;
}

export interface SSEResultEvent {
  type: 'result';
  usage: { inputTokens: number; outputTokens: number };
  cost: number | null;
}

export interface SSEErrorEvent {
  type: 'error';
  message: string;
}

export interface SSEDoneEvent {
  type: 'done';
}

export type SSEEvent =
  | SSESystemEvent
  | SSETextDeltaEvent
  | SSEToolUseEvent
  | SSEToolResultEvent
  | SSEResultEvent
  | SSEErrorEvent
  | SSEDoneEvent;

// ---------------------------------------------------------------------------
// Chat messages (local UI model)
// ---------------------------------------------------------------------------

export type ChatMessageRole = 'user' | 'agent';

export interface ChatMessage {
  id: string;
  role: ChatMessageRole;
  // Accumulated text content
  text: string;
  // Tool calls attached to this agent turn
  toolCalls: Array<{
    name: string;
    input: Record<string, unknown>;
    output: unknown | null;
  }>;
  // Final token usage (only on agent messages, after 'result' event)
  usage?: { inputTokens: number; outputTokens: number };
  cost?: number | null;
  // Whether this message is still streaming
  streaming: boolean;
  createdAt: string;
}
```

Also add `threadId` to the `Execution` interface (mirror of Plan D change). Find:
```typescript
  createdAt: string;
}
```
— in the `Execution` interface block — and replace with:
```typescript
  /** Thread this execution belongs to, if created via chat. */
  threadId?: string | null;
  createdAt: string;
}
```

---

### Task 4: Update src/lib/api.ts — add chat, thread, and session APIs

**Files:**
- Modify: `packages/web/src/lib/api.ts`

- [ ] **Step 1: Append the following exports** to the bottom of `src/lib/api.ts`.

```typescript
// ---------------------------------------------------------------------------
// Threads / Sessions
// ---------------------------------------------------------------------------

import type { Thread } from '../types.ts';

export function fetchThreads(): Promise<Thread[]> {
  return request<Thread[]>('/api/chat/sessions');
}

export function fetchThread(id: string): Promise<Thread> {
  return request<Thread>(`/api/chat/sessions/${id}`);
}

export function renameThread(id: string, title: string): Promise<Thread> {
  return request<Thread>(`/api/chat/sessions/${id}/rename`, {
    method: 'PUT',
    body: JSON.stringify({ title }),
  });
}

// ---------------------------------------------------------------------------
// Chat — SSE streaming via EventSource-compatible fetch
//
// Returns an AsyncGenerator that yields parsed SSEEvent objects.
// The caller is responsible for cancelling the AbortController on unmount.
// ---------------------------------------------------------------------------

import type { SSEEvent } from '../types.ts';

export async function* streamChat(
  message: string,
  opts: { sessionId?: string; threadId?: string; activeProjectId?: string | null; signal?: AbortSignal }
): AsyncGenerator<SSEEvent> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      sessionId: opts.sessionId,
      threadId: opts.threadId,
      activeProjectId: opts.activeProjectId,
    }),
    signal: opts.signal,
  });

  if (!res.ok || !res.body) {
    throw new Error(`Chat API ${res.status}: ${await res.text().catch(() => res.statusText)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    const lines = buf.split('\n');
    buf = lines.pop() ?? '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const raw = line.slice(6).trim();
        if (!raw) continue;
        try {
          yield JSON.parse(raw) as SSEEvent;
        } catch {
          // malformed line — skip
        }
      }
    }
  }
}
```

---

### Task 5: Create src/stores/thread-store.ts

**Files:**
- Create: `packages/web/src/stores/thread-store.ts`

- [ ] **Step 1: Create the Zustand thread store.**

```typescript
import { create } from 'zustand';
import type { Thread } from '../types.ts';
import { fetchThreads as apiFetchThreads, renameThread as apiRenameThread } from '../lib/api.ts';

interface ThreadStore {
  threads: Thread[];
  activeThreadId: string | null;
  loading: boolean;
  error: string | null;
  fetchThreads: () => Promise<void>;
  setActiveThread: (id: string | null) => void;
  addThread: (thread: Thread) => void;
  renameThread: (id: string, title: string) => Promise<void>;
}

export const useThreadStore = create<ThreadStore>((set, get) => ({
  threads: [],
  activeThreadId: null,
  loading: false,
  error: null,

  fetchThreads: async () => {
    set({ loading: true, error: null });
    try {
      const threads = await apiFetchThreads();
      // Sort most recent first
      threads.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      set({ threads, loading: false });
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : 'Failed to fetch threads' });
    }
  },

  setActiveThread: (id) => set({ activeThreadId: id }),

  addThread: (thread) => {
    set((s) => ({
      threads: [thread, ...s.threads.filter((t) => t.id !== thread.id)],
    }));
  },

  renameThread: async (id, title) => {
    const updated = await apiRenameThread(id, title);
    set((s) => ({
      threads: s.threads.map((t) => (t.id === id ? updated : t)),
    }));
  },
}));
```

---

### Task 6: Create src/stores/chat-store.ts

**Files:**
- Create: `packages/web/src/stores/chat-store.ts`

- [ ] **Step 1: Create the Zustand chat store that manages SSE streaming state.**

```typescript
import { create } from 'zustand';
import type { ChatMessage, Thread } from '../types.ts';
import { streamChat } from '../lib/api.ts';
import { useThreadStore } from './thread-store.ts';

interface ChatStore {
  messages: ChatMessage[];
  sessionId: string | null;
  threadId: string | null;
  streaming: boolean;
  error: string | null;
  // Accumulated cost for the current session
  sessionCostUsd: number;
  // Total tool invocations this session
  toolCallCount: number;

  sendMessage: (text: string, abortSignal?: AbortSignal) => Promise<void>;
  loadThread: (thread: Thread) => void;
  clearChat: () => void;
}

function newUserMessage(text: string): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role: 'user',
    text,
    toolCalls: [],
    streaming: false,
    createdAt: new Date().toISOString(),
  };
}

function newAgentMessage(): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role: 'agent',
    text: '',
    toolCalls: [],
    streaming: true,
    createdAt: new Date().toISOString(),
  };
}

export const useChatStore = create<ChatStore>((set, get) => ({
  messages: [],
  sessionId: null,
  threadId: null,
  streaming: false,
  error: null,
  sessionCostUsd: 0,
  toolCallCount: 0,

  sendMessage: async (text, abortSignal) => {
    if (get().streaming) return;

    const userMsg = newUserMessage(text);
    const agentMsg = newAgentMessage();

    set((s) => ({
      messages: [...s.messages, userMsg, agentMsg],
      streaming: true,
      error: null,
    }));

    try {
      const gen = streamChat(text, {
        sessionId: get().sessionId ?? undefined,
        threadId: get().threadId ?? undefined,
        signal: abortSignal,
      });

      for await (const event of gen) {
        switch (event.type) {
          case 'system': {
            set({ sessionId: event.sessionId });
            if (event.threadId && !get().threadId) {
              set({ threadId: event.threadId });
            }
            break;
          }

          case 'text_delta': {
            set((s) => ({
              messages: s.messages.map((m) =>
                m.id === agentMsg.id ? { ...m, text: m.text + event.delta } : m
              ),
            }));
            break;
          }

          case 'tool_use': {
            set((s) => ({
              toolCallCount: s.toolCallCount + 1,
              messages: s.messages.map((m) =>
                m.id === agentMsg.id
                  ? { ...m, toolCalls: [...m.toolCalls, { name: event.name, input: event.input, output: null }] }
                  : m
              ),
            }));
            break;
          }

          case 'tool_result': {
            set((s) => ({
              messages: s.messages.map((m) => {
                if (m.id !== agentMsg.id) return m;
                // Fill output for the most recent tool call with this name
                const calls = [...m.toolCalls];
                for (let i = calls.length - 1; i >= 0; i--) {
                  if (calls[i]!.name === event.name && calls[i]!.output === null) {
                    calls[i] = { ...calls[i]!, output: event.output };
                    break;
                  }
                }
                return { ...m, toolCalls: calls };
              }),
            }));
            break;
          }

          case 'result': {
            const cost = event.cost ?? 0;
            set((s) => ({
              sessionCostUsd: s.sessionCostUsd + cost,
              messages: s.messages.map((m) =>
                m.id === agentMsg.id
                  ? { ...m, usage: event.usage, cost, streaming: false }
                  : m
              ),
            }));
            break;
          }

          case 'error': {
            set((s) => ({
              error: event.message,
              messages: s.messages.map((m) =>
                m.id === agentMsg.id ? { ...m, streaming: false } : m
              ),
            }));
            break;
          }

          case 'done': {
            set((s) => ({
              messages: s.messages.map((m) =>
                m.id === agentMsg.id ? { ...m, streaming: false } : m
              ),
            }));
            break;
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      set((s) => ({
        error: err instanceof Error ? err.message : 'Chat failed',
        messages: s.messages.map((m) =>
          m.id === agentMsg.id ? { ...m, streaming: false } : m
        ),
      }));
    } finally {
      set({ streaming: false });
      // Notify thread store to refresh list so new thread appears in sidebar
      useThreadStore.getState().fetchThreads();
    }
  },

  loadThread: (thread) => {
    // Loading a thread clears the current chat and sets the thread context.
    // Message history replay is not yet implemented — the user sees an empty
    // chat with prior context still embedded in the server-side session.
    set({
      messages: [],
      threadId: thread.id,
      sessionId: null,
      streaming: false,
      error: null,
      sessionCostUsd: 0,
      toolCallCount: 0,
    });
  },

  clearChat: () => {
    set({
      messages: [],
      sessionId: null,
      threadId: null,
      streaming: false,
      error: null,
      sessionCostUsd: 0,
      toolCallCount: 0,
    });
  },
}));
```

---

### Task 7: Create src/hooks/usePretext.ts

**Files:**
- Create: `packages/web/src/hooks/usePretext.ts`

- [ ] **Step 1: Create the hook exactly as specified in the design spec.**

```typescript
// usePretext — measure variable-height text using Pretext before DOM render
//
// Used in: ChatMessage feed, execution log viewer, event timeline.
// Call only after document.fonts.ready resolves to ensure font metrics are correct.

import { prepare, layout } from '@chenglou/pretext';
import { useState, useEffect, useRef } from 'react';

export function usePretext(text: string, font: string, lineHeight: number) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  const preparedRef = useRef(prepare(text, font));

  useEffect(() => {
    preparedRef.current = prepare(text, font);
  }, [text, font]);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const width = entry.contentRect.width;
      const result = layout(preparedRef.current, width, lineHeight);
      setHeight(result.height);
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [lineHeight]);

  return { containerRef, height };
}
```

---

### Task 8: Create src/components/Header.tsx

**Files:**
- Create: `packages/web/src/components/Header.tsx`

- [ ] **Step 1: Create the header with stats and avatar dropdown.**

```tsx
import { useEffect } from 'react';
import { useExecutionStore } from '../stores/execution-store.ts';

export default function Header() {
  const { executions, fetchExecutions } = useExecutionStore();

  useEffect(() => {
    fetchExecutions();
    const id = setInterval(fetchExecutions, 5000);
    return () => clearInterval(id);
  }, [fetchExecutions]);

  const running = executions.filter((e) => e.status === 'running').length;
  const queued  = executions.filter((e) => e.status === 'queued' || e.status === 'assigned').length;
  const failed  = executions.filter((e) => e.status === 'failed').length;

  return (
    <header
      className="flex items-center justify-between px-4 h-12 border-b shrink-0"
      style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
    >
      {/* Brand */}
      <div className="flex items-center gap-2">
        <div
          className="w-6 h-6 rounded flex items-center justify-center"
          style={{ background: 'var(--accent)' }}
        >
          <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </div>
        <span className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
          BAARA Next
        </span>
        <span
          className="text-xs px-1.5 py-0.5 rounded mono"
          style={{ background: 'var(--bg-raised)', color: 'var(--text-secondary)' }}
        >
          v0.1.0
        </span>
      </div>

      {/* Live stats */}
      <div className="flex items-center gap-4 text-xs" style={{ color: 'var(--text-secondary)' }}>
        <Stat count={running} color="var(--green)" label="running" />
        <Stat count={queued}  color="var(--yellow)" label="queued" />
        <Stat count={failed}  color="var(--red)"   label="failed" />
      </div>

      {/* Avatar */}
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold cursor-pointer"
        style={{ background: 'var(--accent)', color: '#fff' }}
        title="Account"
      >
        SD
      </div>
    </header>
  );
}

function Stat({ count, color, label }: { count: number; color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{ background: color, boxShadow: count > 0 ? `0 0 5px ${color}` : 'none' }}
      />
      <span style={{ color: count > 0 ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
        {count} {label}
      </span>
    </span>
  );
}
```

---

### Task 9: Create src/components/ThreadList.tsx

**Files:**
- Create: `packages/web/src/components/ThreadList.tsx`

- [ ] **Step 1: Create the left sidebar thread navigator.**

```tsx
import { useEffect } from 'react';
import { useThreadStore } from '../stores/thread-store.ts';
import { useChatStore } from '../stores/chat-store.ts';
import type { Thread } from '../types.ts';

// Group threads by date bucket: Today / Yesterday / This Week / Older
function groupThreads(threads: Thread[]): Map<string, Thread[]> {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart.getTime() - 86_400_000);
  const weekStart = new Date(todayStart.getTime() - 6 * 86_400_000);

  const groups = new Map<string, Thread[]>([
    ['Today', []],
    ['Yesterday', []],
    ['This Week', []],
    ['Older', []],
  ]);

  for (const t of threads) {
    const d = new Date(t.updatedAt);
    if (d >= todayStart) groups.get('Today')!.push(t);
    else if (d >= yesterdayStart) groups.get('Yesterday')!.push(t);
    else if (d >= weekStart) groups.get('This Week')!.push(t);
    else groups.get('Older')!.push(t);
  }

  // Remove empty buckets
  for (const [k, v] of groups) {
    if (v.length === 0) groups.delete(k);
  }
  return groups;
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  return `${Math.floor(diffH / 24)}d ago`;
}

interface ThreadListProps {
  collapsed: boolean;
  onCollapse: () => void;
}

export default function ThreadList({ collapsed, onCollapse }: ThreadListProps) {
  const { threads, activeThreadId, fetchThreads, setActiveThread } = useThreadStore();
  const { clearChat, loadThread } = useChatStore();

  useEffect(() => { fetchThreads(); }, [fetchThreads]);

  function handleNewThread() {
    setActiveThread(null);
    clearChat();
  }

  function handleSelectThread(t: Thread) {
    setActiveThread(t.id);
    loadThread(t);
  }

  const grouped = groupThreads(threads);

  if (collapsed) {
    return (
      <div
        className="flex flex-col items-center pt-3 w-8 shrink-0 border-r"
        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
      >
        <button
          onClick={onCollapse}
          className="p-1 rounded hover:bg-white/10 transition-colors"
          title="Expand sidebar"
          style={{ color: 'var(--text-secondary)' }}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <aside
      className="flex flex-col w-56 shrink-0 border-r"
      style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', transition: 'var(--transition-panel)' }}
    >
      {/* Header row */}
      <div
        className="flex items-center justify-between px-3 py-2.5 border-b"
        style={{ borderColor: 'var(--border)' }}
      >
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
          Threads
        </span>
        <button
          onClick={onCollapse}
          className="p-1 rounded hover:bg-white/10"
          title="Collapse sidebar"
          style={{ color: 'var(--text-secondary)' }}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      </div>

      {/* New Thread button */}
      <div className="px-3 py-2">
        <button
          onClick={handleNewThread}
          className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-xs font-medium transition-colors"
          style={{ background: 'var(--accent)', color: '#fff' }}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Thread
        </button>
      </div>

      {/* Thread list */}
      <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-3">
        {grouped.size === 0 && (
          <p className="px-1 py-4 text-xs text-center" style={{ color: 'var(--text-muted)' }}>
            No threads yet. Start a conversation.
          </p>
        )}
        {[...grouped.entries()].map(([label, items]) => (
          <div key={label}>
            <p className="px-1 py-1 text-xs uppercase tracking-wide font-medium" style={{ color: 'var(--text-muted)' }}>
              {label}
            </p>
            {items.map((t) => (
              <button
                key={t.id}
                onClick={() => handleSelectThread(t)}
                className="w-full text-left px-2.5 py-2 rounded text-sm transition-colors"
                style={{
                  background: activeThreadId === t.id ? 'var(--bg-raised)' : 'transparent',
                  color: activeThreadId === t.id ? 'var(--text-primary)' : 'var(--text-secondary)',
                  borderLeft: activeThreadId === t.id ? `2px solid var(--accent)` : '2px solid transparent',
                }}
              >
                <div className="truncate">{t.title || 'Untitled thread'}</div>
                <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  {relativeTime(t.updatedAt)}
                </div>
              </button>
            ))}
          </div>
        ))}
      </div>
    </aside>
  );
}
```

---

### Task 10: Create src/components/ToolIndicator.tsx

**Files:**
- Create: `packages/web/src/components/ToolIndicator.tsx`

- [ ] **Step 1: Create the in-progress tool call indicator.**

```tsx
interface ToolIndicatorProps {
  name: string;
  done: boolean;
}

export default function ToolIndicator({ name, done }: ToolIndicatorProps) {
  const displayName = name.replace(/_/g, ' ');
  return (
    <div
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs"
      style={{ background: 'var(--bg-raised)', color: 'var(--text-secondary)' }}
    >
      {done ? (
        <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"
          style={{ color: 'var(--green)' }}>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <svg className="w-3 h-3 shrink-0 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor"
          style={{ color: 'var(--accent)' }}>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M12 3v3M12 18v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M3 12h3M18 12h3" />
        </svg>
      )}
      <span className="mono">{displayName}</span>
    </div>
  );
}
```

---

### Task 11: Create src/components/InlineCard.tsx

**Files:**
- Create: `packages/web/src/components/InlineCard.tsx`

- [ ] **Step 1: Create the card renderer for structured tool outputs.**

The component inspects the output shape and renders the appropriate card. Actions (Edit, Run Now, Retry) send follow-up messages via the chat store.

```tsx
import { useChatStore } from '../stores/chat-store.ts';
import type { Task, Execution, QueueInfo, InputRequest } from '../types.ts';

function isTask(v: unknown): v is Task {
  return typeof v === 'object' && v !== null && 'prompt' in v && 'executionType' in v;
}
function isExecution(v: unknown): v is Execution {
  return typeof v === 'object' && v !== null && 'status' in v && 'taskId' in v && !('prompt' in v);
}
function isQueueInfo(v: unknown): v is QueueInfo {
  return typeof v === 'object' && v !== null && 'depth' in v && 'maxConcurrency' in v;
}
function isInputRequest(v: unknown): v is InputRequest {
  return typeof v === 'object' && v !== null && 'executionId' in v && 'prompt' in v;
}
function isExecutionArray(v: unknown): v is Execution[] {
  return Array.isArray(v) && v.length > 0 && isExecution(v[0]);
}

const STATUS_COLORS: Record<string, string> = {
  running:           'var(--green)',
  completed:         'var(--green)',
  queued:            'var(--yellow)',
  assigned:          'var(--yellow)',
  retry_scheduled:   'var(--yellow)',
  failed:            'var(--red)',
  timed_out:         'var(--red)',
  dead_lettered:     'var(--red)',
  waiting_for_input: 'var(--blue)',
  created:           'var(--text-secondary)',
  cancelled:         'var(--text-secondary)',
};

interface InlineCardProps {
  toolName: string;
  output: unknown;
}

export default function InlineCard({ toolName, output }: InlineCardProps) {
  const { sendMessage } = useChatStore();

  if (isTask(output)) return <TaskCard task={output} onAction={sendMessage} />;
  if (isExecution(output)) return <ExecutionCard exec={output} onAction={sendMessage} />;
  if (isExecutionArray(output)) return <ExecutionTable execs={output} onAction={sendMessage} />;
  if (isQueueInfo(output)) return <QueueCard queue={output} />;
  if (isInputRequest(output)) return <HitlCard req={output} onAction={sendMessage} />;

  // Fallback: pretty-print JSON
  return (
    <pre
      className="text-xs p-3 rounded overflow-x-auto"
      style={{ background: 'var(--bg-raised)', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}
    >
      {JSON.stringify(output, null, 2)}
    </pre>
  );
}

function CardShell({ color, children }: { color?: string; children: React.ReactNode }) {
  return (
    <div
      className="rounded-lg p-3 my-1 text-sm"
      style={{
        background: 'var(--bg-raised)',
        border: `1px solid ${color ?? 'var(--border)'}`,
      }}
    >
      {children}
    </div>
  );
}

function TaskCard({ task, onAction }: { task: Task; onAction: (msg: string) => void }) {
  return (
    <CardShell color={task.enabled ? 'var(--accent)' : 'var(--border)'}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>{task.name}</div>
          {task.description && (
            <div className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>{task.description}</div>
          )}
          <div className="flex gap-3 mt-1.5 text-xs mono" style={{ color: 'var(--text-muted)' }}>
            <span>{task.executionType}</span>
            <span>{task.executionMode}</span>
            {task.cronExpression && <span>{task.cronExpression}</span>}
          </div>
        </div>
        <span
          className="text-xs px-1.5 py-0.5 rounded"
          style={{ background: task.enabled ? 'rgba(99,102,241,0.15)' : 'var(--bg-hover)', color: task.enabled ? 'var(--accent)' : 'var(--text-secondary)' }}
        >
          {task.enabled ? 'enabled' : 'disabled'}
        </span>
      </div>
      <div className="flex gap-2 mt-2.5">
        <ActionButton label="Run Now" onClick={() => onAction(`Run task ${task.name} now`)} />
        <ActionButton label="Disable" onClick={() => onAction(`Toggle task ${task.name}`)} muted />
      </div>
    </CardShell>
  );
}

function ExecutionCard({ exec, onAction }: { exec: Execution; onAction: (msg: string) => void }) {
  const color = STATUS_COLORS[exec.status] ?? 'var(--border)';
  return (
    <CardShell color={color}>
      <div className="flex items-center justify-between">
        <span className="mono text-xs" style={{ color: 'var(--text-secondary)' }}>
          {exec.id.slice(0, 8)}
        </span>
        <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-hover)', color }}>
          {exec.status}
        </span>
      </div>
      {exec.error && (
        <pre
          className="text-xs mt-1.5 p-2 rounded overflow-x-auto"
          style={{ background: '#1a0a0a', color: 'var(--red)', fontFamily: 'var(--font-mono)' }}
        >
          {exec.error}
        </pre>
      )}
      <div className="flex gap-2 mt-2">
        {exec.status === 'failed' && (
          <ActionButton label="Retry" onClick={() => onAction(`Retry execution ${exec.id}`)} />
        )}
        {(exec.status === 'running' || exec.status === 'queued') && (
          <ActionButton label="Cancel" onClick={() => onAction(`Cancel execution ${exec.id}`)} muted />
        )}
      </div>
    </CardShell>
  );
}

function ExecutionTable({ execs, onAction }: { execs: Execution[]; onAction: (msg: string) => void }) {
  return (
    <div className="rounded-lg overflow-hidden my-1" style={{ border: '1px solid var(--border)' }}>
      <table className="w-full text-xs">
        <thead style={{ background: 'var(--bg-raised)' }}>
          <tr>
            {['ID', 'Status', 'Duration', 'Task'].map((h) => (
              <th key={h} className="px-3 py-2 text-left font-medium" style={{ color: 'var(--text-secondary)' }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {execs.map((e, i) => {
            const color = STATUS_COLORS[e.status] ?? 'var(--text-secondary)';
            return (
              <tr
                key={e.id}
                className="cursor-pointer transition-colors hover:bg-white/5"
                style={{ background: i % 2 === 0 ? 'var(--bg-surface)' : 'transparent' }}
                onClick={() => onAction(`Get execution ${e.id}`)}
              >
                <td className="px-3 py-2 mono" style={{ color: 'var(--text-secondary)' }}>{e.id.slice(0, 8)}</td>
                <td className="px-3 py-2" style={{ color }}>{e.status}</td>
                <td className="px-3 py-2 mono" style={{ color: 'var(--text-muted)' }}>
                  {e.durationMs ? `${(e.durationMs / 1000).toFixed(1)}s` : '—'}
                </td>
                <td className="px-3 py-2 mono" style={{ color: 'var(--text-muted)' }}>{e.taskId.slice(0, 8)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function QueueCard({ queue }: { queue: QueueInfo }) {
  const utilization = queue.maxConcurrency > 0 ? queue.activeCount / queue.maxConcurrency : 0;
  return (
    <CardShell>
      <div className="flex items-center justify-between">
        <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{queue.name}</span>
        <span className="mono text-xs" style={{ color: 'var(--text-secondary)' }}>
          depth: {queue.depth}
        </span>
      </div>
      <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-hover)' }}>
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${Math.min(utilization * 100, 100)}%`,
            background: utilization > 0.8 ? 'var(--red)' : 'var(--green)',
          }}
        />
      </div>
      <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
        {queue.activeCount}/{queue.maxConcurrency} active
      </div>
    </CardShell>
  );
}

function HitlCard({ req, onAction }: { req: InputRequest; onAction: (msg: string) => void }) {
  return (
    <CardShell color="var(--blue)">
      <div className="text-xs font-medium mb-1" style={{ color: 'var(--blue)' }}>Input Required</div>
      <div style={{ color: 'var(--text-primary)' }}>{req.prompt}</div>
      {req.options && req.options.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {req.options.map((opt) => (
            <button
              key={opt}
              onClick={() => onAction(`Provide input for execution ${req.executionId}: ${opt}`)}
              className="text-xs px-2 py-1 rounded border transition-colors"
              style={{ borderColor: 'var(--blue)', color: 'var(--blue)', background: 'transparent' }}
            >
              {opt}
            </button>
          ))}
        </div>
      )}
    </CardShell>
  );
}

function ActionButton({ label, onClick, muted }: { label: string; onClick: () => void; muted?: boolean }) {
  return (
    <button
      onClick={onClick}
      className="text-xs px-2.5 py-1 rounded transition-colors"
      style={{
        background: muted ? 'var(--bg-hover)' : 'rgba(99,102,241,0.15)',
        color: muted ? 'var(--text-secondary)' : 'var(--accent)',
      }}
    >
      {label}
    </button>
  );
}
```

---

### Task 12: Create src/components/ChatMessage.tsx

**Files:**
- Create: `packages/web/src/components/ChatMessage.tsx`

- [ ] **Step 1: Create the chat message bubble component.**

```tsx
import { useEffect, useRef } from 'react';
import type { ChatMessage as ChatMessageType } from '../types.ts';
import ToolIndicator from './ToolIndicator.tsx';
import InlineCard from './InlineCard.tsx';

interface ChatMessageProps {
  message: ChatMessageType;
}

export default function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user';

  return (
    <div
      className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}
    >
      <div style={{ maxWidth: '82%' }}>
        {/* Agent avatar label */}
        {!isUser && (
          <div className="text-xs mb-1 px-1" style={{ color: 'var(--text-muted)' }}>
            BAARA
          </div>
        )}

        {/* Bubble */}
        <div
          className="rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed"
          style={{
            background: isUser ? 'var(--accent)' : 'var(--bg-raised)',
            color: isUser ? '#fff' : 'var(--text-primary)',
            borderBottomRightRadius: isUser ? '4px' : undefined,
            borderBottomLeftRadius: !isUser ? '4px' : undefined,
          }}
        >
          {/* Message text with streaming cursor */}
          {message.text && (
            <span>
              {message.text}
              {message.streaming && message.text && (
                <span className="inline-block w-0.5 h-3.5 ml-0.5 animate-pulse align-text-bottom"
                  style={{ background: isUser ? 'rgba(255,255,255,0.7)' : 'var(--accent)' }} />
              )}
            </span>
          )}
          {message.streaming && !message.text && (
            <span className="inline-block w-0.5 h-3.5 animate-pulse"
              style={{ background: 'var(--accent)' }} />
          )}
        </div>

        {/* Tool calls below the bubble */}
        {message.toolCalls.length > 0 && (
          <div className="mt-1.5 space-y-1 px-1">
            {message.toolCalls.map((tc, i) => (
              <div key={i}>
                <ToolIndicator name={tc.name} done={tc.output !== null} />
                {tc.output !== null && (
                  <div className="mt-1">
                    <InlineCard toolName={tc.name} output={tc.output} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Token usage */}
        {message.usage && (
          <div className="text-xs mt-1 px-1" style={{ color: 'var(--text-muted)' }}>
            {message.usage.inputTokens + message.usage.outputTokens} tokens
            {message.cost != null && ` · $${message.cost.toFixed(4)}`}
          </div>
        )}
      </div>
    </div>
  );
}
```

---

### Task 13: Create src/components/ChatInput.tsx

**Files:**
- Create: `packages/web/src/components/ChatInput.tsx`

- [ ] **Step 1: Create the input bar.**

```tsx
import { useState, useRef, useCallback } from 'react';
import { useChatStore } from '../stores/chat-store.ts';

export default function ChatInput() {
  const { streaming, sendMessage, sessionCostUsd, toolCallCount } = useChatStore();
  const [value, setValue] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const handleSend = useCallback(async () => {
    const trimmed = value.trim();
    if (!trimmed || streaming) return;
    setValue('');
    abortRef.current = new AbortController();
    await sendMessage(trimmed, abortRef.current.signal);
    abortRef.current = null;
  }, [value, streaming, sendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
  };

  return (
    <div
      className="border-t px-4 py-3"
      style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
    >
      <div
        className="flex items-end gap-2 rounded-xl px-3 py-2"
        style={{ background: 'var(--bg-raised)', border: '1px solid var(--border)' }}
      >
        <textarea
          className="flex-1 resize-none bg-transparent text-sm outline-none leading-relaxed"
          style={{ color: 'var(--text-primary)', maxHeight: '120px', minHeight: '24px' }}
          placeholder="Message BAARA..."
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          disabled={streaming}
        />
        {streaming ? (
          <button
            onClick={handleStop}
            className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: 'var(--red)' }}
            title="Stop"
          >
            <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 24 24">
              <rect x="6" y="6" width="12" height="12" />
            </svg>
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!value.trim()}
            className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-opacity"
            style={{ background: value.trim() ? 'var(--accent)' : 'var(--bg-hover)', opacity: value.trim() ? 1 : 0.4 }}
            title="Send (Enter)"
          >
            <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19V5m-7 7l7-7 7 7" />
            </svg>
          </button>
        )}
      </div>
      {/* Meta bar */}
      <div className="flex items-center gap-3 mt-1.5 px-1 text-xs" style={{ color: 'var(--text-muted)' }}>
        <span>{toolCallCount} tool{toolCallCount !== 1 ? 's' : ''} used</span>
        <span>·</span>
        <span>claude-sonnet-4-6</span>
        <span>·</span>
        <span>${sessionCostUsd.toFixed(4)}</span>
      </div>
    </div>
  );
}
```

---

### Task 14: Create src/components/ChatWindow.tsx

**Files:**
- Create: `packages/web/src/components/ChatWindow.tsx`

- [ ] **Step 1: Create the main chat area with auto-scroll.**

```tsx
import { useEffect, useRef } from 'react';
import { useChatStore } from '../stores/chat-store.ts';
import ChatMessage from './ChatMessage.tsx';
import ChatInput from './ChatInput.tsx';

export default function ChatWindow() {
  const { messages } = useChatStore();
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages / streaming deltas
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="flex flex-col flex-1 min-w-0 min-h-0">
      {/* Message feed */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {messages.length === 0 ? (
          <EmptyState />
        ) : (
          messages.map((m) => <ChatMessage key={m.id} message={m} />)
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <ChatInput />
    </div>
  );
}

function EmptyState() {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center">
      <div
        className="w-12 h-12 rounded-xl mb-4 flex items-center justify-center"
        style={{ background: 'var(--bg-raised)' }}
      >
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"
          style={{ color: 'var(--accent)' }}>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      </div>
      <h2 className="text-base font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
        BAARA Next
      </h2>
      <p className="text-sm max-w-xs" style={{ color: 'var(--text-secondary)' }}>
        Describe a task in natural language and I'll create, run, and monitor it for you.
      </p>
      <div className="flex flex-wrap gap-2 mt-5 justify-center max-w-sm">
        {[
          'Create a task that checks uptime every 5 minutes',
          'Show me what failed in the last hour',
          'What tasks are currently running?',
        ].map((hint) => {
          const { sendMessage } = useChatStore.getState();
          return (
            <button
              key={hint}
              onClick={() => sendMessage(hint)}
              className="text-xs px-3 py-1.5 rounded-full border transition-colors"
              style={{
                borderColor: 'var(--border)',
                color: 'var(--text-secondary)',
                background: 'transparent',
              }}
            >
              {hint}
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

---

### Task 15: Create src/components/EventTimeline.tsx

**Files:**
- Create: `packages/web/src/components/EventTimeline.tsx`

- [ ] **Step 1: Create the Pretext-powered event timeline.**

```tsx
import { useState } from 'react';
import type { ExecutionEvent } from '../types.ts';
import { usePretext } from '../hooks/usePretext.ts';

interface EventTimelineProps {
  events: ExecutionEvent[];
}

export default function EventTimeline({ events }: EventTimelineProps) {
  if (events.length === 0) {
    return <p className="text-sm py-4 text-center" style={{ color: 'var(--text-muted)' }}>No events yet.</p>;
  }
  return (
    <div className="space-y-1 py-2">
      {events.map((ev) => <EventRow key={ev.id} event={ev} />)}
    </div>
  );
}

function EventRow({ event }: { event: ExecutionEvent }) {
  const [expanded, setExpanded] = useState(false);
  const payload = JSON.stringify(event, null, 2);
  const { containerRef, height } = usePretext(payload, '12px JetBrains Mono', 18);

  const ts = new Date(event.timestamp).toLocaleTimeString([], {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });

  return (
    <div
      className="rounded px-3 py-2 cursor-pointer select-none transition-colors"
      style={{ background: 'var(--bg-raised)' }}
      onClick={() => setExpanded((x) => !x)}
    >
      <div className="flex items-center gap-2">
        <span className="mono text-xs" style={{ color: 'var(--text-muted)' }}>{ts}</span>
        <span
          className="text-xs px-1.5 py-0.5 rounded"
          style={{ background: 'var(--bg-hover)', color: 'var(--text-secondary)' }}
        >
          {event.type}
        </span>
        <svg
          className={`w-3 h-3 ml-auto transition-transform ${expanded ? 'rotate-90' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
          style={{ color: 'var(--text-muted)' }}
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </div>
      {expanded && (
        <div
          ref={containerRef}
          style={{ height: height || 'auto', overflow: 'hidden', transition: 'height 150ms ease' }}
        >
          <pre
            className="mt-2 text-xs overflow-x-auto"
            style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}
          >
            {payload}
          </pre>
        </div>
      )}
    </div>
  );
}
```

---

### Task 16: Create src/components/ExecutionDetail.tsx

**Files:**
- Create: `packages/web/src/components/ExecutionDetail.tsx`

- [ ] **Step 1: Create the tabbed execution detail panel.**

```tsx
import { useState, useEffect } from 'react';
import type { Execution, ExecutionEvent } from '../types.ts';
import { useExecutionStore } from '../stores/execution-store.ts';
import { useChatStore } from '../stores/chat-store.ts';
import EventTimeline from './EventTimeline.tsx';

const TABS = ['Overview', 'Events', 'Logs', 'Tools'] as const;
type Tab = typeof TABS[number];

const STATUS_COLORS: Record<string, string> = {
  running:           'var(--green)',
  completed:         'var(--green)',
  queued:            'var(--yellow)',
  assigned:          'var(--yellow)',
  failed:            'var(--red)',
  timed_out:         'var(--red)',
  dead_lettered:     'var(--red)',
  waiting_for_input: 'var(--blue)',
};

interface ExecutionDetailProps {
  execution: Execution;
  onClose: () => void;
}

export default function ExecutionDetail({ execution, onClose }: ExecutionDetailProps) {
  const [activeTab, setActiveTab] = useState<Tab>('Overview');
  const { selectedEvents, fetchExecutionEvents } = useExecutionStore();
  const { sendMessage } = useChatStore();

  useEffect(() => {
    if (activeTab === 'Events') {
      fetchExecutionEvents(execution.id);
    }
  }, [activeTab, execution.id, fetchExecutionEvents]);

  const statusColor = STATUS_COLORS[execution.status] ?? 'var(--text-secondary)';

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b shrink-0"
        style={{ borderColor: 'var(--border)' }}
      >
        <div>
          <div className="flex items-center gap-2">
            <span className="mono text-xs" style={{ color: 'var(--text-secondary)' }}>
              {execution.id.slice(0, 12)}
            </span>
            <span
              className="text-xs px-1.5 py-0.5 rounded"
              style={{ background: 'var(--bg-hover)', color: statusColor }}
            >
              {execution.status}
            </span>
          </div>
        </div>
        <button onClick={onClose} style={{ color: 'var(--text-muted)' }}>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b shrink-0" style={{ borderColor: 'var(--border)' }}>
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            className="px-4 py-2 text-xs font-medium border-b-2 transition-colors"
            style={{
              borderColor: activeTab === t ? 'var(--accent)' : 'transparent',
              color: activeTab === t ? 'var(--accent)' : 'var(--text-secondary)',
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-4 text-sm">
        {activeTab === 'Overview' && (
          <OverviewTab execution={execution} onAction={sendMessage} />
        )}
        {activeTab === 'Events' && (
          <EventTimeline events={selectedEvents} />
        )}
        {activeTab === 'Logs' && (
          <LogsTab output={execution.output} />
        )}
        {activeTab === 'Tools' && (
          <p style={{ color: 'var(--text-muted)' }}>
            Tool invocations are captured in execution events. Switch to the Events tab to inspect them.
          </p>
        )}
      </div>
    </div>
  );
}

function OverviewTab({ execution, onAction }: { execution: Execution; onAction: (msg: string) => void }) {
  const dur = execution.durationMs
    ? `${(execution.durationMs / 1000).toFixed(2)}s`
    : '—';
  const tokens = (execution.inputTokens ?? 0) + (execution.outputTokens ?? 0);

  return (
    <div className="space-y-4">
      {/* Stat grid */}
      <div className="grid grid-cols-2 gap-2">
        {[
          { label: 'Duration',  value: dur },
          { label: 'Attempt',   value: String(execution.attempt) },
          { label: 'Tokens',    value: tokens > 0 ? String(tokens) : '—' },
          { label: 'Health',    value: execution.healthStatus },
        ].map(({ label, value }) => (
          <div key={label} className="rounded p-2.5" style={{ background: 'var(--bg-raised)' }}>
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{label}</div>
            <div className="font-semibold mono text-sm mt-0.5" style={{ color: 'var(--text-primary)' }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Error */}
      {execution.error && (
        <div className="rounded p-3" style={{ background: '#1a0a0a', border: '1px solid var(--red)' }}>
          <div className="text-xs mb-1" style={{ color: 'var(--red)' }}>Error</div>
          <pre className="text-xs overflow-x-auto whitespace-pre-wrap" style={{ fontFamily: 'var(--font-mono)', color: 'var(--red)' }}>
            {execution.error}
          </pre>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        {execution.status === 'failed' && (
          <button
            onClick={() => onAction(`Retry execution ${execution.id}`)}
            className="text-xs px-3 py-1.5 rounded transition-colors"
            style={{ background: 'rgba(99,102,241,0.15)', color: 'var(--accent)' }}
          >
            Retry
          </button>
        )}
        {(execution.status === 'running' || execution.status === 'queued') && (
          <button
            onClick={() => onAction(`Cancel execution ${execution.id}`)}
            className="text-xs px-3 py-1.5 rounded transition-colors"
            style={{ background: 'var(--bg-hover)', color: 'var(--text-secondary)' }}
          >
            Cancel
          </button>
        )}
        <button
          onClick={() => onAction(`Get execution details for ${execution.id}`)}
          className="text-xs px-3 py-1.5 rounded transition-colors"
          style={{ background: 'var(--bg-hover)', color: 'var(--text-secondary)' }}
        >
          View in Chat
        </button>
      </div>
    </div>
  );
}

function LogsTab({ output }: { output?: string | null }) {
  if (!output) {
    return <p style={{ color: 'var(--text-muted)' }}>No output captured.</p>;
  }
  return (
    <pre
      className="text-xs leading-relaxed overflow-x-auto whitespace-pre-wrap"
      style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}
    >
      {output}
    </pre>
  );
}
```

---

### Task 17: Create src/components/ControlPanel.tsx

**Files:**
- Create: `packages/web/src/components/ControlPanel.tsx`

- [ ] **Step 1: Create the right panel with Tasks/Executions/Queues tabs.**

```tsx
import { useState, useEffect } from 'react';
import { useTaskStore } from '../stores/task-store.ts';
import { useExecutionStore } from '../stores/execution-store.ts';
import { useQueueStore } from '../stores/queue-store.ts';
import { useChatStore } from '../stores/chat-store.ts';
import type { Execution } from '../types.ts';
import ExecutionDetail from './ExecutionDetail.tsx';

const TABS = ['Tasks', 'Executions', 'Queues'] as const;
type Tab = typeof TABS[number];

interface ControlPanelProps {
  collapsed: boolean;
  onCollapse: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  running:           'var(--green)',
  completed:         'var(--green)',
  queued:            'var(--yellow)',
  assigned:          'var(--yellow)',
  failed:            'var(--red)',
  timed_out:         'var(--red)',
  dead_lettered:     'var(--red)',
  waiting_for_input: 'var(--blue)',
};

export default function ControlPanel({ collapsed, onCollapse }: ControlPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>('Executions');
  const [selectedExecution, setSelectedExecution] = useState<Execution | null>(null);
  const [search, setSearch] = useState('');

  const { tasks, fetchTasks } = useTaskStore();
  const { executions, fetchExecutions } = useExecutionStore();
  const { queues, fetchQueues } = useQueueStore();
  const { sendMessage } = useChatStore();

  useEffect(() => {
    fetchTasks(); fetchExecutions(); fetchQueues();
    const id = setInterval(() => { fetchExecutions(); fetchQueues(); }, 5000);
    return () => clearInterval(id);
  }, [fetchTasks, fetchExecutions, fetchQueues]);

  if (collapsed) {
    return (
      <div
        className="flex flex-col items-center pt-3 w-8 shrink-0 border-l"
        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
      >
        <button
          onClick={onCollapse}
          className="p-1 rounded hover:bg-white/10"
          title="Expand panel"
          style={{ color: 'var(--text-secondary)' }}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M15 5l-7 7 7 7" />
          </svg>
        </button>
      </div>
    );
  }

  const filteredTasks = tasks.filter((t) =>
    !search || t.name.toLowerCase().includes(search.toLowerCase())
  );
  const filteredExecs = executions.filter((e) =>
    !search || e.id.toLowerCase().includes(search.toLowerCase()) || e.status.includes(search.toLowerCase())
  );

  if (selectedExecution) {
    return (
      <aside
        className="flex flex-col w-72 shrink-0 border-l"
        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
      >
        <ExecutionDetail execution={selectedExecution} onClose={() => setSelectedExecution(null)} />
      </aside>
    );
  }

  return (
    <aside
      className="flex flex-col w-72 shrink-0 border-l"
      style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', transition: 'var(--transition-panel)' }}
    >
      {/* Tab bar */}
      <div className="flex border-b shrink-0" style={{ borderColor: 'var(--border)' }}>
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            className="flex-1 py-2.5 text-xs font-medium border-b-2 transition-colors"
            style={{
              borderColor: activeTab === t ? 'var(--accent)' : 'transparent',
              color: activeTab === t ? 'var(--accent)' : 'var(--text-secondary)',
            }}
          >
            {t}
          </button>
        ))}
        <button
          onClick={onCollapse}
          className="px-2.5 border-b-2 border-transparent"
          style={{ color: 'var(--text-muted)' }}
          title="Collapse panel"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* Search */}
      <div className="px-3 py-2">
        <input
          type="text"
          placeholder="Search..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full text-xs px-2.5 py-1.5 rounded outline-none"
          style={{
            background: 'var(--bg-raised)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border)',
          }}
        />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {activeTab === 'Tasks' && (
          <div className="space-y-0.5">
            {filteredTasks.map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between px-2.5 py-2 rounded cursor-pointer transition-colors hover:bg-white/5"
                onClick={() => sendMessage(`Get task ${t.name}`)}
              >
                <div>
                  <div className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{t.name}</div>
                  <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{t.executionType}</div>
                </div>
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: t.enabled ? 'var(--green)' : 'var(--text-muted)' }}
                />
              </div>
            ))}
            {filteredTasks.length === 0 && (
              <p className="py-4 text-xs text-center" style={{ color: 'var(--text-muted)' }}>No tasks found.</p>
            )}
          </div>
        )}

        {activeTab === 'Executions' && (
          <div className="space-y-0.5">
            {filteredExecs.map((e) => {
              const color = STATUS_COLORS[e.status] ?? 'var(--text-secondary)';
              return (
                <div
                  key={e.id}
                  className="flex items-center justify-between px-2.5 py-2 rounded cursor-pointer transition-colors hover:bg-white/5"
                  onClick={() => setSelectedExecution(e)}
                >
                  <div>
                    <div className="mono text-xs" style={{ color: 'var(--text-secondary)' }}>{e.id.slice(0, 8)}</div>
                    <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{e.taskId.slice(0, 8)}</div>
                  </div>
                  <span className="text-xs" style={{ color }}>{e.status}</span>
                </div>
              );
            })}
            {filteredExecs.length === 0 && (
              <p className="py-4 text-xs text-center" style={{ color: 'var(--text-muted)' }}>No executions found.</p>
            )}
          </div>
        )}

        {activeTab === 'Queues' && (
          <div className="space-y-2 pt-1">
            {queues.map((q) => {
              const util = q.maxConcurrency > 0 ? q.activeCount / q.maxConcurrency : 0;
              return (
                <div key={q.name} className="px-2.5 py-2.5 rounded" style={{ background: 'var(--bg-raised)' }}>
                  <div className="flex justify-between text-xs mb-1.5">
                    <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{q.name}</span>
                    <span style={{ color: 'var(--text-muted)' }}>depth {q.depth}</span>
                  </div>
                  <div className="h-1 rounded-full overflow-hidden" style={{ background: 'var(--bg-hover)' }}>
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.min(util * 100, 100)}%`,
                        background: util > 0.8 ? 'var(--red)' : 'var(--green)',
                      }}
                    />
                  </div>
                  <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                    {q.activeCount}/{q.maxConcurrency} active
                  </div>
                </div>
              );
            })}
            {queues.length === 0 && (
              <p className="py-4 text-xs text-center" style={{ color: 'var(--text-muted)' }}>No queues configured.</p>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
```

---

### Task 18: Rewrite src/App.tsx — three-zone layout

**Files:**
- Rewrite: `packages/web/src/App.tsx`

- [ ] **Step 1: Replace the current routed sidebar layout with the three-zone chat-centric shell.**

```tsx
import { useState } from 'react';
import Header from './components/Header.tsx';
import ThreadList from './components/ThreadList.tsx';
import ChatWindow from './components/ChatWindow.tsx';
import ControlPanel from './components/ControlPanel.tsx';

export default function App() {
  const [leftCollapsed, setLeftCollapsed]   = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);

  return (
    <div
      className="flex flex-col h-screen overflow-hidden"
      style={{ background: 'var(--bg-deep)' }}
    >
      <Header />

      <div className="flex flex-1 min-h-0">
        {/* Left sidebar */}
        <ThreadList
          collapsed={leftCollapsed}
          onCollapse={() => setLeftCollapsed((x) => !x)}
        />

        {/* Center chat — fills all remaining space */}
        <ChatWindow />

        {/* Right control panel */}
        <ControlPanel
          collapsed={rightCollapsed}
          onCollapse={() => setRightCollapsed((x) => !x)}
        />
      </div>
    </div>
  );
}
```

---

### Task 19: Add missing store (queue-store.ts) if absent

**Files:**
- Create: `packages/web/src/stores/queue-store.ts`

- [ ] **Step 1: Check if `queue-store.ts` already exists.** If it does not exist, create it:

```typescript
import { create } from 'zustand';
import type { QueueInfo } from '../types.ts';
import { fetchQueues as apiFetchQueues } from '../lib/api.ts';

interface QueueStore {
  queues: QueueInfo[];
  loading: boolean;
  error: string | null;
  fetchQueues: () => Promise<void>;
}

export const useQueueStore = create<QueueStore>((set) => ({
  queues: [],
  loading: false,
  error: null,

  fetchQueues: async () => {
    set({ loading: true, error: null });
    try {
      const queues = await apiFetchQueues();
      set({ queues, loading: false });
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : 'Failed to fetch queues' });
    }
  },
}));
```

Also verify `src/lib/api.ts` exports `fetchQueues`. If not, add:

```typescript
export function fetchQueues(): Promise<QueueInfo[]> {
  return request<QueueInfo[]>('/api/queues');
}
```

---

### Task 20: Update tailwind.config to expose CSS variables

**Files:**
- Modify: `packages/web/tailwind.config.ts` (or `.js`)

- [ ] **Step 1: Ensure the content glob covers the new component files** (they are all under `src/`). The existing config should already cover this, but verify the pattern includes `./src/**/*.{ts,tsx}`.

---

## Verification

After all tasks, run from `packages/web`:

1. `bun run dev` — Vite server starts without errors.
2. Open browser → three-zone layout renders: left sidebar, center chat, right panel.
3. Type "list my tasks" in the chat input → sends request, SSE streaming events produce agent text in the center.
4. A `tool_use` event for `list_tasks` renders a `ToolIndicator` spinner, then an `InlineCard` table on `tool_result`.
5. Click the `<` button on the left sidebar → sidebar collapses to icon strip, chat expands.
6. Click the `>` button on the right panel → panel collapses, chat fills full width.
7. After chat, new thread appears in the left sidebar under "Today".
8. Click that thread → chat clears and `threadId` is set (visible in the chat store).
9. Click an execution in the right panel's Executions tab → `ExecutionDetail` slides in with tabs.
10. `bunx tsc --noEmit` from repo root passes with zero errors.

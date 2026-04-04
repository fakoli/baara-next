import { useEffect, useState, useCallback } from 'react';
import { useThreadStore } from '../stores/thread-store.ts';
import { useChatStore } from '../stores/chat-store.ts';
import type { Thread } from '../types.ts';
import { fetchThreadMessages } from '../lib/api.ts';

/** Mirror of MAIN_THREAD_ID from @baara-next/core — kept client-side to avoid a build dep. */
const MAIN_THREAD_ID = '00000000-0000-0000-0000-000000000000';

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

  // Unread count for the Main thread — count of completion messages since the
  // thread was last viewed.  We track the message count at last-view time so
  // we can compute a delta.
  const [mainUnreadCount, setMainUnreadCount] = useState(0);
  const [mainLastSeenCount, setMainLastSeenCount] = useState(0);

  useEffect(() => {
    void fetchThreads();
  }, [fetchThreads]);

  // Poll the Main thread message count so the badge updates when new task
  // completions arrive.  We refresh every 15 seconds.
  const refreshMainUnread = useCallback(async () => {
    try {
      const messages = await fetchThreadMessages(MAIN_THREAD_ID);
      // Only agent messages from the orchestrator count as "completion" messages.
      const completionCount = messages.filter((m) => m.role === 'agent').length;
      setMainUnreadCount(Math.max(0, completionCount - mainLastSeenCount));
    } catch {
      // Silently ignore — the thread may not exist yet on a fresh database.
    }
  }, [mainLastSeenCount]);

  useEffect(() => {
    void refreshMainUnread();
    const interval = setInterval(() => void refreshMainUnread(), 15_000);
    return () => clearInterval(interval);
  }, [refreshMainUnread]);

  function handleNewThread() {
    setActiveThread(null);
    clearChat();
  }

  function handleSelectThread(t: Thread) {
    setActiveThread(t.id);
    loadThread(t);
    // If the user opens the Main thread, mark all current messages as seen.
    if (t.id === MAIN_THREAD_ID) {
      fetchThreadMessages(MAIN_THREAD_ID)
        .then((messages) => {
          const completionCount = messages.filter((m) => m.role === 'agent').length;
          setMainLastSeenCount(completionCount);
          setMainUnreadCount(0);
        })
        .catch(() => {});
    }
  }

  const mainThread = threads.find((t) => t.id === MAIN_THREAD_ID) ?? null;
  const otherThreads = threads.filter((t) => t.id !== MAIN_THREAD_ID);
  const grouped = groupThreads(otherThreads);

  return (
    <aside
      className="panel-collapsible"
      style={{
        width: collapsed ? 0 : 240,
        minWidth: collapsed ? 0 : 240,
        opacity: collapsed ? 0 : 1,
        background: 'var(--bg-surface)',
        borderRight: collapsed ? 'none' : '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        overflow: 'hidden',
        transition: 'width 0.2s ease, min-width 0.2s ease, opacity 0.15s ease',
        pointerEvents: collapsed ? 'none' : 'auto',
      }}
    >
      {/* Header row */}
      <div
        style={{
          padding: '12px 14px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.8px',
          }}
        >
          Threads
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          {/* New Thread button */}
          <button
            onClick={handleNewThread}
            title="New Thread"
            style={{
              height: 22,
              padding: '0 8px',
              background: 'var(--bg-raised)',
              border: '1px solid var(--border)',
              borderRadius: 5,
              color: 'var(--text-secondary)',
              display: 'flex',
              alignItems: 'center',
              fontSize: 11,
              fontWeight: 500,
              letterSpacing: '0.3px',
              cursor: 'pointer',
              gap: 4,
              whiteSpace: 'nowrap',
              fontFamily: 'var(--font-body)',
            }}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            New
          </button>
          {/* Collapse button */}
          <button
            onClick={onCollapse}
            title="Collapse sidebar"
            style={{
              width: 22,
              height: 22,
              background: 'var(--bg-raised)',
              border: '1px solid var(--border)',
              borderRadius: 5,
              color: 'var(--text-secondary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 700,
              fontFamily: 'var(--font-body)',
            }}
          >
            ‹
          </button>
        </div>
      </div>

      {/* Thread list */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '0 8px 12px',
        }}
      >
        {/* ------------------------------------------------------------------ */}
        {/* Pinned Main thread — always at the top                              */}
        {/* ------------------------------------------------------------------ */}
        {mainThread && (
          <div style={{ marginBottom: 6 }}>
            <MainThreadRow
              thread={mainThread}
              isActive={activeThreadId === mainThread.id}
              unreadCount={mainUnreadCount}
              onSelect={handleSelectThread}
            />
          </div>
        )}

        {/* ------------------------------------------------------------------ */}
        {/* Grouped user threads                                                */}
        {/* ------------------------------------------------------------------ */}
        {grouped.size === 0 && !mainThread && (
          <p
            style={{
              padding: '16px 8px',
              fontSize: 12,
              color: 'var(--text-muted)',
              textAlign: 'center',
            }}
          >
            No threads yet. Start a conversation.
          </p>
        )}
        {[...grouped.entries()].map(([label, items]) => (
          <div key={label}>
            <p
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                padding: '12px 8px 6px',
              }}
            >
              {label}
            </p>
            {items.map((t) => {
              const isActive = activeThreadId === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => handleSelectThread(t)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                    padding: '8px 10px',
                    borderRadius: 7,
                    cursor: 'pointer',
                    background: isActive ? 'var(--bg-active)' : 'transparent',
                    border: 'none',
                    textAlign: 'left',
                    marginBottom: 2,
                    transition: 'background 0.12s',
                    fontFamily: 'var(--font-body)',
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-hover)';
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                  }}
                >
                  {/* Status indicator dot */}
                  <div
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: '50%',
                      background: 'var(--text-muted)',
                      marginTop: 5,
                      flexShrink: 0,
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 500,
                        color: 'var(--text-primary)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {t.title || 'Untitled thread'}
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        marginTop: 2,
                        fontSize: 11,
                        color: 'var(--text-muted)',
                      }}
                    >
                      <span>{relativeTime(t.updatedAt)}</span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// MainThreadRow — pinned row with bold styling, pin icon, and unread badge
// ---------------------------------------------------------------------------

interface MainThreadRowProps {
  thread: Thread;
  isActive: boolean;
  unreadCount: number;
  onSelect: (t: Thread) => void;
}

function MainThreadRow({ thread, isActive, unreadCount, onSelect }: MainThreadRowProps) {
  return (
    <button
      onClick={() => onSelect(thread)}
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 10px',
        borderRadius: 7,
        cursor: 'pointer',
        background: isActive ? 'var(--bg-active)' : 'var(--bg-raised)',
        border: '1px solid var(--border)',
        textAlign: 'left',
        transition: 'background 0.12s',
        fontFamily: 'var(--font-body)',
      }}
      onMouseEnter={(e) => {
        if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-hover)';
      }}
      onMouseLeave={(e) => {
        if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = isActive ? 'var(--bg-active)' : 'var(--bg-raised)';
      }}
    >
      {/* Pin icon */}
      <svg
        width="11"
        height="11"
        viewBox="0 0 24 24"
        fill="currentColor"
        style={{ color: 'var(--accent)', flexShrink: 0 }}
      >
        <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z" />
      </svg>

      {/* Thread title */}
      <span
        style={{
          flex: 1,
          fontSize: 13,
          fontWeight: 700,
          color: 'var(--text-primary)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {thread.title}
      </span>

      {/* Unread badge */}
      {unreadCount > 0 && (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            minWidth: 18,
            height: 18,
            borderRadius: 9,
            background: 'var(--accent)',
            color: 'white',
            fontSize: 10,
            fontWeight: 700,
            padding: '0 5px',
            flexShrink: 0,
          }}
        >
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </button>
  );
}

/** Narrow expand chevron shown when sidebar is collapsed */
export function ThreadListExpandButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title="Expand threads"
      style={{
        position: 'fixed',
        top: '50%',
        left: 0,
        transform: 'translateY(-50%)',
        width: 24,
        height: 48,
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderLeft: 'none',
        borderRadius: '0 6px 6px 0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        color: 'var(--text-muted)',
        zIndex: 20,
        transition: 'color 0.12s, background 0.12s',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.color = 'var(--accent)';
        (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-raised)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)';
        (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-surface)';
      }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <polyline points="9 18 15 12 9 6" />
      </svg>
    </button>
  );
}

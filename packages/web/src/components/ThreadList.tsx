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

  useEffect(() => {
    void fetchThreads();
  }, [fetchThreads]);

  function handleNewThread() {
    setActiveThread(null);
    clearChat();
  }

  function handleSelectThread(t: Thread) {
    setActiveThread(t.id);
    loadThread(t);
  }

  const grouped = groupThreads(threads);

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
        {grouped.size === 0 && (
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

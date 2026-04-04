import { useState, useEffect } from 'react';
import { useTaskStore } from '../stores/task-store.ts';
import { useExecutionStore } from '../stores/execution-store.ts';
import { useQueueStore } from '../stores/queue-store.ts';
import type { Execution, Task, QueueInfo } from '../types.ts';
import { StatusDot } from './StatusBadge.tsx';
import ExecutionDetail from './ExecutionDetail.tsx';

type PanelTab = 'tasks' | 'execs' | 'queues';

interface ControlPanelProps {
  collapsed: boolean;
  onCollapse: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
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

function execBadgeStyle(status: string): React.CSSProperties {
  if (status === 'completed') return { background: 'var(--green-dim)', color: 'var(--green)' };
  if (status === 'failed' || status === 'timed_out') return { background: 'var(--red-dim)', color: 'var(--red)' };
  if (status === 'running' || status === 'assigned') return { background: 'var(--yellow-dim)', color: 'var(--yellow)' };
  if (status === 'waiting_for_input') return { background: 'var(--blue-dim)', color: 'var(--blue)' };
  if (status === 'queued') return { background: 'var(--yellow-dim)', color: 'var(--yellow)' };
  return { background: 'var(--bg-active)', color: 'var(--text-muted)' };
}

function execBadgeLabel(status: string): string {
  const labels: Record<string, string> = {
    completed: 'done', running: 'run', failed: 'fail', queued: 'q',
    assigned: 'run', waiting_for_input: 'wait', timed_out: 'tout',
    cancelled: 'cancel', retry_scheduled: 'retry', dead_lettered: 'dlq',
  };
  return labels[status] ?? status.slice(0, 4);
}

// ---------------------------------------------------------------------------
// Tasks tab
// ---------------------------------------------------------------------------

function TasksTab({ search }: { search: string }) {
  const { tasks, fetchTasks, runTask } = useTaskStore();

  useEffect(() => {
    void fetchTasks();
    const id = setInterval(() => { void fetchTasks(); }, 10_000);
    return () => clearInterval(id);
  }, [fetchTasks]);

  const filtered = tasks.filter(
    (t) => !search || t.name.toLowerCase().includes(search.toLowerCase())
  );

  if (filtered.length === 0) {
    return <EmptyMessage message={search ? 'No matching tasks.' : 'No tasks yet.'} />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {filtered.map((task) => (
        <TaskItem key={task.id} task={task} onRun={() => void runTask(task.id)} />
      ))}
    </div>
  );
}

function TaskItem({ task, onRun }: { task: Task; onRun: () => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 10px',
        borderRadius: 7,
        cursor: 'pointer',
        background: hovered ? 'var(--bg-hover)' : 'transparent',
        transition: 'background 0.12s',
        marginBottom: 2,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: task.enabled ? 'var(--green)' : 'var(--text-muted)',
          flexShrink: 0,
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          className="mono"
          style={{
            fontSize: 12,
            fontWeight: 500,
            color: 'var(--text-primary)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {task.name}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
          {task.executionMode} · {task.executionType}
          {task.cronExpression ? ` · cron` : ''}
        </div>
      </div>
      {hovered && (
        <button
          onClick={(e) => { e.stopPropagation(); onRun(); }}
          style={{
            fontSize: 10,
            padding: '2px 8px',
            background: 'var(--accent)',
            border: 'none',
            borderRadius: 4,
            color: 'white',
            cursor: 'pointer',
            fontFamily: 'var(--font-body)',
            flexShrink: 0,
          }}
        >
          Run
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Executions tab
// ---------------------------------------------------------------------------

function ExecutionsTab({ search }: { search: string }) {
  const { executions, fetchExecutions } = useExecutionStore();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    void fetchExecutions();
    const id = setInterval(() => { void fetchExecutions(); }, 5000);
    return () => clearInterval(id);
  }, [fetchExecutions]);

  const filtered = executions.filter(
    (e) => !search || e.taskId.toLowerCase().includes(search.toLowerCase())
  );

  const selectedExecution = selectedId
    ? executions.find((e) => e.id === selectedId) ?? null
    : null;

  if (filtered.length === 0) {
    return <EmptyMessage message={search ? 'No matching executions.' : 'No executions yet.'} />;
  }

  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {filtered.slice(0, 20).map((exec) => (
          <ExecutionItem
            key={exec.id}
            execution={exec}
            active={exec.id === selectedId}
            onClick={() => setSelectedId(exec.id === selectedId ? null : exec.id)}
          />
        ))}
      </div>
      {selectedExecution && (
        <ExecutionDetail
          execution={selectedExecution}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}

function ExecutionItem({
  execution,
  active,
  onClick,
}: {
  execution: Execution;
  active: boolean;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const badge = execBadgeStyle(execution.status);

  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 10px',
        borderRadius: 7,
        cursor: 'pointer',
        background: active ? 'var(--bg-active)' : hovered ? 'var(--bg-hover)' : 'transparent',
        transition: 'background 0.12s',
        marginBottom: 2,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <StatusDot status={execution.status} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          className="mono"
          style={{
            fontSize: 12,
            fontWeight: 500,
            color: 'var(--text-primary)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {execution.taskId.slice(0, 20)}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
          {formatDuration(execution.durationMs)
            ? `${formatDuration(execution.durationMs)} · `
            : ''}
          {relativeTime(execution.createdAt)}
        </div>
      </div>
      <span
        className="mono"
        style={{
          fontSize: 10,
          padding: '2px 6px',
          borderRadius: 4,
          flexShrink: 0,
          ...badge,
        }}
      >
        {execBadgeLabel(execution.status)}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Queues tab
// ---------------------------------------------------------------------------

function QueuesTab({ search }: { search: string }) {
  const { queues, fetchQueues } = useQueueStore();

  useEffect(() => {
    void fetchQueues();
    const id = setInterval(() => { void fetchQueues(); }, 10_000);
    return () => clearInterval(id);
  }, [fetchQueues]);

  const filtered = queues.filter(
    (q) => !search || q.name.toLowerCase().includes(search.toLowerCase())
  );

  if (filtered.length === 0) {
    return <EmptyMessage message={search ? 'No matching queues.' : 'No queues found.'} />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {filtered.map((q) => (
        <QueueItem key={q.name} queue={q} />
      ))}
    </div>
  );
}

function QueueItem({ queue }: { queue: QueueInfo }) {
  const fillPct = queue.maxConcurrency > 0
    ? Math.min(100, (queue.activeCount / queue.maxConcurrency) * 100)
    : 0;

  return (
    <div
      style={{
        background: 'var(--bg-raised)',
        borderRadius: 6,
        padding: '8px 10px',
        border: '1px solid var(--border-subtle)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span className="mono" style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>
          {queue.name}
        </span>
        <span
          className="mono"
          style={{
            fontSize: 10,
            color: queue.depth > 0 ? 'var(--yellow)' : 'var(--text-muted)',
          }}
        >
          {queue.depth} queued
        </span>
      </div>
      {/* Concurrency bar */}
      <div
        style={{
          height: 3,
          background: 'var(--bg-active)',
          borderRadius: 2,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${fillPct}%`,
            height: '100%',
            background: fillPct > 80 ? 'var(--red)' : fillPct > 50 ? 'var(--yellow)' : 'var(--green)',
            borderRadius: 2,
            transition: 'width 0.3s ease',
          }}
        />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 10, color: 'var(--text-muted)' }}>
        <span>{queue.activeCount} active</span>
        <span>{queue.maxConcurrency} max</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

function EmptyMessage({ message }: { message: string }) {
  return (
    <p style={{ fontSize: 12, color: 'var(--text-muted)', padding: '12px 4px' }}>
      {message}
    </p>
  );
}

// ---------------------------------------------------------------------------
// ControlPanel — main component
// ---------------------------------------------------------------------------

export default function ControlPanel({ collapsed, onCollapse }: ControlPanelProps) {
  const [activeTab, setActiveTab] = useState<PanelTab>('execs');
  const [search, setSearch] = useState('');

  const tabLabels: { id: PanelTab; label: string }[] = [
    { id: 'tasks',  label: 'Tasks' },
    { id: 'execs',  label: 'Execs' },
    { id: 'queues', label: 'Queues' },
  ];

  return (
    <div
      style={{
        width: collapsed ? 0 : 320,
        minWidth: collapsed ? 0 : 320,
        opacity: collapsed ? 0 : 1,
        background: 'var(--bg-surface)',
        borderLeft: collapsed ? 'none' : '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        overflow: 'hidden',
        transition: 'width 0.2s ease, min-width 0.2s ease, opacity 0.15s ease',
        pointerEvents: collapsed ? 'none' : 'auto',
      }}
    >
      {/* Tabs row */}
      <div
        style={{
          display: 'flex',
          borderBottom: '1px solid var(--border)',
          padding: '0 4px',
          flexShrink: 0,
        }}
      >
        {/* Collapse button */}
        <button
          onClick={onCollapse}
          title="Collapse panel"
          style={{
            padding: '10px 10px',
            fontSize: 14,
            fontWeight: 700,
            color: 'var(--text-muted)',
            background: 'none',
            border: 'none',
            borderBottom: '2px solid transparent',
            cursor: 'pointer',
            transition: 'color 0.12s',
            fontFamily: 'var(--font-body)',
          }}
          onMouseEnter={(e) => ((e.target as HTMLButtonElement).style.color = 'var(--text-primary)')}
          onMouseLeave={(e) => ((e.target as HTMLButtonElement).style.color = 'var(--text-muted)')}
        >
          ›
        </button>

        {tabLabels.map((tab) => (
          <button
            key={tab.id}
            onClick={() => { setActiveTab(tab.id); setSearch(''); }}
            style={{
              padding: '10px 14px',
              fontSize: 12,
              fontWeight: 500,
              color: activeTab === tab.id ? 'var(--accent)' : 'var(--text-muted)',
              borderTop: 'none',
              borderLeft: 'none',
              borderRight: 'none',
              borderBottom: `2px solid ${activeTab === tab.id ? 'var(--accent)' : 'transparent'}`,
              background: 'none',
              cursor: 'pointer',
              transition: 'all 0.12s',
              fontFamily: 'var(--font-body)',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content area */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 12,
          minHeight: 0,
        }}
      >
        {/* Search bar */}
        <input
          type="text"
          placeholder={`Filter ${activeTab}...`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            width: '100%',
            background: 'var(--bg-raised)',
            border: '1px solid var(--border)',
            borderRadius: 7,
            padding: '7px 10px',
            fontFamily: 'var(--font-body)',
            fontSize: 12,
            color: 'var(--text-primary)',
            outline: 'none',
            marginBottom: 10,
            transition: 'border-color 0.15s',
          }}
          onFocus={(e) => ((e.target as HTMLInputElement).style.borderColor = 'var(--accent)')}
          onBlur={(e) => ((e.target as HTMLInputElement).style.borderColor = 'var(--border)')}
        />

        {/* Tab content */}
        {activeTab === 'tasks'  && <TasksTab search={search} />}
        {activeTab === 'execs'  && <ExecutionsTab search={search} />}
        {activeTab === 'queues' && <QueuesTab search={search} />}
      </div>
    </div>
  );
}

/** Expand button shown at the right edge when panel is collapsed */
export function ControlPanelExpandButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title="Expand panel"
      style={{
        position: 'fixed',
        top: '50%',
        right: 0,
        transform: 'translateY(-50%)',
        width: 24,
        height: 48,
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRight: 'none',
        borderRadius: '6px 0 0 6px',
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
        <polyline points="15 18 9 12 15 6" />
      </svg>
    </button>
  );
}

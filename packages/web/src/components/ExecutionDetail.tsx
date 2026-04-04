import { useState, useEffect } from 'react';
import type { Execution, ExecutionEvent } from '../types.ts';
import StatusBadge from './StatusBadge.tsx';
import EventTimeline from './EventTimeline.tsx';
import { useExecutionStore } from '../stores/execution-store.ts';

interface ExecutionDetailProps {
  execution: Execution;
  onClose: () => void;
}

type DetailTab = 'overview' | 'events' | 'logs' | 'tools';

function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function StatCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div
      style={{
        background: 'var(--bg-raised)',
        borderRadius: 6,
        padding: '8px 10px',
        textAlign: 'center',
      }}
    >
      <div
        style={{
          fontSize: 10,
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          marginBottom: 2,
        }}
      >
        {label}
      </div>
      <div
        className="mono"
        style={{ fontSize: 15, fontWeight: 600, color: color ?? 'var(--text-primary)' }}
      >
        {value}
      </div>
    </div>
  );
}

export default function ExecutionDetail({ execution, onClose }: ExecutionDetailProps) {
  const [activeTab, setActiveTab] = useState<DetailTab>('overview');
  const { selectedEvents, fetchExecutionEvents } = useExecutionStore();
  const [logs, setLogs] = useState<string>('');
  const [logSearch, setLogSearch] = useState('');

  useEffect(() => {
    if (activeTab === 'events') {
      void fetchExecutionEvents(execution.id);
    }
  }, [activeTab, execution.id, fetchExecutionEvents]);

  // Use execution output as "logs" (simplified; Plan B will provide proper log endpoint)
  useEffect(() => {
    if (activeTab === 'logs') {
      setLogs(execution.output ?? 'No log output.');
    }
  }, [activeTab, execution.output]);

  const tabs: { id: DetailTab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'events',   label: 'Events' },
    { id: 'logs',     label: 'Logs' },
    { id: 'tools',    label: 'Tools' },
  ];

  const toolInvocations = (() => {
    try {
      const parsed = execution.checkpointData ? JSON.parse(execution.checkpointData) : null;
      return (parsed?.toolCalls as Array<{ name: string; input: unknown; output: unknown; durationMs?: number }>) ?? [];
    } catch {
      return [];
    }
  })();

  const filteredLogs = logSearch
    ? logs.split('\n').filter((l) => l.toLowerCase().includes(logSearch.toLowerCase())).join('\n')
    : logs;

  return (
    <div
      style={{
        borderTop: '1px solid var(--border)',
        paddingTop: 12,
        marginTop: 12,
      }}
    >
      {/* Detail header */}
      <div
        style={{
          padding: '0 0 10px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
        }}
      >
        <div>
          <div
            className="mono"
            style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}
          >
            exec #{execution.id.slice(0, 6)}
          </div>
          <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)' }}>
            {execution.taskId.slice(0, 20)}
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            padding: 4,
            borderRadius: 4,
            display: 'flex',
            alignItems: 'center',
            fontSize: 16,
            lineHeight: 1,
          }}
          title="Close detail"
        >
          ×
        </button>
      </div>

      {/* Sub-tabs */}
      <div
        style={{
          display: 'flex',
          borderBottom: '1px solid var(--border)',
          marginBottom: 0,
        }}
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '8px 12px',
              fontSize: 11,
              fontWeight: 500,
              color: activeTab === tab.id ? 'var(--accent)' : 'var(--text-muted)',
              borderTop: 'none',
              borderLeft: 'none',
              borderRight: 'none',
              borderBottom: `2px solid ${activeTab === tab.id ? 'var(--accent)' : 'transparent'}`,
              background: 'none',
              cursor: 'pointer',
              fontFamily: 'var(--font-body)',
              transition: 'color 0.12s',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ paddingTop: 12 }}>
        {activeTab === 'overview' && (
          <OverviewTab execution={execution} />
        )}
        {activeTab === 'events' && (
          <div style={{ padding: '0 4px' }}>
            <EventTimeline events={selectedEvents} />
          </div>
        )}
        {activeTab === 'logs' && (
          <LogsTab logs={filteredLogs} search={logSearch} onSearch={setLogSearch} />
        )}
        {activeTab === 'tools' && (
          <ToolsTab invocations={toolInvocations} />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overview tab
// ---------------------------------------------------------------------------

function OverviewTab({ execution }: { execution: Execution }) {
  const { cancelExecution, retryExecution } = useExecutionStore();
  const statusColor =
    execution.status === 'completed' ? 'var(--green)' :
    execution.status === 'failed' || execution.status === 'timed_out' ? 'var(--red)' :
    execution.status === 'running' ? 'var(--yellow)' :
    'var(--text-secondary)';

  const tokens =
    execution.inputTokens != null
      ? `${execution.inputTokens} / ${execution.outputTokens}`
      : '—';

  return (
    <div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 8,
          marginBottom: 12,
        }}
      >
        <StatCard label="Status" value={execution.status} color={statusColor} />
        <StatCard label="Duration" value={formatDuration(execution.durationMs)} />
        <StatCard
          label="Attempt"
          value={`${execution.attempt} / ${execution.attempt}`}
        />
        <StatCard label="Tokens" value={tokens} />
      </div>

      {execution.error && (
        <div
          style={{
            background: 'var(--red-dim)',
            border: '1px solid rgba(239,68,68,0.2)',
            borderRadius: 6,
            padding: '8px 10px',
            marginBottom: 12,
          }}
        >
          <div
            style={{
              fontSize: 10,
              color: 'var(--red)',
              fontWeight: 600,
              marginBottom: 3,
              textTransform: 'uppercase',
              letterSpacing: '0.3px',
            }}
          >
            Error
          </div>
          <pre
            className="mono"
            style={{
              fontSize: 11,
              color: '#fca5a5',
              lineHeight: 1.4,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              margin: 0,
            }}
          >
            {execution.error}
          </pre>
        </div>
      )}

      <div style={{ display: 'flex', gap: 6 }}>
        {execution.status === 'failed' && (
          <ActionButton onClick={() => void retryExecution(execution.id)} variant="primary">
            Retry
          </ActionButton>
        )}
        {(execution.status === 'running' || execution.status === 'queued') && (
          <ActionButton onClick={() => void cancelExecution(execution.id)} variant="danger">
            Cancel
          </ActionButton>
        )}
        <StatusBadge status={execution.status} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Logs tab
// ---------------------------------------------------------------------------

function LogsTab({ logs, search, onSearch }: { logs: string; search: string; onSearch: (v: string) => void }) {
  return (
    <div>
      <input
        type="text"
        placeholder="Search logs..."
        value={search}
        onChange={(e) => onSearch(e.target.value)}
        style={{
          width: '100%',
          background: 'var(--bg-raised)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          padding: '6px 10px',
          fontSize: 11,
          color: 'var(--text-primary)',
          fontFamily: 'var(--font-body)',
          outline: 'none',
          marginBottom: 8,
        }}
      />
      <pre
        className="mono"
        style={{
          fontSize: 11,
          color: 'var(--text-secondary)',
          background: 'var(--bg-raised)',
          borderRadius: 6,
          padding: '8px 10px',
          overflow: 'auto',
          maxHeight: 300,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          margin: 0,
          lineHeight: 1.5,
        }}
      >
        {logs || 'No log output.'}
      </pre>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tools tab
// ---------------------------------------------------------------------------

type ToolInvocation = {
  name: string;
  input: unknown;
  output: unknown;
  durationMs?: number;
};

function ToolsTab({ invocations }: { invocations: ToolInvocation[] }) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  if (invocations.length === 0) {
    return (
      <p style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 0' }}>
        No tool invocations recorded.
      </p>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {invocations.map((inv, i) => (
        <div
          key={i}
          style={{
            background: 'var(--bg-raised)',
            borderRadius: 6,
            border: '1px solid var(--border-subtle)',
          }}
        >
          <button
            onClick={() => {
              const next = new Set(expanded);
              if (next.has(i)) next.delete(i);
              else next.add(i);
              setExpanded(next);
            }}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 10px',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontFamily: 'var(--font-body)',
            }}
          >
            <span className="mono" style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 500 }}>
              {inv.name}
            </span>
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
              {inv.durationMs != null ? `${inv.durationMs}ms` : ''}
            </span>
          </button>
          {expanded.has(i) && (
            <div style={{ padding: '0 10px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div>
                <p style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.3px' }}>
                  Input
                </p>
                <pre className="mono" style={{ fontSize: 10, color: 'var(--text-secondary)', margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {JSON.stringify(inv.input, null, 2)}
                </pre>
              </div>
              <div>
                <p style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.3px' }}>
                  Output
                </p>
                <pre className="mono" style={{ fontSize: 10, color: 'var(--text-secondary)', margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {JSON.stringify(inv.output, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Action button
// ---------------------------------------------------------------------------

function ActionButton({
  children,
  onClick,
  variant = 'default',
}: {
  children: React.ReactNode;
  onClick: () => void;
  variant?: 'default' | 'primary' | 'danger';
}) {
  const styles = {
    default: { background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-secondary)' },
    primary: { background: 'var(--accent)', border: '1px solid var(--accent)', color: 'white' },
    danger:  { background: 'transparent', border: '1px solid rgba(239,68,68,0.3)', color: 'var(--red)' },
  };
  return (
    <button
      onClick={onClick}
      style={{
        fontFamily: 'var(--font-body)',
        fontSize: 11,
        fontWeight: 500,
        padding: '4px 12px',
        borderRadius: 5,
        cursor: 'pointer',
        transition: 'all 0.12s',
        ...styles[variant],
      }}
    >
      {children}
    </button>
  );
}

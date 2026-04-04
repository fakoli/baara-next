import type { Task, Execution, QueueInfo, InputRequest } from '../types.ts';
import StatusBadge from './StatusBadge.tsx';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function borderColorForStatus(status: string): string {
  if (status === 'completed') return 'rgba(34, 197, 94, 0.3)';
  if (status === 'failed' || status === 'timed_out' || status === 'dead_lettered') return 'rgba(239, 68, 68, 0.3)';
  if (status === 'running' || status === 'assigned') return 'rgba(234, 179, 8, 0.3)';
  if (status === 'waiting_for_input') return 'rgba(59, 130, 246, 0.3)';
  return 'var(--border)';
}

// ---------------------------------------------------------------------------
// Task card
// ---------------------------------------------------------------------------

function TaskCard({
  task,
  onAction,
}: {
  task: Task;
  onAction?: (action: string, taskName: string) => void;
}) {
  return (
    <div
      style={{
        background: 'var(--bg-raised)',
        border: `1px solid ${task.enabled ? 'rgba(34,197,94,0.25)' : 'var(--border)'}`,
        borderRadius: 10,
        padding: 14,
        marginTop: 8,
        maxWidth: 420,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
          {task.name}
        </span>
        <span
          className="mono"
          style={{
            fontSize: 10,
            padding: '2px 8px',
            borderRadius: 10,
            fontWeight: 500,
            background: task.enabled ? 'var(--green-dim)' : 'var(--bg-active)',
            color: task.enabled ? 'var(--green)' : 'var(--text-muted)',
          }}
        >
          {task.enabled ? 'enabled' : 'disabled'}
        </span>
      </div>
      <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', fontSize: 12, marginBottom: 10 }}>
        <dt className="mono" style={{ color: 'var(--text-muted)', fontSize: 11 }}>type</dt>
        <dd style={{ color: 'var(--text-secondary)' }}>{task.executionType}</dd>
        <dt className="mono" style={{ color: 'var(--text-muted)', fontSize: 11 }}>mode</dt>
        <dd style={{ color: 'var(--text-secondary)' }}>{task.executionMode}</dd>
        {task.cronExpression && (
          <>
            <dt className="mono" style={{ color: 'var(--text-muted)', fontSize: 11 }}>cron</dt>
            <dd className="mono" style={{ color: 'var(--text-secondary)', fontSize: 11 }}>{task.cronExpression}</dd>
          </>
        )}
        <dt className="mono" style={{ color: 'var(--text-muted)', fontSize: 11 }}>priority</dt>
        <dd style={{ color: 'var(--text-secondary)' }}>{task.priority}</dd>
        {task.prompt && (
          <>
            <dt className="mono" style={{ color: 'var(--text-muted)', fontSize: 11 }}>prompt</dt>
            <dd
              className="mono"
              style={{
                color: 'var(--text-secondary)',
                fontSize: 11,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {task.prompt.slice(0, 80)}{task.prompt.length > 80 ? '…' : ''}
            </dd>
          </>
        )}
      </dl>
      {onAction && (
        <div
          style={{
            display: 'flex',
            gap: 6,
            paddingTop: 10,
            borderTop: '1px solid var(--border-subtle)',
          }}
        >
          <CardButton onClick={() => onAction('edit', task.name)}>Edit</CardButton>
          <CardButton variant="primary" onClick={() => onAction('run', task.name)}>Run Now</CardButton>
          <CardButton variant="danger" onClick={() => onAction('toggle', task.name)}>
            {task.enabled ? 'Disable' : 'Enable'}
          </CardButton>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Execution card
// ---------------------------------------------------------------------------

function ExecutionCard({
  execution,
  onAction,
}: {
  execution: Execution;
  onAction?: (action: string, id: string) => void;
}) {
  return (
    <div
      style={{
        background: 'var(--bg-raised)',
        border: `1px solid ${borderColorForStatus(execution.status)}`,
        borderRadius: 10,
        padding: 14,
        marginTop: 8,
        maxWidth: 420,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          exec #{execution.id.slice(0, 6)}
        </span>
        <StatusBadge status={execution.status} />
      </div>
      <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', fontSize: 12, marginBottom: 10 }}>
        <dt className="mono" style={{ color: 'var(--text-muted)', fontSize: 11 }}>duration</dt>
        <dd style={{ color: 'var(--text-secondary)' }}>{formatDuration(execution.durationMs)}</dd>
        <dt className="mono" style={{ color: 'var(--text-muted)', fontSize: 11 }}>attempt</dt>
        <dd style={{ color: 'var(--text-secondary)' }}>{execution.attempt}</dd>
        {execution.output && (
          <>
            <dt className="mono" style={{ color: 'var(--text-muted)', fontSize: 11 }}>output</dt>
            <dd
              className="mono"
              style={{
                color: execution.status === 'completed' ? 'var(--green)' : 'var(--text-secondary)',
                fontSize: 11,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {execution.output.slice(0, 100)}{execution.output.length > 100 ? '…' : ''}
            </dd>
          </>
        )}
        {execution.error && (
          <>
            <dt className="mono" style={{ color: 'var(--text-muted)', fontSize: 11 }}>error</dt>
            <dd
              className="mono"
              style={{ color: 'var(--red)', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {execution.error.slice(0, 100)}{execution.error.length > 100 ? '…' : ''}
            </dd>
          </>
        )}
      </dl>
      {onAction && (
        <div
          style={{
            display: 'flex',
            gap: 6,
            paddingTop: 10,
            borderTop: '1px solid var(--border-subtle)',
          }}
        >
          <CardButton onClick={() => onAction('view', execution.id)}>View Details</CardButton>
          {execution.status === 'failed' && (
            <CardButton variant="primary" onClick={() => onAction('retry', execution.id)}>Retry</CardButton>
          )}
          {(execution.status === 'running' || execution.status === 'queued') && (
            <CardButton variant="danger" onClick={() => onAction('cancel', execution.id)}>Cancel</CardButton>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// QueueInfo card
// ---------------------------------------------------------------------------

function QueueCard({ queues }: { queues: QueueInfo[] }) {
  return (
    <div
      style={{
        background: 'var(--bg-raised)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: 14,
        marginTop: 8,
        maxWidth: 420,
      }}
    >
      <p className="mono" style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8 }}>
        QUEUE STATUS
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {queues.map((q) => (
          <div key={q.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="mono" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{q.name}</span>
            <div style={{ display: 'flex', gap: 8, fontSize: 11 }}>
              <span style={{ color: 'var(--text-muted)' }}>depth:</span>
              <span className="mono" style={{ color: 'var(--text-primary)' }}>{q.depth}</span>
              <span style={{ color: 'var(--text-muted)' }}>active:</span>
              <span className="mono" style={{ color: q.activeCount > 0 ? 'var(--green)' : 'var(--text-primary)' }}>
                {q.activeCount}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// HITL (Human-In-The-Loop) card
// ---------------------------------------------------------------------------

function HitlCard({
  request,
  onRespond,
}: {
  request: InputRequest;
  onRespond?: (id: string, response: string) => void;
}) {
  return (
    <div
      style={{
        background: 'var(--bg-raised)',
        border: '1px solid rgba(59, 130, 246, 0.3)',
        borderRadius: 10,
        padding: 14,
        marginTop: 8,
        maxWidth: 420,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--blue)' }}>Input Required</span>
        <span className="mono" style={{ fontSize: 10, color: 'var(--text-muted)' }}>
          exec #{request.executionId.slice(0, 6)}
        </span>
      </div>
      <p style={{ fontSize: 13, color: 'var(--text-primary)', marginBottom: 10 }}>{request.prompt}</p>
      {request.options && request.options.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {request.options.map((opt) => (
            <CardButton key={opt} onClick={() => onRespond?.(request.id, opt)}>
              {opt}
            </CardButton>
          ))}
        </div>
      )}
      {request.status === 'pending' && !request.options?.length && onRespond && (
        <HitlInput requestId={request.id} onRespond={onRespond} />
      )}
      {request.status === 'responded' && (
        <p style={{ fontSize: 12, color: 'var(--green)' }}>
          Responded: {request.response}
        </p>
      )}
    </div>
  );
}

function HitlInput({
  requestId,
  onRespond,
}: {
  requestId: string;
  onRespond: (id: string, response: string) => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <input
        id={`hitl-${requestId}`}
        type="text"
        placeholder="Type your response..."
        style={{
          flex: 1,
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 5,
          padding: '5px 10px',
          fontSize: 12,
          color: 'var(--text-primary)',
          fontFamily: 'var(--font-body)',
          outline: 'none',
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            const val = (e.target as HTMLInputElement).value.trim();
            if (val) onRespond(requestId, val);
          }
        }}
      />
      <CardButton
        variant="primary"
        onClick={() => {
          const el = document.getElementById(`hitl-${requestId}`) as HTMLInputElement | null;
          const val = el?.value.trim();
          if (val) onRespond(requestId, val);
        }}
      >
        Submit
      </CardButton>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card button
// ---------------------------------------------------------------------------

type CardButtonVariant = 'default' | 'primary' | 'danger';

function CardButton({
  children,
  variant = 'default',
  onClick,
}: {
  children: React.ReactNode;
  variant?: CardButtonVariant;
  onClick?: () => void;
}) {
  const baseStyle: React.CSSProperties = {
    fontFamily: 'var(--font-body)',
    fontSize: 11,
    fontWeight: 500,
    padding: '4px 12px',
    borderRadius: 5,
    cursor: 'pointer',
    transition: 'all 0.12s',
  };

  const variantStyles: Record<CardButtonVariant, React.CSSProperties> = {
    default: {
      background: 'var(--bg-surface)',
      border: '1px solid var(--border)',
      color: 'var(--text-secondary)',
    },
    primary: {
      background: 'var(--accent)',
      border: '1px solid var(--accent)',
      color: 'white',
    },
    danger: {
      background: 'transparent',
      border: '1px solid rgba(239,68,68,0.3)',
      color: 'var(--red)',
    },
  };

  return (
    <button style={{ ...baseStyle, ...variantStyles[variant] }} onClick={onClick}>
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main InlineCard component — detects type and renders appropriate card
// ---------------------------------------------------------------------------

interface InlineCardProps {
  data: unknown;
  onAction?: (action: string, id: string) => void;
  onHitlRespond?: (requestId: string, response: string) => void;
}

function isTask(data: unknown): data is Task {
  return (
    typeof data === 'object' &&
    data !== null &&
    'executionType' in data &&
    'executionMode' in data &&
    'prompt' in data
  );
}

function isExecution(data: unknown): data is Execution {
  return (
    typeof data === 'object' &&
    data !== null &&
    'taskId' in data &&
    'status' in data &&
    'attempt' in data
  );
}

function isQueueInfoArray(data: unknown): data is QueueInfo[] {
  return (
    Array.isArray(data) &&
    data.length > 0 &&
    typeof data[0] === 'object' &&
    data[0] !== null &&
    'depth' in data[0] &&
    'maxConcurrency' in data[0]
  );
}

function isInputRequest(data: unknown): data is InputRequest {
  return (
    typeof data === 'object' &&
    data !== null &&
    'executionId' in data &&
    'prompt' in data &&
    'status' in data
  );
}

export default function InlineCard({ data, onAction, onHitlRespond }: InlineCardProps) {
  if (isTask(data)) {
    return <TaskCard task={data} onAction={onAction} />;
  }
  if (isExecution(data)) {
    return <ExecutionCard execution={data} onAction={onAction} />;
  }
  if (isQueueInfoArray(data)) {
    return <QueueCard queues={data} />;
  }
  if (isInputRequest(data)) {
    return <HitlCard request={data} onRespond={onHitlRespond} />;
  }

  // Fallback: raw JSON display
  return (
    <div
      style={{
        background: 'var(--bg-raised)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: '10px 14px',
        marginTop: 8,
        maxWidth: 420,
      }}
    >
      <pre
        className="mono"
        style={{
          fontSize: 11,
          color: 'var(--text-secondary)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
          margin: 0,
        }}
      >
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}

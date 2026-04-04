import type { ExecutionStatus } from '../types.ts';

interface StatusBadgeProps {
  status: ExecutionStatus;
  size?: 'sm' | 'md';
}

interface StatusStyle {
  bg: string;
  color: string;
  label: string;
}

const STATUS_STYLES: Record<ExecutionStatus, StatusStyle> = {
  created:          { bg: 'var(--bg-raised)',   color: 'var(--text-secondary)', label: 'Created' },
  queued:           { bg: 'var(--yellow-dim)',   color: 'var(--yellow)',         label: 'Queued' },
  assigned:         { bg: 'var(--blue-dim)',     color: 'var(--blue)',           label: 'Assigned' },
  running:          { bg: 'var(--yellow-dim)',   color: 'var(--yellow)',         label: 'Running' },
  waiting_for_input:{ bg: 'var(--blue-dim)',     color: 'var(--blue)',           label: 'Awaiting Input' },
  completed:        { bg: 'var(--green-dim)',    color: 'var(--green)',          label: 'Completed' },
  failed:           { bg: 'var(--red-dim)',      color: 'var(--red)',            label: 'Failed' },
  timed_out:        { bg: 'var(--red-dim)',      color: 'var(--red)',            label: 'Timed Out' },
  cancelled:        { bg: 'var(--bg-raised)',    color: 'var(--text-muted)',     label: 'Cancelled' },
  retry_scheduled:  { bg: 'var(--accent-glow)', color: 'var(--accent)',         label: 'Retry Scheduled' },
  dead_lettered:    { bg: 'var(--red-dim)',      color: 'var(--red)',            label: 'Dead Lettered' },
};

export default function StatusBadge({ status, size = 'sm' }: StatusBadgeProps) {
  const style = STATUS_STYLES[status] ?? { bg: 'var(--bg-raised)', color: 'var(--text-secondary)', label: status };
  const padding = size === 'sm' ? '2px 8px' : '4px 12px';
  const fontSize = size === 'sm' ? '10px' : '12px';

  return (
    <span
      className="inline-flex items-center font-medium rounded-full mono"
      style={{
        background: style.bg,
        color: style.color,
        padding,
        fontSize,
        fontWeight: 500,
      }}
    >
      {style.label}
    </span>
  );
}

/** Compact status dot for inline use */
export function StatusDot({ status }: { status: ExecutionStatus }) {
  const style = STATUS_STYLES[status] ?? { color: 'var(--text-muted)', bg: '', label: '' };
  const hasGlow = ['running', 'queued', 'assigned'].includes(status);
  return (
    <span
      className="inline-block rounded-full flex-shrink-0"
      style={{
        width: 7,
        height: 7,
        background: style.color,
        boxShadow: hasGlow ? `0 0 5px ${style.color}` : 'none',
      }}
    />
  );
}

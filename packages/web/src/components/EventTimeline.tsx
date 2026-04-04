import type { ExecutionEvent } from '../types.ts';

interface EventTimelineProps {
  events: ExecutionEvent[];
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

// Summarize the extra fields on an event (everything except standard keys)
const STANDARD_EVENT_KEYS = new Set(['id', 'executionId', 'eventSeq', 'type', 'timestamp']);

function summarizeEvent(event: Record<string, unknown>): string {
  const entries = Object.entries(event).filter(([k]) => !STANDARD_EVENT_KEYS.has(k));
  if (entries.length === 0) return '';
  return entries
    .slice(0, 2)
    .map(([k, v]) => {
      const str = typeof v === 'string' ? v : JSON.stringify(v);
      return `${k}: ${str.length > 60 ? str.slice(0, 60) + '…' : str}`;
    })
    .join(' · ');
}

const EVENT_DOT_COLORS: Record<string, string> = {
  created:           'var(--text-muted)',
  queued:            'var(--yellow)',
  assigned:          'var(--blue)',
  running:           'var(--yellow)',
  waiting_for_input: 'var(--blue)',
  completed:         'var(--green)',
  failed:            'var(--red)',
  timed_out:         'var(--red)',
  cancelled:         'var(--text-muted)',
  retry_scheduled:   'var(--accent)',
  dead_lettered:     'var(--red)',
};

function getEventDotColor(type: string): string {
  return EVENT_DOT_COLORS[type] ?? 'var(--text-muted)';
}

export default function EventTimeline({ events }: EventTimelineProps) {
  if (events.length === 0) {
    return (
      <p style={{ fontSize: 12, color: 'var(--text-muted)', padding: '16px 0' }}>
        No events recorded.
      </p>
    );
  }

  return (
    <ol
      style={{
        listStyle: 'none',
        margin: 0,
        padding: 0,
        borderLeft: '1px solid var(--border)',
        paddingLeft: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}
    >
      {events.map((event) => {
        const dotColor = getEventDotColor(event.type);
        const summary = summarizeEvent(event as Record<string, unknown>);
        return (
          <li key={event.id} style={{ position: 'relative' }}>
            {/* Timeline dot */}
            <span
              style={{
                position: 'absolute',
                left: -26,
                top: 4,
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: dotColor,
                border: '1px solid var(--bg-surface)',
                display: 'inline-block',
              }}
            />
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span
                className="mono"
                style={{ fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}
              >
                {formatTime(event.timestamp)}
              </span>
              <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>
                {event.type}
              </span>
            </div>
            {summary && (
              <p
                className="mono"
                style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.4 }}
              >
                {summary}
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}

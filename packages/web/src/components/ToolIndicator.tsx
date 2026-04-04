interface ToolIndicatorProps {
  name: string;
  /** Optional label shown to the right of the tool name (e.g. task name) */
  detail?: string;
  /** Whether this tool is still running (shows spinner) vs completed */
  completed?: boolean;
}

export default function ToolIndicator({ name, detail, completed = false }: ToolIndicatorProps) {
  return (
    <div
      className="mono"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 12px',
        background: 'var(--accent-glow)',
        border: '1px solid rgba(99,102,241,0.2)',
        borderRadius: 8,
        fontSize: 11,
        color: 'var(--accent)',
        marginTop: 4,
        marginBottom: 4,
      }}
    >
      {completed ? (
        /* Checkmark icon */
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          style={{ flexShrink: 0 }}
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        /* Spinning indicator */
        <div className="tool-spinner" />
      )}
      <span>{name}</span>
      {detail && (
        <span style={{ color: 'var(--text-muted)' }}>→ {detail}</span>
      )}
    </div>
  );
}

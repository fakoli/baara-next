import { useChatStore } from '../stores/chat-store.ts';

interface ToolIndicatorProps {
  name: string;
  /** Optional label shown to the right of the tool name (e.g. task name) */
  detail?: string;
  /** Whether this tool is still running (shows spinner) vs completed */
  completed?: boolean;
  /**
   * When provided, match the pending permission by requestId rather than tool
   * name to avoid false matches when the same tool appears multiple times (#7).
   */
  requestId?: string;
}

export default function ToolIndicator({ name, detail, completed = false, requestId }: ToolIndicatorProps) {
  const { pendingPermission, respondToPermission } = useChatStore();

  // Check whether THIS tool indicator is the one awaiting approval.
  // Prefer matching by requestId when available; fall back to tool name.
  const isPending = pendingPermission !== null && (
    requestId !== undefined
      ? pendingPermission.requestId === requestId
      : pendingPermission.toolName === name
  );

  if (isPending && pendingPermission) {
    return (
      <div
        className="mono"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          padding: '10px 12px',
          background: 'rgba(234, 179, 8, 0.06)',
          border: '1px solid rgba(234, 179, 8, 0.3)',
          borderRadius: 8,
          fontSize: 11,
          color: 'var(--text-primary)',
          marginTop: 4,
          marginBottom: 4,
        }}
      >
        {/* Header row: warning icon + tool name */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#eab308' }}>
          {/* Warning triangle */}
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            style={{ flexShrink: 0 }}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
            />
          </svg>
          <span style={{ fontWeight: 600 }}>{name}</span>
          {detail && (
            <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>→ {detail}</span>
          )}
        </div>

        {/* Action buttons row */}
        <div style={{ display: 'flex', gap: 6 }}>
          <PermissionButton
            label="Allow"
            onClick={() => respondToPermission(pendingPermission.requestId, 'allow')}
            color="#22c55e"
            hoverBg="rgba(34,197,94,0.12)"
            icon={
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <polyline points="20 6 9 17 4 12" />
              </svg>
            }
          />
          <PermissionButton
            label="Allow for task"
            onClick={() => respondToPermission(pendingPermission.requestId, 'allow_task')}
            color="#6366f1"
            hoverBg="rgba(99,102,241,0.12)"
            icon={
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <polyline points="20 6 9 17 4 12" />
              </svg>
            }
          />
          <PermissionButton
            label="Deny"
            onClick={() => respondToPermission(pendingPermission.requestId, 'deny')}
            color="#ef4444"
            hoverBg="rgba(239,68,68,0.12)"
            icon={
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            }
          />
        </div>
      </div>
    );
  }

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

// ---------------------------------------------------------------------------
// Internal helper: styled approval button
// ---------------------------------------------------------------------------

interface PermissionButtonProps {
  label: string;
  onClick: () => void;
  color: string;
  hoverBg: string;
  icon: React.ReactNode;
}

function PermissionButton({ label, onClick, color, hoverBg, icon }: PermissionButtonProps) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '3px 10px',
        background: 'transparent',
        border: `1px solid ${color}`,
        borderRadius: 5,
        color,
        fontSize: 11,
        cursor: 'pointer',
        fontFamily: 'var(--font-mono)',
        transition: 'background 0.12s',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = hoverBg;
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
      }}
    >
      {icon}
      {label}
    </button>
  );
}

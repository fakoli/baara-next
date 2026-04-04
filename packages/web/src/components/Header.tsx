import { useEffect } from 'react';
import { useExecutionStore } from '../stores/execution-store.ts';

export default function Header() {
  const { executions, fetchExecutions } = useExecutionStore();

  useEffect(() => {
    void fetchExecutions();
    const id = setInterval(() => { void fetchExecutions(); }, 5000);
    return () => clearInterval(id);
  }, [fetchExecutions]);

  const running = executions.filter((e) => e.status === 'running').length;
  const queued  = executions.filter(
    (e) => e.status === 'queued' || e.status === 'assigned'
  ).length;
  const failed  = executions.filter((e) => e.status === 'failed').length;

  return (
    <header
      style={{
        height: 44,
        background: 'var(--bg-surface)',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 16px',
        position: 'relative',
        zIndex: 10,
        flexShrink: 0,
      }}
    >
      {/* Accent underline gradient */}
      <div
        style={{
          position: 'absolute',
          bottom: -1,
          left: 0,
          right: 0,
          height: 1,
          background: 'linear-gradient(90deg, transparent, var(--accent) 30%, var(--accent) 70%, transparent)',
          opacity: 0.3,
        }}
      />

      {/* Brand */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div
          style={{
            width: 22,
            height: 22,
            background: 'var(--accent)',
            borderRadius: 5,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'var(--font-mono)',
            fontWeight: 700,
            fontSize: 11,
            color: 'white',
            letterSpacing: '-0.5px',
          }}
        >
          B
        </div>
        <span
          style={{
            fontWeight: 600,
            fontSize: 14,
            color: 'var(--text-primary)',
            letterSpacing: '-0.3px',
          }}
        >
          BAARA Next
        </span>
        <span
          className="mono"
          style={{
            fontSize: 10,
            color: 'var(--text-muted)',
            background: 'var(--bg-raised)',
            padding: '2px 6px',
            borderRadius: 4,
            border: '1px solid var(--border-subtle)',
          }}
        >
          v0.1.0
        </span>
      </div>

      {/* Right side: stats + avatar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        {/* Live stats */}
        <div
          className="mono"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            fontSize: 11,
          }}
        >
          <StatItem count={running} color="var(--green)"  label="running" glow />
          <span style={{ color: 'var(--border)', fontSize: 10 }}>·</span>
          <StatItem count={queued}  color="var(--yellow)" label="queued"  glow />
          <span style={{ color: 'var(--border)', fontSize: 10 }}>·</span>
          <StatItem count={failed}  color="var(--red)"    label="failed" />
        </div>

        {/* Avatar */}
        <div
          style={{
            width: 26,
            height: 26,
            background: 'var(--bg-active)',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 10,
            fontWeight: 600,
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            border: '1px solid var(--border)',
          }}
          title="Account"
        >
          SD
        </div>
      </div>
    </header>
  );
}

function StatItem({
  count,
  color,
  label,
  glow,
}: {
  count: number;
  color: string;
  label: string;
  glow?: boolean;
}) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: color,
          boxShadow: glow && count > 0 ? `0 0 6px ${color}` : 'none',
          display: 'inline-block',
        }}
      />
      <span style={{ color: count > 0 ? color : 'var(--text-muted)' }}>{count}</span>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
    </span>
  );
}

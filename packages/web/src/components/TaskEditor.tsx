import { useState, useEffect } from 'react';
import type { Task, ExecutionType, ExecutionMode, Priority } from '../types.ts';
import { updateTask } from '../lib/api.ts';
import { useTaskStore } from '../stores/task-store.ts';
import { useThreadStore } from '../stores/thread-store.ts';

/** Mirror of MAIN_THREAD_ID from @baara-next/core — kept client-side to avoid a build dep. */
const MAIN_THREAD_ID = '00000000-0000-0000-0000-000000000000';

interface TaskEditorProps {
  task: Task;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Shared inline field styles matching the ControlPanel aesthetic
// ---------------------------------------------------------------------------

const fieldStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--bg-active)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '5px 8px',
  color: 'var(--text-primary)',
  fontFamily: 'var(--font-body)',
  fontSize: 12,
  outline: 'none',
  boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--text-muted)',
  marginBottom: 3,
  display: 'block',
};

export default function TaskEditor({ task, onClose }: TaskEditorProps) {
  const fetchTasks = useTaskStore((s) => s.fetchTasks);
  const { threads, fetchThreads } = useThreadStore();

  const [name, setName] = useState(task.name);
  const [prompt, setPrompt] = useState(task.prompt);
  const [executionType, setExecutionType] = useState<ExecutionType>(task.executionType);
  const [executionMode, setExecutionMode] = useState<ExecutionMode>(task.executionMode);
  const [priority, setPriority] = useState<Priority>(task.priority);
  const [cronExpression, setCronExpression] = useState(task.cronExpression ?? '');
  const [maxRetries, setMaxRetries] = useState(task.maxRetries);
  const [timeoutMs, setTimeoutMs] = useState(task.timeoutMs);
  const [targetThreadId, setTargetThreadId] = useState<string>(
    task.targetThreadId ?? MAIN_THREAD_ID
  );

  // agentConfig fields
  const [allowedTools, setAllowedTools] = useState(
    task.agentConfig?.allowedTools?.join(', ') ?? ''
  );
  const [model, setModel] = useState(task.agentConfig?.model ?? '');
  const [budgetUsd, setBudgetUsd] = useState<string>(
    task.agentConfig?.budgetUsd != null ? String(task.agentConfig.budgetUsd) : ''
  );
  const [systemPrompt, setSystemPrompt] = useState(
    task.agentConfig?.systemPrompt ?? ''
  );

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    void fetchThreads();
  }, [fetchThreads]);

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      // Validate budgetUsd before saving (#10)
      if (budgetUsd.trim()) {
        const parsedBudget = Number(budgetUsd);
        if (isNaN(parsedBudget) || parsedBudget < 0) {
          setSaveError('Budget (USD) must be a non-negative number');
          setSaving(false);
          return;
        }
      }

      const agentConfig = {
        ...(task.agentConfig ?? {}),
        ...(model.trim() ? { model: model.trim() } : {}),
        ...(allowedTools.trim()
          ? { allowedTools: allowedTools.split(',').map((s) => s.trim()).filter(Boolean) }
          : {}),
        ...(budgetUsd.trim() ? { budgetUsd: Number(budgetUsd) } : {}),
        ...(systemPrompt.trim() ? { systemPrompt: systemPrompt.trim() } : {}),
      };

      await updateTask(task.id, {
        name: name.trim(),
        prompt: prompt.trim(),
        executionType,
        executionMode,
        priority,
        cronExpression: cronExpression.trim() || null,
        maxRetries,
        timeoutMs,
        agentConfig: Object.keys(agentConfig).length > 0 ? agentConfig : null,
        // Store null when Main thread is chosen so the orchestrator's default
        // routing logic applies (saves storage and handles Main thread renames).
        targetThreadId: targetThreadId === MAIN_THREAD_ID ? null : targetThreadId,
      });

      // Refresh the task list so the sidebar reflects the new values
      await fetchTasks();
      onClose();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  // Build dropdown options: Main thread first, then all other threads.
  const threadOptions = [
    { id: MAIN_THREAD_ID, label: 'Main Thread (default)' },
    ...threads
      .filter((t) => t.id !== MAIN_THREAD_ID)
      .map((t) => ({ id: t.id, label: t.title || 'Untitled thread' })),
  ];

  return (
    <div
      style={{
        background: 'var(--bg-raised)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: 12,
        marginTop: 4,
        marginBottom: 4,
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--accent)',
          marginBottom: 10,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}
      >
        Edit Task
      </div>

      {saveError && (
        <div
          style={{
            fontSize: 11,
            color: 'var(--red)',
            background: 'var(--red-dim)',
            padding: '4px 8px',
            borderRadius: 4,
            marginBottom: 8,
          }}
        >
          {saveError}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {/* Name */}
        <div>
          <label style={labelStyle}>Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={fieldStyle}
          />
        </div>

        {/* Prompt */}
        <div>
          <label style={labelStyle}>Prompt</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            style={{ ...fieldStyle, resize: 'vertical', minHeight: 64 }}
          />
        </div>

        {/* Pre-request Instructions (systemPrompt) */}
        <div>
          <label style={labelStyle}>Pre-request Instructions</label>
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            rows={3}
            placeholder="Directives injected before each request to the agent..."
            style={{ ...fieldStyle, resize: 'vertical', minHeight: 52 }}
          />
        </div>

        {/* Execution Type + Mode */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div>
            <label style={labelStyle}>Execution Type</label>
            <select
              value={executionType}
              onChange={(e) => setExecutionType(e.target.value as ExecutionType)}
              style={fieldStyle}
            >
              <option value="cloud_code">cloud_code</option>
              <option value="shell">shell</option>
              <option value="wasm">wasm</option>
              <option value="wasm_edge">wasm_edge</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>Execution Mode</label>
            <select
              value={executionMode}
              onChange={(e) => setExecutionMode(e.target.value as ExecutionMode)}
              style={fieldStyle}
            >
              <option value="queued">queued</option>
              <option value="direct">direct</option>
            </select>
          </div>
        </div>

        {/* Priority + Cron */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div>
            <label style={labelStyle}>Priority</label>
            <select
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value) as Priority)}
              style={fieldStyle}
            >
              <option value={0}>0 — Critical</option>
              <option value={1}>1 — High</option>
              <option value={2}>2 — Normal</option>
              <option value={3}>3 — Low</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>Cron Expression</label>
            <input
              type="text"
              value={cronExpression}
              onChange={(e) => setCronExpression(e.target.value)}
              placeholder="*/5 * * * *"
              style={fieldStyle}
            />
          </div>
        </div>

        {/* Max Retries + Timeout */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div>
            <label style={labelStyle}>Max Retries</label>
            <input
              type="number"
              min={0}
              max={10}
              value={maxRetries}
              onChange={(e) => setMaxRetries(Number(e.target.value))}
              style={fieldStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Timeout (ms)</label>
            <input
              type="number"
              min={1000}
              step={1000}
              value={timeoutMs}
              onChange={(e) => setTimeoutMs(Number(e.target.value))}
              style={fieldStyle}
            />
          </div>
        </div>

        {/* Output Thread */}
        <div>
          <label style={labelStyle}>Output Thread</label>
          <select
            value={targetThreadId}
            onChange={(e) => setTargetThreadId(e.target.value)}
            style={fieldStyle}
          >
            {threadOptions.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Agent config section */}
        <div
          style={{
            borderTop: '1px solid var(--border-subtle)',
            paddingTop: 8,
            marginTop: 2,
          }}
        >
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, fontWeight: 600 }}>
            Agent Config
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div>
              <label style={labelStyle}>Model</label>
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="e.g. claude-sonnet-4-20250514"
                style={fieldStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Allowed Tools (comma-separated)</label>
              <input
                type="text"
                value={allowedTools}
                onChange={(e) => setAllowedTools(e.target.value)}
                placeholder="list_tasks, run_task, ..."
                style={fieldStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Budget (USD)</label>
              <input
                type="number"
                min={0}
                step={0.01}
                value={budgetUsd}
                onChange={(e) => setBudgetUsd(e.target.value)}
                placeholder="0.50"
                style={fieldStyle}
              />
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 4 }}>
          <button
            onClick={onClose}
            style={{
              padding: '4px 12px',
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 5,
              color: 'var(--text-secondary)',
              fontSize: 11,
              cursor: 'pointer',
              fontFamily: 'var(--font-body)',
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={saving}
            style={{
              padding: '4px 12px',
              background: saving ? 'var(--bg-active)' : 'var(--accent)',
              border: 'none',
              borderRadius: 5,
              color: 'white',
              fontSize: 11,
              cursor: saving ? 'not-allowed' : 'pointer',
              fontFamily: 'var(--font-body)',
              opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

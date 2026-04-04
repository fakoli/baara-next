import { useEffect, useState } from 'react';
import { useExecutionStore } from '../stores/execution-store.ts';
import { useTaskStore } from '../stores/task-store.ts';
import type { Execution, ExecutionStatus } from '../types.ts';
import StatusBadge from '../components/StatusBadge.tsx';
import Modal from '../components/Modal.tsx';
import EventTimeline from '../components/EventTimeline.tsx';

const ALL_STATUSES: ExecutionStatus[] = [
  'created', 'queued', 'assigned', 'running', 'waiting_for_input',
  'completed', 'failed', 'timed_out', 'cancelled', 'retry_scheduled', 'dead_lettered',
];

function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

interface ExecutionDetailProps {
  execution: Execution;
  taskName?: string;
  onClose: () => void;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
}

function ExecutionDetail({ execution, taskName, onClose, onCancel, onRetry }: ExecutionDetailProps) {
  const { selectedEvents, fetchExecutionEvents } = useExecutionStore();

  useEffect(() => {
    fetchExecutionEvents(execution.id);
  }, [execution.id, fetchExecutionEvents]);

  const canCancel = ['queued', 'assigned', 'running', 'waiting_for_input'].includes(execution.status);
  const canRetry = ['failed', 'timed_out', 'dead_lettered', 'cancelled'].includes(execution.status);

  return (
    <Modal title={`Execution ${execution.id.slice(0, 8)}…`} onClose={onClose}>
      <div className="space-y-5">
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="font-medium text-gray-500">Task</dt>
            <dd className="text-gray-900 mt-0.5">{taskName ?? execution.taskId.slice(0, 12) + '…'}</dd>
          </div>
          <div>
            <dt className="font-medium text-gray-500">Status</dt>
            <dd className="mt-0.5"><StatusBadge status={execution.status} /></dd>
          </div>
          <div>
            <dt className="font-medium text-gray-500">Attempt</dt>
            <dd className="text-gray-900 mt-0.5">#{execution.attempt}</dd>
          </div>
          <div>
            <dt className="font-medium text-gray-500">Duration</dt>
            <dd className="text-gray-900 mt-0.5">{formatDuration(execution.durationMs)}</dd>
          </div>
          <div>
            <dt className="font-medium text-gray-500">Queue</dt>
            <dd className="text-gray-900 mt-0.5">{execution.queueName}</dd>
          </div>
          <div>
            <dt className="font-medium text-gray-500">Health</dt>
            <dd className="text-gray-900 mt-0.5">{execution.healthStatus}</dd>
          </div>
          <div>
            <dt className="font-medium text-gray-500">Turns</dt>
            <dd className="text-gray-900 mt-0.5">{execution.turnCount}</dd>
          </div>
          {(execution.inputTokens != null || execution.outputTokens != null) && (
            <div>
              <dt className="font-medium text-gray-500">Tokens</dt>
              <dd className="text-gray-900 mt-0.5">
                {execution.inputTokens ?? 0} in / {execution.outputTokens ?? 0} out
              </dd>
            </div>
          )}
          <div>
            <dt className="font-medium text-gray-500">Created</dt>
            <dd className="text-gray-900 mt-0.5">{new Date(execution.createdAt).toLocaleString()}</dd>
          </div>
          {execution.startedAt && (
            <div>
              <dt className="font-medium text-gray-500">Started</dt>
              <dd className="text-gray-900 mt-0.5">{new Date(execution.startedAt).toLocaleString()}</dd>
            </div>
          )}
          {execution.completedAt && (
            <div>
              <dt className="font-medium text-gray-500">Completed</dt>
              <dd className="text-gray-900 mt-0.5">{new Date(execution.completedAt).toLocaleString()}</dd>
            </div>
          )}
        </dl>

        {execution.output && (
          <div>
            <p className="text-sm font-medium text-gray-500 mb-1">Output</p>
            <pre className="text-xs bg-gray-50 border border-gray-200 rounded p-3 overflow-auto max-h-40 whitespace-pre-wrap">
              {execution.output}
            </pre>
          </div>
        )}

        {execution.error && (
          <div>
            <p className="text-sm font-medium text-red-500 mb-1">Error</p>
            <pre className="text-xs bg-red-50 border border-red-200 rounded p-3 overflow-auto max-h-32 whitespace-pre-wrap text-red-800">
              {execution.error}
            </pre>
          </div>
        )}

        <div className="flex gap-2">
          {canCancel && (
            <button
              onClick={() => onCancel(execution.id)}
              className="px-3 py-1.5 text-sm border border-red-200 text-red-700 rounded hover:bg-red-50 transition-colors"
            >
              Cancel
            </button>
          )}
          {canRetry && (
            <button
              onClick={() => onRetry(execution.id)}
              className="px-3 py-1.5 text-sm border border-indigo-200 text-indigo-700 rounded hover:bg-indigo-50 transition-colors"
            >
              Retry
            </button>
          )}
        </div>

        <div>
          <p className="text-sm font-medium text-gray-700 mb-3">Event Timeline</p>
          <EventTimeline events={selectedEvents} />
        </div>
      </div>
    </Modal>
  );
}

export default function Executions() {
  const { executions, filters, loading, error, fetchExecutions, cancelExecution, retryExecution, setFilters } = useExecutionStore();
  const { tasks, fetchTasks } = useTaskStore();
  const [selectedExecution, setSelectedExecution] = useState<Execution | null>(null);

  const taskMap = new Map(tasks.map((t) => [t.id, t.name]));

  useEffect(() => {
    fetchTasks();
    fetchExecutions();
  }, [fetchTasks, fetchExecutions]);

  useEffect(() => {
    fetchExecutions();
  }, [filters, fetchExecutions]);

  async function handleCancel(id: string) {
    try {
      await cancelExecution(id);
    } catch {
      // error handled in store
    }
  }

  async function handleRetry(id: string) {
    try {
      await retryExecution(id);
      setSelectedExecution(null);
    } catch {
      // error handled in store
    }
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Executions</h1>
          <p className="text-sm text-gray-500 mt-1">{executions.length} execution{executions.length !== 1 ? 's' : ''}</p>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3">
          <select
            value={filters.status ?? ''}
            onChange={(e) => setFilters({ ...filters, status: (e.target.value as ExecutionStatus) || undefined })}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">All statuses</option>
            {ALL_STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <button
            onClick={() => fetchExecutions()}
            className="p-1.5 rounded border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors"
            title="Refresh"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading && executions.length === 0 ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
          <span className="ml-3 text-sm text-gray-500">Loading executions…</span>
        </div>
      ) : executions.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-base">No executions found.</p>
          {filters.status && <p className="text-sm mt-1">Try clearing the status filter.</p>}
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">ID</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Task</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Attempt</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Duration</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {executions.map((exec) => (
                <tr
                  key={exec.id}
                  className="hover:bg-gray-50 cursor-pointer"
                  onClick={() => setSelectedExecution(exec)}
                >
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">
                    {exec.id.slice(0, 8)}…
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700">
                    {taskMap.get(exec.taskId) ?? exec.taskId.slice(0, 12) + '…'}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={exec.status} />
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">#{exec.attempt}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{formatDuration(exec.durationMs)}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {new Date(exec.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedExecution && (
        <ExecutionDetail
          execution={selectedExecution}
          taskName={taskMap.get(selectedExecution.taskId)}
          onClose={() => setSelectedExecution(null)}
          onCancel={handleCancel}
          onRetry={handleRetry}
        />
      )}
    </div>
  );
}

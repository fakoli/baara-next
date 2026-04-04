import { useEffect } from 'react';
import { useQueueStore } from '../stores/queue-store.ts';
import { useExecutionStore } from '../stores/execution-store.ts';
import StatusBadge from '../components/StatusBadge.tsx';

function QueueBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="h-1.5 rounded-full bg-gray-100 mt-2">
      <div
        className="h-1.5 rounded-full bg-indigo-500 transition-all"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export default function Queues() {
  const { queues, loading, error, fetchQueues } = useQueueStore();
  const { executions, fetchExecutions, retryExecution } = useExecutionStore();

  useEffect(() => {
    fetchQueues();
    fetchExecutions();

    const interval = setInterval(() => {
      fetchQueues();
      fetchExecutions();
    }, 5000);
    return () => clearInterval(interval);
  }, [fetchQueues, fetchExecutions]);

  const dlqItems = executions.filter((e) => e.status === 'dead_lettered');

  async function handleRetry(id: string) {
    try {
      await retryExecution(id);
    } catch {
      // error handled in store
    }
  }

  return (
    <div className="p-8 space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Queues</h1>
        <p className="text-sm text-gray-500 mt-1">Live queue metrics — auto-refreshes every 5 seconds</p>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading && queues.length === 0 ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
          <span className="ml-3 text-sm text-gray-500">Loading queues…</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {queues.map((q) => {
            const utilisation = q.maxConcurrency > 0 ? q.activeCount / q.maxConcurrency : 0;
            return (
              <div key={q.name} className="bg-white rounded-lg border border-gray-200 shadow-sm p-5">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-gray-800 uppercase tracking-wide">{q.name}</p>
                  {q.name === 'dlq' && (
                    <span className="text-xs font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded">DLQ</span>
                  )}
                </div>

                <div className="mt-4 space-y-2 text-sm">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-500">Depth</span>
                    <span className="font-semibold text-gray-900">{q.depth}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-500">Active</span>
                    <span className="font-semibold text-gray-900">{q.activeCount}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-500">Max Concurrency</span>
                    <span className="font-semibold text-gray-900">{q.maxConcurrency}</span>
                  </div>
                </div>

                <div className="mt-3">
                  <div className="flex justify-between text-xs text-gray-400 mb-1">
                    <span>Utilisation</span>
                    <span>{Math.round(utilisation * 100)}%</span>
                  </div>
                  <QueueBar value={q.activeCount} max={q.maxConcurrency} />
                </div>
              </div>
            );
          })}

          {queues.length === 0 && (
            <div className="col-span-full text-center py-12 text-gray-400">
              No queues reported.
            </div>
          )}
        </div>
      )}

      {/* Dead Letter Queue section */}
      <div>
        <h2 className="text-base font-medium text-gray-700 mb-3">
          Dead Letter Queue
          {dlqItems.length > 0 && (
            <span className="ml-2 text-xs font-semibold bg-red-100 text-red-700 px-2 py-0.5 rounded-full">
              {dlqItems.length}
            </span>
          )}
        </h2>

        {dlqItems.length === 0 ? (
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm px-6 py-8 text-center text-sm text-gray-400">
            No dead-lettered executions.
          </div>
        ) : (
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Execution ID</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Attempt</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Error</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {dlqItems.map((exec) => (
                  <tr key={exec.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">{exec.id.slice(0, 8)}…</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={exec.status} />
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">#{exec.attempt}</td>
                    <td className="px-4 py-3 text-sm text-red-600 max-w-xs truncate">
                      {exec.error ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleRetry(exec.id)}
                        className="text-xs px-3 py-1 rounded border border-indigo-200 text-indigo-700 hover:bg-indigo-50 transition-colors"
                      >
                        Retry
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

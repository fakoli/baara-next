import { useEffect } from 'react';
import { useTaskStore } from '../stores/task-store.ts';
import { useExecutionStore } from '../stores/execution-store.ts';
import { useQueueStore } from '../stores/queue-store.ts';
import StatCard from '../components/StatCard.tsx';

function ServerIcon() {
  return (
    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2" />
    </svg>
  );
}

function BoltIcon() {
  return (
    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
  );
}

function QueueIcon() {
  return (
    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
    </svg>
  );
}

function SkullIcon() {
  return (
    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 2C7.03 2 3 6.03 3 11c0 2.83 1.22 5.37 3.17 7.12V20a1 1 0 001 1h1.5a1 1 0 001-1v-.5h4.66V20a1 1 0 001 1H17a1 1 0 001-1v-1.88C19.78 16.37 21 13.83 21 11c0-4.97-4.03-9-9-9zM9 14a1 1 0 110-2 1 1 0 010 2zm6 0a1 1 0 110-2 1 1 0 010 2z" />
    </svg>
  );
}

function InboxIcon() {
  return (
    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
    </svg>
  );
}

export default function Dashboard() {
  const { tasks, fetchTasks } = useTaskStore();
  const { executions, fetchExecutions } = useExecutionStore();
  const { queues, systemStatus, fetchQueues, fetchSystemStatus } = useQueueStore();

  useEffect(() => {
    fetchTasks();
    fetchExecutions();
    fetchQueues();
    fetchSystemStatus();

    const interval = setInterval(() => {
      fetchExecutions();
      fetchSystemStatus();
    }, 5000);

    return () => clearInterval(interval);
  }, [fetchTasks, fetchExecutions, fetchQueues, fetchSystemStatus]);

  const enabledCount = tasks.filter((t) => t.enabled).length;
  const disabledCount = tasks.length - enabledCount;
  const activeExecs = executions.filter((e) =>
    ['running', 'assigned', 'queued', 'waiting_for_input', 'retry_scheduled'].includes(e.status)
  ).length;
  const deadLettered = systemStatus?.totals.deadLettered ?? executions.filter((e) => e.status === 'dead_lettered').length;
  const pendingInput = systemStatus?.totals.waitingForInput ?? executions.filter((e) => e.status === 'waiting_for_input').length;
  const totalQueueDepth = queues.reduce((sum, q) => sum + q.depth, 0);

  return (
    <div className="p-8 space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">System overview — auto-refreshes every 5 seconds</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        <StatCard
          label={`Tasks · ${enabledCount} enabled, ${disabledCount} disabled`}
          value={tasks.length}
          icon={<ServerIcon />}
        />
        <StatCard
          label="Active Executions"
          value={activeExecs}
          icon={<BoltIcon />}
        />
        <StatCard
          label="Total Queue Depth"
          value={totalQueueDepth}
          icon={<QueueIcon />}
        />
        <StatCard
          label="Dead-Lettered"
          value={deadLettered}
          icon={<SkullIcon />}
          colorClass={deadLettered > 0 ? 'bg-red-50' : 'bg-white'}
        />
        <StatCard
          label="Pending Input"
          value={pendingInput}
          icon={<InboxIcon />}
          colorClass={pendingInput > 0 ? 'bg-blue-50' : 'bg-white'}
        />
      </div>

      {/* Queue breakdown */}
      {queues.length > 0 && (
        <div>
          <h2 className="text-base font-medium text-gray-700 mb-3">Queue Breakdown</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            {queues.map((q) => (
              <div key={q.name} className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
                <p className="text-sm font-semibold text-gray-800 uppercase tracking-wide">{q.name}</p>
                <div className="mt-2 space-y-1 text-sm text-gray-600">
                  <div className="flex justify-between">
                    <span>Depth</span>
                    <span className="font-medium text-gray-900">{q.depth}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Active</span>
                    <span className="font-medium text-gray-900">{q.activeCount}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Concurrency</span>
                    <span className="font-medium text-gray-900">{q.maxConcurrency}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useTaskStore } from '../stores/task-store.ts';
import type { Task } from '../types.ts';
import Modal from '../components/Modal.tsx';
import CreateTaskForm from '../components/CreateTaskForm.tsx';
import { runTask as apiRunTask } from '../lib/api.ts';

const PRIORITY_LABELS: Record<number, string> = {
  0: 'Critical',
  1: 'High',
  2: 'Normal',
  3: 'Low',
};

interface TaskDetailProps {
  task: Task;
  onClose: () => void;
}

function TaskDetail({ task, onClose }: TaskDetailProps) {
  return (
    <Modal title={task.name} onClose={onClose}>
      <dl className="space-y-3 text-sm">
        <div>
          <dt className="font-medium text-gray-500">ID</dt>
          <dd className="font-mono text-gray-900 mt-0.5 break-all">{task.id}</dd>
        </div>
        {task.description && (
          <div>
            <dt className="font-medium text-gray-500">Description</dt>
            <dd className="text-gray-900 mt-0.5">{task.description}</dd>
          </div>
        )}
        <div>
          <dt className="font-medium text-gray-500">Prompt</dt>
          <dd className="text-gray-900 mt-0.5 whitespace-pre-wrap font-mono text-xs bg-gray-50 rounded p-3 border border-gray-200">
            {task.prompt}
          </dd>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <dt className="font-medium text-gray-500">Type</dt>
            <dd className="text-gray-900 mt-0.5">{task.executionType}</dd>
          </div>
          <div>
            <dt className="font-medium text-gray-500">Mode</dt>
            <dd className="text-gray-900 mt-0.5">{task.executionMode}</dd>
          </div>
          <div>
            <dt className="font-medium text-gray-500">Priority</dt>
            <dd className="text-gray-900 mt-0.5">{PRIORITY_LABELS[task.priority] ?? task.priority}</dd>
          </div>
          <div>
            <dt className="font-medium text-gray-500">Max Retries</dt>
            <dd className="text-gray-900 mt-0.5">{task.maxRetries}</dd>
          </div>
          <div>
            <dt className="font-medium text-gray-500">Timeout</dt>
            <dd className="text-gray-900 mt-0.5">{task.timeoutMs.toLocaleString()} ms</dd>
          </div>
          {task.cronExpression && (
            <div>
              <dt className="font-medium text-gray-500">Cron</dt>
              <dd className="font-mono text-gray-900 mt-0.5">{task.cronExpression}</dd>
            </div>
          )}
          <div>
            <dt className="font-medium text-gray-500">Queue</dt>
            <dd className="text-gray-900 mt-0.5">{task.targetQueue}</dd>
          </div>
          <div>
            <dt className="font-medium text-gray-500">Status</dt>
            <dd className="mt-0.5">
              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${task.enabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
                {task.enabled ? 'Enabled' : 'Disabled'}
              </span>
            </dd>
          </div>
        </div>
        <div>
          <dt className="font-medium text-gray-500">Created</dt>
          <dd className="text-gray-900 mt-0.5">{new Date(task.createdAt).toLocaleString()}</dd>
        </div>
        <div>
          <dt className="font-medium text-gray-500">Updated</dt>
          <dd className="text-gray-900 mt-0.5">{new Date(task.updatedAt).toLocaleString()}</dd>
        </div>
      </dl>
    </Modal>
  );
}

export default function Tasks() {
  const { tasks, loading, error, fetchTasks, toggleTask, deleteTask } = useTaskStore();
  const [showCreate, setShowCreate] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  async function handleToggle(id: string) {
    setActionError(null);
    try {
      await toggleTask(id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Toggle failed');
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this task? This cannot be undone.')) return;
    setActionError(null);
    try {
      await deleteTask(id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  async function handleRun(id: string) {
    setActionError(null);
    try {
      await apiRunTask(id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Run failed');
    }
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Tasks</h1>
          <p className="text-sm text-gray-500 mt-1">{tasks.length} task{tasks.length !== 1 ? 's' : ''}</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Task
        </button>
      </div>

      {(error || actionError) && (
        <div className="mb-4 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error ?? actionError}
        </div>
      )}

      {loading && tasks.length === 0 ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
          <span className="ml-3 text-sm text-gray-500">Loading tasks…</span>
        </div>
      ) : tasks.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-base">No tasks yet.</p>
          <p className="text-sm mt-1">Create your first task to get started.</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Mode</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Priority</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Cron</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Enabled</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {tasks.map((task) => (
                <tr
                  key={task.id}
                  className="hover:bg-gray-50 cursor-pointer"
                  onClick={() => setSelectedTask(task)}
                >
                  <td className="px-4 py-3">
                    <p className="text-sm font-medium text-gray-900">{task.name}</p>
                    {task.description && (
                      <p className="text-xs text-gray-400 mt-0.5 truncate max-w-xs">{task.description}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">{task.executionType}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{task.executionMode}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{PRIORITY_LABELS[task.priority] ?? task.priority}</td>
                  <td className="px-4 py-3 text-sm font-mono text-gray-500">
                    {task.cronExpression ?? <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${task.enabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'}`}>
                      {task.enabled ? 'Yes' : 'No'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => handleToggle(task.id)}
                        className="text-xs px-2 py-1 rounded border border-gray-200 text-gray-600 hover:bg-gray-100 transition-colors"
                        title={task.enabled ? 'Disable' : 'Enable'}
                      >
                        {task.enabled ? 'Disable' : 'Enable'}
                      </button>
                      <button
                        onClick={() => handleRun(task.id)}
                        className="text-xs px-2 py-1 rounded border border-indigo-200 text-indigo-700 hover:bg-indigo-50 transition-colors"
                        title="Run now"
                      >
                        Run
                      </button>
                      <button
                        onClick={() => handleDelete(task.id)}
                        className="text-xs px-2 py-1 rounded border border-red-200 text-red-600 hover:bg-red-50 transition-colors"
                        title="Delete"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <Modal title="Create Task" onClose={() => setShowCreate(false)}>
          <CreateTaskForm
            onSuccess={() => setShowCreate(false)}
            onCancel={() => setShowCreate(false)}
          />
        </Modal>
      )}

      {selectedTask && (
        <TaskDetail task={selectedTask} onClose={() => setSelectedTask(null)} />
      )}
    </div>
  );
}

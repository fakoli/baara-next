import type {
  Task,
  CreateTaskInput,
  UpdateTaskInput,
  Execution,
  ExecutionEvent,
  InputRequest,
  QueueInfo,
  SystemStatus,
  ExecutionStatus,
  Thread,
  SSEEvent,
  ThreadMessage,
  PermissionMode,
} from '../types.ts';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export function fetchTasks(): Promise<Task[]> {
  return request<Task[]>('/api/tasks');
}

export function fetchTask(id: string): Promise<Task> {
  return request<Task>(`/api/tasks/${id}`);
}

export function createTask(input: CreateTaskInput): Promise<Task> {
  return request<Task>('/api/tasks', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateTask(id: string, input: UpdateTaskInput): Promise<Task> {
  return request<Task>(`/api/tasks/${id}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export function deleteTask(id: string): Promise<void> {
  return request<void>(`/api/tasks/${id}`, { method: 'DELETE' });
}

export function runTask(id: string): Promise<Execution> {
  return request<Execution>(`/api/tasks/${id}/run`, { method: 'POST' });
}

// ---------------------------------------------------------------------------
// Executions
// ---------------------------------------------------------------------------

export interface FetchExecutionsOptions {
  status?: ExecutionStatus;
  taskId?: string;
  limit?: number;
  // Note: offset is not sent — the server's GET /api/executions route does not
  // support pagination yet. Add server-side support before re-enabling this.
}

export function fetchExecutions(opts?: FetchExecutionsOptions): Promise<Execution[]> {
  const params = new URLSearchParams();
  if (opts?.status) params.set('status', opts.status);
  if (opts?.taskId) params.set('taskId', opts.taskId);
  if (opts?.limit != null) params.set('limit', String(opts.limit));
  const qs = params.toString();
  return request<Execution[]>(`/api/executions${qs ? `?${qs}` : ''}`);
}

export function fetchExecution(id: string): Promise<Execution> {
  return request<Execution>(`/api/executions/${id}`);
}

export function fetchExecutionEvents(id: string): Promise<ExecutionEvent[]> {
  return request<ExecutionEvent[]>(`/api/executions/${id}/events`);
}

export function cancelExecution(id: string): Promise<{ ok: boolean }> {
  // Server returns { ok: true } — callers should refetch the execution to get
  // the updated state rather than relying on the response body.
  return request<{ ok: boolean }>(`/api/executions/${id}/cancel`, { method: 'POST' });
}

export function retryExecution(id: string): Promise<Execution> {
  return request<Execution>(`/api/executions/${id}/retry`, { method: 'POST' });
}

export function provideInput(id: string, response: string): Promise<InputRequest> {
  return request<InputRequest>(`/api/executions/${id}/input`, {
    method: 'POST',
    body: JSON.stringify({ response }),
  });
}

// ---------------------------------------------------------------------------
// Queues
// ---------------------------------------------------------------------------

export function fetchQueues(): Promise<QueueInfo[]> {
  return request<QueueInfo[]>('/api/queues');
}

export function updateQueueConcurrency(name: string, maxConcurrency: number): Promise<QueueInfo> {
  return request<QueueInfo>(`/api/queues/${encodeURIComponent(name)}`, {
    method: 'PUT',
    body: JSON.stringify({ maxConcurrency }),
  });
}

// ---------------------------------------------------------------------------
// System
// ---------------------------------------------------------------------------

export function fetchSystemStatus(): Promise<SystemStatus> {
  return request<SystemStatus>('/api/system/status');
}

// ---------------------------------------------------------------------------
// Threads / Sessions
// ---------------------------------------------------------------------------

export function fetchThreads(): Promise<Thread[]> {
  return request<Thread[]>('/api/chat/sessions');
}

export function fetchThread(id: string): Promise<Thread> {
  return request<Thread>(`/api/chat/sessions/${id}`);
}

export function renameThread(id: string, title: string): Promise<Thread> {
  return request<Thread>(`/api/chat/sessions/${id}/rename`, {
    method: 'PUT',
    body: JSON.stringify({ title }),
  });
}

export function fetchThreadMessages(threadId: string): Promise<ThreadMessage[]> {
  return request<ThreadMessage[]>(`/api/chat/sessions/${threadId}/messages`);
}

// ---------------------------------------------------------------------------
// Chat — SSE streaming via fetch + ReadableStream
//
// Returns an AsyncGenerator that yields parsed SSEEvent objects.
// The caller is responsible for cancelling the AbortController on unmount.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

export type PermissionDecision = 'allow' | 'allow_task' | 'deny';

export function respondToPermission(
  requestId: string,
  decision: PermissionDecision,
  sessionId: string
): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>('/api/chat/permission', {
    method: 'POST',
    body: JSON.stringify({ requestId, decision, sessionId }),
  });
}

export async function* streamChat(
  message: string,
  opts: {
    sessionId?: string;
    threadId?: string;
    activeProjectId?: string | null;
    permissionMode?: PermissionMode;
    model?: string;
    systemInstructions?: string;
    signal?: AbortSignal;
  }
): AsyncGenerator<SSEEvent> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      sessionId: opts.sessionId,
      threadId: opts.threadId,
      activeProjectId: opts.activeProjectId,
      permissionMode: opts.permissionMode ?? 'auto',
      model: opts.model,
      systemInstructions: opts.systemInstructions,
    }),
    signal: opts.signal,
  });

  if (!res.ok || !res.body) {
    throw new Error(`Chat API ${res.status}: ${await res.text().catch(() => res.statusText)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    const lines = buf.split('\n');
    buf = lines.pop() ?? '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const raw = line.slice(6).trim();
        if (!raw) continue;
        try {
          yield JSON.parse(raw) as SSEEvent;
        } catch {
          // malformed line — skip
        }
      }
    }
  }
}

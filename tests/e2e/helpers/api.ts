// tests/e2e/helpers/api.ts
//
// Typed API client for BAARA Next E2E tests.
// All methods use Node's built-in fetch() and communicate with the backend
// over HTTP.  No Bun-specific APIs are used — this file runs on Node (Playwright).

// ---------------------------------------------------------------------------
// Minimal local type mirrors — kept here to avoid a cross-workspace import
// from @baara-next/core, which uses Bun module resolution incompatible with
// the Playwright Node runner.
// ---------------------------------------------------------------------------

export interface Task {
  id: string;
  name: string;
  description: string;
  prompt: string;
  timeoutMs: number;
  priority: number;
  targetQueue: string;
  maxRetries: number;
  executionMode: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

export interface Execution {
  id: string;
  taskId: string;
  status: string;
  attempt: number;
  scheduledAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  durationMs?: number | null;
  output?: string | null;
  error?: string | null;
  [key: string]: unknown;
}

export interface Thread {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ThreadMessage {
  id: string;
  threadId: string;
  role: "user" | "agent";
  content: string;
  toolCalls: string;
  createdAt: string;
}

export interface SystemStatus {
  uptime: number;
  version: string;
  queues: Record<string, { depth: number; active: number }>;
  totals: {
    queued: number;
    active: number;
    deadLettered: number;
    waitingForInput: number;
  };
}

export interface CreateTaskOptions {
  name: string;
  prompt: string;
  description?: string;
  executionMode?: "direct" | "queued";
  timeoutMs?: number;
  sandboxType?: "native" | "wasm" | "docker";
  maxRetries?: number;
  priority?: 0 | 1 | 2 | 3;
  targetQueue?: string;
  enabled?: boolean;
  projectId?: string | null;
  targetThreadId?: string | null;
}

// Terminal execution statuses — polling stops when any of these is reached.
const TERMINAL_STATUSES = new Set([
  "completed",
  "failed",
  "cancelled",
  "dead_lettered",
  "timed_out",
]);

// ---------------------------------------------------------------------------
// APIClient
// ---------------------------------------------------------------------------

export interface APIClient {
  createTask(opts: CreateTaskOptions): Promise<Task>;
  runTask(taskId: string): Promise<Execution>;
  getExecution(id: string): Promise<Execution>;
  waitForExecution(id: string, timeoutMs?: number): Promise<Execution>;
  listThreads(): Promise<Thread[]>;
  getThreadMessages(threadId: string): Promise<ThreadMessage[]>;
  getSystemStatus(): Promise<SystemStatus>;
  deleteTask(id: string): Promise<void>;
}

/**
 * Create a typed API client bound to `apiURL` (the backend base URL,
 * e.g. "http://localhost:34512").
 */
export function createAPIClient(apiURL: string): APIClient {
  const base = apiURL.replace(/\/$/, "");

  async function apiFetch<T>(
    path: string,
    init?: RequestInit
  ): Promise<T> {
    const url = `${base}${path}`;
    const res = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers as Record<string, string> | undefined),
      },
      ...init,
    });

    if (!res.ok) {
      let message = `${res.status} ${res.statusText}`;
      try {
        const body = (await res.json()) as { error?: string };
        if (body.error) message = body.error;
      } catch {
        // ignore JSON parse errors on error responses
      }
      throw new Error(`API ${init?.method ?? "GET"} ${path} failed: ${message}`);
    }

    return res.json() as Promise<T>;
  }

  return {
    // POST /api/tasks — returns the created Task (201)
    async createTask(opts: CreateTaskOptions): Promise<Task> {
      return apiFetch<Task>("/api/tasks", {
        method: "POST",
        body: JSON.stringify(opts),
      });
    },

    // POST /api/tasks/:id/run — returns the Execution (the server wraps
    // orchestrator.runDirect() which returns an Execution).
    async runTask(taskId: string): Promise<Execution> {
      return apiFetch<Execution>(`/api/tasks/${taskId}/run`, {
        method: "POST",
      });
    },

    // GET /api/executions/:id
    async getExecution(id: string): Promise<Execution> {
      return apiFetch<Execution>(`/api/executions/${id}`);
    },

    // Poll GET /api/executions/:id every 500 ms until a terminal status is
    // reached, or `timeoutMs` elapses (default: 30 000 ms).
    async waitForExecution(
      id: string,
      timeoutMs = 30_000
    ): Promise<Execution> {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const execution = await apiFetch<Execution>(`/api/executions/${id}`);
        if (TERMINAL_STATUSES.has(execution.status)) {
          return execution;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      throw new Error(
        `waitForExecution timed out after ${timeoutMs}ms for execution ${id}`
      );
    },

    // GET /api/chat/sessions — list all threads (sessions)
    async listThreads(): Promise<Thread[]> {
      return apiFetch<Thread[]>("/api/chat/sessions");
    },

    // GET /api/chat/sessions/:id/messages — chat history for a thread
    async getThreadMessages(threadId: string): Promise<ThreadMessage[]> {
      return apiFetch<ThreadMessage[]>(
        `/api/chat/sessions/${threadId}/messages`
      );
    },

    // GET /api/system/status
    async getSystemStatus(): Promise<SystemStatus> {
      return apiFetch<SystemStatus>("/api/system/status");
    },

    // DELETE /api/tasks/:id
    async deleteTask(id: string): Promise<void> {
      await apiFetch<{ ok: boolean }>(`/api/tasks/${id}`, {
        method: "DELETE",
      });
    },
  };
}

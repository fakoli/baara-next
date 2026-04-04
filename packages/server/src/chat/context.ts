// @baara-next/server — Chat context gathering
//
// Reads live IStore state for use in the dynamic system prompt.
// Keeps all DB access in one place so the prompt builder stays pure.

import type { IStore } from "@baara-next/core";
import type { Thread, Execution } from "@baara-next/core";

export interface ChatContext {
  // System-level counts
  totalTasks: number;
  enabledTasks: number;
  runningCount: number;
  queuedCount: number;
  failedCount: number;
  waitingForInputCount: number;

  // Queue health snapshot
  queues: Array<{
    name: string;
    depth: number;
    activeCount: number;
    maxConcurrency: number;
  }>;

  // Recent failures (last 5, most recent first)
  recentFailures: Array<{
    id: string;
    taskId: string;
    error: string | null;
    failedAt: string | null;
  }>;

  // Thread context (present only when threadId is supplied)
  thread: Thread | null;
  threadExecutions: Array<{
    id: string;
    taskId: string;
    status: string;
    durationMs: number | null;
    error: string | null;
    createdAt: string;
  }>;

  // Active project scoping (null if no project active in session)
  activeProjectId: string | null;
}

export function gatherChatContext(
  store: IStore,
  opts: { threadId?: string; activeProjectId?: string | null } = {}
): ChatContext {
  const tasks = store.listTasks();

  // Use O(1) COUNT(*) queries instead of a single LIMIT 200 scan so counts
  // are accurate regardless of total execution volume.
  const runningCount = store.countExecutionsByStatus("running");
  const queuedCount = store.countExecutionsByStatus("queued")
    + store.countExecutionsByStatus("assigned");
  const failedCount = store.countExecutionsByStatus("failed");
  const waitingForInputCount = store.countExecutionsByStatus("waiting_for_input");

  // Last 5 failed executions — fetch a small page (already DESC by the store).
  const recentFailures: ChatContext["recentFailures"] = store.listAllExecutions({ status: "failed", limit: 5 })
    .filter((e) => e.error)
    .map((e) => ({
      id: e.id,
      taskId: e.taskId,
      error: e.error ?? null,
      failedAt: e.completedAt ?? null,
    }));

  const queueInfos = store.listQueues();
  const queues: ChatContext["queues"] = queueInfos.map((q) => ({
    name: q.name,
    depth: q.depth,
    activeCount: q.activeCount,
    maxConcurrency: q.maxConcurrency,
  }));

  // Thread context — only populated when a threadId is provided
  let thread: Thread | null = null;
  let threadExecutions: ChatContext["threadExecutions"] = [];

  if (opts.threadId) {
    thread = store.getThread(opts.threadId) ?? null;
    if (thread) {
      const execs: Execution[] = store.listExecutionsByThread(opts.threadId);
      threadExecutions = execs.map((e) => ({
        id: e.id,
        taskId: e.taskId,
        status: e.status,
        durationMs: e.durationMs ?? null,
        error: e.error ?? null,
        createdAt: e.createdAt,
      }));
    }
  }

  return {
    totalTasks: tasks.length,
    enabledTasks: tasks.filter((t) => t.enabled).length,
    runningCount,
    queuedCount,
    failedCount,
    waitingForInputCount,
    queues,
    recentFailures,
    thread,
    threadExecutions,
    activeProjectId: opts.activeProjectId ?? null,
  };
}

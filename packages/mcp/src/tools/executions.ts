// @baara-next/mcp — Execution tools (9 tools)
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { IStore, IOrchestratorService } from "@baara-next/core";
import { ok, err, notFound, resolveTask } from "../helpers.ts";

export function createExecutionTools(deps: {
  store: IStore;
  orchestrator: IOrchestratorService;
  /** Path to the JSONL logs directory. When provided, get_execution_logs reads from JSONL files. */
  logsDir?: string;
}) {
  const { store, orchestrator } = deps;

  // 1. run_task — execute immediately in direct mode
  const runTask = tool(
    "run_task",
    "Execute a task immediately in direct mode (bypasses queue). May take 30+ seconds.",
    { nameOrId: z.string().describe("Task name or UUID") },
    async ({ nameOrId }) => {
      const task = resolveTask(store, nameOrId);
      if (!task) return notFound(nameOrId);
      try {
        const execution = await orchestrator.runDirect(task.id);
        return ok(execution);
      } catch (e) {
        return err(`Execution failed: ${String(e)}`);
      }
    }
  );

  // 2. submit_task — dispatch to queue
  const submitTask = tool(
    "submit_task",
    "Submit a task to the execution queue and return immediately",
    { nameOrId: z.string().describe("Task name or UUID") },
    async ({ nameOrId }) => {
      const task = resolveTask(store, nameOrId);
      if (!task) return notFound(nameOrId);
      try {
        const execution = await orchestrator.submitTask(task.id);
        return ok(execution);
      } catch (e) {
        return err(`Submit failed: ${String(e)}`);
      }
    }
  );

  // 3. list_executions — execution history for a task
  const listExecutions = tool(
    "list_executions",
    "List executions for a task with optional status filter and limit",
    {
      taskNameOrId: z.string().describe("Task name or UUID"),
      status: z.enum([
        "created", "queued", "assigned", "running", "waiting_for_input",
        "completed", "failed", "timed_out", "cancelled", "retry_scheduled", "dead_lettered",
      ]).optional().describe("Filter to a specific status"),
      limit: z.number().int().min(1).max(200).optional().describe("Max executions to return (default: 50)"),
    },
    async ({ taskNameOrId, status, limit }) => {
      const task = resolveTask(store, taskNameOrId);
      if (!task) return notFound(taskNameOrId);
      const executions = store.listExecutions(task.id, { status, limit });
      return ok(
        executions.map((e) => ({
          id: e.id,
          status: e.status,
          attempt: e.attempt,
          scheduledAt: e.scheduledAt,
          startedAt: e.startedAt ?? null,
          completedAt: e.completedAt ?? null,
          durationMs: e.durationMs ?? null,
          healthStatus: e.healthStatus,
          turnCount: e.turnCount,
          error: e.error ?? null,
        }))
      );
    }
  );

  // 4. get_execution — full execution detail
  const getExecution = tool(
    "get_execution",
    "Get full details of an execution by ID",
    { executionId: z.string().describe("Execution UUID") },
    async ({ executionId }) => {
      const execution = store.getExecution(executionId);
      if (!execution) return err(`Execution not found: ${executionId}`);
      return ok(execution);
    }
  );

  // 5. get_execution_events — event timeline
  const getExecutionEvents = tool(
    "get_execution_events",
    "Get the event timeline for an execution in ascending order",
    {
      executionId: z.string().describe("Execution UUID"),
      afterSeq: z.number().int().min(0).optional().describe("Return only events with seq > this value (for paging)"),
      limit: z.number().int().min(1).max(500).optional().describe("Max events to return"),
    },
    async ({ executionId, afterSeq, limit }) => {
      const execution = store.getExecution(executionId);
      if (!execution) return err(`Execution not found: ${executionId}`);
      const events = store.listEvents(executionId, { afterSeq, limit });
      return ok(events);
    }
  );

  // 6. cancel_execution
  const cancelExecution = tool(
    "cancel_execution",
    "Cancel a running or queued execution",
    { executionId: z.string().describe("Execution UUID") },
    async ({ executionId }) => {
      try {
        await orchestrator.cancelExecution(executionId);
        return ok({ cancelled: true, executionId });
      } catch (e) {
        return err(`Cancel failed: ${String(e)}`);
      }
    }
  );

  // 7. retry_execution
  const retryExecution = tool(
    "retry_execution",
    "Manually retry a failed or timed-out execution",
    { executionId: z.string().describe("Execution UUID to retry") },
    async ({ executionId }) => {
      try {
        const newExecution = await orchestrator.retryExecution(executionId);
        return ok(newExecution);
      } catch (e) {
        return err(`Retry failed: ${String(e)}`);
      }
    }
  );

  // 8. get_system_status — system health overview
  const getSystemStatus = tool(
    "get_system_status",
    "Get system health overview: task counts, queue depths, dead-lettered count",
    {},
    async () => {
      const tasks = store.listTasks();
      const queues = store.listQueues();
      const deadLettered = store.getDeadLetteredExecutions();
      const pendingInput = store.getPendingInputExecutions();
      // Use O(1) COUNT(*) queries so counts are accurate regardless of total
      // execution volume.
      const running = store.countExecutionsByStatus("running");
      const queued = store.countExecutionsByStatus("queued");
      const failed = store.countExecutionsByStatus("failed");
      return ok({
        tasks: {
          total: tasks.length,
          enabled: tasks.filter((t) => t.enabled).length,
          withCron: tasks.filter((t) => t.cronExpression).length,
        },
        queues: queues.map((q) => ({
          name: q.name,
          depth: q.depth,
          activeCount: q.activeCount,
          maxConcurrency: q.maxConcurrency,
        })),
        executions: { running, queued, failed },
        deadLettered: { count: deadLettered.length },
        pendingInput: { count: pendingInput.length },
      });
    }
  );

  // 9. get_execution_logs — reads JSONL log file (Phase 5 upgrade)
  const getExecutionLogs = tool(
    "get_execution_logs",
    "Get structured log entries for an execution from the JSONL log file",
    {
      executionId: z.string().describe("Execution UUID"),
      level: z
        .enum(["info", "warn", "error", "debug"])
        .optional()
        .describe("Filter by log level"),
      search: z
        .string()
        .optional()
        .describe("Case-insensitive text search in log messages"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(2000)
        .optional()
        .describe("Max entries to return (default: 200)"),
      offset: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Entries to skip (for pagination)"),
    },
    async ({ executionId, level, search, limit, offset }) => {
      const execution = store.getExecution(executionId);
      if (!execution) return err(`Execution not found: ${executionId}`);

      const logsDir = deps.logsDir;
      if (logsDir) {
        // Phase 5 path: read from JSONL file.
        const { readLogEntries } = await import("@baara-next/executor");
        const entries = await readLogEntries(logsDir, executionId, {
          level,
          search,
          limit: limit ?? 200,
          offset,
        });
        return ok({
          executionId,
          status: execution.status,
          source: "jsonl",
          entries,
          total: entries.length,
        });
      }

      // Fallback: read from execution.output field (Phase 1-4 compat).
      const raw = execution.output ?? "";
      const lines = raw.split("\n");
      const filtered = search
        ? lines.filter((line) => line.toLowerCase().includes(search.toLowerCase()))
        : lines;
      const levelFiltered = level
        ? filtered.filter((line) => line.includes(`"${level}"`))
        : filtered;
      const capped = levelFiltered.slice(offset ?? 0, (offset ?? 0) + (limit ?? 200));
      return ok({
        executionId,
        status: execution.status,
        source: "output_field",
        entries: capped.map((msg) => ({ msg, level: "info", ts: "", executionId })),
        total: capped.length,
      });
    }
  );

  return [
    runTask,
    submitTask,
    listExecutions,
    getExecution,
    getExecutionEvents,
    cancelExecution,
    retryExecution,
    getSystemStatus,
    getExecutionLogs,
  ];
}

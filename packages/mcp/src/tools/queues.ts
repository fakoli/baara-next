// @baara-next/mcp — Queue management tools (4 tools)
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { IStore, IOrchestratorService } from "@baara-next/core";
import { ok, err } from "../helpers.ts";

export function createQueueTools(deps: {
  store: IStore;
  orchestrator: IOrchestratorService;
}) {
  const { store, orchestrator } = deps;

  // 1. list_queues
  const listQueues = tool(
    "list_queues",
    "List all queues with depth, active count, and concurrency settings",
    {},
    async () => {
      const queues = store.listQueues();
      return ok(
        queues.map((q) => ({
          name: q.name,
          depth: q.depth,
          activeCount: q.activeCount,
          maxConcurrency: q.maxConcurrency,
        }))
      );
    }
  );

  // 2. get_queue_info
  const getQueueInfo = tool(
    "get_queue_info",
    "Get detailed information for a specific queue by name",
    { name: z.string().describe("Queue name (e.g. 'transfer', 'timer', 'visibility', 'dlq')") },
    async ({ name }) => {
      const queue = store.getQueueInfo(name);
      if (!queue) return err(`Queue not found: ${name}`);
      return ok(queue);
    }
  );

  // 3. dlq_list — list dead-lettered executions
  const dlqList = tool(
    "dlq_list",
    "List all dead-lettered executions that have exhausted their retries",
    {},
    async () => {
      const executions = store.getDeadLetteredExecutions();
      if (executions.length === 0) {
        return ok({ message: "Dead-letter queue is empty.", executions: [] });
      }
      return ok(
        executions.map((e) => ({
          id: e.id,
          taskId: e.taskId,
          status: e.status,
          attempt: e.attempt,
          error: e.error ?? null,
          scheduledAt: e.scheduledAt,
          createdAt: e.createdAt,
        }))
      );
    }
  );

  // 4. dlq_retry — retry a dead-lettered execution
  const dlqRetry = tool(
    "dlq_retry",
    "Retry a dead-lettered execution by submitting it again",
    { executionId: z.string().describe("Dead-lettered execution UUID") },
    async ({ executionId }) => {
      try {
        const newExecution = await orchestrator.retryExecution(executionId);
        return ok(newExecution);
      } catch (e) {
        return err(`DLQ retry failed: ${String(e)}`);
      }
    }
  );

  return [listQueues, getQueueInfo, dlqList, dlqRetry];
}

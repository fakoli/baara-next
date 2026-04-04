// @baara-next/server — Queue routes
//
// GET  /api/queues           list all queues with depth/active metrics
// GET  /api/queues/dlq       dead-letter queue contents
// GET  /api/queues/:name     single queue details
// POST /api/queues/dlq/:id/retry  re-enqueue a dead-lettered execution

import { Hono } from "hono";
import type { IStore } from "@baara-next/core";

export function queueRoutes(store: IStore): Hono {
  const router = new Hono();

  // GET /api/queues/dlq — must be registered before /:name to avoid clash
  router.get("/dlq", (c) => {
    const executions = store.getDeadLetteredExecutions();
    return c.json(executions);
  });

  // POST /api/queues/dlq/:id/retry — re-enqueue a dead-lettered execution
  // Note: full retry logic lives in the orchestrator; this is a thin passthrough.
  // The orchestrator's retryExecution handles state transitions and scheduling.
  router.post("/dlq/:id/retry", async (c) => {
    // We cannot import orchestrator here without creating a circular dep.
    // The caller should use POST /api/executions/:id/retry instead.
    // This endpoint exists for semantic clarity in the queue namespace.
    const id = c.req.param("id");
    const execution = store.getExecution(id);
    if (!execution) {
      return c.json({ error: `Execution not found: "${id}"` }, 404);
    }
    if (execution.status !== "dead_lettered") {
      return c.json({ error: "Execution is not in dead_lettered status" }, 409);
    }
    // Redirect clients to the executions retry endpoint.
    return c.json(
      {
        error: "Use POST /api/executions/:id/retry to retry a dead-lettered execution",
        retryUrl: `/api/executions/${id}/retry`,
      },
      422
    );
  });

  // GET /api/queues
  router.get("/", (c) => {
    const queues = store.listQueues();
    return c.json(queues);
  });

  // GET /api/queues/:name
  router.get("/:name", (c) => {
    const name = c.req.param("name");
    const queue = store.getQueueInfo(name);
    if (!queue) {
      return c.json({ error: `Queue not found: "${name}"` }, 404);
    }
    return c.json(queue);
  });

  return router;
}

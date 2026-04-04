// @baara-next/server — System routes
//
// GET /api/health        simple liveness probe
// GET /api/system/status queue depths, execution counts, usage stats

import { Hono } from "hono";
import type { IStore } from "@baara-next/core";

const startTime = Date.now();
const VERSION = "0.1.0";

export function systemRoutes(store: IStore): Hono {
  const router = new Hono();

  // GET /api/health
  router.get("/health", (c) => {
    return c.json({
      status: "ok",
      uptime: Math.floor((Date.now() - startTime) / 1000),
      version: VERSION,
    });
  });

  // GET /api/system/status
  router.get("/system/status", (c) => {
    const queues = store.listQueues();

    const queueDepths: Record<string, { depth: number; active: number }> = {};
    let totalQueued = 0;
    let totalActive = 0;

    for (const q of queues) {
      queueDepths[q.name] = { depth: q.depth, active: q.activeCount };
      totalQueued += q.depth;
      totalActive += q.activeCount;
    }

    const dlq = store.getDeadLetteredExecutions();
    const pendingInput = store.getPendingInputExecutions();

    return c.json({
      uptime: Math.floor((Date.now() - startTime) / 1000),
      version: VERSION,
      queues: queueDepths,
      totals: {
        queued: totalQueued,
        active: totalActive,
        deadLettered: dlq.length,
        waitingForInput: pendingInput.length,
      },
    });
  });

  return router;
}

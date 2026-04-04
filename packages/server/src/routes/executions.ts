// @baara-next/server — Execution routes
//
// GET  /api/executions                  list (?taskId, ?status, ?limit)
// GET  /api/executions/pending-input    blocked executions waiting for HITL
// GET  /api/executions/:id              details
// GET  /api/executions/:id/events       event stream (JSON array)
// GET  /api/executions/:id/logs         JSONL log entries (?level, ?search, ?limit, ?offset)
// POST /api/executions/:id/cancel       cancel
// POST /api/executions/:id/retry        retry
// POST /api/executions/:id/input        provide HITL input { response: string }

import { Hono } from "hono";
import type {
  IOrchestratorService,
  IStore,
  ExecutionStatus,
} from "@baara-next/core";
import {
  ExecutionNotFoundError,
  InputRequestNotFoundError,
  InvalidStateTransitionError,
} from "@baara-next/core";
import type { DevTransport } from "@baara-next/transport";
import { readLogEntries } from "@baara-next/executor";

const VALID_STATUSES: ReadonlySet<string> = new Set<ExecutionStatus>([
  "created",
  "queued",
  "assigned",
  "running",
  "waiting_for_input",
  "completed",
  "failed",
  "timed_out",
  "cancelled",
  "retry_scheduled",
  "dead_lettered",
]);

export function executionRoutes(
  orchestrator: IOrchestratorService,
  store: IStore,
  devTransport?: DevTransport,
  logsDir?: string
): Hono {
  const router = new Hono();

  // GET /api/executions/pending-input — must come before /:id to avoid clash
  router.get("/pending-input", (c) => {
    const executions = store.getPendingInputExecutions();
    return c.json(executions);
  });

  // GET /api/executions?taskId=&status=&limit=
  router.get("/", (c) => {
    const taskId = c.req.query("taskId");
    const rawStatus = c.req.query("status");
    const rawLimit = c.req.query("limit");

    const status =
      rawStatus && VALID_STATUSES.has(rawStatus)
        ? (rawStatus as ExecutionStatus)
        : undefined;
    const limit =
      rawLimit && !isNaN(Number(rawLimit))
        ? Math.min(parseInt(rawLimit, 10), 1000)
        : undefined;

    if (!taskId) {
      // No taskId filter: return all executions with optional status/limit
      // filtering.  The web frontend sends ?status= without a taskId when
      // displaying the global executions view; ignoring that filter was
      // silently returning wrong data (only DLQ entries).
      const executions = store.listAllExecutions({
        status: status as ExecutionStatus | undefined,
        limit: limit ?? 50,
      });
      return c.json(executions);
    }

    const executions = store.listExecutions(taskId, { limit, status });
    return c.json(executions);
  });

  // GET /api/executions/:id
  router.get("/:id", (c) => {
    const id = c.req.param("id");
    const execution = store.getExecution(id);
    if (!execution) {
      return c.json({ error: `Execution not found: "${id}"` }, 404);
    }
    return c.json(execution);
  });

  // GET /api/executions/:id/events
  router.get("/:id/events", (c) => {
    const id = c.req.param("id");
    const rawAfter = c.req.query("afterSeq");
    const rawLimit = c.req.query("limit");

    const afterSeq =
      rawAfter && !isNaN(Number(rawAfter)) ? parseInt(rawAfter, 10) : undefined;
    const limit =
      rawLimit && !isNaN(Number(rawLimit))
        ? Math.min(parseInt(rawLimit, 10), 500)
        : undefined;

    const events = store.listEvents(id, { afterSeq, limit });
    return c.json(events);
  });

  // POST /api/executions/:id/cancel
  router.post("/:id/cancel", async (c) => {
    const id = c.req.param("id");
    try {
      await orchestrator.cancelExecution(id);
      return c.json({ ok: true });
    } catch (err) {
      if (err instanceof ExecutionNotFoundError) {
        return c.json({ error: err.message }, 404);
      }
      if (err instanceof InvalidStateTransitionError) {
        return c.json({ error: err.message }, 409);
      }
      throw err;
    }
  });

  // POST /api/executions/:id/retry
  router.post("/:id/retry", async (c) => {
    const id = c.req.param("id");
    try {
      const execution = await orchestrator.retryExecution(id);
      return c.json(execution);
    } catch (err) {
      if (err instanceof ExecutionNotFoundError) {
        return c.json({ error: err.message }, 404);
      }
      throw err;
    }
  });

  // POST /api/executions/:id/input — provide HITL response
  router.post("/:id/input", async (c) => {
    const id = c.req.param("id");

    let body: { response: string };
    try {
      body = (await c.req.json()) as { response: string };
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    if (!body.response || typeof body.response !== "string") {
      return c.json({ error: "response is required" }, 400);
    }

    // Deliver the response through the orchestrator (persists to store,
    // transitions execution back to running).
    try {
      await orchestrator.provideInput(id, body.response);
    } catch (err) {
      if (err instanceof ExecutionNotFoundError) {
        return c.json({ error: err.message }, 404);
      }
      if (err instanceof InputRequestNotFoundError) {
        return c.json({ error: err.message }, 409);
      }
      throw err;
    }

    // In dev mode, also resolve the in-process transport waiter so the agent
    // can continue immediately without polling.
    if (devTransport) {
      devTransport.provideInput(id, body.response);
    }

    return c.json({ ok: true });
  });

  // GET /api/executions/:id/logs — JSONL log reader (Phase 5)
  router.get("/:id/logs", async (c) => {
    const id = c.req.param("id");
    const execution = store.getExecution(id);
    if (!execution) {
      return c.json({ error: `Execution not found: "${id}"` }, 404);
    }

    if (!logsDir) {
      return c.json({ executionId: id, entries: [], total: 0 });
    }

    const rawLevel = c.req.query("level");
    const rawSearch = c.req.query("search");
    const rawLimit = c.req.query("limit");
    const rawOffset = c.req.query("offset");

    const limit =
      rawLimit && !isNaN(Number(rawLimit))
        ? Math.min(parseInt(rawLimit, 10), 2000)
        : undefined;
    const offset =
      rawOffset && !isNaN(Number(rawOffset))
        ? parseInt(rawOffset, 10)
        : undefined;

    const entries = await readLogEntries(logsDir, id, {
      level: rawLevel ?? undefined,
      search: rawSearch ?? undefined,
      limit,
      offset,
    });

    return c.json({ executionId: id, entries, total: entries.length });
  });

  return router;
}

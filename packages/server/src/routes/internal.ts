// @baara-next/server — Internal agent transport routes
//
// These routes are called by production-mode agents (HttpTransport) to poll
// for tasks, report progress, and exchange HITL input.  They are NOT
// authenticated via the API key — they are intended to be bound on a private
// interface or protected by network-level controls.
//
// POST /internal/poll          — agent polls for a task assignment
// POST /internal/start         — agent signals execution has started
// POST /internal/complete      — agent reports completion result
// POST /internal/heartbeat     — agent sends a liveness heartbeat
// POST /internal/input-request — agent requests human input (HITL)
// POST /internal/input-poll    — agent polls for a HITL response

import { Hono } from "hono";
import type { IOrchestratorService, IStore } from "@baara-next/core";

// Extend the core interface with the heartbeat method that OrchestratorService
// exposes but that is not part of the minimal IOrchestratorService contract.
interface IOrchestratorWithHeartbeat extends IOrchestratorService {
  heartbeat(agentId: string, executionId: string, turnCount: number): Promise<void>;
}

export function internalRoutes(
  orchestrator: IOrchestratorWithHeartbeat,
  store: IStore
): Hono {
  const router = new Hono();

  // POST /internal/poll — agent polls for the next available task
  router.post("/poll", async (c) => {
    const { agentId, capabilities } = await c.req.json() as {
      agentId: string;
      capabilities: string[];
    };
    const assignment = await orchestrator.matchTask(agentId, capabilities as never[]);
    return c.json(assignment ?? null);
  });

  // POST /internal/start — agent transitions an execution to running
  router.post("/start", async (c) => {
    const { executionId } = await c.req.json() as { executionId: string };
    await orchestrator.startExecution(executionId);
    return c.json({ ok: true });
  });

  // POST /internal/complete — agent reports execution completion
  router.post("/complete", async (c) => {
    const { executionId, result } = await c.req.json() as {
      executionId: string;
      result: Parameters<typeof orchestrator.handleExecutionComplete>[1];
    };
    await orchestrator.handleExecutionComplete(executionId, result);
    return c.json({ ok: true });
  });

  // POST /internal/heartbeat — agent liveness ping
  router.post("/heartbeat", async (c) => {
    const { agentId, executionId, turnCount } = await c.req.json() as {
      agentId: string;
      executionId: string;
      turnCount: number;
    };
    await orchestrator.heartbeat(agentId, executionId, turnCount);
    return c.json({ ok: true });
  });

  // POST /internal/input-request — agent requests human input
  router.post("/input-request", async (c) => {
    const { executionId, prompt, options } = await c.req.json() as {
      executionId: string;
      prompt: string;
      options?: string[];
    };
    const inputReq = store.createInputRequest({
      executionId,
      prompt,
      options,
      status: "pending",
      timeoutMs: 300_000,
    });
    store.updateExecutionStatus(executionId, "waiting_for_input");
    return c.json({ ok: true, inputRequestId: inputReq.id });
  });

  // POST /internal/input-poll — agent polls for a HITL response
  router.post("/input-poll", async (c) => {
    const { inputRequestId } = await c.req.json() as {
      executionId: string;
      inputRequestId: string;
    };
    const req = store.getInputRequestById(inputRequestId);
    if (req?.status === "responded") {
      return c.json({ status: "responded", response: req.response });
    }
    if (req?.status === "timed_out") {
      return c.json({ status: "timed_out" });
    }
    return c.json({ status: "pending" });
  });

  return router;
}

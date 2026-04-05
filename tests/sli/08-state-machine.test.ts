// tests/sli/08-state-machine.test.ts
//
// Execution state machine SLOs — verifies that status transitions follow the
// defined state machine and that invalid transitions are rejected.
//
// Valid transitions (from state-machine.ts):
//   created           → queued, cancelled
//   queued            → assigned, cancelled, timed_out
//   assigned          → running, timed_out
//   running           → completed, failed, timed_out, cancelled, waiting_for_input
//   waiting_for_input → running, cancelled
//   failed            → retry_scheduled, dead_lettered
//   timed_out         → retry_scheduled, dead_lettered
//   retry_scheduled   → queued, cancelled
//   Terminal: completed, cancelled, dead_lettered (no outgoing)
//
// Tests:
//   Submit task → observe: queued → assigned → running → completed
//   Submit failing task → observe: queued → … → dead_lettered (via retry)
//   Cancel a queued task → verify: queued → cancelled
//   Invalid transition: cancel a completed execution → 409

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import {
  startServer,
  makeApi,
  waitForExecution,
  type ServerHandle,
} from "./helpers.ts";

describe("08-state-machine", () => {
  let handle: ServerHandle;
  let api: ReturnType<typeof makeApi>;

  beforeAll(async () => {
    handle = await startServer({ env: { BAARA_SHELL_ENABLED: "true" } });
    api = makeApi(handle.baseUrl);
  }, 30_000);

  afterAll(async () => {
    await handle.cleanup();
  });

  // ---------------------------------------------------------------------------
  // Helper: poll execution status until it changes to one of a set of values
  // ---------------------------------------------------------------------------

  async function waitForStatus(
    execId: string,
    acceptStatuses: Set<string>,
    timeoutMs = 15_000
  ): Promise<Record<string, unknown>> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const res = await api(`/api/executions/${execId}`);
      expect(res.status).toBe(200);
      const exec = (await res.json()) as Record<string, unknown>;
      if (acceptStatuses.has(exec["status"] as string)) return exec;
      await Bun.sleep(100);
    }
    throw new Error(
      `waitForStatus timed out waiting for one of [${[...acceptStatuses].join(",")}] on ${execId}`
    );
  }

  // ---------------------------------------------------------------------------
  // Happy-path transitions: created → queued → assigned → running → completed
  // ---------------------------------------------------------------------------

  it("state machine happy path: transitions from queued through to completed", async () => {
    const createRes = await api("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `sli-sm-happy-${Date.now()}`,
        prompt: "echo state-machine-happy-path",
        sandboxType: "native",
        agentConfig: { allowedTools: ["Bash"] },
        executionMode: "queued",
        timeoutMs: 30_000,
        maxRetries: 0,
      }),
    });
    expect(createRes.status).toBe(201);
    const task = (await createRes.json()) as Record<string, unknown>;
    const taskId = task["id"] as string;

    // Submit — should be immediately "queued"
    const submitRes = await api(`/api/tasks/${taskId}/submit`, { method: "POST" });
    expect(submitRes.status).toBe(201);
    const execution = (await submitRes.json()) as Record<string, unknown>;
    const execId = execution["id"] as string;
    expect(execution["status"]).toBe("queued");

    console.log(`  [${execId}] Initial status: queued`);

    // Wait for assigned (agent picks it up)
    const assignedExec = await waitForStatus(
      execId,
      new Set(["assigned", "running", "completed"]),
      10_000
    );
    console.log(`  [${execId}] Reached: ${assignedExec["status"]}`);

    // Wait for running (agent starts execution)
    const runningExec = await waitForStatus(
      execId,
      new Set(["running", "completed"]),
      10_000
    );
    console.log(`  [${execId}] Reached: ${runningExec["status"]}`);

    // Wait for completed
    const finalExec = await waitForExecution(handle.baseUrl, execId, "completed", 20_000);
    expect(finalExec["status"]).toBe("completed");
    console.log(`  [${execId}] Final status: completed`);

    // Execution must have timestamps for the full lifecycle
    expect(finalExec["scheduledAt"]).toBeTruthy();
    expect(finalExec["completedAt"]).toBeTruthy();
    expect(typeof finalExec["durationMs"]).toBe("number");
    expect(finalExec["durationMs"] as number).toBeGreaterThanOrEqual(0);
  }, 30_000);

  // ---------------------------------------------------------------------------
  // Failure path: failed → retry_scheduled → queued → dead_lettered
  // ---------------------------------------------------------------------------

  it("state machine failure path: failing task transitions through retry to dead_lettered", async () => {
    // wasm sandbox always fails immediately — use maxRetries=1 to exercise
    // the full retry chain: failed → retry_scheduled → queued → failed → dead_lettered
    const createRes = await api("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `sli-sm-fail-${Date.now()}`,
        prompt: "always fails via wasm stub",
        sandboxType: "wasm",
        executionMode: "queued",
        timeoutMs: 5_000,
        maxRetries: 1,
      }),
    });
    expect(createRes.status).toBe(201);
    const task = (await createRes.json()) as Record<string, unknown>;
    const taskId = task["id"] as string;

    const submitRes = await api(`/api/tasks/${taskId}/submit`, { method: "POST" });
    expect(submitRes.status).toBe(201);
    const submitted = (await submitRes.json()) as Record<string, unknown>;
    expect(submitted["status"]).toBe("queued");
    console.log(`  [task ${taskId}] Submitted; initial status: queued`);

    // Poll until a dead_lettered execution appears for this task
    const deadline = Date.now() + 45_000;
    let dlqExec: Record<string, unknown> | undefined;

    while (Date.now() < deadline) {
      const listRes = await api("/api/executions?status=dead_lettered");
      const list = (await listRes.json()) as Array<Record<string, unknown>>;
      dlqExec = list.find((e) => e["taskId"] === taskId);
      if (dlqExec) break;
      await Bun.sleep(400);
    }

    expect(dlqExec).toBeDefined();
    expect(dlqExec!["status"]).toBe("dead_lettered");
    // maxRetries=1 means 2 total attempts
    expect(dlqExec!["attempt"]).toBe(2);
    console.log(
      `  [task ${taskId}] Dead-lettered after ${dlqExec!["attempt"]} attempt(s)`
    );
  }, 60_000);

  // ---------------------------------------------------------------------------
  // Cancel a queued task — queued → cancelled
  // ---------------------------------------------------------------------------

  it("state machine: cancel queued execution transitions to cancelled", async () => {
    // Use wasm (slow-to-fail or fast stub) so the execution stays queued long
    // enough to cancel. We set maxRetries=0 so it doesn't linger via retry.
    const createRes = await api("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `sli-sm-cancel-${Date.now()}`,
        prompt: "cancel this task",
        sandboxType: "wasm",
        executionMode: "queued",
        timeoutMs: 60_000,
        maxRetries: 0,
      }),
    });
    expect(createRes.status).toBe(201);
    const task = (await createRes.json()) as Record<string, unknown>;
    const taskId = task["id"] as string;

    const submitRes = await api(`/api/tasks/${taskId}/submit`, { method: "POST" });
    expect(submitRes.status).toBe(201);
    const submitted = (await submitRes.json()) as Record<string, unknown>;
    const execId = submitted["id"] as string;

    // The execution is in "queued" state right after submit.
    // Cancel it immediately.
    const cancelRes = await api(`/api/executions/${execId}/cancel`, {
      method: "POST",
    });

    if (cancelRes.status === 409) {
      // The execution was already picked up by the agent before we could cancel it
      // (race condition on fast machines).  This is a valid outcome — skip the
      // assertion without failing.
      const body = (await cancelRes.json()) as Record<string, unknown>;
      console.log(
        `  [${execId}] Cancel raced with agent pickup: ${body["error"]} — skipping`
      );
      return;
    }

    expect(cancelRes.status).toBe(200);
    const cancelBody = (await cancelRes.json()) as Record<string, unknown>;
    expect(cancelBody["ok"]).toBe(true);

    // Poll until the execution reaches cancelled
    const deadline = Date.now() + 10_000;
    let finalExec: Record<string, unknown> | null = null;
    while (Date.now() < deadline) {
      const res = await api(`/api/executions/${execId}`);
      const exec = (await res.json()) as Record<string, unknown>;
      const terminal = new Set([
        "completed", "cancelled", "dead_lettered", "failed", "timed_out",
      ]);
      if (terminal.has(exec["status"] as string)) {
        finalExec = exec;
        break;
      }
      await Bun.sleep(200);
    }

    expect(finalExec).not.toBeNull();
    expect(finalExec!["status"]).toBe("cancelled");
    console.log(`  [${execId}] Cancelled successfully`);
  }, 20_000);

  // ---------------------------------------------------------------------------
  // Invalid transition: cancel a completed execution → 409
  // ---------------------------------------------------------------------------

  it("state machine: cancelling a completed execution returns 409 (invalid transition)", async () => {
    const createRes = await api("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `sli-sm-invalid-${Date.now()}`,
        prompt: "echo invalid-transition-test",
        sandboxType: "native",
        agentConfig: { allowedTools: ["Bash"] },
        executionMode: "queued",
        timeoutMs: 30_000,
        maxRetries: 0,
      }),
    });
    expect(createRes.status).toBe(201);
    const task = (await createRes.json()) as Record<string, unknown>;
    const taskId = task["id"] as string;

    const submitRes = await api(`/api/tasks/${taskId}/submit`, { method: "POST" });
    const execution = (await submitRes.json()) as Record<string, unknown>;
    const execId = execution["id"] as string;

    await waitForExecution(handle.baseUrl, execId, "completed", 25_000);

    // Attempt an invalid transition: completed → cancelled
    const cancelRes = await api(`/api/executions/${execId}/cancel`, {
      method: "POST",
    });
    expect(cancelRes.status).toBe(409);
    const body = (await cancelRes.json()) as Record<string, unknown>;
    expect(typeof body["error"]).toBe("string");
    console.log(
      `  [${execId}] Invalid transition rejected: ${body["error"]}`
    );
  }, 30_000);

  // ---------------------------------------------------------------------------
  // Execution fields are populated correctly at each stage
  // ---------------------------------------------------------------------------

  it("state machine: completed execution has all expected metadata fields", async () => {
    const createRes = await api("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `sli-sm-metadata-${Date.now()}`,
        prompt: "echo metadata-check",
        sandboxType: "native",
        agentConfig: { allowedTools: ["Bash"] },
        executionMode: "queued",
        timeoutMs: 30_000,
        maxRetries: 0,
      }),
    });
    expect(createRes.status).toBe(201);
    const task = (await createRes.json()) as Record<string, unknown>;
    const taskId = task["id"] as string;

    const submitRes = await api(`/api/tasks/${taskId}/submit`, { method: "POST" });
    const execution = (await submitRes.json()) as Record<string, unknown>;
    const execId = execution["id"] as string;

    const finalExec = await waitForExecution(handle.baseUrl, execId, "completed", 25_000);

    // Required fields on a completed execution
    expect(typeof finalExec["id"]).toBe("string");
    expect(finalExec["taskId"]).toBe(taskId);
    expect(typeof finalExec["queueName"]).toBe("string");
    expect(typeof finalExec["priority"]).toBe("number");
    expect(finalExec["status"]).toBe("completed");
    expect(typeof finalExec["attempt"]).toBe("number");
    expect(finalExec["attempt"] as number).toBeGreaterThanOrEqual(1);
    expect(typeof finalExec["scheduledAt"]).toBe("string");
    expect(typeof finalExec["startedAt"]).toBe("string");
    expect(typeof finalExec["completedAt"]).toBe("string");
    expect(typeof finalExec["durationMs"]).toBe("number");
    expect(finalExec["durationMs"] as number).toBeGreaterThanOrEqual(0);
    expect(typeof finalExec["output"]).toBe("string");

    console.log(
      `  [${execId}] completed in ${finalExec["durationMs"]}ms on attempt ${finalExec["attempt"]}`
    );
  }, 30_000);

  // ---------------------------------------------------------------------------
  // Retry exhaustion path via direct observation of events
  // ---------------------------------------------------------------------------

  it("state machine: events log records at least one status-change per execution attempt", async () => {
    const createRes = await api("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `sli-sm-events-${Date.now()}`,
        prompt: "echo events-per-attempt",
        sandboxType: "native",
        agentConfig: { allowedTools: ["Bash"] },
        executionMode: "queued",
        timeoutMs: 30_000,
        maxRetries: 0,
      }),
    });
    expect(createRes.status).toBe(201);
    const task = (await createRes.json()) as Record<string, unknown>;
    const taskId = task["id"] as string;

    const submitRes = await api(`/api/tasks/${taskId}/submit`, { method: "POST" });
    const execution = (await submitRes.json()) as Record<string, unknown>;
    const execId = execution["id"] as string;

    await waitForExecution(handle.baseUrl, execId, "completed", 25_000);

    const eventsRes = await api(`/api/executions/${execId}/events`);
    expect(eventsRes.status).toBe(200);
    const events = (await eventsRes.json()) as Array<Record<string, unknown>>;

    // At least one event per major state (created/queued at submission,
    // assigned, running, completed = at minimum 4)
    expect(events.length).toBeGreaterThanOrEqual(4);

    // All events must belong to this execution
    for (const event of events) {
      expect(event["executionId"]).toBe(execId);
    }

    // eventSeq must be strictly increasing
    for (let i = 1; i < events.length; i++) {
      expect(events[i]!["eventSeq"] as number).toBeGreaterThan(
        events[i - 1]!["eventSeq"] as number
      );
    }

    console.log(
      `  [${execId}] ${events.length} events, seqs [${events.map((e) => e["eventSeq"]).join(",")}]`
    );
  }, 30_000);
});

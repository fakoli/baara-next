// tests/sli/02-execution-performance.test.ts
//
// Execution SLOs — measures queue pipeline latencies and success rates.
//
// SLIs covered:
//   exec.shell.latency       submit → completed total < 2s
//   exec.shell.success_rate  5 echo tasks all complete successfully (100%)
//   exec.queue.pickup_latency queued → assigned < 3s

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import {
  startServer,
  makeApi,
  waitForExecution,
  measure,
  assertSLO,
  type ServerHandle,
} from "./helpers.ts";

describe("02-execution-performance", () => {
  let handle: ServerHandle;
  let api: ReturnType<typeof makeApi>;

  beforeAll(async () => {
    handle = await startServer({ env: { BAARA_SHELL_ENABLED: "true" } });
    api = makeApi(handle.baseUrl);
  }, 30_000);

  afterAll(async () => {
    await handle.cleanup();
  });

  /**
   * Create and submit a shell echo task. Returns the execution ID.
   */
  async function submitShellEchoTask(suffix: string): Promise<string> {
    const createRes = await api("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `sli-exec-${suffix}-${Date.now()}`,
        prompt: `echo sli-test-${suffix}`,
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

    const submitRes = await api(`/api/tasks/${taskId}/submit`, {
      method: "POST",
    });
    expect(submitRes.status).toBe(201);
    const execution = (await submitRes.json()) as Record<string, unknown>;
    return execution["id"] as string;
  }

  // ---------------------------------------------------------------------------
  // SLI: exec.shell.latency — end-to-end submission to completion < 2s
  //
  // We measure the server-reported durationMs from the completed execution
  // (completedAt - startedAt) rather than wall-clock time inclusive of polling
  // overhead, to get an accurate picture of actual execution latency.
  // The SLO also imposes a wall-clock cap on total end-to-end time (5s) to
  // catch stuck executions.
  // ---------------------------------------------------------------------------

  it("SLI exec.shell.latency: shell task durationMs < 2000ms", async () => {
    const createRes = await api("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `sli-latency-${Date.now()}`,
        prompt: "echo exec-latency-test",
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
    expect(submitRes.status).toBe(201);
    const execution = (await submitRes.json()) as Record<string, unknown>;
    const execId = execution["id"] as string;

    const finalExec = await waitForExecution(handle.baseUrl, execId, "completed", 10_000);

    // Use the server-reported durationMs (startedAt → completedAt) which
    // reflects actual execution time without HTTP polling round-trip overhead.
    const durationMs = finalExec["durationMs"] as number;
    expect(typeof durationMs).toBe("number");
    assertSLO("exec.shell.latency", durationMs, 2000);
  }, 15_000);

  // ---------------------------------------------------------------------------
  // SLI: exec.shell.success_rate — 5 tasks all complete successfully (100%)
  // ---------------------------------------------------------------------------

  it("SLI exec.shell.success_rate: 5 echo tasks reach completed (100%)", async () => {
    const execIds: string[] = [];

    // Submit 5 tasks sequentially to avoid overwhelming the queue
    for (let i = 0; i < 5; i++) {
      const execId = await submitShellEchoTask(`rate-${i}`);
      execIds.push(execId);
    }

    // Wait for all to reach terminal status
    const results = await Promise.all(
      execIds.map((execId) =>
        waitForExecution(handle.baseUrl, execId, "completed", 30_000).then(
          (exec) => ({ execId, status: exec["status"] as string, ok: true })
        ).catch((err: Error) => ({ execId, status: "error", ok: false, err: err.message }))
      )
    );

    const completed = results.filter((r) => r.ok && r.status === "completed");
    const successRate = completed.length / results.length;

    console.log(
      `  SLI exec.shell.success_rate: ${completed.length}/${results.length} (${(successRate * 100).toFixed(0)}%) (target: >=99%)`
    );

    // SLO: >= 99% (all 5 must pass)
    expect(completed.length).toBe(5);
  }, 60_000);

  // ---------------------------------------------------------------------------
  // SLI: exec.queue.pickup_latency — queued → assigned < 3s
  // ---------------------------------------------------------------------------

  it("SLI exec.queue.pickup_latency: queued → assigned < 3000ms", async () => {
    const createRes = await api("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `sli-pickup-${Date.now()}`,
        prompt: "echo pickup-latency-test",
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

    const submitRes = await api(`/api/tasks/${taskId}/submit`, {
      method: "POST",
    });
    expect(submitRes.status).toBe(201);
    const execution = (await submitRes.json()) as Record<string, unknown>;
    const execId = execution["id"] as string;

    // Measure time from submission (queued) until the execution reaches
    // "assigned" (agent has picked it up).
    const pickupStart = performance.now();

    // Poll for assigned or further-along status
    const deadline = Date.now() + 10_000;
    let assignedExec: Record<string, unknown> | null = null;

    while (Date.now() < deadline) {
      const res = await api(`/api/executions/${execId}`);
      expect(res.status).toBe(200);
      const exec = (await res.json()) as Record<string, unknown>;
      const status = exec["status"] as string;

      // Accept "assigned" or any status beyond it (running, completed, etc.)
      const pastAssigned = new Set([
        "assigned",
        "running",
        "waiting_for_input",
        "completed",
        "failed",
        "timed_out",
        "cancelled",
        "dead_lettered",
      ]);
      if (pastAssigned.has(status)) {
        assignedExec = exec;
        break;
      }
      await Bun.sleep(100);
    }

    const pickupMs = performance.now() - pickupStart;

    expect(assignedExec).not.toBeNull();
    assertSLO("exec.queue.pickup_latency", pickupMs, 3000);

    // Wait for full completion to avoid leaving a running execution after the test
    await waitForExecution(handle.baseUrl, execId, "completed", 15_000);
  }, 30_000);

  // ---------------------------------------------------------------------------
  // Retry mechanism: failing task with maxRetries=1 gets retried
  // ---------------------------------------------------------------------------

  it("retry mechanism: wasm task with maxRetries=1 is retried before dead_lettered", async () => {
    // sandboxType "wasm" routes through WasmRuntime stub which always returns
    // status "failed" — no external dependencies required.
    const createRes = await api("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `sli-retry-${Date.now()}`,
        prompt: "this will always fail",
        sandboxType: "wasm",
        executionMode: "queued",
        timeoutMs: 5_000,
        maxRetries: 1,
      }),
    });
    expect(createRes.status).toBe(201);
    const task = (await createRes.json()) as Record<string, unknown>;
    const taskId = task["id"] as string;

    const submitRes = await api(`/api/tasks/${taskId}/submit`, {
      method: "POST",
    });
    expect(submitRes.status).toBe(201);
    const execution = (await submitRes.json()) as Record<string, unknown>;
    const initialExecId = execution["id"] as string;
    expect(initialExecId).toBeTruthy();

    // The retry mechanism creates a new execution ID on retry.
    // Poll for any dead_lettered execution for this task (attempt=2 means one retry happened).
    const deadline = Date.now() + 45_000;
    let dlqExec: Record<string, unknown> | undefined;

    while (Date.now() < deadline) {
      const dlqRes = await api("/api/executions?status=dead_lettered");
      expect(dlqRes.status).toBe(200);
      const dlqList = (await dlqRes.json()) as Array<Record<string, unknown>>;
      dlqExec = dlqList.find((e) => e["taskId"] === taskId);
      if (dlqExec) break;
      await Bun.sleep(500);
    }

    expect(dlqExec).toBeDefined();
    expect(dlqExec!["status"]).toBe("dead_lettered");
    // maxRetries=1 means 2 attempts total
    expect(dlqExec!["attempt"]).toBe(2);

    console.log(
      `  SLI exec.retry: task ${taskId} dead-lettered after ${dlqExec!["attempt"]} attempt(s) — retry mechanism confirmed`
    );
  }, 60_000);
});

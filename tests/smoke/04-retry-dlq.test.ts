// tests/smoke/04-retry-dlq.test.ts
//
// Verifies the retry + DLQ pipeline: a task that always fails should be
// retried `maxRetries` times and then produce an execution in "dead_lettered".
//
// We use sandboxType:"wasm" because the WasmRuntime stub always returns
// status:"failed" — no API key or shell access needed.
//
// NOTE: The retry mechanism creates new execution IDs for each attempt.
// The original execId transitions to "retry_scheduled" (not dead_lettered).
// We poll the executions list to find the dead-lettered attempt.
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { startServer, makeApi, type ServerHandle } from "./helpers.ts";

describe("04-retry-dlq", () => {
  let handle: ServerHandle;
  let api: ReturnType<typeof makeApi>;

  beforeAll(async () => {
    handle = await startServer();
    api = makeApi(handle.baseUrl);
  }, 30_000);

  afterAll(async () => {
    await handle.cleanup();
  });

  it("failing task with maxRetries=2 eventually produces a dead_lettered execution", async () => {
    // sandboxType:"wasm" routes through the WasmRuntime stub which always
    // returns status:"failed" immediately — no external dependencies needed.
    const createRes = await api("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `smoke-dlq-${Date.now()}`,
        prompt: "this will always fail",
        sandboxType: "wasm",
        executionMode: "queued",
        timeoutMs: 5000,
        maxRetries: 2,
      }),
    });
    expect(createRes.status).toBe(201);
    const task = await createRes.json() as Record<string, unknown>;
    const taskId = task["id"] as string;

    // Submit
    const submitRes = await api(`/api/tasks/${taskId}/submit`, { method: "POST" });
    expect(submitRes.status).toBe(201);
    const execution = await submitRes.json() as Record<string, unknown>;
    expect((execution["id"] as string)).toBeTruthy();

    // Poll the DLQ endpoint until a dead_lettered execution appears for this task.
    // The retry mechanism creates new execution IDs on each attempt, so we cannot
    // watch the original execId — we watch the task's executions list instead.
    const deadline = Date.now() + 60_000;
    let dlqExec: Record<string, unknown> | undefined;

    while (Date.now() < deadline) {
      const dlqRes = await api("/api/executions?status=dead_lettered");
      expect(dlqRes.status).toBe(200);
      const dlqList = await dlqRes.json() as Array<Record<string, unknown>>;
      dlqExec = dlqList.find((e) => e["taskId"] === taskId);
      if (dlqExec) break;
      await Bun.sleep(500);
    }

    expect(dlqExec).toBeDefined();
    expect(dlqExec!["status"]).toBe("dead_lettered");
    expect(dlqExec!["attempt"]).toBe(3); // attempt 1 + 2 retries = 3rd attempt
  }, 90_000);
});

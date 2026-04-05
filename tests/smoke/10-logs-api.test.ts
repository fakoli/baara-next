// tests/smoke/10-logs-api.test.ts
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { startServer, makeApi, type ServerHandle } from "./helpers.ts";

describe("10-logs-api", () => {
  let handle: ServerHandle;
  let api: ReturnType<typeof makeApi>;

  beforeAll(async () => {
    handle = await startServer({ env: { BAARA_SHELL_ENABLED: "true" } });
    api = makeApi(handle.baseUrl);
  }, 30_000);

  afterAll(async () => {
    await handle.cleanup();
  });

  it("GET /api/executions/:id/logs returns correct shape after running a task", async () => {
    // Create and submit a task via the queued path (routes Bash-only to ShellRuntime,
    // no ANTHROPIC_API_KEY needed).
    const createRes = await api("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `smoke-logs-${Date.now()}`,
        prompt: "echo logs-test-output",
        sandboxType: "native",
        agentConfig: { allowedTools: ["Bash"] },
        executionMode: "queued",
        timeoutMs: 30000,
        maxRetries: 0,
      }),
    });
    expect(createRes.status).toBe(201);
    const task = await createRes.json() as Record<string, unknown>;
    const taskId = task["id"] as string;

    const submitRes = await api(`/api/tasks/${taskId}/submit`, { method: "POST" });
    expect(submitRes.status).toBe(201);
    const submitted = await submitRes.json() as Record<string, unknown>;
    const execId = submitted["id"] as string;

    // Wait for completion
    let execution: Record<string, unknown> = {};
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 500));
      const res = await api(`/api/executions/${execId}`);
      execution = await res.json() as Record<string, unknown>;
      if (execution["status"] === "completed") break;
    }
    expect(execution["status"]).toBe("completed");

    // Fetch logs
    const logsRes = await api(`/api/executions/${execId}/logs`);
    expect(logsRes.status).toBe(200);

    const body = await logsRes.json() as Record<string, unknown>;
    expect(body["executionId"]).toBe(execId);
    expect(Array.isArray(body["entries"])).toBe(true);
    expect(typeof body["total"]).toBe("number");
  }, 60_000);

  it("GET /api/executions/nonexistent-id/logs returns 404", async () => {
    const res = await api("/api/executions/00000000-0000-0000-0000-000000000000/logs");
    expect(res.status).toBe(404);
  });
});

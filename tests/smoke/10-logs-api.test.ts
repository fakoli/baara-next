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
    // Create and directly run a task.  Use a generous timeoutMs so the Claude
    // Code SDK has enough time to return a result before the task timeout fires.
    const createRes = await api("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `smoke-logs-${Date.now()}`,
        prompt: "echo logs-test-output",
        sandboxType: "native",
        executionType: "shell",
        executionMode: "direct",
        timeoutMs: 60000,
        maxRetries: 0,
      }),
    });
    expect(createRes.status).toBe(201);
    const task = await createRes.json() as Record<string, unknown>;
    const taskId = task["id"] as string;

    const runRes = await api(`/api/tasks/${taskId}/run`, { method: "POST" });
    expect(runRes.status).toBe(200);
    const execution = await runRes.json() as Record<string, unknown>;
    const execId = execution["id"] as string;
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

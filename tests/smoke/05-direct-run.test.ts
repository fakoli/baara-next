// tests/smoke/05-direct-run.test.ts
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { startServer, makeApi, type ServerHandle } from "./helpers.ts";

describe("05-direct-run", () => {
  let handle: ServerHandle;
  let api: ReturnType<typeof makeApi>;

  beforeAll(async () => {
    handle = await startServer({ env: { BAARA_SHELL_ENABLED: "true" } });
    api = makeApi(handle.baseUrl);
  }, 30_000);

  afterAll(async () => {
    await handle.cleanup();
  });

  it("POST /api/tasks/:id/run returns a completed execution inline", async () => {
    // Create task — use a generous timeoutMs so the Claude Code SDK has enough
    // time to run the command and return a result before the task timeout fires.
    const createRes = await api("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `smoke-direct-${Date.now()}`,
        prompt: "echo direct-run-output",
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

    // Direct run — blocks until completion (may take up to 30 s for Claude Code SDK)
    const runRes = await api(`/api/tasks/${taskId}/run`, { method: "POST" });
    expect(runRes.status).toBe(200);
    const execution = await runRes.json() as Record<string, unknown>;

    expect(execution["status"]).toBe("completed");
    expect(typeof execution["output"]).toBe("string");
    expect((execution["output"] as string).toLowerCase()).toContain("direct-run-output");
    expect(execution["id"]).toBeTruthy();
  }, 60_000);
});

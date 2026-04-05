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

  it("submit + wait returns a completed execution with output", async () => {
    // Use the queued path (submit) which correctly routes Bash-only tasks
    // to ShellRuntime without requiring ANTHROPIC_API_KEY.
    const createRes = await api("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `smoke-direct-${Date.now()}`,
        prompt: "echo direct-run-output",
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

    // Submit to queue — agent picks it up and runs via ShellRuntime
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
    expect(typeof execution["output"]).toBe("string");
    expect((execution["output"] as string).toLowerCase()).toContain("direct-run-output");
  }, 30_000);
});

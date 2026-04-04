// tests/smoke/09-sandbox-config.test.ts
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { startServer, makeApi, type ServerHandle } from "./helpers.ts";

describe("09-sandbox-config", () => {
  let handle: ServerHandle;
  let api: ReturnType<typeof makeApi>;

  beforeAll(async () => {
    handle = await startServer();
    api = makeApi(handle.baseUrl);
  });

  afterAll(async () => {
    await handle.cleanup();
  });

  it("task created with sandboxType=wasm and sandboxConfig is stored and returned correctly", async () => {
    const sandboxConfig = {
      type: "wasm",
      networkEnabled: true,
      maxMemoryMb: 256,
      maxCpuPercent: 50,
    };

    const createRes = await api("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `smoke-sandbox-${Date.now()}`,
        prompt: "print('hello wasm')",
        sandboxType: "wasm",
        sandboxConfig,
        executionMode: "direct",
        timeoutMs: 10000,
      }),
    });
    expect(createRes.status).toBe(201);
    const task = await createRes.json() as Record<string, unknown>;
    const taskId = task["id"] as string;

    // GET by ID and verify fields round-tripped correctly
    const getRes = await api(`/api/tasks/${taskId}`);
    expect(getRes.status).toBe(200);
    const fetched = await getRes.json() as Record<string, unknown>;

    expect(fetched["sandboxType"]).toBe("wasm");

    const storedConfig = fetched["sandboxConfig"] as Record<string, unknown>;
    expect(storedConfig["type"]).toBe("wasm");
    expect(storedConfig["networkEnabled"]).toBe(true);
    expect(storedConfig["maxMemoryMb"]).toBe(256);
    expect(storedConfig["maxCpuPercent"]).toBe(50);
  });
});

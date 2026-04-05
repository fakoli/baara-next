// tests/sli/01-api-performance.test.ts
//
// Tier 1 API SLOs — latency assertions against live HTTP endpoints.
//
// SLIs covered:
//   api.health.latency        GET /api/health       p99 < 100ms
//   api.task.crud.latency     full CRUD cycle        each op < 200ms
//   api.execution.list.latency GET /api/executions   < 200ms
//   api.mcp.tools_list.latency POST /mcp tools/list  < 100ms
//   api.mcp.tool_call.latency  POST /mcp tools/call  < 500ms

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import {
  startServer,
  makeApi,
  measure,
  assertSLO,
  p99,
  type ServerHandle,
} from "./helpers.ts";

describe("01-api-performance", () => {
  let handle: ServerHandle;
  let api: ReturnType<typeof makeApi>;

  beforeAll(async () => {
    handle = await startServer();
    api = makeApi(handle.baseUrl);
  }, 30_000);

  afterAll(async () => {
    await handle.cleanup();
  });

  // ---------------------------------------------------------------------------
  // SLI: api.health.latency — p99 < 100ms
  // ---------------------------------------------------------------------------

  it("SLI api.health.latency: GET /api/health p99 < 100ms", async () => {
    const samples: number[] = [];

    for (let i = 0; i < 10; i++) {
      const { result: res, durationMs } = await measure(() =>
        api("/api/health")
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body["status"]).toBe("ok");
      samples.push(durationMs);
    }

    const p99Value = p99(samples);
    assertSLO("api.health.latency.p99", p99Value, 100);
  });

  // ---------------------------------------------------------------------------
  // SLI: api.task.crud.latency — each CRUD operation < 200ms
  // ---------------------------------------------------------------------------

  it("SLI api.task.crud.latency: CREATE < 200ms", async () => {
    const taskName = `sli-crud-create-${Date.now()}`;
    const { result: res, durationMs } = await measure(() =>
      api("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: taskName,
          prompt: "echo sli-test",
          description: "SLI CRUD test task",
          sandboxType: "native",
          executionMode: "queued",
        }),
      })
    );
    expect(res.status).toBe(201);
    const task = (await res.json()) as Record<string, unknown>;
    expect(task["id"]).toBeTruthy();
    assertSLO("api.task.crud.create.latency", durationMs, 200);

    // Cleanup
    const taskId = task["id"] as string;
    await api(`/api/tasks/${taskId}`, { method: "DELETE" });
  });

  it("SLI api.task.crud.latency: GET by ID < 200ms", async () => {
    // Create a task first
    const taskName = `sli-crud-get-${Date.now()}`;
    const createRes = await api("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: taskName,
        prompt: "echo sli-get-test",
        sandboxType: "native",
        executionMode: "queued",
      }),
    });
    expect(createRes.status).toBe(201);
    const task = (await createRes.json()) as Record<string, unknown>;
    const taskId = task["id"] as string;

    const { result: res, durationMs } = await measure(() =>
      api(`/api/tasks/${taskId}`)
    );
    expect(res.status).toBe(200);
    assertSLO("api.task.crud.get.latency", durationMs, 200);

    await api(`/api/tasks/${taskId}`, { method: "DELETE" });
  });

  it("SLI api.task.crud.latency: LIST < 200ms", async () => {
    const { result: res, durationMs } = await measure(() =>
      api("/api/tasks")
    );
    expect(res.status).toBe(200);
    const tasks = (await res.json()) as Array<Record<string, unknown>>;
    expect(Array.isArray(tasks)).toBe(true);
    assertSLO("api.task.crud.list.latency", durationMs, 200);
  });

  it("SLI api.task.crud.latency: UPDATE < 200ms", async () => {
    const taskName = `sli-crud-update-${Date.now()}`;
    const createRes = await api("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: taskName,
        prompt: "echo sli-update-test",
        sandboxType: "native",
        executionMode: "queued",
      }),
    });
    expect(createRes.status).toBe(201);
    const task = (await createRes.json()) as Record<string, unknown>;
    const taskId = task["id"] as string;

    const { result: res, durationMs } = await measure(() =>
      api(`/api/tasks/${taskId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: "Updated by SLI test" }),
      })
    );
    expect(res.status).toBe(200);
    const updated = (await res.json()) as Record<string, unknown>;
    expect(updated["description"]).toBe("Updated by SLI test");
    assertSLO("api.task.crud.update.latency", durationMs, 200);

    await api(`/api/tasks/${taskId}`, { method: "DELETE" });
  });

  it("SLI api.task.crud.latency: DELETE < 200ms", async () => {
    const taskName = `sli-crud-delete-${Date.now()}`;
    const createRes = await api("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: taskName,
        prompt: "echo sli-delete-test",
        sandboxType: "native",
        executionMode: "queued",
      }),
    });
    expect(createRes.status).toBe(201);
    const task = (await createRes.json()) as Record<string, unknown>;
    const taskId = task["id"] as string;

    const { result: res, durationMs } = await measure(() =>
      api(`/api/tasks/${taskId}`, { method: "DELETE" })
    );
    expect(res.status).toBe(200);
    assertSLO("api.task.crud.delete.latency", durationMs, 200);
  });

  // ---------------------------------------------------------------------------
  // SLI: api.execution.list.latency — < 200ms
  // ---------------------------------------------------------------------------

  it("SLI api.execution.list.latency: GET /api/executions < 200ms", async () => {
    const { result: res, durationMs } = await measure(() =>
      api("/api/executions")
    );
    expect(res.status).toBe(200);
    const executions = (await res.json()) as Array<Record<string, unknown>>;
    expect(Array.isArray(executions)).toBe(true);
    assertSLO("api.execution.list.latency", durationMs, 200);
  });

  // ---------------------------------------------------------------------------
  // SLI: api.mcp.tools_list.latency — POST /mcp tools/list < 100ms
  // ---------------------------------------------------------------------------

  it("SLI api.mcp.tools_list.latency: POST /mcp tools/list < 100ms", async () => {
    const { result: res, durationMs } = await measure(() =>
      api("/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
          params: {},
        }),
      })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    const result = body["result"] as Record<string, unknown>;
    expect(result["tools"]).toBeTruthy();
    assertSLO("api.mcp.tools_list.latency", durationMs, 100);
  });

  // ---------------------------------------------------------------------------
  // SLI: api.mcp.tool_call.latency — tools/call list_tasks < 500ms
  // ---------------------------------------------------------------------------

  it("SLI api.mcp.tool_call.latency: tools/call list_tasks < 500ms", async () => {
    const { result: res, durationMs } = await measure(() =>
      api("/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "list_tasks",
            arguments: {},
          },
        }),
      })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["error"]).toBeUndefined();
    const result = body["result"] as Record<string, unknown>;
    expect(result).toBeTruthy();
    assertSLO("api.mcp.tool_call.latency", durationMs, 500);
  });
});

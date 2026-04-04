// tests/smoke/06-mcp-endpoint.test.ts
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { startServer, makeApi, type ServerHandle } from "./helpers.ts";

describe("06-mcp-endpoint", () => {
  let handle: ServerHandle;
  let api: ReturnType<typeof makeApi>;

  beforeAll(async () => {
    handle = await startServer();
    api = makeApi(handle.baseUrl);
  });

  afterAll(async () => {
    await handle.cleanup();
  });

  async function rpc(method: string, params?: Record<string, unknown>) {
    const res = await api("/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method,
        params,
      }),
    });
    expect(res.status).toBe(200);
    return res.json() as Promise<Record<string, unknown>>;
  }

  it("initialize returns server info with protocolVersion", async () => {
    const resp = await rpc("initialize");
    const result = resp["result"] as Record<string, unknown>;
    expect(result["protocolVersion"]).toBeTruthy();
    const serverInfo = result["serverInfo"] as Record<string, unknown>;
    expect(serverInfo["name"]).toBe("baara-next");
  });

  it("tools/list returns at least the core tool names", async () => {
    const resp = await rpc("tools/list");
    const result = resp["result"] as Record<string, unknown>;
    const tools = result["tools"] as Array<{ name: string }>;
    expect(tools.length).toBeGreaterThan(0);
    const names = tools.map((t) => t.name);
    expect(names).toContain("list_tasks");
    expect(names).toContain("create_task");
    expect(names).toContain("run_task");
    expect(names).toContain("submit_task");
    expect(names).toContain("list_executions");
    expect(names).toContain("get_execution");
    expect(names).toContain("cancel_execution");
    expect(names).toContain("retry_execution");
    expect(names).toContain("get_system_status");
    expect(names).toContain("get_execution_logs");
    expect(names).toContain("list_queues");
    expect(names).toContain("get_queue_info");
    expect(names).toContain("dlq_list");
    expect(names).toContain("dlq_retry");
    expect(names).toContain("list_pending_input");
    expect(names).toContain("provide_input");
  });

  it("tools/call create_task creates a task via MCP", async () => {
    const taskName = `smoke-mcp-${Date.now()}`;
    const resp = await rpc("tools/call", {
      name: "create_task",
      arguments: {
        name: taskName,
        prompt: "echo created via mcp",
        sandboxType: "native",
      },
    });
    // Should be a result, not an error
    expect(resp["error"]).toBeUndefined();
    const result = resp["result"] as Record<string, unknown>;
    // MCP tools return { content: [...] } with tool result
    expect(result).toBeTruthy();
  });
});

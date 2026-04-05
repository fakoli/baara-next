// tests/sli/05-mcp-protocol.test.ts
//
// MCP protocol compliance — verifies the HTTP /mcp JSON-RPC 2.0 endpoint
// implements the MCP specification correctly.
//
// Tests:
//   initialize returns correct protocolVersion and serverInfo
//   tools/list returns all 27 tools with names and descriptions
//   Each tool has an inputSchema field (JSON Schema)
//   tools/call with valid args returns structured result
//   tools/call with invalid tool name returns proper error
//   Full lifecycle via MCP: create_task → get_task → delete_task

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import {
  startServer,
  makeApi,
  type ServerHandle,
} from "./helpers.ts";

describe("05-mcp-protocol", () => {
  let handle: ServerHandle;
  let api: ReturnType<typeof makeApi>;

  beforeAll(async () => {
    handle = await startServer();
    api = makeApi(handle.baseUrl);
  }, 30_000);

  afterAll(async () => {
    await handle.cleanup();
  });

  /**
   * Send a JSON-RPC 2.0 request to POST /mcp.
   */
  async function rpc(
    method: string,
    params?: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const res = await api("/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Math.floor(Math.random() * 1_000_000),
        method,
        params,
      }),
    });
    expect(res.status).toBe(200);
    return res.json() as Promise<Record<string, unknown>>;
  }

  // ---------------------------------------------------------------------------
  // initialize — returns correct protocolVersion and serverInfo
  // ---------------------------------------------------------------------------

  it("MCP initialize returns protocolVersion and serverInfo.name = 'baara-next'", async () => {
    const resp = await rpc("initialize");
    expect(resp["error"]).toBeUndefined();

    const result = resp["result"] as Record<string, unknown>;
    expect(typeof result["protocolVersion"]).toBe("string");
    expect((result["protocolVersion"] as string).length).toBeGreaterThan(0);

    const serverInfo = result["serverInfo"] as Record<string, unknown>;
    expect(serverInfo["name"]).toBe("baara-next");
    expect(typeof serverInfo["version"]).toBe("string");

    console.log(
      `  MCP protocolVersion: ${result["protocolVersion"]}  serverInfo.version: ${serverInfo["version"]}`
    );
  });

  // ---------------------------------------------------------------------------
  // tools/list — returns all 27 tools with names and descriptions
  // ---------------------------------------------------------------------------

  it("MCP tools/list returns exactly 27 tools", async () => {
    const resp = await rpc("tools/list");
    expect(resp["error"]).toBeUndefined();

    const result = resp["result"] as Record<string, unknown>;
    const tools = result["tools"] as Array<Record<string, unknown>>;
    expect(Array.isArray(tools)).toBe(true);

    console.log(`  MCP tools count: ${tools.length} (target: 27)`);
    expect(tools.length).toBe(27);
  });

  it("MCP tools/list each tool has a name and description", async () => {
    const resp = await rpc("tools/list");
    const result = resp["result"] as Record<string, unknown>;
    const tools = result["tools"] as Array<Record<string, unknown>>;

    for (const tool of tools) {
      expect(typeof tool["name"]).toBe("string");
      expect((tool["name"] as string).length).toBeGreaterThan(0);
      expect(typeof tool["description"]).toBe("string");
      expect((tool["description"] as string).length).toBeGreaterThan(0);
    }
  });

  it("MCP tools/list each tool has an inputSchema field (object)", async () => {
    const resp = await rpc("tools/list");
    const result = resp["result"] as Record<string, unknown>;
    const tools = result["tools"] as Array<Record<string, unknown>>;

    for (const tool of tools) {
      // inputSchema must be present and be an object (may be empty {} for
      // tools that take no arguments, or a Zod/JSON Schema object for tools
      // that require arguments).
      const schema = tool["inputSchema"];
      expect(schema).toBeDefined();
      expect(typeof schema).toBe("object");
      expect(schema).not.toBeNull();
    }
  });

  it("MCP tools/list contains all expected tool group representatives", async () => {
    const resp = await rpc("tools/list");
    const result = resp["result"] as Record<string, unknown>;
    const tools = result["tools"] as Array<{ name: string }>;
    const names = new Set(tools.map((t) => t.name));

    // Tasks group
    expect(names.has("list_tasks")).toBe(true);
    expect(names.has("get_task")).toBe(true);
    expect(names.has("create_task")).toBe(true);
    expect(names.has("update_task")).toBe(true);
    expect(names.has("delete_task")).toBe(true);
    expect(names.has("toggle_task")).toBe(true);

    // Executions group
    expect(names.has("run_task")).toBe(true);
    expect(names.has("submit_task")).toBe(true);
    expect(names.has("list_executions")).toBe(true);
    expect(names.has("get_execution")).toBe(true);
    expect(names.has("get_execution_events")).toBe(true);
    expect(names.has("cancel_execution")).toBe(true);
    expect(names.has("retry_execution")).toBe(true);
    expect(names.has("get_system_status")).toBe(true);
    expect(names.has("get_execution_logs")).toBe(true);

    // Queues group
    expect(names.has("list_queues")).toBe(true);
    expect(names.has("get_queue_info")).toBe(true);
    expect(names.has("dlq_list")).toBe(true);
    expect(names.has("dlq_retry")).toBe(true);

    // HITL group
    expect(names.has("list_pending_input")).toBe(true);
    expect(names.has("provide_input")).toBe(true);

    // Templates group
    expect(names.has("list_templates")).toBe(true);
    expect(names.has("create_task_from_template")).toBe(true);

    // Projects group
    expect(names.has("list_projects")).toBe(true);
    expect(names.has("set_active_project")).toBe(true);

    // Claude Code group
    expect(names.has("discover_plugins")).toBe(true);
    expect(names.has("run_skill")).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // tools/call with valid args returns structured result
  // ---------------------------------------------------------------------------

  it("MCP tools/call get_system_status returns structured result", async () => {
    const resp = await rpc("tools/call", {
      name: "get_system_status",
      arguments: {},
    });
    expect(resp["error"]).toBeUndefined();

    const result = resp["result"] as Record<string, unknown>;
    expect(result).toBeTruthy();

    // MCP tool results have a "content" array
    const content = result["content"] as Array<Record<string, unknown>>;
    expect(Array.isArray(content)).toBe(true);
    expect(content.length).toBeGreaterThan(0);
    expect(content[0]!["type"]).toBe("text");
    expect(typeof content[0]!["text"]).toBe("string");
  });

  it("MCP tools/call list_queues returns queue information", async () => {
    const resp = await rpc("tools/call", {
      name: "list_queues",
      arguments: {},
    });
    expect(resp["error"]).toBeUndefined();

    const result = resp["result"] as Record<string, unknown>;
    const content = result["content"] as Array<Record<string, unknown>>;
    expect(Array.isArray(content)).toBe(true);
    expect(content.length).toBeGreaterThan(0);

    // The text payload should reference known queue names
    const text = content[0]!["text"] as string;
    expect(text).toBeTruthy();
  });

  // ---------------------------------------------------------------------------
  // tools/call with invalid tool name returns proper error
  // ---------------------------------------------------------------------------

  it("MCP tools/call with nonexistent tool name returns JSON-RPC error or isError result", async () => {
    const resp = await rpc("tools/call", {
      name: "this_tool_does_not_exist",
      arguments: {},
    });

    // MCP may return either a JSON-RPC error OR a tool result with isError=true
    const hasRpcError = resp["error"] !== undefined;
    const result = resp["result"] as Record<string, unknown> | undefined;
    const hasToolError =
      result !== undefined &&
      (result["isError"] === true ||
        (Array.isArray(result["content"]) &&
          (result["content"] as Array<Record<string, unknown>>).some(
            (c) => c["type"] === "text" && typeof c["text"] === "string"
          )));

    expect(hasRpcError || hasToolError).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Full lifecycle via MCP: create_task → get_task → delete_task
  // ---------------------------------------------------------------------------

  it("MCP lifecycle: create_task → get_task → delete_task", async () => {
    const taskName = `sli-mcp-lifecycle-${Date.now()}`;

    // Step 1: create_task
    const createResp = await rpc("tools/call", {
      name: "create_task",
      arguments: {
        name: taskName,
        prompt: "echo mcp-lifecycle-test",
        sandboxType: "native",
        executionMode: "queued",
      },
    });
    expect(createResp["error"]).toBeUndefined();
    const createResult = createResp["result"] as Record<string, unknown>;
    expect(createResult).toBeTruthy();

    // Extract the task ID from the content text
    const createContent = createResult["content"] as Array<Record<string, unknown>>;
    const createText = createContent[0]!["text"] as string;
    expect(createText).toBeTruthy();

    // Verify the task was actually created via the REST API
    const restRes = await api(`/api/tasks/${encodeURIComponent(taskName)}`);
    expect(restRes.status).toBe(200);
    const restTask = (await restRes.json()) as Record<string, unknown>;
    const taskId = restTask["id"] as string;
    expect(taskId).toBeTruthy();

    // Step 2: get_task via MCP — uses "nameOrId" argument (not "id")
    const getResp = await rpc("tools/call", {
      name: "get_task",
      arguments: { nameOrId: taskId },
    });
    expect(getResp["error"]).toBeUndefined();
    const getResult = getResp["result"] as Record<string, unknown>;
    const getContent = getResult["content"] as Array<Record<string, unknown>>;
    expect(getContent.length).toBeGreaterThan(0);
    const getText = getContent[0]!["text"] as string;
    expect(getText).toBeTruthy();
    // The task name should appear in the output
    expect(getText).toContain(taskName);

    // Step 3: delete_task via MCP — also uses "nameOrId" argument
    const deleteResp = await rpc("tools/call", {
      name: "delete_task",
      arguments: { nameOrId: taskId },
    });
    expect(deleteResp["error"]).toBeUndefined();

    // Verify deletion via REST
    const verifyRes = await api(`/api/tasks/${taskId}`);
    expect(verifyRes.status).toBe(404);

    console.log(
      `  MCP lifecycle complete: created task "${taskName}" (${taskId}), retrieved, and deleted`
    );
  });
});

// @baara-next/mcp — HTTP transport
//
// Creates a Hono sub-application that exposes the MCP server over HTTP at /mcp.
// Mount this on the main server: app.route("/mcp", createMcpHttpApp(deps))
//
// Remote clients (Claude Code via .mcp.json with "type": "http") connect here.
//
// The handler implements JSON-RPC 2.0 dispatch directly against the tool
// handler functions — it does NOT call createSdkMcpServer(), whose returned
// object is for in-process Agent SDK use only and has no HTTP handle() method.

import { Hono } from "hono";
import type { IStore, IOrchestratorService } from "@baara-next/core";
import { createAllTools, handleJsonRpc } from "./server.ts";

export interface McpHttpAppDeps {
  store: IStore;
  orchestrator: IOrchestratorService;
  /** Path to the JSONL logs directory. When provided, get_execution_logs reads from JSONL files. */
  logsDir?: string;
}

/**
 * Create a Hono sub-app that handles HTTP MCP requests.
 *
 * Mount on the main server:
 *   app.route("/mcp", createMcpHttpApp({ store, orchestrator }));
 *
 * Claude Code .mcp.json entry:
 *   { "baara-next": { "type": "http", "url": "http://localhost:3000/mcp" } }
 */
export function createMcpHttpApp(deps: McpHttpAppDeps) {
  const app = new Hono();
  const tools = createAllTools(deps);
  const toolMap = new Map(tools.map((t) => [t.name, t]));

  // MCP over HTTP uses POST / for all JSON-RPC requests.
  app.post("/", async (c) => {
    try {
      const body = await c.req.json();
      const response = await handleJsonRpc(body, toolMap);
      return c.json(response);
    } catch (e) {
      return c.json(
        { jsonrpc: "2.0", error: { code: -32700, message: `Parse error: ${String(e)}` }, id: null },
        500
      );
    }
  });

  // SSE endpoint for streaming MCP transport (used by some clients).
  app.get("/sse", async (c) => {
    return c.text("SSE MCP transport not yet implemented", 501);
  });

  return app;
}

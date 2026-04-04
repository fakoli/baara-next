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
import { streamSSE } from "hono/streaming";
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
  //
  // Implements the "Streamable HTTP" pattern from the MCP spec:
  //   1. Client opens GET /mcp/sse — server holds the connection open as SSE.
  //   2. An initial "endpoint" event tells the client where to POST requests.
  //   3. Client sends JSON-RPC requests via POST /mcp (handled above).
  //   4. Periodic "ping" events keep the connection alive through proxies.
  //   5. The connection closes when the client disconnects (abort signal).
  app.get("/sse", (c) => {
    return streamSSE(c, async (stream) => {
      // Tell the client where to POST JSON-RPC requests.
      await stream.writeSSE({
        event: "endpoint",
        data: "/mcp",
      });

      // Keep the connection alive with periodic pings so HTTP proxies and
      // load-balancers don't time out idle SSE connections.
      const interval = setInterval(async () => {
        try {
          await stream.writeSSE({ event: "ping", data: "" });
        } catch {
          clearInterval(interval);
        }
      }, 30_000);

      // Block until the client disconnects.
      const { promise, resolve } = Promise.withResolvers<void>();
      c.req.raw.signal.addEventListener("abort", () => {
        clearInterval(interval);
        resolve();
      });
      await promise;
    });
  });

  return app;
}

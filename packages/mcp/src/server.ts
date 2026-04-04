// @baara-next/mcp — createBaaraMcpServer() factory
//
// Assembles all 27 tool definitions into a single in-process MCP server using
// createSdkMcpServer() from the Agent SDK.  Pass the returned server object
// directly to Agent SDK query() as mcpServers: { "baara-next": server }.
//
// Also exports createAllTools() and handleJsonRpc() for use by the HTTP and
// stdio transports which implement their own JSON-RPC dispatch loop.

import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import type { SdkMcpToolDefinition } from "@anthropic-ai/claude-agent-sdk";
import type { IStore, IOrchestratorService } from "@baara-next/core";

import { createTaskTools } from "./tools/tasks.ts";
import { createExecutionTools } from "./tools/executions.ts";
import { createQueueTools } from "./tools/queues.ts";
import { createHitlTools } from "./tools/hitl.ts";
import { createTemplateTools } from "./tools/templates.ts";
import { createProjectTools } from "./tools/projects.ts";
import { createClaudeCodeTools } from "./tools/claude-code.ts";

export interface BaaraMcpServerDeps {
  store: IStore;
  orchestrator: IOrchestratorService;
  /** Path to the JSONL logs directory. When provided, get_execution_logs reads from JSONL files. */
  logsDir?: string;
}

// ---------------------------------------------------------------------------
// Tool shape expected by the Agent SDK
// ---------------------------------------------------------------------------

/**
 * Re-export the SDK tool type under a shorter alias.
 * Used by http.ts and stdio.ts to type their tool dispatch maps.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type McpTool = SdkMcpToolDefinition<any>;

// ---------------------------------------------------------------------------
// Shared tool factory
// ---------------------------------------------------------------------------

/**
 * Create the flat array of all 27 BAARA Next tools.
 *
 * Exported so that HTTP and stdio transports can build their own dispatch
 * maps without going through createSdkMcpServer().
 */
export function createAllTools(deps: BaaraMcpServerDeps): McpTool[] {
  // Total: 6 + 9 + 4 + 2 + 2 + 2 + 2 = 27 tools
  // Cast to McpTool[] (SdkMcpToolDefinition<any>[]) to erase the specific schema
  // generics — the handlers are callable with any args object at runtime.
  return [
    // tasks.ts — 6 tools
    ...(createTaskTools(deps) as McpTool[]),
    // executions.ts — 9 tools (logsDir threaded for JSONL log reading)
    ...(createExecutionTools({ store: deps.store, orchestrator: deps.orchestrator, logsDir: deps.logsDir }) as McpTool[]),
    // queues.ts — 4 tools
    ...(createQueueTools(deps) as McpTool[]),
    // hitl.ts — 2 tools
    ...(createHitlTools(deps) as McpTool[]),
    // templates.ts — 2 tools
    ...(createTemplateTools(deps) as McpTool[]),
    // projects.ts — 2 tools
    ...(createProjectTools(deps) as McpTool[]),
    // claude-code.ts — 2 tools
    ...(createClaudeCodeTools(deps) as McpTool[]),
  ];
}

// ---------------------------------------------------------------------------
// Shared JSON-RPC dispatcher
// ---------------------------------------------------------------------------

/** Shape of a JSON-RPC 2.0 request. */
interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

/**
 * Handle a single JSON-RPC 2.0 request against a pre-built tool map.
 *
 * Handles the three MCP methods used by Claude Code clients:
 *   - initialize     — returns server info
 *   - tools/list     — returns the list of available tools
 *   - tools/call     — invokes a tool by name
 *
 * Returns a well-formed JSON-RPC 2.0 response object.
 */
export async function handleJsonRpc(
  request: JsonRpcRequest,
  toolMap: Map<string, McpTool>
): Promise<unknown> {
  const id = request.id ?? null;

  if (request.method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "baara-next", version: "0.1.0" },
      },
    };
  }

  if (request.method === "tools/list") {
    const tools = Array.from(toolMap.values()).map((t) => ({
      name: t.name,
      description: t.description,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      inputSchema: (t as any).inputSchema ?? (t as any).schema ?? { type: "object", properties: {} },
    }));
    return { jsonrpc: "2.0", id, result: { tools } };
  }

  if (request.method === "tools/call") {
    const params = request.params ?? {};
    const name = params["name"] as string | undefined;
    const args = (params["arguments"] ?? {}) as Record<string, unknown>;
    if (!name) {
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32602, message: "Missing required param: name" },
      };
    }
    const tool = toolMap.get(name);
    if (!tool) {
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Tool not found: ${name}` },
      };
    }
    try {
      const result = await tool.handler(args, null);
      return { jsonrpc: "2.0", id, result };
    } catch (e) {
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32603, message: String(e) },
      };
    }
  }

  return {
    jsonrpc: "2.0",
    id,
    error: { code: -32601, message: `Method not found: ${request.method}` },
  };
}

// ---------------------------------------------------------------------------
// In-process MCP server (for Agent SDK query() integration)
// ---------------------------------------------------------------------------

/**
 * Create an in-process MCP server with all 27 BAARA Next tools.
 *
 * Usage with Agent SDK:
 *   const mcpServer = createBaaraMcpServer({ store, orchestrator });
 *   await query({ mcpServers: { "baara-next": mcpServer }, ... });
 */
export function createBaaraMcpServer(deps: BaaraMcpServerDeps) {
  const tools = createAllTools(deps);

  return createSdkMcpServer({
    name: "baara-next",
    tools,
  });
}

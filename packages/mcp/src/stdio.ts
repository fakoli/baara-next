// @baara-next/mcp — stdio transport
//
// Runs the BAARA Next MCP server over stdio so Claude Code can connect via:
//
//   .mcp.json:
//   {
//     "mcpServers": {
//       "baara-next": {
//         "command": "baara",
//         "args": ["mcp-server", "--data-dir", "~/.baara"]
//       }
//     }
//   }
//
// The CLI command (packages/cli) calls runStdioMcpServer() after wiring up
// the store and orchestrator from the data directory.
//
// This module does NOT call createSdkMcpServer() — that object is for
// in-process Agent SDK use only and has no runStdio() or handle() method.
// Instead, it reads line-delimited JSON-RPC from stdin, dispatches via
// handleJsonRpc(), and writes responses to stdout.

import type { IStore, IOrchestratorService } from "@baara-next/core";
import { createAllTools, handleJsonRpc } from "./server.ts";

export interface StdioMcpServerDeps {
  store: IStore;
  orchestrator: IOrchestratorService;
  /** Path to the JSONL logs directory. When provided, get_execution_logs reads from JSONL files. */
  logsDir?: string;
}

/**
 * Start the MCP server in stdio transport mode.
 *
 * Reads line-delimited JSON-RPC requests from stdin, writes responses to
 * stdout.  stderr is used for diagnostic logging.
 *
 * This function blocks until stdin is closed (i.e. the MCP client disconnects).
 */
export async function runStdioMcpServer(deps: StdioMcpServerDeps): Promise<void> {
  const tools = createAllTools(deps);
  const toolMap = new Map(tools.map((t) => [t.name, t]));

  process.stderr.write("[baara-next mcp-server] Starting stdio MCP server\n");

  const decoder = new TextDecoder();
  let buffer = "";

  for await (const chunk of process.stdin) {
    buffer += decoder.decode(chunk as Uint8Array, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const request = JSON.parse(trimmed);
        const response = await handleJsonRpc(request, toolMap);
        process.stdout.write(JSON.stringify(response) + "\n");
      } catch (e) {
        process.stderr.write(`[baara-next mcp-server] Parse error: ${String(e)}\n`);
        process.stdout.write(
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32700, message: "Parse error" },
            id: null,
          }) + "\n"
        );
      }
    }
  }

  process.stderr.write("[baara-next mcp-server] Stdin closed, shutting down\n");
}

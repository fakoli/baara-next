// @baara-next/cli — mcp-server command
//
// Starts a stdio-based MCP server so external tools (e.g. Claude Code) can
// access BAARA's 27 tools without a running HTTP server.
//
// Usage:
//   baara mcp-server [--data-dir ~/.baara]
//
// Claude Code .mcp.json entry:
//   {
//     "mcpServers": {
//       "baara": {
//         "command": "baara",
//         "args": ["mcp-server", "--data-dir", "~/.baara"]
//       }
//     }
//   }

import { Command } from "commander";
import { mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { createStore } from "@baara-next/store";
import { OrchestratorService } from "@baara-next/orchestrator";
import { runStdioMcpServer } from "@baara-next/mcp";

export function registerMcpServerCommand(program: Command): void {
  program
    .command("mcp-server")
    .description(
      "Start a stdio-based MCP server exposing all 27 BAARA tools to Claude Code"
    )
    .option(
      "--data-dir <dir>",
      "Data directory containing the SQLite database",
      join(homedir(), ".baara")
    )
    .action(async (opts: { dataDir: string }) => {
      // Expand leading ~ to the home directory (Commander passes the raw string).
      const dataDir = opts.dataDir.replace(/^~(?=\/|$)/, homedir());
      mkdirSync(dataDir, { recursive: true });
      const dbPath = join(dataDir, "baara.db");

      // Silence all diagnostic output on stdout — it is reserved for the MCP
      // JSON-RPC protocol.  Route startup noise to stderr so MCP clients don't
      // misparse it.
      process.stderr.write(`[baara mcp-server] starting — db: ${dbPath}\n`);

      // In-process store and orchestrator (same pattern as other CLI commands).
      // OrchestratorService accepts (store, registry?) — registry is optional.
      const store = createStore(dbPath);
      const orchestrator = new OrchestratorService(store);

      // runStdioMcpServer reads line-delimited JSON-RPC from stdin and writes
      // responses to stdout.  It blocks until stdin closes.
      await runStdioMcpServer({ store, orchestrator });

      process.stderr.write("[baara mcp-server] session ended\n");
    });
}

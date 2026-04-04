# Plan E: stdio MCP + CLI Chat

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Add two new CLI commands — `baara mcp-server` (stdio MCP for Claude Code) and `baara chat` (interactive REPL) — and publish a `.mcp.json` example so external Claude Code users can connect to BAARA's 27 tools without opening the web UI.

**Architecture:** Both commands create an in-process store and use the same `createBaaraMcpServer()` from `packages/mcp`. `mcp-server` wires the server to stdin/stdout transport. `chat` runs a readline REPL that calls Agent SDK `query()` with the MCP server attached, printing streaming output to the terminal.

**Tech Stack:** Commander, Node `readline`, `@anthropic-ai/claude-agent-sdk`, `@baara-next/mcp`, `@baara-next/store`

**Depends on:** Plan A (`packages/mcp` with `createBaaraMcpServer`) must be complete before implementing this plan. No dependency on Plan B or Plan C.

---

### Task 1: Create packages/cli/src/commands/mcp-server.ts

**Files:**
- Create: `packages/cli/src/commands/mcp-server.ts`

- [ ] **Step 1: Create the `baara mcp-server` command.**

This command starts a stdio-based MCP server. Claude Code connects to it via `.mcp.json` (see Task 4). The command reads from `process.stdin` and writes to `process.stdout`, forwarding MCP protocol messages. It never exits until the parent process closes stdin.

```typescript
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
import { createBaaraMcpServer } from "@baara-next/mcp";

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
      const dataDir = opts.dataDir.replace(/^~/, homedir());
      mkdirSync(dataDir, { recursive: true });
      const dbPath = join(dataDir, "baara.db");

      // Silence all diagnostic output — stdout is reserved for MCP protocol.
      // Route any startup noise to stderr so MCP clients don't misparse it.
      process.stderr.write(`[baara mcp-server] starting — db: ${dbPath}\n`);

      // In-process store and orchestrator (same as other CLI commands).
      const store = createStore(dbPath);

      // OrchestratorService is needed by tools that create/manage executions.
      // We pass a minimal orchestrator; it operates against the store directly.
      const orchestrator = new OrchestratorService({ store });

      // Create the MCP server with all 27 tools attached.
      const mcpServer = createBaaraMcpServer({ store, orchestrator });

      // Connect stdin/stdout transport — the Agent SDK's createSdkMcpServer
      // returns an object with a connectStdio() method for CLI use.
      await mcpServer.connectStdio({
        input:  process.stdin,
        output: process.stdout,
      });

      // connectStdio resolves when stdin closes (i.e. the MCP client exits).
      process.stderr.write(`[baara mcp-server] session ended\n`);
      process.exit(0);
    });
}
```

---

### Task 2: Create packages/cli/src/commands/chat.ts

**Files:**
- Create: `packages/cli/src/commands/chat.ts`

- [ ] **Step 1: Create the `baara chat` interactive REPL command.**

The REPL accepts user input line-by-line, sends each message to Agent SDK `query()` with the in-process MCP server, and prints streaming text to the terminal. Supports `/quit`, `/history`, `/thread <id>` slash commands.

```typescript
// @baara-next/cli — chat command
//
// Interactive REPL for BAARA Next. Equivalent to the web UI chat window but
// rendered in the terminal with ANSI color output.
//
// Usage:
//   baara chat [--data-dir ~/.baara]
//
// Slash commands inside the REPL:
//   /quit               Exit the REPL
//   /history            Print all messages in the current thread
//   /thread <id>        Switch to an existing thread by ID
//   /threads            List all threads (most recent first)
//   /new                Start a fresh thread

import { Command } from "commander";
import { mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import * as readline from "readline";
import { createStore } from "@baara-next/store";
import { OrchestratorService } from "@baara-next/orchestrator";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { createBaaraMcpServer } from "@baara-next/mcp";
import type { IStore } from "@baara-next/core";

// ---------------------------------------------------------------------------
// ANSI color helpers
// ---------------------------------------------------------------------------

const RESET  = "\x1b[0m";
const BOLD   = "\x1b[1m";
const DIM    = "\x1b[2m";
const CYAN   = "\x1b[36m";
const GREEN  = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED    = "\x1b[31m";
const BLUE   = "\x1b[34m";
const GRAY   = "\x1b[90m";

function color(text: string, ...codes: string[]): string {
  return codes.join("") + text + RESET;
}

// ---------------------------------------------------------------------------
// In-memory chat history
// ---------------------------------------------------------------------------

interface HistoryEntry {
  role: "user" | "agent";
  text: string;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// System prompt builder (simplified terminal version)
// ---------------------------------------------------------------------------

function buildCliSystemPrompt(store: IStore, threadId: string | null): string {
  const tasks = store.listTasks();
  const executions = store.listExecutions();
  const running = executions.filter((e) => e.status === "running").length;
  const queued  = executions.filter((e) => e.status === "queued" || e.status === "assigned").length;
  const failed  = executions.filter((e) => e.status === "failed").length;

  const thread = threadId ? store.getThread(threadId) : null;

  return [
    "You are BAARA Next, a durable agentic task execution assistant running in a terminal REPL.",
    "",
    "You have access to 27 tools for creating, running, monitoring, and troubleshooting tasks.",
    "The user is operating from the command line. Be concise. Use plain text, not markdown tables.",
    "",
    "## Live System State",
    `Running: ${running}  Queued: ${queued}  Failed: ${failed}  Total tasks: ${tasks.length}`,
    ...(thread ? [
      "",
      `## Active Thread: ${thread.title || thread.id}`,
      `Thread ID: ${thread.id}`,
    ] : []),
  ].join("\n");
}

// ---------------------------------------------------------------------------
// registerChatCommand
// ---------------------------------------------------------------------------

export function registerChatCommand(program: Command): void {
  program
    .command("chat")
    .description("Interactive REPL chat with the BAARA agent (27 MCP tools)")
    .option(
      "--data-dir <dir>",
      "Data directory containing the SQLite database",
      join(homedir(), ".baara")
    )
    .option("--thread <id>", "Resume an existing thread by ID")
    .action(async (opts: { dataDir: string; thread?: string }) => {
      const dataDir = opts.dataDir.replace(/^~/, homedir());
      mkdirSync(dataDir, { recursive: true });
      const dbPath = join(dataDir, "baara.db");

      const store = createStore(dbPath);
      const orchestrator = new OrchestratorService({ store });

      // Session state
      let sessionId: string | null = null;
      let threadId: string | null = opts.thread ?? null;
      let history: HistoryEntry[] = [];

      // Validate --thread if provided
      if (threadId) {
        const t = store.getThread(threadId);
        if (!t) {
          console.error(color(`Thread not found: ${threadId}`, RED));
          process.exit(1);
        }
        console.log(color(`Resumed thread: ${t.title || t.id}`, CYAN));
      }

      // Print banner
      console.log(
        color(
          "\n  BAARA Next — Chat REPL  (type /quit to exit, /help for commands)\n",
          BOLD, CYAN
        )
      );

      // Readline interface
      const rl = readline.createInterface({
        input:  process.stdin,
        output: process.stdout,
        terminal: true,
      });

      function prompt(): void {
        rl.question(color("You > ", BOLD, GREEN), handleLine);
      }

      async function handleLine(line: string): Promise<void> {
        const trimmed = line.trim();

        // Handle slash commands
        if (trimmed.startsWith("/")) {
          const parts = trimmed.split(/\s+/);
          const cmd   = parts[0]!.toLowerCase();

          switch (cmd) {
            case "/quit":
            case "/exit":
            case "/q":
              console.log(color("Goodbye.", DIM));
              rl.close();
              process.exit(0);
              return;

            case "/help":
              console.log([
                color("  /quit          ", BOLD) + "Exit the REPL",
                color("  /history       ", BOLD) + "Print conversation history",
                color("  /thread <id>   ", BOLD) + "Switch to an existing thread",
                color("  /threads       ", BOLD) + "List all threads",
                color("  /new           ", BOLD) + "Start a fresh thread",
              ].join("\n"));
              prompt();
              return;

            case "/history": {
              if (history.length === 0) {
                console.log(color("  No messages in this session.", DIM));
              } else {
                for (const h of history) {
                  const label = h.role === "user"
                    ? color("You   ", BOLD, GREEN)
                    : color("BAARA ", BOLD, CYAN);
                  console.log(`${label}  ${h.text}`);
                }
              }
              prompt();
              return;
            }

            case "/threads": {
              const threads = store.listThreads();
              if (threads.length === 0) {
                console.log(color("  No threads found.", DIM));
              } else {
                threads
                  .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
                  .slice(0, 20)
                  .forEach((t) => {
                    const marker = t.id === threadId ? color("* ", GREEN) : "  ";
                    console.log(`${marker}${color(t.id.slice(0, 8), GRAY)}  ${t.title || "(untitled)"}`);
                  });
              }
              prompt();
              return;
            }

            case "/thread": {
              const id = parts[1];
              if (!id) {
                console.log(color("  Usage: /thread <id>", DIM));
                prompt();
                return;
              }
              const t = store.getThread(id);
              if (!t) {
                console.log(color(`  Thread not found: ${id}`, RED));
                prompt();
                return;
              }
              threadId  = t.id;
              sessionId = null;
              history   = [];
              console.log(color(`  Switched to thread: ${t.title || t.id}`, CYAN));
              prompt();
              return;
            }

            case "/new": {
              threadId  = null;
              sessionId = null;
              history   = [];
              console.log(color("  Started a new thread.", CYAN));
              prompt();
              return;
            }

            default:
              console.log(color(`  Unknown command: ${cmd}. Type /help for commands.`, YELLOW));
              prompt();
              return;
          }
        }

        if (!trimmed) {
          prompt();
          return;
        }

        // Record user message
        history.push({ role: "user", text: trimmed, timestamp: new Date().toISOString() });

        // Create a fresh MCP server instance for this turn
        const mcpServer = createBaaraMcpServer({ store, orchestrator });

        // Resolve or generate session ID
        const resolvedSessionId = sessionId ?? crypto.randomUUID();

        const systemPrompt = buildCliSystemPrompt(store, threadId);

        // Print agent label on a new line
        process.stdout.write(color("\nBAARA > ", BOLD, CYAN));

        let agentText = "";
        let lastToolName: string | null = null;

        try {
          const sdkStream = query({
            prompt: trimmed,
            systemPrompt,
            sessionId: resolvedSessionId,
            maxTurns: 20,
            budgetUsd: 0.5,
            mcpServers: { baara: mcpServer },
          });

          for await (const event of sdkStream) {
            switch (event.type) {
              case "text_delta":
                process.stdout.write(event.delta);
                agentText += event.delta;
                break;

              case "tool_use":
                // Print tool invocation indicator on a new line
                if (agentText && !agentText.endsWith("\n")) {
                  process.stdout.write("\n");
                }
                lastToolName = event.name;
                process.stdout.write(
                  color(`  [tool] ${event.name.replace(/_/g, " ")} ...`, YELLOW)
                );
                agentText = "";
                break;

              case "tool_result":
                // Overwrite the in-progress tool line with a tick
                process.stdout.write(
                  `\r${color(`  [done] ${(lastToolName ?? event.name).replace(/_/g, " ")}     `, GREEN)}\n`
                );
                // Re-print agent label for subsequent text
                process.stdout.write(color("BAARA > ", BOLD, CYAN));
                agentText = "";
                lastToolName = null;
                break;

              case "result": {
                sessionId = resolvedSessionId;
                const tokens = (event.usage?.inputTokens ?? 0) + (event.usage?.outputTokens ?? 0);
                const cost   = event.cost != null ? ` · $${event.cost.toFixed(4)}` : "";
                process.stdout.write(
                  `\n${color(`  ${tokens} tokens${cost}`, GRAY)}\n`
                );
                break;
              }
            }
          }

          // Ensure output ends with a newline
          if (agentText && !agentText.endsWith("\n")) {
            process.stdout.write("\n");
          }

          // Persist accumulated agent response to local history
          if (agentText) {
            history.push({ role: "agent", text: agentText, timestamp: new Date().toISOString() });
          }

          // Auto-create a thread on the first successful turn if none exists
          if (!threadId) {
            const title = trimmed.slice(0, 60) + (trimmed.length > 60 ? "..." : "");
            const newThread = store.createThread(crypto.randomUUID(), { title });
            threadId = newThread.id;
          }

        } catch (err) {
          process.stdout.write("\n");
          if ((err as Error).name === "AbortError") {
            console.log(color("  (interrupted)", DIM));
          } else {
            console.error(color(`  Error: ${err instanceof Error ? err.message : String(err)}`, RED));
          }
        }

        prompt();
      }

      prompt();
    });
}
```

---

### Task 3: Register both commands in packages/cli/src/index.ts

**Files:**
- Modify: `packages/cli/src/index.ts`

- [ ] **Step 1: Import and register the two new commands.**

Add the two import lines after the existing imports:

```typescript
import { registerMcpServerCommand } from "./commands/mcp-server.ts";
import { registerChatCommand }      from "./commands/chat.ts";
```

Then add two registration calls after `registerAdminCommand(program)`:

```typescript
registerMcpServerCommand(program);
registerChatCommand(program);
```

The full updated `index.ts` registration block (lines 19–27) becomes:

```typescript
// Register all command groups.
registerStartCommand(program);
registerTasksCommand(program);
registerExecutionsCommand(program);
registerQueuesCommand(program);
registerAdminCommand(program);
registerMcpServerCommand(program);
registerChatCommand(program);
```

---

### Task 4: Add IStore.createThread and IStore.listThreads usage to the chat command

The `chat.ts` command calls `store.createThread()`, `store.listThreads()`, and `store.getThread()`. These are defined in Plan D (thread model). Before this plan can fully compile, Plan D must be complete.

**If running this plan before Plan D:** add a compile-time guard in `chat.ts` by wrapping the `store.createThread` call:

- [ ] **Step 1: Add a safe fallback for thread creation** in `packages/cli/src/commands/chat.ts`. Find the `store.createThread` call and replace with:

```typescript
          // Auto-create a thread on the first successful turn if none exists
          if (!threadId && typeof (store as any).createThread === "function") {
            const title = trimmed.slice(0, 60) + (trimmed.length > 60 ? "..." : "");
            const newThread = (store as any).createThread(crypto.randomUUID(), { title });
            threadId = newThread?.id ?? null;
          }
```

Similarly, wrap `store.listThreads()` and `store.getThread()` with `typeof (store as any).listThreads === "function"` guards. **Remove these guards once Plan D is complete** and `IStore` has the thread methods typed.

---

### Task 5: Write the .mcp.json example to docs

**Files:**
- Create: `docs/mcp-claude-code-example.json`

- [ ] **Step 1: Create the example `.mcp.json` file** that Claude Code users add to their project root (or `~/.claude/mcp.json` for global access).

```json
{
  "mcpServers": {
    "baara": {
      "command": "baara",
      "args": ["mcp-server", "--data-dir", "~/.baara"],
      "description": "BAARA Next — 27 tools for creating, running, and monitoring durable tasks"
    }
  }
}
```

> **Note:** The user must have `baara` on their `PATH`. Install globally with:
> ```bash
> bun install --global @baara-next/cli
> ```
> Or point to the local binary:
> ```json
> {
>   "mcpServers": {
>     "baara": {
>       "command": "/path/to/baara-next/node_modules/.bin/baara",
>       "args": ["mcp-server"]
>     }
>   }
> }
> ```

After connecting, Claude Code gains these tool namespaces:
- `mcp__baara__list_tasks`
- `mcp__baara__create_task`
- `mcp__baara__run_task`
- `mcp__baara__submit_task`
- `mcp__baara__get_execution`
- `mcp__baara__get_system_status`
- … (27 tools total — see `packages/mcp/src/tools/`)

---

### Task 6: Update OrchestratorService instantiation in CLI commands

Both `mcp-server.ts` and `chat.ts` instantiate `new OrchestratorService({ store })`. The existing `start.ts` command creates `OrchestratorService` with more arguments (registry, transport). CLI chat/mcp commands operate in a simplified mode without a running queue, scheduler, or transport.

- [ ] **Step 1: Verify `OrchestratorService` accepts `{ store }` alone** without crashing. Open `packages/orchestrator/src/index.ts` and check the constructor signature.

If the constructor requires additional arguments (e.g. `registry`, `transport`), replace the direct instantiation in both commands with a lightweight wrapper:

```typescript
// Minimal orchestrator for CLI use — no queue polling, no scheduler.
// Only the methods called by MCP tools (createExecution, updateExecutionStatus,
// provideInput, cancelExecution) are needed.
import { OrchestratorService } from "@baara-next/orchestrator";
import { createDefaultRegistry } from "@baara-next/executor";

const registry = createDefaultRegistry();
const orchestrator = new OrchestratorService({ store, registry });
```

This mirrors how `start.ts` wires the orchestrator but skips the transport and agent wiring that is only needed for full queue-based execution.

---

## Verification

After completing all tasks, verify the following:

1. `bunx tsc --noEmit` from the repo root — zero errors.

2. **`baara mcp-server` starts cleanly:**
   ```bash
   echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | baara mcp-server
   ```
   Should write a JSON-RPC response listing all 27 tools to stdout.

3. **`baara chat` opens the REPL:**
   ```
   $ baara chat
     BAARA Next — Chat REPL  (type /quit to exit, /help for commands)
   You >
   ```
   Type `list my tasks` and confirm the agent calls `list_tasks` and prints results.

4. **REPL slash commands work:**
   - `/help` prints the command list.
   - `/threads` lists recent threads (empty if first run).
   - `/quit` exits cleanly.

5. **Thread persistence:** After chatting, run `baara chat` again, type `/threads`, and confirm the previous thread appears.

6. **Claude Code integration** (if Claude Code is installed):
   Add the example JSON to `.mcp.json` in any project directory, reload MCP, then run `mcp__baara__get_system_status` — should return task and queue stats from the local BAARA database.

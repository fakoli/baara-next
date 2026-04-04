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
import { createBaaraMcpServer } from "@baara-next/mcp";
import { query } from "@anthropic-ai/claude-agent-sdk";
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
  const running = store.countExecutionsByStatus("running");
  const queued  = store.countExecutionsByStatus("queued") + store.countExecutionsByStatus("assigned");
  const failed  = store.countExecutionsByStatus("failed");

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
      const dataDir = opts.dataDir.replace(/^~(?=\/|$)/, homedir());
      mkdirSync(dataDir, { recursive: true });
      const dbPath = join(dataDir, "baara.db");

      const store = createStore(dbPath);
      const orchestrator = new OrchestratorService(store);

      // Session state
      let sessionId: string | null = null;
      let threadId: string | null = opts.thread ?? null;
      let history: HistoryEntry[] = [];

      // Validate --thread if provided
      if (threadId) {
        const t = store.getThread(threadId);
        if (!t) {
          throw new Error(`Thread not found: ${threadId}`);
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
        rl.question(color("You > ", BOLD, GREEN), (line) => {
          handleLine(line).catch((err) => {
            console.error(color(`  Fatal: ${err instanceof Error ? err.message : String(err)}`, RED));
            prompt();
          });
        });
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
                "",
                color("  /quit          ", BOLD) + "Exit the REPL",
                color("  /history       ", BOLD) + "Print conversation history",
                color("  /thread <id>   ", BOLD) + "Switch to an existing thread",
                color("  /threads       ", BOLD) + "List all threads",
                color("  /new           ", BOLD) + "Start a fresh thread",
                "",
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
              const threads = store.listThreads({ limit: 20 });
              if (threads.length === 0) {
                console.log(color("  No threads found.", DIM));
              } else {
                threads
                  .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
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

        // Create a fresh in-process MCP server for this turn.
        const mcpServer = createBaaraMcpServer({ store, orchestrator });

        // Assign a session ID on the first turn; reuse it thereafter so the
        // Agent SDK can resume the conversation context.
        const resolvedSessionId = sessionId ?? crypto.randomUUID();

        const systemPrompt = buildCliSystemPrompt(store, threadId);

        // Print agent label on a new line
        process.stdout.write(color("\nBAARA > ", BOLD, CYAN));

        let agentText = "";
        let activeToolName: string | null = null;

        try {
          const sdkStream = query({
            prompt: trimmed,
            options: {
              systemPrompt,
              // On the first turn create a new session; on subsequent turns
              // resume the existing session so the SDK can restore context.
              ...(sessionId ? { resume: resolvedSessionId } : { sessionId: resolvedSessionId }),
              maxTurns: 20,
              maxBudgetUsd: 0.5,
              mcpServers: { baara: mcpServer },
              // Disable all built-in tools — only BAARA MCP tools are needed.
              tools: [],
              allowedTools: [],
              permissionMode: "bypassPermissions",
              allowDangerouslySkipPermissions: true,
            },
          });

          for await (const event of sdkStream) {
            switch (event.type) {
              case "stream_event": {
                // BetaRawMessageStreamEvent — contains partial text deltas.
                const raw = event.event;
                if (
                  raw.type === "content_block_delta" &&
                  raw.delta.type === "text_delta"
                ) {
                  process.stdout.write(raw.delta.text);
                  agentText += raw.delta.text;
                }
                break;
              }

              case "tool_progress": {
                // Show a tool-in-progress indicator.
                if (agentText && !agentText.endsWith("\n")) {
                  process.stdout.write("\n");
                }
                activeToolName = event.tool_name;
                process.stdout.write(
                  color(`  [tool] ${event.tool_name.replace(/_/g, " ")} ...`, YELLOW)
                );
                agentText = "";
                break;
              }

              case "assistant": {
                // Full message — extract text content for history if we haven't
                // captured it via stream_event deltas.
                if (!agentText) {
                  for (const block of event.message.content) {
                    if (block.type === "text") {
                      process.stdout.write(block.text);
                      agentText += block.text;
                    }
                  }
                }
                break;
              }

              case "result": {
                // Final result — show token usage and cost.
                sessionId = resolvedSessionId;

                // Clear any pending tool indicator line.
                if (activeToolName) {
                  process.stdout.write(
                    `\r${color(`  [done] ${activeToolName.replace(/_/g, " ")}     `, GREEN)}\n`
                  );
                  process.stdout.write(color("BAARA > ", BOLD, CYAN));
                  activeToolName = null;
                }

                const { usage, total_cost_usd } = event;
                const inputT  = usage?.input_tokens  ?? 0;
                const outputT = usage?.output_tokens ?? 0;
                const tokens  = inputT + outputT;
                const costStr = total_cost_usd != null
                  ? ` · $${total_cost_usd.toFixed(4)}`
                  : "";

                process.stdout.write(
                  `\n${color(`  ${tokens} tokens${costStr}`, GRAY)}\n`
                );
                break;
              }
            }
          }

          // Ensure output ends with a newline.
          if (agentText && !agentText.endsWith("\n")) {
            process.stdout.write("\n");
          }

          // Persist accumulated agent response to local history.
          if (agentText) {
            history.push({
              role: "agent",
              text: agentText,
              timestamp: new Date().toISOString(),
            });
          }

          // Auto-create a thread on the first successful turn if none exists.
          if (!threadId) {
            const title = trimmed.slice(0, 60) + (trimmed.length > 60 ? "..." : "");
            const newThread = store.createThread(crypto.randomUUID(), title);
            threadId = newThread.id;
          }

        } catch (err) {
          process.stdout.write("\n");
          if ((err as Error).name === "AbortError") {
            console.log(color("  (interrupted)", DIM));
          } else {
            console.error(
              color(`  Error: ${err instanceof Error ? err.message : String(err)}`, RED)
            );
          }
        }

        prompt();
      }

      // Start the REPL loop.
      prompt();
    });
}

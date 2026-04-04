#!/usr/bin/env bun
// @baara-next/cli — Entry point
//
// Commander.js program wiring all sub-command groups.

// Load environment variables from ~/.env (contains ANTHROPIC_API_KEY, etc.)
import { readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

try {
  const envPath = join(homedir(), ".env");
  const envContent = readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    // Only set if not already defined (don't override explicit env vars)
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
} catch {
  // ~/.env not found — that's fine, use existing env vars
}

import { Command } from "commander";
import { registerStartCommand } from "./commands/start.ts";
import { registerTasksCommand } from "./commands/tasks.ts";
import { registerExecutionsCommand } from "./commands/executions.ts";
import { registerQueuesCommand } from "./commands/queues.ts";
import { registerAdminCommand } from "./commands/admin.ts";
import { registerMcpServerCommand } from "./commands/mcp-server.ts";
import { registerChatCommand } from "./commands/chat.ts";

const program = new Command();

program
  .name("baara")
  .version("0.1.0")
  .description("BAARA Next — Durable Agentic Task Execution");

// Register all command groups.
registerStartCommand(program);
registerTasksCommand(program);
registerExecutionsCommand(program);
registerQueuesCommand(program);
registerAdminCommand(program);
registerMcpServerCommand(program);
registerChatCommand(program);

// Parse argv and run — top-level async for Commander v12+.
async function main(): Promise<void> {
  await program.parseAsync(process.argv);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

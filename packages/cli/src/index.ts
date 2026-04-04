#!/usr/bin/env bun
// @baara-next/cli — Entry point
//
// Commander.js program wiring all sub-command groups.

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

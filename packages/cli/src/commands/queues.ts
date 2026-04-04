// @baara-next/cli — queues subcommands

import { Command } from "commander";
import { join } from "path";
import { homedir } from "os";
import { createStore } from "@baara-next/store";
import { OrchestratorService } from "@baara-next/orchestrator";
import { formatTable, formatJson } from "../formatter.ts";

function resolveDbPath(opts: { dataDir?: string }): string {
  const dataDir = opts.dataDir ?? join(homedir(), ".baara");
  return join(dataDir, "baara.db");
}

export function registerQueuesCommand(program: Command): void {
  const queues = program
    .command("queues")
    .description("Inspect queues");

  // -------------------------------------------------------------------------
  // queues list
  // -------------------------------------------------------------------------
  queues
    .command("list")
    .alias("ls")
    .description("List all queues with depth and concurrency metrics")
    .option("--json", "Output as JSON")
    .option("--data-dir <dir>", "Data directory", join(homedir(), ".baara"))
    .action((opts: { json?: boolean; dataDir: string }) => {
      const store = createStore(resolveDbPath(opts));
      try {
        const list = store.listQueues();
        if (opts.json) {
          console.log(formatJson(list));
          return;
        }
        if (list.length === 0) {
          console.log("No queues found.");
          return;
        }
        const rows = list.map((q) => [
          q.name,
          q.depth.toString(),
          q.activeCount.toString(),
          q.maxConcurrency.toString(),
          q.createdAt,
        ]);
        console.log(
          formatTable(
            ["Name", "Depth", "Active", "Max Concurrency", "Created"],
            rows
          )
        );
      } finally {
        store.close();
      }
    });

  // -------------------------------------------------------------------------
  // queues inspect
  // -------------------------------------------------------------------------
  queues
    .command("inspect <name>")
    .description("Show details for a named queue")
    .option("--json", "Output as JSON")
    .option("--data-dir <dir>", "Data directory", join(homedir(), ".baara"))
    .action((name: string, opts: { json?: boolean; dataDir: string }) => {
      const store = createStore(resolveDbPath(opts));
      try {
        const queue = store.getQueueInfo(name);
        if (!queue) {
          console.error(`Queue not found: "${name}"`);
          process.exitCode = 1;
          return;
        }
        if (opts.json) {
          console.log(formatJson(queue));
          return;
        }
        console.log(`Queue: ${queue.name}`);
        console.log(`  Depth:           ${queue.depth}`);
        console.log(`  Active:          ${queue.activeCount}`);
        console.log(`  Max concurrency: ${queue.maxConcurrency}`);
        console.log(`  Created:         ${queue.createdAt}`);
      } finally {
        store.close();
      }
    });

  // -------------------------------------------------------------------------
  // queues dlq
  // -------------------------------------------------------------------------
  const dlq = queues
    .command("dlq")
    .description("Dead-letter queue operations");

  dlq
    .command("list")
    .alias("ls")
    .description("List dead-lettered executions")
    .option("--json", "Output as JSON")
    .option("--data-dir <dir>", "Data directory", join(homedir(), ".baara"))
    .action((opts: { json?: boolean; dataDir: string }) => {
      const store = createStore(resolveDbPath(opts));
      try {
        const list = store.getDeadLetteredExecutions();
        if (opts.json) {
          console.log(formatJson(list));
          return;
        }
        if (list.length === 0) {
          console.log("Dead-letter queue is empty.");
          return;
        }
        const rows = list.map((e) => [
          e.id.slice(0, 8),
          e.taskId.slice(0, 8),
          e.attempt.toString(),
          e.error ?? "-",
          e.createdAt,
        ]);
        console.log(
          formatTable(["Exec ID", "Task ID", "Attempts", "Error", "Created"], rows)
        );
      } finally {
        store.close();
      }
    });

  dlq
    .command("retry <id>")
    .description("Re-enqueue a dead-lettered execution")
    .option("--json", "Output as JSON")
    .option("--data-dir <dir>", "Data directory", join(homedir(), ".baara"))
    .action(async (id: string, opts: { json?: boolean; dataDir: string }) => {
      const store = createStore(resolveDbPath(opts));
      try {
        const orchestrator = new OrchestratorService(store);
        const newExec = await orchestrator.retryExecution(id);
        if (opts.json) {
          console.log(formatJson(newExec));
        } else {
          console.log(`Re-queued execution: ${newExec.id} [${newExec.status}]`);
        }
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      } finally {
        store.close();
      }
    });
}

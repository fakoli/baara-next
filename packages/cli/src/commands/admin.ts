// @baara-next/cli — admin subcommands

import { Command } from "commander";
import { join } from "path";
import { homedir } from "os";
import { createStore } from "@baara-next/store";
import { formatJson } from "../formatter.ts";

const VERSION = "0.1.0";

function resolveDbPath(opts: { dataDir?: string }): string {
  const dataDir = opts.dataDir ?? join(homedir(), ".baara");
  return join(dataDir, "baara.db");
}

export function registerAdminCommand(program: Command): void {
  const admin = program
    .command("admin")
    .description("Administrative utilities");

  // -------------------------------------------------------------------------
  // admin health
  // -------------------------------------------------------------------------
  admin
    .command("health")
    .description("Check system health and print a status summary")
    .option("--json", "Output as JSON")
    .option("--data-dir <dir>", "Data directory", join(homedir(), ".baara"))
    .action((opts: { json?: boolean; dataDir: string }) => {
      const store = createStore(resolveDbPath(opts));
      try {
        const queues = store.listQueues();
        const dlq = store.getDeadLetteredExecutions();
        const pendingInput = store.getPendingInputExecutions();

        let totalQueued = 0;
        let totalActive = 0;
        for (const q of queues) {
          totalQueued += q.depth;
          totalActive += q.activeCount;
        }

        const health = {
          status: "ok",
          version: VERSION,
          queues: queues.length,
          queued: totalQueued,
          active: totalActive,
          deadLettered: dlq.length,
          waitingForInput: pendingInput.length,
        };

        if (opts.json) {
          console.log(formatJson(health));
          return;
        }

        console.log(`BAARA Next v${VERSION} — health check`);
        console.log(`  Status:             ${health.status}`);
        console.log(`  Queues:             ${health.queues}`);
        console.log(`  Queued executions:  ${health.queued}`);
        console.log(`  Active executions:  ${health.active}`);
        console.log(`  Dead-lettered:      ${health.deadLettered}`);
        console.log(`  Waiting for input:  ${health.waitingForInput}`);
      } finally {
        store.close();
      }
    });

  // -------------------------------------------------------------------------
  // admin config show
  // -------------------------------------------------------------------------
  admin
    .command("config")
    .description("Show configuration settings stored in the database")
    .option("--json", "Output as JSON")
    .option("--data-dir <dir>", "Data directory", join(homedir(), ".baara"))
    .action((opts: { json?: boolean; dataDir: string }) => {
      const dataDir = opts.dataDir ?? join(homedir(), ".baara");
      const dbPath = join(dataDir, "baara.db");
      const store = createStore(dbPath);

      try {
        // Read well-known settings keys.
        const systemPrompt = store.getSetting("systemPrompt");
        const config = {
          dataDir,
          dbPath,
          version: VERSION,
          settings: {
            systemPrompt: systemPrompt ?? "(not set)",
          },
        };

        if (opts.json) {
          console.log(formatJson(config));
          return;
        }

        console.log("BAARA Next Configuration");
        console.log(`  Data directory: ${config.dataDir}`);
        console.log(`  Database path:  ${config.dbPath}`);
        console.log(`  Version:        ${config.version}`);
        console.log(`  System prompt:  ${config.settings.systemPrompt}`);
      } finally {
        store.close();
      }
    });
}

// @baara-next/cli — executions subcommands

import { Command } from "commander";
import { join } from "path";
import { homedir } from "os";
import { createStore } from "@baara-next/store";
import { OrchestratorService } from "@baara-next/orchestrator";
import type { ExecutionStatus, IStore, Execution } from "@baara-next/core";
import {
  formatTable,
  formatJson,
  formatExecution,
  formatExecutionDetail,
} from "../formatter.ts";

const VALID_STATUSES = new Set<string>([
  "created", "queued", "assigned", "running", "waiting_for_input",
  "completed", "failed", "timed_out", "cancelled", "retry_scheduled", "dead_lettered",
]);

function resolveDbPath(opts: { dataDir?: string }): string {
  const dataDir = opts.dataDir ?? join(homedir(), ".baara");
  return join(dataDir, "baara.db");
}

/**
 * Resolve an execution by full UUID or 8-char prefix (in that order).
 * Returns the Execution or null when nothing matches.
 */
function resolveExecutionId(store: IStore, input: string): Execution | null {
  const byId = store.getExecution(input);
  if (byId) return byId;
  // Cap the scan to the 200 most recent executions to avoid loading the entire table.
  // Users with more executions should use a longer prefix or full UUID.
  const byPrefix = store.listAllExecutions({ limit: 200 }).find((e) => e.id.startsWith(input));
  return byPrefix ?? null;
}

export function registerExecutionsCommand(program: Command): void {
  const execs = program
    .command("executions")
    .alias("exec")
    .description("Inspect and manage executions");

  // -------------------------------------------------------------------------
  // executions list
  // -------------------------------------------------------------------------
  execs
    .command("list")
    .alias("ls")
    .description("List executions for a task")
    .requiredOption("--task-id <id>", "Task ID to list executions for")
    .option("--status <status>", "Filter by status")
    .option("--limit <n>", "Maximum number of results", "50")
    .option("--json", "Output as JSON")
    .option("--data-dir <dir>", "Data directory", join(homedir(), ".baara"))
    .action(
      (opts: {
        taskId: string;
        status?: string;
        limit: string;
        json?: boolean;
        dataDir: string;
      }) => {
        const store = createStore(resolveDbPath(opts));
        try {
          const status =
            opts.status && VALID_STATUSES.has(opts.status)
              ? (opts.status as ExecutionStatus)
              : undefined;
          const limit = Math.min(parseInt(opts.limit, 10), 1000);
          const list = store.listExecutions(opts.taskId, { status, limit });
          if (opts.json) {
            console.log(formatJson(list));
            return;
          }
          if (list.length === 0) {
            console.log("No executions found.");
            return;
          }
          const rows = list.map((e) => [
            e.id.slice(0, 8),
            e.status,
            e.attempt.toString(),
            e.healthStatus,
            e.durationMs != null ? e.durationMs + "ms" : "-",
            e.createdAt,
          ]);
          console.log(
            formatTable(
              ["ID", "Status", "Attempt", "Health", "Duration", "Created"],
              rows
            )
          );
        } finally {
          store.close();
        }
      }
    );

  // -------------------------------------------------------------------------
  // executions inspect
  // -------------------------------------------------------------------------
  execs
    .command("inspect <id>")
    .description("Show detailed information for an execution")
    .option("--json", "Output as JSON")
    .option("--data-dir <dir>", "Data directory", join(homedir(), ".baara"))
    .action((id: string, opts: { json?: boolean; dataDir: string }) => {
      const store = createStore(resolveDbPath(opts));
      try {
        const exec = resolveExecutionId(store, id);
        if (!exec) {
          console.error(`Execution not found: "${id}"`);
          process.exitCode = 1;
          return;
        }
        if (opts.json) {
          console.log(formatJson(exec));
          return;
        }
        console.log(formatExecutionDetail(exec));
      } finally {
        store.close();
      }
    });

  // -------------------------------------------------------------------------
  // executions events
  // -------------------------------------------------------------------------
  execs
    .command("events <id>")
    .description("Show event log for an execution")
    .option("--limit <n>", "Maximum number of events", "100")
    .option("--after-seq <n>", "Show events after this sequence number")
    .option("--json", "Output as JSON")
    .option("--data-dir <dir>", "Data directory", join(homedir(), ".baara"))
    .action(
      (
        id: string,
        opts: {
          limit: string;
          afterSeq?: string;
          json?: boolean;
          dataDir: string;
        }
      ) => {
        const store = createStore(resolveDbPath(opts));
        try {
          const resolved = resolveExecutionId(store, id);
          if (!resolved) {
            console.error(`Execution not found: "${id}"`);
            process.exitCode = 1;
            return;
          }
          const limit = Math.min(parseInt(opts.limit, 10), 500);
          const afterSeq = opts.afterSeq ? parseInt(opts.afterSeq, 10) : undefined;
          const events = store.listEvents(resolved.id, { limit, afterSeq });
          if (opts.json) {
            console.log(formatJson(events));
            return;
          }
          if (events.length === 0) {
            console.log("No events found.");
            return;
          }
          const rows = events.map((e) => [
            e.eventSeq.toString(),
            e.type,
            e.timestamp,
          ]);
          console.log(formatTable(["Seq", "Type", "Timestamp"], rows));
        } finally {
          store.close();
        }
      }
    );

  // -------------------------------------------------------------------------
  // executions cancel
  // -------------------------------------------------------------------------
  execs
    .command("cancel <id>")
    .description("Cancel a running or queued execution")
    .option("--data-dir <dir>", "Data directory", join(homedir(), ".baara"))
    .action(async (id: string, opts: { dataDir: string }) => {
      const store = createStore(resolveDbPath(opts));
      try {
        const resolved = resolveExecutionId(store, id);
        if (!resolved) {
          console.error(`Execution not found: "${id}"`);
          process.exitCode = 1;
          return;
        }
        const orchestrator = new OrchestratorService(store);
        await orchestrator.cancelExecution(resolved.id);
        console.log(`Cancelled execution: ${resolved.id}`);
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      } finally {
        store.close();
      }
    });

  // -------------------------------------------------------------------------
  // executions retry
  // -------------------------------------------------------------------------
  execs
    .command("retry <id>")
    .description("Retry a failed or timed-out execution")
    .option("--json", "Output new execution as JSON")
    .option("--data-dir <dir>", "Data directory", join(homedir(), ".baara"))
    .action(async (id: string, opts: { json?: boolean; dataDir: string }) => {
      const store = createStore(resolveDbPath(opts));
      try {
        const resolved = resolveExecutionId(store, id);
        if (!resolved) {
          console.error(`Execution not found: "${id}"`);
          process.exitCode = 1;
          return;
        }
        const orchestrator = new OrchestratorService(store);
        const newExec = await orchestrator.retryExecution(resolved.id);
        if (opts.json) {
          console.log(formatJson(newExec));
        } else {
          console.log(`Retry scheduled: ${formatExecution(newExec)}`);
        }
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      } finally {
        store.close();
      }
    });

  // -------------------------------------------------------------------------
  // executions pending-input
  // -------------------------------------------------------------------------
  execs
    .command("pending-input")
    .description("List executions currently waiting for human input")
    .option("--json", "Output as JSON")
    .option("--data-dir <dir>", "Data directory", join(homedir(), ".baara"))
    .action((opts: { json?: boolean; dataDir: string }) => {
      const store = createStore(resolveDbPath(opts));
      try {
        const list = store.getPendingInputExecutions();
        if (opts.json) {
          console.log(formatJson(list));
          return;
        }
        if (list.length === 0) {
          console.log("No executions waiting for input.");
          return;
        }
        const rows = list.map((e) => [e.id.slice(0, 8), e.taskId.slice(0, 8), e.createdAt]);
        console.log(formatTable(["Exec ID", "Task ID", "Created"], rows));
      } finally {
        store.close();
      }
    });

  // -------------------------------------------------------------------------
  // executions respond
  // -------------------------------------------------------------------------
  execs
    .command("respond <id>")
    .description("Provide a HITL response for a waiting execution")
    .requiredOption("--response <text>", "Response text to deliver")
    .option("--data-dir <dir>", "Data directory", join(homedir(), ".baara"))
    .action(async (id: string, opts: { response: string; dataDir: string }) => {
      const store = createStore(resolveDbPath(opts));
      try {
        const orchestrator = new OrchestratorService(store);
        await orchestrator.provideInput(id, opts.response);
        console.log(`Response delivered for execution: ${id}`);
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      } finally {
        store.close();
      }
    });
}

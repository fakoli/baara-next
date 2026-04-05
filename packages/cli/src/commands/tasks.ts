// @baara-next/cli — tasks subcommands
//
// Operates directly against the store (in-process, no HTTP) so it works even
// when the server is not running.  For write operations that need orchestrator
// logic (run, submit) it also creates an OrchestratorService.

import { Command } from "commander";
import { join } from "path";
import { homedir } from "os";
import { createStore } from "@baara-next/store";
import { OrchestratorService, TaskManager } from "@baara-next/orchestrator";
import { createDefaultRegistry } from "@baara-next/executor";
import type { CreateTaskInput, UpdateTaskInput } from "@baara-next/core";
import { MAIN_THREAD_ID } from "@baara-next/core";
import {
  formatTable,
  formatJson,
  formatTask,
  formatTaskDetail,
} from "../formatter.ts";

function resolveDbPath(opts: { dataDir?: string }): string {
  const dataDir = opts.dataDir ?? join(homedir(), ".baara");
  return join(dataDir, "baara.db");
}

export function registerTasksCommand(program: Command): void {
  const tasks = program
    .command("tasks")
    .description("Manage tasks");

  // Common --data-dir option propagated via parent command's option inheritance.
  // Each sub-command re-reads the global --data-dir from parent opts.

  // -------------------------------------------------------------------------
  // tasks list
  // -------------------------------------------------------------------------
  tasks
    .command("list")
    .alias("ls")
    .description("List all tasks")
    .option("--project-id <id>", "Filter by project ID")
    .option("--json", "Output as JSON")
    .option("--data-dir <dir>", "Data directory", join(homedir(), ".baara"))
    .action((opts: { projectId?: string; json?: boolean; dataDir: string }) => {
      const store = createStore(resolveDbPath(opts));
      try {
        const list = store.listTasks(opts.projectId);
        if (opts.json) {
          console.log(formatJson(list));
          return;
        }
        if (list.length === 0) {
          console.log("No tasks found.");
          return;
        }
        const rows = list.map((t) => [
          t.id.slice(0, 8),
          t.name,
          t.sandboxType ?? t.executionType ?? "native",
          t.executionMode,
          t.enabled ? "enabled" : "disabled",
          t.priority.toString(),
        ]);
        console.log(
          formatTable(["ID", "Name", "Type", "Mode", "Status", "Priority"], rows)
        );
      } finally {
        store.close();
      }
    });

  // -------------------------------------------------------------------------
  // tasks get
  // -------------------------------------------------------------------------
  tasks
    .command("get <id>")
    .description("Get task details by ID or name")
    .option("--json", "Output as JSON")
    .option("--data-dir <dir>", "Data directory", join(homedir(), ".baara"))
    .action((id: string, opts: { json?: boolean; dataDir: string }) => {
      const store = createStore(resolveDbPath(opts));
      try {
        let task = store.getTask(id);
        if (!task) task = store.getTaskByName(id);
        if (!task) {
          console.error(`Task not found: "${id}"`);
          process.exitCode = 1;
          return;
        }
        if (opts.json) {
          console.log(formatJson(task));
          return;
        }
        console.log(formatTaskDetail(task));
      } finally {
        store.close();
      }
    });

  // -------------------------------------------------------------------------
  // tasks create
  // -------------------------------------------------------------------------
  tasks
    .command("create")
    .description("Create a new task")
    .requiredOption("--name <name>", "Task name")
    .requiredOption("--prompt <prompt>", "Task prompt")
    .option("--description <desc>", "Task description")
    .option("--sandbox <type>", "Sandbox type: native | wasm | docker", "native")
    .option("--wasm-memory <mb>", "Wasm sandbox max memory in MB (only used with --sandbox wasm)")
    .option("--wasm-network <bool>", "Enable network in Wasm sandbox: true | false (default: true)")
    .option("--tools <list>", "Comma-separated allowed tool names, e.g. 'Bash,Read,Write'")
    .option("--model <model>", "Claude model override, e.g. claude-sonnet-4-20250514")
    .option("--budget <usd>", "Budget cap in USD, e.g. 2.00")
    .option("--mode <mode>", "Execution mode: direct | queued", "queued")
    .option("--priority <n>", "Priority 0-3 (0=critical)", "2")
    .option("--cron <expr>", "Cron expression for scheduled execution")
    .option("--timeout <ms>", "Timeout in milliseconds", "300000")
    .option("--max-retries <n>", "Maximum retry attempts", "0")
    .option("--project-id <id>", "Project ID")
    .option("--target-thread <id>", "Thread UUID to route task output to (default: Main thread)")
    .option("--json", "Output as JSON")
    .option("--data-dir <dir>", "Data directory", join(homedir(), ".baara"))
    .action(
      (opts: {
        name: string;
        prompt: string;
        description?: string;
        sandbox: string;
        wasmMemory?: string;
        wasmNetwork?: string;
        tools?: string;
        model?: string;
        budget?: string;
        mode: string;
        priority: string;
        cron?: string;
        timeout: string;
        maxRetries: string;
        projectId?: string;
        targetThread?: string;
        json?: boolean;
        dataDir: string;
      }) => {
        const store = createStore(resolveDbPath(opts));
        const taskManager = new TaskManager(store);
        try {
          const sandboxType = (opts.sandbox as "native" | "wasm" | "docker") ?? "native";

          const sandboxConfig =
            sandboxType === "wasm"
              ? {
                  type: "wasm" as const,
                  maxMemoryMb: opts.wasmMemory ? parseInt(opts.wasmMemory, 10) : undefined,
                  networkEnabled:
                    opts.wasmNetwork !== undefined
                      ? opts.wasmNetwork === "true"
                      : undefined,
                }
              : { type: sandboxType as "native" | "docker" };

          const allowedTools = opts.tools
            ? opts.tools
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean)
            : undefined;

          const agentConfig =
            allowedTools || opts.model || opts.budget
              ? {
                  allowedTools,
                  model: opts.model,
                  budgetUsd: opts.budget ? parseFloat(opts.budget) : undefined,
                }
              : null;

          // When --target-thread is not provided, default to MAIN_THREAD_ID so
          // the task is explicitly routed to Main rather than leaving it null
          // (null also routes to Main, but being explicit is clearer).
          const targetThreadId = opts.targetThread ?? MAIN_THREAD_ID;

          const input: CreateTaskInput = {
            name: opts.name,
            prompt: opts.prompt,
            description: opts.description,
            sandboxType,
            sandboxConfig,
            executionMode: opts.mode as CreateTaskInput["executionMode"],
            priority: parseInt(opts.priority, 10) as CreateTaskInput["priority"],
            cronExpression: opts.cron ?? null,
            timeoutMs: parseInt(opts.timeout, 10),
            maxRetries: parseInt(opts.maxRetries, 10),
            projectId: opts.projectId ?? null,
            targetThreadId,
            agentConfig,
          };
          const task = taskManager.createTask(input);
          if (opts.json) {
            console.log(formatJson(task));
          } else {
            console.log(`Created task: ${task.id}`);
            console.log(formatTask(task));
          }
        } finally {
          store.close();
        }
      }
    );

  // -------------------------------------------------------------------------
  // tasks update
  // -------------------------------------------------------------------------
  tasks
    .command("update <id>")
    .description("Update task fields")
    .option("--name <name>", "New name")
    .option("--prompt <prompt>", "New prompt")
    .option("--description <desc>", "New description")
    .option("--cron <expr>", "New cron expression (pass empty string to clear)")
    .option("--timeout <ms>", "New timeout in milliseconds")
    .option("--max-retries <n>", "New max retries")
    .option("--json", "Output as JSON")
    .option("--data-dir <dir>", "Data directory", join(homedir(), ".baara"))
    .action(
      (
        id: string,
        opts: {
          name?: string;
          prompt?: string;
          description?: string;
          cron?: string;
          timeout?: string;
          maxRetries?: string;
          json?: boolean;
          dataDir: string;
        }
      ) => {
        const store = createStore(resolveDbPath(opts));
        try {
          const update: UpdateTaskInput = {};
          if (opts.name !== undefined) update.name = opts.name;
          if (opts.prompt !== undefined) update.prompt = opts.prompt;
          if (opts.description !== undefined) update.description = opts.description;
          if (opts.cron !== undefined) update.cronExpression = opts.cron || null;
          if (opts.timeout !== undefined) update.timeoutMs = parseInt(opts.timeout, 10);
          if (opts.maxRetries !== undefined) update.maxRetries = parseInt(opts.maxRetries, 10);

          const taskManager = new TaskManager(store);
          const task = taskManager.updateTask(id, update);
          if (opts.json) {
            console.log(formatJson(task));
          } else {
            console.log(`Updated task: ${task.id}`);
            console.log(formatTask(task));
          }
        } catch (err) {
          console.error(err instanceof Error ? err.message : String(err));
          process.exitCode = 1;
        } finally {
          store.close();
        }
      }
    );

  // -------------------------------------------------------------------------
  // tasks delete
  // -------------------------------------------------------------------------
  tasks
    .command("delete <id>")
    .alias("rm")
    .description("Delete a task")
    .option("--data-dir <dir>", "Data directory", join(homedir(), ".baara"))
    .action((id: string, opts: { dataDir: string }) => {
      const store = createStore(resolveDbPath(opts));
      try {
        store.deleteTask(id);
        console.log(`Deleted task: ${id}`);
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      } finally {
        store.close();
      }
    });

  // -------------------------------------------------------------------------
  // tasks enable / disable
  // -------------------------------------------------------------------------
  tasks
    .command("enable <id>")
    .description("Enable a task")
    .option("--data-dir <dir>", "Data directory", join(homedir(), ".baara"))
    .action((id: string, opts: { dataDir: string }) => {
      const store = createStore(resolveDbPath(opts));
      try {
        const task = store.updateTask(id, { enabled: true });
        console.log(`Enabled task: ${task.name}`);
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      } finally {
        store.close();
      }
    });

  tasks
    .command("disable <id>")
    .description("Disable a task")
    .option("--data-dir <dir>", "Data directory", join(homedir(), ".baara"))
    .action((id: string, opts: { dataDir: string }) => {
      const store = createStore(resolveDbPath(opts));
      try {
        const task = store.updateTask(id, { enabled: false });
        console.log(`Disabled task: ${task.name}`);
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      } finally {
        store.close();
      }
    });

  // -------------------------------------------------------------------------
  // tasks run
  // -------------------------------------------------------------------------
  tasks
    .command("run <id>")
    .description("Run a task directly (bypasses queue)")
    .option("--json", "Output result as JSON")
    .option("--data-dir <dir>", "Data directory", join(homedir(), ".baara"))
    .action(async (id: string, opts: { json?: boolean; dataDir: string }) => {
      const store = createStore(resolveDbPath(opts));
      try {
        const registry = await createDefaultRegistry({ dataDir: opts.dataDir });
        const orchestrator = new OrchestratorService(store, registry);
        const execution = await orchestrator.runDirect(id);
        if (opts.json) {
          console.log(formatJson(execution));
        } else {
          console.log(`Execution created: ${execution.id} [${execution.status}]`);
        }
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      } finally {
        store.close();
      }
    });

  // -------------------------------------------------------------------------
  // tasks submit
  // -------------------------------------------------------------------------
  tasks
    .command("submit <id>")
    .description("Submit a task to the queue")
    .option("--json", "Output as JSON")
    .option("--data-dir <dir>", "Data directory", join(homedir(), ".baara"))
    .action(async (id: string, opts: { json?: boolean; dataDir: string }) => {
      const store = createStore(resolveDbPath(opts));
      try {
        const orchestrator = new OrchestratorService(store);
        const execution = await orchestrator.submitTask(id);
        if (opts.json) {
          console.log(formatJson(execution));
        } else {
          console.log(`Submitted execution: ${execution.id} [${execution.status}]`);
        }
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      } finally {
        store.close();
      }
    });

  // -------------------------------------------------------------------------
  // tasks logs
  // -------------------------------------------------------------------------
  tasks
    .command("logs <executionId>")
    .description("Print structured log entries for an execution")
    .option("--level <level>", "Filter by level: info | warn | error | debug")
    .option("--search <text>", "Case-insensitive text filter")
    .option("--limit <n>", "Max lines to display", "200")
    .option("--follow", "Tail the log file (re-reads every second)", false)
    .option("--json", "Output as JSON")
    .option("--data-dir <dir>", "Data directory", join(homedir(), ".baara"))
    .action(
      async (
        executionId: string,
        opts: {
          level?: string;
          search?: string;
          limit: string;
          follow?: boolean;
          json?: boolean;
          dataDir: string;
        }
      ) => {
        const { readLogEntries } = await import("@baara-next/executor");
        const logsDir = join(opts.dataDir, "logs");
        const limit = parseInt(opts.limit, 10);

        const printEntries = async () => {
          const entries = await readLogEntries(logsDir, executionId, {
            level: opts.level,
            search: opts.search,
            limit,
          });
          if (opts.json) {
            console.log(formatJson(entries));
            return;
          }
          for (const entry of entries) {
            const prefix = `[${entry.ts}] [${entry.level.toUpperCase()}]`;
            console.log(`${prefix} ${entry.msg}`);
          }
        };

        await printEntries();

        if (opts.follow) {
          const interval = setInterval(() => void printEntries(), 1000);
          const cleanup = () => {
            clearInterval(interval);
            process.exit(0);
          };
          process.on("SIGINT", cleanup);
          process.on("SIGTERM", cleanup);
        }
      }
    );
}

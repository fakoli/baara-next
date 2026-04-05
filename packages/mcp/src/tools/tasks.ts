// @baara-next/mcp — Task management tools (6 tools)
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { IStore, IOrchestratorService } from "@baara-next/core";
import { MAIN_THREAD_ID } from "@baara-next/core";
import { ok, err, notFound, resolveTask } from "../helpers.ts";

export function createTaskTools(deps: {
  store: IStore;
  orchestrator: IOrchestratorService;
  /** When provided, `create_task` defaults targetThreadId to this value. */
  currentThreadId?: string;
}) {
  const { store } = deps;

  // 1. list_tasks
  const listTasks = tool(
    "list_tasks",
    "List all tasks with their status, cron schedule, and execution mode",
    {},
    async () => {
      const tasks = store.listTasks();
      return ok(
        tasks.map((t) => ({
          id: t.id,
          name: t.name,
          description: t.description,
          cron: t.cronExpression ?? null,
          sandboxType: t.sandboxType ?? "native",
          executionType: t.executionType, // deprecated compat alias
          executionMode: t.executionMode,
          priority: t.priority,
          enabled: t.enabled,
          targetQueue: t.targetQueue,
          projectId: t.projectId ?? null,
          targetThreadId: t.targetThreadId ?? null,
        }))
      );
    }
  );

  // 2. get_task
  const getTask = tool(
    "get_task",
    "Get full details of a task by name or ID",
    { nameOrId: z.string().describe("Task name or UUID") },
    async ({ nameOrId }) => {
      const task = resolveTask(store, nameOrId);
      if (!task) return notFound(nameOrId);
      return ok({
        ...task,
        sandboxType: task.sandboxType ?? "native",
      });
    }
  );

  // 3. create_task
  const createTask = tool(
    "create_task",
    "Create a new task",
    {
      name: z.string().describe("Unique task name"),
      prompt: z.string().describe("Prompt or command to execute"),
      description: z.string().optional().describe("Human-readable description"),
      cronExpression: z.string().optional().describe("Cron schedule, e.g. '0 9 * * *'"),
      sandboxType: z
        .enum(["native", "wasm", "docker"])
        .optional()
        .describe("Sandbox type (default: native)"),
      sandboxConfig: z
        .object({
          networkEnabled: z.boolean().optional(),
          maxMemoryMb: z.number().int().positive().optional(),
          maxCpuPercent: z.number().int().min(1).max(100).optional(),
          ports: z.array(z.number().int()).optional(),
        })
        .optional()
        .describe("Sandbox resource limits (only meaningful when sandboxType is 'wasm')"),
      executionType: z
        .enum(["cloud_code", "wasm", "wasm_edge", "shell"])
        .optional()
        .describe("DEPRECATED: use sandboxType instead"),
      executionMode: z.enum(["queued", "direct"]).optional().describe("Queue or bypass queue (default: queued)"),
      priority: z.number().int().min(0).max(3).optional().describe("Priority: 0=critical, 1=high, 2=normal, 3=low"),
      maxRetries: z.number().int().min(0).max(10).optional().describe("Max retry attempts (default: 3)"),
      timeoutMs: z.number().int().min(1000).max(3600000).optional().describe("Timeout in ms (default: 30000)"),
      allowedTools: z.array(z.string()).optional().describe("Agent SDK tool names this task may use"),
      projectId: z.string().optional().describe("Project UUID to associate the task with"),
      targetThreadId: z.string().uuid().optional().describe("Thread UUID to route task output to; omit to use the Main thread"),
    },
    async (args) => {
      try {
        const id = crypto.randomUUID();

        // Map deprecated executionType → sandboxType if sandboxType is not provided.
        const resolvedSandboxType: "native" | "wasm" | "docker" | undefined =
          args.sandboxType ??
          (args.executionType === "wasm" || args.executionType === "wasm_edge"
            ? "wasm"
            : args.executionType
            ? "native"
            : undefined);

        const sandboxConfig =
          resolvedSandboxType === "wasm" && args.sandboxConfig
            ? { type: "wasm" as const, ...args.sandboxConfig }
            : resolvedSandboxType
            ? { type: resolvedSandboxType as "native" | "docker" }
            : undefined;

        // If the caller did not specify a targetThreadId, default to the
        // current chat thread (when called from within a chat conversation)
        // or MAIN_THREAD_ID (when called via stdio/HTTP MCP with no context).
        const resolvedTargetThread =
          args.targetThreadId ?? deps.currentThreadId ?? MAIN_THREAD_ID;

        const task = store.createTask(id, {
          name: args.name,
          prompt: args.prompt,
          description: args.description,
          cronExpression: args.cronExpression ?? null,
          sandboxType: resolvedSandboxType,
          sandboxConfig,
          executionMode: args.executionMode,
          priority: args.priority as 0 | 1 | 2 | 3 | undefined,
          maxRetries: args.maxRetries,
          timeoutMs: args.timeoutMs,
          projectId: args.projectId ?? null,
          targetThreadId: resolvedTargetThread,
          agentConfig: args.allowedTools ? { allowedTools: args.allowedTools } : null,
        });
        return ok(task);
      } catch (e) {
        return err(`Failed to create task: ${String(e)}`);
      }
    }
  );

  // 4. update_task
  const updateTask = tool(
    "update_task",
    "Update an existing task by name or ID",
    {
      nameOrId: z.string().describe("Task name or UUID"),
      name: z.string().optional().describe("New task name"),
      prompt: z.string().optional().describe("New prompt"),
      description: z.string().optional().describe("New description"),
      cronExpression: z.string().nullable().optional().describe("New cron schedule; pass null to clear"),
      executionType: z.enum(["cloud_code", "wasm", "wasm_edge", "shell"]).optional().describe("Execution engine"),
      executionMode: z.enum(["queued", "direct"]).optional().describe("Execution mode"),
      priority: z.number().int().min(0).max(3).optional().describe("Priority 0-3"),
      maxRetries: z.number().int().min(0).max(10).optional().describe("Max retries"),
      timeoutMs: z.number().int().min(1000).max(3600000).optional().describe("Timeout in ms"),
      enabled: z.boolean().optional().describe("Enable or disable the task"),
      allowedTools: z.array(z.string()).optional().describe("Allowed tool names"),
      projectId: z.string().nullable().optional().describe("Project UUID; pass null to unassign"),
      targetThreadId: z.string().uuid().nullable().optional().describe("Thread UUID for output routing; pass null to use the Main thread"),
    },
    async (args) => {
      const task = resolveTask(store, args.nameOrId);
      if (!task) return notFound(args.nameOrId);
      try {
        const { nameOrId: _nameOrId, allowedTools, ...updates } = args;
        const agentConfig = allowedTools !== undefined
          ? { ...(task.agentConfig ?? {}), allowedTools }
          : undefined;
        const updated = store.updateTask(task.id, {
          ...updates,
          priority: updates.priority as 0 | 1 | 2 | 3 | undefined,
          ...(agentConfig !== undefined ? { agentConfig } : {}),
        });
        return ok(updated);
      } catch (e) {
        return err(`Failed to update task: ${String(e)}`);
      }
    }
  );

  // 5. delete_task
  const deleteTask = tool(
    "delete_task",
    "Delete a task by name or ID",
    { nameOrId: z.string().describe("Task name or UUID") },
    async ({ nameOrId }) => {
      const task = resolveTask(store, nameOrId);
      if (!task) return notFound(nameOrId);
      store.deleteTask(task.id);
      return ok({ deleted: true, id: task.id, name: task.name });
    }
  );

  // 6. toggle_task
  const toggleTask = tool(
    "toggle_task",
    "Toggle a task enabled/disabled by name or ID",
    { nameOrId: z.string().describe("Task name or UUID") },
    async ({ nameOrId }) => {
      const task = resolveTask(store, nameOrId);
      if (!task) return notFound(nameOrId);
      const updated = store.updateTask(task.id, { enabled: !task.enabled });
      return ok({ id: updated.id, name: updated.name, enabled: updated.enabled });
    }
  );

  return [listTasks, getTask, createTask, updateTask, deleteTask, toggleTask];
}

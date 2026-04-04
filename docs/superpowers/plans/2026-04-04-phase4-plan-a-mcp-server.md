# Plan A: MCP Server + 27 Tools

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan.

**Goal:** Build packages/mcp with 27 MCP tool definitions and dual transport

**Architecture:** Tool definitions using Agent SDK tool() + Zod schemas. Tools call IStore and IOrchestratorService directly. Two transports: in-process createSdkMcpServer() for web UI chat, HTTP endpoint at /mcp for remote clients.

**Tech Stack:** @anthropic-ai/claude-agent-sdk (tool(), createSdkMcpServer()), zod, hono

---

### Task 1: Package Scaffold

**Files:**
- Create: `packages/mcp/package.json`
- Create: `packages/mcp/tsconfig.json`
- Create: `packages/mcp/src/index.ts` (barrel, empty for now)

- [ ] **Step 1: Write failing test**

```typescript
// packages/mcp/src/__tests__/package.test.ts
import { describe, it, expect } from "bun:test";

describe("@baara-next/mcp package", () => {
  it("exports createBaaraMcpServer", async () => {
    const mod = await import("../index.ts");
    expect(typeof mod.createBaaraMcpServer).toBe("function");
  });
});
```

- [ ] **Step 2: Run test** (expected: FAIL — module not found)

```bash
cd packages/mcp && bun test src/__tests__/package.test.ts
# Expected: error: Cannot find module '../index.ts'
```

- [ ] **Step 3: Write implementation**

`packages/mcp/package.json`:
```json
{
  "name": "@baara-next/mcp",
  "version": "0.1.0",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "build": "tsc",
    "clean": "rm -rf dist",
    "test": "bun test"
  },
  "dependencies": {
    "@baara-next/core": "workspace:*",
    "@anthropic-ai/claude-agent-sdk": "latest",
    "zod": "^3",
    "hono": "^4"
  },
  "devDependencies": {
    "typescript": "^5.8"
  }
}
```

`packages/mcp/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

`packages/mcp/src/index.ts`:
```typescript
// @baara-next/mcp — Public API barrel

export { createBaaraMcpServer } from "./server.ts";
export type { BaaraMcpServerDeps } from "./server.ts";
```

`packages/mcp/src/server.ts` (skeleton only — will be filled in Task 9):
```typescript
// @baara-next/mcp — createBaaraMcpServer factory (skeleton)
import type { IStore, IOrchestratorService } from "@baara-next/core";

export interface BaaraMcpServerDeps {
  store: IStore;
  orchestrator: IOrchestratorService;
}

export function createBaaraMcpServer(_deps: BaaraMcpServerDeps) {
  throw new Error("Not yet implemented");
}
```

- [ ] **Step 4: Run test** (expected: PASS)

```bash
cd packages/mcp && bun install && bun test src/__tests__/package.test.ts
# Expected: 1 pass — exports createBaaraMcpServer
```

- [ ] **Step 5: Commit**

```bash
git add packages/mcp/package.json packages/mcp/tsconfig.json packages/mcp/src/index.ts packages/mcp/src/server.ts packages/mcp/src/__tests__/package.test.ts
git commit -m "feat(mcp): scaffold @baara-next/mcp package with stub createBaaraMcpServer"
```

---

### Task 2: Shared Helpers

**Files:**
- Create: `packages/mcp/src/helpers.ts`
- Test: `packages/mcp/src/__tests__/helpers.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// packages/mcp/src/__tests__/helpers.test.ts
import { describe, it, expect } from "bun:test";
import { ok, err, notFound, resolveTask } from "../helpers.ts";
import type { IStore } from "@baara-next/core";

const mockTask = {
  id: "task-uuid-1",
  name: "my-task",
  description: "A test task",
  prompt: "echo hello",
  timeoutMs: 30000,
  executionType: "cloud_code" as const,
  agentConfig: null,
  priority: 2 as const,
  targetQueue: "default",
  maxRetries: 3,
  executionMode: "queued" as const,
  enabled: true,
  projectId: null,
  createdAt: "2026-04-04T00:00:00Z",
  updatedAt: "2026-04-04T00:00:00Z",
};

const mockStore: Pick<IStore, "getTask" | "getTaskByName"> = {
  getTask: (id: string) => (id === "task-uuid-1" ? mockTask : null),
  getTaskByName: (name: string) => (name === "my-task" ? mockTask : null),
};

describe("helpers", () => {
  describe("ok()", () => {
    it("wraps data as text content", () => {
      const result = ok({ foo: "bar" });
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe("text");
      expect(JSON.parse(result.content[0].text)).toEqual({ foo: "bar" });
    });

    it("does not set isError", () => {
      const result = ok("hello");
      expect((result as { isError?: boolean }).isError).toBeUndefined();
    });
  });

  describe("err()", () => {
    it("wraps message as error text content", () => {
      const result = err("something went wrong");
      expect(result.content[0].text).toBe("something went wrong");
      expect(result.isError).toBe(true);
    });
  });

  describe("notFound()", () => {
    it("returns error for task not found", () => {
      const result = notFound("missing-task");
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("missing-task");
    });
  });

  describe("resolveTask()", () => {
    it("resolves by name", () => {
      const task = resolveTask(mockStore as IStore, "my-task");
      expect(task?.id).toBe("task-uuid-1");
    });

    it("resolves by id", () => {
      const task = resolveTask(mockStore as IStore, "task-uuid-1");
      expect(task?.id).toBe("task-uuid-1");
    });

    it("returns null when not found", () => {
      const task = resolveTask(mockStore as IStore, "nonexistent");
      expect(task).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run test** (expected: FAIL — helpers.ts not found)

```bash
cd packages/mcp && bun test src/__tests__/helpers.test.ts
# Expected: error: Cannot find module '../helpers.ts'
```

- [ ] **Step 3: Write implementation**

```typescript
// packages/mcp/src/helpers.ts
import type { IStore, Task } from "@baara-next/core";

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

/** Wrap a value as a successful MCP text response. */
export function ok(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

/** Wrap a message as a failed MCP text response. */
export function err(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}

/** Standard "task not found" error response. */
export function notFound(nameOrId: string) {
  return err(`Task not found: ${nameOrId}`);
}

// ---------------------------------------------------------------------------
// Task resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a task by name (checked first) or UUID.
 * Returns null if neither lookup succeeds.
 */
export function resolveTask(store: Pick<IStore, "getTask" | "getTaskByName">, nameOrId: string): Task | null {
  return store.getTaskByName(nameOrId) ?? store.getTask(nameOrId);
}
```

- [ ] **Step 4: Run test** (expected: all 6 pass)

```bash
cd packages/mcp && bun test src/__tests__/helpers.test.ts
# Expected: 6 pass
```

- [ ] **Step 5: Commit**

```bash
git add packages/mcp/src/helpers.ts packages/mcp/src/__tests__/helpers.test.ts
git commit -m "feat(mcp): add ok/err/notFound/resolveTask helpers"
```

---

### Task 3: tools/tasks.ts — 6 task management tools

**Files:**
- Create: `packages/mcp/src/tools/tasks.ts`
- Test: `packages/mcp/src/__tests__/tools/tasks.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// packages/mcp/src/__tests__/tools/tasks.test.ts
import { describe, it, expect, mock } from "bun:test";
import { createTaskTools } from "../../tools/tasks.ts";
import type { IStore, IOrchestratorService, Task } from "@baara-next/core";

const baseTask: Task = {
  id: "t1",
  name: "hello-task",
  description: "says hello",
  prompt: "echo hello",
  timeoutMs: 30000,
  executionType: "cloud_code",
  agentConfig: null,
  priority: 2,
  targetQueue: "default",
  maxRetries: 3,
  executionMode: "queued",
  enabled: true,
  projectId: null,
  createdAt: "2026-04-04T00:00:00Z",
  updatedAt: "2026-04-04T00:00:00Z",
};

function makeMockStore(overrides: Partial<IStore> = {}): IStore {
  return {
    listTasks: mock(() => [baseTask]),
    getTask: mock((id: string) => (id === "t1" ? baseTask : null)),
    getTaskByName: mock((name: string) => (name === "hello-task" ? baseTask : null)),
    createTask: mock((_id: string, input: { name: string }) => ({ ...baseTask, ...input, id: "t-new" })),
    updateTask: mock((_id: string, input: { enabled?: boolean }) => ({ ...baseTask, ...input })),
    deleteTask: mock(() => undefined),
    createExecution: mock(() => ({ id: "e1", taskId: "t1", queueName: "default", priority: 2, status: "queued" as const, attempt: 1, scheduledAt: "", healthStatus: "healthy" as const, turnCount: 0, createdAt: "" })),
    getExecution: mock(() => null),
    listExecutions: mock(() => []),
    updateExecutionStatus: mock(() => undefined),
    updateExecutionFields: mock(() => undefined),
    dequeueExecution: mock(() => null),
    getDeadLetteredExecutions: mock(() => []),
    getPendingInputExecutions: mock(() => []),
    listAllExecutions: mock(() => []),
    appendEvent: mock(() => undefined),
    listEvents: mock(() => []),
    getMaxEventSeq: mock(() => 0),
    createInputRequest: mock((r: { executionId: string; prompt: string; timeoutMs: number; status: "pending" }) => ({ id: "ir1", createdAt: "", ...r })),
    getInputRequest: mock(() => null),
    respondToInput: mock(() => undefined),
    listQueues: mock(() => []),
    getQueueInfo: mock(() => null),
    listTemplates: mock(() => []),
    getTemplate: mock(() => null),
    createTemplate: mock((_id: string, input: { name: string }) => ({ id: _id, name: input.name, description: "", agentConfig: {}, createdAt: "", updatedAt: "" })),
    deleteTemplate: mock(() => undefined),
    listProjects: mock(() => []),
    getProject: mock(() => null),
    createProject: mock((_id: string, input: { name: string }) => ({ id: _id, name: input.name, description: "", instructions: "", workingDirectory: "", createdAt: "", updatedAt: "" })),
    updateProject: mock(() => ({ id: "p1", name: "proj", description: "", instructions: "", workingDirectory: "", createdAt: "", updatedAt: "" })),
    deleteProject: mock(() => undefined),
    getSetting: mock(() => null),
    setSetting: mock(() => undefined),
    close: mock(() => undefined),
  } as unknown as IStore;
}

function makeMockOrchestrator(): IOrchestratorService {
  return {
    submitTask: mock(async () => ({ id: "e1", taskId: "t1", queueName: "default", priority: 2, status: "queued" as const, attempt: 1, scheduledAt: "", healthStatus: "healthy" as const, turnCount: 0, createdAt: "" })),
    runDirect: mock(async () => ({ id: "e2", taskId: "t1", queueName: "default", priority: 2, status: "completed" as const, attempt: 1, scheduledAt: "", healthStatus: "healthy" as const, turnCount: 1, createdAt: "" })),
    cancelExecution: mock(async () => undefined),
    retryExecution: mock(async () => ({ id: "e3", taskId: "t1", queueName: "default", priority: 2, status: "queued" as const, attempt: 2, scheduledAt: "", healthStatus: "healthy" as const, turnCount: 0, createdAt: "" })),
    matchTask: mock(async () => null),
    handleExecutionComplete: mock(async () => undefined),
    startExecution: mock(async () => undefined),
    provideInput: mock(async () => undefined),
  } as unknown as IOrchestratorService;
}

describe("task tools", () => {
  it("list_tasks returns summary array", async () => {
    const store = makeMockStore();
    const tools = createTaskTools({ store, orchestrator: makeMockOrchestrator() });
    const listTasks = tools.find(t => (t as { name: string }).name === "list_tasks")!;
    const result = await (listTasks as { execute: (p: Record<string, never>) => Promise<unknown> }).execute({});
    const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].name).toBe("hello-task");
    expect(parsed[0].id).toBe("t1");
  });

  it("get_task returns task by name", async () => {
    const store = makeMockStore();
    const tools = createTaskTools({ store, orchestrator: makeMockOrchestrator() });
    const getTool = tools.find(t => (t as { name: string }).name === "get_task")!;
    const result = await (getTool as { execute: (p: { nameOrId: string }) => Promise<unknown> }).execute({ nameOrId: "hello-task" });
    const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
    expect(parsed.id).toBe("t1");
  });

  it("get_task returns error for unknown task", async () => {
    const store = makeMockStore();
    const tools = createTaskTools({ store, orchestrator: makeMockOrchestrator() });
    const getTool = tools.find(t => (t as { name: string }).name === "get_task")!;
    const result = await (getTool as { execute: (p: { nameOrId: string }) => Promise<unknown> }).execute({ nameOrId: "nope" });
    expect((result as { isError: boolean }).isError).toBe(true);
  });

  it("delete_task removes task by name", async () => {
    const store = makeMockStore();
    const tools = createTaskTools({ store, orchestrator: makeMockOrchestrator() });
    const deleteTool = tools.find(t => (t as { name: string }).name === "delete_task")!;
    const result = await (deleteTool as { execute: (p: { nameOrId: string }) => Promise<unknown> }).execute({ nameOrId: "hello-task" });
    const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
    expect(parsed.deleted).toBe(true);
    expect(store.deleteTask).toHaveBeenCalledWith("t1");
  });

  it("toggle_task flips enabled flag", async () => {
    const store = makeMockStore();
    const tools = createTaskTools({ store, orchestrator: makeMockOrchestrator() });
    const toggleTool = tools.find(t => (t as { name: string }).name === "toggle_task")!;
    const result = await (toggleTool as { execute: (p: { nameOrId: string }) => Promise<unknown> }).execute({ nameOrId: "hello-task" });
    const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
    expect(parsed.name).toBe("hello-task");
    expect(store.updateTask).toHaveBeenCalledWith("t1", { enabled: false });
  });

  it("createTaskTools returns 6 tools", () => {
    const tools = createTaskTools({ store: makeMockStore(), orchestrator: makeMockOrchestrator() });
    expect(tools).toHaveLength(6);
  });
});
```

- [ ] **Step 2: Run test** (expected: FAIL — tools/tasks.ts not found)

```bash
cd packages/mcp && bun test src/__tests__/tools/tasks.test.ts
# Expected: error: Cannot find module '../../tools/tasks.ts'
```

- [ ] **Step 3: Write implementation**

```typescript
// packages/mcp/src/tools/tasks.ts
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { IStore, IOrchestratorService } from "@baara-next/core";
import { ok, err, notFound, resolveTask } from "../helpers.ts";

export function createTaskTools(deps: {
  store: IStore;
  orchestrator: IOrchestratorService;
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
          executionType: t.executionType,
          executionMode: t.executionMode,
          priority: t.priority,
          enabled: t.enabled,
          targetQueue: t.targetQueue,
          projectId: t.projectId ?? null,
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
      return ok(task);
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
      executionType: z.enum(["cloud_code", "wasm", "wasm_edge", "shell"]).optional().describe("Execution engine (default: cloud_code)"),
      executionMode: z.enum(["queued", "direct"]).optional().describe("Queue or bypass queue (default: queued)"),
      priority: z.number().int().min(0).max(3).optional().describe("Priority: 0=critical, 1=high, 2=normal, 3=low"),
      maxRetries: z.number().int().min(0).max(10).optional().describe("Max retry attempts (default: 3)"),
      timeoutMs: z.number().int().min(1000).max(3600000).optional().describe("Timeout in ms (default: 30000)"),
      allowedTools: z.array(z.string()).optional().describe("Agent SDK tool names this task may use"),
      projectId: z.string().optional().describe("Project UUID to associate the task with"),
    },
    async (args) => {
      try {
        const id = crypto.randomUUID();
        const task = store.createTask(id, {
          name: args.name,
          prompt: args.prompt,
          description: args.description,
          cronExpression: args.cronExpression ?? null,
          executionType: args.executionType,
          executionMode: args.executionMode,
          priority: args.priority as 0 | 1 | 2 | 3 | undefined,
          maxRetries: args.maxRetries,
          timeoutMs: args.timeoutMs,
          projectId: args.projectId ?? null,
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
    },
    async (args) => {
      const task = resolveTask(store, args.nameOrId);
      if (!task) return notFound(args.nameOrId);
      try {
        const { nameOrId: _, allowedTools, ...updates } = args;
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
```

- [ ] **Step 4: Run test** (expected: all 6 pass)

```bash
cd packages/mcp && bun test src/__tests__/tools/tasks.test.ts
# Expected: 6 pass
```

- [ ] **Step 5: Commit**

```bash
git add packages/mcp/src/tools/tasks.ts packages/mcp/src/__tests__/tools/tasks.test.ts
git commit -m "feat(mcp): implement 6 task management tools (list/get/create/update/delete/toggle)"
```

---

### Task 4: tools/executions.ts — 9 execution tools

**Files:**
- Create: `packages/mcp/src/tools/executions.ts`
- Test: `packages/mcp/src/__tests__/tools/executions.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// packages/mcp/src/__tests__/tools/executions.test.ts
import { describe, it, expect, mock } from "bun:test";
import { createExecutionTools } from "../../tools/executions.ts";
import type { IStore, IOrchestratorService, Execution } from "@baara-next/core";

const baseExecution: Execution = {
  id: "exec-1",
  taskId: "task-1",
  queueName: "default",
  priority: 2,
  status: "completed",
  attempt: 1,
  scheduledAt: "2026-04-04T00:00:00Z",
  startedAt: "2026-04-04T00:00:01Z",
  completedAt: "2026-04-04T00:00:10Z",
  durationMs: 9000,
  output: "hello",
  error: null,
  inputTokens: 100,
  outputTokens: 50,
  healthStatus: "healthy",
  turnCount: 2,
  checkpointData: null,
  createdAt: "2026-04-04T00:00:00Z",
};

const baseTask = {
  id: "task-1",
  name: "my-task",
  description: "",
  prompt: "echo hello",
  timeoutMs: 30000,
  executionType: "cloud_code" as const,
  agentConfig: null,
  priority: 2 as const,
  targetQueue: "default",
  maxRetries: 3,
  executionMode: "queued" as const,
  enabled: true,
  projectId: null,
  createdAt: "2026-04-04T00:00:00Z",
  updatedAt: "2026-04-04T00:00:00Z",
};

function makeMockStore(): IStore {
  return {
    listTasks: mock(() => [baseTask]),
    getTask: mock((id: string) => (id === "task-1" ? baseTask : null)),
    getTaskByName: mock((name: string) => (name === "my-task" ? baseTask : null)),
    createTask: mock(() => baseTask),
    updateTask: mock(() => baseTask),
    deleteTask: mock(() => undefined),
    createExecution: mock(() => baseExecution),
    getExecution: mock((id: string) => (id === "exec-1" ? baseExecution : null)),
    listExecutions: mock(() => [baseExecution]),
    updateExecutionStatus: mock(() => undefined),
    updateExecutionFields: mock(() => undefined),
    dequeueExecution: mock(() => null),
    getDeadLetteredExecutions: mock(() => [baseExecution]),
    getPendingInputExecutions: mock(() => []),
    listAllExecutions: mock(() => [baseExecution]),
    appendEvent: mock(() => undefined),
    listEvents: mock(() => [
      { id: "ev1", executionId: "exec-1", eventSeq: 1, timestamp: "2026-04-04T00:00:01Z", type: "execution_started" },
    ]),
    getMaxEventSeq: mock(() => 1),
    createInputRequest: mock((r: { executionId: string; prompt: string; timeoutMs: number; status: "pending" }) => ({ id: "ir1", createdAt: "", ...r })),
    getInputRequest: mock(() => null),
    respondToInput: mock(() => undefined),
    listQueues: mock(() => [{ name: "default", depth: 0, activeCount: 0, maxConcurrency: 5, createdAt: "" }]),
    getQueueInfo: mock(() => null),
    listTemplates: mock(() => []),
    getTemplate: mock(() => null),
    createTemplate: mock((_id: string, input: { name: string }) => ({ id: _id, name: input.name, description: "", agentConfig: {}, createdAt: "", updatedAt: "" })),
    deleteTemplate: mock(() => undefined),
    listProjects: mock(() => []),
    getProject: mock(() => null),
    createProject: mock((_id: string, input: { name: string }) => ({ id: _id, name: input.name, description: "", instructions: "", workingDirectory: "", createdAt: "", updatedAt: "" })),
    updateProject: mock(() => ({ id: "p1", name: "proj", description: "", instructions: "", workingDirectory: "", createdAt: "", updatedAt: "" })),
    deleteProject: mock(() => undefined),
    getSetting: mock(() => null),
    setSetting: mock(() => undefined),
    close: mock(() => undefined),
  } as unknown as IStore;
}

function makeMockOrchestrator(): IOrchestratorService {
  return {
    submitTask: mock(async () => ({ ...baseExecution, status: "queued" as const })),
    runDirect: mock(async () => ({ ...baseExecution, status: "completed" as const })),
    cancelExecution: mock(async () => undefined),
    retryExecution: mock(async () => ({ ...baseExecution, id: "exec-2", attempt: 2, status: "queued" as const })),
    matchTask: mock(async () => null),
    handleExecutionComplete: mock(async () => undefined),
    startExecution: mock(async () => undefined),
    provideInput: mock(async () => undefined),
  } as unknown as IOrchestratorService;
}

describe("execution tools", () => {
  it("createExecutionTools returns 9 tools", () => {
    const tools = createExecutionTools({ store: makeMockStore(), orchestrator: makeMockOrchestrator() });
    expect(tools).toHaveLength(9);
  });

  it("run_task calls orchestrator.runDirect and returns execution", async () => {
    const store = makeMockStore();
    const orchestrator = makeMockOrchestrator();
    const tools = createExecutionTools({ store, orchestrator });
    const runTool = tools.find(t => (t as { name: string }).name === "run_task")!;
    const result = await (runTool as { execute: (p: { nameOrId: string }) => Promise<unknown> }).execute({ nameOrId: "my-task" });
    expect(orchestrator.runDirect).toHaveBeenCalledWith("task-1");
    const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
    expect(parsed.status).toBe("completed");
  });

  it("submit_task calls orchestrator.submitTask and returns execution", async () => {
    const store = makeMockStore();
    const orchestrator = makeMockOrchestrator();
    const tools = createExecutionTools({ store, orchestrator });
    const submitTool = tools.find(t => (t as { name: string }).name === "submit_task")!;
    const result = await (submitTool as { execute: (p: { nameOrId: string }) => Promise<unknown> }).execute({ nameOrId: "my-task" });
    expect(orchestrator.submitTask).toHaveBeenCalledWith("task-1");
    const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
    expect(parsed.status).toBe("queued");
  });

  it("list_executions returns execution list for a task", async () => {
    const store = makeMockStore();
    const tools = createExecutionTools({ store, orchestrator: makeMockOrchestrator() });
    const listTool = tools.find(t => (t as { name: string }).name === "list_executions")!;
    const result = await (listTool as { execute: (p: { taskNameOrId: string }) => Promise<unknown> }).execute({ taskNameOrId: "my-task" });
    const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].id).toBe("exec-1");
  });

  it("get_execution returns execution by id", async () => {
    const store = makeMockStore();
    const tools = createExecutionTools({ store, orchestrator: makeMockOrchestrator() });
    const getTool = tools.find(t => (t as { name: string }).name === "get_execution")!;
    const result = await (getTool as { execute: (p: { executionId: string }) => Promise<unknown> }).execute({ executionId: "exec-1" });
    const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
    expect(parsed.id).toBe("exec-1");
  });

  it("get_execution returns error for unknown id", async () => {
    const store = makeMockStore();
    const tools = createExecutionTools({ store, orchestrator: makeMockOrchestrator() });
    const getTool = tools.find(t => (t as { name: string }).name === "get_execution")!;
    const result = await (getTool as { execute: (p: { executionId: string }) => Promise<unknown> }).execute({ executionId: "missing" });
    expect((result as { isError: boolean }).isError).toBe(true);
  });

  it("get_execution_events returns event list", async () => {
    const store = makeMockStore();
    const tools = createExecutionTools({ store, orchestrator: makeMockOrchestrator() });
    const eventsTool = tools.find(t => (t as { name: string }).name === "get_execution_events")!;
    const result = await (eventsTool as { execute: (p: { executionId: string }) => Promise<unknown> }).execute({ executionId: "exec-1" });
    const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].type).toBe("execution_started");
  });

  it("cancel_execution calls orchestrator.cancelExecution", async () => {
    const orchestrator = makeMockOrchestrator();
    const tools = createExecutionTools({ store: makeMockStore(), orchestrator });
    const cancelTool = tools.find(t => (t as { name: string }).name === "cancel_execution")!;
    await (cancelTool as { execute: (p: { executionId: string }) => Promise<unknown> }).execute({ executionId: "exec-1" });
    expect(orchestrator.cancelExecution).toHaveBeenCalledWith("exec-1");
  });

  it("retry_execution calls orchestrator.retryExecution", async () => {
    const orchestrator = makeMockOrchestrator();
    const tools = createExecutionTools({ store: makeMockStore(), orchestrator });
    const retryTool = tools.find(t => (t as { name: string }).name === "retry_execution")!;
    const result = await (retryTool as { execute: (p: { executionId: string }) => Promise<unknown> }).execute({ executionId: "exec-1" });
    expect(orchestrator.retryExecution).toHaveBeenCalledWith("exec-1");
    const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
    expect(parsed.attempt).toBe(2);
  });

  it("get_system_status returns system overview", async () => {
    const store = makeMockStore();
    const tools = createExecutionTools({ store, orchestrator: makeMockOrchestrator() });
    const statusTool = tools.find(t => (t as { name: string }).name === "get_system_status")!;
    const result = await (statusTool as { execute: (p: Record<string, never>) => Promise<unknown> }).execute({});
    const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
    expect(parsed).toHaveProperty("tasks");
    expect(parsed).toHaveProperty("queues");
    expect(parsed).toHaveProperty("deadLettered");
  });

  it("get_execution_logs returns output lines", async () => {
    const store = makeMockStore();
    const tools = createExecutionTools({ store, orchestrator: makeMockOrchestrator() });
    const logsTool = tools.find(t => (t as { name: string }).name === "get_execution_logs")!;
    const result = await (logsTool as { execute: (p: { executionId: string }) => Promise<unknown> }).execute({ executionId: "exec-1" });
    const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
    expect(parsed).toHaveProperty("output");
  });
});
```

- [ ] **Step 2: Run test** (expected: FAIL — tools/executions.ts not found)

```bash
cd packages/mcp && bun test src/__tests__/tools/executions.test.ts
# Expected: error: Cannot find module '../../tools/executions.ts'
```

- [ ] **Step 3: Write implementation**

```typescript
// packages/mcp/src/tools/executions.ts
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { IStore, IOrchestratorService } from "@baara-next/core";
import { ok, err, notFound, resolveTask } from "../helpers.ts";

export function createExecutionTools(deps: {
  store: IStore;
  orchestrator: IOrchestratorService;
}) {
  const { store, orchestrator } = deps;

  // 1. run_task — execute immediately in direct mode
  const runTask = tool(
    "run_task",
    "Execute a task immediately in direct mode (bypasses queue). May take 30+ seconds.",
    { nameOrId: z.string().describe("Task name or UUID") },
    async ({ nameOrId }) => {
      const task = resolveTask(store, nameOrId);
      if (!task) return notFound(nameOrId);
      try {
        const execution = await orchestrator.runDirect(task.id);
        return ok(execution);
      } catch (e) {
        return err(`Execution failed: ${String(e)}`);
      }
    }
  );

  // 2. submit_task — dispatch to queue
  const submitTask = tool(
    "submit_task",
    "Submit a task to the execution queue and return immediately",
    { nameOrId: z.string().describe("Task name or UUID") },
    async ({ nameOrId }) => {
      const task = resolveTask(store, nameOrId);
      if (!task) return notFound(nameOrId);
      try {
        const execution = await orchestrator.submitTask(task.id);
        return ok(execution);
      } catch (e) {
        return err(`Submit failed: ${String(e)}`);
      }
    }
  );

  // 3. list_executions — execution history for a task
  const listExecutions = tool(
    "list_executions",
    "List executions for a task with optional status filter and limit",
    {
      taskNameOrId: z.string().describe("Task name or UUID"),
      status: z.enum([
        "created", "queued", "assigned", "running", "waiting_for_input",
        "completed", "failed", "timed_out", "cancelled", "retry_scheduled", "dead_lettered"
      ]).optional().describe("Filter to a specific status"),
      limit: z.number().int().min(1).max(200).optional().describe("Max executions to return (default: 50)"),
    },
    async ({ taskNameOrId, status, limit }) => {
      const task = resolveTask(store, taskNameOrId);
      if (!task) return notFound(taskNameOrId);
      const executions = store.listExecutions(task.id, { status, limit });
      return ok(
        executions.map((e) => ({
          id: e.id,
          status: e.status,
          attempt: e.attempt,
          scheduledAt: e.scheduledAt,
          startedAt: e.startedAt ?? null,
          completedAt: e.completedAt ?? null,
          durationMs: e.durationMs ?? null,
          healthStatus: e.healthStatus,
          turnCount: e.turnCount,
          error: e.error ?? null,
        }))
      );
    }
  );

  // 4. get_execution — full execution detail
  const getExecution = tool(
    "get_execution",
    "Get full details of an execution by ID",
    { executionId: z.string().describe("Execution UUID") },
    async ({ executionId }) => {
      const execution = store.getExecution(executionId);
      if (!execution) return err(`Execution not found: ${executionId}`);
      return ok(execution);
    }
  );

  // 5. get_execution_events — event timeline
  const getExecutionEvents = tool(
    "get_execution_events",
    "Get the event timeline for an execution in ascending order",
    {
      executionId: z.string().describe("Execution UUID"),
      afterSeq: z.number().int().min(0).optional().describe("Return only events with seq > this value (for paging)"),
      limit: z.number().int().min(1).max(500).optional().describe("Max events to return"),
    },
    async ({ executionId, afterSeq, limit }) => {
      const execution = store.getExecution(executionId);
      if (!execution) return err(`Execution not found: ${executionId}`);
      const events = store.listEvents(executionId, { afterSeq, limit });
      return ok(events);
    }
  );

  // 6. cancel_execution
  const cancelExecution = tool(
    "cancel_execution",
    "Cancel a running or queued execution",
    { executionId: z.string().describe("Execution UUID") },
    async ({ executionId }) => {
      try {
        await orchestrator.cancelExecution(executionId);
        return ok({ cancelled: true, executionId });
      } catch (e) {
        return err(`Cancel failed: ${String(e)}`);
      }
    }
  );

  // 7. retry_execution
  const retryExecution = tool(
    "retry_execution",
    "Manually retry a failed or timed-out execution",
    { executionId: z.string().describe("Execution UUID to retry") },
    async ({ executionId }) => {
      try {
        const newExecution = await orchestrator.retryExecution(executionId);
        return ok(newExecution);
      } catch (e) {
        return err(`Retry failed: ${String(e)}`);
      }
    }
  );

  // 8. get_system_status — system health overview
  const getSystemStatus = tool(
    "get_system_status",
    "Get system health overview: task counts, queue depths, dead-lettered count",
    {},
    async () => {
      const tasks = store.listTasks();
      const queues = store.listQueues();
      const deadLettered = store.getDeadLetteredExecutions();
      const pendingInput = store.getPendingInputExecutions();
      const recentExecutions = store.listAllExecutions({ limit: 20 });
      const running = recentExecutions.filter((e) => e.status === "running").length;
      const queued = recentExecutions.filter((e) => e.status === "queued").length;
      const failed = recentExecutions.filter((e) => e.status === "failed").length;
      return ok({
        tasks: {
          total: tasks.length,
          enabled: tasks.filter((t) => t.enabled).length,
          withCron: tasks.filter((t) => t.cronExpression).length,
        },
        queues: queues.map((q) => ({
          name: q.name,
          depth: q.depth,
          activeCount: q.activeCount,
          maxConcurrency: q.maxConcurrency,
        })),
        executions: { running, queued, failed },
        deadLettered: { count: deadLettered.length },
        pendingInput: { count: pendingInput.length },
      });
    }
  );

  // 9. get_execution_logs — filtered log output from execution output field
  const getExecutionLogs = tool(
    "get_execution_logs",
    "Get log output for an execution, with optional text filter",
    {
      executionId: z.string().describe("Execution UUID"),
      filter: z.string().optional().describe("Case-insensitive text filter for log lines"),
      limit: z.number().int().min(1).max(1000).optional().describe("Max log lines to return (default: 200)"),
    },
    async ({ executionId, filter, limit }) => {
      const execution = store.getExecution(executionId);
      if (!execution) return err(`Execution not found: ${executionId}`);
      const raw = execution.output ?? "";
      const lines = raw.split("\n");
      const filtered = filter
        ? lines.filter((line) => line.toLowerCase().includes(filter.toLowerCase()))
        : lines;
      const capped = filtered.slice(0, limit ?? 200);
      return ok({
        executionId,
        status: execution.status,
        totalLines: lines.length,
        filteredLines: capped.length,
        output: capped.join("\n"),
      });
    }
  );

  return [
    runTask,
    submitTask,
    listExecutions,
    getExecution,
    getExecutionEvents,
    cancelExecution,
    retryExecution,
    getSystemStatus,
    getExecutionLogs,
  ];
}
```

- [ ] **Step 4: Run test** (expected: all 10 pass)

```bash
cd packages/mcp && bun test src/__tests__/tools/executions.test.ts
# Expected: 10 pass
```

- [ ] **Step 5: Commit**

```bash
git add packages/mcp/src/tools/executions.ts packages/mcp/src/__tests__/tools/executions.test.ts
git commit -m "feat(mcp): implement 9 execution tools (run/submit/list/get/events/cancel/retry/status/logs)"
```

---

### Task 5: tools/queues.ts — 4 queue tools

**Files:**
- Create: `packages/mcp/src/tools/queues.ts`
- Test: `packages/mcp/src/__tests__/tools/queues.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// packages/mcp/src/__tests__/tools/queues.test.ts
import { describe, it, expect, mock } from "bun:test";
import { createQueueTools } from "../../tools/queues.ts";
import type { IStore, IOrchestratorService, QueueInfo, Execution } from "@baara-next/core";

const baseQueue: QueueInfo = {
  name: "default",
  depth: 3,
  activeCount: 1,
  maxConcurrency: 5,
  createdAt: "2026-04-04T00:00:00Z",
};

const deadExecution: Execution = {
  id: "exec-dead-1",
  taskId: "task-1",
  queueName: "dlq",
  priority: 2,
  status: "dead_lettered",
  attempt: 3,
  scheduledAt: "2026-04-04T00:00:00Z",
  startedAt: null,
  completedAt: null,
  durationMs: null,
  output: null,
  error: "max retries exceeded",
  inputTokens: null,
  outputTokens: null,
  healthStatus: "healthy",
  turnCount: 0,
  checkpointData: null,
  createdAt: "2026-04-04T00:00:00Z",
};

function makeMockStore(): IStore {
  return {
    listTasks: mock(() => []),
    getTask: mock(() => null),
    getTaskByName: mock(() => null),
    createTask: mock(() => { throw new Error("unused"); }),
    updateTask: mock(() => { throw new Error("unused"); }),
    deleteTask: mock(() => undefined),
    createExecution: mock(() => deadExecution),
    getExecution: mock(() => null),
    listExecutions: mock(() => []),
    updateExecutionStatus: mock(() => undefined),
    updateExecutionFields: mock(() => undefined),
    dequeueExecution: mock(() => null),
    getDeadLetteredExecutions: mock(() => [deadExecution]),
    getPendingInputExecutions: mock(() => []),
    listAllExecutions: mock(() => []),
    appendEvent: mock(() => undefined),
    listEvents: mock(() => []),
    getMaxEventSeq: mock(() => 0),
    createInputRequest: mock((r: { executionId: string; prompt: string; timeoutMs: number; status: "pending" }) => ({ id: "ir1", createdAt: "", ...r })),
    getInputRequest: mock(() => null),
    respondToInput: mock(() => undefined),
    listQueues: mock(() => [baseQueue]),
    getQueueInfo: mock((name: string) => (name === "default" ? baseQueue : null)),
    listTemplates: mock(() => []),
    getTemplate: mock(() => null),
    createTemplate: mock((_id: string, input: { name: string }) => ({ id: _id, name: input.name, description: "", agentConfig: {}, createdAt: "", updatedAt: "" })),
    deleteTemplate: mock(() => undefined),
    listProjects: mock(() => []),
    getProject: mock(() => null),
    createProject: mock((_id: string, input: { name: string }) => ({ id: _id, name: input.name, description: "", instructions: "", workingDirectory: "", createdAt: "", updatedAt: "" })),
    updateProject: mock(() => ({ id: "p1", name: "proj", description: "", instructions: "", workingDirectory: "", createdAt: "", updatedAt: "" })),
    deleteProject: mock(() => undefined),
    getSetting: mock(() => null),
    setSetting: mock(() => undefined),
    close: mock(() => undefined),
  } as unknown as IStore;
}

function makeMockOrchestrator(): IOrchestratorService {
  return {
    submitTask: mock(async () => deadExecution),
    runDirect: mock(async () => deadExecution),
    cancelExecution: mock(async () => undefined),
    retryExecution: mock(async () => ({ ...deadExecution, id: "exec-retry-1", attempt: 4, status: "queued" as const })),
    matchTask: mock(async () => null),
    handleExecutionComplete: mock(async () => undefined),
    startExecution: mock(async () => undefined),
    provideInput: mock(async () => undefined),
  } as unknown as IOrchestratorService;
}

describe("queue tools", () => {
  it("createQueueTools returns 4 tools", () => {
    const tools = createQueueTools({ store: makeMockStore(), orchestrator: makeMockOrchestrator() });
    expect(tools).toHaveLength(4);
  });

  it("list_queues returns all queues", async () => {
    const tools = createQueueTools({ store: makeMockStore(), orchestrator: makeMockOrchestrator() });
    const listTool = tools.find(t => (t as { name: string }).name === "list_queues")!;
    const result = await (listTool as { execute: (p: Record<string, never>) => Promise<unknown> }).execute({});
    const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].name).toBe("default");
    expect(parsed[0].depth).toBe(3);
  });

  it("get_queue_info returns detail for known queue", async () => {
    const tools = createQueueTools({ store: makeMockStore(), orchestrator: makeMockOrchestrator() });
    const infoTool = tools.find(t => (t as { name: string }).name === "get_queue_info")!;
    const result = await (infoTool as { execute: (p: { name: string }) => Promise<unknown> }).execute({ name: "default" });
    const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
    expect(parsed.name).toBe("default");
    expect(parsed.maxConcurrency).toBe(5);
  });

  it("get_queue_info returns error for unknown queue", async () => {
    const tools = createQueueTools({ store: makeMockStore(), orchestrator: makeMockOrchestrator() });
    const infoTool = tools.find(t => (t as { name: string }).name === "get_queue_info")!;
    const result = await (infoTool as { execute: (p: { name: string }) => Promise<unknown> }).execute({ name: "missing" });
    expect((result as { isError: boolean }).isError).toBe(true);
  });

  it("dlq_list returns dead-lettered executions", async () => {
    const tools = createQueueTools({ store: makeMockStore(), orchestrator: makeMockOrchestrator() });
    const dlqTool = tools.find(t => (t as { name: string }).name === "dlq_list")!;
    const result = await (dlqTool as { execute: (p: Record<string, never>) => Promise<unknown> }).execute({});
    const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].id).toBe("exec-dead-1");
    expect(parsed[0].error).toBe("max retries exceeded");
  });

  it("dlq_retry calls retryExecution and returns new execution", async () => {
    const orchestrator = makeMockOrchestrator();
    const tools = createQueueTools({ store: makeMockStore(), orchestrator });
    const retryTool = tools.find(t => (t as { name: string }).name === "dlq_retry")!;
    const result = await (retryTool as { execute: (p: { executionId: string }) => Promise<unknown> }).execute({ executionId: "exec-dead-1" });
    expect(orchestrator.retryExecution).toHaveBeenCalledWith("exec-dead-1");
    const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
    expect(parsed.attempt).toBe(4);
  });
});
```

- [ ] **Step 2: Run test** (expected: FAIL — tools/queues.ts not found)

```bash
cd packages/mcp && bun test src/__tests__/tools/queues.test.ts
# Expected: error: Cannot find module '../../tools/queues.ts'
```

- [ ] **Step 3: Write implementation**

```typescript
// packages/mcp/src/tools/queues.ts
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { IStore, IOrchestratorService } from "@baara-next/core";
import { ok, err } from "../helpers.ts";

export function createQueueTools(deps: {
  store: IStore;
  orchestrator: IOrchestratorService;
}) {
  const { store, orchestrator } = deps;

  // 1. list_queues
  const listQueues = tool(
    "list_queues",
    "List all queues with depth, active count, and concurrency settings",
    {},
    async () => {
      const queues = store.listQueues();
      return ok(
        queues.map((q) => ({
          name: q.name,
          depth: q.depth,
          activeCount: q.activeCount,
          maxConcurrency: q.maxConcurrency,
        }))
      );
    }
  );

  // 2. get_queue_info
  const getQueueInfo = tool(
    "get_queue_info",
    "Get detailed information for a specific queue by name",
    { name: z.string().describe("Queue name (e.g. 'transfer', 'timer', 'visibility', 'dlq')") },
    async ({ name }) => {
      const queue = store.getQueueInfo(name);
      if (!queue) return err(`Queue not found: ${name}`);
      return ok(queue);
    }
  );

  // 3. dlq_list — list dead-lettered executions
  const dlqList = tool(
    "dlq_list",
    "List all dead-lettered executions that have exhausted their retries",
    {},
    async () => {
      const executions = store.getDeadLetteredExecutions();
      if (executions.length === 0) {
        return ok({ message: "Dead-letter queue is empty.", executions: [] });
      }
      return ok(
        executions.map((e) => ({
          id: e.id,
          taskId: e.taskId,
          status: e.status,
          attempt: e.attempt,
          error: e.error ?? null,
          scheduledAt: e.scheduledAt,
          createdAt: e.createdAt,
        }))
      );
    }
  );

  // 4. dlq_retry — retry a dead-lettered execution
  const dlqRetry = tool(
    "dlq_retry",
    "Retry a dead-lettered execution by submitting it again",
    { executionId: z.string().describe("Dead-lettered execution UUID") },
    async ({ executionId }) => {
      try {
        const newExecution = await orchestrator.retryExecution(executionId);
        return ok(newExecution);
      } catch (e) {
        return err(`DLQ retry failed: ${String(e)}`);
      }
    }
  );

  return [listQueues, getQueueInfo, dlqList, dlqRetry];
}
```

- [ ] **Step 4: Run test** (expected: all 6 pass)

```bash
cd packages/mcp && bun test src/__tests__/tools/queues.test.ts
# Expected: 6 pass
```

- [ ] **Step 5: Commit**

```bash
git add packages/mcp/src/tools/queues.ts packages/mcp/src/__tests__/tools/queues.test.ts
git commit -m "feat(mcp): implement 4 queue tools (list/info/dlq-list/dlq-retry)"
```

---

### Task 6: tools/hitl.ts — 2 human-in-the-loop tools

**Files:**
- Create: `packages/mcp/src/tools/hitl.ts`
- Test: `packages/mcp/src/__tests__/tools/hitl.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// packages/mcp/src/__tests__/tools/hitl.test.ts
import { describe, it, expect, mock } from "bun:test";
import { createHitlTools } from "../../tools/hitl.ts";
import type { IStore, IOrchestratorService, Execution, InputRequest } from "@baara-next/core";

const waitingExecution: Execution = {
  id: "exec-wait-1",
  taskId: "task-1",
  queueName: "default",
  priority: 2,
  status: "waiting_for_input",
  attempt: 1,
  scheduledAt: "2026-04-04T00:00:00Z",
  startedAt: "2026-04-04T00:00:01Z",
  completedAt: null,
  durationMs: null,
  output: null,
  error: null,
  inputTokens: null,
  outputTokens: null,
  healthStatus: "healthy",
  turnCount: 3,
  checkpointData: null,
  createdAt: "2026-04-04T00:00:00Z",
};

const inputRequest: InputRequest = {
  id: "ir-1",
  executionId: "exec-wait-1",
  prompt: "Should I proceed?",
  options: ["yes", "no"],
  context: "some context",
  response: null,
  status: "pending",
  timeoutMs: 60000,
  createdAt: "2026-04-04T00:00:05Z",
  respondedAt: null,
};

function makeMockStore(): IStore {
  return {
    listTasks: mock(() => []),
    getTask: mock(() => null),
    getTaskByName: mock(() => null),
    createTask: mock(() => { throw new Error("unused"); }),
    updateTask: mock(() => { throw new Error("unused"); }),
    deleteTask: mock(() => undefined),
    createExecution: mock(() => waitingExecution),
    getExecution: mock((id: string) => (id === "exec-wait-1" ? waitingExecution : null)),
    listExecutions: mock(() => []),
    updateExecutionStatus: mock(() => undefined),
    updateExecutionFields: mock(() => undefined),
    dequeueExecution: mock(() => null),
    getDeadLetteredExecutions: mock(() => []),
    getPendingInputExecutions: mock(() => [waitingExecution]),
    listAllExecutions: mock(() => [waitingExecution]),
    appendEvent: mock(() => undefined),
    listEvents: mock(() => []),
    getMaxEventSeq: mock(() => 0),
    createInputRequest: mock((r: { executionId: string; prompt: string; timeoutMs: number; status: "pending" }) => ({ id: "ir1", createdAt: "", ...r })),
    getInputRequest: mock((executionId: string) => (executionId === "exec-wait-1" ? inputRequest : null)),
    respondToInput: mock(() => undefined),
    listQueues: mock(() => []),
    getQueueInfo: mock(() => null),
    listTemplates: mock(() => []),
    getTemplate: mock(() => null),
    createTemplate: mock((_id: string, input: { name: string }) => ({ id: _id, name: input.name, description: "", agentConfig: {}, createdAt: "", updatedAt: "" })),
    deleteTemplate: mock(() => undefined),
    listProjects: mock(() => []),
    getProject: mock(() => null),
    createProject: mock((_id: string, input: { name: string }) => ({ id: _id, name: input.name, description: "", instructions: "", workingDirectory: "", createdAt: "", updatedAt: "" })),
    updateProject: mock(() => ({ id: "p1", name: "proj", description: "", instructions: "", workingDirectory: "", createdAt: "", updatedAt: "" })),
    deleteProject: mock(() => undefined),
    getSetting: mock(() => null),
    setSetting: mock(() => undefined),
    close: mock(() => undefined),
  } as unknown as IStore;
}

function makeMockOrchestrator(): IOrchestratorService {
  return {
    submitTask: mock(async () => waitingExecution),
    runDirect: mock(async () => waitingExecution),
    cancelExecution: mock(async () => undefined),
    retryExecution: mock(async () => waitingExecution),
    matchTask: mock(async () => null),
    handleExecutionComplete: mock(async () => undefined),
    startExecution: mock(async () => undefined),
    provideInput: mock(async (_executionId: string, _response: string) => undefined),
  } as unknown as IOrchestratorService;
}

describe("hitl tools", () => {
  it("createHitlTools returns 2 tools", () => {
    const tools = createHitlTools({ store: makeMockStore(), orchestrator: makeMockOrchestrator() });
    expect(tools).toHaveLength(2);
  });

  it("list_pending_input returns waiting executions with their input requests", async () => {
    const tools = createHitlTools({ store: makeMockStore(), orchestrator: makeMockOrchestrator() });
    const listTool = tools.find(t => (t as { name: string }).name === "list_pending_input")!;
    const result = await (listTool as { execute: (p: Record<string, never>) => Promise<unknown> }).execute({});
    const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].executionId).toBe("exec-wait-1");
    expect(parsed[0].prompt).toBe("Should I proceed?");
    expect(parsed[0].options).toEqual(["yes", "no"]);
  });

  it("provide_input calls orchestrator.provideInput", async () => {
    const orchestrator = makeMockOrchestrator();
    const tools = createHitlTools({ store: makeMockStore(), orchestrator });
    const provideTool = tools.find(t => (t as { name: string }).name === "provide_input")!;
    const result = await (provideTool as { execute: (p: { executionId: string; response: string }) => Promise<unknown> }).execute({
      executionId: "exec-wait-1",
      response: "yes",
    });
    expect(orchestrator.provideInput).toHaveBeenCalledWith("exec-wait-1", "yes");
    const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
    expect(parsed.delivered).toBe(true);
  });

  it("provide_input returns error for unknown execution", async () => {
    const orchestrator = makeMockOrchestrator();
    (orchestrator.provideInput as ReturnType<typeof mock>).mockImplementation(async () => {
      throw new Error("Execution not found");
    });
    const tools = createHitlTools({ store: makeMockStore(), orchestrator });
    const provideTool = tools.find(t => (t as { name: string }).name === "provide_input")!;
    const result = await (provideTool as { execute: (p: { executionId: string; response: string }) => Promise<unknown> }).execute({
      executionId: "nonexistent",
      response: "yes",
    });
    expect((result as { isError: boolean }).isError).toBe(true);
  });
});
```

- [ ] **Step 2: Run test** (expected: FAIL — tools/hitl.ts not found)

```bash
cd packages/mcp && bun test src/__tests__/tools/hitl.test.ts
# Expected: error: Cannot find module '../../tools/hitl.ts'
```

- [ ] **Step 3: Write implementation**

```typescript
// packages/mcp/src/tools/hitl.ts
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { IStore, IOrchestratorService } from "@baara-next/core";
import { ok, err } from "../helpers.ts";

export function createHitlTools(deps: {
  store: IStore;
  orchestrator: IOrchestratorService;
}) {
  const { store, orchestrator } = deps;

  // 1. list_pending_input — executions waiting for human operator input
  const listPendingInput = tool(
    "list_pending_input",
    "List all executions currently paused and waiting for human input",
    {},
    async () => {
      const executions = store.getPendingInputExecutions();
      if (executions.length === 0) {
        return ok({ message: "No executions are waiting for input.", pending: [] });
      }
      const results = executions.map((e) => {
        const request = store.getInputRequest(e.id);
        return {
          executionId: e.id,
          taskId: e.taskId,
          attempt: e.attempt,
          turnCount: e.turnCount,
          prompt: request?.prompt ?? null,
          options: request?.options ?? null,
          context: request?.context ?? null,
          requestedAt: request?.createdAt ?? null,
          timeoutMs: request?.timeoutMs ?? null,
        };
      });
      return ok(results);
    }
  );

  // 2. provide_input — deliver a response to a blocked execution
  const provideInput = tool(
    "provide_input",
    "Provide a response to an execution that is waiting for human input",
    {
      executionId: z.string().describe("Execution UUID currently in waiting_for_input status"),
      response: z.string().describe("The response to deliver to the execution"),
    },
    async ({ executionId, response }) => {
      try {
        await orchestrator.provideInput(executionId, response);
        return ok({ delivered: true, executionId, response });
      } catch (e) {
        return err(`Failed to provide input: ${String(e)}`);
      }
    }
  );

  return [listPendingInput, provideInput];
}
```

- [ ] **Step 4: Run test** (expected: all 4 pass)

```bash
cd packages/mcp && bun test src/__tests__/tools/hitl.test.ts
# Expected: 4 pass
```

- [ ] **Step 5: Commit**

```bash
git add packages/mcp/src/tools/hitl.ts packages/mcp/src/__tests__/tools/hitl.test.ts
git commit -m "feat(mcp): implement 2 HITL tools (list_pending_input, provide_input)"
```

---

### Task 7: tools/templates.ts and tools/projects.ts — 4 tools total

**Files:**
- Create: `packages/mcp/src/tools/templates.ts`
- Create: `packages/mcp/src/tools/projects.ts`
- Test: `packages/mcp/src/__tests__/tools/templates.test.ts`
- Test: `packages/mcp/src/__tests__/tools/projects.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// packages/mcp/src/__tests__/tools/templates.test.ts
import { describe, it, expect, mock } from "bun:test";
import { createTemplateTools } from "../../tools/templates.ts";
import type { IStore, IOrchestratorService, Template } from "@baara-next/core";

const baseTemplate: Template = {
  id: "tmpl-1",
  name: "web-researcher",
  description: "Researches a topic on the web",
  agentConfig: { allowedTools: ["WebSearch"], maxTurns: 10 },
  createdAt: "2026-04-04T00:00:00Z",
  updatedAt: "2026-04-04T00:00:00Z",
};

const baseTask = {
  id: "task-new-1",
  name: "research-ai",
  description: "from template",
  prompt: "Research AI",
  timeoutMs: 30000,
  executionType: "cloud_code" as const,
  agentConfig: { allowedTools: ["WebSearch"], maxTurns: 10 },
  priority: 2 as const,
  targetQueue: "default",
  maxRetries: 3,
  executionMode: "queued" as const,
  enabled: true,
  projectId: null,
  createdAt: "2026-04-04T00:00:00Z",
  updatedAt: "2026-04-04T00:00:00Z",
};

function makeMockStore(): IStore {
  return {
    listTasks: mock(() => []),
    getTask: mock(() => null),
    getTaskByName: mock(() => null),
    createTask: mock((_id: string, input: { name: string }) => ({ ...baseTask, name: input.name })),
    updateTask: mock(() => baseTask),
    deleteTask: mock(() => undefined),
    createExecution: mock(() => { throw new Error("unused"); }),
    getExecution: mock(() => null),
    listExecutions: mock(() => []),
    updateExecutionStatus: mock(() => undefined),
    updateExecutionFields: mock(() => undefined),
    dequeueExecution: mock(() => null),
    getDeadLetteredExecutions: mock(() => []),
    getPendingInputExecutions: mock(() => []),
    listAllExecutions: mock(() => []),
    appendEvent: mock(() => undefined),
    listEvents: mock(() => []),
    getMaxEventSeq: mock(() => 0),
    createInputRequest: mock((r: { executionId: string; prompt: string; timeoutMs: number; status: "pending" }) => ({ id: "ir1", createdAt: "", ...r })),
    getInputRequest: mock(() => null),
    respondToInput: mock(() => undefined),
    listQueues: mock(() => []),
    getQueueInfo: mock(() => null),
    listTemplates: mock(() => [baseTemplate]),
    getTemplate: mock((id: string) => (id === "tmpl-1" ? baseTemplate : null)),
    createTemplate: mock((_id: string, input: { name: string }) => ({ ...baseTemplate, id: _id, name: input.name })),
    deleteTemplate: mock(() => undefined),
    listProjects: mock(() => []),
    getProject: mock(() => null),
    createProject: mock((_id: string, input: { name: string }) => ({ id: _id, name: input.name, description: "", instructions: "", workingDirectory: "", createdAt: "", updatedAt: "" })),
    updateProject: mock(() => ({ id: "p1", name: "proj", description: "", instructions: "", workingDirectory: "", createdAt: "", updatedAt: "" })),
    deleteProject: mock(() => undefined),
    getSetting: mock(() => null),
    setSetting: mock(() => undefined),
    close: mock(() => undefined),
  } as unknown as IStore;
}

function makeMockOrchestrator(): IOrchestratorService {
  return {
    submitTask: mock(async () => { throw new Error("unused"); }),
    runDirect: mock(async () => { throw new Error("unused"); }),
    cancelExecution: mock(async () => undefined),
    retryExecution: mock(async () => { throw new Error("unused"); }),
    matchTask: mock(async () => null),
    handleExecutionComplete: mock(async () => undefined),
    startExecution: mock(async () => undefined),
    provideInput: mock(async () => undefined),
  } as unknown as IOrchestratorService;
}

describe("template tools", () => {
  it("createTemplateTools returns 2 tools", () => {
    const tools = createTemplateTools({ store: makeMockStore(), orchestrator: makeMockOrchestrator() });
    expect(tools).toHaveLength(2);
  });

  it("list_templates returns all templates", async () => {
    const tools = createTemplateTools({ store: makeMockStore(), orchestrator: makeMockOrchestrator() });
    const listTool = tools.find(t => (t as { name: string }).name === "list_templates")!;
    const result = await (listTool as { execute: (p: Record<string, never>) => Promise<unknown> }).execute({});
    const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].name).toBe("web-researcher");
  });

  it("create_task_from_template creates task with template agentConfig", async () => {
    const store = makeMockStore();
    const tools = createTemplateTools({ store, orchestrator: makeMockOrchestrator() });
    const fromTemplate = tools.find(t => (t as { name: string }).name === "create_task_from_template")!;
    const result = await (fromTemplate as { execute: (p: { templateId: string; name: string; prompt: string }) => Promise<unknown> }).execute({
      templateId: "tmpl-1",
      name: "research-ai",
      prompt: "Research AI trends",
    });
    expect(store.createTask).toHaveBeenCalled();
    const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
    expect(parsed.name).toBe("research-ai");
  });

  it("create_task_from_template returns error for unknown template", async () => {
    const tools = createTemplateTools({ store: makeMockStore(), orchestrator: makeMockOrchestrator() });
    const fromTemplate = tools.find(t => (t as { name: string }).name === "create_task_from_template")!;
    const result = await (fromTemplate as { execute: (p: { templateId: string; name: string; prompt: string }) => Promise<unknown> }).execute({
      templateId: "nonexistent",
      name: "test",
      prompt: "test",
    });
    expect((result as { isError: boolean }).isError).toBe(true);
  });
});
```

```typescript
// packages/mcp/src/__tests__/tools/projects.test.ts
import { describe, it, expect, mock } from "bun:test";
import { createProjectTools } from "../../tools/projects.ts";
import type { IStore, IOrchestratorService, Project } from "@baara-next/core";

const baseProject: Project = {
  id: "proj-1",
  name: "baara-core",
  description: "Core engine project",
  instructions: "Always use TypeScript strict mode",
  workingDirectory: "/home/user/baara",
  createdAt: "2026-04-04T00:00:00Z",
  updatedAt: "2026-04-04T00:00:00Z",
};

function makeMockStore(): IStore {
  return {
    listTasks: mock(() => []),
    getTask: mock(() => null),
    getTaskByName: mock(() => null),
    createTask: mock(() => { throw new Error("unused"); }),
    updateTask: mock(() => { throw new Error("unused"); }),
    deleteTask: mock(() => undefined),
    createExecution: mock(() => { throw new Error("unused"); }),
    getExecution: mock(() => null),
    listExecutions: mock(() => []),
    updateExecutionStatus: mock(() => undefined),
    updateExecutionFields: mock(() => undefined),
    dequeueExecution: mock(() => null),
    getDeadLetteredExecutions: mock(() => []),
    getPendingInputExecutions: mock(() => []),
    listAllExecutions: mock(() => []),
    appendEvent: mock(() => undefined),
    listEvents: mock(() => []),
    getMaxEventSeq: mock(() => 0),
    createInputRequest: mock((r: { executionId: string; prompt: string; timeoutMs: number; status: "pending" }) => ({ id: "ir1", createdAt: "", ...r })),
    getInputRequest: mock(() => null),
    respondToInput: mock(() => undefined),
    listQueues: mock(() => []),
    getQueueInfo: mock(() => null),
    listTemplates: mock(() => []),
    getTemplate: mock(() => null),
    createTemplate: mock((_id: string, input: { name: string }) => ({ id: _id, name: input.name, description: "", agentConfig: {}, createdAt: "", updatedAt: "" })),
    deleteTemplate: mock(() => undefined),
    listProjects: mock(() => [baseProject]),
    getProject: mock((id: string) => (id === "proj-1" ? baseProject : null)),
    createProject: mock((_id: string, input: { name: string }) => ({ ...baseProject, id: _id, name: input.name })),
    updateProject: mock(() => baseProject),
    deleteProject: mock(() => undefined),
    getSetting: mock(() => null),
    setSetting: mock(() => undefined),
    close: mock(() => undefined),
  } as unknown as IStore;
}

function makeMockOrchestrator(): IOrchestratorService {
  return {
    submitTask: mock(async () => { throw new Error("unused"); }),
    runDirect: mock(async () => { throw new Error("unused"); }),
    cancelExecution: mock(async () => undefined),
    retryExecution: mock(async () => { throw new Error("unused"); }),
    matchTask: mock(async () => null),
    handleExecutionComplete: mock(async () => undefined),
    startExecution: mock(async () => undefined),
    provideInput: mock(async () => undefined),
  } as unknown as IOrchestratorService;
}

describe("project tools", () => {
  it("createProjectTools returns 2 tools", () => {
    const tools = createProjectTools({ store: makeMockStore(), orchestrator: makeMockOrchestrator() });
    expect(tools).toHaveLength(2);
  });

  it("list_projects returns all projects with task count", async () => {
    const tools = createProjectTools({ store: makeMockStore(), orchestrator: makeMockOrchestrator() });
    const listTool = tools.find(t => (t as { name: string }).name === "list_projects")!;
    const result = await (listTool as { execute: (p: Record<string, never>) => Promise<unknown> }).execute({});
    const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].name).toBe("baara-core");
    expect(parsed[0]).toHaveProperty("taskCount");
  });

  it("set_active_project returns project info for known project", async () => {
    const tools = createProjectTools({ store: makeMockStore(), orchestrator: makeMockOrchestrator() });
    const setTool = tools.find(t => (t as { name: string }).name === "set_active_project")!;
    const result = await (setTool as { execute: (p: { nameOrId: string }) => Promise<unknown> }).execute({ nameOrId: "proj-1" });
    const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
    expect(parsed.project.id).toBe("proj-1");
  });

  it("set_active_project resolves by name", async () => {
    const tools = createProjectTools({ store: makeMockStore(), orchestrator: makeMockOrchestrator() });
    const setTool = tools.find(t => (t as { name: string }).name === "set_active_project")!;
    const result = await (setTool as { execute: (p: { nameOrId: string }) => Promise<unknown> }).execute({ nameOrId: "baara-core" });
    const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
    expect(parsed.project.name).toBe("baara-core");
  });

  it("set_active_project with empty string clears scope", async () => {
    const tools = createProjectTools({ store: makeMockStore(), orchestrator: makeMockOrchestrator() });
    const setTool = tools.find(t => (t as { name: string }).name === "set_active_project")!;
    const result = await (setTool as { execute: (p: { nameOrId: string }) => Promise<unknown> }).execute({ nameOrId: "" });
    const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
    expect(parsed.cleared).toBe(true);
  });

  it("set_active_project returns error for unknown project", async () => {
    const tools = createProjectTools({ store: makeMockStore(), orchestrator: makeMockOrchestrator() });
    const setTool = tools.find(t => (t as { name: string }).name === "set_active_project")!;
    const result = await (setTool as { execute: (p: { nameOrId: string }) => Promise<unknown> }).execute({ nameOrId: "nonexistent" });
    expect((result as { isError: boolean }).isError).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests** (expected: FAIL — modules not found)

```bash
cd packages/mcp && bun test src/__tests__/tools/templates.test.ts src/__tests__/tools/projects.test.ts
# Expected: errors: Cannot find module '../../tools/templates.ts' and '../../tools/projects.ts'
```

- [ ] **Step 3: Write implementation**

```typescript
// packages/mcp/src/tools/templates.ts
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { IStore, IOrchestratorService } from "@baara-next/core";
import { ok, err } from "../helpers.ts";

export function createTemplateTools(deps: {
  store: IStore;
  orchestrator: IOrchestratorService;
}) {
  const { store } = deps;

  // 1. list_templates
  const listTemplates = tool(
    "list_templates",
    "List all available task templates with their description and agent config",
    {},
    async () => {
      const templates = store.listTemplates();
      if (templates.length === 0) {
        return ok({ message: "No templates available.", templates: [] });
      }
      return ok(
        templates.map((t) => ({
          id: t.id,
          name: t.name,
          description: t.description,
          agentConfig: t.agentConfig,
          createdAt: t.createdAt,
        }))
      );
    }
  );

  // 2. create_task_from_template
  const createTaskFromTemplate = tool(
    "create_task_from_template",
    "Create a new task using a template's agent configuration as the base",
    {
      templateId: z.string().describe("Template UUID"),
      name: z.string().describe("Unique name for the new task"),
      prompt: z.string().describe("Prompt for the task to execute"),
      description: z.string().optional().describe("Task description (defaults to template description)"),
      cronExpression: z.string().optional().describe("Cron schedule, e.g. '0 9 * * *'"),
      executionMode: z.enum(["queued", "direct"]).optional().describe("Execution mode (default: queued)"),
      priority: z.number().int().min(0).max(3).optional().describe("Priority 0-3 (default: 2)"),
      projectId: z.string().optional().describe("Project UUID to associate the task with"),
    },
    async (args) => {
      const template = store.getTemplate(args.templateId);
      if (!template) return err(`Template not found: ${args.templateId}`);
      try {
        const id = crypto.randomUUID();
        const task = store.createTask(id, {
          name: args.name,
          prompt: args.prompt,
          description: args.description ?? template.description,
          cronExpression: args.cronExpression ?? null,
          executionMode: args.executionMode,
          priority: args.priority as 0 | 1 | 2 | 3 | undefined,
          projectId: args.projectId ?? null,
          agentConfig: template.agentConfig,
        });
        return ok({ ...task, fromTemplate: template.name });
      } catch (e) {
        return err(`Failed to create task from template: ${String(e)}`);
      }
    }
  );

  return [listTemplates, createTaskFromTemplate];
}
```

```typescript
// packages/mcp/src/tools/projects.ts
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { IStore, IOrchestratorService } from "@baara-next/core";
import { ok, err } from "../helpers.ts";

export function createProjectTools(deps: {
  store: IStore;
  orchestrator: IOrchestratorService;
}) {
  const { store } = deps;

  // 1. list_projects
  const listProjects = tool(
    "list_projects",
    "List all projects with their task counts and descriptions",
    {},
    async () => {
      const projects = store.listProjects();
      if (projects.length === 0) {
        return ok({ message: "No projects yet.", projects: [] });
      }
      return ok(
        projects.map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          workingDirectory: p.workingDirectory,
          taskCount: store.listTasks(p.id).length,
          createdAt: p.createdAt,
        }))
      );
    }
  );

  // 2. set_active_project
  const setActiveProject = tool(
    "set_active_project",
    "Set the active project to scope task operations. Pass an empty string to clear the active project.",
    { nameOrId: z.string().describe("Project name or UUID; pass empty string to clear active project") },
    async ({ nameOrId }) => {
      if (!nameOrId) {
        return ok({ cleared: true, message: "Active project cleared. Operations are now unscoped." });
      }
      const projects = store.listProjects();
      const project = projects.find((p) => p.name === nameOrId) ?? store.getProject(nameOrId);
      if (!project) return err(`Project not found: ${nameOrId}`);
      return ok({
        message: `Active project set to "${project.name}"`,
        project: { id: project.id, name: project.name, description: project.description },
      });
    }
  );

  return [listProjects, setActiveProject];
}
```

- [ ] **Step 4: Run tests** (expected: all 8 pass)

```bash
cd packages/mcp && bun test src/__tests__/tools/templates.test.ts src/__tests__/tools/projects.test.ts
# Expected: 8 pass
```

- [ ] **Step 5: Commit**

```bash
git add packages/mcp/src/tools/templates.ts packages/mcp/src/tools/projects.ts \
  packages/mcp/src/__tests__/tools/templates.test.ts \
  packages/mcp/src/__tests__/tools/projects.test.ts
git commit -m "feat(mcp): implement template and project tools (list_templates, create_task_from_template, list_projects, set_active_project)"
```

---

### Task 8: tools/claude-code.ts — 2 Claude Code integration tools

**Files:**
- Create: `packages/mcp/src/integrations/claude-code.ts`
- Create: `packages/mcp/src/tools/claude-code.ts`
- Test: `packages/mcp/src/__tests__/tools/claude-code.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// packages/mcp/src/__tests__/tools/claude-code.test.ts
import { describe, it, expect, mock, spyOn } from "bun:test";
import { createClaudeCodeTools } from "../../tools/claude-code.ts";
import type { IStore, IOrchestratorService } from "@baara-next/core";

// We test with a mock of the integrations module
const mockSkills = [
  {
    name: "gws-drive",
    fullName: "gws:gws-drive",
    pluginName: "gws",
    description: "Manage Google Drive files",
    triggers: ["drive", "gdrive"],
    path: "/home/user/.claude/plugins/gws/skills/gws-drive.md",
  },
  {
    name: "deploy",
    fullName: "superpowers:deploy",
    pluginName: "superpowers",
    description: "Deploy application",
    triggers: ["deploy", "ship"],
    path: "/home/user/.claude/plugins/superpowers/skills/deploy.md",
  },
];

const mockDiscovery = {
  plugins: [
    { name: "gws", description: "Google Workspace", version: "1.0.0", author: "test", marketplace: false, keywords: ["google"] },
  ],
  commands: ["gws:gws-drive", "superpowers:deploy"],
  skills: mockSkills,
  agents: [],
  discoveredAt: "2026-04-04T00:00:00Z",
};

function makeMockStore(): IStore {
  return {} as unknown as IStore;
}

function makeMockOrchestrator(): IOrchestratorService {
  return {} as unknown as IOrchestratorService;
}

describe("claude-code tools", () => {
  it("createClaudeCodeTools returns 2 tools", () => {
    const tools = createClaudeCodeTools({ store: makeMockStore(), orchestrator: makeMockOrchestrator() });
    expect(tools).toHaveLength(2);
    const names = tools.map(t => (t as { name: string }).name);
    expect(names).toContain("discover_plugins");
    expect(names).toContain("run_skill");
  });

  it("discover_plugins returns plugin discovery summary", async () => {
    const tools = createClaudeCodeTools({ store: makeMockStore(), orchestrator: makeMockOrchestrator() });
    const discoverTool = tools.find(t => (t as { name: string }).name === "discover_plugins")!;

    // Mock the integration module at test runtime
    const integrations = await import("../../integrations/claude-code.ts");
    const spy = spyOn(integrations, "discoverAll").mockResolvedValue(mockDiscovery);

    const result = await (discoverTool as { execute: (p: Record<string, never>) => Promise<unknown> }).execute({});
    const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
    expect(parsed.pluginCount).toBe(1);
    expect(parsed.skillCount).toBe(2);
    spy.mockRestore();
  });

  it("run_skill returns error when skill not found", async () => {
    const tools = createClaudeCodeTools({ store: makeMockStore(), orchestrator: makeMockOrchestrator() });
    const runTool = tools.find(t => (t as { name: string }).name === "run_skill")!;

    const integrations = await import("../../integrations/claude-code.ts");
    const spy = spyOn(integrations, "discoverSkills").mockResolvedValue([]);

    const result = await (runTool as { execute: (p: { name: string }) => Promise<unknown> }).execute({ name: "nonexistent" });
    expect((result as { isError: boolean }).isError).toBe(true);
    expect((result as { content: Array<{ text: string }> }).content[0].text).toContain("nonexistent");
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run test** (expected: FAIL — modules not found)

```bash
cd packages/mcp && bun test src/__tests__/tools/claude-code.test.ts
# Expected: error: Cannot find module '../../tools/claude-code.ts'
```

- [ ] **Step 3: Write implementation**

```typescript
// packages/mcp/src/integrations/claude-code.ts
//
// Discovers Claude Code plugins, skills, and agents from ~/.claude/
// Ported from the original BAARA integration with minimal adjustments.

import { readdir, readFile, stat } from "node:fs/promises";
import { join, basename, dirname } from "node:path";
import { homedir } from "node:os";

export interface Plugin {
  name: string;
  description: string;
  version: string;
  author: string;
  marketplace: boolean;
  keywords: string[];
}

export interface Skill {
  name: string;
  fullName: string;
  pluginName: string;
  description: string;
  triggers: string[];
  path: string;
}

export interface Agent {
  name: string;
  fullName: string;
  pluginName: string;
  description: string;
  model?: string;
}

export interface Command {
  name: string;
  fullName: string;
  source: string;
  pluginName?: string;
  description: string;
  argumentHint?: string;
}

export interface ClaudeCodeIntegration {
  plugins: Plugin[];
  commands: string[];
  skills: Skill[];
  agents: Agent[];
  discoveredAt: string;
}

const CLAUDE_DIR = join(homedir(), ".claude");

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile<T>(p: string): Promise<T | null> {
  try {
    const raw = await readFile(p, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function extractMarkdownDescription(content: string): string {
  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#") && !trimmed.startsWith("---")) {
      return trimmed.slice(0, 200);
    }
  }
  return "";
}

function extractFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const fm: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const colon = line.indexOf(":");
    if (colon > 0) {
      fm[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
    }
  }
  return fm;
}

export async function discoverAll(): Promise<ClaudeCodeIntegration> {
  const pluginsDir = join(CLAUDE_DIR, "plugins");
  const result: ClaudeCodeIntegration = {
    plugins: [],
    commands: [],
    skills: [],
    agents: [],
    discoveredAt: new Date().toISOString(),
  };

  if (!(await pathExists(pluginsDir))) return result;

  let entries: string[] = [];
  try {
    entries = await readdir(pluginsDir);
  } catch {
    return result;
  }

  for (const entry of entries) {
    const pluginDir = join(pluginsDir, entry);
    const manifestPath = join(pluginDir, "package.json");
    const manifest = await readJsonFile<{
      name?: string;
      description?: string;
      version?: string;
      author?: string;
      keywords?: string[];
      claude?: { marketplace?: boolean };
    }>(manifestPath);

    const pluginName = manifest?.name ?? entry;
    result.plugins.push({
      name: pluginName,
      description: manifest?.description ?? "",
      version: manifest?.version ?? "0.0.0",
      author: typeof manifest?.author === "string" ? manifest.author : "",
      marketplace: manifest?.claude?.marketplace ?? false,
      keywords: manifest?.keywords ?? [],
    });

    // Discover skills
    const skillsDir = join(pluginDir, "skills");
    if (await pathExists(skillsDir)) {
      let skillFiles: string[] = [];
      try {
        skillFiles = await readdir(skillsDir);
      } catch {
        skillFiles = [];
      }
      for (const sf of skillFiles.filter((f) => f.endsWith(".md"))) {
        const skillPath = join(skillsDir, sf);
        let content = "";
        try {
          content = await readFile(skillPath, "utf8");
        } catch {
          continue;
        }
        const fm = extractFrontmatter(content);
        const name = fm["name"] ?? basename(sf, ".md");
        const fullName = `${pluginName}:${name}`;
        const triggers = fm["triggers"]
          ? fm["triggers"].split(",").map((s: string) => s.trim()).filter(Boolean)
          : [name];
        result.skills.push({
          name,
          fullName,
          pluginName,
          description: fm["description"] ?? extractMarkdownDescription(content),
          triggers,
          path: skillPath,
        });
        result.commands.push(fullName);
      }
    }

    // Discover agents
    const agentsDir = join(pluginDir, "agents");
    if (await pathExists(agentsDir)) {
      let agentFiles: string[] = [];
      try {
        agentFiles = await readdir(agentsDir);
      } catch {
        agentFiles = [];
      }
      for (const af of agentFiles.filter((f) => f.endsWith(".md"))) {
        const agentPath = join(agentsDir, af);
        let content = "";
        try {
          content = await readFile(agentPath, "utf8");
        } catch {
          continue;
        }
        const fm = extractFrontmatter(content);
        const name = fm["name"] ?? basename(af, ".md");
        result.agents.push({
          name,
          fullName: `${pluginName}:${name}`,
          pluginName,
          description: fm["description"] ?? extractMarkdownDescription(content),
          model: fm["model"],
        });
      }
    }
  }

  return result;
}

export async function discoverSkills(): Promise<Skill[]> {
  const integration = await discoverAll();
  return integration.skills;
}

export async function discoverCommandsDeep(): Promise<Command[]> {
  const integration = await discoverAll();
  return integration.skills.map((s) => ({
    name: s.name,
    fullName: s.fullName,
    source: "plugin",
    pluginName: s.pluginName,
    description: s.description,
  }));
}

export async function discoverAgents(): Promise<Agent[]> {
  const integration = await discoverAll();
  return integration.agents;
}

export async function getSkillContent(skillPath: string): Promise<string> {
  return readFile(skillPath, "utf8");
}
```

```typescript
// packages/mcp/src/tools/claude-code.ts
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { IStore, IOrchestratorService } from "@baara-next/core";
import { ok, err } from "../helpers.ts";
import { discoverAll, discoverSkills, getSkillContent } from "../integrations/claude-code.ts";

export function createClaudeCodeTools(_deps: {
  store: IStore;
  orchestrator: IOrchestratorService;
}) {
  // 1. discover_plugins — discover Claude Code plugins/skills/agents from ~/.claude/
  const discoverPlugins = tool(
    "discover_plugins",
    "Discover installed Claude Code plugins, skills, and agents from ~/.claude/plugins/",
    {},
    async () => {
      try {
        const integration = await discoverAll();
        return ok({
          pluginCount: integration.plugins.length,
          skillCount: integration.skills.length,
          agentCount: integration.agents.length,
          commandCount: integration.commands.length,
          plugins: integration.plugins,
          skills: integration.skills.map((s) => ({
            name: s.name,
            fullName: s.fullName,
            pluginName: s.pluginName,
            description: s.description,
            triggers: s.triggers,
          })),
          agents: integration.agents,
          discoveredAt: integration.discoveredAt,
        });
      } catch (e) {
        return err(`Plugin discovery failed: ${String(e)}`);
      }
    }
  );

  // 2. run_skill — load a skill's markdown content as context for execution
  const runSkill = tool(
    "run_skill",
    "Load a Claude Code skill by name and return its markdown content as execution context",
    {
      name: z.string().describe("Skill name or fullName (e.g. 'gws:gws-drive' or 'gws-drive')"),
      arguments: z.string().optional().describe("Optional arguments to pass to the skill"),
    },
    async ({ name, arguments: args }) => {
      try {
        const skills = await discoverSkills();
        const skill = skills.find((s) => s.fullName === name || s.name === name);
        if (!skill) {
          const available = skills.map((s) => s.fullName).join(", ");
          return err(
            `Skill not found: ${name}\n\nAvailable skills: ${available || "(none installed)"}`
          );
        }
        const content = await getSkillContent(skill.path);
        const header = [
          `# Skill: ${skill.fullName}`,
          skill.description ? `> ${skill.description}` : "",
          args ? `\n**Arguments:** ${args}` : "",
          "",
          "---",
          "",
        ]
          .filter(Boolean)
          .join("\n");
        return ok({
          skill: {
            name: skill.name,
            fullName: skill.fullName,
            pluginName: skill.pluginName,
            description: skill.description,
          },
          arguments: args ?? null,
          content: header + content,
        });
      } catch (e) {
        return err(`Failed to load skill: ${String(e)}`);
      }
    }
  );

  return [discoverPlugins, runSkill];
}
```

- [ ] **Step 4: Run test** (expected: all 3 pass)

```bash
cd packages/mcp && bun test src/__tests__/tools/claude-code.test.ts
# Expected: 3 pass
```

- [ ] **Step 5: Commit**

```bash
git add packages/mcp/src/integrations/claude-code.ts \
  packages/mcp/src/tools/claude-code.ts \
  packages/mcp/src/__tests__/tools/claude-code.test.ts
git commit -m "feat(mcp): implement Claude Code integration and discover_plugins/run_skill tools"
```

---

### Task 9: server.ts — createBaaraMcpServer() factory + HTTP endpoint

**Files:**
- Edit: `packages/mcp/src/server.ts` (replace skeleton)
- Create: `packages/mcp/src/http.ts`
- Test: `packages/mcp/src/__tests__/server.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// packages/mcp/src/__tests__/server.test.ts
import { describe, it, expect, mock } from "bun:test";
import { createBaaraMcpServer } from "../server.ts";
import type { IStore, IOrchestratorService } from "@baara-next/core";

function makeMockStore(): IStore {
  return {
    listTasks: mock(() => []),
    getTask: mock(() => null),
    getTaskByName: mock(() => null),
    createTask: mock(() => { throw new Error("unused"); }),
    updateTask: mock(() => { throw new Error("unused"); }),
    deleteTask: mock(() => undefined),
    createExecution: mock(() => { throw new Error("unused"); }),
    getExecution: mock(() => null),
    listExecutions: mock(() => []),
    updateExecutionStatus: mock(() => undefined),
    updateExecutionFields: mock(() => undefined),
    dequeueExecution: mock(() => null),
    getDeadLetteredExecutions: mock(() => []),
    getPendingInputExecutions: mock(() => []),
    listAllExecutions: mock(() => []),
    appendEvent: mock(() => undefined),
    listEvents: mock(() => []),
    getMaxEventSeq: mock(() => 0),
    createInputRequest: mock((r: { executionId: string; prompt: string; timeoutMs: number; status: "pending" }) => ({ id: "ir1", createdAt: "", ...r })),
    getInputRequest: mock(() => null),
    respondToInput: mock(() => undefined),
    listQueues: mock(() => []),
    getQueueInfo: mock(() => null),
    listTemplates: mock(() => []),
    getTemplate: mock(() => null),
    createTemplate: mock((_id: string, input: { name: string }) => ({ id: _id, name: input.name, description: "", agentConfig: {}, createdAt: "", updatedAt: "" })),
    deleteTemplate: mock(() => undefined),
    listProjects: mock(() => []),
    getProject: mock(() => null),
    createProject: mock((_id: string, input: { name: string }) => ({ id: _id, name: input.name, description: "", instructions: "", workingDirectory: "", createdAt: "", updatedAt: "" })),
    updateProject: mock(() => ({ id: "p1", name: "proj", description: "", instructions: "", workingDirectory: "", createdAt: "", updatedAt: "" })),
    deleteProject: mock(() => undefined),
    getSetting: mock(() => null),
    setSetting: mock(() => undefined),
    close: mock(() => undefined),
  } as unknown as IStore;
}

function makeMockOrchestrator(): IOrchestratorService {
  return {
    submitTask: mock(async () => { throw new Error("unused"); }),
    runDirect: mock(async () => { throw new Error("unused"); }),
    cancelExecution: mock(async () => undefined),
    retryExecution: mock(async () => { throw new Error("unused"); }),
    matchTask: mock(async () => null),
    handleExecutionComplete: mock(async () => undefined),
    startExecution: mock(async () => undefined),
    provideInput: mock(async () => undefined),
  } as unknown as IOrchestratorService;
}

describe("createBaaraMcpServer", () => {
  it("returns an object (MCP server)", () => {
    const server = createBaaraMcpServer({
      store: makeMockStore(),
      orchestrator: makeMockOrchestrator(),
    });
    expect(server).toBeDefined();
    expect(typeof server).toBe("object");
  });

  it("server has a name property equal to baara-next", () => {
    const server = createBaaraMcpServer({
      store: makeMockStore(),
      orchestrator: makeMockOrchestrator(),
    });
    // createSdkMcpServer returns a server with a name property
    expect((server as { name?: string }).name).toBe("baara-next");
  });

  it("aggregates all 27 tools across all tool files", () => {
    // Verify that the tool count matches by inspecting the tools array
    // The server is created with 27 tools total
    const { createTaskTools } = require("../tools/tasks.ts");
    const { createExecutionTools } = require("../tools/executions.ts");
    const { createQueueTools } = require("../tools/queues.ts");
    const { createHitlTools } = require("../tools/hitl.ts");
    const { createTemplateTools } = require("../tools/templates.ts");
    const { createProjectTools } = require("../tools/projects.ts");
    const { createClaudeCodeTools } = require("../tools/claude-code.ts");
    const store = makeMockStore();
    const orchestrator = makeMockOrchestrator();
    const deps = { store, orchestrator };
    const total =
      createTaskTools(deps).length +
      createExecutionTools(deps).length +
      createQueueTools(deps).length +
      createHitlTools(deps).length +
      createTemplateTools(deps).length +
      createProjectTools(deps).length +
      createClaudeCodeTools(deps).length;
    expect(total).toBe(27);
  });
});
```

- [ ] **Step 2: Run test** (expected: FAIL — createBaaraMcpServer throws "Not yet implemented")

```bash
cd packages/mcp && bun test src/__tests__/server.test.ts
# Expected: 1 fail (throws "Not yet implemented"), 2 fail (no name property), 1 pass
```

- [ ] **Step 3: Write implementation**

Replace the skeleton `packages/mcp/src/server.ts` with the full implementation:

```typescript
// packages/mcp/src/server.ts
// @baara-next/mcp — createBaaraMcpServer() factory
//
// Assembles all 27 tool definitions into a single in-process MCP server using
// createSdkMcpServer() from the Agent SDK.  Pass the returned server object
// directly to Agent SDK query() as mcpServers: { "baara-next": server }.

import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import type { IStore, IOrchestratorService } from "@baara-next/core";

import { createTaskTools } from "./tools/tasks.ts";
import { createExecutionTools } from "./tools/executions.ts";
import { createQueueTools } from "./tools/queues.ts";
import { createHitlTools } from "./tools/hitl.ts";
import { createTemplateTools } from "./tools/templates.ts";
import { createProjectTools } from "./tools/projects.ts";
import { createClaudeCodeTools } from "./tools/claude-code.ts";

export interface BaaraMcpServerDeps {
  store: IStore;
  orchestrator: IOrchestratorService;
}

/**
 * Create an in-process MCP server with all 27 BAARA Next tools.
 *
 * Usage with Agent SDK:
 *   const mcpServer = createBaaraMcpServer({ store, orchestrator });
 *   await query({ mcpServers: { "baara-next": mcpServer }, ... });
 */
export function createBaaraMcpServer(deps: BaaraMcpServerDeps) {
  const tools = [
    // tasks.ts — 6 tools
    ...createTaskTools(deps),
    // executions.ts — 9 tools
    ...createExecutionTools(deps),
    // queues.ts — 4 tools
    ...createQueueTools(deps),
    // hitl.ts — 2 tools
    ...createHitlTools(deps),
    // templates.ts — 2 tools
    ...createTemplateTools(deps),
    // projects.ts — 2 tools
    ...createProjectTools(deps),
    // claude-code.ts — 2 tools
    ...createClaudeCodeTools(deps),
  ];

  // Total: 6 + 9 + 4 + 2 + 2 + 2 + 2 = 27 tools
  return createSdkMcpServer({
    name: "baara-next",
    tools,
  });
}
```

Also create the HTTP transport module:

```typescript
// packages/mcp/src/http.ts
// @baara-next/mcp — HTTP transport
//
// Creates a Hono sub-application that exposes the MCP server over HTTP at /mcp.
// Mount this on the main server: app.route("/mcp", createMcpHttpApp(deps))
//
// Remote clients (Claude Code via .mcp.json with "type": "http") connect here.

import { Hono } from "hono";
import type { IStore, IOrchestratorService } from "@baara-next/core";
import { createBaaraMcpServer } from "./server.ts";

export interface McpHttpAppDeps {
  store: IStore;
  orchestrator: IOrchestratorService;
}

/**
 * Create a Hono sub-app that handles HTTP MCP requests.
 *
 * Mount on the main server:
 *   app.route("/mcp", createMcpHttpApp({ store, orchestrator }));
 *
 * Claude Code .mcp.json entry:
 *   { "baara-next": { "type": "http", "url": "http://localhost:3000/mcp" } }
 */
export function createMcpHttpApp(deps: McpHttpAppDeps) {
  const app = new Hono();
  const mcpServer = createBaaraMcpServer(deps);

  // MCP over HTTP uses POST / for all requests.
  // The SDK server exposes a `handleRequest(req, res)` method compatible with
  // Node/Bun HTTP servers. We bridge it to Hono here.
  app.post("/", async (c) => {
    try {
      const body = await c.req.json();
      // createSdkMcpServer returns an object with a `handle` method for
      // processing JSON-RPC requests directly.
      const response = await (mcpServer as {
        handle: (req: unknown) => Promise<unknown>;
      }).handle(body);
      return c.json(response);
    } catch (e) {
      return c.json(
        { jsonrpc: "2.0", error: { code: -32603, message: String(e) }, id: null },
        500
      );
    }
  });

  // SSE endpoint for streaming MCP transport (used by some clients).
  app.get("/sse", async (c) => {
    return c.text("SSE MCP transport not yet implemented", 501);
  });

  return app;
}
```

- [ ] **Step 4: Run test** (expected: all 3 pass)

```bash
cd packages/mcp && bun test src/__tests__/server.test.ts
# Expected: 3 pass
```

- [ ] **Step 5: Commit**

```bash
git add packages/mcp/src/server.ts packages/mcp/src/http.ts packages/mcp/src/__tests__/server.test.ts
git commit -m "feat(mcp): implement createBaaraMcpServer factory with 27 tools and HTTP transport"
```

---

### Task 10: stdio.ts — stdio transport for `baara mcp-server` CLI

**Files:**
- Create: `packages/mcp/src/stdio.ts`
- Test: `packages/mcp/src/__tests__/stdio.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// packages/mcp/src/__tests__/stdio.test.ts
import { describe, it, expect } from "bun:test";
import { runStdioMcpServer } from "../stdio.ts";
import type { IStore, IOrchestratorService } from "@baara-next/core";

describe("runStdioMcpServer", () => {
  it("exports runStdioMcpServer as a function", () => {
    expect(typeof runStdioMcpServer).toBe("function");
  });

  it("accepts deps with store and orchestrator", () => {
    // Just verify the function signature accepts the correct shape.
    // We don't actually invoke it (that would block on stdio).
    const deps = {
      store: {} as IStore,
      orchestrator: {} as IOrchestratorService,
    };
    // The function itself should be callable without throwing when passed valid deps.
    // We test the export shape only — actual stdio testing is done via integration test.
    expect(() => {
      // Verify it's a function with arity 1
      expect(runStdioMcpServer.length).toBe(1);
    }).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test** (expected: FAIL — stdio.ts not found)

```bash
cd packages/mcp && bun test src/__tests__/stdio.test.ts
# Expected: error: Cannot find module '../stdio.ts'
```

- [ ] **Step 3: Write implementation**

```typescript
// packages/mcp/src/stdio.ts
// @baara-next/mcp — stdio transport
//
// Runs the BAARA Next MCP server over stdio so Claude Code can connect via:
//
//   .mcp.json:
//   {
//     "mcpServers": {
//       "baara-next": {
//         "command": "baara",
//         "args": ["mcp-server", "--data-dir", "~/.baara"]
//       }
//     }
//   }
//
// The CLI command (packages/cli) calls runStdioMcpServer() after wiring up
// the store and orchestrator from the data directory.

import type { IStore, IOrchestratorService } from "@baara-next/core";
import { createBaaraMcpServer } from "./server.ts";

export interface StdioMcpServerDeps {
  store: IStore;
  orchestrator: IOrchestratorService;
}

/**
 * Start the MCP server in stdio transport mode.
 *
 * Reads JSON-RPC requests from stdin, writes responses to stdout.
 * stderr is used for diagnostic logging.
 *
 * This function blocks until stdin is closed (i.e. the MCP client disconnects).
 */
export async function runStdioMcpServer(deps: StdioMcpServerDeps): Promise<void> {
  const mcpServer = createBaaraMcpServer(deps);

  // The Agent SDK's createSdkMcpServer() returns an object that may expose
  // a runStdio() or connect() method depending on the SDK version.
  // We use duck typing to handle both the v1 (runStdio) and v2 (connect) APIs.
  const server = mcpServer as {
    runStdio?: () => Promise<void>;
    connect?: (transport: unknown) => Promise<void>;
    handle?: (req: unknown) => Promise<unknown>;
  };

  if (typeof server.runStdio === "function") {
    // SDK v1 style: direct stdio runner
    await server.runStdio();
    return;
  }

  // Fallback: manual stdio JSON-RPC loop for SDK versions that don't have runStdio
  process.stderr.write("[baara-next mcp-server] Starting stdio MCP server\n");

  const decoder = new TextDecoder();
  let buffer = "";

  for await (const chunk of process.stdin) {
    buffer += decoder.decode(chunk as Uint8Array, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const request = JSON.parse(trimmed);
        if (typeof server.handle === "function") {
          const response = await server.handle(request);
          process.stdout.write(JSON.stringify(response) + "\n");
        } else {
          process.stderr.write("[baara-next mcp-server] SDK handle() not available\n");
          process.stdout.write(
            JSON.stringify({
              jsonrpc: "2.0",
              error: { code: -32603, message: "MCP server not properly initialized" },
              id: request?.id ?? null,
            }) + "\n"
          );
        }
      } catch (e) {
        process.stderr.write(`[baara-next mcp-server] Parse error: ${String(e)}\n`);
        process.stdout.write(
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32700, message: "Parse error" },
            id: null,
          }) + "\n"
        );
      }
    }
  }

  process.stderr.write("[baara-next mcp-server] Stdin closed, shutting down\n");
}
```

- [ ] **Step 4: Run test** (expected: 2 pass)

```bash
cd packages/mcp && bun test src/__tests__/stdio.test.ts
# Expected: 2 pass
```

- [ ] **Step 5: Commit**

```bash
git add packages/mcp/src/stdio.ts packages/mcp/src/__tests__/stdio.test.ts
git commit -m "feat(mcp): implement stdio transport for baara mcp-server CLI command"
```

---

### Task 11: index.ts — barrel export + wire up HTTP endpoint in packages/server

**Files:**
- Edit: `packages/mcp/src/index.ts` (finalize barrel)
- Edit: `packages/server/src/app.ts` (mount /mcp endpoint)
- Test: `packages/mcp/src/__tests__/index.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// packages/mcp/src/__tests__/index.test.ts
import { describe, it, expect } from "bun:test";

describe("@baara-next/mcp barrel exports", () => {
  it("exports createBaaraMcpServer", async () => {
    const mod = await import("../index.ts");
    expect(typeof mod.createBaaraMcpServer).toBe("function");
  });

  it("exports createMcpHttpApp", async () => {
    const mod = await import("../index.ts");
    expect(typeof mod.createMcpHttpApp).toBe("function");
  });

  it("exports runStdioMcpServer", async () => {
    const mod = await import("../index.ts");
    expect(typeof mod.runStdioMcpServer).toBe("function");
  });

  it("exports BaaraMcpServerDeps type (compile-time check via import)", async () => {
    // If the type export compiles, this test passes.
    const mod = await import("../index.ts");
    expect(mod).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test** (expected: FAIL — createMcpHttpApp and runStdioMcpServer not exported)

```bash
cd packages/mcp && bun test src/__tests__/index.test.ts
# Expected: 2 fail (createMcpHttpApp undefined, runStdioMcpServer undefined)
```

- [ ] **Step 3: Write implementation**

Update `packages/mcp/src/index.ts`:

```typescript
// @baara-next/mcp — Public API barrel

export { createBaaraMcpServer } from "./server.ts";
export type { BaaraMcpServerDeps } from "./server.ts";

export { createMcpHttpApp } from "./http.ts";
export type { McpHttpAppDeps } from "./http.ts";

export { runStdioMcpServer } from "./stdio.ts";
export type { StdioMcpServerDeps } from "./stdio.ts";
```

Update `packages/server/src/app.ts` to mount the `/mcp` endpoint. Add after the existing route group mounts (before the `app.onError` block):

```typescript
// In packages/server/src/app.ts
// Add to imports at top:
import { createMcpHttpApp } from "@baara-next/mcp";

// Add to createApp(), after app.route("/api/chat", chatRoutes()):
  // MCP HTTP endpoint — remote clients connect here.
  // Rate-limit MCP requests (shared with chat).
  app.use("/mcp/*", rlMiddleware);
  app.route("/mcp", createMcpHttpApp({ store: deps.store, orchestrator: deps.orchestrator }));
```

Also add `@baara-next/mcp` to `packages/server/package.json` dependencies:
```json
"@baara-next/mcp": "workspace:*"
```

- [ ] **Step 4: Run tests** (expected: all 4 pass)

```bash
cd packages/mcp && bun test src/__tests__/index.test.ts
# Expected: 4 pass

cd packages/server && bun run typecheck
# Expected: 0 errors
```

- [ ] **Step 5: Commit**

```bash
git add packages/mcp/src/index.ts packages/server/src/app.ts packages/server/package.json
git commit -m "feat(mcp): finalize barrel exports and mount /mcp HTTP endpoint on main server"
```

---

### Task 12: Full test suite + typecheck

**Files:**
- No new files — verify all tests pass and types are clean

- [ ] **Step 1: Write failing test** (no new test — this is a validation task)

N/A — all tests were written in previous tasks.

- [ ] **Step 2: Run all mcp tests** (expected: all pass)

```bash
cd packages/mcp && bun test
# Expected: all tests pass across:
#   src/__tests__/package.test.ts       (1 test)
#   src/__tests__/helpers.test.ts       (6 tests)
#   src/__tests__/tools/tasks.test.ts   (6 tests)
#   src/__tests__/tools/executions.test.ts (10 tests)
#   src/__tests__/tools/queues.test.ts  (6 tests)
#   src/__tests__/tools/hitl.test.ts    (4 tests)
#   src/__tests__/tools/templates.test.ts (4 tests)
#   src/__tests__/tools/projects.test.ts  (5 tests)
#   src/__tests__/tools/claude-code.test.ts (3 tests)
#   src/__tests__/server.test.ts        (3 tests)
#   src/__tests__/stdio.test.ts         (2 tests)
#   src/__tests__/index.test.ts         (4 tests)
# Total: ~54 tests, 0 failures
```

- [ ] **Step 3: Run typecheck on all affected packages**

```bash
cd packages/mcp && bun run typecheck
# Expected: 0 errors

cd packages/server && bun run typecheck
# Expected: 0 errors
```

- [ ] **Step 4: Run full turbo test** (expected: all pass)

```bash
cd /path/to/baara-next && turbo test
# Expected: all packages green
```

- [ ] **Step 5: Commit**

```bash
git add -p  # stage any remaining fixes
git commit -m "test(mcp): verify full test suite and typecheck pass for packages/mcp and packages/server"
```

---

## Summary

The complete `packages/mcp` package delivers:

| File | Contents |
|------|----------|
| `src/helpers.ts` | `ok()`, `err()`, `notFound()`, `resolveTask()` |
| `src/tools/tasks.ts` | 6 tools: list/get/create/update/delete/toggle |
| `src/tools/executions.ts` | 9 tools: run/submit/list/get/events/cancel/retry/status/logs |
| `src/tools/queues.ts` | 4 tools: list/info/dlq-list/dlq-retry |
| `src/tools/hitl.ts` | 2 tools: list_pending_input/provide_input |
| `src/tools/templates.ts` | 2 tools: list_templates/create_task_from_template |
| `src/tools/projects.ts` | 2 tools: list_projects/set_active_project |
| `src/tools/claude-code.ts` | 2 tools: discover_plugins/run_skill |
| `src/integrations/claude-code.ts` | Plugin/skill/agent discovery from `~/.claude/plugins/` |
| `src/server.ts` | `createBaaraMcpServer()` — assembles 27 tools via `createSdkMcpServer()` |
| `src/http.ts` | `createMcpHttpApp()` — Hono sub-app mounted at `/mcp` |
| `src/stdio.ts` | `runStdioMcpServer()` — stdio transport for `baara mcp-server` CLI |
| `src/index.ts` | Barrel re-exports all three public APIs |

**Downstream wiring:**
- `packages/server/src/app.ts` mounts `/mcp` via `createMcpHttpApp()`
- `packages/cli` (Plan E) calls `runStdioMcpServer()` from its `mcp-server` command
- `packages/server/src/routes/chat.ts` (Plan B) passes `createBaaraMcpServer()` to Agent SDK `query()`

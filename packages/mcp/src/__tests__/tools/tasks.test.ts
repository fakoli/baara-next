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
    countExecutionsByStatus: mock(() => 0),
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
    ...overrides,
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
    const result = await (listTasks as { handler: (p: Record<string, never>, extra: unknown) => Promise<unknown> }).handler({}, null);
    const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].name).toBe("hello-task");
    expect(parsed[0].id).toBe("t1");
  });

  it("get_task returns task by name", async () => {
    const store = makeMockStore();
    const tools = createTaskTools({ store, orchestrator: makeMockOrchestrator() });
    const getTool = tools.find(t => (t as { name: string }).name === "get_task")!;
    const result = await (getTool as { handler: (p: { nameOrId: string }, extra: unknown) => Promise<unknown> }).handler({ nameOrId: "hello-task" }, null);
    const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
    expect(parsed.id).toBe("t1");
  });

  it("get_task returns error for unknown task", async () => {
    const store = makeMockStore();
    const tools = createTaskTools({ store, orchestrator: makeMockOrchestrator() });
    const getTool = tools.find(t => (t as { name: string }).name === "get_task")!;
    const result = await (getTool as { handler: (p: { nameOrId: string }, extra: unknown) => Promise<unknown> }).handler({ nameOrId: "nope" }, null);
    expect((result as { isError: boolean }).isError).toBe(true);
  });

  it("delete_task removes task by name", async () => {
    const store = makeMockStore();
    const tools = createTaskTools({ store, orchestrator: makeMockOrchestrator() });
    const deleteTool = tools.find(t => (t as { name: string }).name === "delete_task")!;
    const result = await (deleteTool as { handler: (p: { nameOrId: string }, extra: unknown) => Promise<unknown> }).handler({ nameOrId: "hello-task" }, null);
    const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
    expect(parsed.deleted).toBe(true);
    expect(store.deleteTask).toHaveBeenCalledWith("t1");
  });

  it("toggle_task flips enabled flag", async () => {
    const store = makeMockStore();
    const tools = createTaskTools({ store, orchestrator: makeMockOrchestrator() });
    const toggleTool = tools.find(t => (t as { name: string }).name === "toggle_task")!;
    const result = await (toggleTool as { handler: (p: { nameOrId: string }, extra: unknown) => Promise<unknown> }).handler({ nameOrId: "hello-task" }, null);
    const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
    expect(parsed.name).toBe("hello-task");
    expect(store.updateTask).toHaveBeenCalledWith("t1", { enabled: false });
  });

  it("createTaskTools returns 6 tools", () => {
    const tools = createTaskTools({ store: makeMockStore(), orchestrator: makeMockOrchestrator() });
    expect(tools).toHaveLength(6);
  });
});

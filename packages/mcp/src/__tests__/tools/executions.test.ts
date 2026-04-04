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
    countExecutionsByStatus: mock(() => 0),
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
    const result = await (runTool as { handler: (p: { nameOrId: string }, extra: unknown) => Promise<unknown> }).handler({ nameOrId: "my-task" }, null);
    expect(orchestrator.runDirect).toHaveBeenCalledWith("task-1");
    const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
    expect(parsed.status).toBe("completed");
  });

  it("submit_task calls orchestrator.submitTask and returns execution", async () => {
    const store = makeMockStore();
    const orchestrator = makeMockOrchestrator();
    const tools = createExecutionTools({ store, orchestrator });
    const submitTool = tools.find(t => (t as { name: string }).name === "submit_task")!;
    const result = await (submitTool as { handler: (p: { nameOrId: string }, extra: unknown) => Promise<unknown> }).handler({ nameOrId: "my-task" }, null);
    expect(orchestrator.submitTask).toHaveBeenCalledWith("task-1");
    const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
    expect(parsed.status).toBe("queued");
  });

  it("list_executions returns execution list for a task", async () => {
    const store = makeMockStore();
    const tools = createExecutionTools({ store, orchestrator: makeMockOrchestrator() });
    const listTool = tools.find(t => (t as { name: string }).name === "list_executions")!;
    const result = await (listTool as { handler: (p: { taskNameOrId: string }, extra: unknown) => Promise<unknown> }).handler({ taskNameOrId: "my-task" }, null);
    const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].id).toBe("exec-1");
  });

  it("get_execution returns execution by id", async () => {
    const store = makeMockStore();
    const tools = createExecutionTools({ store, orchestrator: makeMockOrchestrator() });
    const getTool = tools.find(t => (t as { name: string }).name === "get_execution")!;
    const result = await (getTool as { handler: (p: { executionId: string }, extra: unknown) => Promise<unknown> }).handler({ executionId: "exec-1" }, null);
    const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
    expect(parsed.id).toBe("exec-1");
  });

  it("get_execution returns error for unknown id", async () => {
    const store = makeMockStore();
    const tools = createExecutionTools({ store, orchestrator: makeMockOrchestrator() });
    const getTool = tools.find(t => (t as { name: string }).name === "get_execution")!;
    const result = await (getTool as { handler: (p: { executionId: string }, extra: unknown) => Promise<unknown> }).handler({ executionId: "missing" }, null);
    expect((result as { isError: boolean }).isError).toBe(true);
  });

  it("get_execution_events returns event list", async () => {
    const store = makeMockStore();
    const tools = createExecutionTools({ store, orchestrator: makeMockOrchestrator() });
    const eventsTool = tools.find(t => (t as { name: string }).name === "get_execution_events")!;
    const result = await (eventsTool as { handler: (p: { executionId: string }, extra: unknown) => Promise<unknown> }).handler({ executionId: "exec-1" }, null);
    const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].type).toBe("execution_started");
  });

  it("cancel_execution calls orchestrator.cancelExecution", async () => {
    const orchestrator = makeMockOrchestrator();
    const tools = createExecutionTools({ store: makeMockStore(), orchestrator });
    const cancelTool = tools.find(t => (t as { name: string }).name === "cancel_execution")!;
    await (cancelTool as { handler: (p: { executionId: string }, extra: unknown) => Promise<unknown> }).handler({ executionId: "exec-1" }, null);
    expect(orchestrator.cancelExecution).toHaveBeenCalledWith("exec-1");
  });

  it("retry_execution calls orchestrator.retryExecution", async () => {
    const orchestrator = makeMockOrchestrator();
    const tools = createExecutionTools({ store: makeMockStore(), orchestrator });
    const retryTool = tools.find(t => (t as { name: string }).name === "retry_execution")!;
    const result = await (retryTool as { handler: (p: { executionId: string }, extra: unknown) => Promise<unknown> }).handler({ executionId: "exec-1" }, null);
    expect(orchestrator.retryExecution).toHaveBeenCalledWith("exec-1");
    const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
    expect(parsed.attempt).toBe(2);
  });

  it("get_system_status returns system overview", async () => {
    const store = makeMockStore();
    const tools = createExecutionTools({ store, orchestrator: makeMockOrchestrator() });
    const statusTool = tools.find(t => (t as { name: string }).name === "get_system_status")!;
    const result = await (statusTool as { handler: (p: Record<string, never>, extra: unknown) => Promise<unknown> }).handler({}, null);
    const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
    expect(parsed).toHaveProperty("tasks");
    expect(parsed).toHaveProperty("queues");
    expect(parsed).toHaveProperty("deadLettered");
  });

  it("get_execution_logs returns entries array (Phase 5 API)", async () => {
    const store = makeMockStore();
    // No logsDir provided — falls back to output_field path.
    const tools = createExecutionTools({ store, orchestrator: makeMockOrchestrator() });
    const logsTool = tools.find(t => (t as { name: string }).name === "get_execution_logs")!;
    const result = await (logsTool as { handler: (p: { executionId: string }, extra: unknown) => Promise<unknown> }).handler({ executionId: "exec-1" }, null);
    const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
    expect(parsed).toHaveProperty("entries");
    expect(parsed).toHaveProperty("source", "output_field");
  });
});

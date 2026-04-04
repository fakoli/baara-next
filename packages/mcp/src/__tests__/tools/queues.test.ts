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
    countExecutionsByStatus: mock(() => 0),
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
    const result = await (listTool as { handler: (p: Record<string, never>, extra: unknown) => Promise<unknown> }).handler({}, null);
    const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].name).toBe("default");
    expect(parsed[0].depth).toBe(3);
  });

  it("get_queue_info returns detail for known queue", async () => {
    const tools = createQueueTools({ store: makeMockStore(), orchestrator: makeMockOrchestrator() });
    const infoTool = tools.find(t => (t as { name: string }).name === "get_queue_info")!;
    const result = await (infoTool as { handler: (p: { name: string }, extra: unknown) => Promise<unknown> }).handler({ name: "default" }, null);
    const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
    expect(parsed.name).toBe("default");
    expect(parsed.maxConcurrency).toBe(5);
  });

  it("get_queue_info returns error for unknown queue", async () => {
    const tools = createQueueTools({ store: makeMockStore(), orchestrator: makeMockOrchestrator() });
    const infoTool = tools.find(t => (t as { name: string }).name === "get_queue_info")!;
    const result = await (infoTool as { handler: (p: { name: string }, extra: unknown) => Promise<unknown> }).handler({ name: "missing" }, null);
    expect((result as { isError: boolean }).isError).toBe(true);
  });

  it("dlq_list returns dead-lettered executions", async () => {
    const tools = createQueueTools({ store: makeMockStore(), orchestrator: makeMockOrchestrator() });
    const dlqTool = tools.find(t => (t as { name: string }).name === "dlq_list")!;
    const result = await (dlqTool as { handler: (p: Record<string, never>, extra: unknown) => Promise<unknown> }).handler({}, null);
    const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].id).toBe("exec-dead-1");
    expect(parsed[0].error).toBe("max retries exceeded");
  });

  it("dlq_retry calls retryExecution and returns new execution", async () => {
    const orchestrator = makeMockOrchestrator();
    const tools = createQueueTools({ store: makeMockStore(), orchestrator });
    const retryTool = tools.find(t => (t as { name: string }).name === "dlq_retry")!;
    const result = await (retryTool as { handler: (p: { executionId: string }, extra: unknown) => Promise<unknown> }).handler({ executionId: "exec-dead-1" }, null);
    expect(orchestrator.retryExecution).toHaveBeenCalledWith("exec-dead-1");
    const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
    expect(parsed.attempt).toBe(4);
  });
});

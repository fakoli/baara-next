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
    countExecutionsByStatus: mock(() => 0),
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
    const result = await (listTool as { handler: (p: Record<string, never>, extra: unknown) => Promise<unknown> }).handler({}, null);
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
    const result = await (provideTool as { handler: (p: { executionId: string; response: string }, extra: unknown) => Promise<unknown> }).handler({
      executionId: "exec-wait-1",
      response: "yes",
    }, null);
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
    const result = await (provideTool as { handler: (p: { executionId: string; response: string }, extra: unknown) => Promise<unknown> }).handler({
      executionId: "nonexistent",
      response: "yes",
    }, null);
    expect((result as { isError: boolean }).isError).toBe(true);
  });
});

import { describe, it, expect, mock, beforeEach } from "bun:test";
import { OrchestratorService } from "../orchestrator-service.ts";
import type { IStore, Task, Execution, IMessageBus } from "@baara-next/core";

function makeStore(overrides: Partial<IStore> = {}): IStore {
  const task: Task = {
    id: "task-1",
    name: "t",
    description: "",
    prompt: "do work",
    timeoutMs: 300_000,
    executionType: "cloud_code",
    agentConfig: null,
    priority: 1,
    targetQueue: "transfer",
    maxRetries: 3,
    executionMode: "queued",
    enabled: true,
    projectId: null,
    cronExpression: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as unknown as Task;

  const execution: Execution = {
    id: "ex-crashed",
    taskId: "task-1",
    queueName: "transfer",
    priority: 1,
    status: "running",
    attempt: 1,
    scheduledAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    completedAt: null,
    durationMs: null,
    output: null,
    error: null,
    inputTokens: null,
    outputTokens: null,
    healthStatus: "unresponsive",
    turnCount: 7,
    createdAt: new Date().toISOString(),
    threadId: "thread-1",
  } as unknown as Execution;

  return {
    getTask: mock(() => task),
    getTaskByName: mock(() => null),
    getExecution: mock(() => execution),
    createExecution: mock((id: string) => ({ ...execution, id, attempt: 2 })),
    updateExecutionStatus: mock(() => {}),
    updateExecutionFields: mock(() => {}),
    listAllExecutions: mock(() => []),
    listQueues: mock(() => [{ name: "transfer", depth: 0, activeCount: 0, maxConcurrency: 10, createdAt: "" }]),
    dequeueExecution: mock(() => null),
    listEvents: mock(() => []),
    appendEvent: mock(() => {}),
    getMaxEventSeq: mock(() => 0),
    ...overrides,
  } as unknown as IStore;
}

function makeBus(hasCheckpoint = true): IMessageBus {
  const checkpoint = hasCheckpoint
    ? {
        id: "cp-1",
        executionId: "ex-crashed",
        turnCount: 5,
        conversationHistory: [],
        pendingToolCalls: [],
        agentState: {},
        timestamp: new Date().toISOString(),
      }
    : null;

  return {
    readLatestCheckpoint: mock(() => checkpoint),
    writeCheckpoint: mock(() => {}),
    sendCommand: mock(() => {}),
    readPendingCommands: mock(() => []),
    acknowledgeCommands: mock(() => {}),
    appendLog: mock(() => {}),
  } as unknown as IMessageBus;
}

describe("OrchestratorService.recoverExecution", () => {
  let store: ReturnType<typeof makeStore>;
  let bus: IMessageBus;
  let orchestrator: OrchestratorService;

  beforeEach(() => {
    store = makeStore();
    bus = makeBus();
    orchestrator = new OrchestratorService(store, undefined, bus);
  });

  it("transitions crashed execution to retry_scheduled", async () => {
    await orchestrator.recoverExecution("ex-crashed");
    expect(store.updateExecutionStatus).toHaveBeenCalledWith(
      "ex-crashed",
      "retry_scheduled",
      expect.anything()
    );
  });

  it("creates a new execution attempt", async () => {
    await orchestrator.recoverExecution("ex-crashed");
    expect(store.createExecution).toHaveBeenCalled();
  });

  it("reads the latest checkpoint from MessageBus", async () => {
    await orchestrator.recoverExecution("ex-crashed");
    expect(bus.readLatestCheckpoint).toHaveBeenCalledWith("ex-crashed");
  });

  it("works without a MessageBus — falls back to plain re-enqueue", async () => {
    const orch = new OrchestratorService(store);
    await orch.recoverExecution("ex-crashed");
    expect(store.createExecution).toHaveBeenCalled();
  });
});

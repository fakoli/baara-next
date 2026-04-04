import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { HealthMonitor } from "../health-monitor.ts";
import type { IStore, Execution, Task } from "@baara-next/core";

function makeExecution(overrides: Partial<Execution> = {}): Execution {
  const startedAt = new Date(Date.now() - 120_000).toISOString(); // 2 minutes ago
  return {
    id: "ex-1",
    taskId: "task-1",
    queueName: "transfer",
    priority: 1,
    status: "running",
    attempt: 1,
    scheduledAt: startedAt,
    startedAt,
    completedAt: null,
    durationMs: null,
    output: null,
    error: null,
    inputTokens: null,
    outputTokens: null,
    healthStatus: "healthy",
    turnCount: 3,
    createdAt: startedAt,
    ...overrides,
  } as unknown as Execution;
}

function makeTask(timeoutMs = 300_000): Task {
  return {
    id: "task-1",
    name: "test",
    description: "",
    prompt: "do stuff",
    timeoutMs,
    executionType: "cloud_code",
    agentConfig: null,
    priority: 1,
    targetQueue: "transfer",
    maxRetries: 0,
    executionMode: "queued",
    enabled: true,
    projectId: null,
    cronExpression: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as unknown as Task;
}

describe("HealthMonitor recovery callback", () => {
  let store: IStore;
  let onCrashDetected: ReturnType<typeof mock>;
  let monitor: HealthMonitor;

  beforeEach(() => {
    const execution = makeExecution();
    store = {
      listAllExecutions: mock(() => [execution]),
      getTask: mock(() => makeTask()),
      updateExecutionFields: mock(() => {}),
    } as unknown as IStore;

    onCrashDetected = mock((_executionId: string) => {});
    monitor = new HealthMonitor(store, 10_000, onCrashDetected);
  });

  afterEach(() => monitor.stop());

  it("does NOT call onCrashDetected when elapsed < timeout", () => {
    // execution started 1 min ago, timeout is 5 min — not stale
    (store.listAllExecutions as ReturnType<typeof mock>).mockReturnValueOnce([
      makeExecution({ startedAt: new Date(Date.now() - 60_000).toISOString() }),
    ]);
    (monitor as unknown as { check(): void }).check();
    expect(onCrashDetected).not.toHaveBeenCalled();
  });

  it("calls onCrashDetected when elapsed > timeout AND execution is running", () => {
    // execution started 6 min ago, timeout is 5 min — stale
    (store.listAllExecutions as ReturnType<typeof mock>).mockReturnValueOnce([
      makeExecution({ startedAt: new Date(Date.now() - 360_000).toISOString() }),
    ]);
    (monitor as unknown as { check(): void }).check();
    expect(onCrashDetected).toHaveBeenCalledWith("ex-1");
  });

  it("does NOT call onCrashDetected when healthStatus is already unresponsive", () => {
    (store.listAllExecutions as ReturnType<typeof mock>).mockReturnValueOnce([
      makeExecution({
        startedAt: new Date(Date.now() - 360_000).toISOString(),
        healthStatus: "unresponsive",
      }),
    ]);
    (monitor as unknown as { check(): void }).check();
    // Still sets health but does not call the recovery callback again
    expect(onCrashDetected).not.toHaveBeenCalled();
  });
});

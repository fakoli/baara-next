// @baara-next/orchestrator — OrchestratorService
//
// Implements IOrchestratorService from @baara-next/core.
// This is the top-level coordinator: it creates executions, routes them to
// queues, assigns them to agents, and handles completions, retries, and
// cancellations.
//
// All public methods are async (even when the underlying store call is
// synchronous) so the interface is uniform for both in-process and HTTP
// transport layers.

import type {
  IOrchestratorService,
  IStore,
  IMessageBus,
  RuntimeCapability,
  Task,
  Execution,
} from "@baara-next/core";
import type { TaskAssignment } from "@baara-next/core";
import type { ExecuteResult } from "@baara-next/core";
import type { RuntimeRegistry, SandboxRegistry } from "@baara-next/executor";
import { homedir } from "node:os";
import {
  TaskNotFoundError,
  ExecutionNotFoundError,
  InvalidStateTransitionError,
  isTerminal,
  MAIN_THREAD_ID,
} from "@baara-next/core";
import { QueueManager } from "./queue-manager.ts";
import { HealthMonitor } from "./health-monitor.ts";
import { Scheduler } from "./scheduler.ts";
import { shouldRetry, calculateDelay, scheduleRetry, routeToDlq } from "./retry.ts";
import {
  emitExecutionCreated,
  emitExecutionQueued,
  emitExecutionAssigned,
  emitExecutionStarted,
  emitTerminalFromResult,
  emitExecutionCancelled,
  emitInputRequested,
  emitInputProvided,
} from "./event-handler.ts";

// ---------------------------------------------------------------------------
// OrchestratorService
// ---------------------------------------------------------------------------

export class OrchestratorService implements IOrchestratorService {
  private readonly queueManager: QueueManager;
  private readonly healthMonitor: HealthMonitor;
  private readonly scheduler: Scheduler;

  constructor(
    private readonly store: IStore,
    private readonly runtimeRegistry?: RuntimeRegistry,
    private readonly messageBus?: IMessageBus,
    private readonly sandboxRegistry?: SandboxRegistry,
  ) {
    this.queueManager = new QueueManager(store);
    this.healthMonitor = new HealthMonitor(store, 10_000, (executionId) => {
      void this.recoverExecution(executionId);
    });
    this.scheduler = new Scheduler(store, this.queueManager);
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Start background workers: health monitor, scheduler.
   * QueueManager is event-driven and has no start/stop lifecycle.
   * Idempotent — safe to call multiple times.
   */
  start(): void {
    this.healthMonitor.start();
    this.scheduler.startAll();
  }

  /**
   * Stop all background workers gracefully.
   */
  stop(): void {
    this.queueManager.cancelAllTimers();
    this.healthMonitor.stop();
    this.scheduler.stop();
  }

  /**
   * Register a listener for batched visibility updates emitted by the
   * QueueManager every second.
   *
   * The callback receives an array of `{ executionId, status }` pairs that
   * represent state changes since the last flush.  Pass this to the WebSocket
   * broadcast layer so connected clients stay up-to-date in near-real-time.
   */
  onVisibilityBatch(
    listener: (batch: Array<{ executionId: string; status: string }>) => void
  ): void {
    this.queueManager.on("visibility-batch", listener);
  }

  // ---------------------------------------------------------------------------
  // IOrchestratorService implementation
  // ---------------------------------------------------------------------------

  async submitTask(taskId: string): Promise<Execution> {
    const task = this._requireTask(taskId);

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    this.store.createExecution(
      id,
      task.id,
      task.targetQueue,
      task.priority,
      now
    );

    // Transition created → queued
    this.store.updateExecutionStatus(id, "queued");

    // Emit events
    emitExecutionCreated(this.store, id, task.id, task.targetQueue, 1);
    emitExecutionQueued(this.store, id, task.targetQueue);

    // Notify queue manager
    this.queueManager.enqueue(task.targetQueue, id);

    return this.store.getExecution(id)!;
  }

  async runDirect(taskId: string): Promise<Execution> {
    const task = this._requireTask(taskId);

    // Prefer SandboxRegistry (Phase 5) over RuntimeRegistry (legacy).
    if (this.sandboxRegistry) {
      return this._runDirectViaSandbox(task);
    }

    if (!this.runtimeRegistry) {
      throw new Error(
        "runDirect requires a RuntimeRegistry or SandboxRegistry — " +
          "pass one to OrchestratorService"
      );
    }

    const runtime = this.runtimeRegistry.getForTask(task);

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    // Transition through the required path: created → queued → assigned → running.
    this.store.createExecution(
      id,
      task.id,
      task.targetQueue,
      task.priority,
      now
    );

    emitExecutionCreated(this.store, id, task.id, task.targetQueue, 1);

    this.store.updateExecutionStatus(id, "queued");
    emitExecutionQueued(this.store, id, task.targetQueue);

    this.store.updateExecutionStatus(id, "assigned");
    emitExecutionAssigned(this.store, id, "direct");

    this.store.updateExecutionStatus(id, "running", {
      startedAt: new Date().toISOString(),
    });

    // Execute via the runtime obtained from the registry.
    let result: ExecuteResult;
    try {
      result = await runtime.execute({
        executionId: id,
        task,
        timeout: task.timeoutMs,
      });
    } catch (err) {
      result = {
        status: "failed",
        error: String(err),
        durationMs: Date.now() - new Date(now).getTime(),
      };
    }

    await this.handleExecutionComplete(id, result);
    return this.store.getExecution(id)!;
  }

  private async _runDirectViaSandbox(task: Task): Promise<Execution> {
    const sandbox = this.sandboxRegistry!.getForTask(
      task as Task & { sandboxType?: string }
    );

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    this.store.createExecution(id, task.id, task.targetQueue, task.priority, now);
    emitExecutionCreated(this.store, id, task.id, task.targetQueue, 1);
    this.store.updateExecutionStatus(id, "queued");
    emitExecutionQueued(this.store, id, task.targetQueue);
    this.store.updateExecutionStatus(id, "assigned");
    emitExecutionAssigned(this.store, id, "direct");
    this.store.updateExecutionStatus(id, "running", { startedAt: now });

    const agentConfig =
      (task as Task & { agentConfig?: Record<string, unknown> }).agentConfig ?? {};
    const rawSandboxConfig = (
      task as Task & { sandboxConfig?: { type: string } }
    ).sandboxConfig;
    const sandboxConfig: import("@baara-next/core").SandboxConfig =
      rawSandboxConfig != null
        ? (rawSandboxConfig as import("@baara-next/core").SandboxConfig)
        : task.executionType === "wasm"
        ? { type: "wasm" }
        : { type: "native" };

    const dataDir =
      process.env["BAARA_DATA_DIR"] ??
      homedir() + "/.baara";

    let instance: import("@baara-next/core").SandboxInstance | undefined;
    let result: ExecuteResult;

    try {
      instance = await sandbox.start({
        executionId: id,
        sandboxConfig,
        agentConfig: agentConfig as import("@baara-next/core").AgentConfig,
        dataDir,
      });

      // Load checkpoint if execution was recovered.
      const execution = this.store.getExecution(id)!;
      const checkpoint =
        execution.checkpointData != null
          ? (JSON.parse(execution.checkpointData as string) as import("@baara-next/core").Checkpoint)
          : undefined;

      const sandboxResult = await instance.execute({
        executionId: id,
        prompt: task.prompt,
        tools:
          (agentConfig as { allowedTools?: string[] }).allowedTools ?? [],
        agentConfig: agentConfig as import("@baara-next/core").AgentConfig,
        checkpoint,
        timeout: task.timeoutMs,
      });

      // SandboxExecuteResult is structurally compatible with ExecuteResult.
      result = sandboxResult as ExecuteResult;
    } catch (err) {
      result = {
        status: "failed",
        error: String(err),
        durationMs: Date.now() - new Date(now).getTime(),
      };
    } finally {
      if (instance) {
        await sandbox.stop(instance).catch(() => {});
      }
    }

    await this.handleExecutionComplete(id, result);
    return this.store.getExecution(id)!;
  }

  async cancelExecution(executionId: string): Promise<void> {
    const execution = this.store.getExecution(executionId);
    if (!execution) throw new ExecutionNotFoundError(executionId);

    if (isTerminal(execution.status)) {
      throw new InvalidStateTransitionError(
        execution.status,
        "cancelled",
        executionId
      );
    }

    // If there is a pending retry timer, cancel it before updating status so
    // the timer callback cannot re-enqueue the execution after cancellation.
    this.queueManager.cancelTimer(executionId);
    this.store.updateExecutionStatus(executionId, "cancelled");
    emitExecutionCancelled(this.store, executionId, "operator requested cancellation");
    this.queueManager.enqueueVisibility(executionId, "cancelled");
  }

  async retryExecution(executionId: string): Promise<Execution> {
    const execution = this.store.getExecution(executionId);
    if (!execution) throw new ExecutionNotFoundError(executionId);

    const retryable = ["failed", "timed_out", "dead_lettered"];
    if (!retryable.includes(execution.status)) {
      throw new InvalidStateTransitionError(execution.status, "retry_scheduled", executionId);
    }

    const task = this._requireTask(execution.taskId);

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const nextAttempt = execution.attempt + 1;

    const newExecution = this.store.createExecution(
      id,
      task.id,
      task.targetQueue,
      task.priority,
      now,
      nextAttempt
    );

    this.store.updateExecutionStatus(id, "queued");
    emitExecutionCreated(this.store, id, task.id, task.targetQueue, nextAttempt);
    emitExecutionQueued(this.store, id, task.targetQueue);
    this.queueManager.enqueue(task.targetQueue, id);

    return this.store.getExecution(newExecution.id)!;
  }

  /**
   * Triggered by the HealthMonitor when a stale heartbeat is detected.
   *
   * Flow:
   *  1. Mark the crashed execution retry_scheduled.
   *  2. Load the latest checkpoint from MessageBus (if available).
   *  3. Create a new execution attempt.
   *  4. Enqueue it — the new execution will pick up the checkpoint when
   *     NativeSandboxInstance.execute() is called with checkpoint context.
   */
  async recoverExecution(executionId: string): Promise<void> {
    const execution = this.store.getExecution(executionId);
    if (!execution) return; // Already gone.

    // Only recover executions that are still in a running/assigned state.
    if (execution.status !== "running" && execution.status !== "assigned") return;

    const task = this.store.getTask(execution.taskId);
    if (!task) return;

    const now = new Date().toISOString();
    const nextAttempt = execution.attempt + 1;

    // If the next attempt would exceed maxRetries, dead-letter instead of
    // creating an unbounded retry chain.
    if (nextAttempt > task.maxRetries + 1) {
      // running → failed → dead_lettered (state machine requires two hops)
      this.store.updateExecutionStatus(executionId, "failed", {
        error: "Max retries exceeded during crash recovery",
        completedAt: now,
      });
      routeToDlq(this.store, this.store.getExecution(executionId)!);
      console.log(
        `[orchestrator] Execution ${executionId} reached maxRetries (${task.maxRetries}) — dead-lettered.`
      );
      return;
    }

    // 1. Mark crashed execution as retry_scheduled.
    this.store.updateExecutionStatus(executionId, "retry_scheduled", {
      error: "Recovered from crash by health monitor",
      completedAt: now,
    });

    // 2. Load checkpoint (may be null if agent crashed before first checkpoint).
    const checkpoint = this.messageBus
      ? this.messageBus.readLatestCheckpoint(executionId)
      : null;

    // 3. Create new execution attempt.
    const newId = crypto.randomUUID();

    this.store.createExecution(
      newId,
      task.id,
      task.targetQueue,
      task.priority,
      now,
      nextAttempt
    );

    // 4. If we have a checkpoint, store it on the new execution via checkpointData
    //    so the sandbox can retrieve it when it starts.
    if (checkpoint) {
      this.store.updateExecutionFields(newId, {
        checkpointData: JSON.stringify(checkpoint),
      });
    }

    this.store.updateExecutionStatus(newId, "queued");
    this.queueManager.enqueue(task.targetQueue, newId);

    emitExecutionCreated(this.store, newId, task.id, task.targetQueue, nextAttempt);
    emitExecutionQueued(this.store, newId, task.targetQueue);

    console.log(
      `[orchestrator] Recovered execution ${executionId} → new attempt ${newId} (attempt ${nextAttempt}, checkpoint: ${checkpoint ? "yes" : "no"})`
    );
  }

  async matchTask(
    agentId: string,
    _capabilities: RuntimeCapability[]
  ): Promise<TaskAssignment | null> {
    // Poll all queues except the internal-only visibility and dlq queues.
    // This ensures tasks routed to custom targetQueues are also dequeued.
    const allQueues = this.store.listQueues();
    const queues = allQueues
      .filter((q) => q.name !== "visibility" && q.name !== "dlq")
      .map((q) => q.name);

    for (const queueName of queues) {
      const execution = this.store.dequeueExecution(queueName);
      if (!execution) continue;

      const task = this.store.getTask(execution.taskId);
      if (!task) {
        // Task was deleted after dequeue; transition through running before failing.
        // The state machine requires assigned → running before running → failed.
        this.store.updateExecutionStatus(execution.id, "running");
        this.store.updateExecutionStatus(execution.id, "failed", {
          error: `Task ${execution.taskId} not found`,
          completedAt: new Date().toISOString(),
        });
        continue;
      }

      // Transition to assigned and emit event.
      // Note: dequeueExecution already transitions to 'assigned' atomically.
      emitExecutionAssigned(this.store, execution.id, agentId);

      const assignment: TaskAssignment = {
        executionId: execution.id,
        task,
        attempt: execution.attempt,
      };
      return assignment;
    }

    return null;
  }

  async startExecution(executionId: string): Promise<void> {
    const execution = this.store.getExecution(executionId);
    if (!execution) throw new ExecutionNotFoundError(executionId);

    if (execution.status !== "assigned") {
      throw new InvalidStateTransitionError(execution.status, "running", executionId);
    }

    this.store.updateExecutionStatus(executionId, "running", {
      startedAt: new Date().toISOString(),
    });
    emitExecutionStarted(this.store, executionId);
    this.queueManager.enqueueVisibility(executionId, "running");
  }

  async handleExecutionComplete(
    executionId: string,
    result: ExecuteResult
  ): Promise<void> {
    const execution = this.store.getExecution(executionId);
    if (!execution) throw new ExecutionNotFoundError(executionId);

    const task = this.store.getTask(execution.taskId);

    const now = new Date().toISOString();

    // Map result status to execution status.
    const terminalStatus =
      result.status === "completed"
        ? "completed"
        : result.status === "cancelled"
        ? "cancelled"
        : result.status === "timed_out"
        ? "timed_out"
        : "failed";

    // Only running is a valid entry state for completion.
    // waiting_for_input cannot transition directly to a terminal status — the
    // execution must return to running first (via provideInput).
    if (execution.status !== "running") {
      throw new InvalidStateTransitionError(execution.status, terminalStatus, executionId);
    }

    // Persist the terminal status (running → failed/timed_out/completed/cancelled).
    this.store.updateExecutionStatus(executionId, terminalStatus, {
      completedAt: now,
      durationMs: result.durationMs,
      output: result.output,
      error: result.error,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    });

    emitTerminalFromResult(this.store, executionId, result);
    this.queueManager.enqueueVisibility(executionId, terminalStatus);

    // -----------------------------------------------------------------------
    // Output routing — link the execution to a thread and append a summary
    // message so the thread shows completion status in the sidebar.
    // -----------------------------------------------------------------------
    try {
      const targetThreadId = task?.targetThreadId ?? null;
      const routeToThreadId = targetThreadId ?? MAIN_THREAD_ID;

      // Only route to threads that exist.  The Main thread is seeded by
      // migration 5, so it should always be present.  A custom targetThreadId
      // may have been deleted — in that case, fall back to Main.
      const routeThread = this.store.getThread(routeToThreadId)
        ?? (routeToThreadId !== MAIN_THREAD_ID ? this.store.getThread(MAIN_THREAD_ID) : null);

      if (routeThread) {
        this.store.linkExecutionToThread(executionId, routeThread.id);

        // Build a human-readable summary message.
        const taskName = task?.name ?? execution.taskId;
        let summaryContent: string;
        if (terminalStatus === "completed") {
          const durationSec = result.durationMs != null
            ? (result.durationMs / 1000).toFixed(1)
            : null;
          const durationLabel = durationSec != null ? ` in ${durationSec}s` : "";
          const outputSnippet = result.output
            ? `\nOutput: ${result.output.length > 500 ? result.output.slice(0, 500) + "…" : result.output}`
            : "";
          summaryContent = `Task "${taskName}" completed${durationLabel}.${outputSnippet}`;
        } else {
          const durationSec = result.durationMs != null
            ? (result.durationMs / 1000).toFixed(1)
            : null;
          const durationLabel = durationSec != null ? ` after ${durationSec}s` : "";
          const attemptLabel = ` (attempt ${execution.attempt}/${(task?.maxRetries ?? 0) + 1})`;
          const errorSnippet = result.error
            ? `\nError: ${result.error.length > 300 ? result.error.slice(0, 300) + "…" : result.error}`
            : "";
          summaryContent = `Task "${taskName}" ${terminalStatus}${durationLabel}${attemptLabel}.${errorSnippet}`;
        }

        this.store.appendThreadMessage({
          id: crypto.randomUUID(),
          threadId: routeThread.id,
          role: "agent",
          content: summaryContent,
          toolCalls: "[]",
        });
      }
    } catch (routingErr) {
      // Output routing is best-effort; never let a routing failure mask the
      // primary completion handling above.
      console.warn(
        `[orchestrator] Output routing failed for execution ${executionId}:`,
        routingErr
      );
    }

    // Retry or dead-letter for failure paths.
    if (terminalStatus === "failed" || terminalStatus === "timed_out") {
      const updatedExecution = this.store.getExecution(executionId)!;
      if (task !== null && shouldRetry(updatedExecution, task)) {
        const delay = calculateDelay(updatedExecution.attempt);
        scheduleRetry(this.store, this.queueManager, updatedExecution, delay);
      } else {
        routeToDlq(this.store, updatedExecution);
      }
    }
  }

  async provideInput(executionId: string, response: string): Promise<void> {
    const execution = this.store.getExecution(executionId);
    if (!execution) throw new ExecutionNotFoundError(executionId);

    // Read the pending input request BEFORE responding — respondToInput marks
    // it 'responded', after which getInputRequest (which queries for 'pending')
    // would return null and the event would never be emitted.
    const req = this.store.getInputRequest(executionId);
    if (!req) throw new Error(`No pending input request for execution ${executionId}`);

    // Persist the response (marks it 'responded').
    this.store.respondToInput(executionId, response);

    // Transition back to running.
    this.store.updateExecutionStatus(executionId, "running");

    emitInputProvided(this.store, executionId, req.id, response);
  }

  // ---------------------------------------------------------------------------
  // Internal helpers for DevTransport
  // ---------------------------------------------------------------------------

  /**
   * Called by DevTransport when the agent requests human input.
   * Persists the InputRequest and transitions the execution to waiting_for_input.
   */
  async requestInput(
    executionId: string,
    prompt: string,
    options?: string[]
  ): Promise<void> {
    const execution = this.store.getExecution(executionId);
    if (!execution) throw new ExecutionNotFoundError(executionId);

    const req = this.store.createInputRequest({
      executionId,
      prompt,
      options,
      status: "pending",
      timeoutMs: 300_000, // 5 minutes default
    });

    this.store.updateExecutionStatus(executionId, "waiting_for_input");
    emitInputRequested(this.store, executionId, req.id, prompt, options);
  }

  /**
   * Called by DevTransport's heartbeat method.
   * Updates health status in the store.
   */
  async heartbeat(
    _agentId: string,
    executionId: string,
    turnCount: number
  ): Promise<void> {
    const execution = this.store.getExecution(executionId);
    if (!execution) return; // Silently ignore stale heartbeats.

    // Use updateExecutionFields to avoid a self-transition (running → running)
    // which validateTransition would reject.
    this.store.updateExecutionFields(executionId, {
      turnCount,
      healthStatus: "healthy",
    });
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _requireTask(taskIdOrName: string): Task {
    const task = this.store.getTask(taskIdOrName) ?? this.store.getTaskByName(taskIdOrName);
    if (!task) throw new TaskNotFoundError(taskIdOrName);
    return task;
  }
}

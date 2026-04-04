// @baara-next/core — IAgentService interface

import type { TaskAssignment } from "./orchestrator.ts";
import type { ExecuteResult } from "./executor.ts";

/**
 * An agent is a long-lived worker process that repeatedly polls for tasks,
 * executes them, and reports results back to the orchestrator.
 *
 * Implementations are responsible for maintaining their own health heartbeat
 * and for delegating actual execution to an `IRuntime`.
 */
export interface IAgentService {
  /**
   * Start the agent's internal poll loop and any background workers.
   *
   * Must be idempotent: calling start() on an already-running agent is a
   * no-op.
   */
  start(): Promise<void>;

  /**
   * Gracefully stop the agent.
   *
   * Waits for any in-flight execution to reach a safe checkpoint before
   * returning.  After `stop()` resolves, no further store mutations will
   * occur.
   */
  stop(): Promise<void>;

  /**
   * Check out the next available `TaskAssignment` from the orchestrator.
   *
   * Returns `null` when no work is currently available.  The poll loop should
   * back off with a short sleep before calling again in that case.
   */
  pollTask(): Promise<TaskAssignment | null>;

  /**
   * Run the assigned task to completion using the configured runtime.
   *
   * The agent owns the full lifecycle of this call: it must send heartbeats,
   * handle `waiting_for_input` pauses, and report the result via
   * `IOrchestratorService.handleExecutionComplete` when done.
   */
  executeTask(assignment: TaskAssignment): Promise<ExecuteResult>;

  /**
   * Send a liveness signal to the orchestrator for the given execution.
   *
   * Called periodically from within `executeTask`.  The orchestrator uses
   * this to update `HealthStatus` and reset the watchdog timer.
   */
  heartbeat(executionId: string, turnCount: number): Promise<void>;

  /**
   * Block until the operator provides input for the given execution.
   *
   * Internally emits an `InputRequested` event, then polls or subscribes for
   * the response.  Returns the operator's response string.
   *
   * @param options - If provided, the UI should present these as selectable choices.
   */
  requestInput(
    executionId: string,
    prompt: string,
    options?: string[]
  ): Promise<string>;
}

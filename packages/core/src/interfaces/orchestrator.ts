// @baara-next/core — IOrchestratorService interface

import type { Execution, RuntimeCapability, Task } from "../types.ts";
import type { ExecuteResult } from "./executor.ts";

// ---------------------------------------------------------------------------
// TaskAssignment
// ---------------------------------------------------------------------------

/**
 * Returned by `matchTask` when the orchestrator claims an execution for an
 * agent.  The agent uses this to begin `executeTask`.
 */
export interface TaskAssignment {
  executionId: string;
  task: Task;
  /** Which retry attempt this execution represents (starts at 1). */
  attempt: number;
}

// ---------------------------------------------------------------------------
// IOrchestratorService
// ---------------------------------------------------------------------------

/**
 * The orchestrator owns the full execution lifecycle: it creates executions,
 * routes them to queues, assigns them to agents, and handles completions,
 * failures, and retries.
 *
 * Implementations must be safe to call concurrently from multiple agents.
 */
export interface IOrchestratorService {
  /**
   * Enqueue a new execution for the given task.
   *
   * @param taskIdOrName - The task's UUID or its unique name (both are resolved).
   * Returns the created `Execution` in `queued` status.
   * Throws `TaskNotFoundError` if no task matches.
   */
  submitTask(taskIdOrName: string): Promise<Execution>;

  /**
   * Execute a task synchronously in `direct` mode, bypassing the queue.
   *
   * The orchestrator resolves the runtime internally via its RuntimeRegistry.
   * Throws `Error` if no RuntimeRegistry was provided to the constructor.
   *
   * @param taskIdOrName - The task's UUID or its unique name (both are resolved).
   * Returns the completed (or failed) `Execution`.
   * Throws `TaskNotFoundError` if no task matches.
   */
  runDirect(taskIdOrName: string): Promise<Execution>;

  /**
   * Cancel a running or queued execution.
   *
   * Throws `ExecutionNotFoundError` if `executionId` is unknown.
   * Throws `InvalidStateTransitionError` if the execution is already terminal.
   */
  cancelExecution(executionId: string): Promise<void>;

  /**
   * Manually trigger a retry for a failed or timed-out execution.
   *
   * Returns the new `Execution` created for the retry attempt.
   * Throws `ExecutionNotFoundError` if `executionId` is unknown.
   */
  retryExecution(executionId: string): Promise<Execution>;

  /**
   * Claim the next available execution for an agent with the given
   * capabilities.  Returns `null` if no suitable execution is queued.
   *
   * This is the agent-facing polling method: the agent calls it on every poll
   * cycle and receives back a `TaskAssignment` it must process.
   */
  matchTask(
    agentId: string,
    capabilities: RuntimeCapability[]
  ): Promise<TaskAssignment | null>;

  /**
   * Called by the agent when an execution finishes (success, failure, or
   * timeout).  The orchestrator persists the result and triggers any
   * retry/dead-letter logic.
   */
  handleExecutionComplete(
    executionId: string,
    result: ExecuteResult
  ): Promise<void>;

  /**
   * Transition an execution from `assigned` to `running` and set `startedAt`.
   *
   * Must be called by the agent immediately before it begins work so the
   * health monitor can track long-running executions.
   * Throws `ExecutionNotFoundError` if `executionId` is unknown.
   */
  startExecution(executionId: string): Promise<void>;

  /**
   * Deliver a human operator's response to an execution that is currently
   * in `waiting_for_input` status.
   *
   * Transitions the execution back to `running`.
   * Throws `ExecutionNotFoundError` if `executionId` is unknown.
   */
  provideInput(executionId: string, response: string): Promise<void>;
}

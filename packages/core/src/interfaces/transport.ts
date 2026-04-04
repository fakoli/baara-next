// @baara-next/core — ITransport interface
//
// The transport layer decouples agents from the orchestrator's concrete
// implementation.  An agent only ever calls ITransport methods; whether the
// orchestrator is in-process, across a Unix socket, or behind an HTTP API is
// invisible to the agent.

import type { RuntimeCapability } from "../types.ts";
import type { TaskAssignment } from "./orchestrator.ts";
import type { ExecuteResult } from "./executor.ts";

/**
 * The narrow interface an agent uses to communicate with the orchestrator.
 *
 * Implementations include:
 *   - `InProcessTransport`  — direct function call (single-process mode)
 *   - `HttpTransport`       — REST calls to the orchestrator server
 *
 * All methods are async: even the in-process variant wraps synchronous store
 * calls so the interface is uniform.
 */
export interface ITransport {
  /**
   * Ask the orchestrator for the next available execution matching the
   * agent's capabilities.
   *
   * Returns `null` when no work is queued; the agent should back off briefly
   * before calling again.
   */
  pollTask(
    agentId: string,
    capabilities: RuntimeCapability[]
  ): Promise<TaskAssignment | null>;

  /**
   * Notify the orchestrator that the agent is starting execution.
   *
   * Transitions the execution from `assigned` to `running` and sets `startedAt`.
   * Must be called before `runtime.execute()` so the health monitor can track it.
   */
  startExecution(executionId: string): Promise<void>;

  /**
   * Report the final result of an execution to the orchestrator.
   *
   * The orchestrator will persist the result, update status, and trigger any
   * retry or dead-letter logic.
   */
  completeExecution(
    executionId: string,
    result: ExecuteResult
  ): Promise<void>;

  /**
   * Block until an operator provides input for the execution, then return the
   * response string.
   *
   * The transport is responsible for creating the `InputRequest` record and
   * polling or subscribing for the response.
   *
   * @param options - Optional selectable choices surfaced in the operator UI.
   */
  requestInput(
    executionId: string,
    prompt: string,
    options?: string[]
  ): Promise<string>;

  /**
   * Send a liveness signal for a running execution.
   *
   * Called periodically by the agent during a long-running execution so the
   * orchestrator's health monitor can distinguish slow executions from crashed
   * agents.
   */
  heartbeat(
    agentId: string,
    executionId: string,
    turnCount: number
  ): Promise<void>;
}

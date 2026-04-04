// @baara-next/transport — DevTransport
//
// In-process transport for single-process dev mode.  All methods delegate
// directly to the orchestrator's method references that are injected at
// construction time; no HTTP calls, no serialisation overhead.
//
// HITL (human-in-the-loop) input is handled via a simple EventEmitter-based
// wait: requestInput creates a pending entry keyed by executionId, then
// suspends via a promise.  When provideInput is called externally the promise
// resolves with the response string.

import { EventEmitter } from "events";
import type { RuntimeCapability } from "@baara-next/core";
import type { ITransport, TaskAssignment, ExecuteResult } from "@baara-next/core";
import { InputTimeoutError } from "@baara-next/core";

// ---------------------------------------------------------------------------
// Orchestrator method references injected into the transport
// ---------------------------------------------------------------------------

/**
 * The subset of orchestrator methods the DevTransport needs.
 * Keeping the dependency surface minimal avoids circular imports between
 * the orchestrator and transport packages.
 */
export interface DevTransportOrchestratorRefs {
  matchTask(
    agentId: string,
    capabilities: RuntimeCapability[]
  ): Promise<TaskAssignment | null>;

  startExecution(executionId: string): Promise<void>;

  handleExecutionComplete(
    executionId: string,
    result: ExecuteResult
  ): Promise<void>;

  /**
   * Called when the agent requests human input.  The orchestrator is
   * responsible for persisting the InputRequest and transitioning the
   * execution to `waiting_for_input`.  The transport polls until a response
   * is available or the timeout expires.
   */
  requestInput(
    executionId: string,
    prompt: string,
    options?: string[]
  ): Promise<void>;

  heartbeat(
    agentId: string,
    executionId: string,
    turnCount: number
  ): Promise<void>;
}

// ---------------------------------------------------------------------------
// DevTransport
// ---------------------------------------------------------------------------

/**
 * In-process transport for development / single-process mode.
 *
 * Wires directly to orchestrator method references; no network I/O.
 */
export class DevTransport implements ITransport {
  private readonly orch: DevTransportOrchestratorRefs;

  /**
   * Pending HITL input waiters keyed by executionId.
   * Each entry is a pair of resolve/reject callbacks from a Promise.
   */
  private readonly pendingInputs = new Map<
    string,
    { resolve: (response: string) => void; reject: (err: Error) => void }
  >();

  private readonly emitter = new EventEmitter();

  constructor(orch: DevTransportOrchestratorRefs) {
    this.orch = orch;
    // Allow many simultaneous waiting executions without Node/Bun warnings.
    this.emitter.setMaxListeners(100);
  }

  // ---------------------------------------------------------------------------
  // ITransport implementation
  // ---------------------------------------------------------------------------

  async pollTask(
    agentId: string,
    capabilities: RuntimeCapability[]
  ): Promise<TaskAssignment | null> {
    return this.orch.matchTask(agentId, capabilities);
  }

  async startExecution(executionId: string): Promise<void> {
    return this.orch.startExecution(executionId);
  }

  async completeExecution(
    executionId: string,
    result: ExecuteResult
  ): Promise<void> {
    return this.orch.handleExecutionComplete(executionId, result);
  }

  /**
   * Notify the orchestrator that input is needed, then block until the
   * response arrives (or a timeout occurs).
   *
   * The orchestrator transitions the execution to `waiting_for_input` as a
   * side-effect of calling `orch.requestInput`.  Once the operator calls
   * `DevTransport.provideInput`, the pending promise resolves.
   */
  async requestInput(
    executionId: string,
    prompt: string,
    options?: string[]
  ): Promise<string> {
    // Notify orchestrator (persists InputRequest, transitions status).
    await this.orch.requestInput(executionId, prompt, options);

    // Suspend until the response arrives via provideInput(), or timeout.
    const timeoutMs = 300_000; // 5 minute default
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingInputs.delete(executionId);
        // The transport does not have access to the InputRequest ID at this
        // point; pass "unknown" as a placeholder for the inputRequestId arg.
        reject(new InputTimeoutError("unknown", executionId, timeoutMs));
      }, timeoutMs);
      this.pendingInputs.set(executionId, {
        resolve: (r: string) => { clearTimeout(timer); resolve(r); },
        reject: (e: Error) => { clearTimeout(timer); reject(e); },
      });
    });
  }

  async heartbeat(
    agentId: string,
    executionId: string,
    turnCount: number
  ): Promise<void> {
    return this.orch.heartbeat(agentId, executionId, turnCount);
  }

  // ---------------------------------------------------------------------------
  // HITL response delivery (called by the server's /api/executions/:id/input route)
  // ---------------------------------------------------------------------------

  /**
   * Deliver an operator response for an execution that is waiting for input.
   *
   * Resolves the suspended `requestInput` promise so the agent can continue.
   * Returns `true` if a waiter was found and notified, `false` otherwise.
   */
  provideInput(executionId: string, response: string): boolean {
    const waiter = this.pendingInputs.get(executionId);
    if (!waiter) return false;

    this.pendingInputs.delete(executionId);
    waiter.resolve(response);
    return true;
  }

  /**
   * Reject a pending input request (e.g. on timeout or shutdown).
   *
   * Returns `true` if a waiter was found and rejected.
   */
  cancelInput(executionId: string, reason = "Input cancelled"): boolean {
    const waiter = this.pendingInputs.get(executionId);
    if (!waiter) return false;

    this.pendingInputs.delete(executionId);
    waiter.reject(new Error(reason));
    return true;
  }

  /**
   * Returns the set of execution IDs that are currently suspended waiting
   * for input.  Useful for the orchestrator's health monitor.
   */
  pendingInputExecutionIds(): string[] {
    return Array.from(this.pendingInputs.keys());
  }
}

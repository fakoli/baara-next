// @baara-next/orchestrator — Health Monitor
//
// Periodically inspects all running executions and updates their health_status
// based on elapsed wall-clock time vs. the task's configured timeout.
//
// Thresholds (derived from BAARA v1):
//   elapsed > timeoutMs              → "unresponsive" + onCrashDetected (first time only)
//   elapsed > 0.5 * timeoutMs        → "slow"
//   otherwise                        → "healthy"
//
// In Phase 5 an optional `onCrashDetected` callback is added. When an
// execution transitions from healthy/slow → unresponsive (first detection),
// the callback is invoked once with the executionId so the orchestrator can
// initiate checkpoint recovery.
//
// This class never transitions an execution to a terminal status — that is the
// orchestrator's responsibility.  It only updates the health_status field so
// the UI and health endpoints can surface the signal.

import type { IStore } from "@baara-next/core";

// ---------------------------------------------------------------------------
// HealthMonitor
// ---------------------------------------------------------------------------

export class HealthMonitor {
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private store: IStore,
    /** How often to run the health check, in milliseconds. Default: 10 000. */
    private checkIntervalMs = 10_000,
    /**
     * Optional callback invoked the first time an execution is detected as
     * unresponsive (i.e., the transition healthy/slow → unresponsive).
     * The orchestrator wires this to recoverExecution().
     */
    private onCrashDetected?: (executionId: string) => void
  ) {}

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /** Begin periodic health checks. Idempotent. */
  start(): void {
    if (this.interval !== null) return;
    this.interval = setInterval(() => {
      try {
        this.check();
      } catch (err) {
        console.error("[health-monitor] Check failed:", err);
      }
    }, this.checkIntervalMs);
  }

  /** Stop periodic health checks and release the timer. */
  stop(): void {
    if (this.interval !== null) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  // -------------------------------------------------------------------------
  // Core check — package-internal, exposed for testing via type cast
  // -------------------------------------------------------------------------

  /**
   * Inspect all executions currently in `running` status and update
   * health_status based on elapsed time vs. the parent task's timeout.
   *
   * When an execution transitions from healthy/slow → unresponsive for the
   * first time, `onCrashDetected` is called once with the executionId.
   */
  check(): void {
    // Use listAllExecutions to fetch all running executions in one query
    // instead of the previous O(tasks × executions) double loop.
    const running = this.store.listAllExecutions({ status: "running" });
    const now = Date.now();

    for (const execution of running) {
      if (!execution.startedAt) continue;

      const task = this.store.getTask(execution.taskId);
      if (!task) continue;

      const elapsed = now - new Date(execution.startedAt).getTime();
      const timeoutMs = task.timeoutMs;
      const slowThreshold = timeoutMs * 0.5;

      const currentHealth = execution.healthStatus;

      if (elapsed > timeoutMs) {
        if (currentHealth !== "unresponsive") {
          // Transition to unresponsive and trigger recovery callback on
          // the first detection only (currentHealth is healthy or slow).
          this.store.updateExecutionFields(execution.id, {
            healthStatus: "unresponsive",
          });
          if (this.onCrashDetected) {
            try {
              this.onCrashDetected(execution.id);
            } catch (err) {
              console.error(
                `[health-monitor] onCrashDetected threw for ${execution.id}:`,
                err
              );
            }
          }
        }
        // Already unresponsive — do not call onCrashDetected again.
      } else if (
        elapsed > slowThreshold &&
        elapsed <= timeoutMs &&
        currentHealth === "healthy"
      ) {
        this.store.updateExecutionFields(execution.id, {
          healthStatus: "slow",
        });
      }
      // If already healthy and under threshold — no update needed.
    }
  }
}

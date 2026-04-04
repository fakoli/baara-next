// @baara-next/orchestrator — Retry Logic
//
// Determines whether a failed/timed-out execution should be retried, computes
// the backoff delay, and persists the retry state through the store.

import type { IStore } from "@baara-next/core";
import type { Execution, Task } from "@baara-next/core";
import { QueueManager } from "./queue-manager.ts";
import {
  emitRetryScheduled,
  emitDeadLettered,
} from "./event-handler.ts";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface RetryConfig {
  /** Initial delay before the first retry attempt, in milliseconds. Default: 1000. */
  initialDelay: number;
  /** Exponential backoff coefficient. Default: 2.0. */
  coefficient: number;
  /** Maximum delay between retry attempts, in milliseconds. Default: 60000. */
  maxDelay: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  initialDelay: 1000,
  coefficient: 2.0,
  maxDelay: 60_000,
};

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/**
 * Return true if the execution should be retried according to task policy.
 *
 * maxRetries=1 means 1 retry (2 total attempts): attempt 1 fails → retry →
 * attempt 2.  The condition uses <= so that attempt === maxRetries still
 * triggers a retry; once attempt > maxRetries the execution is dead-lettered.
 */
export function shouldRetry(execution: Execution, task: Task): boolean {
  return task.maxRetries > 0 && execution.attempt <= task.maxRetries;
}

/**
 * Compute the delay before the next retry attempt using exponential backoff
 * with ±10 % random jitter.
 *
 * Formula: min(initialDelay * coefficient^(attempt-1), maxDelay) * jitter
 * where jitter ∈ [0.9, 1.1].
 *
 * @param attempt - The attempt number that just failed (1-based).
 * @param config  - Backoff configuration; defaults are applied for missing fields.
 */
export function calculateDelay(
  attempt: number,
  config: Partial<RetryConfig> = {}
): number {
  const { initialDelay, coefficient, maxDelay } = {
    ...DEFAULT_RETRY_CONFIG,
    ...config,
  };
  const base = Math.min(initialDelay * Math.pow(coefficient, attempt - 1), maxDelay);
  const jitter = 0.9 + Math.random() * 0.2; // ±10 %
  return Math.round(base * jitter);
}

/**
 * Transition the execution to `retry_scheduled`, record the retry event, and
 * enqueue it to the timer queue with the computed fire time.
 *
 * The caller is responsible for ensuring `shouldRetry()` returned true before
 * calling this function.
 */
export function scheduleRetry(
  store: IStore,
  queueManager: QueueManager,
  execution: Execution,
  delay: number
): void {
  const nextAttempt = execution.attempt + 1;

  // Persist transition to retry_scheduled
  store.updateExecutionStatus(execution.id, "retry_scheduled");
  emitRetryScheduled(store, execution.id, nextAttempt, delay);

  // Enqueue to the timer queue; the fire time is encoded in scheduledAt of
  // a new execution created by the orchestrator after the delay elapses.
  // Here we just enqueue the current execution ID so the timer queue
  // manager can create the new attempt when the delay fires.
  queueManager.enqueueTimer(execution.id, delay, nextAttempt);
}

/**
 * Move the execution to `dead_lettered` status.
 *
 * Called when all retry attempts are exhausted or when the task has
 * maxRetries === 0 and the first attempt failed.
 */
export function routeToDlq(
  store: IStore,
  execution: Execution
): void {
  const previousStatus = execution.status as Extract<
    typeof execution.status,
    "failed" | "timed_out"
  >;

  store.updateExecutionStatus(execution.id, "dead_lettered");
  emitDeadLettered(store, execution.id, previousStatus, execution.attempt);
}

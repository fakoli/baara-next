// tests/validation/helpers/metrics.ts
//
// Timing capture and reporting types for BAARA Next validation tests.
// Tracks the three key time-to-X milestones for each execution under test:
//   - timeToStartMs         — from t0 until execution enters "running"
//   - timeToFirstResponseMs — from t0 until execution output becomes non-null
//   - totalDurationMs       — from t0 until execution reaches a terminal status

import type { APIClient } from "./api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The interface through which the execution was triggered. */
export type ValidationInterface = "api" | "ui-new-session" | "ui-existing-session";

/** Difficulty tier of the task definition that drove this execution. */
export type ValidationDifficulty = "easy" | "medium" | "hard";

/**
 * Timing record for one execution validation run.
 * Callers of `captureApiTiming` receive a partial record and must fill in
 * `taskDefinitionId`, `category`, `difficulty`, and `interface` themselves.
 */
export interface ValidationTiming {
  /** ID of the TaskDefinition that drove this execution. */
  taskDefinitionId: string;
  /** Category of the task (e.g. "native-direct", "wasm-queued"). */
  category: string;
  /** Difficulty tier. */
  difficulty: ValidationDifficulty;
  /** How the execution was triggered. */
  interface: ValidationInterface;
  /** Ms from t0 until execution status first entered "running". */
  timeToStartMs: number;
  /** Ms from t0 until execution output became non-null. */
  timeToFirstResponseMs: number;
  /** Ms from t0 until execution reached a terminal status. */
  totalDurationMs: number;
  /** ID of the execution that was measured. */
  executionId: string;
  /** Terminal status the execution ended in. */
  status: string;
  /** ISO-8601 timestamp at the moment the timing was captured. */
  timestamp: string;
}

/**
 * Aggregated report produced after a validation run.
 */
export interface ValidationReport {
  /** Unique ID for this validation run (UUID or timestamp-derived). */
  runId: string;
  /** ISO-8601 start time of the run. */
  startedAt: string;
  /** ISO-8601 end time of the run. */
  completedAt: string;
  /** All timing records collected. */
  timings: ValidationTiming[];
  /** Per-category aggregates and pass/fail counts. */
  summary: {
    totalExecutions: number;
    passed: number;
    failed: number;
    avgTimeToStartMs: number;
    avgTimeToFirstResponseMs: number;
    avgTotalDurationMs: number;
  };
}

// ---------------------------------------------------------------------------
// Terminal and intermediate status helpers
// ---------------------------------------------------------------------------

const TERMINAL_STATUSES = new Set([
  "completed",
  "failed",
  "cancelled",
  "dead_lettered",
  "timed_out",
]);

// ---------------------------------------------------------------------------
// captureApiTiming
// ---------------------------------------------------------------------------

/**
 * Poll `apiClient.getExecution(executionId)` every 200ms, recording:
 *   - `timeToStartMs`         — when status first becomes "running"
 *   - `timeToFirstResponseMs` — when output is first non-null/non-empty
 *   - `totalDurationMs`       — when a terminal status is reached
 *
 * Polling stops at the first terminal status or after `timeoutMs` (default 120s).
 *
 * Returns a partial `ValidationTiming` — the caller must supply:
 *   `taskDefinitionId`, `category`, `difficulty`, `interface`.
 *
 * @param apiClient   API client to use for polling.
 * @param executionId The execution to track.
 * @param t0          Wall-clock start time in ms (typically `Date.now()` before
 *                    the execute/submit call).
 * @param timeoutMs   Hard cap on total polling time (default: 120_000 ms).
 */
export async function captureApiTiming(
  apiClient: APIClient,
  executionId: string,
  t0: number,
  timeoutMs = 120_000
): Promise<Omit<ValidationTiming, "taskDefinitionId" | "category" | "difficulty" | "interface">> {
  const deadline = Date.now() + timeoutMs;

  let timeToStartMs = -1;
  let timeToFirstResponseMs = -1;
  let totalDurationMs = -1;
  let lastStatus = "";

  while (Date.now() < deadline) {
    const execution = await apiClient.getExecution(executionId);
    const now = Date.now();
    lastStatus = execution.status;

    // Record first transition into "running".
    if (timeToStartMs === -1 && execution.status === "running") {
      timeToStartMs = now - t0;
    }

    // Record first appearance of non-empty output.
    if (
      timeToFirstResponseMs === -1 &&
      execution.output !== null &&
      execution.output !== undefined &&
      execution.output !== ""
    ) {
      // If we haven't recorded start yet, mark it now.
      if (timeToStartMs === -1) {
        timeToStartMs = now - t0;
      }
      timeToFirstResponseMs = now - t0;
    }

    // Check for terminal status.
    if (TERMINAL_STATUSES.has(execution.status)) {
      totalDurationMs = now - t0;

      // Backfill milestones that were never observed independently.
      if (timeToStartMs === -1) {
        timeToStartMs = totalDurationMs;
      }
      if (timeToFirstResponseMs === -1) {
        timeToFirstResponseMs = totalDurationMs;
      }
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  // If we hit the deadline without a terminal status, use elapsed time.
  if (totalDurationMs === -1) {
    totalDurationMs = Date.now() - t0;
    if (timeToStartMs === -1) timeToStartMs = totalDurationMs;
    if (timeToFirstResponseMs === -1) timeToFirstResponseMs = totalDurationMs;
  }

  return {
    timeToStartMs,
    timeToFirstResponseMs,
    totalDurationMs,
    executionId,
    status: lastStatus,
    timestamp: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// validateTimingSanity
// ---------------------------------------------------------------------------

/**
 * Assert that the three timing values form a valid monotonic sequence:
 *   0 <= timeToStartMs <= timeToFirstResponseMs <= totalDurationMs
 *
 * Throws an `Error` describing the first violated constraint.
 */
export function validateTimingSanity(timing: ValidationTiming): void {
  if (timing.timeToStartMs < 0) {
    throw new Error(
      `validateTimingSanity: timeToStartMs must be >= 0, got ${timing.timeToStartMs} for execution ${timing.executionId}`
    );
  }
  if (timing.timeToFirstResponseMs < 0) {
    throw new Error(
      `validateTimingSanity: timeToFirstResponseMs must be >= 0, got ${timing.timeToFirstResponseMs} for execution ${timing.executionId}`
    );
  }
  if (timing.totalDurationMs < 0) {
    throw new Error(
      `validateTimingSanity: totalDurationMs must be >= 0, got ${timing.totalDurationMs} for execution ${timing.executionId}`
    );
  }
  if (timing.timeToStartMs > timing.timeToFirstResponseMs) {
    throw new Error(
      `validateTimingSanity: timeToStartMs (${timing.timeToStartMs}) must be <= timeToFirstResponseMs (${timing.timeToFirstResponseMs}) for execution ${timing.executionId}`
    );
  }
  if (timing.timeToFirstResponseMs > timing.totalDurationMs) {
    throw new Error(
      `validateTimingSanity: timeToFirstResponseMs (${timing.timeToFirstResponseMs}) must be <= totalDurationMs (${timing.totalDurationMs}) for execution ${timing.executionId}`
    );
  }
}

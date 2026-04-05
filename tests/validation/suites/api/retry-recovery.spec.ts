// tests/validation/suites/api/retry-recovery.spec.ts
//
// Validates the retry / dead-letter path by running tasks with tight timeouts
// and non-zero maxRetries budgets.
//
// Strategy:
//   1. Create a task from getDefinitionsByCategory("retry-recovery") with the
//      definition's timeoutMs and maxRetries values.
//   2. Run via apiClient.runTask(taskId).
//   3. Poll with captureApiTiming until a terminal status is reached.
//   4. List all executions for the task; assert attempt count reflects retries.
//   5. Measure total time across all attempts.
//
// Retry mechanics:
//   - "easy" uses timeoutMs=30_000 and maxRetries=1; expected to complete on
//     the first attempt (generous timeout).
//   - "medium" uses timeoutMs=15_000 and maxRetries=2; may or may not time out.
//   - "hard" uses timeoutMs=5_000 and maxRetries=3; very tight; likely times out
//     and retries; ultimately dead-lettered or completes.
//
// Tagging:
//   - easy:   NOT @local-only — benign retry budget with a generous timeout.
//   - medium: @local-only — tight timeout may produce flaky behaviour in CI.
//   - hard:   @local-only — near-certain timeout; long total run time.

import { test, expect } from "../../helpers/fixtures";
import { getDefinitionsByCategory } from "../../helpers/task-definitions";
import { captureApiTiming, validateTimingSanity } from "../../helpers/metrics";
import type { ValidationTiming } from "../../helpers/metrics";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFS = getDefinitionsByCategory("retry-recovery");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute the total elapsed time across all observed execution attempts by
 * summing each attempt's durationMs where present, falling back to
 * `totalDurationMs` from captureApiTiming when durationMs values are absent.
 */
function computeTotalAttemptMs(
  attempts: Array<{ durationMs?: number | null; [key: string]: unknown }>,
  fallbackMs: number
): number {
  const sum = attempts.reduce<number>((acc, ex) => {
    return acc + (typeof ex.durationMs === "number" ? ex.durationMs : 0);
  }, 0);
  return sum > 0 ? sum : fallbackMs;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const easyDef = DEFS.find((d) => d.difficulty === "easy");
const mediumDef = DEFS.find((d) => d.difficulty === "medium");
const hardDef = DEFS.find((d) => d.difficulty === "hard");

if (!easyDef || !mediumDef || !hardDef) {
  throw new Error(
    "Missing retry-recovery task definitions — check task-definitions.ts"
  );
}

// ---------------------------------------------------------------------------
// Easy — not @local-only
// ---------------------------------------------------------------------------

test("retry-recovery easy: task completes within generous timeout (maxRetries=1)", async ({
  apiClient,
  metrics,
}) => {
  const def = easyDef;

  const task = await apiClient.createTask({
    name: def.name,
    prompt: def.prompt,
    executionMode: def.executionMode,
    sandboxType: def.sandboxType,
    timeoutMs: def.timeoutMs ?? 30_000,
    maxRetries: def.maxRetries ?? 1,
  });

  try {
    const t0 = Date.now();
    const execution = await apiClient.runTask(task.id);

    // captureApiTiming polls until terminal status; timeout budget is generous.
    const partialTiming = await captureApiTiming(
      apiClient,
      execution.id,
      t0,
      // Allow up to (timeoutMs * (maxRetries + 1)) + 30s scheduling overhead.
      (def.timeoutMs ?? 30_000) * ((def.maxRetries ?? 1) + 1) + 30_000
    );

    const timing: ValidationTiming = {
      ...partialTiming,
      taskDefinitionId: def.id,
      category: def.category,
      difficulty: def.difficulty,
      interface: "api",
    };

    validateTimingSanity(timing);
    metrics.push(timing);

    // Terminal status required.
    expect(timing.status).toMatch(/^(completed|failed|timed_out|dead_lettered|cancelled)$/);

    // Fetch all executions for this task to measure retry attempts.
    const allExecutions = await apiClient.listExecutionsByTask(task.id);
    expect(allExecutions.length).toBeGreaterThanOrEqual(1);

    const maxAttemptSeen = allExecutions.reduce(
      (max, ex) => Math.max(max, ex.attempt),
      0
    );

    // Easy has a generous timeout — expect at most 1 attempt (no retry needed).
    // We assert <= maxRetries + 1 to allow for a single retry if the system
    // decides the first attempt timed out.
    expect(maxAttemptSeen).toBeLessThanOrEqual((def.maxRetries ?? 1) + 1);

    const totalAttemptMs = computeTotalAttemptMs(allExecutions, timing.totalDurationMs);

    console.log(
      `[retry-recovery easy] terminal status: ${timing.status}, ` +
      `attempts: ${allExecutions.length}, ` +
      `max attempt number: ${maxAttemptSeen}, ` +
      `total attempt ms: ${totalAttemptMs}`
    );
  } finally {
    await apiClient.deleteTask(task.id);
  }
});

// ---------------------------------------------------------------------------
// Medium — @local-only: tight timeout may cause retries
// ---------------------------------------------------------------------------

test("@local-only retry-recovery medium: task retries up to maxRetries=2 then reaches terminal status", async ({
  apiClient,
  metrics,
}) => {
  const def = mediumDef;

  const task = await apiClient.createTask({
    name: def.name,
    prompt: def.prompt,
    executionMode: def.executionMode,
    sandboxType: def.sandboxType,
    timeoutMs: def.timeoutMs ?? 15_000,
    maxRetries: def.maxRetries ?? 2,
  });

  try {
    const t0 = Date.now();
    const execution = await apiClient.runTask(task.id);

    const partialTiming = await captureApiTiming(
      apiClient,
      execution.id,
      t0,
      (def.timeoutMs ?? 15_000) * ((def.maxRetries ?? 2) + 1) + 30_000
    );

    const timing: ValidationTiming = {
      ...partialTiming,
      taskDefinitionId: def.id,
      category: def.category,
      difficulty: def.difficulty,
      interface: "api",
    };

    validateTimingSanity(timing);
    metrics.push(timing);

    expect(timing.status).toMatch(/^(completed|failed|timed_out|dead_lettered|cancelled)$/);

    const allExecutions = await apiClient.listExecutionsByTask(task.id);
    expect(allExecutions.length).toBeGreaterThanOrEqual(1);

    const maxAttemptSeen = allExecutions.reduce(
      (max, ex) => Math.max(max, ex.attempt),
      0
    );

    // Must not exceed maxRetries + 1 total attempts.
    expect(maxAttemptSeen).toBeLessThanOrEqual((def.maxRetries ?? 2) + 1);

    const totalAttemptMs = computeTotalAttemptMs(allExecutions, timing.totalDurationMs);

    console.log(
      `[retry-recovery medium] terminal status: ${timing.status}, ` +
      `attempts: ${allExecutions.length}, ` +
      `max attempt number: ${maxAttemptSeen}, ` +
      `total attempt ms: ${totalAttemptMs}`
    );
  } finally {
    await apiClient.deleteTask(task.id);
  }
});

// ---------------------------------------------------------------------------
// Hard — @local-only: near-certain timeout; exercises DLQ path
// ---------------------------------------------------------------------------

test("@local-only retry-recovery hard: tight timeout causes retries; eventually dead-lettered or completed", async ({
  apiClient,
  metrics,
}) => {
  const def = hardDef;

  const task = await apiClient.createTask({
    name: def.name,
    prompt: def.prompt,
    executionMode: def.executionMode,
    sandboxType: def.sandboxType,
    timeoutMs: def.timeoutMs ?? 5_000,
    maxRetries: def.maxRetries ?? 3,
  });

  try {
    const t0 = Date.now();
    const execution = await apiClient.runTask(task.id);

    const partialTiming = await captureApiTiming(
      apiClient,
      execution.id,
      t0,
      // Hard: 5s × 4 attempts + 60s overhead for retry scheduling delays.
      (def.timeoutMs ?? 5_000) * ((def.maxRetries ?? 3) + 1) + 60_000
    );

    const timing: ValidationTiming = {
      ...partialTiming,
      taskDefinitionId: def.id,
      category: def.category,
      difficulty: def.difficulty,
      interface: "api",
    };

    validateTimingSanity(timing);
    metrics.push(timing);

    // Hard path accepts any terminal status — dead_lettered is the expected
    // outcome given the 5s timeout, but completed is allowed if the agent
    // responds within 5s on any attempt.
    expect(timing.status).toMatch(/^(completed|failed|timed_out|dead_lettered|cancelled)$/);

    const allExecutions = await apiClient.listExecutionsByTask(task.id);
    expect(allExecutions.length).toBeGreaterThanOrEqual(1);

    const maxAttemptSeen = allExecutions.reduce(
      (max, ex) => Math.max(max, ex.attempt),
      0
    );

    // Must not exceed maxRetries + 1 total attempts.
    expect(maxAttemptSeen).toBeLessThanOrEqual((def.maxRetries ?? 3) + 1);

    const totalAttemptMs = computeTotalAttemptMs(allExecutions, timing.totalDurationMs);

    console.log(
      `[retry-recovery hard] terminal status: ${timing.status}, ` +
      `attempts: ${allExecutions.length}, ` +
      `max attempt number: ${maxAttemptSeen}, ` +
      `total attempt ms: ${totalAttemptMs}`
    );
  } finally {
    await apiClient.deleteTask(task.id);
  }
});

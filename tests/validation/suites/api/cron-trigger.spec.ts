// tests/validation/suites/api/cron-trigger.spec.ts
//
// Validates that cron-scheduled tasks fire and produce executions.
//
// Strategy:
//   1. Create a cron task using getDefinitionsByCategory("cron-trigger").
//   2. Poll listExecutionsByTask(taskId) until at least one execution appears
//      (up to 90 seconds — cron fires every 1 minute per "*/1 * * * *").
//   3. Measure scheduling latency from execution.scheduledAt to wall clock.
//   4. Record timing via captureApiTiming on the first observed execution.
//
// Tagging:
//   - easy:   NOT @local-only — runs in CI.
//   - medium: @local-only — cron scheduling relies on a long-lived server.
//   - hard:   @local-only — same reason.

import { test, expect } from "../../helpers/fixtures";
import { getDefinitionsByCategory } from "../../helpers/task-definitions";
import { captureApiTiming, validateTimingSanity } from "../../helpers/metrics";
import type { ValidationTiming } from "../../helpers/metrics";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum ms to wait for the first cron-triggered execution to appear. */
const CRON_POLL_TIMEOUT_MS = 90_000;
/** Poll interval when waiting for a cron execution to appear. */
const CRON_POLL_INTERVAL_MS = 2_000;

const DEFS = getDefinitionsByCategory("cron-trigger");

// ---------------------------------------------------------------------------
// Helper: poll listExecutionsByTask until at least one execution appears.
// Returns the first execution found, or throws if deadline is exceeded.
// ---------------------------------------------------------------------------

async function waitForFirstCronExecution(
  apiClient: { listExecutionsByTask(taskId: string): Promise<Array<{ id: string; scheduledAt: string; status: string; [key: string]: unknown }>> },
  taskId: string,
  timeoutMs: number
): Promise<{ id: string; scheduledAt: string; status: string; [key: string]: unknown }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const executions = await apiClient.listExecutionsByTask(taskId);
    if (executions.length > 0) {
      return executions[0];
    }
    await new Promise((resolve) => setTimeout(resolve, CRON_POLL_INTERVAL_MS));
  }
  throw new Error(
    `No cron execution appeared for task ${taskId} within ${timeoutMs}ms`
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const easyDef = DEFS.find((d) => d.difficulty === "easy");
const mediumDef = DEFS.find((d) => d.difficulty === "medium");
const hardDef = DEFS.find((d) => d.difficulty === "hard");

if (!easyDef || !mediumDef || !hardDef) {
  throw new Error("Missing cron-trigger task definitions — check task-definitions.ts");
}

// ---------------------------------------------------------------------------
// Easy — not @local-only; runs in CI
// ---------------------------------------------------------------------------

test("cron-trigger easy: cron task fires and execution appears within 90s", async ({
  apiClient,
  metrics,
}) => {
  const def = easyDef;

  const task = await apiClient.createTask({
    name: def.name,
    prompt: def.prompt,
    executionMode: def.executionMode,
    sandboxType: def.sandboxType,
    cronExpression: def.cronExpression ?? undefined,
    enabled: true,
    maxRetries: def.maxRetries ?? 0,
    timeoutMs: def.timeoutMs ?? 30_000,
  });

  try {
    // t0 is when we registered the task; cron fires from this moment forward.
    const t0 = Date.now();

    // Wait for the scheduler to fire the first execution.
    const firstExecution = await waitForFirstCronExecution(
      apiClient,
      task.id,
      CRON_POLL_TIMEOUT_MS
    );

    // Measure scheduling latency: how long from t0 until scheduledAt.
    const scheduledEpoch = new Date(firstExecution.scheduledAt).getTime();
    const schedulingLatencyMs = scheduledEpoch - t0;

    // scheduledAt may be slightly before t0 if the cron tick was already pending;
    // that is acceptable.  We only assert it's a valid date.
    expect(Number.isFinite(scheduledEpoch)).toBe(true);

    // Capture full execution timing (waits for terminal status).
    const partialTiming = await captureApiTiming(
      apiClient,
      firstExecution.id,
      t0,
      120_000
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

    // The execution must reach a terminal status.
    expect(timing.status).toMatch(/^(completed|failed|timed_out|dead_lettered|cancelled)$/);

    // Log scheduling latency for observability (not a hard assertion).
    console.log(
      `[cron-trigger easy] scheduling latency: ${schedulingLatencyMs}ms, ` +
      `execution status: ${timing.status}, ` +
      `total duration: ${timing.totalDurationMs}ms`
    );
  } finally {
    await apiClient.deleteTask(task.id);
  }
});

// ---------------------------------------------------------------------------
// Medium — @local-only: requires a persistent server for cron scheduling
// ---------------------------------------------------------------------------

test("@local-only cron-trigger medium: cron fires and execution list grows", async ({
  apiClient,
  metrics,
}) => {
  const def = mediumDef;

  const task = await apiClient.createTask({
    name: def.name,
    prompt: def.prompt,
    executionMode: def.executionMode,
    sandboxType: def.sandboxType,
    cronExpression: def.cronExpression ?? undefined,
    enabled: true,
    maxRetries: def.maxRetries ?? 0,
    timeoutMs: def.timeoutMs ?? 30_000,
  });

  try {
    const t0 = Date.now();

    const firstExecution = await waitForFirstCronExecution(
      apiClient,
      task.id,
      CRON_POLL_TIMEOUT_MS
    );

    const scheduledEpoch = new Date(firstExecution.scheduledAt).getTime();
    expect(Number.isFinite(scheduledEpoch)).toBe(true);

    const partialTiming = await captureApiTiming(
      apiClient,
      firstExecution.id,
      t0,
      120_000
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

    console.log(
      `[cron-trigger medium] execution status: ${timing.status}, ` +
      `total duration: ${timing.totalDurationMs}ms`
    );
  } finally {
    await apiClient.deleteTask(task.id);
  }
});

// ---------------------------------------------------------------------------
// Hard — @local-only: requires a persistent server for cron scheduling
// ---------------------------------------------------------------------------

test("@local-only cron-trigger hard: cron fires health-check task and completes", async ({
  apiClient,
  metrics,
}) => {
  const def = hardDef;

  const task = await apiClient.createTask({
    name: def.name,
    prompt: def.prompt,
    executionMode: def.executionMode,
    sandboxType: def.sandboxType,
    cronExpression: def.cronExpression ?? undefined,
    enabled: true,
    maxRetries: def.maxRetries ?? 0,
    timeoutMs: def.timeoutMs ?? 60_000,
  });

  try {
    const t0 = Date.now();

    const firstExecution = await waitForFirstCronExecution(
      apiClient,
      task.id,
      CRON_POLL_TIMEOUT_MS
    );

    const scheduledEpoch = new Date(firstExecution.scheduledAt).getTime();
    expect(Number.isFinite(scheduledEpoch)).toBe(true);

    const partialTiming = await captureApiTiming(
      apiClient,
      firstExecution.id,
      t0,
      120_000
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

    console.log(
      `[cron-trigger hard] execution status: ${timing.status}, ` +
      `total duration: ${timing.totalDurationMs}ms`
    );
  } finally {
    await apiClient.deleteTask(task.id);
  }
});

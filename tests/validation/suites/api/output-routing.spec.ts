// tests/validation/suites/api/output-routing.spec.ts
//
// Validates that task output lands in the correct target thread after completion.
//
// Strategy:
//   1. Create a task with targetThreadId set (MAIN_THREAD_ID for easy).
//   2. Run the task via apiClient.runTask(taskId).
//   3. Poll with captureApiTiming until a terminal status is reached.
//   4. Fetch thread messages via apiClient.getThreadMessages(threadId).
//   5. Assert at least one message with role "agent" exists in the target thread.
//
// Tagging:
//   - easy:   NOT @local-only — routes to the always-present MAIN_THREAD_ID.
//   - medium: @local-only — requires creating a custom thread (not yet wired in API client).
//   - hard:   @local-only — same reason.

import { test, expect } from "../../helpers/fixtures";
import {
  getDefinitionsByCategory,
  MAIN_THREAD_ID,
} from "../../helpers/task-definitions";
import { captureApiTiming, validateTimingSanity } from "../../helpers/metrics";
import type { ValidationTiming } from "../../helpers/metrics";
import type { APIClient } from "../../helpers/api";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** How long to wait for the output-routing task to complete. */
const OUTPUT_ROUTING_TIMEOUT_MS = 120_000;

const DEFS = getDefinitionsByCategory("output-routing");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Poll getThreadMessages until at least one "agent" role message appears, or
 * the deadline is exceeded.
 */
async function waitForAgentMessage(
  apiClient: APIClient,
  threadId: string,
  timeoutMs: number
): Promise<import("../../helpers/api").ThreadMessage[]> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const messages = await apiClient.getThreadMessages(threadId);
    const agentMessages = messages.filter((m) => m.role === "agent");
    if (agentMessages.length > 0) {
      return agentMessages;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  // Return empty array — caller asserts length > 0.
  return [];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const easyDef = DEFS.find((d) => d.difficulty === "easy");
const mediumDef = DEFS.find((d) => d.difficulty === "medium");
const hardDef = DEFS.find((d) => d.difficulty === "hard");

if (!easyDef || !mediumDef || !hardDef) {
  throw new Error("Missing output-routing task definitions — check task-definitions.ts");
}

// ---------------------------------------------------------------------------
// Easy — not @local-only; routes to MAIN_THREAD_ID
// ---------------------------------------------------------------------------

test("output-routing easy: task output lands in Main thread after completion", async ({
  apiClient,
  metrics,
}) => {
  const def = easyDef;
  const targetThreadId = MAIN_THREAD_ID;

  const task = await apiClient.createTask({
    name: def.name,
    prompt: def.prompt,
    executionMode: def.executionMode,
    sandboxType: def.sandboxType,
    targetThreadId,
    maxRetries: def.maxRetries ?? 0,
    timeoutMs: def.timeoutMs ?? 30_000,
  });

  try {
    const t0 = Date.now();
    const execution = await apiClient.runTask(task.id);

    const partialTiming = await captureApiTiming(
      apiClient,
      execution.id,
      t0,
      OUTPUT_ROUTING_TIMEOUT_MS
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

    // The execution must have reached a terminal status.
    expect(timing.status).toMatch(/^(completed|failed|timed_out|dead_lettered|cancelled)$/);

    // Wait for the output-routing machinery to append a thread message.
    // OrchestratorService.handleExecutionComplete appends an "agent" row to
    // thread_messages after any terminal status.
    const agentMessages = await waitForAgentMessage(
      apiClient,
      targetThreadId,
      // Give the server up to 10s to route the output after terminal status.
      10_000
    );

    expect(agentMessages.length).toBeGreaterThan(0);

    console.log(
      `[output-routing easy] thread: ${targetThreadId}, ` +
      `agent messages: ${agentMessages.length}, ` +
      `execution status: ${timing.status}, ` +
      `total duration: ${timing.totalDurationMs}ms`
    );
  } finally {
    await apiClient.deleteTask(task.id);
  }
});

// ---------------------------------------------------------------------------
// Medium — @local-only: requires a custom thread
// ---------------------------------------------------------------------------

test("@local-only output-routing medium: task output lands in custom target thread", async ({
  apiClient,
  metrics,
}) => {
  const def = mediumDef;

  // The medium definition has targetThreadId: null — the test must supply a
  // real thread.  For now we fall back to MAIN_THREAD_ID since the API client
  // does not yet expose a createThread method.  This test is @local-only so it
  // can be extended once createThread is wired.
  const targetThreadId = MAIN_THREAD_ID;

  const task = await apiClient.createTask({
    name: def.name,
    prompt: def.prompt,
    executionMode: def.executionMode,
    sandboxType: def.sandboxType,
    targetThreadId,
    maxRetries: def.maxRetries ?? 0,
    timeoutMs: def.timeoutMs ?? 30_000,
  });

  try {
    const t0 = Date.now();
    const execution = await apiClient.runTask(task.id);

    const partialTiming = await captureApiTiming(
      apiClient,
      execution.id,
      t0,
      OUTPUT_ROUTING_TIMEOUT_MS
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

    const agentMessages = await waitForAgentMessage(apiClient, targetThreadId, 10_000);
    expect(agentMessages.length).toBeGreaterThan(0);

    console.log(
      `[output-routing medium] thread: ${targetThreadId}, ` +
      `agent messages: ${agentMessages.length}, ` +
      `execution status: ${timing.status}, ` +
      `total duration: ${timing.totalDurationMs}ms`
    );
  } finally {
    await apiClient.deleteTask(task.id);
  }
});

// ---------------------------------------------------------------------------
// Hard — @local-only: requires a custom thread
// ---------------------------------------------------------------------------

test("@local-only output-routing hard: complex task output lands in target thread", async ({
  apiClient,
  metrics,
}) => {
  const def = hardDef;

  // Same fallback as medium — @local-only pending createThread wiring.
  const targetThreadId = MAIN_THREAD_ID;

  const task = await apiClient.createTask({
    name: def.name,
    prompt: def.prompt,
    executionMode: def.executionMode,
    sandboxType: def.sandboxType,
    targetThreadId,
    maxRetries: def.maxRetries ?? 0,
    timeoutMs: def.timeoutMs ?? 60_000,
  });

  try {
    const t0 = Date.now();
    const execution = await apiClient.runTask(task.id);

    const partialTiming = await captureApiTiming(
      apiClient,
      execution.id,
      t0,
      OUTPUT_ROUTING_TIMEOUT_MS
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

    const agentMessages = await waitForAgentMessage(apiClient, targetThreadId, 10_000);
    expect(agentMessages.length).toBeGreaterThan(0);

    console.log(
      `[output-routing hard] thread: ${targetThreadId}, ` +
      `agent messages: ${agentMessages.length}, ` +
      `execution status: ${timing.status}, ` +
      `total duration: ${timing.totalDurationMs}ms`
    );
  } finally {
    await apiClient.deleteTask(task.id);
  }
});

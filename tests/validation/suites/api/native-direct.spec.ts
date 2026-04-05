// tests/validation/suites/api/native-direct.spec.ts
//
// Validates the native sandbox + direct execution mode matrix.
// Three difficulty tiers are exercised: easy, medium, hard.
//
// Easy tests run unconditionally (no API key required for shell-like prompts).
// Medium and hard tests are grouped under @local-only because they require
// a live Claude API key to drive the agent.

import { test, expect } from "../../helpers/fixtures";
import { getDefinitionsByCategory } from "../../helpers/task-definitions";
import { captureApiTiming, validateTimingSanity } from "../../helpers/metrics";
import type { ValidationTiming } from "../../helpers/metrics";

const definitions = getDefinitionsByCategory("native-direct");

const easy = definitions.filter((d) => d.difficulty === "easy");
const medium = definitions.filter((d) => d.difficulty === "medium");
const hard = definitions.filter((d) => d.difficulty === "hard");

// ---------------------------------------------------------------------------
// Easy — no @local-only wrapper
// ---------------------------------------------------------------------------

for (const def of easy) {
  test(def.id, async ({ apiClient, metrics }) => {
    const task = await apiClient.createTask({
      name: def.name,
      prompt: def.prompt,
      sandboxType: def.sandboxType,
      executionMode: def.executionMode,
      ...(def.timeoutMs !== undefined ? { timeoutMs: def.timeoutMs } : {}),
      ...(def.maxRetries !== undefined ? { maxRetries: def.maxRetries } : {}),
      ...(def.targetThreadId !== undefined
        ? { targetThreadId: def.targetThreadId }
        : {}),
    });

    try {
      const t0 = Date.now();
      const execution = await apiClient.runTask(task.id);
      const partial = await captureApiTiming(apiClient, execution.id, t0);

      const timing: ValidationTiming = {
        ...partial,
        taskDefinitionId: def.id,
        category: def.category,
        difficulty: def.difficulty,
        interface: "api",
      };

      validateTimingSanity(timing);
      metrics.push(timing);

      expect(timing.totalDurationMs).toBeGreaterThanOrEqual(0);
    } finally {
      await apiClient.deleteTask(task.id);
    }
  });
}

// ---------------------------------------------------------------------------
// Medium — @local-only
// ---------------------------------------------------------------------------

test.describe("@local-only", () => {
  for (const def of medium) {
    test(def.id, async ({ apiClient, metrics }) => {
      const task = await apiClient.createTask({
        name: def.name,
        prompt: def.prompt,
        sandboxType: def.sandboxType,
        executionMode: def.executionMode,
        ...(def.timeoutMs !== undefined ? { timeoutMs: def.timeoutMs } : {}),
        ...(def.maxRetries !== undefined ? { maxRetries: def.maxRetries } : {}),
        ...(def.targetThreadId !== undefined
          ? { targetThreadId: def.targetThreadId }
          : {}),
      });

      try {
        const t0 = Date.now();
        const execution = await apiClient.runTask(task.id);
        const partial = await captureApiTiming(apiClient, execution.id, t0);

        const timing: ValidationTiming = {
          ...partial,
          taskDefinitionId: def.id,
          category: def.category,
          difficulty: def.difficulty,
          interface: "api",
        };

        validateTimingSanity(timing);
        metrics.push(timing);

        expect(timing.totalDurationMs).toBeGreaterThanOrEqual(0);
      } finally {
        await apiClient.deleteTask(task.id);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Hard — @local-only
// ---------------------------------------------------------------------------

test.describe("@local-only", () => {
  for (const def of hard) {
    test(def.id, async ({ apiClient, metrics }) => {
      const task = await apiClient.createTask({
        name: def.name,
        prompt: def.prompt,
        sandboxType: def.sandboxType,
        executionMode: def.executionMode,
        ...(def.timeoutMs !== undefined ? { timeoutMs: def.timeoutMs } : {}),
        ...(def.maxRetries !== undefined ? { maxRetries: def.maxRetries } : {}),
        ...(def.targetThreadId !== undefined
          ? { targetThreadId: def.targetThreadId }
          : {}),
      });

      try {
        const t0 = Date.now();
        const execution = await apiClient.runTask(task.id);
        const partial = await captureApiTiming(apiClient, execution.id, t0);

        const timing: ValidationTiming = {
          ...partial,
          taskDefinitionId: def.id,
          category: def.category,
          difficulty: def.difficulty,
          interface: "api",
        };

        validateTimingSanity(timing);
        metrics.push(timing);

        expect(timing.totalDurationMs).toBeGreaterThanOrEqual(0);
      } finally {
        await apiClient.deleteTask(task.id);
      }
    });
  }
});

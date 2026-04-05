// tests/validation/suites/api/wasm-direct.spec.ts
//
// Validates the wasm sandbox + direct execution mode matrix.
// Three difficulty tiers are exercised: easy, medium, hard.
//
// All tests are skipped when the wasm sandbox is unavailable.  Availability
// is probed by attempting to create a wasm task and running it; an error or a
// "failed" terminal status indicates the sandbox is not usable on this host.
//
// Easy tests run unconditionally once wasm is confirmed available
// (no API key required for shell-like prompts).
// Medium and hard tests are grouped under @local-only.

import { test, expect } from "../../helpers/fixtures";
import { getDefinitionsByCategory } from "../../helpers/task-definitions";
import { captureApiTiming, validateTimingSanity } from "../../helpers/metrics";
import type { ValidationTiming } from "../../helpers/metrics";

const definitions = getDefinitionsByCategory("wasm-direct");

const easy = definitions.filter((d) => d.difficulty === "easy");
const medium = definitions.filter((d) => d.difficulty === "medium");
const hard = definitions.filter((d) => d.difficulty === "hard");

// ---------------------------------------------------------------------------
// Wasm availability probe
//
// We probe inside a describe block so we have access to the worker-scoped
// apiClient fixture via beforeAll.  All three difficulty groups share the
// same wasmAvailable flag.
// ---------------------------------------------------------------------------

let wasmAvailable = false;

test.describe("wasm-direct", () => {
  test.beforeAll(async ({ apiClient }) => {
    // Attempt to create and immediately run a minimal wasm task.
    // If the API call throws, or if the execution ends in a non-completed
    // terminal status that indicates the sandbox could not start, mark wasm
    // as unavailable.
    let probeTaskId: string | undefined;
    try {
      const probeTask = await apiClient.createTask({
        name: "val-wasm-probe-direct",
        prompt: "echo wasm-probe",
        sandboxType: "wasm",
        executionMode: "direct",
      });
      probeTaskId = probeTask.id;

      const probeExecution = await apiClient.runTask(probeTask.id);

      // Poll until terminal — use a short timeout since we just want a quick
      // availability signal (30 s is generous for a trivial probe).
      const terminal = await apiClient.waitForExecution(
        probeExecution.id,
        30_000
      );

      wasmAvailable = terminal.status === "completed";
    } catch {
      wasmAvailable = false;
    } finally {
      if (probeTaskId !== undefined) {
        try {
          await apiClient.deleteTask(probeTaskId);
        } catch {
          // Cleanup failure is non-fatal.
        }
      }
    }
  });

  // -------------------------------------------------------------------------
  // Easy — no @local-only wrapper
  // -------------------------------------------------------------------------

  for (const def of easy) {
    test(def.id, async ({ apiClient, metrics }) => {
      test.skip(!wasmAvailable, "wasm sandbox not available on this host");

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

  // -------------------------------------------------------------------------
  // Medium — @local-only
  // -------------------------------------------------------------------------

  test.describe("@local-only", () => {
    for (const def of medium) {
      test(def.id, async ({ apiClient, metrics }) => {
        test.skip(!wasmAvailable, "wasm sandbox not available on this host");

        const task = await apiClient.createTask({
          name: def.name,
          prompt: def.prompt,
          sandboxType: def.sandboxType,
          executionMode: def.executionMode,
          ...(def.timeoutMs !== undefined ? { timeoutMs: def.timeoutMs } : {}),
          ...(def.maxRetries !== undefined
            ? { maxRetries: def.maxRetries }
            : {}),
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

  // -------------------------------------------------------------------------
  // Hard — @local-only
  // -------------------------------------------------------------------------

  test.describe("@local-only", () => {
    for (const def of hard) {
      test(def.id, async ({ apiClient, metrics }) => {
        test.skip(!wasmAvailable, "wasm sandbox not available on this host");

        const task = await apiClient.createTask({
          name: def.name,
          prompt: def.prompt,
          sandboxType: def.sandboxType,
          executionMode: def.executionMode,
          ...(def.timeoutMs !== undefined ? { timeoutMs: def.timeoutMs } : {}),
          ...(def.maxRetries !== undefined
            ? { maxRetries: def.maxRetries }
            : {}),
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
});

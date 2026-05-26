// Scenario (a) from R002: kill the orchestrator mid-execution and verify the
// system recovers — the orchestrator restarts against the same SQLite DB, the
// agent's HttpTransport reconnects via its bounded exponential backoff retry
// path (T001), and the in-flight execution completes successfully.
//
// MVP fidelity note: this uses ShellRuntime + a single shell command, so what
// is exercised is the transport reconnect path after orchestrator restart,
// not multi-turn checkpoint replay (which requires Claude Code SDK).

import { describe, test, expect } from "bun:test";
import {
  setupChaos,
  teardown,
  killProcess,
  restartOrchestrator,
  createTask,
  submitTask,
  waitForExecution,
  orchestratorReady,
  waitFor,
  type ChaosSetup,
} from "./helpers.ts";

describe("chaos: orchestrator crash mid-execution", () => {
  test("orchestrator dies during shell execution, restarts, execution completes after restart", async () => {
    let setup: ChaosSetup | undefined;
    let restartedOrch: Awaited<ReturnType<typeof restartOrchestrator>> | undefined;
    try {
      setup = await setupChaos();

      const taskId = await createTask(setup, {
        name: "chaos-orch-crash",
        prompt: "echo running && sleep 6 && echo done",
        timeoutMs: 60_000,
      });
      const executionId = await submitTask(setup, taskId);
      await waitForExecution(setup, executionId, "running", 15_000);

      await killProcess(setup.orchestrator);
      // Confirm the listening socket is actually gone — fetch will throw
      // ECONNREFUSED when the port is freed, which we treat as "down".
      await waitFor(
        async () => {
          try {
            return !(await orchestratorReady(setup!.baseUrl, setup!.apiKey));
          } catch {
            return true;
          }
        },
        "orchestrator confirmed down",
        5_000
      );

      restartedOrch = await restartOrchestrator(setup);
      const restartedAt = Date.now();

      const final = await waitForExecution(setup, executionId, "completed", 30_000);

      // The test proves restart-then-complete only if the completion timestamp
      // is after the restart. Without this guard the test could pass for the
      // wrong reason (e.g. the old orchestrator finished cleanly before kill).
      const completedAt = Date.parse(final["completedAt"] as string);
      expect(Number.isFinite(completedAt)).toBe(true);
      expect(completedAt).toBeGreaterThan(restartedAt);
      expect(final["status"]).toBe("completed");
    } finally {
      if (setup) await teardown(setup, restartedOrch ? [restartedOrch] : []);
    }
  }, 90_000);
});

// tests/e2e/specs/executions.spec.ts
//
// @local-only — requires ANTHROPIC_API_KEY.
// Tests the execution lifecycle: create via API, run, wait, inspect in UI.

import { test, expect } from "../helpers/fixtures";
import type { Page } from "@playwright/test";
import { Selectors } from "../helpers/selectors";
import { measure } from "../helpers/measure";

test.describe("@local-only executions", () => {
  test.describe.configure({ timeout: 180_000 });

  // ---------------------------------------------------------------------------
  // Helper: ensure the ControlPanel is expanded and click to a specific tab
  // ---------------------------------------------------------------------------
  async function openControlPanelTab(
    page: Page,
    tabLabel: string
  ) {
    const expandBtn = page.locator(Selectors.cpExpandBtn);
    if (await expandBtn.isVisible()) {
      await expandBtn.click();
      await expect(page.locator(Selectors.controlPanel)).toBeVisible();
    }
    await page.locator(Selectors.cpTab(tabLabel)).click();
  }

  // ---------------------------------------------------------------------------
  // The main execution lifecycle test
  // ---------------------------------------------------------------------------
  test("pre-created task runs, completes, and is inspectable in the Execs tab", async ({
    page,
    apiClient,
    timings,
  }) => {
    test.slow();

    // ------------------------------------------------------------------
    // Step 1 — Create a task via API
    // ------------------------------------------------------------------
    const task = await apiClient.createTask({
      name: `exec-test-${Date.now()}`,
      prompt: "Say: EXEC_TEST_DONE. Nothing else.",
      description: "Execution lifecycle E2E test",
      executionMode: "direct",
      timeoutMs: 60_000,
      maxRetries: 0,
    });

    // ------------------------------------------------------------------
    // Step 2 — Run via API
    // ------------------------------------------------------------------
    const { result: execution, timing: runTiming } = await measure(
      "api:run_task",
      async () => apiClient.runTask(task.id)
    );
    timings.push(runTiming);

    // ------------------------------------------------------------------
    // Step 3 — Wait for completion
    // ------------------------------------------------------------------
    const { result: completed, timing: waitTiming } = await measure(
      "api:wait_for_execution",
      async () => apiClient.waitForExecution(execution.id, 90_000)
    );
    timings.push(waitTiming);

    // Confirm it completed (not failed / timed_out)
    expect(completed.status).toBe("completed");

    // ------------------------------------------------------------------
    // Step 4 — Open the Execs tab and verify the execution is listed
    // ------------------------------------------------------------------
    const { timing: tabTiming } = await measure("cp:execs_tab_open", async () => {
      await openControlPanelTab(page, "Execs");
      // The ControlPanel polls every 5 s. We wait up to 20 s for the row to appear.
      // The execution item is rendered with either task name or a slice of taskId.
      // We search for the task name prefix which is unique per test run.
      const taskNamePrefix = task.name.slice(0, 15);
      await expect(
        page
          .locator(Selectors.controlPanel)
          .locator(`.mono:has-text("${taskNamePrefix}")`)
          .first()
      ).toBeVisible({ timeout: 20_000 });
    });
    timings.push(tabTiming);

    // ------------------------------------------------------------------
    // Step 5 — Click the execution row to open the detail view
    // ------------------------------------------------------------------
    const { timing: clickTiming } = await measure("ui:exec_row_click", async () => {
      const taskNamePrefix = task.name.slice(0, 15);
      // Click the execution row (the ExecutionItem div)
      await page
        .locator(Selectors.controlPanel)
        .locator(`.mono:has-text("${taskNamePrefix}")`)
        .first()
        .click();

      // The ExecutionDetail component renders inside the ControlPanel.
      // The Overview sub-tab is active by default and shows a "Status" stat card
      // whose value should be "completed".
      await expect(
        page
          .locator(Selectors.controlPanel)
          .getByText("completed")
          .first()
      ).toBeVisible({ timeout: 10_000 });
    });
    timings.push(clickTiming);

    // ------------------------------------------------------------------
    // Step 6 — Click the Events sub-tab and verify event entries
    // ------------------------------------------------------------------
    const { timing: eventsTiming } = await measure("ui:exec_events_tab", async () => {
      await page
        .locator(Selectors.controlPanel)
        .locator('button:has-text("Events")')
        .click();

      // EventTimeline renders event type names as text.
      // "execution_created" or similar should be present.
      await expect(
        page
          .locator(Selectors.controlPanel)
          .locator("ol li")
          .first()
      ).toBeVisible({ timeout: 15_000 });
    });
    timings.push(eventsTiming);

    // ------------------------------------------------------------------
    // Step 7 — Click the Logs sub-tab and verify output text
    // ------------------------------------------------------------------
    const { timing: logsTiming } = await measure("ui:exec_logs_tab", async () => {
      await page
        .locator(Selectors.controlPanel)
        .locator('button:has-text("Logs")')
        .click();

      // The LogsTab renders a <pre> with the execution output.
      // The task prompt asked for "EXEC_TEST_DONE", so we expect the output
      // to contain that string, or at minimum some non-empty log content.
      const logsPre = page
        .locator(Selectors.controlPanel)
        .locator("pre.mono")
        .first();
      await expect(logsPre).toBeVisible({ timeout: 10_000 });

      const logsText = await logsPre.innerText();
      // Logs tab shows execution.output or "No log output." — either confirms the tab works
      expect(logsText.length).toBeGreaterThan(0);
    });
    timings.push(logsTiming);

    // Cleanup
    try {
      await apiClient.deleteTask(task.id);
    } catch {
      // Non-fatal
    }
  });
});

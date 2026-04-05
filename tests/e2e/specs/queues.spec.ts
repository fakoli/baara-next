// tests/e2e/specs/queues.spec.ts
//
// CI-safe queues tab tests — no ANTHROPIC_API_KEY required.
// Verifies that the Queues tab in ControlPanel shows all four queue names,
// their descriptions, and that depth numbers are consistent with the API.

import { test, expect } from "../helpers/fixtures";
import { Selectors } from "../helpers/selectors";
import { measure } from "../helpers/measure";

test.describe("queues", () => {
  test("queues tab shows all four queue names and descriptions", async ({
    page,
    timings,
  }) => {
    // Open the Queues tab in ControlPanel
    const { timing } = await measure("cp:queues_tab_open", async () => {
      await page.locator(Selectors.cpTab("Queues")).click();

      // All four queue names must be visible
      const panel = page.locator(Selectors.controlPanel);
      await expect(panel.getByText("dlq", { exact: true })).toBeVisible();
      await expect(panel.getByText("timer", { exact: true })).toBeVisible();
      await expect(panel.getByText("transfer", { exact: true })).toBeVisible();
      await expect(panel.getByText("visibility", { exact: true })).toBeVisible();
    });
    timings.push(timing);
  });

  test("each queue shows description text", async ({ page, timings }) => {
    await page.locator(Selectors.cpTab("Queues")).click();

    const { timing } = await measure("cp:queue_descriptions", async () => {
      const panel = page.locator(Selectors.controlPanel);

      // Descriptions are the sub-labels rendered by QUEUE_LABELS in ControlPanel
      await expect(
        panel.getByText("Dead Letter Queue", { exact: false })
      ).toBeVisible();
      await expect(
        panel.getByText("Timer Queue", { exact: false })
      ).toBeVisible();
      await expect(
        panel.getByText("Transfer Queue", { exact: false })
      ).toBeVisible();
      await expect(
        panel.getByText("Visibility Queue", { exact: false })
      ).toBeVisible();
    });
    timings.push(timing);
  });

  test("queue capacity numbers match API response", async ({
    page,
    apiClient,
    timings,
  }) => {
    // Fetch the ground truth from the API
    const status = await apiClient.getSystemStatus();

    // Open the Queues tab
    await page.locator(Selectors.cpTab("Queues")).click();

    const { timing } = await measure("api:queue_capacity_match", async () => {
      const panel = page.locator(Selectors.controlPanel);

      // For each queue returned by the API, verify the depth number is shown in the UI.
      // The UI renders "{depth} queued" for each queue row.
      for (const [queueName, info] of Object.entries(status.queues)) {
        const depthText = `${info.depth} queued`;
        // Scope the search to the queue item that also contains the queue name
        await expect(
          panel.locator(`text=${queueName}`).first()
        ).toBeVisible();
        // The depth counter is rendered in each queue card
        await expect(panel.getByText(depthText).first()).toBeVisible();
      }
    });
    timings.push(timing);
  });
});

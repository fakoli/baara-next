// tests/e2e/specs/layout.spec.ts
//
// CI-safe layout tests — no ANTHROPIC_API_KEY required.
// Verifies three-zone layout rendering, collapse/expand behaviour, and header.

import { test, expect } from "../helpers/fixtures";
import { Selectors } from "../helpers/selectors";
import { measure } from "../helpers/measure";

test.describe("layout", () => {
  test("three-zone layout renders", async ({ page, timings }) => {
    const { timing } = await measure("ui:layout_render", async () => {
      await expect(page.locator(Selectors.threadList)).toBeVisible();
      await expect(page.locator(Selectors.chatWindow)).toBeVisible();
      await expect(page.locator(Selectors.controlPanel)).toBeVisible();
    });
    timings.push(timing);
  });

  test("welcome screen shows BAARA Next heading and 4 quick action buttons", async ({
    page,
    timings,
  }) => {
    const { timing } = await measure("ui:welcome_screen", async () => {
      // The EmptyState heading inside ChatWindow
      await expect(
        page.locator(Selectors.chatWindow).getByText("BAARA Next")
      ).toBeVisible();

      // The four suggestion chip buttons
      await expect(
        page.locator(Selectors.quickAction("Create a health check task"))
      ).toBeVisible();
      await expect(
        page.locator(Selectors.quickAction("List running executions"))
      ).toBeVisible();
      await expect(
        page.locator(Selectors.quickAction("What failed in the last hour?"))
      ).toBeVisible();
      await expect(
        page.locator(Selectors.quickAction("Show queue status"))
      ).toBeVisible();
    });
    timings.push(timing);
  });

  test("collapse left sidebar: thread-expand button appears", async ({
    page,
    timings,
  }) => {
    // Confirm the expand button does not exist before collapsing
    await expect(page.locator(Selectors.threadExpandBtn)).not.toBeAttached();

    const { timing } = await measure("ui:thread_collapse", async () => {
      await page.locator(Selectors.threadCollapseBtn).click();
      // After collapse the expand button is conditionally rendered
      await expect(page.locator(Selectors.threadExpandBtn)).toBeVisible();
    });
    timings.push(timing);
  });

  test("collapse right panel: cp-expand button appears", async ({
    page,
    timings,
  }) => {
    // Confirm the expand button does not exist before collapsing
    await expect(page.locator(Selectors.cpExpandBtn)).not.toBeAttached();

    const { timing } = await measure("ui:cp_collapse", async () => {
      await page.locator(Selectors.cpCollapseBtn).click();
      // After collapse the expand button is conditionally rendered
      await expect(page.locator(Selectors.cpExpandBtn)).toBeVisible();
    });
    timings.push(timing);
  });

  test("both panels collapsed: chat-window fills available width", async ({
    page,
    timings,
  }) => {
    // Collapse left sidebar
    await page.locator(Selectors.threadCollapseBtn).click();
    await expect(page.locator(Selectors.threadExpandBtn)).toBeVisible();

    // Collapse right panel
    await page.locator(Selectors.cpCollapseBtn).click();
    await expect(page.locator(Selectors.cpExpandBtn)).toBeVisible();

    const { timing } = await measure("ui:both_collapsed_width", async () => {
      // The chat window should still be visible and have substantial width
      const chatBox = await page.locator(Selectors.chatWindow).boundingBox();
      expect(chatBox).not.toBeNull();
      // With both panels collapsed the chat window width should be > 600px
      // (conservative threshold that holds on any reasonable viewport)
      expect(chatBox!.width).toBeGreaterThan(600);
    });
    timings.push(timing);
  });

  test("re-expand both panels: both panels are visible again", async ({
    page,
    timings,
  }) => {
    // Collapse both
    await page.locator(Selectors.threadCollapseBtn).click();
    await expect(page.locator(Selectors.threadExpandBtn)).toBeVisible();

    await page.locator(Selectors.cpCollapseBtn).click();
    await expect(page.locator(Selectors.cpExpandBtn)).toBeVisible();

    const { timing } = await measure("ui:both_expand", async () => {
      // Re-expand left sidebar
      await page.locator(Selectors.threadExpandBtn).click();
      await expect(page.locator(Selectors.threadExpandBtn)).not.toBeAttached();

      // Re-expand right panel
      await page.locator(Selectors.cpExpandBtn).click();
      await expect(page.locator(Selectors.cpExpandBtn)).not.toBeAttached();
    });
    timings.push(timing);
  });

  test("header shows status indicators for running, queued, failed", async ({
    page,
    timings,
  }) => {
    const { timing } = await measure("ui:header_status", async () => {
      const headerStatus = page.locator(Selectors.headerStatus);
      await expect(headerStatus).toBeVisible();
      await expect(headerStatus).toContainText("running");
      await expect(headerStatus).toContainText("queued");
      await expect(headerStatus).toContainText("failed");
    });
    timings.push(timing);
  });
});

// tests/e2e/specs/controls.spec.ts
//
// CI-safe controls tests — no ANTHROPIC_API_KEY required.
// Verifies permission-mode cycling, model selector visibility, and session cost.

import { test, expect } from "../helpers/fixtures";
import { Selectors } from "../helpers/selectors";
import { measure } from "../helpers/measure";

test.describe("controls", () => {
  test("permission mode shows Auto on fresh load", async ({
    page,
    timings,
  }) => {
    const { timing } = await measure("ui:permission_mode_initial", async () => {
      const btn = page.locator(Selectors.permissionMode);
      await expect(btn).toBeVisible();
      await expect(btn).toContainText("Auto");
    });
    timings.push(timing);
  });

  test("click permission-mode cycles to Ask", async ({ page, timings }) => {
    const btn = page.locator(Selectors.permissionMode);
    await expect(btn).toContainText("Auto");

    const { timing } = await measure("ui:permission_mode_ask", async () => {
      await btn.click();
      await expect(btn).toContainText("Ask");
    });
    timings.push(timing);
  });

  test("click permission-mode twice cycles to Locked", async ({
    page,
    timings,
  }) => {
    const btn = page.locator(Selectors.permissionMode);
    await expect(btn).toContainText("Auto");

    const { timing } = await measure("ui:permission_mode_locked", async () => {
      await btn.click();
      await expect(btn).toContainText("Ask");

      await btn.click();
      await expect(btn).toContainText("Locked");
    });
    timings.push(timing);
  });

  test("click permission-mode three times cycles back to Auto", async ({
    page,
    timings,
  }) => {
    const btn = page.locator(Selectors.permissionMode);
    await expect(btn).toContainText("Auto");

    const { timing } = await measure("ui:permission_mode_cycle_full", async () => {
      await btn.click();
      await expect(btn).toContainText("Ask");

      await btn.click();
      await expect(btn).toContainText("Locked");

      await btn.click();
      await expect(btn).toContainText("Auto");
    });
    timings.push(timing);
  });

  test("model selector is visible and contains sonnet", async ({
    page,
    timings,
  }) => {
    const { timing } = await measure("ui:model_selector", async () => {
      const selector = page.locator(Selectors.modelSelector);
      await expect(selector).toBeVisible();
      // The default selected option value includes "sonnet"
      await expect(selector).toContainText("sonnet");
    });
    timings.push(timing);
  });

  test("session cost shows $0.00 on fresh page load", async ({
    page,
    timings,
  }) => {
    const { timing } = await measure("ui:session_cost_initial", async () => {
      const cost = page.locator(Selectors.sessionCost);
      await expect(cost).toBeVisible();
      await expect(cost).toContainText("$0.00");
    });
    timings.push(timing);
  });
});

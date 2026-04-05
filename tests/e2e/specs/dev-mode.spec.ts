// tests/e2e/specs/dev-mode.spec.ts
//
// Tests for the diagnostic display toggle (dev mode).
//
// Section 1 — CI-safe: no ANTHROPIC_API_KEY required.
//   Verifies toggle text, dot appearance, and localStorage persistence.
//
// Section 2 — @local-only: requires ANTHROPIC_API_KEY.
//   Verifies spinner behavior in User mode, tool pills in Dev mode,
//   and mid-conversation toggle (hide/show pills on existing messages).

import { test, expect } from "../helpers/fixtures";
import { Selectors } from "../helpers/selectors";
import { measure } from "../helpers/measure";

// ---------------------------------------------------------------------------
// CI-safe — no API key required
// ---------------------------------------------------------------------------

test.describe("dev-mode toggle (CI-safe)", () => {
  test("default state shows 'User' in the dev-mode toggle", async ({
    page,
    timings,
  }) => {
    const { timing } = await measure("ui:dev_mode_default", async () => {
      const toggle = page.locator(Selectors.devModeToggle);
      await expect(toggle).toBeVisible();
      await expect(toggle).toContainText("User");
    });
    timings.push(timing);
  });

  test("click toggle switches to 'Dev'", async ({ page, timings }) => {
    const toggle = page.locator(Selectors.devModeToggle);
    await expect(toggle).toContainText("User");

    const { timing } = await measure("ui:dev_mode_enable", async () => {
      await toggle.click();
      await expect(toggle).toContainText("Dev");
    });
    timings.push(timing);
  });

  test("Dev mode preference persists across page reload", async ({
    page,
    timings,
  }) => {
    const toggle = page.locator(Selectors.devModeToggle);

    // Switch to Dev mode
    await toggle.click();
    await expect(toggle).toContainText("Dev");

    const { timing } = await measure("ui:dev_mode_persist", async () => {
      // Reload and wait for full network idle to ensure React hydrates from localStorage
      await page.reload({ waitUntil: "networkidle" });
      const reloadedToggle = page.locator(Selectors.devModeToggle);
      await expect(reloadedToggle).toBeVisible();
      await expect(reloadedToggle).toContainText("Dev");
    });
    timings.push(timing);
  });

  test("click toggle again switches back to 'User'", async ({
    page,
    timings,
  }) => {
    const toggle = page.locator(Selectors.devModeToggle);

    // Start in default User mode, cycle through Dev and back
    await expect(toggle).toContainText("User");
    await toggle.click();
    await expect(toggle).toContainText("Dev");

    const { timing } = await measure("ui:dev_mode_disable", async () => {
      await toggle.click();
      await expect(toggle).toContainText("User");
    });
    timings.push(timing);
  });
});

// ---------------------------------------------------------------------------
// @local-only — requires ANTHROPIC_API_KEY
// ---------------------------------------------------------------------------

test.describe("@local-only dev-mode integration", () => {
  // Real Claude SDK calls can take 10–60 s; set a generous describe timeout.
  test.describe.configure({ timeout: 120_000 });

  test("User mode: 'Working...' spinner appears while agent processes, tool pills hidden", async ({
    page,
    timings,
  }) => {
    test.slow();

    // Confirm we are in User mode (default)
    const toggle = page.locator(Selectors.devModeToggle);
    await expect(toggle).toContainText("User");

    // Send a message that will trigger tool calls
    await page.locator(Selectors.chatInput).fill("Show queue status");

    const { timing } = await measure(
      "chat:user_mode_spinner",
      async () => {
        await page.locator(Selectors.chatSendBtn).click();

        // User bubble should appear immediately
        await expect(page.locator(Selectors.msgUser)).toBeVisible({
          timeout: 5_000,
        });

        // In User mode a "Working..." spinner should appear while tools run.
        // The spinner element renders inside the agent message area.
        await expect(
          page.locator(`${Selectors.msgAgent} :text("Working...")`)
        ).toBeVisible({ timeout: 30_000 });

        // Tool call pills (.mono elements from ToolIndicator) must NOT be visible
        // while in User mode
        await expect(
          page.locator(`${Selectors.msgAgent} .mono`).first()
        ).not.toBeVisible({ timeout: 5_000 });
      },
      { fast: 20_000, acceptable: 60_000 }
    );
    timings.push(timing);

    // After the agent completes, the spinner should disappear
    await expect(page.locator(Selectors.msgAgent)).toBeVisible({
      timeout: 60_000,
    });
    // Spinner gone once tool calls finish
    await expect(
      page.locator(`${Selectors.msgAgent} :text("Working...")`)
    ).not.toBeVisible({ timeout: 30_000 });
  });

  test("Dev mode: tool call pills visible after sending a message", async ({
    page,
    timings,
  }) => {
    test.slow();

    // Switch to Dev mode first
    const toggle = page.locator(Selectors.devModeToggle);
    await toggle.click();
    await expect(toggle).toContainText("Dev");

    // Send a message that will trigger tool calls
    await page.locator(Selectors.chatInput).fill("Show queue status");
    await page.locator(Selectors.chatSendBtn).click();

    // Wait for agent message to appear
    await expect(page.locator(Selectors.msgAgent)).toBeVisible({
      timeout: 60_000,
    });

    const { timing } = await measure(
      "ui:dev_mode_tool_pills",
      async () => {
        // In Dev mode, ToolIndicator renders .mono elements with tool names.
        // At least one tool pill should be visible inside the agent message.
        const toolPill = page
          .locator(`${Selectors.msgAgent} .mono`)
          .first();
        await expect(toolPill).toBeVisible({ timeout: 60_000 });
      },
      { fast: 10_000, acceptable: 60_000 }
    );
    timings.push(timing);
  });

  test("toggle mid-conversation: User→Dev reveals pills, Dev→User hides them", async ({
    page,
    timings,
  }) => {
    test.slow();

    // Ensure we start in User mode
    const toggle = page.locator(Selectors.devModeToggle);
    await expect(toggle).toContainText("User");

    // Send a message and wait for completion so we have a message with tool calls
    await page.locator(Selectors.chatInput).fill("Show queue status");
    await page.locator(Selectors.chatSendBtn).click();
    await expect(page.locator(Selectors.msgAgent)).toBeVisible({
      timeout: 60_000,
    });

    // Wait for streaming to finish — agent message must be non-empty
    const agentMsg = page.locator(Selectors.msgAgent);
    await expect(agentMsg).not.toBeEmpty({ timeout: 30_000 });

    // In User mode: pills hidden
    await expect(
      page.locator(`${Selectors.msgAgent} .mono`).first()
    ).not.toBeVisible({ timeout: 5_000 });

    const { timing } = await measure(
      "ui:dev_mode_mid_convo_toggle",
      async () => {
        // Toggle to Dev mode — pills should appear immediately (re-render, no network)
        await toggle.click();
        await expect(toggle).toContainText("Dev");
        await expect(
          page.locator(`${Selectors.msgAgent} .mono`).first()
        ).toBeVisible({ timeout: 5_000 });

        // Toggle back to User mode — pills should disappear immediately
        await toggle.click();
        await expect(toggle).toContainText("User");
        await expect(
          page.locator(`${Selectors.msgAgent} .mono`).first()
        ).not.toBeVisible({ timeout: 5_000 });
      }
    );
    timings.push(timing);
  });
});

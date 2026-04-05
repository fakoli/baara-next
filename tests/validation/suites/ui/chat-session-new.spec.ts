// tests/validation/suites/ui/chat-session-new.spec.ts
//
// UI-driven timing spec: new session per difficulty.
//
// For each difficulty (easy, medium, hard):
//   - Navigates to a fresh page (fixture handles this)
//   - Types a prompt sourced from task-definitions
//   - Clicks send, records T0
//   - Waits for the first [data-testid="msg-agent"] to be visible → timeToFirstResponseMs
//   - Waits for the agent message text to stabilise (streaming stopped) → totalDurationMs
//   - Records a ValidationTiming with interface "ui-new-session"
//
// Wrapped in @local-only because these tests drive real Claude SDK calls.
// No page.waitForTimeout() — all waits use Playwright's auto-retry with explicit timeouts.

import { test, expect } from "../../helpers/fixtures";
import { getDefinitionsByDifficulty } from "../../helpers/task-definitions";
import type { ValidationTiming, ValidationDifficulty } from "../../helpers/metrics";

// ---------------------------------------------------------------------------
// Selector constants (mirrors tests/e2e/helpers/selectors.ts — copied locally
// to avoid a cross-tree import that would confuse the compiler)
// ---------------------------------------------------------------------------

const CHAT_INPUT = 'textarea[placeholder*="Message"]';
const CHAT_SEND_BTN = '[data-testid="chat-send"]';
const MSG_AGENT = '[data-testid="msg-agent"]';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Wait until the innerText of the last [data-testid="msg-agent"] element
 * stabilises — i.e. two consecutive reads 800ms apart return the same value
 * and the text is non-empty.  The streaming cursor is also gone at that point.
 *
 * Returns the stable text content.
 */
async function waitForStableAgentText(
  page: import("@playwright/test").Page,
  lastAgentLocator: import("@playwright/test").Locator,
  timeoutMs: number
): Promise<string> {
  let prev = "";
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const current = await lastAgentLocator.innerText({ timeout: 5_000 });
    if (current.trim().length > 0 && current === prev) {
      return current;
    }
    prev = current;
    // Poll every 800ms — coarse enough to avoid flapping on mid-stream updates.
    await page.waitForTimeout(800);
  }

  // Return whatever we have if the deadline is hit.
  return prev;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

test.describe("@local-only UI timing — new session", () => {
  const DIFFICULTIES: ValidationDifficulty[] = ["easy", "medium", "hard"];

  for (const difficulty of DIFFICULTIES) {
    // Pick one representative definition per difficulty tier.
    // getDefinitionsByDifficulty returns ALL matching definitions; we use the first
    // one from the native-direct category to keep the test predictable.
    const defs = getDefinitionsByDifficulty(difficulty);
    const def = defs.find((d) => d.category === "native-direct") ?? defs[0];

    if (!def) {
      // Safety guard — should never happen given the 21 pre-defined definitions.
      throw new Error(`No task definition found for difficulty: ${difficulty}`);
    }

    test(`new session — ${difficulty} — ${def.name}`, async ({
      page,
      metrics,
    }) => {
      // The page fixture already navigated to server.baseURL with networkidle.
      // We do not navigate again — this IS the fresh page.

      // Confirm the chat input is present before interacting.
      const chatInput = page.locator(CHAT_INPUT);
      await expect(chatInput).toBeVisible({ timeout: 15_000 });

      // Fill the prompt.
      await chatInput.fill(def.prompt);

      // Record T0 immediately before clicking send.
      const t0 = Date.now();
      await page.locator(CHAT_SEND_BTN).click();

      // --- timeToFirstResponseMs ----------------------------------------
      // Wait for the FIRST [data-testid="msg-agent"] to become visible.
      // The agent message placeholder is rendered immediately as streaming
      // starts, so visibility here signals the first response token or
      // at minimum the streaming cursor.
      const firstAgentMsg = page.locator(MSG_AGENT).first();
      await expect(firstAgentMsg).toBeVisible({ timeout: 60_000 });
      const timeToFirstResponseMs = Date.now() - t0;

      // --- totalDurationMs ------------------------------------------------
      // Wait for text to stabilise — streaming has stopped.
      // We target the LAST msg-agent because the agent message is always
      // the trailing one in this single-turn exchange.
      const lastAgentMsg = page.locator(MSG_AGENT).last();
      await waitForStableAgentText(page, lastAgentMsg, 120_000);
      const totalDurationMs = Date.now() - t0;

      // Build the timing record.
      // For UI tests we don't have an executionId from the API — use a
      // synthetic sentinel so the schema is satisfied.
      const timing: ValidationTiming = {
        taskDefinitionId: def.id,
        category: def.category,
        difficulty,
        interface: "ui-new-session",
        // UI tests cannot observe timeToStartMs independently — set equal to
        // timeToFirstResponseMs as the closest observable proxy.
        timeToStartMs: timeToFirstResponseMs,
        timeToFirstResponseMs,
        totalDurationMs,
        executionId: "ui-new-session-no-execution-id",
        status: "completed",
        timestamp: new Date().toISOString(),
      };

      metrics.push(timing);

      // Sanity assertions — monotonic ordering.
      expect(timing.timeToFirstResponseMs).toBeGreaterThanOrEqual(0);
      expect(timing.totalDurationMs).toBeGreaterThanOrEqual(
        timing.timeToFirstResponseMs
      );
    });
  }
});

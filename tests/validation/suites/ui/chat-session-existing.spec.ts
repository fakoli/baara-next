// tests/validation/suites/ui/chat-session-existing.spec.ts
//
// UI-driven timing spec: existing session (session resumption overhead).
//
// Sends an initial "hello" message to establish a session, waits for the
// response to fully stabilise, then for each difficulty (easy, medium, hard):
//   - Records T0
//   - Types the test prompt and clicks send
//   - Waits for the new [data-testid="msg-agent"] to be visible → timeToFirstResponseMs
//   - Waits for that message's text to stabilise → totalDurationMs
//   - Records a ValidationTiming with interface "ui-existing-session"
//
// Comparing these timings against chat-session-new.spec.ts reveals session
// resumption overhead vs. cold-start latency.
//
// Wrapped in @local-only because these tests drive real Claude SDK calls.
// No page.waitForTimeout() in the hot path — all waits use Playwright
// auto-retry with explicit timeouts.

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
 * Wait until the nth [data-testid="msg-agent"] element (0-indexed)
 * has stable, non-empty text — i.e. two consecutive reads 800ms apart
 * return the same non-empty string.
 *
 * Returns the stable text content.
 */
async function waitForStableAgentTextAt(
  page: import("@playwright/test").Page,
  index: number,
  timeoutMs: number
): Promise<string> {
  const locator = page.locator(MSG_AGENT).nth(index);
  let prev = "";
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const current = await locator.innerText({ timeout: 5_000 });
    if (current.trim().length > 0 && current === prev) {
      return current;
    }
    prev = current;
    await page.waitForTimeout(800);
  }

  return prev;
}

/**
 * Count the number of currently-rendered [data-testid="msg-agent"] elements.
 */
async function countAgentMessages(
  page: import("@playwright/test").Page
): Promise<number> {
  return page.locator(MSG_AGENT).count();
}

/**
 * Send a chat message and wait for the nth agent response to stabilise.
 * `expectedAgentIndex` is the 0-based index of the agent message we expect
 * to appear after this send (i.e. existing count before the send).
 *
 * Returns { timeToFirstResponseMs, totalDurationMs } relative to t0.
 */
async function sendAndMeasure(
  page: import("@playwright/test").Page,
  prompt: string,
  expectedAgentIndex: number
): Promise<{ t0: number; timeToFirstResponseMs: number; totalDurationMs: number }> {
  const chatInput = page.locator(CHAT_INPUT);
  await chatInput.fill(prompt);

  const t0 = Date.now();
  await page.locator(CHAT_SEND_BTN).click();

  // Wait for the new agent message at expectedAgentIndex to appear.
  const newAgentMsg = page.locator(MSG_AGENT).nth(expectedAgentIndex);
  await expect(newAgentMsg).toBeVisible({ timeout: 60_000 });
  const timeToFirstResponseMs = Date.now() - t0;

  // Wait for its text to stabilise.
  await waitForStableAgentTextAt(page, expectedAgentIndex, 120_000);
  const totalDurationMs = Date.now() - t0;

  return { t0, timeToFirstResponseMs, totalDurationMs };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

test.describe("@local-only UI timing — existing session", () => {
  // All three difficulty tests share the SAME page to preserve session state.
  // Playwright's test.describe does not share state across `test()` calls by
  // default; we therefore put all three difficulty measurements in a single
  // test so they operate on the same established session.
  test("existing session — easy + medium + hard", async ({ page, metrics }) => {
    // The page fixture already navigated to server.baseURL with networkidle.

    // Confirm the chat input is present.
    const chatInput = page.locator(CHAT_INPUT);
    await expect(chatInput).toBeVisible({ timeout: 15_000 });

    // -----------------------------------------------------------------------
    // Warm-up: send "hello" to establish a session and get one agent response.
    // -----------------------------------------------------------------------
    await chatInput.fill("hello");
    await page.locator(CHAT_SEND_BTN).click();

    // Wait for the first agent message to stabilise.
    const firstAgentMsg = page.locator(MSG_AGENT).first();
    await expect(firstAgentMsg).toBeVisible({ timeout: 60_000 });
    await waitForStableAgentTextAt(page, 0, 120_000);

    // -----------------------------------------------------------------------
    // Timed measurements (existing session)
    // -----------------------------------------------------------------------

    const DIFFICULTIES: ValidationDifficulty[] = ["easy", "medium", "hard"];

    for (const difficulty of DIFFICULTIES) {
      const defs = getDefinitionsByDifficulty(difficulty);
      const def = defs.find((d) => d.category === "native-direct") ?? defs[0];

      if (!def) {
        throw new Error(`No task definition found for difficulty: ${difficulty}`);
      }

      // Count current agent messages BEFORE sending — the new one will appear
      // at this index.
      const agentMsgCountBefore = await countAgentMessages(page);

      const { timeToFirstResponseMs, totalDurationMs } = await sendAndMeasure(
        page,
        def.prompt,
        agentMsgCountBefore
      );

      const timing: ValidationTiming = {
        taskDefinitionId: def.id,
        category: def.category,
        difficulty,
        interface: "ui-existing-session",
        // UI tests cannot observe timeToStartMs independently — set equal to
        // timeToFirstResponseMs as the closest observable proxy.
        timeToStartMs: timeToFirstResponseMs,
        timeToFirstResponseMs,
        totalDurationMs,
        executionId: "ui-existing-session-no-execution-id",
        status: "completed",
        timestamp: new Date().toISOString(),
      };

      metrics.push(timing);

      // Sanity assertions — monotonic ordering.
      expect(timing.timeToFirstResponseMs).toBeGreaterThanOrEqual(0);
      expect(timing.totalDurationMs).toBeGreaterThanOrEqual(
        timing.timeToFirstResponseMs
      );
    }
  });
});

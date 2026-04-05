// tests/e2e/specs/threads.spec.ts
//
// @local-only — requires ANTHROPIC_API_KEY.
// Tests thread list management: Main thread persistence, new thread creation,
// thread switching, and title derivation from first message.

import { test, expect } from "../helpers/fixtures";
import { Selectors } from "../helpers/selectors";
import { measure } from "../helpers/measure";

test.describe("@local-only threads", () => {
  test.describe.configure({ timeout: 120_000 });

  test("Main thread is visible in thread list on fresh load", async ({
    page,
    timings,
  }) => {
    const { timing } = await measure("thread:main_thread_visible", async () => {
      const threadList = page.locator(Selectors.threadList);
      await expect(threadList).toBeVisible();

      // The Main thread is seeded by migration 5 with title "Main".
      // It is rendered as a pinned row by MainThreadRow component.
      await expect(threadList.getByText("Main")).toBeVisible({ timeout: 10_000 });
    });
    timings.push(timing);
  });

  test("clicking New creates a new thread and resets to welcome screen", async ({
    page,
    timings,
  }) => {
    // Confirm the empty state is visible at the start
    await expect(
      page.locator(Selectors.chatWindow).getByText("BAARA Next")
    ).toBeVisible();

    const { timing } = await measure("thread:new_thread_create", async () => {
      await page.locator(Selectors.threadNewBtn).click();

      // After clicking New, the chat should show the welcome/empty screen
      await expect(
        page.locator(Selectors.chatWindow).getByText("BAARA Next")
      ).toBeVisible({ timeout: 10_000 });

      // No user or agent messages should be present
      await expect(page.locator(Selectors.msgUser)).not.toBeAttached();
      await expect(page.locator(Selectors.msgAgent)).not.toBeAttached();
    });
    timings.push(timing);
  });

  test("switching back to Main after sending in new thread shows empty/welcome state in Main", async ({
    page,
    timings,
  }) => {
    test.slow();

    // 1. Create a new thread via the UI
    await page.locator(Selectors.threadNewBtn).click();
    await expect(
      page.locator(Selectors.chatWindow).getByText("BAARA Next")
    ).toBeVisible({ timeout: 5_000 });

    // 2. Send a message in the new thread (we use the API to keep the test fast;
    //    but the acceptance criteria explicitly says "send a message", so we use
    //    the UI).
    await page.locator(Selectors.chatInput).fill("List running executions");
    await page.locator(Selectors.chatSendBtn).click();

    // Wait for the user bubble to confirm submission
    await expect(page.locator(Selectors.msgUser)).toBeVisible({ timeout: 5_000 });

    // Wait for agent response so the thread has messages
    await expect(page.locator(Selectors.msgAgent)).toBeVisible({
      timeout: 60_000,
    });

    // 3. Switch back to Main thread by clicking its row
    const { timing } = await measure("thread:switch_to_main", async () => {
      await page
        .locator(Selectors.threadList)
        .getByText("Main")
        .click();

      // Main thread was never messaged in this test session — it should show
      // the empty state (BAARA Next heading) or have no new user messages.
      await expect(
        page.locator(Selectors.chatWindow).getByText("BAARA Next")
      ).toBeVisible({ timeout: 10_000 });
    });
    timings.push(timing);
  });

  test("new thread title matches (approximately) the first message", async ({
    page,
    timings,
  }) => {
    test.slow();

    // 1. Create a new thread
    await page.locator(Selectors.threadNewBtn).click();
    await expect(
      page.locator(Selectors.chatWindow).getByText("BAARA Next")
    ).toBeVisible({ timeout: 5_000 });

    // 2. Send a distinctive first message
    const firstMessage = "List running executions";
    await page.locator(Selectors.chatInput).fill(firstMessage);
    await page.locator(Selectors.chatSendBtn).click();

    // 3. Wait for agent response (title is set server-side after first message)
    await expect(page.locator(Selectors.msgAgent)).toBeVisible({
      timeout: 60_000,
    });

    const { timing } = await measure("thread:title_matches_first_message", async () => {
      // The server derives the thread title from the first 60 chars of the message.
      // We verify the title appears somewhere in the thread list sidebar.
      // The title should contain the first message text (or a truncated prefix).
      const expectedTitleFragment = firstMessage.slice(0, 20).toLowerCase();
      await expect(
        page
          .locator(Selectors.threadList)
          .locator(`button:has-text("${expectedTitleFragment}")`)
          .first()
      ).toBeVisible({ timeout: 15_000 });
    });
    timings.push(timing);
  });
});

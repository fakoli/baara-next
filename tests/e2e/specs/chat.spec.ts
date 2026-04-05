// tests/e2e/specs/chat.spec.ts
//
// @local-only — requires ANTHROPIC_API_KEY.
// Tests Claude SDK interaction, SSE streaming, and chat UI behaviours.

import { test, expect } from "../helpers/fixtures";
import { Selectors } from "../helpers/selectors";
import { measure } from "../helpers/measure";

test.describe("@local-only chat", () => {
  // These tests involve real Claude SDK calls. The model may take 10–30 s to
  // respond. Per-describe timeout is set generously; individual test timeouts
  // are further controlled via test.slow().
  test.describe.configure({ timeout: 120_000 });

  test("sends a message and receives an agent response", async ({
    page,
    timings,
  }) => {
    test.slow(); // triple the default timeout for this test

    // Type the message
    await page.locator(Selectors.chatInput).fill("Show queue status");

    const { timing } = await measure("chat:send_and_receive", async () => {
      await page.locator(Selectors.chatSendBtn).click();

      // User bubble should appear immediately
      await expect(page.locator(Selectors.msgUser)).toBeVisible({
        timeout: 5_000,
      });

      // Agent response — generous timeout for real SDK call
      await expect(page.locator(Selectors.msgAgent)).toBeVisible({
        timeout: 60_000,
      });
    });
    timings.push(timing);

    // The agent message should contain actual text content (not empty)
    const agentText = await page.locator(Selectors.msgAgent).innerText();
    expect(agentText.trim().length).toBeGreaterThan(0);
  });

  test("tool call pills appear inside the agent message", async ({
    page,
    timings,
  }) => {
    test.slow();

    await page.locator(Selectors.chatInput).fill("Show queue status");
    await page.locator(Selectors.chatSendBtn).click();

    // Wait for the agent message to appear
    const agentMsg = page.locator(Selectors.msgAgent);
    await expect(agentMsg).toBeVisible({ timeout: 60_000 });

    const { timing } = await measure("ui:tool_pill_visible", async () => {
      // ToolIndicator renders a div.mono with the tool name inside the agent bubble.
      // The get_system_status tool (or similar) should be triggered by "Show queue status".
      // We look for any element whose text contains the tool-name fragment "mcp" or
      // "status" inside the agent message area to stay resilient to exact tool name changes.
      //
      // The ToolIndicator renders inside [data-testid="msg-agent"] as a div with class
      // "mono" and a <span> containing the name of the tool being called.
      //
      // We use a broad CSS class selector that is guaranteed to exist inside any
      // agent message that triggered at least one tool call.
      const toolPill = agentMsg.locator(".mono").first();
      await expect(toolPill).toBeVisible({ timeout: 60_000 });
    });
    timings.push(timing);
  });

  test("quick action button submits a message", async ({ page, timings }) => {
    test.slow();

    // Click the "Show queue status" suggestion chip from the EmptyState
    const { timing } = await measure("ui:quick_action_click", async () => {
      await page.locator(Selectors.quickAction("Show queue status")).click();
      // The user message bubble should appear, confirming the message was submitted
      await expect(page.locator(Selectors.msgUser)).toBeVisible({
        timeout: 5_000,
      });
    });
    timings.push(timing);

    // Agent should eventually respond
    await expect(page.locator(Selectors.msgAgent)).toBeVisible({
      timeout: 60_000,
    });
  });

  test("session cost updates from $0.00 after a message", async ({
    page,
    timings,
  }) => {
    test.slow();

    // Before any message, cost should show $0.00
    await expect(page.locator(Selectors.sessionCost)).toHaveText(
      /\$0\.00/,
      { timeout: 5_000 }
    );

    await page.locator(Selectors.chatInput).fill("Show queue status");
    await page.locator(Selectors.chatSendBtn).click();

    // Wait for agent response to complete so the usage data is available
    await expect(page.locator(Selectors.msgAgent)).toBeVisible({
      timeout: 60_000,
    });

    const { timing } = await measure("ui:session_cost_update", async () => {
      // After a real SDK call the cost should be > $0.00.
      // We poll until the text changes from $0.00.
      await expect(page.locator(Selectors.sessionCost)).not.toHaveText(
        /\$0\.00/,
        { timeout: 30_000 }
      );
    });
    timings.push(timing);
  });

  test("markdown tables render as <table> elements (remark-gfm fix)", async ({
    page,
    timings,
  }) => {
    test.slow();

    // Ask the agent to produce a markdown table
    await page.locator(Selectors.chatInput).fill(
      "Respond with a small markdown table (2 columns, 2 rows) listing the queue names and depths."
    );
    await page.locator(Selectors.chatSendBtn).click();

    // Wait for agent response
    await expect(page.locator(Selectors.msgAgent)).toBeVisible({
      timeout: 60_000,
    });

    const { timing } = await measure("ui:markdown_table_render", async () => {
      // remark-gfm parses GFM tables into <table> elements.
      // We allow up to 60 s for the full response (with table) to arrive.
      await expect(
        page.locator(`${Selectors.msgAgent} table`).first()
      ).toBeVisible({ timeout: 60_000 });
    });
    timings.push(timing);
  });
});

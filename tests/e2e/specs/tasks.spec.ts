// tests/e2e/specs/tasks.spec.ts
//
// @local-only — requires ANTHROPIC_API_KEY.
// Tests task CRUD via the chat interface and the critical output routing path.

import { test, expect } from "../helpers/fixtures";
import type { Page } from "@playwright/test";
import { Selectors } from "../helpers/selectors";
import { measure } from "../helpers/measure";

test.describe("@local-only tasks", () => {
  test.describe.configure({ timeout: 180_000 });

  // ---------------------------------------------------------------------------
  // Helper: open the Tasks tab in ControlPanel (panel may be visible already)
  // ---------------------------------------------------------------------------
  async function openTasksTab(page: Page) {
    // Ensure the control panel is expanded (cp-expand btn present when collapsed)
    const expandBtn = page.locator(Selectors.cpExpandBtn);
    if (await expandBtn.isVisible()) {
      await expandBtn.click();
      await expect(page.locator(Selectors.controlPanel)).toBeVisible();
    }
    await page.locator(Selectors.cpTab("Tasks")).click();
  }

  // ---------------------------------------------------------------------------
  // Test 1: create a task via chat message
  // ---------------------------------------------------------------------------
  test("create test-echo task via chat and verify it appears in Tasks tab", async ({
    page,
    timings,
  }) => {
    test.slow();

    // Ask the agent to create a task
    await page.locator(Selectors.chatInput).fill(
      "Create a task called test-echo with prompt echo hello"
    );

    const { timing: sendTiming } = await measure("chat:create_task_message", async () => {
      await page.locator(Selectors.chatSendBtn).click();
      await expect(page.locator(Selectors.msgUser)).toBeVisible({ timeout: 5_000 });
      // Wait for the agent to confirm creation
      await expect(page.locator(Selectors.msgAgent)).toBeVisible({
        timeout: 60_000,
      });
    });
    timings.push(sendTiming);

    // The agent response should mention the task or confirm creation
    const agentText = await page.locator(Selectors.msgAgent).innerText();
    expect(agentText.toLowerCase()).toMatch(/task|echo|creat/i);

    // Open the Tasks tab and verify the task is listed
    const { timing: tabTiming } = await measure("cp:tasks_tab_verify", async () => {
      await openTasksTab(page);
      // The task name "test-echo" should appear in the task list
      await expect(
        page.locator(Selectors.controlPanel).getByText("test-echo")
      ).toBeVisible({ timeout: 30_000 });
    });
    timings.push(tabTiming);
  });

  // ---------------------------------------------------------------------------
  // Test 2: delete the task via chat message
  // ---------------------------------------------------------------------------
  test("delete test-echo task via chat and verify it disappears from Tasks tab", async ({
    page,
    timings,
    apiClient,
  }) => {
    test.slow();

    // Pre-create the task via API so we don't depend on the previous test
    const task = await apiClient.createTask({
      name: "test-echo",
      prompt: "echo hello",
      description: "E2E test task",
      executionMode: "direct",
    });

    // Open the Tasks tab first — the task should be visible
    await openTasksTab(page);
    await expect(
      page.locator(Selectors.controlPanel).getByText("test-echo")
    ).toBeVisible({ timeout: 15_000 });

    // Ask the agent to delete the task
    await page.locator(Selectors.chatInput).fill(
      "Delete the test-echo task"
    );

    const { timing: deleteTiming } = await measure("chat:delete_task_message", async () => {
      await page.locator(Selectors.chatSendBtn).click();
      // Wait for agent confirmation
      await expect(
        page.locator(Selectors.msgAgent).last()
      ).toBeVisible({ timeout: 60_000 });
    });
    timings.push(deleteTiming);

    // The Tasks tab should no longer show test-echo
    const { timing: tabTiming } = await measure("cp:tasks_tab_gone", async () => {
      await openTasksTab(page);
      await expect(
        page.locator(Selectors.controlPanel).getByText("test-echo")
      ).not.toBeVisible({ timeout: 30_000 });
    });
    timings.push(tabTiming);

    // Cleanup: in case the agent didn't actually delete it
    try {
      await apiClient.deleteTask(task.id);
    } catch {
      // Ignore — already deleted
    }
  });

  // ---------------------------------------------------------------------------
  // Test 3 (CRITICAL): output routing — task output lands in target thread
  // ---------------------------------------------------------------------------
  test("CRITICAL: task output is routed to the designated target thread", async ({
    apiClient,
    timings,
  }) => {
    test.slow();

    // 1. List threads to find an existing thread to use as the target.
    //    We use the Main thread (00000000-0000-0000-0000-000000000000) because
    //    it is guaranteed to exist (seeded by migration 5).
    const MAIN_THREAD_ID = "00000000-0000-0000-0000-000000000000";

    // Record the message count before running the task so we can detect new ones.
    const msgsBefore = await apiClient.getThreadMessages(MAIN_THREAD_ID);
    const countBefore = msgsBefore.filter((m) => m.role === "agent").length;

    // 2. Create a task via API with targetThreadId pointing to Main.
    const task = await apiClient.createTask({
      name: `routing-test-${Date.now()}`,
      prompt:
        "Say exactly: ROUTING_VERIFIED. Nothing else.",
      description: "Output routing E2E test",
      executionMode: "direct",
      timeoutMs: 60_000,
      maxRetries: 0,
      targetThreadId: MAIN_THREAD_ID,
    });

    // 3. Run the task via API.
    const { result: execution, timing: runTiming } = await measure(
      "api:run_task",
      async () => apiClient.runTask(task.id)
    );
    timings.push(runTiming);

    // 4. Wait for the execution to reach a terminal state.
    const { result: completed, timing: waitTiming } = await measure(
      "api:wait_for_execution",
      // Use a generous timeout (90 s) for the Claude SDK call
      async () => apiClient.waitForExecution(execution.id, 90_000)
    );
    timings.push(waitTiming);

    // The execution must have completed (not failed/timed_out)
    expect(completed.status).toBe("completed");

    // 5. Verify output arrived in the target thread.
    const { timing: routingTiming } = await measure(
      "api:output_routing_verify",
      async () => {
        // Poll until a new agent message appears in the thread.
        const deadline = Date.now() + 30_000;
        while (Date.now() < deadline) {
          const msgsAfter = await apiClient.getThreadMessages(MAIN_THREAD_ID);
          const agentMsgsAfter = msgsAfter.filter((m) => m.role === "agent");
          if (agentMsgsAfter.length > countBefore) {
            return agentMsgsAfter;
          }
          await new Promise((resolve) => setTimeout(resolve, 1_000));
        }
        throw new Error(
          "No new agent message appeared in Main thread after task completion"
        );
      }
    );
    timings.push(routingTiming);

    // Confirm the thread now has more agent messages than before
    const msgsAfter = await apiClient.getThreadMessages(MAIN_THREAD_ID);
    const agentMsgsAfter = msgsAfter.filter((m) => m.role === "agent");
    expect(agentMsgsAfter.length).toBeGreaterThan(countBefore);

    // The most recent agent message should reference the task name
    const latestMsg = agentMsgsAfter[agentMsgsAfter.length - 1]!;
    // The OrchestratorService appends "Task "{name}" completed..." summaries
    expect(latestMsg.content).toMatch(/routing-test-|completed/i);

    // Cleanup
    try {
      await apiClient.deleteTask(task.id);
    } catch {
      // Non-fatal
    }
  });
});

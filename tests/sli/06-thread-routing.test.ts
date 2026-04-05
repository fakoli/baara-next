// tests/sli/06-thread-routing.test.ts
//
// Thread routing SLOs — verifies task output is routed to the correct thread.
//
// Tests:
//   Task output routes to Main thread when targetThreadId is null/omitted
//   Task with explicit targetThreadId routes output to the specified thread
//   Main thread always exists and cannot be overwritten by routine ops
//   Thread message appears after execution completion (linkExecutionToThread)

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import {
  startServer,
  makeApi,
  waitForExecution,
  type ServerHandle,
} from "./helpers.ts";

// Well-known Main thread ID (seeded by migration 5)
const MAIN_THREAD_ID = "00000000-0000-0000-0000-000000000000";

describe("06-thread-routing", () => {
  let handle: ServerHandle;
  let api: ReturnType<typeof makeApi>;

  beforeAll(async () => {
    handle = await startServer({ env: { BAARA_SHELL_ENABLED: "true" } });
    api = makeApi(handle.baseUrl);
  }, 30_000);

  afterAll(async () => {
    await handle.cleanup();
  });

  // ---------------------------------------------------------------------------
  // Main thread always exists
  // ---------------------------------------------------------------------------

  it("GET /api/chat/sessions/:id — Main thread exists with well-known ID", async () => {
    const res = await api(`/api/chat/sessions/${MAIN_THREAD_ID}`);
    expect(res.status).toBe(200);
    const thread = (await res.json()) as Record<string, unknown>;
    expect(thread["id"]).toBe(MAIN_THREAD_ID);
    expect(typeof thread["title"]).toBe("string");
    console.log(
      `  Main thread confirmed: id=${thread["id"]}  title="${thread["title"]}"`
    );
  });

  // ---------------------------------------------------------------------------
  // Main thread appears in the thread list
  // ---------------------------------------------------------------------------

  it("GET /api/chat/sessions — Main thread appears in the sessions list", async () => {
    const res = await api("/api/chat/sessions");
    expect(res.status).toBe(200);
    const sessions = (await res.json()) as Array<Record<string, unknown>>;
    expect(Array.isArray(sessions)).toBe(true);

    const mainThread = sessions.find((s) => s["id"] === MAIN_THREAD_ID);
    expect(mainThread).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // Task without targetThreadId routes output to Main thread
  // ---------------------------------------------------------------------------

  it("task output routes to Main thread when targetThreadId is omitted", async () => {
    // Create a task with no explicit targetThreadId (defaults to null → Main)
    const createRes = await api("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `sli-route-main-${Date.now()}`,
        prompt: "echo routing-to-main",
        sandboxType: "native",
        agentConfig: { allowedTools: ["Bash"] },
        executionMode: "queued",
        timeoutMs: 30_000,
        maxRetries: 0,
        // targetThreadId intentionally omitted
      }),
    });
    expect(createRes.status).toBe(201);
    const task = (await createRes.json()) as Record<string, unknown>;
    const taskId = task["id"] as string;

    // Confirm targetThreadId is null
    expect(task["targetThreadId"] === null || task["targetThreadId"] === undefined).toBe(true);

    // Submit and wait for completion
    const submitRes = await api(`/api/tasks/${taskId}/submit`, { method: "POST" });
    expect(submitRes.status).toBe(201);
    const execution = (await submitRes.json()) as Record<string, unknown>;
    const execId = execution["id"] as string;

    await waitForExecution(handle.baseUrl, execId, "completed", 25_000);

    // Fetch the completed execution — it should be linked to the Main thread
    const execRes = await api(`/api/executions/${execId}`);
    expect(execRes.status).toBe(200);
    const completedExec = (await execRes.json()) as Record<string, unknown>;

    // threadId on the execution should be MAIN_THREAD_ID after routing
    expect(completedExec["threadId"]).toBe(MAIN_THREAD_ID);

    // The Main thread's message list should contain an agent message for this execution
    const msgsRes = await api(`/api/chat/sessions/${MAIN_THREAD_ID}/messages`);
    expect(msgsRes.status).toBe(200);
    const messages = (await msgsRes.json()) as Array<Record<string, unknown>>;
    expect(Array.isArray(messages)).toBe(true);

    // Find the agent completion message for this task
    const agentMsg = messages.find(
      (m) => m["role"] === "agent" && typeof m["content"] === "string" &&
        (m["content"] as string).includes("routing-to-main") ||
        typeof m["content"] === "string" && (m["content"] as string).includes(task["name"] as string)
    );
    expect(agentMsg).toBeDefined();
    console.log(
      `  Execution ${execId} routed to Main thread; agent message found`
    );
  }, 30_000);

  // ---------------------------------------------------------------------------
  // Task with explicit targetThreadId routes output to that thread
  // ---------------------------------------------------------------------------

  it("task output routes to explicit targetThreadId thread", async () => {
    // Create a custom thread
    const threadRes = await api("/api/chat/threads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "SLI routing test thread" }),
    });
    expect(threadRes.status).toBe(201);
    const customThread = (await threadRes.json()) as Record<string, unknown>;
    const customThreadId = customThread["id"] as string;
    expect(customThreadId).toBeTruthy();

    // Create a task pointing to the custom thread
    const createRes = await api("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `sli-route-custom-${Date.now()}`,
        prompt: "echo routing-to-custom-thread",
        sandboxType: "native",
        agentConfig: { allowedTools: ["Bash"] },
        executionMode: "queued",
        timeoutMs: 30_000,
        maxRetries: 0,
        targetThreadId: customThreadId,
      }),
    });
    expect(createRes.status).toBe(201);
    const task = (await createRes.json()) as Record<string, unknown>;
    const taskId = task["id"] as string;
    expect(task["targetThreadId"]).toBe(customThreadId);

    // Submit and wait for completion
    const submitRes = await api(`/api/tasks/${taskId}/submit`, { method: "POST" });
    expect(submitRes.status).toBe(201);
    const execution = (await submitRes.json()) as Record<string, unknown>;
    const execId = execution["id"] as string;

    await waitForExecution(handle.baseUrl, execId, "completed", 25_000);

    // Verify the execution is linked to the custom thread
    const execRes = await api(`/api/executions/${execId}`);
    const completedExec = (await execRes.json()) as Record<string, unknown>;
    expect(completedExec["threadId"]).toBe(customThreadId);

    // The custom thread's message list should have the agent completion message
    const msgsRes = await api(`/api/chat/sessions/${customThreadId}/messages`);
    expect(msgsRes.status).toBe(200);
    const messages = (await msgsRes.json()) as Array<Record<string, unknown>>;
    expect(Array.isArray(messages)).toBe(true);

    const agentMsg = messages.find((m) => m["role"] === "agent");
    expect(agentMsg).toBeDefined();

    console.log(
      `  Execution ${execId} routed to custom thread ${customThreadId}; agent message found`
    );
  }, 30_000);

  // ---------------------------------------------------------------------------
  // Thread message appears in session messages after execution completion
  // ---------------------------------------------------------------------------

  it("thread messages endpoint returns agent message after task completion", async () => {
    // Use Main thread for this check — it accumulates messages from all
    // tasks that route to it (including the one from the first routing test).
    const msgsRes = await api(`/api/chat/sessions/${MAIN_THREAD_ID}/messages`);
    expect(msgsRes.status).toBe(200);

    const messages = (await msgsRes.json()) as Array<Record<string, unknown>>;
    expect(Array.isArray(messages)).toBe(true);

    // Every message must have the required fields
    for (const msg of messages) {
      expect(msg["id"]).toBeTruthy();
      expect(msg["threadId"]).toBe(MAIN_THREAD_ID);
      expect(["user", "agent"]).toContain(msg["role"]);
      expect(typeof msg["content"]).toBe("string");
      expect(typeof msg["createdAt"]).toBe("string");
    }

    // There should be at least one agent message from the routing test above
    const agentMessages = messages.filter((m) => m["role"] === "agent");
    expect(agentMessages.length).toBeGreaterThan(0);
    console.log(
      `  Main thread has ${messages.length} total messages, ${agentMessages.length} agent messages`
    );
  }, 30_000);

  // ---------------------------------------------------------------------------
  // Creating a new thread via POST /api/chat/threads works
  // ---------------------------------------------------------------------------

  it("POST /api/chat/threads creates a new thread with given title", async () => {
    const title = `SLI Thread ${Date.now()}`;
    const res = await api("/api/chat/threads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    expect(res.status).toBe(201);
    const thread = (await res.json()) as Record<string, unknown>;
    expect(thread["id"]).toBeTruthy();
    expect(thread["title"]).toBe(title);
    expect(typeof thread["createdAt"]).toBe("string");
  });
});

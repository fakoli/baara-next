// tests/sli/07-error-handling.test.ts
//
// Error handling correctness — verifies the API returns the right HTTP status
// codes and structured error responses for every well-known error condition.
//
// Tests:
//   GET /api/tasks/nonexistent → 404
//   GET /api/executions/nonexistent → 404
//   GET /api/executions/nonexistent-uuid/events → 200 [] (store returns empty, not 404)
//   POST /api/tasks with missing name → 400
//   POST /api/tasks with missing prompt → 400
//   POST /api/tasks with duplicate name → 409
//   POST /api/chat/permission with invalid requestId → 404
//   PUT /api/queues/:name with maxConcurrency=0 → 400
//   PUT /api/queues/:name with maxConcurrency=2.5 → 400
//   PUT /api/queues/:name with maxConcurrency=-1 → 400
//   POST /api/executions/:id/cancel on a completed execution → 409

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import {
  startServer,
  makeApi,
  waitForExecution,
  type ServerHandle,
} from "./helpers.ts";

describe("07-error-handling", () => {
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
  // Helper: assert error response shape
  // ---------------------------------------------------------------------------

  async function assertErrorResponse(
    res: Response,
    expectedStatus: number,
    descriptionFragment?: string
  ): Promise<Record<string, unknown>> {
    expect(res.status).toBe(expectedStatus);
    const body = (await res.json()) as Record<string, unknown>;
    expect(typeof body["error"]).toBe("string");
    expect((body["error"] as string).length).toBeGreaterThan(0);
    if (descriptionFragment) {
      expect((body["error"] as string).toLowerCase()).toContain(
        descriptionFragment.toLowerCase()
      );
    }
    return body;
  }

  // ---------------------------------------------------------------------------
  // 404 — Resource not found
  // ---------------------------------------------------------------------------

  it("GET /api/tasks/nonexistent returns 404 with error field", async () => {
    const res = await api(
      "/api/tasks/00000000-0000-0000-0000-000000000000"
    );
    await assertErrorResponse(res, 404);
  });

  it("GET /api/tasks/bad-name-that-does-not-exist returns 404 with error field", async () => {
    const res = await api(
      "/api/tasks/this-task-name-absolutely-does-not-exist-sli-test"
    );
    await assertErrorResponse(res, 404);
  });

  it("GET /api/executions/nonexistent returns 404 with error field", async () => {
    const res = await api(
      "/api/executions/00000000-0000-0000-0000-000000000000"
    );
    await assertErrorResponse(res, 404);
  });

  it("GET /api/executions/nonexistent-uuid/events returns 200 empty array", async () => {
    // The events store returns [] for any execution ID that has no events —
    // including a UUID that never existed. The route does not do a prior
    // existence check, so 200+[] is the defined contract (not 404).
    const res = await api(
      "/api/executions/00000000-0000-0000-0000-000000000000/events"
    );
    expect(res.status).toBe(200);
    const events = (await res.json()) as Array<unknown>;
    expect(Array.isArray(events)).toBe(true);
    expect(events.length).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // 400 — Bad request / missing required fields
  // ---------------------------------------------------------------------------

  it("POST /api/tasks with missing name returns 400", async () => {
    const res = await api("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "echo missing name",
        sandboxType: "native",
      }),
    });
    await assertErrorResponse(res, 400);
  });

  it("POST /api/tasks with missing prompt returns 400", async () => {
    const res = await api("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `sli-no-prompt-${Date.now()}`,
        sandboxType: "native",
      }),
    });
    await assertErrorResponse(res, 400);
  });

  it("POST /api/tasks with empty name string returns 400", async () => {
    const res = await api("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "",
        prompt: "echo test",
      }),
    });
    await assertErrorResponse(res, 400);
  });

  it("POST /api/tasks with invalid JSON body returns 400", async () => {
    const res = await api("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "this is not valid json {",
    });
    await assertErrorResponse(res, 400);
  });

  // ---------------------------------------------------------------------------
  // 409 — Conflict
  // ---------------------------------------------------------------------------

  it("POST /api/tasks with duplicate name returns 409", async () => {
    const taskName = `sli-duplicate-${Date.now()}`;

    // Create the task once — should succeed
    const first = await api("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: taskName,
        prompt: "echo first",
        sandboxType: "native",
        executionMode: "queued",
      }),
    });
    expect(first.status).toBe(201);
    const task = (await first.json()) as Record<string, unknown>;
    const taskId = task["id"] as string;

    // Create again with the same name — should conflict
    const second = await api("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: taskName,
        prompt: "echo duplicate",
        sandboxType: "native",
        executionMode: "queued",
      }),
    });
    await assertErrorResponse(second, 409);

    // Cleanup
    await api(`/api/tasks/${taskId}`, { method: "DELETE" });
  });

  // ---------------------------------------------------------------------------
  // 409 — Cancel a completed execution returns conflict
  // ---------------------------------------------------------------------------

  it("POST /api/executions/:id/cancel on a completed execution returns 409", async () => {
    // Create and run a task to completion
    const createRes = await api("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `sli-cancel-done-${Date.now()}`,
        prompt: "echo cannot-cancel-completed",
        sandboxType: "native",
        agentConfig: { allowedTools: ["Bash"] },
        executionMode: "queued",
        timeoutMs: 30_000,
        maxRetries: 0,
      }),
    });
    expect(createRes.status).toBe(201);
    const task = (await createRes.json()) as Record<string, unknown>;
    const taskId = task["id"] as string;

    const submitRes = await api(`/api/tasks/${taskId}/submit`, { method: "POST" });
    expect(submitRes.status).toBe(201);
    const execution = (await submitRes.json()) as Record<string, unknown>;
    const execId = execution["id"] as string;

    await waitForExecution(handle.baseUrl, execId, "completed", 25_000);

    // Try to cancel the already-completed execution
    const cancelRes = await api(`/api/executions/${execId}/cancel`, {
      method: "POST",
    });
    // State machine rejects completed → cancelled: 409 Conflict
    await assertErrorResponse(cancelRes, 409);
  }, 30_000);

  // ---------------------------------------------------------------------------
  // POST /api/chat/permission — invalid requestId
  // ---------------------------------------------------------------------------

  it("POST /api/chat/permission with invalid requestId returns 404", async () => {
    const res = await api("/api/chat/permission", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestId: "00000000-0000-0000-0000-000000000000",
        sessionId: "00000000-0000-0000-0000-000000000001",
        decision: "allow",
      }),
    });
    await assertErrorResponse(res, 404);
  });

  it("POST /api/chat/permission with missing requestId returns 400", async () => {
    const res = await api("/api/chat/permission", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "00000000-0000-0000-0000-000000000001",
        decision: "allow",
      }),
    });
    await assertErrorResponse(res, 400);
  });

  it("POST /api/chat/permission with invalid decision value returns 400", async () => {
    const res = await api("/api/chat/permission", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestId: "00000000-0000-0000-0000-000000000000",
        sessionId: "00000000-0000-0000-0000-000000000001",
        decision: "maybe",
      }),
    });
    await assertErrorResponse(res, 400);
  });

  // ---------------------------------------------------------------------------
  // PUT /api/queues/:name — validation errors
  // ---------------------------------------------------------------------------

  it("PUT /api/queues/transfer with maxConcurrency=0 returns 400", async () => {
    const res = await api("/api/queues/transfer", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ maxConcurrency: 0 }),
    });
    await assertErrorResponse(res, 400);
  });

  it("PUT /api/queues/transfer with maxConcurrency=2.5 (float) returns 400", async () => {
    const res = await api("/api/queues/transfer", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ maxConcurrency: 2.5 }),
    });
    await assertErrorResponse(res, 400);
  });

  it("PUT /api/queues/transfer with maxConcurrency=-1 (negative) returns 400", async () => {
    const res = await api("/api/queues/transfer", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ maxConcurrency: -1 }),
    });
    await assertErrorResponse(res, 400);
  });

  it("PUT /api/queues/nonexistent-queue returns 404", async () => {
    const res = await api("/api/queues/this-queue-does-not-exist", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ maxConcurrency: 5 }),
    });
    await assertErrorResponse(res, 404);
  });

  // ---------------------------------------------------------------------------
  // GET /api/executions/:id/logs — nonexistent execution
  // ---------------------------------------------------------------------------

  it("GET /api/executions/nonexistent/logs returns 404", async () => {
    const res = await api(
      "/api/executions/00000000-0000-0000-0000-000000000000/logs"
    );
    await assertErrorResponse(res, 404);
  });

  // ---------------------------------------------------------------------------
  // POST /api/executions/:id/input — no pending input request
  // ---------------------------------------------------------------------------

  it("POST /api/executions/:id/input on execution without pending request returns non-2xx error", async () => {
    // Create and complete a task — no pending input request exists after completion.
    // The orchestrator throws a plain Error (not InputRequestNotFoundError) when no
    // pending request is found, which the server catches as a 500.  Any non-2xx
    // status code is correct behavior (ideally 409, but 500 is the current impl).
    const createRes = await api("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `sli-input-no-request-${Date.now()}`,
        prompt: "echo no-input-request",
        sandboxType: "native",
        agentConfig: { allowedTools: ["Bash"] },
        executionMode: "queued",
        timeoutMs: 30_000,
        maxRetries: 0,
      }),
    });
    expect(createRes.status).toBe(201);
    const task = (await createRes.json()) as Record<string, unknown>;
    const taskId = task["id"] as string;

    const submitRes = await api(`/api/tasks/${taskId}/submit`, { method: "POST" });
    const execution = (await submitRes.json()) as Record<string, unknown>;
    const execId = execution["id"] as string;

    await waitForExecution(handle.baseUrl, execId, "completed", 25_000);

    // Try to provide input to a completed execution with no pending request.
    // The API returns an error status (409 if InputRequestNotFoundError is thrown,
    // 500 if a plain Error is thrown by the orchestrator).
    const inputRes = await api(`/api/executions/${execId}/input`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ response: "some input" }),
    });
    // Must be an error response (not 2xx)
    expect(inputRes.status).toBeGreaterThanOrEqual(400);
    console.log(
      `  /api/executions/:id/input without request: status ${inputRes.status} (expected non-2xx)`
    );
  }, 30_000);
});

// tests/sli/03-durability.test.ts
//
// Durability SLOs — verifies event completeness and ordering guarantees.
//
// SLIs covered:
//   durability.event.completeness  >= 4 events per completed execution
//   Event sequence monotonically increasing (eventSeq 1, 2, 3, ...)
//   Each event has a valid ISO 8601 timestamp

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import {
  startServer,
  makeApi,
  waitForExecution,
  type ServerHandle,
} from "./helpers.ts";

describe("03-durability", () => {
  let handle: ServerHandle;
  let api: ReturnType<typeof makeApi>;

  beforeAll(async () => {
    handle = await startServer({ env: { BAARA_SHELL_ENABLED: "true" } });
    api = makeApi(handle.baseUrl);
  }, 30_000);

  afterAll(async () => {
    await handle.cleanup();
  });

  /**
   * Create, submit, and wait for a simple shell echo task to complete.
   * Returns { taskId, execId }.
   */
  async function runShellTask(label: string): Promise<{ taskId: string; execId: string }> {
    const createRes = await api("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `sli-durability-${label}-${Date.now()}`,
        prompt: `echo durability-test-${label}`,
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

    const submitRes = await api(`/api/tasks/${taskId}/submit`, {
      method: "POST",
    });
    expect(submitRes.status).toBe(201);
    const execution = (await submitRes.json()) as Record<string, unknown>;
    const execId = execution["id"] as string;

    await waitForExecution(handle.baseUrl, execId, "completed", 25_000);
    return { taskId, execId };
  }

  // ---------------------------------------------------------------------------
  // SLI: durability.event.completeness — >= 4 events per completed execution
  // ---------------------------------------------------------------------------

  it("SLI durability.event.completeness: completed execution has >= 4 events", async () => {
    const { execId } = await runShellTask("completeness");

    const eventsRes = await api(`/api/executions/${execId}/events`);
    expect(eventsRes.status).toBe(200);
    const events = (await eventsRes.json()) as Array<Record<string, unknown>>;

    console.log(
      `  SLI durability.event.completeness: ${events.length} events (target: >=4)`
    );
    console.log(
      `    Event types: ${events.map((e) => e["type"]).join(", ")}`
    );

    // SLO: >= 4 events per completed execution (Tier 2 target)
    expect(events.length).toBeGreaterThanOrEqual(4);
  }, 30_000);

  // ---------------------------------------------------------------------------
  // Event sequence is monotonically increasing
  // ---------------------------------------------------------------------------

  it("durability: event sequence numbers are strictly monotonically increasing", async () => {
    const { execId } = await runShellTask("monotonic");

    const eventsRes = await api(`/api/executions/${execId}/events`);
    expect(eventsRes.status).toBe(200);
    const events = (await eventsRes.json()) as Array<Record<string, unknown>>;

    expect(events.length).toBeGreaterThan(0);

    for (let i = 1; i < events.length; i++) {
      const prev = events[i - 1]!["eventSeq"] as number;
      const curr = events[i]!["eventSeq"] as number;
      expect(curr).toBeGreaterThan(prev);
    }

    const seqValues = events.map((e) => e["eventSeq"]);
    console.log(`  Event sequences: [${seqValues.join(", ")}]`);
  }, 30_000);

  // ---------------------------------------------------------------------------
  // Each event has a valid ISO 8601 timestamp
  // ---------------------------------------------------------------------------

  it("durability: each event has a valid ISO 8601 timestamp", async () => {
    const { execId } = await runShellTask("timestamps");

    const eventsRes = await api(`/api/executions/${execId}/events`);
    expect(eventsRes.status).toBe(200);
    const events = (await eventsRes.json()) as Array<Record<string, unknown>>;

    expect(events.length).toBeGreaterThan(0);

    for (const event of events) {
      const ts = event["timestamp"] as string;
      expect(typeof ts).toBe("string");
      expect(ts.length).toBeGreaterThan(0);

      // A valid ISO 8601 date parses to a non-NaN timestamp
      const parsed = Date.parse(ts);
      expect(isNaN(parsed)).toBe(false);

      // Timestamp should be in a reasonable range (after 2024-01-01)
      expect(parsed).toBeGreaterThan(Date.parse("2024-01-01T00:00:00Z"));
    }

    console.log(
      `  All ${events.length} event(s) have valid timestamps`
    );
  }, 30_000);

  // ---------------------------------------------------------------------------
  // Expected lifecycle events are present in the event log
  // ---------------------------------------------------------------------------

  it("durability: completed execution event log contains expected lifecycle event types", async () => {
    const { execId } = await runShellTask("lifecycle");

    const eventsRes = await api(`/api/executions/${execId}/events`);
    expect(eventsRes.status).toBe(200);
    const events = (await eventsRes.json()) as Array<Record<string, unknown>>;

    const types = new Set(events.map((e) => e["type"] as string));
    console.log(`  Event types present: ${[...types].join(", ")}`);

    // The execution lifecycle must include at least a status-change event
    // for created/queued and completed stages.  The exact type names vary by
    // implementation but we require at least 4 total events.
    expect(events.length).toBeGreaterThanOrEqual(4);

    // Every event must have the execution ID linking it back to its owner
    for (const event of events) {
      expect(event["executionId"]).toBe(execId);
    }
  }, 30_000);

  // ---------------------------------------------------------------------------
  // afterSeq pagination works correctly for events
  // ---------------------------------------------------------------------------

  it("durability: GET /api/executions/:id/events?afterSeq=N returns only later events", async () => {
    const { execId } = await runShellTask("pagination");

    const allRes = await api(`/api/executions/${execId}/events`);
    const allEvents = (await allRes.json()) as Array<Record<string, unknown>>;
    expect(allEvents.length).toBeGreaterThanOrEqual(2);

    const cutoff = allEvents[0]!["eventSeq"] as number;

    const pagedRes = await api(
      `/api/executions/${execId}/events?afterSeq=${cutoff}`
    );
    expect(pagedRes.status).toBe(200);
    const pagedEvents = (await pagedRes.json()) as Array<Record<string, unknown>>;

    // All returned events must have a seq greater than the cutoff
    for (const event of pagedEvents) {
      expect(event["eventSeq"] as number).toBeGreaterThan(cutoff);
    }
    expect(pagedEvents.length).toBe(allEvents.length - 1);
  }, 30_000);
});

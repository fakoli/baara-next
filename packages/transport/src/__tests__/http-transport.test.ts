// HttpTransport unit tests.
//
// Mocks fetch with response shapes that match `packages/server/src/routes/internal.ts`
// exactly — that is the wire contract:
//   - POST /internal/poll      → 200 with body `null` or `TaskAssignment`
//   - POST /internal/start     → 200 with body `{ ok: true }`
//   - POST /internal/complete  → 200 with body `{ ok: true }`
//   - POST /internal/heartbeat → 200 with body `{ ok: true }`

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import type { ExecuteResult } from "@baara-next/core";
import { HttpTransport } from "../http-transport.ts";

interface CapturedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

const stubResult: ExecuteResult = {
  status: "completed",
  output: "",
  durationMs: 1,
};

describe("HttpTransport", () => {
  const originalFetch = globalThis.fetch;
  let calls: CapturedCall[] = [];

  beforeEach(() => {
    calls = [];
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockFetch(responder: (call: number) => Response | Error): void {
    let callCount = 0;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
      const method = init?.method ?? "GET";
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const body = typeof init?.body === "string" ? init.body : "";
      calls.push({ url, method, headers, body });
      const r = responder(callCount++);
      if (r instanceof Error) throw r;
      return r;
    }) as typeof fetch;
  }

  // ---------------------------------------------------------------------------
  // URL handling
  // ---------------------------------------------------------------------------

  test("strips trailing slash from baseUrl", async () => {
    const t = new HttpTransport({ baseUrl: "http://localhost:3000/" });
    mockFetch(() => new Response("null", { status: 200 }));
    await t.pollTask("agent1", []);
    expect(calls[0]?.url).toBe("http://localhost:3000/internal/poll");
  });

  // ---------------------------------------------------------------------------
  // AC4 — X-Api-Key header
  // ---------------------------------------------------------------------------

  test("sends X-Api-Key header when apiKey is configured", async () => {
    const t = new HttpTransport({ baseUrl: "http://localhost:3000", apiKey: "test-key" });
    mockFetch(() => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await t.startExecution("exec-1");
    expect(calls[0]?.headers["X-Api-Key"]).toBe("test-key");
  });

  test("omits X-Api-Key when apiKey is not configured", async () => {
    const t = new HttpTransport({ baseUrl: "http://localhost:3000" });
    mockFetch(() => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await t.startExecution("exec-1");
    expect(calls[0]?.headers["X-Api-Key"]).toBeUndefined();
  });

  test("X-Api-Key is sent on every ITransport method", async () => {
    const t = new HttpTransport({ baseUrl: "http://localhost:3000", apiKey: "k" });
    mockFetch(() => new Response("null", { status: 200 }));
    await t.pollTask("agent1", []);
    mockFetch(() => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await t.startExecution("e1");
    mockFetch(() => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await t.completeExecution("e1", stubResult);
    mockFetch(() => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await t.heartbeat("agent1", "e1", 1);
    for (const c of calls) {
      expect(c.headers["X-Api-Key"]).toBe("k");
    }
  });

  // ---------------------------------------------------------------------------
  // AC3 — retry on transient errors
  // ---------------------------------------------------------------------------

  test("retries on 503 then succeeds", async () => {
    const t = new HttpTransport({
      baseUrl: "http://localhost:3000",
      maxRetries: 3,
      baseDelayMs: 1,
      maxDelayMs: 4,
    });
    mockFetch((n) =>
      n < 2
        ? new Response("upstream busy", { status: 503 })
        : new Response(JSON.stringify({ ok: true }), { status: 200 })
    );
    await t.startExecution("exec-1");
    expect(calls.length).toBe(3);
  });

  test("retries on 429 (rate limited) then succeeds", async () => {
    const t = new HttpTransport({ baseUrl: "http://localhost:3000", baseDelayMs: 1, maxDelayMs: 4 });
    mockFetch((n) =>
      n < 1
        ? new Response("rate limit", { status: 429 })
        : new Response(JSON.stringify({ ok: true }), { status: 200 })
    );
    await t.startExecution("exec-1");
    expect(calls.length).toBe(2);
  });

  test("retries on network-level error (ECONNREFUSED) then succeeds", async () => {
    const t = new HttpTransport({ baseUrl: "http://localhost:3000", baseDelayMs: 1, maxDelayMs: 4 });
    mockFetch((n) => {
      if (n < 2) {
        // Mirror Bun/Node fetch network-failure shape: TypeError with cause.code.
        const err = new TypeError("fetch failed");
        (err as { cause?: { code: string } }).cause = { code: "ECONNREFUSED" };
        return err;
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    await t.startExecution("exec-1");
    expect(calls.length).toBe(3);
  });

  test("does NOT retry on 401 (terminal)", async () => {
    const t = new HttpTransport({ baseUrl: "http://localhost:3000", maxRetries: 5, baseDelayMs: 1 });
    mockFetch(() => new Response("Unauthorized", { status: 401 }));
    await expect(t.startExecution("exec-1")).rejects.toThrow(/401/);
    expect(calls.length).toBe(1);
  });

  test("does NOT retry on 404 (terminal)", async () => {
    const t = new HttpTransport({ baseUrl: "http://localhost:3000", maxRetries: 5, baseDelayMs: 1 });
    mockFetch(() => new Response("Not Found", { status: 404 }));
    await expect(t.startExecution("exec-1")).rejects.toThrow(/404/);
    expect(calls.length).toBe(1);
  });

  test("does NOT retry on AbortError (terminal)", async () => {
    const t = new HttpTransport({ baseUrl: "http://localhost:3000", maxRetries: 5, baseDelayMs: 1 });
    mockFetch(() => {
      const err = new Error("aborted");
      err.name = "AbortError";
      return err;
    });
    await expect(t.heartbeat("a1", "e1", 1)).rejects.toThrow();
    expect(calls.length).toBe(1);
  });

  test("throws after exhausting retries on persistent 503", async () => {
    const t = new HttpTransport({
      baseUrl: "http://localhost:3000",
      maxRetries: 2,
      baseDelayMs: 1,
      maxDelayMs: 4,
    });
    mockFetch(() => new Response("upstream down", { status: 503 }));
    await expect(t.startExecution("exec-1")).rejects.toThrow(/503/);
    expect(calls.length).toBe(3);
  });

  // ---------------------------------------------------------------------------
  // AC1 — wire-contract parity with internalRoutes
  // ---------------------------------------------------------------------------

  test("pollTask returns null when server responds with body null (no work)", async () => {
    // Matches `c.json(null)` from internalRoutes when matchTask returned null.
    const t = new HttpTransport({ baseUrl: "http://localhost:3000" });
    mockFetch(() => new Response("null", { status: 200 }));
    expect(await t.pollTask("agent1", [])).toBeNull();
  });

  test("pollTask returns the bare TaskAssignment from the server body", async () => {
    // Matches `c.json(assignment)` from internalRoutes — body is the assignment itself,
    // NOT wrapped in `{ assignment }`. Regression guard for the original contract bug.
    const t = new HttpTransport({ baseUrl: "http://localhost:3000" });
    const assignment = { executionId: "exec-1", task: { id: "T1" }, attempt: 1 };
    mockFetch(() => new Response(JSON.stringify(assignment), { status: 200 }));
    const result = await t.pollTask("agent1", []);
    expect(result).toEqual(assignment as never);
  });

  test("pollTask returns null when AbortError fires (request timed out)", async () => {
    const t = new HttpTransport({ baseUrl: "http://localhost:3000", maxRetries: 0 });
    mockFetch(() => {
      const err = new Error("aborted");
      err.name = "AbortError";
      return err;
    });
    expect(await t.pollTask("agent1", [])).toBeNull();
  });

  test("each method POSTs JSON to its dedicated /internal/* path", async () => {
    const t = new HttpTransport({ baseUrl: "http://localhost:3000" });

    mockFetch(() => new Response("null", { status: 200 }));
    await t.pollTask("agent1", []);
    expect(calls.at(-1)).toMatchObject({ url: "http://localhost:3000/internal/poll", method: "POST" });

    mockFetch(() => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await t.startExecution("e1");
    expect(calls.at(-1)).toMatchObject({ url: "http://localhost:3000/internal/start", method: "POST" });

    mockFetch(() => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await t.completeExecution("e1", stubResult);
    expect(calls.at(-1)).toMatchObject({ url: "http://localhost:3000/internal/complete", method: "POST" });

    mockFetch(() => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await t.heartbeat("agent1", "e1", 1);
    expect(calls.at(-1)).toMatchObject({ url: "http://localhost:3000/internal/heartbeat", method: "POST" });
  });
});

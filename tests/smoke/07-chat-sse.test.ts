// tests/smoke/07-chat-sse.test.ts
//
// NOTE: This test requires ANTHROPIC_API_KEY in the environment.
// If the key is absent, the test is skipped.
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { startServer, makeApi, type ServerHandle } from "./helpers.ts";

describe("07-chat-sse", () => {
  let handle: ServerHandle;
  let api: ReturnType<typeof makeApi>;

  beforeAll(async () => {
    if (!process.env["ANTHROPIC_API_KEY"]) {
      console.log("[07-chat-sse] Skipping: ANTHROPIC_API_KEY not set");
      return;
    }
    handle = await startServer();
    api = makeApi(handle.baseUrl);
  }, 30_000);

  afterAll(async () => {
    if (handle) await handle.cleanup();
  });

  /**
   * Read lines from an SSE stream response.
   * Returns all parsed `data:` payloads as parsed JSON objects.
   * Stops after the `done` event or `maxEvents` events.
   */
  async function readSseEvents(
    res: Response,
    maxEvents = 50
  ): Promise<Array<Record<string, unknown>>> {
    const events: Array<Record<string, unknown>> = [];
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (events.length < maxEvents) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.startsWith("data:")) {
          const raw = line.slice(5).trim();
          try {
            const parsed = JSON.parse(raw) as Record<string, unknown>;
            events.push(parsed);
            if (parsed["type"] === "done") {
              reader.cancel();
              return events;
            }
          } catch { /* skip malformed */ }
        }
      }
    }
    reader.cancel();
    return events;
  }

  it("POST /api/chat streams system event and at least one text event", async () => {
    if (!process.env["ANTHROPIC_API_KEY"]) return;

    const res = await api("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Say exactly: hello smoke" }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");

    const events = await readSseEvents(res, 100);
    const types = events.map((e) => e["type"]);

    // Must have a system handshake event
    expect(types).toContain("system");
    // Must have at least one text or text_delta event
    const hasText = types.includes("text") || types.includes("text_delta");
    expect(hasText).toBe(true);
    // Stream must end with done
    expect(types[types.length - 1]).toBe("done");

    // System event must contain session and thread IDs
    const systemEvent = events.find((e) => e["type"] === "system");
    expect(systemEvent?.["sessionId"]).toBeTruthy();
    expect(systemEvent?.["threadId"]).toBeTruthy();
  }, 60_000);
});

// tests/smoke/08-thread-model.test.ts
//
// NOTE: This test requires ANTHROPIC_API_KEY in the environment.
// If the key is absent, the test is skipped.
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { startServer, makeApi, type ServerHandle } from "./helpers.ts";

describe("08-thread-model", () => {
  let handle: ServerHandle;
  let api: ReturnType<typeof makeApi>;

  beforeAll(async () => {
    if (!process.env["ANTHROPIC_API_KEY"]) {
      console.log("[08-thread-model] Skipping: ANTHROPIC_API_KEY not set");
      return;
    }
    handle = await startServer();
    api = makeApi(handle.baseUrl);
  }, 30_000);

  afterAll(async () => {
    if (handle) await handle.cleanup();
  });

  async function firstSseEvent(res: Response): Promise<Record<string, unknown> | null> {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (let i = 0; i < 20; i++) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.startsWith("data:")) {
          try {
            const parsed = JSON.parse(line.slice(5).trim()) as Record<string, unknown>;
            if (parsed["type"] === "system") {
              reader.cancel();
              return parsed;
            }
          } catch { /* skip */ }
        }
      }
    }
    reader.cancel();
    return null;
  }

  it("POST /api/chat creates a thread visible in GET /api/chat/sessions", async () => {
    if (!process.env["ANTHROPIC_API_KEY"]) return;

    const res = await api("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "hello" }),
    });
    expect(res.status).toBe(200);

    const systemEvent = await firstSseEvent(res);
    expect(systemEvent).not.toBeNull();
    const threadId = systemEvent?.["threadId"] as string | undefined;
    expect(threadId).toBeTruthy();

    // Thread should now appear in sessions list
    const sessionsRes = await api("/api/chat/sessions");
    expect(sessionsRes.status).toBe(200);
    const sessions = await sessionsRes.json() as Array<Record<string, unknown>>;
    expect(sessions.some((s) => s["id"] === threadId)).toBe(true);
  }, 60_000);
});

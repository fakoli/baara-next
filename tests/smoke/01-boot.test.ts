// tests/smoke/01-boot.test.ts
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { startServer, type ServerHandle } from "./helpers.ts";

describe("01-boot", () => {
  let handle: ServerHandle;

  beforeAll(async () => {
    handle = await startServer();
  });

  afterAll(async () => {
    await handle.cleanup();
  });

  it("GET /api/health returns 200 with status ok", async () => {
    const res = await fetch(`${handle.baseUrl}/api/health`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body["status"]).toBe("ok");
    expect(typeof body["uptime"]).toBe("number");
    expect(body["version"]).toBe("0.1.0");
  });

  it("GET /api/system/status returns queue info", async () => {
    const res = await fetch(`${handle.baseUrl}/api/system/status`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(typeof body["uptime"]).toBe("number");
    expect(typeof body["queues"]).toBe("object");
  });
});

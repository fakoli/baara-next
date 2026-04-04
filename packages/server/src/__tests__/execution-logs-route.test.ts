// @baara-next/server — GET /api/executions/:id/logs route tests
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Hono } from "hono";
import { executionRoutes } from "../routes/executions.ts";
import type { IOrchestratorService, IStore } from "@baara-next/core";
import { LogWriter } from "@baara-next/executor";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const testLogsDir = join(tmpdir(), `baara-route-logs-${Date.now()}`);

function makeStore(executionExists = true): IStore {
  return {
    getExecution: () =>
      executionExists
        ? ({ id: "ex-1", taskId: "t-1", status: "completed" } as unknown)
        : null,
    listAllExecutions: () => [],
    listExecutions: () => [],
    listEvents: () => [],
    getPendingInputExecutions: () => [],
  } as unknown as IStore;
}

function makeOrchestrator(): IOrchestratorService {
  return {} as IOrchestratorService;
}

describe("GET /api/executions/:id/logs", () => {
  let app: Hono;

  beforeEach(() => {
    mkdirSync(testLogsDir, { recursive: true });
    const router = executionRoutes(makeOrchestrator(), makeStore(), undefined, testLogsDir);
    app = new Hono().route("/api/executions", router);
  });

  afterEach(() => {
    rmSync(testLogsDir, { recursive: true, force: true });
  });

  it("returns empty entries when no log file exists", async () => {
    const res = await app.request("/api/executions/ex-1/logs");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: unknown[] };
    expect(body.entries).toHaveLength(0);
  });

  it("returns 404 when execution does not exist", async () => {
    const router = executionRoutes(makeOrchestrator(), makeStore(false), undefined, testLogsDir);
    const a = new Hono().route("/api/executions", router);
    const res = await a.request("/api/executions/nonexistent/logs");
    expect(res.status).toBe(404);
  });

  it("returns log entries when file exists", async () => {
    const writer = new LogWriter(testLogsDir);
    await writer.append("ex-1", { ts: "2026-01-01T00:00:00Z", level: "info", msg: "hello", executionId: "ex-1" });
    await writer.append("ex-1", { ts: "2026-01-01T00:00:01Z", level: "error", msg: "fail", executionId: "ex-1" });

    const res = await app.request("/api/executions/ex-1/logs");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: { msg: string }[]; total: number };
    expect(body.entries).toHaveLength(2);
    expect(body.total).toBe(2);
  });

  it("filters by level query param", async () => {
    const writer = new LogWriter(testLogsDir);
    await writer.append("ex-1", { ts: "2026-01-01T00:00:00Z", level: "info", msg: "info", executionId: "ex-1" });
    await writer.append("ex-1", { ts: "2026-01-01T00:00:01Z", level: "error", msg: "error", executionId: "ex-1" });

    const res = await app.request("/api/executions/ex-1/logs?level=error");
    const body = (await res.json()) as { entries: { level: string }[] };
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].level).toBe("error");
  });

  it("filters by search query param", async () => {
    const writer = new LogWriter(testLogsDir);
    await writer.append("ex-1", { ts: "2026-01-01T00:00:00Z", level: "info", msg: "running tests", executionId: "ex-1" });
    await writer.append("ex-1", { ts: "2026-01-01T00:00:01Z", level: "info", msg: "deployment complete", executionId: "ex-1" });

    const res = await app.request("/api/executions/ex-1/logs?search=TESTS");
    const body = (await res.json()) as { entries: { msg: string }[] };
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].msg).toContain("tests");
  });
});

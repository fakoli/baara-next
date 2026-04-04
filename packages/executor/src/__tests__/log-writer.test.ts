// @baara-next/executor — LogWriter tests
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { LogWriter, readLogEntries } from "../log-writer.ts";
import { mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const testDir = join(tmpdir(), `baara-log-writer-test-${Date.now()}`);

describe("LogWriter", () => {
  let writer: LogWriter;
  const executionId = "ex-log-test";

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    writer = new LogWriter(join(testDir, "logs"));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("creates the log directory on first write", async () => {
    const logsDir = join(testDir, "logs-auto");
    const w = new LogWriter(logsDir);
    expect(existsSync(logsDir)).toBe(false);
    await w.append(executionId, {
      ts: new Date().toISOString(),
      level: "info",
      msg: "hello",
      executionId,
    });
    expect(existsSync(logsDir)).toBe(true);
  });

  it("appends a valid JSON line", async () => {
    await writer.append(executionId, {
      ts: "2026-04-04T00:00:00Z",
      level: "info",
      msg: "test message",
      executionId,
    });
    const logPath = join(testDir, "logs", `${executionId}.jsonl`);
    const content = await Bun.file(logPath).text();
    const parsed = JSON.parse(content.trim());
    expect(parsed.msg).toBe("test message");
    expect(parsed.level).toBe("info");
  });

  it("appends multiple lines", async () => {
    for (let i = 0; i < 3; i++) {
      await writer.append(executionId, {
        ts: new Date().toISOString(),
        level: "info",
        msg: `line ${i}`,
        executionId,
      });
    }
    const logPath = join(testDir, "logs", `${executionId}.jsonl`);
    const content = await Bun.file(logPath).text();
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(3);
  });

  it("returns the log file path", () => {
    expect(writer.logPath(executionId)).toBe(
      join(testDir, "logs", `${executionId}.jsonl`)
    );
  });
});

describe("readLogEntries", () => {
  let logsDir: string;

  beforeEach(() => {
    logsDir = join(testDir, "logs-read");
    mkdirSync(logsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("returns empty array when file does not exist", async () => {
    const entries = await readLogEntries(logsDir, "nonexistent");
    expect(entries).toHaveLength(0);
  });

  it("reads and parses all entries", async () => {
    const writer = new LogWriter(logsDir);
    const exId = "ex-read-test";
    await writer.append(exId, { ts: "2026-01-01T00:00:00Z", level: "info", msg: "a", executionId: exId });
    await writer.append(exId, { ts: "2026-01-01T00:00:01Z", level: "warn", msg: "b", executionId: exId });
    const entries = await readLogEntries(logsDir, exId);
    expect(entries).toHaveLength(2);
    expect(entries[0].msg).toBe("a");
    expect(entries[1].level).toBe("warn");
  });

  it("filters by level", async () => {
    const writer = new LogWriter(logsDir);
    const exId = "ex-filter-test";
    await writer.append(exId, { ts: "2026-01-01T00:00:00Z", level: "info", msg: "info msg", executionId: exId });
    await writer.append(exId, { ts: "2026-01-01T00:00:01Z", level: "error", msg: "error msg", executionId: exId });
    const entries = await readLogEntries(logsDir, exId, { level: "error" });
    expect(entries).toHaveLength(1);
    expect(entries[0].msg).toBe("error msg");
  });

  it("filters by search string (case-insensitive)", async () => {
    const writer = new LogWriter(logsDir);
    const exId = "ex-search-test";
    await writer.append(exId, { ts: "2026-01-01T00:00:00Z", level: "info", msg: "Running npm test", executionId: exId });
    await writer.append(exId, { ts: "2026-01-01T00:00:01Z", level: "info", msg: "All tests passed", executionId: exId });
    const entries = await readLogEntries(logsDir, exId, { search: "NPM" });
    expect(entries).toHaveLength(1);
    expect(entries[0].msg).toContain("npm");
  });

  it("applies limit and offset", async () => {
    const writer = new LogWriter(logsDir);
    const exId = "ex-page-test";
    for (let i = 0; i < 10; i++) {
      await writer.append(exId, { ts: new Date().toISOString(), level: "info", msg: `msg ${i}`, executionId: exId });
    }
    const page1 = await readLogEntries(logsDir, exId, { limit: 3, offset: 0 });
    const page2 = await readLogEntries(logsDir, exId, { limit: 3, offset: 3 });
    expect(page1).toHaveLength(3);
    expect(page2).toHaveLength(3);
    expect(page1[0].msg).toBe("msg 0");
    expect(page2[0].msg).toBe("msg 3");
  });
});

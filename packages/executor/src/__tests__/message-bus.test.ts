import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { MessageBus } from "../message-bus.ts";
import { SQLiteStore } from "@baara-next/store";
import { join } from "path";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";

let store: SQLiteStore;
let bus: MessageBus;
let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "baara-bus-test-"));
  store = new SQLiteStore(join(tmpDir, "test.db"));
  bus = new MessageBus(store, tmpDir);

  store.createTask("task-1", {
    name: "test-task",
    prompt: "test prompt",
  });
  store.createExecution("exec-1", "task-1", "transfer", 1, new Date().toISOString());
});

afterEach(() => {
  store.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("MessageBus", () => {
  it("sendCommand enqueues an inbound command", () => {
    bus.sendCommand("exec-1", { type: "command", prompt: "continue with step 2" });
    const pending = bus.readPendingCommands("exec-1");
    expect(pending).toHaveLength(1);
    expect(pending[0]!.command.type).toBe("command");
  });

  it("readPendingCommands returns commands in FIFO order", () => {
    bus.sendCommand("exec-1", { type: "pause" });
    bus.sendCommand("exec-1", { type: "resume" });
    const pending = bus.readPendingCommands("exec-1");
    expect(pending[0]!.command.type).toBe("pause");
    expect(pending[1]!.command.type).toBe("resume");
  });

  it("acknowledgeCommands removes commands from pending queue", () => {
    bus.sendCommand("exec-1", { type: "pause" });
    const before = bus.readPendingCommands("exec-1");
    expect(before).toHaveLength(1);

    bus.acknowledgeCommands([before[0]!.id]);
    const after = bus.readPendingCommands("exec-1");
    expect(after).toHaveLength(0);
  });

  it("writeCheckpoint persists a checkpoint that readLatestCheckpoint returns", () => {
    const cp = {
      id: "cp-1",
      executionId: "exec-1",
      turnCount: 3,
      conversationHistory: [],
      pendingToolCalls: [],
      agentState: {},
      timestamp: new Date().toISOString(),
    };
    bus.writeCheckpoint("exec-1", cp);
    const latest = bus.readLatestCheckpoint("exec-1");
    expect(latest?.id).toBe("cp-1");
    expect(latest?.turnCount).toBe(3);
  });

  it("readLatestCheckpoint returns the most recent of multiple checkpoints", () => {
    const cp1 = { id: "cp-1", executionId: "exec-1", turnCount: 5, conversationHistory: [], pendingToolCalls: [], agentState: {}, timestamp: "2026-04-01T10:00:00Z" };
    const cp2 = { id: "cp-2", executionId: "exec-1", turnCount: 10, conversationHistory: [], pendingToolCalls: [], agentState: {}, timestamp: "2026-04-01T10:05:00Z" };
    bus.writeCheckpoint("exec-1", cp1);
    bus.writeCheckpoint("exec-1", cp2);
    const latest = bus.readLatestCheckpoint("exec-1");
    expect(latest?.id).toBe("cp-2");
  });

  it("readLatestCheckpoint returns null when no checkpoint exists", () => {
    expect(bus.readLatestCheckpoint("exec-1")).toBeNull();
  });

  it("appendLog writes to task_messages", () => {
    bus.appendLog("exec-1", "info", "Task started");
    const rows = store.readMessages("exec-1", "outbound", "pending");
    const logRow = rows.find((r) => r.messageType === "log");
    expect(logRow).toBeDefined();
    const payload = JSON.parse(logRow!.payload);
    expect(payload.level).toBe("info");
    expect(payload.msg).toBe("Task started");
  });

  it("appendLog writes to JSONL file", () => {
    bus.appendLog("exec-1", "info", "Hello from agent");
    const logPath = join(tmpDir, "logs", "exec-1.jsonl");
    expect(existsSync(logPath)).toBe(true);
    const line = readFileSync(logPath, "utf8").trim();
    const parsed = JSON.parse(line);
    expect(parsed.level).toBe("info");
    expect(parsed.msg).toBe("Hello from agent");
    expect(parsed.executionId).toBe("exec-1");
    expect(typeof parsed.ts).toBe("string");
  });

  it("appendLog appends multiple log lines to the JSONL file", () => {
    bus.appendLog("exec-1", "info", "Line 1");
    bus.appendLog("exec-1", "warn", "Line 2");
    const logPath = join(tmpDir, "logs", "exec-1.jsonl");
    const lines = readFileSync(logPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).msg).toBe("Line 1");
    expect(JSON.parse(lines[1]!).msg).toBe("Line 2");
  });
});

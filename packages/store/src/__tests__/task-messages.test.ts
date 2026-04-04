import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { SQLiteStore } from "../sqlite-store.ts";
import { join } from "path";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";

let store: SQLiteStore;
let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "baara-msg-test-"));
  store = new SQLiteStore(join(tmpDir, "test.db"));

  // Seed a task + execution to satisfy foreign key constraints
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

describe("IStore task_messages methods", () => {
  it("sendMessage inserts a row and readMessages returns it", () => {
    store.sendMessage({
      id: "msg-1",
      executionId: "exec-1",
      direction: "inbound",
      messageType: "command",
      payload: JSON.stringify({ type: "command", prompt: "continue" }),
    });

    const rows = store.readMessages("exec-1", "inbound");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe("msg-1");
    expect(rows[0]!.messageType).toBe("command");
    expect(rows[0]!.status).toBe("pending");
  });

  it("readMessages filters by status", () => {
    store.sendMessage({
      id: "msg-1",
      executionId: "exec-1",
      direction: "inbound",
      messageType: "command",
      payload: "{}",
    });

    const pending = store.readMessages("exec-1", "inbound", "pending");
    expect(pending).toHaveLength(1);

    const acknowledged = store.readMessages("exec-1", "inbound", "acknowledged");
    expect(acknowledged).toHaveLength(0);
  });

  it("acknowledgeMessages updates status to acknowledged", () => {
    store.sendMessage({
      id: "msg-1",
      executionId: "exec-1",
      direction: "inbound",
      messageType: "command",
      payload: "{}",
    });

    store.acknowledgeMessages(["msg-1"]);

    const rows = store.readMessages("exec-1", "inbound", "pending");
    expect(rows).toHaveLength(0);

    const acked = store.readMessages("exec-1", "inbound", "acknowledged");
    expect(acked).toHaveLength(1);
  });

  it("readMessages returns rows in created_at ASC order", () => {
    store.sendMessage({ id: "msg-a", executionId: "exec-1", direction: "inbound", messageType: "command", payload: "{}" });
    store.sendMessage({ id: "msg-b", executionId: "exec-1", direction: "inbound", messageType: "command", payload: "{}" });
    store.sendMessage({ id: "msg-c", executionId: "exec-1", direction: "inbound", messageType: "command", payload: "{}" });

    const rows = store.readMessages("exec-1", "inbound");
    expect(rows.map((r) => r.id)).toEqual(["msg-a", "msg-b", "msg-c"]);
  });

  it("readLatestMessage returns the most recent message of a given type", () => {
    store.sendMessage({ id: "cp-1", executionId: "exec-1", direction: "outbound", messageType: "checkpoint", payload: '{"id":"cp-1","turnCount":5}' });
    store.sendMessage({ id: "cp-2", executionId: "exec-1", direction: "outbound", messageType: "checkpoint", payload: '{"id":"cp-2","turnCount":10}' });

    const row = store.readLatestMessage("exec-1", "outbound", "checkpoint");
    expect(row?.id).toBe("cp-2");
  });
});

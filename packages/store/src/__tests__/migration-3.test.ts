import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../migrations.ts";

describe("Migration 3 — task_messages table + tasks schema update", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    runMigrations(db);
  });

  afterEach(() => {
    db.close();
  });

  it("creates task_messages table with correct columns", () => {
    const cols = db
      .query("PRAGMA table_info(task_messages)")
      .all() as Array<{ name: string }>;
    const names = cols.map((c) => c.name);
    expect(names).toContain("id");
    expect(names).toContain("execution_id");
    expect(names).toContain("direction");
    expect(names).toContain("message_type");
    expect(names).toContain("payload");
    expect(names).toContain("status");
    expect(names).toContain("created_at");
  });

  it("creates idx_task_messages_execution index", () => {
    const indexes = db
      .query("PRAGMA index_list(task_messages)")
      .all() as Array<{ name: string }>;
    const names = indexes.map((i) => i.name);
    expect(names).toContain("idx_task_messages_execution");
  });

  it("tasks table has sandbox_type column instead of execution_type", () => {
    const cols = db
      .query("PRAGMA table_info(tasks)")
      .all() as Array<{ name: string }>;
    const names = cols.map((c) => c.name);
    expect(names).toContain("sandbox_type");
    expect(names).not.toContain("execution_type");
  });

  it("tasks table has sandbox_config column", () => {
    const cols = db
      .query("PRAGMA table_info(tasks)")
      .all() as Array<{ name: string }>;
    const names = cols.map((c) => c.name);
    expect(names).toContain("sandbox_config");
  });

  it("existing task rows survive the migration with sandbox_type defaulting to native", () => {
    db.run(
      `INSERT INTO tasks (id, name, prompt) VALUES ('t1', 'test-task', 'test prompt')`
    );
    const row = db
      .query("SELECT sandbox_type FROM tasks WHERE id = 't1'")
      .get() as { sandbox_type: string } | null;
    expect(row?.sandbox_type).toBe("native");
  });

  it("task_messages direction constraint rejects invalid values", () => {
    db.run(
      `INSERT INTO tasks (id, name, prompt) VALUES ('t1', 'test-task', 'test prompt')`
    );
    db.run(
      `INSERT INTO executions (id, task_id, queue_name, priority, scheduled_at)
       VALUES ('e1', 't1', 'transfer', 1, datetime('now'))`
    );
    expect(() => {
      db.run(
        `INSERT INTO task_messages (id, execution_id, direction, message_type, payload)
         VALUES ('m1', 'e1', 'invalid_direction', 'command', '{}')`
      );
    }).toThrow();
  });
});

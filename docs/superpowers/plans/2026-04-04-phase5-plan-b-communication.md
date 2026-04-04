# Plan B: Communication Layer (MessageBus + task_messages)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan.

**Goal:** Build the durable communication backbone for Phase 5 — a `task_messages` SQLite table that queues inbound commands and outbound checkpoints, an `IMessageBus` interface in core, a `MessageBus` implementation in the executor package, and the corresponding `IStore` methods.

**Spec reference:** Sub-Spec B of `docs/superpowers/specs/2026-04-04-phase5-sandbox-durability-design.md`

**Architecture:** Two channels per execution: WebSocket (ephemeral, fast) and SQLite queue (durable, commands + checkpoints). `MessageBus` wraps `IStore` message methods. `appendLog()` writes to both `task_messages` and a JSONL file at `~/.baara/logs/{executionId}.jsonl`. `readLatestCheckpoint()` queries for the most recent `checkpoint` message so crash recovery can resume from the right point.

**Dependencies:** Plan A (types) must be complete — `InboundCommand`, `Checkpoint`, and `SandboxEvent` must exist in `@baara-next/core` before this plan runs.

---

### Task 1: Add `IMessageBus` to `packages/core/src/interfaces/message-bus.ts`

**Files:**
- Create: `packages/core/src/interfaces/message-bus.ts`
- Modify: `packages/core/src/interfaces/index.ts`

Define the pure interface that both the `MessageBus` implementation and any future in-memory test doubles must satisfy.

- [ ] **Step 1: Write failing typecheck test**

```typescript
// packages/core/src/__tests__/message-bus-interface.test.ts
import { describe, it, expect } from "bun:test";
import type { IMessageBus } from "../interfaces/message-bus.ts";
import type { InboundCommand, Checkpoint } from "../types.ts";

describe("IMessageBus interface shape", () => {
  it("IMessageBus has all required methods", () => {
    const bus = {} as IMessageBus;

    // These type assertions will fail at compile time if the methods are absent
    const _sendCommand: (id: string, cmd: InboundCommand) => void = bus.sendCommand;
    const _readPending: (id: string) => Array<{ id: string; command: InboundCommand }> = bus.readPendingCommands;
    const _ack: (ids: string[]) => void = bus.acknowledgeCommands;
    const _writeCheckpoint: (id: string, cp: Checkpoint) => void = bus.writeCheckpoint;
    const _readCheckpoint: (id: string) => Checkpoint | null = bus.readLatestCheckpoint;
    const _appendLog: (id: string, level: string, message: string) => void = bus.appendLog;

    expect(true).toBe(true);
  });
});
```

- [ ] **Step 2: Run test** (expected: FAIL — message-bus.ts not found)

```bash
cd packages/core && bun test src/__tests__/message-bus-interface.test.ts
# Expected: error: Cannot find module '../interfaces/message-bus.ts'
```

- [ ] **Step 3: Write implementation**

`packages/core/src/interfaces/message-bus.ts`:

```typescript
// @baara-next/core — IMessageBus interface
//
// The message bus is the durable communication channel between the orchestrator
// and running sandbox instances. It wraps the task_messages SQLite table.
//
// Inbound: commands sent TO a running execution (HITL responses, pause/resume,
//          additional prompts).
// Outbound: messages FROM a running execution (checkpoints, log lines, events).
//
// All methods are synchronous because the underlying SQLite driver (bun:sqlite)
// runs queries synchronously. The interface matches the store convention.

import type { Checkpoint, InboundCommand } from "../types.ts";

// ---------------------------------------------------------------------------
// PendingCommand — a queued inbound command with its message ID
// ---------------------------------------------------------------------------

/**
 * An inbound command retrieved from the task_messages queue, together with
 * its message ID for acknowledgement.
 */
export interface PendingCommand {
  /** The task_messages row ID — pass to acknowledgeCommands() after processing. */
  id: string;
  command: InboundCommand;
}

// ---------------------------------------------------------------------------
// IMessageBus
// ---------------------------------------------------------------------------

/**
 * Durable communication channel for running executions.
 *
 * Backed by the `task_messages` SQLite table. Implementations must be safe
 * to call from any process that shares the same SQLite file.
 */
export interface IMessageBus {
  // -------------------------------------------------------------------------
  // Inbound command queue (orchestrator → sandbox)
  // -------------------------------------------------------------------------

  /**
   * Enqueue an inbound command for a running execution.
   *
   * The command is persisted in `task_messages` with status `pending`.
   * The sandbox polls this queue and processes commands between agent turns.
   */
  sendCommand(executionId: string, command: InboundCommand): void;

  /**
   * Return all pending (unacknowledged) inbound commands for an execution,
   * ordered by `created_at ASC` (oldest first).
   *
   * Commands remain in `pending` status until acknowledgeCommands() is called.
   */
  readPendingCommands(executionId: string): PendingCommand[];

  /**
   * Mark the given message IDs as `acknowledged`.
   *
   * Call this after the sandbox has successfully processed the commands.
   * Acknowledged commands are retained for audit but excluded from future
   * readPendingCommands() calls.
   */
  acknowledgeCommands(messageIds: string[]): void;

  // -------------------------------------------------------------------------
  // Checkpoint management (sandbox → orchestrator)
  // -------------------------------------------------------------------------

  /**
   * Persist a checkpoint as an outbound `checkpoint` message.
   *
   * The checkpoint is stored as a JSON payload in `task_messages`.
   * Multiple checkpoints may exist per execution — only the latest matters.
   */
  writeCheckpoint(executionId: string, checkpoint: Checkpoint): void;

  /**
   * Return the most recently written checkpoint for an execution, or null
   * if no checkpoint exists.
   *
   * Used by the recovery flow to resume from the last known-good state.
   */
  readLatestCheckpoint(executionId: string): Checkpoint | null;

  // -------------------------------------------------------------------------
  // Structured log append (sandbox → file + queue)
  // -------------------------------------------------------------------------

  /**
   * Append a structured log entry for an execution.
   *
   * The entry is:
   *   1. Persisted as an outbound `log` message in `task_messages`.
   *   2. Appended to `~/.baara/logs/{executionId}.jsonl` (JSONL format).
   *
   * The JSONL file is the primary read path for the web UI Logs tab and
   * the `baara executions logs <id>` CLI command.
   */
  appendLog(executionId: string, level: "info" | "warn" | "error" | "debug", message: string): void;
}
```

Update `packages/core/src/interfaces/index.ts` to export `IMessageBus` and `PendingCommand`:

```typescript
// @baara-next/core — Interface barrel

export type { IOrchestratorService, TaskAssignment } from "./orchestrator.ts";
export type { IAgentService } from "./agent.ts";
export type {
  IRuntime,
  ExecuteParams,
  ExecuteResult,
  RuntimeConfig,
  ResourceLimits,
} from "./executor.ts";
export type { IStore } from "./store.ts";
export type { ITransport } from "./transport.ts";
export type {
  ISandbox,
  SandboxInstance,
  SandboxExecuteResult,
  SandboxStartConfig,
  SandboxExecuteParams,
} from "./sandbox.ts";
export type { IMessageBus, PendingCommand } from "./message-bus.ts";
```

- [ ] **Step 4: Run test** (expected: PASS)

```bash
cd packages/core && bun test src/__tests__/message-bus-interface.test.ts
# Expected: 1 test passes
```

- [ ] **Step 5: Run full typecheck**

```bash
cd packages/core && bun run typecheck
# Expected: 0 errors
```

---

### Task 2: Migration 3 in `packages/store/src/migrations.ts`

**Files:**
- Modify: `packages/store/src/migrations.ts`

Add migration version 3 which:
1. Creates the `task_messages` table with the schema from the spec.
2. Renames `execution_type` → `sandbox_type` on the `tasks` table.
3. Adds `sandbox_config TEXT` column to `tasks`.

> SQLite does not support `RENAME COLUMN` before version 3.25.0. Bun bundles SQLite >= 3.40.0, so `ALTER TABLE tasks RENAME COLUMN` is safe here.

- [ ] **Step 1: Write failing test**

```typescript
// packages/store/src/__tests__/migration-3.test.ts
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
    // Insert a task using the old execution_type column name — this exercises
    // whether the rename happened correctly in the migration.
    // After migration, sandbox_type should exist and default to 'native'.
    db.run(
      `INSERT INTO tasks (id, name, prompt) VALUES ('t1', 'test-task', 'test prompt')`
    );
    const row = db
      .query("SELECT sandbox_type FROM tasks WHERE id = 't1'")
      .get() as { sandbox_type: string } | null;
    expect(row?.sandbox_type).toBe("native");
  });

  it("task_messages direction constraint rejects invalid values", () => {
    // Need a valid execution first
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
```

- [ ] **Step 2: Run test** (expected: FAIL — migration 3 not present)

```bash
cd packages/store && bun test src/__tests__/migration-3.test.ts
# Expected: tasks table has no sandbox_type, task_messages does not exist
```

- [ ] **Step 3: Write implementation**

Append migration version 3 to the `MIGRATIONS` array in `packages/store/src/migrations.ts`:

```typescript
{
  version: 3,
  description: "Add task_messages table; rename execution_type → sandbox_type on tasks; add sandbox_config",
  up: `
    -- Rename execution_type to sandbox_type on tasks table.
    -- Requires SQLite >= 3.25.0 (Bun ships >= 3.40.0 — safe).
    ALTER TABLE tasks RENAME COLUMN execution_type TO sandbox_type;

    -- Change the default value for sandbox_type to 'native'.
    -- SQLite does not support ALTER COLUMN DEFAULT directly; we update
    -- existing rows instead and rely on the application-level default.
    UPDATE tasks SET sandbox_type = 'native' WHERE sandbox_type = 'cloud_code';
    UPDATE tasks SET sandbox_type = 'native' WHERE sandbox_type = 'shell';
    -- wasm and wasm_edge map to wasm; wasm_edge GPU flag moves to agentConfig
    UPDATE tasks SET sandbox_type = 'wasm' WHERE sandbox_type = 'wasm_edge';

    -- Add sandbox_config column (JSON blob, defaults to native no-op).
    ALTER TABLE tasks ADD COLUMN sandbox_config TEXT NOT NULL DEFAULT '{"type":"native"}';

    -- task_messages: durable inbound command queue and outbound event log.
    -- Each execution gets its own partition inside this shared table.
    CREATE TABLE IF NOT EXISTS task_messages (
      id          TEXT PRIMARY KEY,
      execution_id TEXT NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
      direction   TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
      message_type TEXT NOT NULL,
      payload     TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'delivered', 'acknowledged')),
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Composite index for the hot read path:
    --   readPendingCommands: WHERE execution_id = ? AND direction = 'inbound' AND status = 'pending'
    --   readLatestCheckpoint: WHERE execution_id = ? AND direction = 'outbound' AND message_type = 'checkpoint'
    CREATE INDEX IF NOT EXISTS idx_task_messages_execution
      ON task_messages(execution_id, direction, status, created_at);
  `,
},
```

- [ ] **Step 4: Run test** (expected: PASS)

```bash
cd packages/store && bun test src/__tests__/migration-3.test.ts
# Expected: all 6 tests pass
```

- [ ] **Step 5: Run full store typecheck**

```bash
cd packages/store && bun run typecheck
# Expected: 0 errors
```

---

### Task 3: Add message methods to `packages/store/src/sqlite-store.ts` and `IStore`

**Files:**
- Modify: `packages/core/src/interfaces/store.ts`
- Modify: `packages/store/src/sqlite-store.ts`

Add four methods to `IStore` and implement them in `SQLiteStore`:
- `sendMessage` — insert a row into `task_messages`
- `readMessages` — query rows by executionId + direction + optional status
- `acknowledgeMessages` — update status to `acknowledged`
- The higher-level `MessageBus` methods will call these; keeping them granular on `IStore` lets tests mock cleanly.

- [ ] **Step 1: Write failing test**

```typescript
// packages/store/src/__tests__/task-messages.test.ts
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
```

- [ ] **Step 2: Run test** (expected: FAIL — sendMessage not on store)

```bash
cd packages/store && bun test src/__tests__/task-messages.test.ts
# Expected: store.sendMessage is not a function
```

- [ ] **Step 3: Update `IStore` in `packages/core/src/interfaces/store.ts`**

Add the following section to the `IStore` interface (after the Threads section, before Settings):

```typescript
// -------------------------------------------------------------------------
// Task Messages — durable command queue and checkpoint store
// -------------------------------------------------------------------------

/**
 * A row in the task_messages table.
 */
export interface TaskMessage {
  id: string;
  executionId: string;
  direction: "inbound" | "outbound";
  messageType: string;
  payload: string;
  status: "pending" | "delivered" | "acknowledged";
  createdAt: string;
}

/**
 * Input for inserting a new task_messages row.
 */
export interface SendMessageInput {
  id: string;
  executionId: string;
  direction: "inbound" | "outbound";
  messageType: string;
  payload: string;
}

/**
 * Insert a new message row into task_messages with status 'pending'.
 */
sendMessage(input: SendMessageInput): void;

/**
 * Return messages for an execution filtered by direction and optionally status,
 * ordered by created_at ASC (oldest first).
 */
readMessages(
  executionId: string,
  direction: "inbound" | "outbound",
  status?: "pending" | "delivered" | "acknowledged"
): TaskMessage[];

/**
 * Update the status of the given message IDs to 'acknowledged'.
 *
 * No-ops for IDs that do not exist or are already acknowledged.
 */
acknowledgeMessages(messageIds: string[]): void;

/**
 * Return the most recently created message for an execution matching
 * the given direction and messageType, or null if none exists.
 *
 * Used by readLatestCheckpoint to find the most recent checkpoint row.
 */
readLatestMessage(
  executionId: string,
  direction: "inbound" | "outbound",
  messageType: string
): TaskMessage | null;
```

Also add the `TaskMessage` and `SendMessageInput` types to the import block at the top of files that need them, and export them from the core barrel.

Update `packages/core/src/interfaces/index.ts` to add:

```typescript
export type { IStore, TaskMessage, SendMessageInput } from "./store.ts";
```

(Replace the existing `export type { IStore } from "./store.ts";` line.)

- [ ] **Step 4: Implement in `packages/store/src/sqlite-store.ts`**

Add the `// Task Messages` section to `SQLiteStore`:

```typescript
// -------------------------------------------------------------------------
// Task Messages
// -------------------------------------------------------------------------

sendMessage(input: SendMessageInput): void {
  this.db.run(
    `INSERT INTO task_messages (id, execution_id, direction, message_type, payload)
     VALUES (?, ?, ?, ?, ?)`,
    [
      input.id,
      input.executionId,
      input.direction,
      input.messageType,
      input.payload,
    ]
  );
}

readMessages(
  executionId: string,
  direction: "inbound" | "outbound",
  status?: "pending" | "delivered" | "acknowledged"
): TaskMessage[] {
  let sql =
    "SELECT * FROM task_messages WHERE execution_id = ? AND direction = ?";
  const params: unknown[] = [executionId, direction];

  if (status !== undefined) {
    sql += " AND status = ?";
    params.push(status);
  }

  sql += " ORDER BY created_at ASC";

  const rows = this.db
    .query(sql)
    .all(...(params as SQLQueryBindings[])) as Array<Record<string, unknown>>;
  return rows.map(rowToTaskMessage);
}

acknowledgeMessages(messageIds: string[]): void {
  if (messageIds.length === 0) return;
  // Build parameterised placeholders: ?, ?, ...
  const placeholders = messageIds.map(() => "?").join(", ");
  this.db.run(
    `UPDATE task_messages SET status = 'acknowledged' WHERE id IN (${placeholders})`,
    messageIds as SQLQueryBindings[]
  );
}

readLatestMessage(
  executionId: string,
  direction: "inbound" | "outbound",
  messageType: string
): TaskMessage | null {
  const row = this.db
    .query(
      `SELECT * FROM task_messages
       WHERE execution_id = ? AND direction = ? AND message_type = ?
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(executionId, direction, messageType);
  return row ? rowToTaskMessage(row as Record<string, unknown>) : null;
}
```

Add the row mapper at the bottom of the file alongside the other mappers:

```typescript
function rowToTaskMessage(r: Record<string, unknown>): TaskMessage {
  return {
    id: r["id"] as string,
    executionId: r["execution_id"] as string,
    direction: r["direction"] as "inbound" | "outbound",
    messageType: r["message_type"] as string,
    payload: r["payload"] as string,
    status: r["status"] as "pending" | "delivered" | "acknowledged",
    createdAt: r["created_at"] as string,
  };
}
```

Also add `TaskMessage` and `SendMessageInput` to the import from `@baara-next/core` at the top of `sqlite-store.ts`:

```typescript
import type {
  IStore,
  Task,
  CreateTaskInput,
  UpdateTaskInput,
  Execution,
  ExecutionStatus,
  InputRequest,
  Priority,
  Project,
  CreateProjectInput,
  QueueInfo,
  Template,
  CreateTemplateInput,
  ExecutionEvent,
  HealthStatus,
  Thread,
  TaskMessage,
  SendMessageInput,
} from "@baara-next/core";
```

- [ ] **Step 5: Run test** (expected: PASS)

```bash
cd packages/store && bun test src/__tests__/task-messages.test.ts
# Expected: all 5 tests pass
```

- [ ] **Step 6: Run full store typecheck**

```bash
cd packages/store && bun run typecheck
# Expected: 0 errors
```

---

### Task 4: Create `packages/executor/src/message-bus.ts`

**Files:**
- Create: `packages/executor/src/message-bus.ts`
- Modify: `packages/executor/src/index.ts`

`MessageBus` implements `IMessageBus` by wrapping `IStore` message methods. `appendLog()` writes to both `task_messages` and a JSONL file at `{dataDir}/logs/{executionId}.jsonl`. The log file is the primary read path for the web UI Logs tab.

- [ ] **Step 1: Write failing test**

```typescript
// packages/executor/src/__tests__/message-bus.test.ts
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
```

- [ ] **Step 2: Run test** (expected: FAIL — MessageBus not found)

```bash
cd packages/executor && bun test src/__tests__/message-bus.test.ts
# Expected: error: Cannot find module '../message-bus.ts'
```

- [ ] **Step 3: Write implementation**

`packages/executor/src/message-bus.ts`:

```typescript
// @baara-next/executor — MessageBus
//
// Implements IMessageBus by wrapping IStore message methods.
//
// Two write paths for log entries:
//   1. task_messages table (durable — survives crashes)
//   2. ~/{dataDir}/logs/{executionId}.jsonl (fast read for web UI + CLI)
//
// The JSONL path is append-only. Log rotation is handled externally by a
// cleanup job that deletes files older than event_retention_days.

import { mkdirSync, appendFileSync } from "fs";
import { join } from "path";
import type { IMessageBus, PendingCommand, IStore, Checkpoint } from "@baara-next/core";
import type { InboundCommand } from "@baara-next/core";

// ---------------------------------------------------------------------------
// LogEntry — JSONL line format
// ---------------------------------------------------------------------------

interface LogEntry {
  ts: string;
  level: "info" | "warn" | "error" | "debug";
  msg: string;
  executionId: string;
}

// ---------------------------------------------------------------------------
// MessageBus
// ---------------------------------------------------------------------------

export class MessageBus implements IMessageBus {
  private readonly logsDir: string;

  constructor(
    private readonly store: IStore,
    /** Writable data directory; logs are written to {dataDir}/logs/. */
    private readonly dataDir: string
  ) {
    this.logsDir = join(dataDir, "logs");
    // Ensure logs directory exists at construction time.
    mkdirSync(this.logsDir, { recursive: true });
  }

  // -------------------------------------------------------------------------
  // Inbound command queue
  // -------------------------------------------------------------------------

  sendCommand(executionId: string, command: InboundCommand): void {
    this.store.sendMessage({
      id: crypto.randomUUID(),
      executionId,
      direction: "inbound",
      messageType: "command",
      payload: JSON.stringify(command),
    });
  }

  readPendingCommands(executionId: string): PendingCommand[] {
    const rows = this.store.readMessages(executionId, "inbound", "pending");
    return rows.map((row) => ({
      id: row.id,
      command: JSON.parse(row.payload) as InboundCommand,
    }));
  }

  acknowledgeCommands(messageIds: string[]): void {
    this.store.acknowledgeMessages(messageIds);
  }

  // -------------------------------------------------------------------------
  // Checkpoint management
  // -------------------------------------------------------------------------

  writeCheckpoint(executionId: string, checkpoint: Checkpoint): void {
    this.store.sendMessage({
      id: crypto.randomUUID(),
      executionId,
      direction: "outbound",
      messageType: "checkpoint",
      payload: JSON.stringify(checkpoint),
    });
  }

  readLatestCheckpoint(executionId: string): Checkpoint | null {
    const row = this.store.readLatestMessage(executionId, "outbound", "checkpoint");
    if (!row) return null;
    return JSON.parse(row.payload) as Checkpoint;
  }

  // -------------------------------------------------------------------------
  // Structured log append
  // -------------------------------------------------------------------------

  appendLog(
    executionId: string,
    level: "info" | "warn" | "error" | "debug",
    message: string
  ): void {
    const ts = new Date().toISOString();

    const entry: LogEntry = {
      ts,
      level,
      msg: message,
      executionId,
    };

    const entryJson = JSON.stringify(entry);

    // 1. Write to task_messages (durable path)
    this.store.sendMessage({
      id: crypto.randomUUID(),
      executionId,
      direction: "outbound",
      messageType: "log",
      payload: entryJson,
    });

    // 2. Append to JSONL file (fast read path for web UI and CLI)
    const logPath = join(this.logsDir, `${executionId}.jsonl`);
    appendFileSync(logPath, entryJson + "\n", "utf8");
  }
}
```

Update `packages/executor/src/index.ts` to export `MessageBus`:

```typescript
// Add to the Phase 5 exports section:
export { MessageBus } from "./message-bus.ts";
```

The updated barrel (full replacement):

```typescript
// @baara-next/executor — Public API barrel

// Phase 5: Sandbox architecture
export { SandboxRegistry } from "./sandbox-registry.ts";
export { NativeSandbox } from "./sandboxes/native.ts";
export { WasmSandbox } from "./sandboxes/wasm.ts";
export { DockerSandbox } from "./sandboxes/docker.ts";
export { MessageBus } from "./message-bus.ts";

// Legacy runtime exports — kept during migration, to be removed in Phase 5 cleanup
export { RuntimeRegistry } from "./runtime-registry.ts";
export { defaultLimits, mergeLimits } from "./sandbox.ts";
export { CloudCodeRuntime } from "./runtimes/cloud-code.ts";
export { ShellRuntime } from "./runtimes/shell.ts";
export { WasmRuntime } from "./runtimes/wasm.ts";
export { WasmEdgeRuntime } from "./runtimes/wasmedge.ts";

import { SandboxRegistry } from "./sandbox-registry.ts";
import { NativeSandbox } from "./sandboxes/native.ts";
import { WasmSandbox } from "./sandboxes/wasm.ts";
import { DockerSandbox } from "./sandboxes/docker.ts";

/**
 * Build and return a SandboxRegistry pre-populated with all three sandbox
 * implementations: native, wasm, and docker.
 *
 * Call this once at startup and pass the registry to OrchestratorService
 * and AgentService.
 *
 * @param dataDir - Writable directory for scratch files and sessions.
 */
export async function createDefaultSandboxRegistry(
  dataDir: string
): Promise<SandboxRegistry> {
  const registry = new SandboxRegistry();

  registry.register(new NativeSandbox(dataDir));
  registry.register(new WasmSandbox(dataDir));
  registry.register(new DockerSandbox());

  return registry;
}
```

- [ ] **Step 4: Run test** (expected: PASS)

```bash
cd packages/executor && bun test src/__tests__/message-bus.test.ts
# Expected: all 9 tests pass
```

- [ ] **Step 5: Run full executor typecheck**

```bash
cd packages/executor && bun run typecheck
# Expected: 0 errors
```

---

### Task 5: Wire MessageBus into the startup sequence

**Files:**
- Modify: `packages/cli/src/commands/start.ts`

Create a `MessageBus` instance at startup and make it available to the components that need it (orchestrator for sending commands, sandbox instances for reading commands and writing checkpoints and logs).

> This task wires the MessageBus into the process startup. Full consumption by sandbox instances and recovery flows is completed in Phase 5 Sub-Spec C (recovery) and Sub-Spec D (sandbox implementation).

- [ ] **Step 1: Write failing test**

```typescript
// packages/cli/src/__tests__/start-wiring.test.ts
// This is a type-level test — if MessageBus and createDefaultSandboxRegistry
// are importable and the constructor types match, we are good.
import { describe, it, expect } from "bun:test";

describe("Start command wiring types", () => {
  it("MessageBus is importable from @baara-next/executor", async () => {
    const mod = await import("@baara-next/executor");
    expect(typeof mod.MessageBus).toBe("function");
  });

  it("createDefaultSandboxRegistry is importable from @baara-next/executor", async () => {
    const mod = await import("@baara-next/executor");
    expect(typeof mod.createDefaultSandboxRegistry).toBe("function");
  });
});
```

- [ ] **Step 2: Run test** (expected: PASS if Task 4 is complete)

```bash
cd packages/cli && bun test src/__tests__/start-wiring.test.ts
# Expected: 2 tests pass
```

- [ ] **Step 3: Update `packages/cli/src/commands/start.ts`**

Add `MessageBus` to the import:

```typescript
// Before:
import { createDefaultRegistry } from "@baara-next/executor";

// After:
import { createDefaultSandboxRegistry, MessageBus } from "@baara-next/executor";
```

Create the log directory and `MessageBus` instance:

```typescript
// After the mkdirSync(dataDir) line, add:
const logsDir = join(dataDir, "logs");
mkdirSync(logsDir, { recursive: true });
```

Instantiate `MessageBus` after the store is created:

```typescript
// After: const store = createStore(dbPath);
// Add:
const messageBus = new MessageBus(store, dataDir);
```

Update the registry creation to use the new function (replacing `createDefaultRegistry`):

```typescript
// Before:
const registry = await createDefaultRegistry({ dataDir });

// After:
const registry = await createDefaultSandboxRegistry(dataDir);
```

Pass `messageBus` to `OrchestratorService` (future — the constructor will accept it in Phase 5 Sub-Spec C integration; for now just instantiate it so it is wired and log a startup message):

```typescript
// Add to the startup log section:
console.log(`  Logs dir: ${logsDir}`);
```

Full updated startup sequence comment block in `start.ts`:

```typescript
// Dev mode flow:
//   1. Ensure data directory and logs directory exist
//   2. Create store (SQLite)
//   3. Create MessageBus (wraps store message methods + JSONL log writer)
//   4. Create sandbox registry (NativeSandbox, WasmSandbox, DockerSandbox)
//   5. Create OrchestratorService (registry enables runDirect)
//   6. Create DevTransport wired to orchestrator methods
//   7. Create AgentService with transport + sandboxes
//   8. Create HTTP server
//   9. Start everything
//  10. Graceful shutdown on SIGINT/SIGTERM
```

- [ ] **Step 4: Run full typecheck on cli**

```bash
cd packages/cli && bun run typecheck
# Expected: 0 errors
```

---

### Verification

- [ ] **task_messages table exists after migration**

```bash
bun -e "
import { SQLiteStore } from './packages/store/src/sqlite-store.ts';
const store = new SQLiteStore('/tmp/migration-test.db');
const result = store['db'].query(\"SELECT name FROM sqlite_master WHERE type='table' AND name='task_messages'\").all();
console.log(result); // [{ name: 'task_messages' }]
store.close();
"
```

- [ ] **MessageBus send + read + ack round-trip**

```bash
bun -e "
import { SQLiteStore } from './packages/store/src/sqlite-store.ts';
import { MessageBus } from './packages/executor/src/message-bus.ts';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const dir = mkdtempSync(join(tmpdir(), 'baara-verify-'));
const store = new SQLiteStore(join(dir, 'test.db'));
const bus = new MessageBus(store, dir);

store.createTask('t1', { name: 'test', prompt: 'test' });
store.createExecution('e1', 't1', 'transfer', 1, new Date().toISOString());

bus.sendCommand('e1', { type: 'command', prompt: 'continue' });
const cmds = bus.readPendingCommands('e1');
console.log('Pending commands:', cmds.length); // 1
bus.acknowledgeCommands([cmds[0].id]);
console.log('After ack:', bus.readPendingCommands('e1').length); // 0

store.close();
"
```

- [ ] **Checkpoint round-trip**

```bash
bun -e "
import { SQLiteStore } from './packages/store/src/sqlite-store.ts';
import { MessageBus } from './packages/executor/src/message-bus.ts';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const dir = mkdtempSync(join(tmpdir(), 'baara-cp-'));
const store = new SQLiteStore(join(dir, 'test.db'));
const bus = new MessageBus(store, dir);

store.createTask('t1', { name: 'test', prompt: 'test' });
store.createExecution('e1', 't1', 'transfer', 1, new Date().toISOString());

const cp = { id: 'cp1', executionId: 'e1', turnCount: 5, conversationHistory: [], pendingToolCalls: [], agentState: {}, timestamp: new Date().toISOString() };
bus.writeCheckpoint('e1', cp);

const latest = bus.readLatestCheckpoint('e1');
console.log('Latest checkpoint turnCount:', latest?.turnCount); // 5

store.close();
"
```

- [ ] **JSONL log file created and populated**

```bash
bun -e "
import { SQLiteStore } from './packages/store/src/sqlite-store.ts';
import { MessageBus } from './packages/executor/src/message-bus.ts';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { readFileSync } from 'fs';

const dir = mkdtempSync(join(tmpdir(), 'baara-log-'));
const store = new SQLiteStore(join(dir, 'test.db'));
const bus = new MessageBus(store, dir);

store.createTask('t1', { name: 'test', prompt: 'test' });
store.createExecution('e1', 't1', 'transfer', 1, new Date().toISOString());

bus.appendLog('e1', 'info', 'Task started');
bus.appendLog('e1', 'info', '[tool] Bash: echo hello');

const logPath = join(dir, 'logs', 'e1.jsonl');
const lines = readFileSync(logPath, 'utf8').trim().split('\n');
console.log('Log lines:', lines.length); // 2
console.log('First line:', JSON.parse(lines[0]));

store.close();
"
```

- [ ] **Full monorepo typecheck**

```bash
bun run turbo typecheck
# Expected: 0 errors across all packages
```

- [ ] **Full test suite**

```bash
bun run turbo test
# Expected: all tests pass
```

# Plan E: JSONL Logging + WebSocket Streaming + Migration + MCP/CLI/Web Updates

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan.

**Goal:** Wire real-time log streaming end-to-end: structured `LogEntry` objects written to JSONL files, streamed live to connected WebSocket clients, readable via `GET /api/executions/:id/logs`. Update the schema (migration 3), MCP tools, CLI, and web UI types to use `sandboxType` / `sandboxConfig` instead of `executionType`.

**Architecture:** `LogWriter` appends to `~/.baara/logs/{executionId}.jsonl`. `MessageBus.appendLog()` writes to both SQLite and the JSONL file simultaneously. The server's `/ws` endpoint gains three new broadcast event types. Migration 3 adds `task_messages`, renames `execution_type` → `sandbox_type`, and adds `sandbox_config`. MCP, CLI, and web update to use the new field names.

**Dependencies:** Plans C and D should be complete or in progress. This plan adds the integration layer that makes the executor's `SandboxEvent` stream visible to users.

**Tech Stack:** Bun file I/O (`Bun.file`, `bun:sqlite`), Hono, Zod, Commander.

---

### Task 1: Schema migration 3

**Files:**
- Modify: `packages/store/src/migrations.ts`
- Create: `packages/store/src/__tests__/migration3.test.ts`

**Context:** Migration 3 does three things in a single transaction:
1. Creates the `task_messages` table with the index from the spec.
2. Renames `execution_type` → `sandbox_type` on `tasks` (SQLite `ALTER TABLE ... RENAME COLUMN` requires SQLite 3.25.0+; Bun bundles ≥ 3.40).
3. Adds `sandbox_config` column to `tasks` (JSON blob, nullable).

After migration 3, the `Task` type in `@baara-next/core` must expose `sandboxType` (mapped from `sandbox_type`) and `sandboxConfig` (from `sandbox_config`). The store's row-to-model mapper is updated accordingly.

- [ ] **Step 1: Write failing test**

```typescript
// packages/store/src/__tests__/migration3.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../migrations.ts";

describe("Migration 3", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
  });

  afterEach(() => db.close());

  it("creates task_messages table", () => {
    const tables = db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='task_messages'")
      .all() as { name: string }[];
    expect(tables).toHaveLength(1);
  });

  it("task_messages has required columns", () => {
    const cols = db
      .query("PRAGMA table_info(task_messages)")
      .all() as { name: string }[];
    const names = cols.map((c) => c.name);
    expect(names).toContain("id");
    expect(names).toContain("execution_id");
    expect(names).toContain("direction");
    expect(names).toContain("message_type");
    expect(names).toContain("payload");
    expect(names).toContain("status");
    expect(names).toContain("created_at");
  });

  it("tasks table has sandbox_type column (renamed from execution_type)", () => {
    const cols = db
      .query("PRAGMA table_info(tasks)")
      .all() as { name: string }[];
    const names = cols.map((c) => c.name);
    expect(names).toContain("sandbox_type");
    expect(names).not.toContain("execution_type");
  });

  it("tasks table has sandbox_config column", () => {
    const cols = db
      .query("PRAGMA table_info(tasks)")
      .all() as { name: string }[];
    const names = cols.map((c) => c.name);
    expect(names).toContain("sandbox_config");
  });

  it("direction check constraint rejects invalid values", () => {
    expect(() => {
      db.run(
        `INSERT INTO task_messages (id, execution_id, direction, message_type, payload)
         VALUES ('x', 'y', 'invalid', 'command', '{}')`
      );
    }).toThrow();
  });

  it("status check constraint rejects invalid values", () => {
    expect(() => {
      db.run(
        `INSERT INTO task_messages (id, execution_id, direction, message_type, payload, status)
         VALUES ('x', 'y', 'inbound', 'command', '{}', 'bogus')`
      );
    }).toThrow();
  });

  it("schema_version is set to 3", () => {
    const row = db
      .query("SELECT value FROM settings WHERE key = 'schema_version'")
      .get() as { value: string } | null;
    expect(row?.value).toBe("3");
  });
});
```

- [ ] **Step 2: Run test** (expected: FAIL — migration 3 does not exist)

```bash
cd packages/store && bun test src/__tests__/migration3.test.ts
# Expected: schema_version assertion fails at 3 (currently 2) and task_messages not found
```

- [ ] **Step 3: Add migration 3 to `migrations.ts`**

Append to the `MIGRATIONS` array (after the existing version 2 entry):

```typescript
{
  version: 3,
  description: "task_messages table; rename execution_type → sandbox_type; add sandbox_config",
  up: `
    -- Durable command/event queue between orchestrator and sandbox instances
    CREATE TABLE IF NOT EXISTS task_messages (
      id TEXT PRIMARY KEY,
      execution_id TEXT NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
      direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
      message_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'delivered', 'acknowledged')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_task_messages_execution
      ON task_messages(execution_id, direction, status, created_at);

    -- Rename execution_type → sandbox_type (SQLite 3.25.0+, Bun bundles >= 3.40)
    ALTER TABLE tasks RENAME COLUMN execution_type TO sandbox_type;

    -- Per-sandbox isolation settings (JSON blob, nullable)
    ALTER TABLE tasks ADD COLUMN sandbox_config TEXT;
  `,
},
```

- [ ] **Step 4: Run test** (expected: PASS)

```bash
cd packages/store && bun test src/__tests__/migration3.test.ts
# Expected: 7 tests pass
```

- [ ] **Step 5: Update sqlite-store.ts row mapper**

In `packages/store/src/sqlite-store.ts`, find the function that maps a raw SQLite task row to a `Task` object. Update it to read `sandbox_type` and `sandbox_config`:

```typescript
// In rowToTask() or equivalent mapper:
// Replace:
//   executionType: row.execution_type,
// With:
sandboxType: row.sandbox_type ?? row.execution_type ?? "native",
sandboxConfig: row.sandbox_config ? JSON.parse(row.sandbox_config) : { type: row.sandbox_type ?? "native" },
```

Also update `createTask()` and `updateTask()` write paths to accept `sandboxType`/`sandboxConfig` and write to `sandbox_type`/`sandbox_config` columns. Keep backward-compat: if only `executionType` is provided (legacy callers), map it to `sandboxType`.

---

### Task 2: LogWriter — JSONL file writer

**Files:**
- Create: `packages/executor/src/log-writer.ts`
- Create: `packages/executor/src/__tests__/log-writer.test.ts`

**Context:** `LogWriter` appends one JSON line per log entry to `~/.baara/logs/{executionId}.jsonl`. It creates the directory if missing on the first write. Reading is done via separate `readLogEntries()` exported function (used by the HTTP route). The `MessageBus.appendLog()` method calls `LogWriter.append()` when a `LogWriter` is wired in.

- [ ] **Step 1: Write failing test**

```typescript
// packages/executor/src/__tests__/log-writer.test.ts
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
```

- [ ] **Step 2: Run test** (expected: FAIL — module not found)

```bash
cd packages/executor && bun test src/__tests__/log-writer.test.ts
# Expected: error: Cannot find module '../log-writer.ts'
```

- [ ] **Step 3: Write implementation**

```typescript
// packages/executor/src/log-writer.ts
// @baara-next/executor — JSONL Log Writer
//
// Appends structured log entries to ~/.baara/logs/{executionId}.jsonl.
// One file per execution. Directory created lazily on first write.
// readLogEntries() reads back entries with optional filtering.

import { mkdirSync, existsSync, appendFileSync } from "fs";
import { join } from "path";

// ---------------------------------------------------------------------------
// LogEntry type
// ---------------------------------------------------------------------------

export interface LogEntry {
  ts: string;                            // ISO 8601
  level: "info" | "warn" | "error" | "debug";
  msg: string;                           // Human-readable message
  executionId: string;
  threadId?: string;
  meta?: Record<string, unknown>;        // Tool name, token counts, etc.
}

// ---------------------------------------------------------------------------
// LogWriter
// ---------------------------------------------------------------------------

export class LogWriter {
  constructor(private readonly logsDir: string) {}

  /**
   * Append a log entry to the execution's JSONL file.
   * Creates the log directory if it doesn't exist.
   */
  async append(executionId: string, entry: LogEntry): Promise<void> {
    if (!existsSync(this.logsDir)) {
      mkdirSync(this.logsDir, { recursive: true });
    }
    const path = this.logPath(executionId);
    appendFileSync(path, JSON.stringify(entry) + "\n", "utf8");
  }

  /**
   * Return the absolute path to the log file for an execution.
   */
  logPath(executionId: string): string {
    return join(this.logsDir, `${executionId}.jsonl`);
  }
}

// ---------------------------------------------------------------------------
// Read + filter
// ---------------------------------------------------------------------------

export interface ReadLogOptions {
  level?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

/**
 * Read JSONL log entries for an execution with optional filtering.
 *
 * Returns an empty array if the file does not exist (execution not started
 * or logs not yet written).
 */
export async function readLogEntries(
  logsDir: string,
  executionId: string,
  options: ReadLogOptions = {}
): Promise<LogEntry[]> {
  const path = join(logsDir, `${executionId}.jsonl`);

  if (!existsSync(path)) return [];

  const text = await Bun.file(path).text();
  const lines = text.trim().split("\n").filter(Boolean);

  let entries: LogEntry[] = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line) as LogEntry);
    } catch {
      // Skip malformed lines silently.
    }
  }

  // Apply level filter.
  if (options.level) {
    const lvl = options.level.toLowerCase();
    entries = entries.filter((e) => e.level === lvl);
  }

  // Apply case-insensitive search filter against msg.
  if (options.search) {
    const needle = options.search.toLowerCase();
    entries = entries.filter((e) => e.msg.toLowerCase().includes(needle));
  }

  // Apply pagination.
  const offset = options.offset ?? 0;
  const limit = options.limit ?? entries.length;
  return entries.slice(offset, offset + limit);
}
```

- [ ] **Step 4: Run test** (expected: PASS)

```bash
cd packages/executor && bun test src/__tests__/log-writer.test.ts
# Expected: 9 tests pass
```

---

### Task 3: GET /api/executions/:id/logs route

**Files:**
- Modify: `packages/server/src/routes/executions.ts`
- Create: `packages/server/src/__tests__/execution-logs-route.test.ts`

**Context:** Add `GET /api/executions/:id/logs` that reads the JSONL file for the execution. Accepts query params: `level`, `search`, `limit` (max 2000), `offset`. Returns `{ executionId, entries: LogEntry[], total: number }`. The `logsDir` is injected into the route factory. If the file does not exist, returns an empty entries array (not 404 — the execution exists, logs just haven't been written yet).

- [ ] **Step 1: Write failing test**

```typescript
// packages/server/src/__tests__/execution-logs-route.test.ts
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
    getExecution: () => executionExists
      ? { id: "ex-1", taskId: "t-1", status: "completed" } as unknown
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
```

- [ ] **Step 2: Run test** (expected: FAIL — route signature mismatch)

```bash
cd packages/server && bun test src/__tests__/execution-logs-route.test.ts
# Expected: executionRoutes does not accept logsDir
```

- [ ] **Step 3: Modify `executionRoutes()` to accept `logsDir` and add route**

In `packages/server/src/routes/executions.ts`:

Change the function signature to accept an optional `logsDir`:

```typescript
import { readLogEntries } from "@baara-next/executor";

export function executionRoutes(
  orchestrator: IOrchestratorService,
  store: IStore,
  devTransport?: DevTransport,
  logsDir?: string
): Hono {
  const router = new Hono();

  // ... all existing routes unchanged ...

  // GET /api/executions/:id/logs — JSONL log reader (new in Phase 5)
  router.get("/:id/logs", async (c) => {
    const id = c.req.param("id");
    const execution = store.getExecution(id);
    if (!execution) {
      return c.json({ error: `Execution not found: "${id}"` }, 404);
    }

    if (!logsDir) {
      return c.json({ executionId: id, entries: [], total: 0 });
    }

    const rawLevel = c.req.query("level");
    const rawSearch = c.req.query("search");
    const rawLimit = c.req.query("limit");
    const rawOffset = c.req.query("offset");

    const limit = rawLimit && !isNaN(Number(rawLimit))
      ? Math.min(parseInt(rawLimit, 10), 2000)
      : undefined;
    const offset = rawOffset && !isNaN(Number(rawOffset))
      ? parseInt(rawOffset, 10)
      : undefined;

    const entries = await readLogEntries(logsDir, id, {
      level: rawLevel ?? undefined,
      search: rawSearch ?? undefined,
      limit,
      offset,
    });

    return c.json({ executionId: id, entries, total: entries.length });
  });

  return router;
}
```

- [ ] **Step 4: Run test** (expected: PASS)

```bash
cd packages/server && bun test src/__tests__/execution-logs-route.test.ts
# Expected: 5 tests pass
```

---

### Task 4: WebSocket streaming — new event types

**Files:**
- Modify: `packages/server/src/ws.ts`
- Create: `packages/server/src/__tests__/ws-events.test.ts`

**Context:** The existing `ws.ts` only broadcasts `execution_status_changed` and `queue_depth_changed`. Phase 5 adds three new broadcast event types for real-time sandbox event streaming: `log`, `text_delta`, and `tool_event`. The `broadcast()` function signature is extended to accept the union. A new `broadcastSandboxEvent()` helper converts a `SandboxEvent` to the appropriate WS event.

- [ ] **Step 1: Write failing test**

```typescript
// packages/server/src/__tests__/ws-events.test.ts
import { describe, it, expect } from "bun:test";
import { sandboxEventToWsEvent, type WsEvent } from "../ws.ts";
import type { SandboxEvent } from "@baara-next/core";

describe("sandboxEventToWsEvent", () => {
  it("converts log event", () => {
    const event: SandboxEvent = {
      type: "log",
      level: "info",
      message: "test",
      timestamp: "2026-04-04T00:00:00Z",
    };
    const ws = sandboxEventToWsEvent("ex-1", event);
    expect(ws).not.toBeNull();
    expect(ws!.type).toBe("execution_log");
    expect((ws as { executionId: string }).executionId).toBe("ex-1");
  });

  it("converts text_delta event", () => {
    const event: SandboxEvent = { type: "text_delta", delta: "hello" };
    const ws = sandboxEventToWsEvent("ex-1", event);
    expect(ws!.type).toBe("execution_text_delta");
    expect((ws as { delta: string }).delta).toBe("hello");
  });

  it("converts tool_use event", () => {
    const event: SandboxEvent = { type: "tool_use", name: "Bash", input: { command: "ls" } };
    const ws = sandboxEventToWsEvent("ex-1", event);
    expect(ws!.type).toBe("execution_tool_event");
    expect((ws as { eventType: string }).eventType).toBe("tool_use");
  });

  it("converts tool_result event", () => {
    const event: SandboxEvent = { type: "tool_result", name: "Bash", output: "ok", isError: false };
    const ws = sandboxEventToWsEvent("ex-1", event);
    expect(ws!.type).toBe("execution_tool_event");
    expect((ws as { eventType: string }).eventType).toBe("tool_result");
  });

  it("returns null for checkpoint event (not broadcast to clients)", () => {
    const event: SandboxEvent = { type: "checkpoint", checkpoint: {} };
    expect(sandboxEventToWsEvent("ex-1", event)).toBeNull();
  });

  it("returns null for turn_complete event", () => {
    const event: SandboxEvent = { type: "turn_complete", turnCount: 1, inputTokens: 100, outputTokens: 50 };
    // turn_complete may be broadcast as a status update — but returns null if not implemented yet
    const ws = sandboxEventToWsEvent("ex-1", event);
    // Either null or a valid WsEvent — must not throw
    expect(ws === null || typeof ws === "object").toBe(true);
  });
});
```

- [ ] **Step 2: Run test** (expected: FAIL — sandboxEventToWsEvent not exported)

```bash
cd packages/server && bun test src/__tests__/ws-events.test.ts
# Expected: error: sandboxEventToWsEvent is not exported
```

- [ ] **Step 3: Modify `ws.ts`**

```typescript
// packages/server/src/ws.ts
// @baara-next/server — WebSocket support
//
// Phase 5 adds three new event types for real-time sandbox event streaming:
//   execution_log         — { type, executionId, level, message, timestamp }
//   execution_text_delta  — { type, executionId, delta }
//   execution_tool_event  — { type, executionId, eventType, name, data }
//
// Existing event types are unchanged:
//   execution_status_changed  — { type, executionId, status, taskId }
//   queue_depth_changed       — { type, queueName, depth, activeCount }

import type { ServerWebSocket } from "bun";
import type { SandboxEvent } from "@baara-next/core";

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export interface ExecutionStatusChangedEvent {
  type: "execution_status_changed";
  executionId: string;
  taskId: string;
  status: string;
  timestamp: string;
}

export interface QueueDepthChangedEvent {
  type: "queue_depth_changed";
  queueName: string;
  depth: number;
  activeCount: number;
  timestamp: string;
}

// Phase 5 new event types:

export interface ExecutionLogEvent {
  type: "execution_log";
  executionId: string;
  level: string;
  message: string;
  timestamp: string;
}

export interface ExecutionTextDeltaEvent {
  type: "execution_text_delta";
  executionId: string;
  delta: string;
}

export interface ExecutionToolEvent {
  type: "execution_tool_event";
  executionId: string;
  eventType: "tool_use" | "tool_result";
  name: string;
  data: unknown;
}

export type WsEvent =
  | ExecutionStatusChangedEvent
  | QueueDepthChangedEvent
  | ExecutionLogEvent
  | ExecutionTextDeltaEvent
  | ExecutionToolEvent;

// ---------------------------------------------------------------------------
// Client tracking
// ---------------------------------------------------------------------------

const clients = new Set<ServerWebSocket<unknown>>();

/**
 * Send `event` to all connected WebSocket clients.
 * JSON-serialises before sending. Closed clients are silently removed.
 */
export function broadcast(event: WsEvent): void {
  const payload = JSON.stringify(event);
  for (const ws of clients) {
    try {
      ws.send(payload);
    } catch {
      clients.delete(ws);
    }
  }
}

// ---------------------------------------------------------------------------
// sandboxEventToWsEvent — converts SandboxEvent → WsEvent
// ---------------------------------------------------------------------------

/**
 * Convert a SandboxEvent emitted by a sandbox instance to a WebSocket event
 * suitable for broadcasting to web clients.
 *
 * Returns null for event types that are not broadcast to clients (e.g.,
 * checkpoint events — those are internal durability state, not UI-relevant).
 */
export function sandboxEventToWsEvent(
  executionId: string,
  event: SandboxEvent
): WsEvent | null {
  switch (event.type) {
    case "log":
      return {
        type: "execution_log",
        executionId,
        level: event.level,
        message: event.message,
        timestamp: event.timestamp,
      } satisfies ExecutionLogEvent;

    case "text_delta":
      return {
        type: "execution_text_delta",
        executionId,
        delta: event.delta,
      } satisfies ExecutionTextDeltaEvent;

    case "tool_use":
      return {
        type: "execution_tool_event",
        executionId,
        eventType: "tool_use",
        name: event.name,
        data: event.input,
      } satisfies ExecutionToolEvent;

    case "tool_result":
      return {
        type: "execution_tool_event",
        executionId,
        eventType: "tool_result",
        name: event.name,
        data: { output: event.output, isError: event.isError },
      } satisfies ExecutionToolEvent;

    case "turn_complete":
      // Broadcast as a status update so the UI can show turn progress.
      return {
        type: "execution_status_changed",
        executionId,
        taskId: "",
        status: `running:turn_${event.turnCount}`,
        timestamp: new Date().toISOString(),
      } satisfies ExecutionStatusChangedEvent;

    case "checkpoint":
    case "hitl_request":
      // Not broadcast to generic WebSocket clients — handled via dedicated API.
      return null;

    default:
      return null;
  }
}

/**
 * Broadcast all relevant events from a sandbox event stream to connected
 * WebSocket clients. Called by the orchestrator's runDirect/sandbox path.
 */
export function broadcastSandboxEvents(
  executionId: string,
  events: AsyncIterable<SandboxEvent>
): void {
  // Fire-and-forget async loop — errors are logged but not propagated.
  void (async () => {
    try {
      for await (const event of events) {
        const wsEvent = sandboxEventToWsEvent(executionId, event);
        if (wsEvent) broadcast(wsEvent);
      }
    } catch (err) {
      console.error(`[ws] Error streaming events for ${executionId}:`, err);
    }
  })();
}

// ---------------------------------------------------------------------------
// Bun.serve WebSocket option factory
// ---------------------------------------------------------------------------

export function createWebSocketOptions(): Bun.WebSocketHandler<unknown> {
  return {
    open(ws) {
      clients.add(ws);
    },
    close(ws) {
      clients.delete(ws);
    },
    message(_ws, _message) {
      // Server-push only; incoming messages are ignored.
    },
  };
}

export function connectedClientCount(): number {
  return clients.size;
}
```

- [ ] **Step 4: Run test** (expected: PASS)

```bash
cd packages/server && bun test src/__tests__/ws-events.test.ts
# Expected: 6 tests pass
```

---

### Task 5: MCP tool updates — create_task, list_tasks, get_execution_logs

**Files:**
- Modify: `packages/mcp/src/tools/tasks.ts`
- Modify: `packages/mcp/src/tools/executions.ts`

**Context:** `create_task` currently uses `executionType: z.enum(["cloud_code", "wasm", "wasm_edge", "shell"])`. Replace with `sandboxType: z.enum(["native", "wasm", "docker"])` and `sandboxConfig: z.object({...}).optional()`. Keep `executionType` as a deprecated alias field that maps to `sandboxType` for backward compat. `list_tasks` response adds `sandboxType`. `get_execution_logs` MCP tool currently reads from `execution.output` — update it to read from the JSONL file via `readLogEntries`.

- [ ] **Step 1: Modify `create_task` Zod schema in tasks.ts**

In `createTask` tool definition, replace the `executionType` param with `sandboxType` + `sandboxConfig`:

```typescript
// Replace the executionType field:
//   executionType: z.enum(["cloud_code", "wasm", "wasm_edge", "shell"]).optional()
// With:
sandboxType: z.enum(["native", "wasm", "docker"])
  .optional()
  .describe("Sandbox type (default: native)"),
sandboxConfig: z.object({
  networkEnabled: z.boolean().optional(),
  maxMemoryMb: z.number().int().positive().optional(),
  maxCpuPercent: z.number().int().min(1).max(100).optional(),
  ports: z.array(z.number().int()).optional(),
}).optional().describe("Wasm sandbox resource limits (only used when sandboxType is 'wasm')"),
// Keep executionType as deprecated alias:
executionType: z.enum(["cloud_code", "wasm", "wasm_edge", "shell"])
  .optional()
  .describe("DEPRECATED: use sandboxType instead"),
```

Update the tool handler body to map the new fields:

```typescript
async (args) => {
  try {
    const id = crypto.randomUUID();

    // Map deprecated executionType → sandboxType if present.
    const resolvedSandboxType: "native" | "wasm" | "docker" | undefined =
      args.sandboxType ??
      (args.executionType === "wasm" || args.executionType === "wasm_edge"
        ? "wasm"
        : args.executionType ? "native" : undefined);

    const sandboxConfig = resolvedSandboxType === "wasm" && args.sandboxConfig
      ? { type: "wasm" as const, ...args.sandboxConfig }
      : resolvedSandboxType ? { type: resolvedSandboxType } : undefined;

    const task = store.createTask(id, {
      name: args.name,
      prompt: args.prompt,
      description: args.description,
      cronExpression: args.cronExpression ?? null,
      sandboxType: resolvedSandboxType,
      sandboxConfig: sandboxConfig ? JSON.stringify(sandboxConfig) : undefined,
      executionMode: args.executionMode,
      priority: args.priority as 0 | 1 | 2 | 3 | undefined,
      maxRetries: args.maxRetries,
      timeoutMs: args.timeoutMs,
      projectId: args.projectId ?? null,
      agentConfig: args.allowedTools ? { allowedTools: args.allowedTools } : null,
    });
    return ok(task);
  } catch (e) {
    return err(`Failed to create task: ${String(e)}`);
  }
}
```

Update `listTasks` response to include `sandboxType`:

```typescript
tasks.map((t) => ({
  id: t.id,
  name: t.name,
  description: t.description,
  cron: t.cronExpression ?? null,
  sandboxType: (t as unknown as { sandboxType?: string }).sandboxType ?? t.executionType ?? "native",
  executionMode: t.executionMode,
  priority: t.priority,
  enabled: t.enabled,
  targetQueue: t.targetQueue,
  projectId: t.projectId ?? null,
}))
```

- [ ] **Step 2: Update `get_execution_logs` in executions.ts**

Replace the current implementation that reads from `execution.output` with one that reads from the JSONL file:

```typescript
// 9. get_execution_logs — reads JSONL log file (Phase 5 upgrade)
const getExecutionLogs = tool(
  "get_execution_logs",
  "Get structured log entries for an execution from the JSONL log file",
  {
    executionId: z.string().describe("Execution UUID"),
    level: z.enum(["info", "warn", "error", "debug"]).optional().describe("Filter by log level"),
    search: z.string().optional().describe("Case-insensitive text search in log messages"),
    limit: z.number().int().min(1).max(2000).optional().describe("Max entries to return (default: 200)"),
    offset: z.number().int().min(0).optional().describe("Entries to skip (for pagination)"),
  },
  async ({ executionId, level, search, limit, offset }) => {
    const execution = store.getExecution(executionId);
    if (!execution) return err(`Execution not found: ${executionId}`);

    // Try JSONL file first (Phase 5 path).
    const logsDir = deps.logsDir;
    if (logsDir) {
      const { readLogEntries } = await import("@baara-next/executor");
      const entries = await readLogEntries(logsDir, executionId, {
        level,
        search,
        limit: limit ?? 200,
        offset,
      });
      return ok({
        executionId,
        status: execution.status,
        source: "jsonl",
        entries,
        total: entries.length,
      });
    }

    // Fallback: read from execution.output field (Phase 1-4 compat).
    const raw = execution.output ?? "";
    const lines = raw.split("\n");
    const filtered = search
      ? lines.filter((line) => line.toLowerCase().includes(search.toLowerCase()))
      : lines;
    const levelFiltered = level
      ? filtered.filter((line) => line.includes(`"${level}"`))
      : filtered;
    const capped = levelFiltered.slice(offset ?? 0, (offset ?? 0) + (limit ?? 200));
    return ok({
      executionId,
      status: execution.status,
      source: "output_field",
      entries: capped.map((msg) => ({ msg, level: "info", ts: "", executionId })),
      total: capped.length,
    });
  }
);
```

Update the `createExecutionTools` function signature to accept `logsDir`:

```typescript
export function createExecutionTools(deps: {
  store: IStore;
  orchestrator: IOrchestratorService;
  logsDir?: string;
}) {
```

- [ ] **Run tests**

```bash
cd packages/mcp && bun test
# Expected: all tests pass (update any snapshot-style tests that check the create_task schema)
```

---

### Task 6: CLI updates — `tasks create` + `tasks logs`

**Files:**
- Modify: `packages/cli/src/commands/tasks.ts`

**Context:** Replace `--type cloud_code|shell|wasm|wasm_edge` with `--sandbox native|wasm|docker`. Add `--wasm-memory`, `--wasm-network` flags. Add a new `tasks logs <executionId>` subcommand that reads the JSONL file.

- [ ] **Step 1: Update `tasks create` options**

In the `tasks create` subcommand, replace:

```typescript
// Replace:
.option("--type <type>", "Execution type: cloud_code | shell | wasm | wasm_edge", "cloud_code")
// With:
.option("--sandbox <type>", "Sandbox type: native | wasm | docker", "native")
.option("--wasm-memory <mb>", "Wasm sandbox max memory in MB (only used with --sandbox wasm)")
.option("--wasm-network <bool>", "Enable network in Wasm sandbox: true | false (default: true)")
.option("--tools <list>", "Comma-separated allowed tool names, e.g. 'Bash,Read,Write'")
.option("--model <model>", "Claude model override, e.g. claude-sonnet-4-20250514")
.option("--budget <usd>", "Budget cap in USD, e.g. 2.00")
```

Update the action handler type and body:

```typescript
(opts: {
  name: string;
  prompt: string;
  description?: string;
  sandbox: string;
  wasmMemory?: string;
  wasmNetwork?: string;
  tools?: string;
  model?: string;
  budget?: string;
  mode: string;
  priority: string;
  cron?: string;
  timeout: string;
  maxRetries: string;
  projectId?: string;
  json?: boolean;
  dataDir: string;
}) => {
  const store = createStore(resolveDbPath(opts));
  const taskManager = new TaskManager(store);
  try {
    const sandboxType = (opts.sandbox as "native" | "wasm" | "docker") ?? "native";

    const sandboxConfig =
      sandboxType === "wasm"
        ? {
            type: "wasm" as const,
            maxMemoryMb: opts.wasmMemory ? parseInt(opts.wasmMemory, 10) : undefined,
            networkEnabled: opts.wasmNetwork !== undefined
              ? opts.wasmNetwork === "true"
              : undefined,
          }
        : { type: sandboxType as "native" | "docker" };

    const allowedTools = opts.tools
      ? opts.tools.split(",").map((t) => t.trim()).filter(Boolean)
      : undefined;

    const agentConfig =
      allowedTools || opts.model || opts.budget
        ? {
            allowedTools,
            model: opts.model,
            budgetUsd: opts.budget ? parseFloat(opts.budget) : undefined,
          }
        : null;

    const input: CreateTaskInput = {
      name: opts.name,
      prompt: opts.prompt,
      description: opts.description,
      sandboxType,
      sandboxConfig: JSON.stringify(sandboxConfig),
      executionMode: opts.mode as CreateTaskInput["executionMode"],
      priority: parseInt(opts.priority, 10) as CreateTaskInput["priority"],
      cronExpression: opts.cron ?? null,
      timeoutMs: parseInt(opts.timeout, 10),
      maxRetries: parseInt(opts.maxRetries, 10),
      projectId: opts.projectId ?? null,
      agentConfig,
    };
    const task = taskManager.createTask(input);
    if (opts.json) {
      console.log(formatJson(task));
    } else {
      console.log(`Created task: ${task.id}`);
      console.log(formatTask(task));
    }
  } finally {
    store.close();
  }
}
```

Update `tasks list` column display to show `sandboxType` instead of `executionType`:

```typescript
// In the rows mapping:
const rows = list.map((t) => [
  t.id.slice(0, 8),
  t.name,
  (t as unknown as { sandboxType?: string }).sandboxType ?? t.executionType ?? "native",
  t.executionMode,
  t.enabled ? "enabled" : "disabled",
  t.priority.toString(),
]);
```

- [ ] **Step 2: Add `tasks logs <executionId>` subcommand**

After the `tasks submit` command:

```typescript
// -------------------------------------------------------------------------
// tasks logs
// -------------------------------------------------------------------------
tasks
  .command("logs <executionId>")
  .description("Print structured log entries for an execution")
  .option("--level <level>", "Filter by level: info | warn | error | debug")
  .option("--search <text>", "Case-insensitive text filter")
  .option("--limit <n>", "Max lines to display", "200")
  .option("--follow", "Tail the log file (re-reads every second)", false)
  .option("--json", "Output as JSON")
  .option("--data-dir <dir>", "Data directory", join(homedir(), ".baara"))
  .action(
    async (
      executionId: string,
      opts: {
        level?: string;
        search?: string;
        limit: string;
        follow?: boolean;
        json?: boolean;
        dataDir: string;
      }
    ) => {
      const { readLogEntries } = await import("@baara-next/executor");
      const logsDir = join(opts.dataDir, "logs");
      const limit = parseInt(opts.limit, 10);

      const printEntries = async () => {
        const entries = await readLogEntries(logsDir, executionId, {
          level: opts.level,
          search: opts.search,
          limit,
        });
        if (opts.json) {
          console.log(formatJson(entries));
          return;
        }
        for (const entry of entries) {
          const prefix = `[${entry.ts}] [${entry.level.toUpperCase()}]`;
          console.log(`${prefix} ${entry.msg}`);
        }
      };

      await printEntries();

      if (opts.follow) {
        const interval = setInterval(() => void printEntries(), 1000);
        process.on("SIGINT", () => {
          clearInterval(interval);
          process.exit(0);
        });
      }
    }
  );
```

- [ ] **Verify CLI compiles**

```bash
cd packages/cli && bun run typecheck
# Expected: no type errors
```

---

### Task 7: Web UI updates — types.ts + sandbox selector

**Files:**
- Modify: `packages/web/src/types.ts`

**Context:** Update the web frontend type definitions to add `SandboxType`, `SandboxConfig`, and update `Task` and `CreateTaskInput` to use them alongside the existing `ExecutionType` (kept for backward compat during migration). The UI sandbox selector component is described here; the actual React component implementation follows the same pattern as the existing `ExecutionType` selector.

- [ ] **Step 1: Update `packages/web/src/types.ts`**

Add after the existing type definitions (keep all existing types to avoid breaking the current UI):

```typescript
// ---------------------------------------------------------------------------
// Phase 5: Sandbox architecture
// ---------------------------------------------------------------------------

export type SandboxType = "native" | "wasm" | "docker";

export type SandboxConfig =
  | { type: "native" }
  | {
      type: "wasm";
      networkEnabled?: boolean;
      maxMemoryMb?: number;
      maxCpuPercent?: number;
      ports?: number[];
    }
  | {
      type: "docker";
      image?: string;
      networkEnabled?: boolean;
      ports?: number[];
      volumeMounts?: string[];
    };

// Updated Task shape — sandboxType + sandboxConfig coexist with executionType
// for backward compatibility.
export interface TaskV2 extends Omit<Task, "executionType"> {
  sandboxType: SandboxType;
  sandboxConfig: SandboxConfig | null;
  executionType?: ExecutionType; // kept for compat
}

export interface CreateTaskInputV2 extends Omit<CreateTaskInput, "executionType"> {
  sandboxType?: SandboxType;
  sandboxConfig?: SandboxConfig | null;
  executionType?: ExecutionType; // deprecated alias
}

export interface UpdateTaskInputV2 extends Omit<UpdateTaskInput, "executionType"> {
  sandboxType?: SandboxType;
  sandboxConfig?: SandboxConfig | null;
  executionType?: ExecutionType; // deprecated alias
}

// ---------------------------------------------------------------------------
// Phase 5: Log streaming
// ---------------------------------------------------------------------------

export interface LogEntry {
  ts: string;
  level: "info" | "warn" | "error" | "debug";
  msg: string;
  executionId: string;
  threadId?: string;
  meta?: Record<string, unknown>;
}

// New WebSocket event types for real-time log streaming.
export interface WsExecutionLogEvent {
  type: "execution_log";
  executionId: string;
  level: string;
  message: string;
  timestamp: string;
}

export interface WsExecutionTextDeltaEvent {
  type: "execution_text_delta";
  executionId: string;
  delta: string;
}

export interface WsExecutionToolEvent {
  type: "execution_tool_event";
  executionId: string;
  eventType: "tool_use" | "tool_result";
  name: string;
  data: unknown;
}

// Extend the existing WsEvent union.
export type WsEvent =
  | { type: "execution_status_changed"; executionId: string; taskId: string; status: string; timestamp: string }
  | { type: "queue_depth_changed"; queueName: string; depth: number; activeCount: number; timestamp: string }
  | WsExecutionLogEvent
  | WsExecutionTextDeltaEvent
  | WsExecutionToolEvent;
```

- [ ] **Step 2: Document sandbox selector component contract**

The task creation form at `packages/web/src/` needs a sandbox type selector. The component receives `sandboxType: SandboxType` and `onSandboxTypeChange: (t: SandboxType) => void`. When `sandboxType === "wasm"` it renders additional fields:
- Memory limit slider (128–2048 MB, step 128)
- Network enabled toggle (default: on)
- CPU limit slider (10–100%, step 10)

These fields map to `sandboxConfig.maxMemoryMb`, `sandboxConfig.networkEnabled`, `sandboxConfig.maxCpuPercent`.

The Logs tab on the execution detail page uses `WsExecutionLogEvent` messages pushed over WebSocket and falls back to `GET /api/executions/:id/logs` for historical entries. The log panel renders each entry as:

```
[2026-04-04T12:00:01Z] [INFO] Starting task: api-health-check
[2026-04-04T12:00:02Z] [INFO] [tool] Bash: curl -sf https://api.example.com/health
```

---

### Task 8: Wire LogWriter + logsDir into start.ts

**Files:**
- Modify: `packages/cli/src/commands/start.ts`

**Context:** `start.ts` is the composition root. Add `LogWriter` instantiation and pass `logsDir` to the server routes and MCP tool factories.

- [ ] **Step 1: Update `packages/cli/src/commands/start.ts`**

Add imports:

```typescript
import { MessageBus, LogWriter, createDefaultSandboxRegistry } from "@baara-next/executor";
import { broadcastSandboxEvents } from "@baara-next/server";
```

After `mkdirSync(dataDir, { recursive: true })`, add log directory creation:

```typescript
const logsDir = join(dataDir, "logs");
mkdirSync(logsDir, { recursive: true });
console.log(`  Logs dir:  ${logsDir}`);
```

After `const store = createStore(dbPath)`, wire `MessageBus` and `LogWriter`:

```typescript
// Wire MessageBus to the store's underlying SQLite database.
const rawDb = (store as unknown as { db: import("bun:sqlite").Database }).db;
const messageBus = new MessageBus(rawDb);
const logWriter = new LogWriter(logsDir);
```

Replace `createDefaultRegistry` with `createDefaultSandboxRegistry`:

```typescript
// Replace:
const registry = await createDefaultRegistry({ dataDir });
// With:
const sandboxRegistry = await createDefaultSandboxRegistry({ dataDir });
// Keep legacy registry for AgentService until AgentService is migrated:
const registry = await createDefaultRegistry({ dataDir });
```

Pass `messageBus` and `sandboxRegistry` to `OrchestratorService`:

```typescript
// Replace:
const orchestrator = new OrchestratorService(store, registry);
// With:
const orchestrator = new OrchestratorService(store, registry, messageBus, sandboxRegistry);
```

Pass `logsDir` to `createServer`:

```typescript
const serverConfig = createServer(
  { orchestrator, store, devTransport: transport, apiKey, dataDir, logsDir },
  port,
  opts.hostname
);
```

Log a startup summary line showing the sandbox registry:

```typescript
const availableSandboxes = await sandboxRegistry.getAvailable();
console.log(`  Sandboxes: ${availableSandboxes.map((s) => s.name).join(", ")}`);
```

- [ ] **Step 2: Update `createServer` to accept `logsDir`**

In `packages/server/src/index.ts` (or wherever `createServer` is defined), add `logsDir` to the config object and thread it through to `executionRoutes`:

```typescript
// In the server factory config type:
interface ServerConfig {
  orchestrator: IOrchestratorService;
  store: IStore;
  devTransport?: DevTransport;
  apiKey?: string;
  dataDir: string;
  logsDir?: string;   // NEW
}

// In the router setup:
app.route("/api/executions", executionRoutes(orchestrator, store, devTransport, config.logsDir));
```

- [ ] **Final integration test**

```bash
bun start &
# In another terminal:
curl -s http://localhost:3000/api/tasks -H "Content-Type: application/json" \
  -d '{"name":"log-test","prompt":"echo hello world","sandboxType":"native"}' \
  -X POST

# Submit the task and wait for completion, then check logs:
curl -s "http://localhost:3000/api/executions/{id}/logs" | jq '.entries | length'
# Expected: > 0

# Check JSONL file:
ls ~/.baara/logs/
cat ~/.baara/logs/{id}.jsonl | head -5
```

---

### Verification Checklist

- [ ] `bun test packages/store` — migration 3 tests pass, schema_version = 3
- [ ] `bun test packages/executor` — LogWriter tests pass
- [ ] `bun test packages/server` — logs route tests pass, ws event conversion tests pass
- [ ] `bun test packages/mcp` — create_task schema updated, get_execution_logs reads JSONL
- [ ] `bun run typecheck` (root) — no TypeScript errors across all packages
- [ ] `bun start` — server starts with logsDir shown in startup output
- [ ] Run a task → verify `~/.baara/logs/{id}.jsonl` contains structured entries
- [ ] Fetch `GET /api/executions/{id}/logs` → returns `{ entries: [...], total: N }`
- [ ] Open web UI → task execution detail → Logs tab → real-time entries visible
- [ ] `baara tasks create --name t --prompt p --sandbox wasm --wasm-memory 256` → task created with correct sandboxConfig
- [ ] `baara tasks logs {id}` → prints formatted log entries
- [ ] MCP `create_task` with `sandboxType: "native"` → task created, `list_tasks` shows `sandboxType: "native"`
- [ ] MCP `get_execution_logs` with `executionId` → reads from JSONL, returns `source: "jsonl"`
- [ ] WebSocket client: open `/ws`, run task, receive `execution_log` events in real-time

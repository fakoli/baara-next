# Plan D: Thread Model + Schema

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Add Thread entity linking conversations to executions

**Architecture:** New threads table + thread_id FK on executions. Thread CRUD on IStore. Migration-based schema change.

**Tech Stack:** SQLite (bun:sqlite), TypeScript

---

### Task 1: Add Thread type and update Execution type in core

**Files:**
- Modify: `packages/core/src/types.ts`

- [ ] **Step 1: Add the Thread interface** after the `Project` block (before `QueueInfo`).

```typescript
// ---------------------------------------------------------------------------
// Thread
// ---------------------------------------------------------------------------

/**
 * A logical grouping of a conversation and its linked executions.
 * Threads map to Agent SDK sessions stored at ~/.baara/sessions/.
 */
export interface Thread {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 2: Add `threadId` to the `Execution` interface.** Insert it as the last optional field before `createdAt`:

```typescript
  /** Thread this execution belongs to, if created via chat. */
  threadId?: string | null;
  createdAt: string;
```

The full updated `Execution` interface tail (from `checkpointData` onward) becomes:

```typescript
  /** Opaque JSON blob for mid-execution checkpoint/resume data. */
  checkpointData?: string | null;
  /** Thread this execution belongs to, if created via chat. */
  threadId?: string | null;
  createdAt: string;
}
```

---

### Task 2: Add thread CRUD and thread-scoped execution methods to IStore

**Files:**
- Modify: `packages/core/src/interfaces/store.ts`

- [ ] **Step 1: Add `Thread` to the import list** at the top of the file:

```typescript
import type {
  CreateProjectInput,
  CreateTaskInput,
  CreateTemplateInput,
  Execution,
  ExecutionStatus,
  InputRequest,
  Priority,
  Project,
  QueueInfo,
  Task,
  Template,
  Thread,
  UpdateTaskInput,
} from "../types.ts";
```

- [ ] **Step 2: Add a `Threads` section to `IStore`** — insert it between the `Projects` section and the `Settings` section:

```typescript
  // -------------------------------------------------------------------------
  // Threads
  // -------------------------------------------------------------------------

  /**
   * Insert a new thread row.
   *
   * The caller is responsible for generating `id` (e.g. `crypto.randomUUID()`).
   */
  createThread(id: string, title: string): Thread;

  /** Return the thread with the given id, or null if not found. */
  getThread(id: string): Thread | null;

  /**
   * Return threads, newest first.
   *
   * @param opts.limit - Maximum number of rows to return (default: no limit).
   */
  listThreads(opts?: { limit?: number }): Thread[];

  /**
   * Apply a partial update to an existing thread.
   *
   * Throws `ThreadNotFoundError` if `id` is unknown.
   */
  updateThread(id: string, updates: { title?: string }): Thread;

  /**
   * Delete a thread by id.
   *
   * Throws `ThreadNotFoundError` if `id` is unknown.
   * Executions linked to this thread have their thread_id set to NULL
   * (ON DELETE SET NULL).
   */
  deleteThread(id: string): void;

  /**
   * Associate an execution with a thread.
   *
   * Throws `ExecutionNotFoundError` if `executionId` is unknown.
   * Throws `ThreadNotFoundError` if `threadId` is unknown.
   */
  linkExecutionToThread(executionId: string, threadId: string): void;

  /**
   * Return executions linked to a thread, newest first.
   *
   * @param opts.limit - Maximum number of rows to return (default: no limit).
   */
  listExecutionsByThread(threadId: string, opts?: { limit?: number }): Execution[];
```

---

### Task 3: Add ThreadNotFoundError to core errors

**Files:**
- Modify: `packages/core/src/errors.ts`

- [ ] **Step 1: Locate the existing error classes** (e.g. `ProjectNotFoundError`, `TaskNotFoundError`) and add `ThreadNotFoundError` in the same pattern:

```typescript
export class ThreadNotFoundError extends Error {
  constructor(id: string) {
    super(`Thread not found: ${id}`);
    this.name = "ThreadNotFoundError";
  }
}
```

- [ ] **Step 2: Export `ThreadNotFoundError`** from `packages/core/src/index.ts` alongside the other error exports. Find the errors barrel export line (e.g. `export * from "./errors.ts"`) — it already re-exports everything; no change needed if the barrel uses `export *`. If individual named exports are used, add `ThreadNotFoundError` to the list.

---

### Task 4: Add Migration 2 — threads table + thread_id column

**Files:**
- Modify: `packages/store/src/migrations.ts`

- [ ] **Step 1: Append migration version 2** to the `MIGRATIONS` array. Place it immediately after the closing `},` of version 1:

```typescript
  {
    version: 2,
    description: "Add threads table and thread_id FK on executions",
    up: `
      -- Threads: logical groupings of chat conversations + linked executions
      CREATE TABLE IF NOT EXISTS threads (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      ALTER TABLE executions ADD COLUMN thread_id TEXT REFERENCES threads(id) ON DELETE SET NULL;

      CREATE INDEX IF NOT EXISTS idx_executions_thread
        ON executions(thread_id, created_at DESC);
    `,
  },
```

Note: SQLite's `ALTER TABLE ... ADD COLUMN` does not support adding a column with a FK constraint that has a DEFAULT other than NULL. The column is nullable and defaults to NULL, which is correct. The FK enforcement is enabled via `PRAGMA foreign_keys = ON` (already set in `SQLiteStore` constructor).

---

### Task 5: Implement thread methods in SQLiteStore

**Files:**
- Modify: `packages/store/src/sqlite-store.ts`

- [ ] **Step 1: Add `Thread` and `ThreadNotFoundError` to the import block** at the top of the file. Update the existing imports:

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
} from "@baara-next/core";
import {
  TaskNotFoundError,
  ExecutionNotFoundError,
  InputRequestNotFoundError,
  ProjectNotFoundError,
  TemplateNotFoundError,
  ThreadNotFoundError,
  DuplicateEntityError,
  validateTransition,
} from "@baara-next/core";
```

- [ ] **Step 2: Add the thread CRUD methods** to `SQLiteStore`. Insert a new `// Threads` section after the `deleteProject` method and before the `getSetting` method:

```typescript
  // -------------------------------------------------------------------------
  // Threads
  // -------------------------------------------------------------------------

  createThread(id: string, title: string): Thread {
    this.db.run(
      `INSERT INTO threads (id, title) VALUES (?, ?)`,
      [id, title]
    );
    return this.getThread(id)!;
  }

  getThread(id: string): Thread | null {
    const row = this.db.query("SELECT * FROM threads WHERE id = ?").get(id);
    return row ? rowToThread(row) : null;
  }

  listThreads(opts?: { limit?: number }): Thread[] {
    let sql = "SELECT * FROM threads ORDER BY created_at DESC";
    const params: unknown[] = [];
    if (opts?.limit) {
      sql += " LIMIT ?";
      params.push(opts.limit);
    }
    return this.db
      .query(sql)
      .all(...(params as SQLQueryBindings[]))
      .map(rowToThread);
  }

  updateThread(id: string, updates: { title?: string }): Thread {
    const existing = this.getThread(id);
    if (!existing) throw new ThreadNotFoundError(id);

    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.title !== undefined) {
      fields.push("title = ?");
      values.push(updates.title);
    }

    if (fields.length === 0) return existing;

    fields.push("updated_at = datetime('now')");
    values.push(id);

    this.db.run(
      `UPDATE threads SET ${fields.join(", ")} WHERE id = ?`,
      values as SQLQueryBindings[]
    );
    return this.getThread(id)!;
  }

  deleteThread(id: string): void {
    const existing = this.getThread(id);
    if (!existing) throw new ThreadNotFoundError(id);
    // thread_id FK on executions is ON DELETE SET NULL — SQLite handles unlinking
    this.db.run("DELETE FROM threads WHERE id = ?", [id]);
  }

  linkExecutionToThread(executionId: string, threadId: string): void {
    const exec = this.getExecution(executionId);
    if (!exec) throw new ExecutionNotFoundError(executionId);

    const thread = this.getThread(threadId);
    if (!thread) throw new ThreadNotFoundError(threadId);

    this.db.run(
      "UPDATE executions SET thread_id = ? WHERE id = ?",
      [threadId, executionId]
    );
  }

  listExecutionsByThread(
    threadId: string,
    opts?: { limit?: number }
  ): Execution[] {
    let sql = "SELECT * FROM executions WHERE thread_id = ? ORDER BY created_at DESC";
    const params: unknown[] = [threadId];
    if (opts?.limit) {
      sql += " LIMIT ?";
      params.push(opts.limit);
    }
    return this.db
      .query(sql)
      .all(...(params as SQLQueryBindings[]))
      .map(rowToExecution);
  }
```

- [ ] **Step 3: Update `rowToExecution` mapper** to include `threadId`. Find the existing `rowToExecution` function and add the new field before the closing brace:

```typescript
function rowToExecution(row: unknown): Execution {
  const r = row as Record<string, unknown>;
  return {
    id: r["id"] as string,
    taskId: r["task_id"] as string,
    queueName: r["queue_name"] as string,
    priority: r["priority"] as Priority,
    status: r["status"] as ExecutionStatus,
    attempt: r["attempt"] as number,
    scheduledAt: r["scheduled_at"] as string,
    startedAt: (r["started_at"] as string | null) ?? null,
    completedAt: (r["completed_at"] as string | null) ?? null,
    durationMs: (r["duration_ms"] as number | null) ?? null,
    output: (r["output"] as string | null) ?? null,
    error: (r["error"] as string | null) ?? null,
    inputTokens: (r["input_tokens"] as number | null) ?? null,
    outputTokens: (r["output_tokens"] as number | null) ?? null,
    healthStatus: (r["health_status"] as HealthStatus) ?? "healthy",
    turnCount: (r["turn_count"] as number) ?? 0,
    checkpointData: (r["checkpoint_data"] as string | null) ?? null,
    threadId: (r["thread_id"] as string | null) ?? null,
    createdAt: r["created_at"] as string,
  };
}
```

- [ ] **Step 4: Add `rowToThread` mapper** to the row-mapper section at the bottom of the file, after `rowToProject`:

```typescript
function rowToThread(row: unknown): Thread {
  const r = row as Record<string, unknown>;
  return {
    id: r["id"] as string,
    title: r["title"] as string,
    createdAt: r["created_at"] as string,
    updatedAt: r["updated_at"] as string,
  };
}
```

---

### Task 6: Verify — typecheck and smoke test

**Files:**
- No new files. Run commands from repo root.

- [ ] **Step 1: Typecheck the affected packages.**

```sh
cd /path/to/baara-next && turbo typecheck --filter=@baara-next/core --filter=@baara-next/store
```

Expected: zero type errors.

- [ ] **Step 2: Run store tests** (if a test file exists):

```sh
turbo test --filter=@baara-next/store
```

Expected: all existing tests pass; the migration runner applies version 2 automatically on a fresh DB.

- [ ] **Step 3: Smoke-test thread round-trip** via a short Bun script. Save as a temporary file, run it, then delete it:

```typescript
// /tmp/thread-smoke.ts
import { SQLiteStore } from "@baara-next/store";

const store = new SQLiteStore("/tmp/smoke-test.db");

// Create a thread
const threadId = crypto.randomUUID();
const thread = store.createThread(threadId, "Test conversation");
console.assert(thread.id === threadId, "createThread: id matches");
console.assert(thread.title === "Test conversation", "createThread: title matches");

// Get it back
const fetched = store.getThread(threadId);
console.assert(fetched !== null, "getThread: found");
console.assert(fetched!.title === "Test conversation", "getThread: title correct");

// List
const list = store.listThreads();
console.assert(list.length >= 1, "listThreads: at least one result");

// Update
const updated = store.updateThread(threadId, { title: "Renamed thread" });
console.assert(updated.title === "Renamed thread", "updateThread: title updated");

// Create a task + execution, then link to thread
const taskId = crypto.randomUUID();
store.createTask(taskId, { name: "smoke-task", prompt: "echo hi" });
const execId = crypto.randomUUID();
store.createExecution(execId, taskId, "transfer", 1, new Date().toISOString());

store.linkExecutionToThread(execId, threadId);
const execs = store.listExecutionsByThread(threadId);
console.assert(execs.length === 1, "listExecutionsByThread: one execution linked");
console.assert(execs[0]!.threadId === threadId, "listExecutionsByThread: threadId set");

// Delete thread — execution threadId becomes null (ON DELETE SET NULL)
store.deleteThread(threadId);
const orphanExec = store.getExecution(execId);
console.assert(orphanExec?.threadId === null, "deleteThread: execution threadId nulled");

console.log("All thread smoke tests passed.");
store.close();
```

Run with:

```sh
bun run /tmp/thread-smoke.ts
```

Expected output: `All thread smoke tests passed.`

---

### Completion Checklist

- [ ] `packages/core/src/types.ts` — `Thread` interface added, `Execution.threadId` added
- [ ] `packages/core/src/interfaces/store.ts` — `Thread` imported, thread CRUD + link/list methods declared
- [ ] `packages/core/src/errors.ts` — `ThreadNotFoundError` added and exported
- [ ] `packages/store/src/migrations.ts` — migration version 2 appended (threads table + thread_id column + index)
- [ ] `packages/store/src/sqlite-store.ts` — `Thread`/`ThreadNotFoundError` imported, all 6 thread methods implemented, `rowToExecution` updated, `rowToThread` mapper added
- [ ] `turbo typecheck` passes for `core` and `store`
- [ ] Smoke test passes on fresh DB

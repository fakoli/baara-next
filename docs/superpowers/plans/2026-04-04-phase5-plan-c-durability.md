# Plan C: Durability — Checkpointing + Recovery

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan.

**Goal:** Add conversation-level checkpointing and crash recovery to BAARA Next. Every N turns the running agent writes its full conversation history to the `task_messages` SQLite queue. When the health monitor detects a stale heartbeat it loads the latest checkpoint and restarts the execution with injected recovery context.

**Architecture:** `CheckpointService` runs inside the executor and emits periodic `checkpoint` events via `MessageBus`. `recovery.ts` builds the injected system prompt and prepared `SandboxExecuteParams`. `HealthMonitor` gains a `recoverExecution()` call path wired through `OrchestratorService`.

**Dependencies (must exist before this plan):** `MessageBus` (`packages/executor/src/message-bus.ts`) and the `task_messages` table (migration 3 — written in Plan E). This plan assumes both exist. If running before Plan E, implement just the `MessageBus` stub and migration inline here in Task 1 and remove the dependency note.

**Tech Stack:** `bun:sqlite`, `@baara-next/core` types, no new npm packages.

---

### Task 1: MessageBus — SQLite-backed durable channel

**Files:**
- Create: `packages/executor/src/message-bus.ts`
- Create: `packages/executor/src/__tests__/message-bus.test.ts`

**Context:** The `task_messages` table stores both inbound commands (HITL, pause/resume) and outbound state (checkpoints, logs). `MessageBus` is the single access object. It is constructed with an `IStore`-compatible object but reads/writes `task_messages` directly via the underlying `Database` handle because `IStore` does not yet expose message methods — that is added in Plan E. For now `MessageBus` accepts a `{ db: Database }` shape from `bun:sqlite`.

- [ ] **Step 1: Write failing test**

```typescript
// packages/executor/src/__tests__/message-bus.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { MessageBus } from "../message-bus.ts";

function makeDb(): Database {
  const db = new Database(":memory:");
  db.run(`
    CREATE TABLE task_messages (
      id TEXT PRIMARY KEY,
      execution_id TEXT NOT NULL,
      direction TEXT NOT NULL,
      message_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.run(`CREATE INDEX idx_tm ON task_messages(execution_id, direction, status, created_at)`);
  return db;
}

describe("MessageBus", () => {
  let db: Database;
  let bus: MessageBus;

  beforeEach(() => {
    db = makeDb();
    bus = new MessageBus(db);
  });

  afterEach(() => db.close());

  it("writeCheckpoint then readLatestCheckpoint round-trips", () => {
    const cp = {
      id: "cp-1",
      executionId: "ex-1",
      turnCount: 5,
      conversationHistory: [{ role: "user" as const, content: "hello" }],
      pendingToolCalls: [],
      agentState: {},
      timestamp: new Date().toISOString(),
    };
    bus.writeCheckpoint("ex-1", cp);
    const loaded = bus.readLatestCheckpoint("ex-1");
    expect(loaded).not.toBeNull();
    expect(loaded!.turnCount).toBe(5);
    expect(loaded!.conversationHistory).toHaveLength(1);
  });

  it("sendCommand then readPendingCommands returns the command", () => {
    bus.sendCommand("ex-1", { type: "command", prompt: "continue" });
    const commands = bus.readPendingCommands("ex-1");
    expect(commands).toHaveLength(1);
    expect(commands[0].type).toBe("command");
  });

  it("acknowledgeCommands removes them from pending", () => {
    bus.sendCommand("ex-1", { type: "pause" });
    const before = bus.readPendingCommands("ex-1");
    expect(before).toHaveLength(1);
    // acknowledgeCommands takes message IDs — read raw to get ID
    const raw = db.query("SELECT id FROM task_messages WHERE execution_id = 'ex-1'").all() as { id: string }[];
    bus.acknowledgeCommands(raw.map((r) => r.id));
    const after = bus.readPendingCommands("ex-1");
    expect(after).toHaveLength(0);
  });

  it("appendLog writes an outbound log row", () => {
    bus.appendLog("ex-1", "info", "test message");
    const row = db.query("SELECT * FROM task_messages WHERE execution_id = 'ex-1' AND message_type = 'log'").get() as { payload: string } | null;
    expect(row).not.toBeNull();
    const payload = JSON.parse(row!.payload) as { level: string; message: string };
    expect(payload.level).toBe("info");
    expect(payload.message).toBe("test message");
  });

  it("readLatestCheckpoint returns null when no checkpoints exist", () => {
    expect(bus.readLatestCheckpoint("nonexistent")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test** (expected: FAIL — module not found)

```bash
cd packages/executor && bun test src/__tests__/message-bus.test.ts
# Expected: error: Cannot find module '../message-bus.ts'
```

- [ ] **Step 3: Write implementation**

```typescript
// packages/executor/src/message-bus.ts
// @baara-next/executor — MessageBus
//
// Durable channel between the orchestrator and running sandbox instances.
// Inbound commands (HITL responses, pause/resume, additional prompts) are
// written by external callers and read by the sandbox polling loop.
// Outbound state (checkpoints, logs) is written by the sandbox and read
// by the health monitor and web UI.

import type { Database } from "bun:sqlite";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Checkpoint {
  id: string;
  executionId: string;
  turnCount: number;
  conversationHistory: ConversationMessage[];
  pendingToolCalls: string[];
  agentState: Record<string, unknown>;
  timestamp: string;
}

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

export interface ContentBlock {
  type: string;
  [key: string]: unknown;
}

export type InboundCommand =
  | { type: "command"; prompt: string }
  | { type: "hitl_response"; response: string }
  | { type: "pause" }
  | { type: "resume" };

// ---------------------------------------------------------------------------
// MessageBus
// ---------------------------------------------------------------------------

export class MessageBus {
  constructor(private readonly db: Database) {}

  // -------------------------------------------------------------------------
  // Inbound commands (orchestrator → sandbox)
  // -------------------------------------------------------------------------

  /**
   * Enqueue a command to be delivered to the running execution.
   * Safe to call from any process/context — writes go directly to SQLite.
   */
  sendCommand(executionId: string, command: InboundCommand): void {
    const id = crypto.randomUUID();
    this.db.run(
      `INSERT INTO task_messages (id, execution_id, direction, message_type, payload, status, created_at)
       VALUES (?, ?, 'inbound', 'command', ?, 'pending', datetime('now'))`,
      [id, executionId, JSON.stringify(command)]
    );
  }

  /**
   * Return all pending inbound commands for an execution in insertion order.
   * Does not mark them delivered — call acknowledgeCommands() after processing.
   */
  readPendingCommands(executionId: string): InboundCommand[] {
    const rows = this.db
      .query(
        `SELECT payload FROM task_messages
         WHERE execution_id = ? AND direction = 'inbound' AND status = 'pending'
         ORDER BY created_at ASC`
      )
      .all(executionId) as { payload: string }[];
    return rows.map((r) => JSON.parse(r.payload) as InboundCommand);
  }

  /**
   * Mark the given message IDs as delivered.
   * Pass the IDs returned by the raw query when you need to acknowledge
   * specific messages after processing.
   */
  acknowledgeCommands(messageIds: string[]): void {
    if (messageIds.length === 0) return;
    const placeholders = messageIds.map(() => "?").join(", ");
    this.db.run(
      `UPDATE task_messages SET status = 'acknowledged' WHERE id IN (${placeholders})`,
      messageIds
    );
  }

  /**
   * Read pending inbound commands AND mark them delivered atomically.
   * Use this in the sandbox polling loop so commands are not double-delivered
   * across restarts.
   */
  drainPendingCommands(executionId: string): InboundCommand[] {
    const rows = this.db
      .query(
        `SELECT id, payload FROM task_messages
         WHERE execution_id = ? AND direction = 'inbound' AND status = 'pending'
         ORDER BY created_at ASC`
      )
      .all(executionId) as { id: string; payload: string }[];

    if (rows.length === 0) return [];

    this.acknowledgeCommands(rows.map((r) => r.id));
    return rows.map((r) => JSON.parse(r.payload) as InboundCommand);
  }

  // -------------------------------------------------------------------------
  // Checkpoints (sandbox → orchestrator)
  // -------------------------------------------------------------------------

  /**
   * Persist a checkpoint snapshot for the execution.
   * Multiple checkpoints may exist; readLatestCheckpoint() returns the newest.
   */
  writeCheckpoint(executionId: string, checkpoint: Checkpoint): void {
    const id = crypto.randomUUID();
    this.db.run(
      `INSERT INTO task_messages (id, execution_id, direction, message_type, payload, status, created_at)
       VALUES (?, ?, 'outbound', 'checkpoint', ?, 'delivered', datetime('now'))`,
      [id, executionId, JSON.stringify(checkpoint)]
    );
  }

  /**
   * Return the most recent checkpoint for an execution, or null if none exist.
   */
  readLatestCheckpoint(executionId: string): Checkpoint | null {
    const row = this.db
      .query(
        `SELECT payload FROM task_messages
         WHERE execution_id = ? AND direction = 'outbound' AND message_type = 'checkpoint'
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .get(executionId) as { payload: string } | null;

    if (!row) return null;
    return JSON.parse(row.payload) as Checkpoint;
  }

  // -------------------------------------------------------------------------
  // Logs (sandbox → orchestrator)
  // -------------------------------------------------------------------------

  /**
   * Append a structured log entry.
   * Also written to JSONL file by LogWriter (Plan E).
   */
  appendLog(executionId: string, level: string, message: string): void {
    const id = crypto.randomUUID();
    const payload = JSON.stringify({
      level,
      message,
      timestamp: new Date().toISOString(),
    });
    this.db.run(
      `INSERT INTO task_messages (id, execution_id, direction, message_type, payload, status, created_at)
       VALUES (?, ?, 'outbound', 'log', ?, 'delivered', datetime('now'))`,
      [id, executionId, payload]
    );
  }

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  /**
   * Delete all messages for an execution (e.g., after retention period expires).
   */
  purgeExecution(executionId: string): void {
    this.db.run(
      `DELETE FROM task_messages WHERE execution_id = ?`,
      [executionId]
    );
  }
}
```

- [ ] **Step 4: Run test** (expected: PASS)

```bash
cd packages/executor && bun test src/__tests__/message-bus.test.ts
# Expected: 5 tests pass
```

---

### Task 2: CheckpointService — periodic checkpointing inside the sandbox

**Files:**
- Create: `packages/executor/src/checkpoint-service.ts`
- Create: `packages/executor/src/__tests__/checkpoint-service.test.ts`

**Context:** `CheckpointService` is instantiated once per execution inside the sandbox instance. It receives a callback that extracts the current conversation history from the SDK session, then writes a `Checkpoint` to the `MessageBus` at a configurable turn interval (default: every 5 turns). It also exposes `checkpoint()` for immediate on-demand writes (e.g., on HITL pause).

- [ ] **Step 1: Write failing test**

```typescript
// packages/executor/src/__tests__/checkpoint-service.test.ts
import { describe, it, expect, mock, beforeEach } from "bun:test";
import { CheckpointService } from "../checkpoint-service.ts";
import type { MessageBus, Checkpoint } from "../message-bus.ts";

function makeMockBus(): MessageBus & { written: Checkpoint[] } {
  const written: Checkpoint[] = [];
  return {
    written,
    writeCheckpoint(_execId: string, cp: Checkpoint) { written.push(cp); },
    sendCommand: mock(() => {}),
    readPendingCommands: mock(() => []),
    acknowledgeCommands: mock(() => {}),
    drainPendingCommands: mock(() => []),
    readLatestCheckpoint: mock(() => null),
    appendLog: mock(() => {}),
    purgeExecution: mock(() => {}),
  } as unknown as MessageBus & { written: Checkpoint[] };
}

describe("CheckpointService", () => {
  let bus: MessageBus & { written: Checkpoint[] };
  let service: CheckpointService;
  const executionId = "ex-checkpoint-test";

  beforeEach(() => {
    bus = makeMockBus();
    service = new CheckpointService({
      executionId,
      messageBus: bus,
      intervalTurns: 3,
      getConversationHistory: () => [
        { role: "user", content: "hello" },
        { role: "assistant", content: "world" },
      ],
    });
  });

  it("does not checkpoint before the interval is reached", () => {
    service.onTurnComplete(1);
    service.onTurnComplete(2);
    expect(bus.written).toHaveLength(0);
  });

  it("checkpoints exactly at the interval", () => {
    service.onTurnComplete(1);
    service.onTurnComplete(2);
    service.onTurnComplete(3);
    expect(bus.written).toHaveLength(1);
    expect(bus.written[0].turnCount).toBe(3);
    expect(bus.written[0].conversationHistory).toHaveLength(2);
  });

  it("checkpoints at every subsequent interval", () => {
    for (let i = 1; i <= 9; i++) service.onTurnComplete(i);
    expect(bus.written).toHaveLength(3); // turns 3, 6, 9
  });

  it("immediate checkpoint() writes regardless of interval", () => {
    service.checkpoint(2);
    expect(bus.written).toHaveLength(1);
    expect(bus.written[0].turnCount).toBe(2);
  });

  it("checkpoint payload includes executionId and timestamp", () => {
    service.checkpoint(1);
    expect(bus.written[0].executionId).toBe(executionId);
    expect(bus.written[0].timestamp).toBeTruthy();
    expect(bus.written[0].id).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test** (expected: FAIL — module not found)

```bash
cd packages/executor && bun test src/__tests__/checkpoint-service.test.ts
# Expected: error: Cannot find module '../checkpoint-service.ts'
```

- [ ] **Step 3: Write implementation**

```typescript
// packages/executor/src/checkpoint-service.ts
// @baara-next/executor — CheckpointService
//
// Runs inside a SandboxInstance. Receives turn-complete notifications from the
// SDK event loop and writes periodic Checkpoint snapshots to the MessageBus.
//
// Usage:
//   const cs = new CheckpointService({ executionId, messageBus, intervalTurns: 5, getConversationHistory });
//   // inside the SDK stream loop, after each assistant turn:
//   cs.onTurnComplete(turnCount);
//   // on HITL pause or explicit checkpoint request:
//   cs.checkpoint(turnCount);

import type { MessageBus, Checkpoint, ConversationMessage } from "./message-bus.ts";

export interface CheckpointServiceConfig {
  executionId: string;
  messageBus: MessageBus;
  /** Write a checkpoint every N completed turns. Default: 5. */
  intervalTurns?: number;
  /** Callback that returns the current conversation history from the SDK session. */
  getConversationHistory: () => ConversationMessage[];
  /** Optional: return in-flight tool names at checkpoint time. */
  getPendingToolCalls?: () => string[];
}

export class CheckpointService {
  private readonly executionId: string;
  private readonly messageBus: MessageBus;
  private readonly intervalTurns: number;
  private readonly getConversationHistory: () => ConversationMessage[];
  private readonly getPendingToolCalls: () => string[];

  constructor(config: CheckpointServiceConfig) {
    this.executionId = config.executionId;
    this.messageBus = config.messageBus;
    this.intervalTurns = config.intervalTurns ?? 5;
    this.getConversationHistory = config.getConversationHistory;
    this.getPendingToolCalls = config.getPendingToolCalls ?? (() => []);
  }

  /**
   * Call this after every completed assistant turn.
   * Writes a checkpoint when `turnCount` is a multiple of `intervalTurns`.
   */
  onTurnComplete(turnCount: number): void {
    if (turnCount > 0 && turnCount % this.intervalTurns === 0) {
      this.checkpoint(turnCount);
    }
  }

  /**
   * Write a checkpoint immediately regardless of the interval.
   * Use on HITL pause, on explicit operator request, or on clean completion.
   */
  checkpoint(turnCount: number): void {
    const cp: Checkpoint = {
      id: crypto.randomUUID(),
      executionId: this.executionId,
      turnCount,
      conversationHistory: this.getConversationHistory(),
      pendingToolCalls: this.getPendingToolCalls(),
      agentState: {},
      timestamp: new Date().toISOString(),
    };
    this.messageBus.writeCheckpoint(this.executionId, cp);
  }
}
```

- [ ] **Step 4: Run test** (expected: PASS)

```bash
cd packages/executor && bun test src/__tests__/checkpoint-service.test.ts
# Expected: 5 tests pass
```

---

### Task 3: recovery.ts — build recovery prompt + SandboxExecuteParams

**Files:**
- Create: `packages/executor/src/recovery.ts`
- Create: `packages/executor/src/__tests__/recovery.test.ts`

**Context:** When a crashed execution is recovered, the new sandbox instance must be given context about what happened before. `buildRecoveryPrompt()` generates the standardised recovery system prompt addition defined in the spec. `prepareRecoveryParams()` assembles the full `SandboxExecuteParams` that the new `NativeSandboxInstance.execute()` will receive, including the prior conversation history injected as the `checkpoint` field.

- [ ] **Step 1: Write failing test**

```typescript
// packages/executor/src/__tests__/recovery.test.ts
import { describe, it, expect } from "bun:test";
import { buildRecoveryPrompt, prepareRecoveryParams } from "../recovery.ts";
import type { Checkpoint } from "../message-bus.ts";

const baseCheckpoint: Checkpoint = {
  id: "cp-1",
  executionId: "ex-1",
  turnCount: 7,
  conversationHistory: [
    { role: "user", content: "Run the test suite" },
    { role: "assistant", content: "Running npm test..." },
  ],
  pendingToolCalls: ["Bash"],
  agentState: {},
  timestamp: "2026-04-04T10:00:00Z",
};

describe("buildRecoveryPrompt", () => {
  it("includes the turn count", () => {
    const prompt = buildRecoveryPrompt(baseCheckpoint);
    expect(prompt).toContain("7");
  });

  it("includes RECOVERY CONTEXT header", () => {
    const prompt = buildRecoveryPrompt(baseCheckpoint);
    expect(prompt).toContain("RECOVERY CONTEXT");
  });

  it("includes pending tool call names", () => {
    const prompt = buildRecoveryPrompt(baseCheckpoint);
    expect(prompt).toContain("Bash");
  });

  it("instructs the agent not to repeat completed work", () => {
    const prompt = buildRecoveryPrompt(baseCheckpoint);
    expect(prompt).toMatch(/verify|do not repeat|check/i);
  });

  it("returns empty string when no checkpoint provided", () => {
    expect(buildRecoveryPrompt(null)).toBe("");
  });
});

describe("prepareRecoveryParams", () => {
  it("returns params with checkpoint populated", () => {
    const params = prepareRecoveryParams(baseCheckpoint, {
      executionId: "ex-2",
      prompt: "Run the test suite",
      tools: ["Bash", "Read"],
      agentConfig: { model: "claude-sonnet-4-20250514" },
      timeout: 300_000,
    });
    expect(params.checkpoint).toBe(baseCheckpoint);
    expect(params.executionId).toBe("ex-2");
  });

  it("prepends recovery prompt to agentConfig.systemPrompt", () => {
    const params = prepareRecoveryParams(baseCheckpoint, {
      executionId: "ex-2",
      prompt: "original prompt",
      tools: [],
      agentConfig: { systemPrompt: "Be concise." },
      timeout: 300_000,
    });
    expect(params.agentConfig.systemPrompt).toContain("RECOVERY CONTEXT");
    expect(params.agentConfig.systemPrompt).toContain("Be concise.");
  });
});
```

- [ ] **Step 2: Run test** (expected: FAIL — module not found)

```bash
cd packages/executor && bun test src/__tests__/recovery.test.ts
# Expected: error: Cannot find module '../recovery.ts'
```

- [ ] **Step 3: Write implementation**

```typescript
// packages/executor/src/recovery.ts
// @baara-next/executor — Recovery utilities
//
// Builds the recovery system prompt and assembles SandboxExecuteParams for
// resumed executions. Called by OrchestratorService.recoverExecution() after
// a crash is detected and a latest checkpoint has been loaded.

import type { Checkpoint } from "./message-bus.ts";

// ---------------------------------------------------------------------------
// SandboxExecuteParams (local shape — matches ISandbox spec)
// ---------------------------------------------------------------------------

export interface AgentConfig {
  model?: string;
  allowedTools?: string[];
  maxTurns?: number;
  budgetUsd?: number;
  permissionMode?: string;
  systemPrompt?: string;
  mcpServers?: Record<string, unknown>;
}

export interface SandboxExecuteParams {
  executionId: string;
  prompt: string;
  tools: string[];
  agentConfig: AgentConfig;
  checkpoint?: Checkpoint | null;
  environment?: Record<string, string>;
  timeout: number;
}

// ---------------------------------------------------------------------------
// buildRecoveryPrompt
// ---------------------------------------------------------------------------

/**
 * Generate the recovery context block to prepend to the system prompt.
 *
 * Returns an empty string when `checkpoint` is null (no prior state available).
 * The caller is responsible for prepending this to any existing system prompt.
 */
export function buildRecoveryPrompt(checkpoint: Checkpoint | null): string {
  if (!checkpoint) return "";

  const pendingStr =
    checkpoint.pendingToolCalls.length > 0
      ? `In-flight tool calls at checkpoint time: ${checkpoint.pendingToolCalls.join(", ")}.`
      : "No tool calls were in flight at checkpoint time.";

  const lastUserMsg = [...checkpoint.conversationHistory]
    .reverse()
    .find((m) => m.role === "user");
  const lastContext =
    typeof lastUserMsg?.content === "string"
      ? `The last user instruction was: "${lastUserMsg.content.slice(0, 200)}"`
      : "";

  return [
    "RECOVERY CONTEXT: This is a resumed execution. You were previously working on this",
    `task and completed ${checkpoint.turnCount} turns before the session was interrupted.`,
    "",
    pendingStr,
    lastContext,
    "",
    "Please check the current state and continue from where you left off. Do not repeat",
    "work that has already been completed — verify the current state first, then proceed.",
    "---",
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}

// ---------------------------------------------------------------------------
// prepareRecoveryParams
// ---------------------------------------------------------------------------

/**
 * Build the full `SandboxExecuteParams` for a recovered execution.
 *
 * - Injects the prior `conversationHistory` via the `checkpoint` field so the
 *   SDK receives it as message history (implementation in NativeSandboxInstance).
 * - Prepends the recovery system prompt to any existing `agentConfig.systemPrompt`.
 * - All other params are passed through unchanged.
 */
export function prepareRecoveryParams(
  checkpoint: Checkpoint,
  base: SandboxExecuteParams
): SandboxExecuteParams {
  const recoveryPrefix = buildRecoveryPrompt(checkpoint);

  const existingSystemPrompt = base.agentConfig.systemPrompt ?? "";
  const newSystemPrompt = existingSystemPrompt
    ? `${recoveryPrefix}\n\n${existingSystemPrompt}`
    : recoveryPrefix;

  return {
    ...base,
    checkpoint,
    agentConfig: {
      ...base.agentConfig,
      systemPrompt: newSystemPrompt,
    },
  };
}
```

- [ ] **Step 4: Run test** (expected: PASS)

```bash
cd packages/executor && bun test src/__tests__/recovery.test.ts
# Expected: 7 tests pass
```

---

### Task 4: HealthMonitor recovery flow

**Files:**
- Modify: `packages/orchestrator/src/health-monitor.ts`
- Create: `packages/orchestrator/src/__tests__/health-monitor-recovery.test.ts`

**Context:** The existing `HealthMonitor` sets `healthStatus: "unresponsive"` when `elapsed > timeoutMs` but never triggers recovery. In Phase 5 we add a second threshold: if the heartbeat has been stale for more than `2 × checkIntervalMs` AND the execution has a checkpoint available, initiate recovery rather than just marking unresponsive.

The recovery trigger is conservative: it only fires when (a) status is `running`, (b) `updatedAt` on the execution has not changed in `2 × checkIntervalMs`, and (c) a checkpoint exists. Without a checkpoint we cannot safely recover — we just mark unresponsive as before.

The `HealthMonitor` receives an optional `onCrashDetected` callback instead of a direct `OrchestratorService` reference to keep the dependency direction clean.

- [ ] **Step 1: Write failing test**

```typescript
// packages/orchestrator/src/__tests__/health-monitor-recovery.test.ts
import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { HealthMonitor } from "../health-monitor.ts";
import type { IStore, Execution, Task } from "@baara-next/core";

function makeExecution(overrides: Partial<Execution> = {}): Execution {
  const startedAt = new Date(Date.now() - 120_000).toISOString(); // 2 minutes ago
  return {
    id: "ex-1",
    taskId: "task-1",
    queueName: "transfer",
    priority: 1,
    status: "running",
    attempt: 1,
    scheduledAt: startedAt,
    startedAt,
    completedAt: null,
    durationMs: null,
    output: null,
    error: null,
    inputTokens: null,
    outputTokens: null,
    healthStatus: "healthy",
    turnCount: 3,
    createdAt: startedAt,
    ...overrides,
  } as unknown as Execution;
}

function makeTask(timeoutMs = 300_000): Task {
  return {
    id: "task-1",
    name: "test",
    description: "",
    prompt: "do stuff",
    timeoutMs,
    executionType: "cloud_code",
    agentConfig: null,
    priority: 1,
    targetQueue: "transfer",
    maxRetries: 0,
    executionMode: "queued",
    enabled: true,
    projectId: null,
    cronExpression: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as unknown as Task;
}

describe("HealthMonitor recovery callback", () => {
  let store: IStore;
  let onCrashDetected: ReturnType<typeof mock>;
  let monitor: HealthMonitor;

  beforeEach(() => {
    const execution = makeExecution();
    store = {
      listAllExecutions: mock(() => [execution]),
      getTask: mock(() => makeTask()),
      updateExecutionFields: mock(() => {}),
    } as unknown as IStore;

    onCrashDetected = mock((_executionId: string) => {});
    monitor = new HealthMonitor(store, 10_000, onCrashDetected);
  });

  afterEach(() => monitor.stop());

  it("does NOT call onCrashDetected when elapsed < timeout", () => {
    // execution started 2 min ago, timeout is 5 min — not stale
    (store.listAllExecutions as ReturnType<typeof mock>).mockReturnValueOnce([
      makeExecution({ startedAt: new Date(Date.now() - 60_000).toISOString() }),
    ]);
    // Invoke check directly via the private method trick
    (monitor as unknown as { check(): void }).check();
    expect(onCrashDetected).not.toHaveBeenCalled();
  });

  it("calls onCrashDetected when elapsed > timeout AND execution is running", () => {
    // execution started 6 min ago, timeout is 5 min — stale
    (store.listAllExecutions as ReturnType<typeof mock>).mockReturnValueOnce([
      makeExecution({ startedAt: new Date(Date.now() - 360_000).toISOString() }),
    ]);
    (monitor as unknown as { check(): void }).check();
    expect(onCrashDetected).toHaveBeenCalledWith("ex-1");
  });

  it("does NOT call onCrashDetected when healthStatus is already unresponsive", () => {
    (store.listAllExecutions as ReturnType<typeof mock>).mockReturnValueOnce([
      makeExecution({
        startedAt: new Date(Date.now() - 360_000).toISOString(),
        healthStatus: "unresponsive",
      }),
    ]);
    (monitor as unknown as { check(): void }).check();
    // Still sets health but does not call the recovery callback again
    expect(onCrashDetected).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test** (expected: FAIL — HealthMonitor constructor signature mismatch)

```bash
cd packages/orchestrator && bun test src/__tests__/health-monitor-recovery.test.ts
# Expected: constructor argument count error or similar
```

- [ ] **Step 3: Modify `health-monitor.ts`**

Replace the full file content:

```typescript
// packages/orchestrator/src/health-monitor.ts
// @baara-next/orchestrator — Health Monitor
//
// Periodically inspects all running executions and updates health_status.
// In Phase 5 an optional `onCrashDetected` callback is added. When an
// execution has been running longer than its task timeout AND health is
// currently "healthy" or "slow" (first detection), the callback is invoked
// with the executionId so the orchestrator can initiate checkpoint recovery.
//
// Thresholds:
//   elapsed > timeoutMs              → "unresponsive" + onCrashDetected (first time only)
//   elapsed > 0.5 * timeoutMs        → "slow"
//   otherwise                        → "healthy"

import type { IStore } from "@baara-next/core";

export class HealthMonitor {
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private store: IStore,
    /** How often to run the health check, in milliseconds. Default: 10 000. */
    private checkIntervalMs = 10_000,
    /**
     * Optional callback invoked the first time an execution is detected as
     * unresponsive (i.e., the transition healthy/slow → unresponsive).
     * The orchestrator wires this to recoverExecution().
     */
    private onCrashDetected?: (executionId: string) => void
  ) {}

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /** Begin periodic health checks. Idempotent. */
  start(): void {
    if (this.interval !== null) return;
    this.interval = setInterval(() => {
      try {
        this.check();
      } catch (err) {
        console.error("[health-monitor] Check failed:", err);
      }
    }, this.checkIntervalMs);
  }

  /** Stop periodic health checks and release the timer. */
  stop(): void {
    if (this.interval !== null) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  // -------------------------------------------------------------------------
  // Core check — package-internal, exposed for testing via type cast
  // -------------------------------------------------------------------------

  check(): void {
    const running = this.store.listAllExecutions({ status: "running" });
    const now = Date.now();

    for (const execution of running) {
      if (!execution.startedAt) continue;

      const task = this.store.getTask(execution.taskId);
      if (!task) continue;

      const elapsed = now - new Date(execution.startedAt).getTime();
      const timeoutMs = task.timeoutMs;
      const slowThreshold = timeoutMs * 0.5;
      const currentHealth = execution.healthStatus;

      if (elapsed > timeoutMs) {
        if (currentHealth !== "unresponsive") {
          // Transition to unresponsive and trigger recovery callback on
          // the first detection only (currentHealth is healthy or slow).
          this.store.updateExecutionFields(execution.id, {
            healthStatus: "unresponsive",
          });
          if (this.onCrashDetected) {
            try {
              this.onCrashDetected(execution.id);
            } catch (err) {
              console.error(
                `[health-monitor] onCrashDetected threw for ${execution.id}:`,
                err
              );
            }
          }
        }
        // Already unresponsive — do not call onCrashDetected again.
      } else if (elapsed > slowThreshold && currentHealth === "healthy") {
        this.store.updateExecutionFields(execution.id, {
          healthStatus: "slow",
        });
      }
    }
  }
}
```

- [ ] **Step 4: Run test** (expected: PASS)

```bash
cd packages/orchestrator && bun test src/__tests__/health-monitor-recovery.test.ts
# Expected: 3 tests pass
```

---

### Task 5: OrchestratorService.recoverExecution()

**Files:**
- Modify: `packages/orchestrator/src/orchestrator-service.ts`
- Create: `packages/orchestrator/src/__tests__/recovery-flow.test.ts`

**Context:** `recoverExecution()` is the orchestrator's side of the recovery flow. It:
1. Loads the latest checkpoint from `MessageBus`.
2. Transitions the crashed execution to `retry_scheduled`.
3. Creates a new execution attempt linked to the same task and thread.
4. Starts the new execution immediately via `runDirect()` (or enqueues if `runDirect` is unavailable) with the checkpoint injected.

The `MessageBus` is injected optionally — when absent the method falls back to a plain re-enqueue with no checkpoint context (same as the existing `retryExecution()` path).

- [ ] **Step 1: Write failing test**

```typescript
// packages/orchestrator/src/__tests__/recovery-flow.test.ts
import { describe, it, expect, mock, beforeEach } from "bun:test";
import { OrchestratorService } from "../orchestrator-service.ts";
import type { IStore, Task, Execution } from "@baara-next/core";
import type { MessageBus } from "@baara-next/executor";

function makeStore(overrides: Partial<IStore> = {}): IStore {
  const task: Task = {
    id: "task-1",
    name: "t",
    description: "",
    prompt: "do work",
    timeoutMs: 300_000,
    executionType: "cloud_code",
    agentConfig: null,
    priority: 1,
    targetQueue: "transfer",
    maxRetries: 3,
    executionMode: "queued",
    enabled: true,
    projectId: null,
    cronExpression: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as unknown as Task;

  const execution: Execution = {
    id: "ex-crashed",
    taskId: "task-1",
    queueName: "transfer",
    priority: 1,
    status: "running",
    attempt: 1,
    scheduledAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    completedAt: null,
    durationMs: null,
    output: null,
    error: null,
    inputTokens: null,
    outputTokens: null,
    healthStatus: "unresponsive",
    turnCount: 7,
    createdAt: new Date().toISOString(),
    threadId: "thread-1",
  } as unknown as Execution;

  return {
    getTask: mock(() => task),
    getTaskByName: mock(() => null),
    getExecution: mock(() => execution),
    createExecution: mock((id: string) => ({ ...execution, id, attempt: 2 })),
    updateExecutionStatus: mock(() => {}),
    updateExecutionFields: mock(() => {}),
    listAllExecutions: mock(() => []),
    listQueues: mock(() => [{ name: "transfer", depth: 0, activeCount: 0, maxConcurrency: 10, createdAt: "" }]),
    dequeueExecution: mock(() => null),
    listEvents: mock(() => []),
    createEvent: mock(() => {}),
    ...overrides,
  } as unknown as IStore;
}

function makeBus(hasCheckpoint = true): MessageBus {
  const checkpoint = hasCheckpoint
    ? {
        id: "cp-1",
        executionId: "ex-crashed",
        turnCount: 5,
        conversationHistory: [],
        pendingToolCalls: [],
        agentState: {},
        timestamp: new Date().toISOString(),
      }
    : null;

  return {
    readLatestCheckpoint: mock(() => checkpoint),
    writeCheckpoint: mock(() => {}),
    sendCommand: mock(() => {}),
    readPendingCommands: mock(() => []),
    acknowledgeCommands: mock(() => {}),
    drainPendingCommands: mock(() => []),
    appendLog: mock(() => {}),
    purgeExecution: mock(() => {}),
  } as unknown as MessageBus;
}

describe("OrchestratorService.recoverExecution", () => {
  let store: ReturnType<typeof makeStore>;
  let bus: MessageBus;
  let orchestrator: OrchestratorService;

  beforeEach(() => {
    store = makeStore();
    bus = makeBus();
    orchestrator = new OrchestratorService(store, undefined, bus);
  });

  it("transitions crashed execution to retry_scheduled", async () => {
    await orchestrator.recoverExecution("ex-crashed");
    expect(store.updateExecutionStatus).toHaveBeenCalledWith(
      "ex-crashed",
      "retry_scheduled",
      expect.anything()
    );
  });

  it("creates a new execution attempt", async () => {
    await orchestrator.recoverExecution("ex-crashed");
    expect(store.createExecution).toHaveBeenCalled();
  });

  it("reads the latest checkpoint from MessageBus", async () => {
    await orchestrator.recoverExecution("ex-crashed");
    expect(bus.readLatestCheckpoint).toHaveBeenCalledWith("ex-crashed");
  });

  it("works without a MessageBus — falls back to plain re-enqueue", async () => {
    const orch = new OrchestratorService(store);
    await orch.recoverExecution("ex-crashed");
    expect(store.createExecution).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test** (expected: FAIL — recoverExecution not found)

```bash
cd packages/orchestrator && bun test src/__tests__/recovery-flow.test.ts
# Expected: TypeError: orchestrator.recoverExecution is not a function
```

- [ ] **Step 3: Add `recoverExecution` to OrchestratorService**

Add the following import at the top of `orchestrator-service.ts`:

```typescript
import type { MessageBus } from "@baara-next/executor";
```

Change the constructor signature to accept an optional `MessageBus`:

```typescript
constructor(
  private readonly store: IStore,
  private readonly runtimeRegistry?: RuntimeRegistry,
  private readonly messageBus?: MessageBus,
) {
  this.queueManager = new QueueManager(store);
  this.healthMonitor = new HealthMonitor(store, 10_000, (executionId) => {
    void this.recoverExecution(executionId);
  });
  this.scheduler = new Scheduler(store, this.queueManager);
}
```

Add the `recoverExecution` method after `retryExecution`:

```typescript
/**
 * Triggered by the HealthMonitor when a stale heartbeat is detected.
 *
 * Flow:
 *  1. Mark the crashed execution retry_scheduled.
 *  2. Load the latest checkpoint from MessageBus (if available).
 *  3. Create a new execution attempt.
 *  4. Enqueue it — the new execution will pick up the checkpoint when
 *     NativeSandboxInstance.execute() is called with checkpoint context.
 */
async recoverExecution(executionId: string): Promise<void> {
  const execution = this.store.getExecution(executionId);
  if (!execution) return; // Already gone.

  // Only recover executions that are still in a running/unresponsive state.
  if (execution.status !== "running" && execution.status !== "assigned") return;

  const task = this.store.getTask(execution.taskId);
  if (!task) return;

  const now = new Date().toISOString();

  // 1. Mark crashed execution as retry_scheduled.
  this.store.updateExecutionStatus(executionId, "retry_scheduled", {
    error: "Recovered from crash by health monitor",
    completedAt: now,
  });

  // 2. Load checkpoint (may be null if agent crashed before first checkpoint).
  const checkpoint = this.messageBus
    ? this.messageBus.readLatestCheckpoint(executionId)
    : null;

  // 3. Create new execution attempt.
  const newId = crypto.randomUUID();
  const nextAttempt = execution.attempt + 1;

  this.store.createExecution(
    newId,
    task.id,
    task.targetQueue,
    task.priority,
    now,
    nextAttempt
  );

  // 4. If we have a checkpoint, store it on the new execution via checkpoint_data
  //    so the sandbox can retrieve it when it starts.
  if (checkpoint) {
    this.store.updateExecutionFields(newId, {
      checkpointData: JSON.stringify(checkpoint),
    } as Record<string, unknown>);
  }

  this.store.updateExecutionStatus(newId, "queued");
  this.queueManager.enqueue(task.targetQueue, newId);

  emitExecutionCreated(this.store, newId, task.id, task.targetQueue, nextAttempt);
  emitExecutionQueued(this.store, newId, task.targetQueue);

  console.log(
    `[orchestrator] Recovered execution ${executionId} → new attempt ${newId} (attempt ${nextAttempt}, checkpoint: ${checkpoint ? "yes" : "no"})`
  );
}
```

- [ ] **Step 4: Run test** (expected: PASS)

```bash
cd packages/orchestrator && bun test src/__tests__/recovery-flow.test.ts
# Expected: 4 tests pass
```

---

### Task 6: Export MessageBus from executor package barrel

**Files:**
- Modify: `packages/executor/src/index.ts`

Add exports so `@baara-next/executor` exposes the new modules:

```typescript
// Add to packages/executor/src/index.ts
export { MessageBus } from "./message-bus.ts";
export { CheckpointService } from "./checkpoint-service.ts";
export { buildRecoveryPrompt, prepareRecoveryParams } from "./recovery.ts";
export type { Checkpoint, ConversationMessage, InboundCommand } from "./message-bus.ts";
export type { SandboxExecuteParams, AgentConfig as SandboxAgentConfig } from "./recovery.ts";
export type { CheckpointServiceConfig } from "./checkpoint-service.ts";
```

- [ ] **Verify: Run all executor tests**

```bash
cd packages/executor && bun test
# Expected: all tests pass
```

---

### Task 7: Wire MessageBus into start.ts

**Files:**
- Modify: `packages/cli/src/commands/start.ts`

After `createStore()` and before creating the orchestrator, construct the `MessageBus`:

```typescript
import { MessageBus } from "@baara-next/executor";

// After: const store = createStore(dbPath);
// The MessageBus needs the raw SQLite database handle.
// createStore() returns an IStore — add a .db getter in Plan E's migration step.
// For now, cast through unknown to access the underlying db property.
const rawDb = (store as unknown as { db: import("bun:sqlite").Database }).db;
const messageBus = new MessageBus(rawDb);
```

Change the `OrchestratorService` constructor call to pass `messageBus`:

```typescript
// Replace:
const orchestrator = new OrchestratorService(store, registry);
// With:
const orchestrator = new OrchestratorService(store, registry, messageBus);
```

---

### Verification Checklist

- [ ] `bun test packages/executor` — all checkpoint-related tests pass
- [ ] `bun test packages/orchestrator` — health monitor recovery tests pass
- [ ] `bun start` — server starts without error
- [ ] Create a task, run it, kill the process mid-execution
- [ ] Restart, confirm a new execution attempt appears in the queue with `checkpointData` populated
- [ ] Confirm `healthStatus` transitions: healthy → slow → unresponsive → recovery triggered

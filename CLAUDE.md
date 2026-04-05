# BAARA Next — Developer Reference

**BAARA** means "work" in Mandinka. This is the durable agentic task execution engine.
Repo: https://github.com/fakoli/baara-next

---

## Quick Commands

```sh
bun start                    # Start server in dev mode (orchestrator + agent + HTTP + web)
bun test:smoke               # Run smoke tests
turbo typecheck              # Type-check all 10 packages
turbo build                  # Build all packages
turbo dev                    # Watch mode (all packages)
```

CLI commands (after `bun start` or `baara` binary is in PATH):

```sh
baara start                  # Start server
baara tasks list             # List tasks
baara tasks create           # Create task interactively
baara tasks run <name>       # Run a task directly (skips queue)
baara executions list        # List all executions
baara executions logs <id>   # Tail JSONL execution logs
baara queues list            # Queue depths
baara admin dlq              # Inspect dead-letter queue
baara chat                   # Interactive chat REPL
baara mcp-server             # Stdio MCP server (for Claude Code .mcp.json)
```

---

## Architecture Overview

Three cooperating services run in a single process in dev mode (`bun start`):

| Service | Responsibility |
|---------|----------------|
| OrchestratorService | Receives tasks, manages queues, retry scheduler, health monitor, DLQ |
| AgentService | Polls for assigned executions, drives the sandbox execution loop |
| SandboxRegistry | Pluggable isolation layers (Native, Wasm, Docker) wrapping the Claude Code SDK |

**Sandbox model:** All three sandbox implementations share one interface (`ISandbox`) and one
execution engine (Claude Code SDK `query()`). What varies between sandboxes is the isolation
layer wrapping the SDK call.

```
SandboxRegistry (Map<SandboxType, ISandbox>)
  ├── NativeSandbox  — direct SDK call in host process; always available
  ├── WasmSandbox    — Extism plugin wraps SDK; memory/CPU limits enforced
  └── DockerSandbox  — container isolation; isAvailable() always false (stub)
```

**Component wiring** (packages/cli/src/commands/start.ts):

```
createStore(dbPath)
  → createDefaultSandboxRegistry({ dataDir })
  → new MessageBus(store, dataDir)
  → new OrchestratorService(store, legacyRegistry, messageBus, sandboxRegistry)
  → createTransport({ mode: "dev", orchestrator })
  → new AgentService(transport, legacyRegistry.getAll())
  → createServer({ orchestrator, store, devTransport, apiKey, dataDir, logsDir }, port, hostname)
```

---

## Monorepo Packages (10 total)

| Package | Path | Scope |
|---------|------|-------|
| `@baara-next/core` | `packages/core` | Shared types, interfaces (IStore, ISandbox, IMessageBus), state machine, errors |
| `@baara-next/store` | `packages/store` | SQLite persistence via `bun:sqlite`. Implements IStore. |
| `@baara-next/orchestrator` | `packages/orchestrator` | OrchestratorService + TaskManager. Queue management, retry, health, DLQ. |
| `@baara-next/agent` | `packages/agent` | AgentService. Execution polling loop. |
| `@baara-next/executor` | `packages/executor` | SandboxRegistry, NativeSandbox, WasmSandbox, DockerSandbox, CheckpointService, MessageBus, JSONL log reader |
| `@baara-next/transport` | `packages/transport` | DevTransport (in-process) and HttpTransport (production). Bridges agent to orchestrator. |
| `@baara-next/server` | `packages/server` | HTTP API (Hono). Route groups: tasks, executions, queues, chat, system, internal, MCP. |
| `@baara-next/mcp` | `packages/mcp` | 27-tool MCP server. Stdio transport (Claude Code), HTTP (/mcp), in-process (chat). |
| `@baara-next/cli` | `packages/cli` | Command-line interface (Commander.js). Commands: start, tasks, executions, queues, admin, chat, mcp-server. |
| `@baara-next/web` | `packages/web` | Frontend (React 18 + Vite + Tailwind CSS). |

---

## Key Types

All types live in `packages/core/src/types.ts`.

### Well-known IDs

```typescript
export const MAIN_THREAD_ID = "00000000-0000-0000-0000-000000000000" as const;
```

The Main thread always exists (seeded by migration 5). Task output routes here when
`targetThreadId` is null.

### SandboxType

```typescript
type SandboxType = "native" | "wasm" | "docker";
```

Do NOT use the deprecated `ExecutionType` for new code.

### SandboxConfig (discriminated union)

```typescript
type SandboxConfig =
  | { type: "native" }
  | { type: "wasm"; networkEnabled?: boolean; maxMemoryMb?: number; maxCpuPercent?: number; ports?: number[] }
  | { type: "docker"; image?: string; networkEnabled?: boolean; ports?: number[]; volumeMounts?: string[] };
```

### ExecutionMode

```typescript
type ExecutionMode = "direct" | "queued";
```

`direct` bypasses the queue and executes immediately. `queued` enqueues for an agent worker.

### ExecutionStatus (11 states)

```typescript
type ExecutionStatus =
  | "created" | "queued" | "assigned" | "running" | "waiting_for_input"
  | "completed" | "failed" | "timed_out" | "cancelled" | "retry_scheduled"
  | "dead_lettered";
```

Terminal states: `completed`, `cancelled`, `dead_lettered`.

### Priority

```typescript
type Priority = 0 | 1 | 2 | 3;  // 0 = critical, 3 = low
```

### AgentConfig

```typescript
interface AgentConfig {
  model?: string;              // Default: "claude-sonnet-4-20250514"
  allowedTools?: string[];
  maxTurns?: number;
  budgetUsd?: number;
  permissionMode?: string;     // Default: "default"
  systemPrompt?: string;
  mcpServers?: Record<string, McpServerConfig>;
}
```

### Task

Tasks are templates — they have no runtime state. All runtime state lives on `Execution`.

```typescript
interface Task {
  id: string;
  name: string;
  description: string;
  prompt: string;
  cronExpression?: string;
  timeoutMs: number;
  sandboxType?: SandboxType;
  sandboxConfig?: SandboxConfig;
  agentConfig: AgentConfig | null;
  priority: Priority;
  targetQueue: string;
  maxRetries: number;
  executionMode: ExecutionMode;
  enabled: boolean;
  projectId?: string | null;
  targetThreadId?: string | null;  // null → routes to MAIN_THREAD_ID
  createdAt: string;
  updatedAt: string;
}
```

### Execution

One attempt to run a Task.

```typescript
interface Execution {
  id: string;
  taskId: string;
  queueName: string;
  priority: Priority;
  status: ExecutionStatus;
  attempt: number;             // starts at 1
  scheduledAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  durationMs?: number | null;
  output?: string | null;
  error?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  healthStatus: HealthStatus;
  turnCount: number;
  checkpointData?: string | null;  // JSON-serialised Checkpoint
  threadId?: string | null;
  createdAt: string;
}
```

### Checkpoint

Conversation-level snapshot for crash recovery.

```typescript
interface Checkpoint {
  id: string;
  executionId: string;
  turnCount: number;
  conversationHistory: ConversationMessage[];
  pendingToolCalls: string[];
  agentState: Record<string, unknown>;
  timestamp: string;
}
```

Written to `task_messages` table every 5 turns (configurable). Recovery is O(1) —
loads a single row.

### Thread

```typescript
interface Thread {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}
```

### ThreadMessage

```typescript
interface ThreadMessage {
  id: string;
  threadId: string;
  role: "user" | "agent";
  content: string;
  toolCalls: string;   // JSON string, array of { name, input, output }
  createdAt: string;
}
```

### SandboxEvent (event stream from a running sandbox)

```typescript
type SandboxEvent =
  | { type: "log"; level: "info" | "warn" | "error" | "debug"; message: string; timestamp: string }
  | { type: "text_delta"; delta: string }
  | { type: "tool_use"; name: string; input: unknown }
  | { type: "tool_result"; name: string; output: unknown; isError: boolean }
  | { type: "hitl_request"; prompt: string; options?: string[] }
  | { type: "checkpoint"; checkpoint: Checkpoint }
  | { type: "turn_complete"; turnCount: number; inputTokens: number; outputTokens: number };
```

### InboundCommand (commands to a running execution)

```typescript
type InboundCommand =
  | { type: "command"; prompt: string }
  | { type: "hitl_response"; response: string }
  | { type: "pause" }
  | { type: "resume" };
```

---

## Key Interfaces

All interfaces live in `packages/core/src/interfaces/`.

### ISandbox

```typescript
interface ISandbox {
  readonly name: SandboxType;
  readonly description: string;
  start(config: SandboxStartConfig): Promise<SandboxInstance>;
  stop(instance: SandboxInstance): Promise<void>;
  isAvailable(): Promise<boolean>;
}

interface SandboxInstance {
  readonly id: string;
  readonly sandboxType: SandboxType;
  execute(params: SandboxExecuteParams): Promise<SandboxExecuteResult>;
  sendCommand(command: InboundCommand): Promise<void>;
  readonly events: AsyncIterable<SandboxEvent>;
  cancel(): Promise<void>;
}
```

### IMessageBus

Durable command channel backed by the `task_messages` SQLite table.

```typescript
interface IMessageBus {
  sendCommand(executionId: string, command: InboundCommand): void;
  readPendingCommands(executionId: string): PendingCommand[];
  acknowledgeCommands(messageIds: string[]): void;
  writeCheckpoint(executionId: string, checkpoint: Checkpoint): void;
  readLatestCheckpoint(executionId: string): Checkpoint | null;
  appendLog(executionId: string, level: string, message: string): void;
}
```

### IStore

Single source of truth for all persisted state. Synchronous reads (`bun:sqlite` is sync),
void writes. No SQL outside the store package.

Key method groups:

| Group | Key methods |
|-------|-------------|
| Tasks | `createTask`, `getTask`, `getTaskByName`, `updateTask`, `deleteTask`, `listTasks` |
| Executions | `createExecution`, `getExecution`, `updateExecutionStatus`, `updateExecutionFields`, `dequeueExecution`, `listAllExecutions` |
| Events | `appendEvent`, `listEvents`, `getMaxEventSeq` |
| Input Requests | `createInputRequest`, `getInputRequest`, `respondToInput` |
| Threads | `createThread`, `getThread`, `listThreads`, `linkExecutionToThread`, `listExecutionsByThread` |
| Thread Messages | `appendThreadMessage`, `listThreadMessages` |
| Task Messages | `sendMessage`, `readMessages`, `acknowledgeMessages`, `readLatestMessage` |
| Settings | `getSetting`, `setSetting` |
| Queues | `listQueues`, `getQueueInfo`, `updateQueueConcurrency` |

---

## State Machine

Valid transitions enforced by `validateTransition()` in `packages/core/src/state-machine.ts`.
Every call to `store.updateExecutionStatus()` passes through this check.

```
created           → queued, cancelled
queued            → assigned, cancelled, timed_out
assigned          → running, timed_out
running           → completed, failed, timed_out, cancelled, waiting_for_input
waiting_for_input → running, cancelled
failed            → retry_scheduled, dead_lettered
timed_out         → retry_scheduled, dead_lettered
retry_scheduled   → queued, cancelled
```

Terminal states have no outgoing transitions: `completed`, `cancelled`, `dead_lettered`.

---

## Database Schema

SQLite at `{dataDir}/baara.db` (default: `~/.baara/baara.db`). Schema version tracked in
`settings` table under key `schema_version`. Five migrations in `packages/store/src/migrations.ts`.

### Migration 1 — Initial schema (9 tables)

| Table | Purpose |
|-------|---------|
| `tasks` | Task definitions (templates). Columns: id, name, description, prompt, cron_expression, timeout_ms, execution_type (deprecated), agent_config, priority, target_queue, max_retries, execution_mode, enabled, project_id |
| `executions` | One attempt per task. Columns: id, task_id, queue_name, priority, status, attempt, scheduled_at, started_at, completed_at, duration_ms, output, error, input_tokens, output_tokens, health_status, turn_count, checkpoint_data |
| `events` | Append-only execution event log. Columns: id, execution_id, event_seq, type, payload, timestamp |
| `input_requests` | HITL pauses. Columns: id, execution_id, prompt, options, context, response, status, timeout_ms, responded_at |
| `templates` | Reusable AgentConfig presets. Columns: id, name, description, agent_config |
| `queues` | Queue capacity metadata. Seeded: transfer(10), timer(5), visibility(5), dlq(1) |
| `projects` | Task groupings with working directory. Columns: id, name, description, instructions, working_directory |
| `settings` | Key-value operator config. Columns: key, value, updated_at |

### Migration 2 — Threads

Adds `threads` table (id, title, created_at, updated_at) and `thread_id` FK on `executions`.

### Migration 3 — task_messages + sandbox_type

Rebuilds `tasks` table: renames `execution_type` to `sandbox_type` (DEFAULT 'native'), adds
`sandbox_config` column (DEFAULT '{"type":"native"}'). Old values mapped: cloud_code/shell → native,
wasm/wasm_edge → wasm.

Adds `task_messages` table: durable inbound command queue and outbound checkpoint store.
Columns: id, execution_id, direction (inbound|outbound), message_type, payload,
status (pending|delivered|acknowledged).

### Migration 4 — thread_messages

Adds `thread_messages` table for chat history replay.
Columns: id, thread_id, role (user|agent), content, tool_calls (JSON string), created_at.

### Migration 5 — Main thread + target_thread_id

Seeds the Main thread with well-known ID `00000000-0000-0000-0000-000000000000`.
Adds `target_thread_id` column to `tasks` (FK → threads, ON DELETE SET NULL).

---

## MCP Tools (27 total)

All tools live in `packages/mcp/`. They are mounted in three modes: in-process for chat
(via `createAllTools`), stdio for Claude Code, and HTTP at `/mcp`.

| Group | Tools |
|-------|-------|
| Tasks (6) | `list_tasks`, `get_task`, `create_task`, `update_task`, `delete_task`, `toggle_task` |
| Executions (9) | `run_task`, `submit_task`, `list_executions`, `get_execution`, `get_execution_events`, `cancel_execution`, `retry_execution`, `get_system_status`, `get_execution_logs` |
| Queues (4) | `list_queues`, `get_queue_info`, `dlq_list`, `dlq_retry` |
| HITL (2) | `list_pending_input`, `provide_input` |
| Templates (2) | `list_templates`, `create_task_from_template` |
| Projects (2) | `list_projects`, `set_active_project` |
| Claude Code (2) | `discover_plugins`, `run_skill` |

Shell tasks route through `ShellRuntime`, not the Claude Code SDK. Do not wire shell tasks
through the sandbox path.

---

## Chat System

### SSE Streaming Protocol

`POST /api/chat` accepts JSON and returns `Content-Type: text/event-stream`.

**Request body:**

```typescript
{
  message: string;
  sessionId?: string;         // Omit for first turn; resume from second turn
  threadId?: string;          // Omit for first turn; include to continue a thread
  activeProjectId?: string | null;
  permissionMode?: "auto" | "ask" | "locked";   // Default: "auto"
  model?: string;             // Default: "claude-sonnet-4-20250514"
  systemInstructions?: string; // Max 4000 chars; prepended to system prompt
}
```

**SSE event sequence:**

```
event: message  data: {"type":"system","sessionId":"...","threadId":"...","toolCount":27}
event: message  data: {"type":"text_delta","delta":"I'll create"}
event: message  data: {"type":"text","content":"I'll create a task for you."}
event: message  data: {"type":"tool_use","name":"create_task","input":{...}}
event: message  data: {"type":"tool_result","name":"create_task","output":{...},"isError":false}
event: message  data: {"type":"permission_request","requestId":"...","toolName":"...","toolInput":{...}}
event: message  data: {"type":"result","text":"Done!","isError":false,"usage":{...},"cost":0.002,"durationMs":4200}
event: message  data: {"type":"error","message":"Stream failed"}
event: done     data: {"type":"done"}
```

The `system` event is always first. Persist `sessionId` and `threadId` from it and send
them back on every subsequent turn in the same conversation.

### Permission Modes

| Mode | Behavior |
|------|----------|
| `auto` | All tools execute immediately without confirmation |
| `ask` | Each tool emits a `permission_request` SSE event and blocks until POST /api/chat/permission resolves it |
| `locked` | Only pre-approved tools run; all others return a deny error immediately |

**Resolving a permission request:**

```
POST /api/chat/permission
Body: { requestId: string; sessionId: string; decision: "allow" | "allow_task" | "deny" }
```

- `allow` — run this one invocation
- `allow_task` — run this tool for the rest of the task without further prompts
- `deny` — return an error to the agent

Session ownership is verified: if `sessionId` does not match the pending request's session,
the server returns 403.

Pending permissions time out after 5 minutes. Client disconnect also cancels them (via
`AbortController`).

### System Instructions

The `systemInstructions` field is prepended to the base system prompt wrapped in XML tags:

```xml
<user_instructions>
{sanitized instructions — < and > escaped}
</user_instructions>

{base system prompt}
```

Maximum length: 4000 characters.

### Inline Cards

The UI renders certain tool results as inline cards rather than raw JSON:

| Tool | Card type |
|------|-----------|
| `create_task` | Task card (name, sandbox type, mode) |
| `run_task` | Execution card (ID, status, duration) |
| `submit_task` | Execution card (ID, queued status) |
| `get_execution` | Execution detail card |
| `get_system_status` | System status card (queue depths, running count) |
| `list_executions` | Execution table |
| `dlq_list` | DLQ card |
| `list_pending_input` | HITL card with action button |

All other tool results render as collapsible JSON blocks.

### Thread and Session Continuity

- A **thread** is a row in the `threads` table — the persistent container for a conversation.
- A **session** is the Claude Code SDK session file at `{dataDir}/sessions/{sessionId}.json`.
- On first turn: server creates a new thread (title = first 60 chars of message), sends `system` event with both IDs.
- On subsequent turns: client sends `sessionId` and `threadId` back; SDK resumes via `options.resume = sessionId`.
- Executions run from a chat thread are linked to that thread via `store.linkExecutionToThread`.

---

## Web UI

Three-zone layout defined in `packages/web/src/App.tsx`:

```
┌──────────────────────────────────────────────────────────┐
│  Header (44px — model selector, permission mode, cost)   │
├─────────────┬───────────────────────────┬────────────────┤
│ ThreadList  │      ChatWindow           │  ControlPanel  │
│ (collapsible│  (primary chat + input)   │ (collapsible   │
│  sidebar)   │                           │  tabbed panel) │
└─────────────┴───────────────────────────┴────────────────┘
```

Both the left sidebar and right panel are independently collapsible. Expand buttons appear
when a panel is collapsed.

### Key Components

| Component | File | Purpose |
|-----------|------|---------|
| `App` | `App.tsx` | Three-zone layout, collapse state |
| `Header` | `components/Header.tsx` | Model selector, permission mode toggle, session cost |
| `ThreadList` | `components/ThreadList.tsx` | Collapsible sidebar — thread navigator |
| `ChatWindow` | `components/ChatWindow.tsx` | Message list, input bar, streaming |
| `ChatInput` | `components/ChatInput.tsx` | Textarea, submit, abort |
| `ChatMessage` | `components/ChatMessage.tsx` | Renders user/agent turns with tool calls |
| `InlineCard` | `components/InlineCard.tsx` | Inline execution/task cards from tool results |
| `ControlPanel` | `components/ControlPanel.tsx` | Collapsible right panel — tasks, executions, queues tabs |
| `TaskEditor` | `components/TaskEditor.tsx` | Create/edit task form |
| `ExecutionDetail` | `components/ExecutionDetail.tsx` | Execution status, events, logs |
| `ToolIndicator` | `components/ToolIndicator.tsx` | Spinner shown during tool calls |

### Zustand Stores

| Store | File | State |
|-------|------|-------|
| `useChatStore` | `stores/chat-store.ts` | messages, sessionId, threadId, streaming, permissionMode, model, systemInstructions, pendingPermission, sessionCostUsd, toolCallCount |
| `useThreadStore` | `stores/thread-store.ts` | threads list, active thread |

`useChatStore.sendMessage` handles the full SSE loop: opens the stream, dispatches on
event type, accumulates text deltas, and surfaces `pendingPermission` when a
`permission_request` event arrives.

---

## Security Model

| Layer | Mechanism |
|-------|-----------|
| API key auth on `/api/*` | `X-Api-Key` or `Authorization: Bearer` header; controlled by `BAARA_API_KEY` env var |
| API key auth on `/mcp/*` | Same header; optional — if not set, MCP is open |
| `/internal/*` fail-closed | If `BAARA_API_KEY` is not set, all `/internal/*` requests return 503; prevents unauthenticated agent transport access |
| Rate limiting | 10 requests/minute per IP on mutation endpoints; 300/minute on `/mcp/*` |
| CORS | Exact-origin allowlist; defaults to localhost:3000 only |
| Security headers | CSP, X-Content-Type-Options: nosniff, X-Frame-Options: DENY on all responses |
| systemInstructions sanitization | `<` and `>` escaped before wrapping in `<user_instructions>` tags |

---

## Task Output Routing

When an execution completes (any terminal status), `OrchestratorService.handleExecutionComplete`
routes output to a thread:

1. Read `task.targetThreadId`. If null, use `MAIN_THREAD_ID`.
2. Look up the thread in the store. If the custom thread was deleted, fall back to Main.
3. Call `store.linkExecutionToThread(executionId, routeThread.id)`.
4. Append a human-readable summary message to `thread_messages` (role: "agent").
   - Completed: `Task "{name}" completed in {N}s.\nOutput: {first 500 chars}`
   - Other terminal: `Task "{name}" {status} after {N}s (attempt X/Y).\nError: {first 300 chars}`

Output routing is best-effort: errors are logged but never mask the primary completion handling.

---

## Durability (Checkpoint Model)

Checkpoint-based, not replay-based. LLM agents are non-deterministic — replay is impossible.

**Write path:** `CheckpointService` runs inside `SandboxInstance`. After each completed turn it
calls `onTurnComplete(n)`. A checkpoint is written when `n % intervalTurns === 0` (default: every
5 turns). Checkpoints are also written unconditionally on HITL pause and clean completion.

**Read path (recovery):**
1. Health monitor detects execution stuck in "running" with no heartbeat → calls `orchestrator.recoverExecution(executionId)`.
2. Load latest checkpoint: `messageBus.readLatestCheckpoint(executionId)` — single `SELECT ... ORDER BY created_at DESC LIMIT 1`, O(1).
3. Create new execution attempt. Store checkpoint JSON on `checkpointData` field.
4. New execution is picked up by agent service. Sandbox receives checkpoint in `SandboxExecuteParams`.
5. Agent receives recovery system prompt: "RECOVERY CONTEXT: This is a resumed execution. You completed N turns..."

If `nextAttempt > task.maxRetries + 1`, the execution is dead-lettered instead of retried.

**What is NOT recovered:** In-flight tool results after the last checkpoint. The agent must
handle idempotency for work done between last checkpoint and crash.

---

## CLI Commands (Full Reference)

| Command | Description |
|---------|-------------|
| `baara start [--port 3000] [--data-dir ~/.baara] [--hostname 0.0.0.0]` | Start server |
| `baara tasks list` | List all tasks |
| `baara tasks create --name <n> --prompt <p>` | Create a task |
| `baara tasks run <name>` | Run a task directly |
| `baara tasks show <id>` | Show task details |
| `baara executions list` | List recent executions |
| `baara executions logs <id>` | Tail JSONL logs |
| `baara queues list` | Queue depths |
| `baara admin dlq` | Inspect dead-letter queue |
| `baara chat` | Interactive chat REPL |
| `baara mcp-server` | Stdio MCP server for Claude Code |

---

## Development Workflow

### Branch and PR rules

- `main` is locked. All changes go through feature branches and pull requests.
- Never commit directly to `main`.
- Branch naming: `feature/<short-description>` or `fix/<short-description>`.

### Critic rule

After every code write, run the fakoli-crew critic:

```sh
/fakoli-crew:critic
```

This is a hard requirement, not a suggestion.

### Typecheck before commit

```sh
turbo typecheck
```

Never rely on IDE diagnostics — they are often stale. Run the real typecheck.

### Testing

```sh
bun test:smoke    # Smoke tests (integration-level; requires a running server or test fixtures)
turbo typecheck   # Full type-check across all 10 packages
```

---

## Key Conventions and Pitfalls

### TypeScript / Build

- **Strict mode** everywhere. No `any` — use `unknown` and narrow with type guards.
- **`noEmit: true`** in tsconfig. There is no `outDir`. Do not add one.
- **`moduleResolution: bundler`** — Bun import semantics. Use `.ts` extensions in imports.
- **Path aliases** are defined in `tsconfig.base.json` at the root. Each package extends it.
- Diagnostics in editors are often stale. Always run `turbo typecheck` to verify.

### Database

- `bun:sqlite` is synchronous. All `IStore` reads are sync. Do not wrap them in `await`.
- All SQL lives in `packages/store/`. Never issue raw SQL outside the store package.
- No ORM. No Prisma. Plain SQL with `bun:sqlite`.
- Schema migrations run automatically at server start via `runMigrations(db)`.
- The `schema_version` key in the `settings` table tracks applied migrations.

### Routing

- `targetThreadId: null` on a task means route output to `MAIN_THREAD_ID` (migration 5).
- Custom `targetThreadId` values are followed if the thread exists; otherwise fall back to Main.
- Execution output is appended as a `thread_messages` row (role: "agent") after completion.

### Sandboxes

- `SandboxType` is the current standard. `ExecutionType` is deprecated — kept only for
  backward compatibility during migration. Do not use `ExecutionType` in new code.
- `DockerSandbox.isAvailable()` always returns `false`. Do not wire Docker tasks in tests.
- Shell tasks route through `ShellRuntime`, not the SDK sandbox path.

### Transport

- `DevTransport` is in-process. It is the default for `bun start --mode dev`.
- `HttpTransport` is for production multi-process mode (not yet fully implemented).
- Agent-to-orchestrator calls all go through the transport interface — never call
  `OrchestratorService` directly from `AgentService`.

### Bun workspace resolution

Bun's workspace resolution differs from npm. If a package import fails at runtime, verify
the package is listed in `workspaces` in the root `package.json` and that the import path
matches the package `name` field exactly.

### SSE idleTimeout

`Bun.serve` is configured with `idleTimeout: 120` seconds for long-running SDK calls and
SSE streams. Do not lower this value.

---

## File Index (docs/)

| File | Topic |
|------|-------|
| `docs/architecture.md` | 10-package overview, component diagram, data flow, event sourcing model |
| `docs/sandbox-guide.md` | ISandbox interface, NativeSandbox/WasmSandbox/DockerSandbox, adding a new sandbox |
| `docs/mcp-integration.md` | Full 27-tool MCP reference, Claude Code `.mcp.json` setup |
| `docs/api-reference.md` | Every REST endpoint with request/response examples |
| `docs/chat-architecture.md` | SSE protocol, event types, thread model, session continuity |
| `docs/durability.md` | Checkpoint model, recovery flow, Temporal comparison table |
| `docs/configuration.md` | All environment variables and CLI flags |
| `docs/contributing.md` | Dev setup, running tests, PR guidelines |

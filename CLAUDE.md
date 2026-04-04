# BAARA Next

"baara" means "work" in Mandinka.

## Runtime and Language

100% TypeScript on Bun runtime. No Go, no Rust, no native addons.

---

## Architecture (Phases 2-5)

Three cooperating services:

| Service | Responsibility |
|---------|----------------|
| OrchestratorService | Receives tasks, manages queues, retry scheduler, health monitor, DLQ |
| AgentService | Polls for assigned executions, drives the sandbox execution loop |
| SandboxRegistry | Pluggable isolation layers (Native, Wasm, Docker) wrapping the Claude Code SDK |

---

## Monorepo Packages (10 total)

| Package | Scope |
|---------|-------|
| `core` | Shared types, interfaces (IStore, ISandbox, IMessageBus), state machine, errors |
| `store` | Persistence layer (SQLite via bun:sqlite). Implements IStore. |
| `orchestrator` | OrchestratorService + TaskManager. Queue management, retry, health, DLQ. |
| `agent` | AgentService. Execution polling loop. |
| `executor` | SandboxRegistry, NativeSandbox, WasmSandbox, DockerSandbox, CheckpointService, MessageBus, JSONL log reader |
| `transport` | DevTransport (in-process) and HttpTransport (production). Bridges agent ↔ orchestrator. |
| `server` | HTTP API (Hono). All route groups: tasks, executions, queues, chat, system, internal, MCP. |
| `mcp` | 27-tool MCP server. Stdio transport (for Claude Code), HTTP transport (/mcp), in-process (chat). |
| `cli` | Command-line interface (Commander). Commands: start, tasks, executions, queues, admin, chat, mcp-server. |
| `web` | Frontend UI (React 18 + Vite + Tailwind CSS). |

---

## Key Types

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

### ExecutionStatus (11 states)

```typescript
type ExecutionStatus =
  | "created" | "queued" | "assigned" | "running" | "waiting_for_input"
  | "completed" | "failed" | "timed_out" | "cancelled" | "retry_scheduled"
  | "dead_lettered";
```

Terminal states: `completed`, `cancelled`, `dead_lettered`.

### Task

Tasks are templates — they have no runtime state. All runtime state lives on
`Execution`. Key fields: `sandboxType`, `sandboxConfig`, `agentConfig`,
`maxRetries`, `executionMode`, `cronExpression`.

### Execution

One attempt to run a Task. Fields: `status`, `attempt`, `turnCount`,
`healthStatus`, `checkpointData`, `threadId`.

### Checkpoint

Conversation-level snapshot for crash recovery. Fields: `conversationHistory`,
`pendingToolCalls`, `turnCount`. Written to `task_messages` table every 5 turns.

---

## Key Interfaces

### ISandbox (`packages/core/src/interfaces/sandbox.ts`)

```typescript
interface ISandbox {
  readonly name: SandboxType;
  start(config: SandboxStartConfig): Promise<SandboxInstance>;
  stop(instance: SandboxInstance): Promise<void>;
  isAvailable(): Promise<boolean>;
}

interface SandboxInstance {
  execute(params: SandboxExecuteParams): Promise<SandboxExecuteResult>;
  sendCommand(command: InboundCommand): Promise<void>;
  readonly events: AsyncIterable<SandboxEvent>;
  cancel(): Promise<void>;
}
```

### IMessageBus (`packages/core/src/interfaces/message-bus.ts`)

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

### IStore (`packages/core/src/interfaces/store.ts`)

Single source of truth for all persisted state. Synchronous reads (bun:sqlite),
void writes. Do not issue SQL outside the store package.

Key methods: `createTask`, `getTask`, `createExecution`, `updateExecutionStatus`,
`dequeueExecution`, `appendEvent`, `createInputRequest`, `sendMessage`,
`writeCheckpoint`-adjacent methods (`readLatestMessage`).

---

## MCP Tools (27 total)

| Group | Count | Tools |
|-------|-------|-------|
| Tasks | 6 | `list_tasks`, `get_task`, `create_task`, `update_task`, `delete_task`, `toggle_task` |
| Executions | 9 | `run_task`, `submit_task`, `list_executions`, `get_execution`, `get_execution_events`, `cancel_execution`, `retry_execution`, `get_system_status`, `get_execution_logs` |
| Queues | 4 | `list_queues`, `get_queue_info`, `dlq_list`, `dlq_retry` |
| HITL | 2 | `list_pending_input`, `provide_input` |
| Templates | 2 | `list_templates`, `create_task_from_template` |
| Projects | 2 | `list_projects`, `set_active_project` |
| Claude Code | 2 | `discover_plugins`, `run_skill` |

---

## State Machine

Valid transitions enforced by `validateTransition()` in `packages/core/src/state-machine.ts`:

```
created         → queued, cancelled
queued          → assigned, cancelled, timed_out
assigned        → running, timed_out
running         → completed, failed, timed_out, cancelled, waiting_for_input
waiting_for_input → running, cancelled
failed          → retry_scheduled, dead_lettered
timed_out       → retry_scheduled, dead_lettered
retry_scheduled → queued, cancelled
```

---

## Sandbox Architecture

Single execution engine: Claude Code SDK `query()`. What varies is the
isolation layer.

```
SandboxRegistry (Map<SandboxType, ISandbox>)
  ├── NativeSandbox — direct SDK call, no isolation, always available
  ├── WasmSandbox   — Extism plugin wraps SDK, memory/CPU limits
  └── DockerSandbox — stub, isAvailable() always false
```

Create the registry with:

```typescript
const registry = await createDefaultSandboxRegistry({ dataDir });
```

---

## Durability

Checkpoint-based, not replay-based. The agent's conversation history is
snapshotted every 5 turns via `CheckpointService`. On crash:
1. Load latest checkpoint from `task_messages`
2. Build recovery system prompt with `buildRecoveryPrompt(checkpoint)`
3. Create new execution, inject checkpoint as conversation history
4. Agent resumes from turn N+1

Recovery is O(1) — loads single row. No replay required.

---

## Commands

```sh
bun start                    # Start server in dev mode (orchestrator + agent + HTTP)
turbo build                  # Build all packages
turbo typecheck              # Type-check all packages
turbo dev                    # Watch mode
bun test:smoke               # Run smoke tests
```

## CLI Commands

```sh
baara start                  # Start server
baara tasks list             # List tasks
baara tasks create           # Create task
baara tasks run <name>       # Run task directly
baara executions list        # List executions
baara executions logs <id>   # Tail JSONL logs
baara queues list            # Queue depths
baara admin dlq              # Dead-letter queue
baara chat                   # Interactive chat REPL
baara mcp-server             # Stdio MCP server (for Claude Code .mcp.json)
```

---

## Key Conventions

- **TypeScript:** strict mode; `tsconfig.base.json` is the shared base config.
- **Database:** SQLite only, `bun:sqlite`. No ORM. All SQL in `packages/store/`.
- **HTTP:** Hono for all HTTP. No Express.
- **CLI:** Commander for all CLI.
- **Modules:** `moduleResolution: bundler` — Bun import semantics.
- **Package layout:** each package under `packages/` extends `../../tsconfig.base.json`.
- **No `any`:** use `unknown` and narrow with type guards.
- **Interfaces in core:** `ISandbox`, `IStore`, `IMessageBus` defined in `packages/core/src/interfaces/`.
- **SandboxType not ExecutionType:** `ExecutionType` is deprecated; use `SandboxType` for new code.

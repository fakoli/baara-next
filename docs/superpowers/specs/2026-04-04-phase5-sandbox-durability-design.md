# Phase 5 Design Spec: Pluggable Sandbox Architecture, Durable Communication & Checkpointing

## Context

BAARA Next Phases 1-4 built a working durable task execution engine with a chat-centric web UI, 27-tool MCP server, and CLI. The current executor has multiple runtime classes (`CloudCodeRuntime`, `ShellRuntime`, `WasmRuntime` stub) each implementing `IRuntime` independently.

Phase 5 replaces this multi-engine model with a **single execution engine** (Claude Code SDK) wrapped by **pluggable sandbox environments** (containerd-style). It adds **durable communication** (hybrid WebSocket + SQLite queue), **conversation-level checkpointing** for crash recovery, and **JSONL logging** with real-time streaming.

### Key Architectural Shift

**Before:** Multiple engines selected by `executionType`. Each engine has its own `execute()`.
**After:** One engine (Claude Code SDK `query()`). What varies is the sandbox isolation layer.

### Durability Philosophy

Temporal is replay-based durability for deterministic code. BAARA Next is checkpoint-based durability for non-deterministic agents. LLM agents cannot satisfy Temporal's determinism constraint — replay-based recovery is impossible. Conversation-level checkpointing is the pragmatic alternative. Recovery is O(1) (load last checkpoint) not O(history) (replay). Tool calls are not memoized — idempotency is the agent's responsibility.

---

## Decisions Summary


| Decision         | Choice                                         | Rationale                                                    |
| ---------------- | ---------------------------------------------- | ------------------------------------------------------------ |
| Execution engine | Single: Claude Code SDK always                 | Shell tasks become agent with Bash tool only                 |
| Sandbox model    | Pluggable, containerd-style                    | Native, Wasm, Docker (stub) as interchangeable targets       |
| Task schema      | Discriminated `SandboxConfig` union            | Strongly-typed per-sandbox settings                          |
| Communication    | Hybrid WebSocket + SQLite queue                | WS for real-time streaming, SQLite for durable commands      |
| Durability       | Conversation-level checkpointing               | Resume with context injection, not deterministic replay      |
| Plugin registry  | Static (hardcoded), designed for dynamic later | Clean `ISandbox` interface, `Map<string, ISandbox>` registry |


---

## Sub-Spec A: Sandbox Type System + ISandbox Interface

### ISandbox Interface

```typescript
interface ISandbox {
  readonly name: string;  // "native" | "wasm" | "docker"
  readonly description: string;
  
  /**
   * Prepare a sandbox instance. Starts the Wasm machine, pulls the Docker image,
   * or no-ops for native. Returns a running SandboxInstance ready for execute().
   */
  start(config: SandboxStartConfig): Promise<SandboxInstance>;
  
  /**
   * Tear down a sandbox instance and release all resources.
   */
  stop(instance: SandboxInstance): Promise<void>;
  
  /**
   * Check if this sandbox type is available on the current system.
   * E.g., Docker sandbox returns false if Docker is not installed.
   */
  isAvailable(): Promise<boolean>;
}

interface SandboxStartConfig {
  executionId: string;
  sandboxConfig: SandboxConfig;
  agentConfig: AgentConfig;
  dataDir: string;
}

interface SandboxInstance {
  id: string;
  sandboxType: string;
  
  /** Execute the Claude Code SDK agent inside this sandbox. */
  execute(params: SandboxExecuteParams): Promise<ExecuteResult>;
  
  /** Send an inbound command to the running agent (HITL, additional prompt, pause/resume). */
  sendCommand(command: InboundCommand): Promise<void>;
  
  /** Real-time event stream from the sandbox (logs, text deltas, tool invocations). */
  events: AsyncIterable<SandboxEvent>;
  
  /** Cancel the running execution. */
  cancel(): Promise<void>;
}

interface SandboxExecuteParams {
  executionId: string;
  prompt: string;
  tools: string[];                    // allowed tool names
  agentConfig: AgentConfig;
  checkpoint?: Checkpoint;            // resume context if recovering
  environment?: Record<string, string>;
  timeout: number;
}
```

### SandboxConfig — Discriminated Union

```typescript
type SandboxType = "native" | "wasm" | "docker";

type SandboxConfig =
  | { type: "native" }
  | {
      type: "wasm";
      networkEnabled?: boolean;       // default: true (outbound to Claude permitted)
      maxMemoryMb?: number;           // default: 512
      maxCpuPercent?: number;         // default: 80
      ports?: number[];               // exposed ports, configurable at creation
    }
  | {
      type: "docker";
      image?: string;                 // default: "baara-next/sandbox:latest"
      networkEnabled?: boolean;
      ports?: number[];
      volumeMounts?: string[];
    };
```

### AgentConfig — Claude Code SDK Settings

```typescript
interface AgentConfig {
  model?: string;                     // default: "claude-sonnet-4-20250514"
  allowedTools?: string[];            // ["Bash", "Read", "Write", "Edit", ...]
  maxTurns?: number;                  // soft turn limit
  budgetUsd?: number;                 // spending cap
  permissionMode?: string;            // "default" | "acceptEdits" | "bypassPermissions"
  systemPrompt?: string;              // additional system prompt
  mcpServers?: Record<string, unknown>; // additional MCP servers
}
```

### Updated Task Type

```typescript
interface Task {
  id: string;
  name: string;
  description: string;
  prompt: string;
  sandboxType: SandboxType;           // replaces executionType
  sandboxConfig: SandboxConfig;       // per-sandbox isolation settings (JSON in SQLite)
  agentConfig: AgentConfig;           // Claude Code SDK settings (JSON in SQLite)
  priority: Priority;
  targetQueue: string;
  maxRetries: number;
  executionMode: ExecutionMode;
  enabled: boolean;
  projectId?: string | null;
  cronExpression?: string | null;
  timeoutMs: number;
  createdAt: string;
  updatedAt: string;
}
```

### Migration from Current Schema


| Old                           | New                                                            | Mapping                         |
| ----------------------------- | -------------------------------------------------------------- | ------------------------------- |
| `executionType: "cloud_code"` | `sandboxType: "native"`                                        | Direct                          |
| `executionType: "shell"`      | `sandboxType: "native"` + `agentConfig.allowedTools: ["Bash"]` | Shell becomes constrained agent |
| `executionType: "wasm"`       | `sandboxType: "wasm"`                                          | Direct                          |
| `executionType: "wasm_edge"`  | `sandboxType: "wasm"` + `sandboxConfig.gpuEnabled: true`       | Merged                          |
| `agentConfig` (mixed blob)    | Split into `sandboxConfig` + `agentConfig`                     | Separate concerns               |


### SandboxRegistry

```typescript
class SandboxRegistry {
  private sandboxes = new Map<string, ISandbox>();
  
  register(sandbox: ISandbox): void;
  get(name: string): ISandbox | undefined;
  getAvailable(): Promise<ISandbox[]>;  // filters by isAvailable()
  getForTask(task: Task): ISandbox;     // matches by task.sandboxType
}
```

Populated at startup with three hardcoded implementations:

- `NativeSandbox` — no-op wrapper, runs agent in host process
- `WasmSandbox` — Extism Wasm machine wrapper
- `DockerSandbox` — stub (returns `isAvailable: false`)

---

## Sub-Spec B: Communication Layer — Hybrid WebSocket + SQLite Queue

### Dual-Channel Architecture

Each running execution gets two channels:

**WebSocket (fast path):**

- Real-time streaming: log lines, text deltas, tool invocations, progress
- Feeds web UI chat window and JSONL log file simultaneously
- Ephemeral — not persisted beyond the current connection
- If socket drops, events buffer in SQLite queue until reconnection

**SQLite queue (durable path):**

- Inbound commands: HITL responses, pause/resume, additional prompts
- Outbound checkpoints: conversation state snapshots
- Survives crashes — sandbox reads pending commands on restart
- Each execution gets a dedicated partition in `task_messages` table

### task_messages Table

```sql
CREATE TABLE task_messages (
  id TEXT PRIMARY KEY,
  execution_id TEXT NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  message_type TEXT NOT NULL,
  payload TEXT NOT NULL,              -- JSON
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'acknowledged')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_task_messages_execution
  ON task_messages(execution_id, direction, status, created_at);
```

### Message Types


| Direction | Type            | Payload                                   | Purpose                                 |
| --------- | --------------- | ----------------------------------------- | --------------------------------------- |
| inbound   | `command`       | `{ prompt: "continue with..." }`          | Additional instruction to running agent |
| inbound   | `hitl_response` | `{ response: "approved" }`                | Human-in-the-loop answer                |
| inbound   | `pause`         | `{}`                                      | Pause execution                         |
| inbound   | `resume`        | `{}`                                      | Resume execution                        |
| outbound  | `checkpoint`    | `{ conversationHistory, turnCount, ... }` | Periodic state snapshot                 |
| outbound  | `log`           | `{ level, message, timestamp }`           | Structured log line                     |
| outbound  | `hitl_request`  | `{ prompt, options }`                     | Agent needs human input                 |
| outbound  | `event`         | `{ type, payload }`                       | Tool invocation, text delta, etc.       |


### InboundCommand Type

```typescript
type InboundCommand =
  | { type: "command"; prompt: string }
  | { type: "hitl_response"; response: string }
  | { type: "pause" }
  | { type: "resume" };
```

### SandboxEvent Type

```typescript
type SandboxEvent =
  | { type: "log"; level: "info" | "warn" | "error"; message: string; timestamp: string }
  | { type: "text_delta"; delta: string }
  | { type: "tool_use"; name: string; input: unknown }
  | { type: "tool_result"; name: string; output: unknown; isError: boolean }
  | { type: "hitl_request"; prompt: string; options?: string[] }
  | { type: "checkpoint"; checkpoint: Checkpoint }
  | { type: "turn_complete"; turnCount: number; inputTokens: number; outputTokens: number };
```

### JSONL Logging

Every `SandboxEvent` of type `log` is also appended to `~/.baara/logs/{execution_id}.jsonl`. Format:

```jsonl
{"ts":"2026-04-04T12:00:01Z","level":"info","msg":"Starting task: api-health-check","executionId":"abc123"}
{"ts":"2026-04-04T12:00:02Z","level":"info","msg":"[tool] Bash: curl -sf https://api.example.com/health","executionId":"abc123"}
{"ts":"2026-04-04T12:00:02Z","level":"info","msg":"[tool_result] {\"status\":\"healthy\"}","executionId":"abc123"}
```

The web UI Logs tab reads this file. Real-time updates via WebSocket; historical reads via file.

### MessageBus — Orchestrator Integration

```typescript
class MessageBus {
  constructor(private store: IStore) {}
  
  /** Send a command to a running execution. */
  sendCommand(executionId: string, command: InboundCommand): void;
  
  /** Read pending inbound commands for an execution. */
  readPendingCommands(executionId: string): InboundCommand[];
  
  /** Acknowledge that commands have been delivered. */
  acknowledgeCommands(messageIds: string[]): void;
  
  /** Write a checkpoint for an execution. */
  writeCheckpoint(executionId: string, checkpoint: Checkpoint): void;
  
  /** Read the latest checkpoint for an execution. */
  readLatestCheckpoint(executionId: string): Checkpoint | null;
  
  /** Append a log entry for an execution. */
  appendLog(executionId: string, level: string, message: string): void;
}
```

---

## Sub-Spec C: Durability — Conversation-Level Checkpointing

### Checkpoint Data Structure

```typescript
interface Checkpoint {
  id: string;
  executionId: string;
  turnCount: number;
  conversationHistory: ConversationMessage[];
  pendingToolCalls: string[];         // tool names in-flight at checkpoint time
  agentState: Record<string, unknown>; // SDK session metadata
  timestamp: string;
}

interface ConversationMessage {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}
```

### Checkpoint Lifecycle

1. **Periodic checkpointing** — Every N turns (configurable, default: 5), the sandbox writes a checkpoint to `task_messages` (type: `checkpoint`). Also triggered on HITL pause.
2. **Crash detection** — Health monitor finds execution in `running` status with stale heartbeat (> 2 × heartbeatInterval). Triggers recovery.
3. **Recovery flow:**
  - Transition execution to `retry_scheduled`
  - Load latest checkpoint from `task_messages`
  - Create new execution attempt linked to same thread
  - Start new sandbox instance
  - Call `sandbox.execute()` with checkpoint context:
    - Prior `conversationHistory` injected as message history
    - System prompt prepended: "You were previously working on this task. Your last completed turn was [N]. Your last action was [X]. Continue from where you left off."
    - Any pending inbound commands (HITL responses) delivered immediately
4. **Clean completion** — Final checkpoint written. Execution marked `completed`. Messages retained per configured retention policy.

### What IS Recovered

- Full conversation context (every message exchanged)
- Turn count and progress
- Pending HITL responses that arrived while the agent was down
- Thread linkage (same thread, new attempt)

### What is NOT Recovered

- Partial tool output (e.g., half-finished `npm test` run)
- In-flight file writes that didn't complete
- The exact SDK session state (new `query()` call, not a resumed session)

The agent is told what happened and checks current state — the same thing a human developer would do after a crash.

### Recovery System Prompt Addition

```
RECOVERY CONTEXT: This is a resumed execution. You were previously working on this
task and completed {turnCount} turns before the session was interrupted.

Your last action was: {lastToolCall}
The result was: {lastToolResult}

Please check the current state and continue from where you left off. Do not repeat
work that has already been completed — verify first.
```

---

## Sub-Spec D: Wasm Sandbox — Extism Integration

### WasmSandbox Implementation

```typescript
class WasmSandbox implements ISandbox {
  readonly name = "wasm";
  readonly description = "Extism WebAssembly sandbox with configurable isolation";
  
  async isAvailable(): Promise<boolean> {
    // Check if @extism/extism is importable
  }
  
  async start(config: SandboxStartConfig): Promise<SandboxInstance> {
    // 1. Create Extism plugin from the Claude Code SDK wrapper module
    // 2. Configure memory limits, network access, CPU constraints
    // 3. Return WasmSandboxInstance
  }
  
  async stop(instance: SandboxInstance): Promise<void> {
    // Dispose the Extism plugin
  }
}
```

### Extism Integration Approach

The `@extism/extism` TypeScript SDK provides:

- `Plugin` class: loads and runs Wasm modules
- `createPlugin(manifest, options)`: configures memory, WASI, host functions
- Fuel metering for CPU limits
- Epoch-based timeouts

The Wasm sandbox uses Extism as the isolation boundary. The Claude Code SDK itself runs in the **host process** (not compiled to Wasm — the SDK requires Node/Bun APIs). Extism mediates all I/O between the agent and the outside world through host functions, enforcing resource limits:

1. The **host process** runs the Claude Code SDK `query()` call
2. All tool execution (Bash, Read, Write, etc.) is intercepted and routed through **Extism host functions** that enforce sandbox constraints
3. The Wasm guest module acts as a **policy enforcement layer** — it decides whether each tool call is allowed based on sandbox config (network, filesystem, memory limits)
4. **Host functions** exposed to the Wasm guest:
  - `baara_send_event(event_json)` — sends SandboxEvent to the engine
  - `baara_read_command()` — reads next inbound command (blocks or returns null)
  - `baara_log(level, message)` — structured logging
  - `baara_checkpoint(state_json)` — triggers a checkpoint
5. **Resource constraints** applied via Extism:
  - `maxMemoryMb` → Wasm memory limit
  - `maxCpuPercent` → fuel metering (approximate CPU limiting)
  - `networkEnabled` → WASI network capability toggle
  - `ports` → port-level network filtering via host function mediation

### NativeSandbox Implementation

```typescript
class NativeSandbox implements ISandbox {
  readonly name = "native";
  readonly description = "Direct execution in the host process (no isolation)";
  
  async isAvailable(): Promise<boolean> { return true; }
  
  async start(config: SandboxStartConfig): Promise<SandboxInstance> {
    return new NativeSandboxInstance(config);
  }
  
  async stop(instance: SandboxInstance): Promise<void> {
    await instance.cancel();
  }
}
```

`NativeSandboxInstance.execute()` calls Claude Code SDK `query()` directly — same as the current `CloudCodeRuntime` but wrapped in the `SandboxInstance` interface.

### DockerSandbox Stub

```typescript
class DockerSandbox implements ISandbox {
  readonly name = "docker";
  readonly description = "Docker container sandbox (not yet implemented)";
  
  async isAvailable(): Promise<boolean> { return false; }
  
  async start(): Promise<SandboxInstance> {
    throw new Error("Docker sandbox not yet implemented");
  }
  
  async stop(): Promise<void> {}
}
```

---

## Sub-Spec E: JSONL Logging + Real-Time Streaming

### Log File Layout

```
~/.baara/
  logs/
    {execution_id}.jsonl     # One file per execution
```

### JSONL Format

Each line is a JSON object:

```typescript
interface LogEntry {
  ts: string;              // ISO 8601 timestamp
  level: "info" | "warn" | "error" | "debug";
  msg: string;             // Human-readable message
  executionId: string;
  threadId?: string;
  meta?: Record<string, unknown>;  // Tool name, token counts, etc.
}
```

### Write Path

The `MessageBus.appendLog()` method:

1. Writes to `task_messages` table (durable)
2. Appends to `~/.baara/logs/{executionId}.jsonl` (file)
3. Emits via WebSocket to connected clients (real-time)

### Read Paths

- **Web UI Logs tab**: Fetches `GET /api/executions/:id/logs` which reads the JSONL file
- **Web UI real-time**: WebSocket pushes log events as they arrive
- **CLI**: `baara executions logs <id>` reads the JSONL file with optional `--follow` for tailing

### Log Rotation

JSONL files for completed executions are retained for `event_retention_days` (config, default: 90). A periodic cleanup job deletes files older than the retention period.

---

## Package Changes

### Modified: `packages/core`

- `types.ts` — Replace `ExecutionType` with `SandboxType`, add `SandboxConfig` union, split `AgentConfig`
- `interfaces/executor.ts` — Replace `IRuntime` with `ISandbox` + `SandboxInstance` + `SandboxRegistry`
- Add `interfaces/message-bus.ts` — `IMessageBus` interface
- Add `types/checkpoint.ts` — `Checkpoint`, `ConversationMessage`
- Add `types/sandbox-events.ts` — `SandboxEvent`, `InboundCommand`

### Modified: `packages/executor`

- Rename to conceptually be the "sandbox" package (or keep name, change internals)
- Replace `RuntimeRegistry` with `SandboxRegistry`
- Replace `CloudCodeRuntime` with `NativeSandbox`
- Replace `WasmRuntime` stub with real `WasmSandbox` (Extism)
- Replace `WasmEdgeRuntime` with `DockerSandbox` stub
- Replace `ShellRuntime` — absorbed into NativeSandbox with `allowedTools: ["Bash"]`
- Add `message-bus.ts` — `MessageBus` implementation

### Modified: `packages/store`

- `migrations.ts` — Migration 3: create `task_messages` table, rename `execution_type` → `sandbox_type`
- `sqlite-store.ts` — Add message CRUD methods, update task schema

### Modified: `packages/orchestrator`

- `orchestrator-service.ts` — Use `SandboxRegistry` instead of `RuntimeRegistry`
- `health-monitor.ts` — Add recovery flow (checkpoint load + re-execute)

### Modified: `packages/server`

- `routes/executions.ts` — Add `GET /api/executions/:id/logs` (JSONL read)
- `ws.ts` — Wire SandboxEvent streaming to WebSocket broadcast

### Modified: `packages/cli`

- `commands/start.ts` — Wire SandboxRegistry instead of RuntimeRegistry
- Update MCP tools that reference executionType

### Modified: `packages/mcp`

- Update `create_task` tool schema: `sandboxType` + `sandboxConfig` replaces `executionType`

### Modified: `packages/web`

- Task creation form: sandbox type selector with per-type config fields
- Execution detail: real-time log streaming via WebSocket

---

## Configuration Surface Parity

All sandbox configuration is available via:


| Setting           | Web UI                      | MCP Tool                                   | CLI                            |
| ----------------- | --------------------------- | ------------------------------------------ | ------------------------------ |
| Sandbox type      | Task creation form dropdown | `create_task` sandboxType param            | `--sandbox native|wasm|docker` |
| Wasm memory limit | Config panel slider         | `create_task` sandboxConfig.maxMemoryMb    | `--wasm-memory 512`            |
| Wasm network      | Config panel toggle         | `create_task` sandboxConfig.networkEnabled | `--wasm-network true`          |
| Tool selection    | Checkbox list               | `create_task` agentConfig.allowedTools     | `--tools "Bash,Read,Write"`    |
| Model             | Dropdown                    | `create_task` agentConfig.model            | `--model claude-sonnet-4`      |
| Budget            | Input field                 | `create_task` agentConfig.budgetUsd        | `--budget 2.00`                |


---

## Verification Plan

1. **Native sandbox**: `baara start` → create task with `sandboxType: "native"` → submit → agent executes → completes (same as today but through ISandbox interface)
2. **Shell-as-agent**: Create task with `sandboxType: "native"` + `allowedTools: ["Bash"]` + prompt "echo hello" → agent runs, uses only Bash tool
3. **Checkpointing**: Run long task → verify checkpoints appear in `task_messages` every 5 turns
4. **Crash recovery**: Kill the process mid-execution → restart → verify execution resumes from last checkpoint with context
5. **HITL via message bus**: Run task → send inbound `hitl_response` via API → verify agent receives it
6. **Inbound command**: Run task → send inbound `command` with additional prompt → verify agent acts on it
7. **JSONL logging**: Run task → verify `~/.baara/logs/{id}.jsonl` has structured entries → web UI Logs tab shows them
8. **WebSocket streaming**: Open web UI → run task → verify real-time log/event updates without polling
9. **Wasm sandbox**: Create task with `sandboxType: "wasm"` → verify Extism plugin starts → agent executes within memory limits
10. **Docker stub**: Create task with `sandboxType: "docker"` → verify clean error "Docker sandbox not available"
11. **MCP tool update**: Call `create_task` with new `sandboxType` field → task created correctly
12. **CLI parity**: `baara tasks create --sandbox wasm --wasm-memory 256` → task with correct config


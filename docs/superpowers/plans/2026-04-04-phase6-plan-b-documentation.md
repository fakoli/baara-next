# Plan B: Documentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan.

**Goal:** Write comprehensive documentation for BAARA Next: a root `README.md` that hooks readers and gets them running in 4 commands, eight `docs/` files covering architecture, sandboxes, MCP, API, chat, durability, configuration, and contributing, plus an updated `CLAUDE.md` that reflects the full Phases 2-5 state of the codebase.

**Spec reference:** Part 2 of `docs/superpowers/specs/2026-04-04-phase6-production-launch-design.md`

**Key facts to carry through every doc:**
- 10 packages: `core`, `store`, `orchestrator`, `agent`, `executor`, `transport`, `server`, `mcp`, `cli`, `web`
- 27 MCP tools: 6 tasks + 9 executions + 4 queues + 2 HITL + 2 templates + 2 projects + 2 Claude Code
- 11 execution states: `created → queued → assigned → running → waiting_for_input → completed / failed / timed_out / cancelled / retry_scheduled → dead_lettered`
- 3 sandbox types: `native` (always available), `wasm` (Extism), `docker` (stub)
- Chat uses SSE streaming with event types: `system`, `text`, `text_delta`, `tool_use`, `tool_result`, `result`, `done`
- Runtime: 100% TypeScript on Bun. No Go, no Rust, no native addons.

---

### Task 1: Write `README.md`

**Files:**
- Create: `README.md` (at monorepo root)

- [ ] **Step 1: Write `README.md`**

```markdown
# BAARA Next

**Durable agentic task execution engine**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-1.3%2B-black)](https://bun.sh/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

BAARA Next runs Claude-powered agent tasks that survive process crashes, resume
from checkpoints, and retry automatically on failure.  Control tasks through a
chat-centric web UI, the Claude Code MCP integration, or a full REST API — all
from a single `bun start`.

"baara" means "work" in Mandinka.

---

## Quick Start

```sh
git clone https://github.com/fakoli/baara-next.git
cd baara-next
bun install
ANTHROPIC_API_KEY=sk-ant-... bun start
```

Open **http://localhost:3000** in your browser.

---

## Features

- **Durable execution** — Conversation-level checkpointing means the agent
  resumes exactly where it left off after a crash or restart.
- **11-state lifecycle** — `created → queued → assigned → running →
  waiting_for_input → completed / failed / timed_out / cancelled /
  retry_scheduled → dead_lettered`
- **Exponential-backoff retries** — Configure `maxRetries` per task; exhausted
  tasks land in the dead-letter queue (DLQ).
- **Pluggable sandboxes** — Native (host process), Wasm (Extism isolation), or
  Docker container — swap per task without changing business logic.
- **27-tool MCP server** — Claude Code connects directly via `.mcp.json` (stdio
  transport) or HTTP (`/mcp` endpoint).
- **Chat-centric UI** — React/Vite/Tailwind frontend with real-time SSE
  streaming, inline execution cards, and persistent conversation threads.
- **JSONL logging** — Every execution writes structured logs; query by level,
  search, and offset.
- **Human-in-the-loop** — Agent can pause mid-execution, ask a question, and
  resume when you respond.
- **Single-binary dev mode** — Orchestrator, agent, and HTTP server run in one
  process. No Docker required to get started.
- **Full CLI parity** — All operations available as `baara` sub-commands in
  addition to the HTTP API.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    baara start (dev mode)                │
│                                                         │
│  ┌─────────────┐   ┌──────────────┐   ┌─────────────┐  │
│  │ OrchestratorService │ ←── DevTransport ───→ │ AgentService │  │
│  │  (queue, retry,     │             │  (runtime    │  │
│  │   scheduler,        │             │   polling)   │  │
│  │   health monitor)   │             └─────────────┘  │
│  └──────┬──────┘                          │           │
│         │  SQLite (bun:sqlite)             │ IRuntime  │
│         ▼                                 ▼           │
│  ┌─────────────┐                  ┌─────────────┐    │
│  │    Store    │                  │  Executor   │    │
│  │  (tasks,    │                  │  Sandboxes  │    │
│  │  executions,│                  │  (native /  │    │
│  │  messages,  │                  │   wasm /    │    │
│  │  threads)   │                  │   docker)   │    │
│  └─────────────┘                  └─────────────┘    │
│                                                       │
│  ┌─────────────────────────────────────────────────┐  │
│  │                 Hono HTTP Server                │  │
│  │  /api/tasks  /api/executions  /api/chat  /mcp  │  │
│  └─────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

See [docs/architecture.md](docs/architecture.md) for the full component
diagram, state machine, and data flow.

---

## Claude Code Integration

Add BAARA Next as an MCP server in your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "baara-next": {
      "command": "bun",
      "args": ["run", "/path/to/baara-next/packages/cli/src/index.ts", "mcp-server"],
      "env": {
        "ANTHROPIC_API_KEY": "${ANTHROPIC_API_KEY}"
      }
    }
  }
}
```

Then in Claude Code: "Create a task that clones my repo and runs the tests."

See [docs/mcp-integration.md](docs/mcp-integration.md) for the full 27-tool
reference.

---

## CLI Quick Reference

| Command | Description |
|---------|-------------|
| `bun start` | Start server (orchestrator + agent + HTTP API) |
| `bun start --port 8080` | Start on a custom port |
| `bun start --data-dir ./data` | Custom data directory |
| `baara tasks list` | List all tasks |
| `baara tasks create --name <n> --prompt <p>` | Create a task |
| `baara tasks run <name>` | Run a task directly |
| `baara executions list` | List recent executions |
| `baara executions logs <id>` | Tail execution logs |
| `baara queues list` | Show queue depths |
| `baara chat` | Start interactive chat REPL |
| `baara mcp-server` | Run MCP server on stdio (for Claude Code) |

---

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | — | Required for agent execution and chat |
| `BAARA_API_KEY` | — | Enable API key auth on all `/api/*` routes |
| `BAARA_SHELL_ENABLED` | `false` | Allow shell (`exit`, `echo`) task execution |

See [docs/configuration.md](docs/configuration.md) for the full reference.

---

## Documentation

| File | Topic |
|------|-------|
| [docs/architecture.md](docs/architecture.md) | 10-package overview, data flow, state machine |
| [docs/sandbox-guide.md](docs/sandbox-guide.md) | ISandbox interface, three implementations, adding a sandbox |
| [docs/mcp-integration.md](docs/mcp-integration.md) | 27-tool MCP catalog, Claude Code setup |
| [docs/api-reference.md](docs/api-reference.md) | Every REST endpoint with request/response |
| [docs/chat-architecture.md](docs/chat-architecture.md) | SSE protocol, event types, thread model |
| [docs/durability.md](docs/durability.md) | Checkpoint model, recovery flow |
| [docs/configuration.md](docs/configuration.md) | Config file, environment variables, CLI flags |
| [docs/contributing.md](docs/contributing.md) | Dev setup, running tests, PR guidelines |

---

## Contributing

See [docs/contributing.md](docs/contributing.md).

---

## License

MIT — see [LICENSE](LICENSE).
```

---

### Task 2: Write `docs/architecture.md`

**Files:**
- Create: `docs/architecture.md`

- [ ] **Step 1: Write `docs/architecture.md`**

```markdown
# Architecture

## Package Overview

BAARA Next is a 10-package TypeScript monorepo under `packages/`:

| Package | Role |
|---------|------|
| `core` | Shared types (`Task`, `Execution`, `SandboxConfig`, `ISandbox`, etc.), error classes, interfaces (`IStore`, `IOrchestratorService`) |
| `store` | SQLite persistence via `bun:sqlite`. Owns all DB migrations and queries. |
| `orchestrator` | Queue manager, scheduler (cron), health monitor, retry logic, event handler, `OrchestratorService` facade |
| `agent` | `AgentService` polling loop — dequeues assigned executions and dispatches them to runtimes |
| `executor` | Sandbox implementations (Native, Wasm, Docker), `SandboxRegistry`, `MessageBus`, `CheckpointService`, `LogWriter` |
| `transport` | `DevTransport` (in-process) and `HttpTransport` (network) — abstract the orchestrator/agent communication channel |
| `server` | Hono HTTP server, all REST routes, WebSocket broadcast, rate limiting, API key auth |
| `mcp` | 27-tool MCP server. Exposes stdio transport (for Claude Code) and HTTP transport (`/mcp` endpoint) |
| `cli` | Commander-based CLI (`baara start`, `tasks`, `executions`, `queues`, `chat`, `mcp-server`, `admin`) |
| `web` | React 18 / Vite / Tailwind frontend. Chat UI with SSE streaming and inline execution cards |

### Dependency graph (simplified)

```
web → server (HTTP)
cli → server, orchestrator, agent, executor, mcp, transport, store
server → orchestrator (interface), store (interface), mcp, transport
mcp → orchestrator (interface), store (interface), executor (logs)
orchestrator → store (interface), transport (interface), executor (sandboxRegistry)
agent → transport (interface), executor (runtimes)
executor → store (interface), core
transport → core
store → core
core  (no internal deps)
```

---

## Data Flow: Task Submission to Completion

```
Client (browser / Claude Code / CLI)
  │
  ▼  POST /api/tasks/:id/submit
OrchestratorService.submitTask()
  │  Creates Execution row (status: created → queued)
  │  Inserts into queue table
  ▼
QueueManager.tick() — runs every 500ms
  │  Dequeues item, transitions execution → assigned
  │  DevTransport.dispatchExecution(execution)
  ▼
AgentService.pollLoop()
  │  Receives execution via transport
  │  Selects matching IRuntime (or ISandbox for direct mode)
  ▼
SandboxInstance.execute(params)
  │  Claude Code SDK query() runs with sandboxed tools
  │  Emits SandboxEvents (log, text_delta, tool_use, checkpoint, ...)
  │  Writes JSONL log entries via LogWriter
  ▼
OrchestratorService.handleExecutionComplete()
  │  Transitions execution → completed / failed
  │  Writes execution.output, inputTokens, outputTokens
  │  Broadcasts WebSocket event to connected browser clients
  ▼
Store (SQLite) — final execution row persisted
```

---

## Execution State Machine (11 states)

```
                    ┌─────────┐
                    │ created │
                    └────┬────┘
                         │ submitTask()
                    ┌────▼────┐
                    │ queued  │
                    └────┬────┘
                         │ QueueManager.tick()
                    ┌────▼────┐
                    │assigned │
                    └────┬────┘
                         │ AgentService.start()
                    ┌────▼────┐
              ┌─────│ running │─────┐
              │     └────┬────┘     │
              │          │          │
    ┌─────────▼──┐   ┌───▼──┐  ┌───▼──────────────┐
    │waiting_for │   │failed│  │     timed_out     │
    │   input    │   └───┬──┘  └───────┬───────────┘
    └──────┬─────┘       │             │
           │ provideInput │             │
           └──────────────┘             │
                    │        attempt < maxRetries?
               ┌────▼────────────────────▼────┐
               │       retry_scheduled        │
               └────────────────┬─────────────┘
                                │ re-enqueue
                    ┌───────────▼──┐
                    │    queued    │ (new attempt)
                    └──────────────┘

   Terminal states:
     completed      — agent finished successfully
     cancelled      — cancelled via API
     dead_lettered  — attempts exhausted
```

---

## Event Sourcing

Every state transition and significant occurrence appends a row to the
`execution_events` table with a monotonically increasing `seq` number:

```
seq | executionId | type                  | payload (JSON)
----+-------------+-----------------------+----------------
  1 | exec-abc    | status_changed        | { from: "created", to: "queued" }
  2 | exec-abc    | status_changed        | { from: "queued", to: "assigned" }
  3 | exec-abc    | agent_turn_complete   | { turnCount: 1, inputTokens: 512 }
  4 | exec-abc    | status_changed        | { from: "running", to: "completed" }
```

Clients can poll `GET /api/executions/:id/events?afterSeq=N` to receive
incremental event streams without WebSocket connectivity.

---

## Sandbox Architecture

The `ISandbox` interface (defined in `packages/core/src/interfaces/sandbox.ts`)
abstracts the execution isolation layer:

```
ISandbox
  .start(config: SandboxStartConfig): Promise<SandboxInstance>
  .stop(instance: SandboxInstance): Promise<void>
  .isAvailable(): Promise<boolean>

SandboxInstance
  .execute(params: SandboxExecuteParams): Promise<SandboxExecuteResult>
  .sendCommand(command: InboundCommand): Promise<void>
  .cancel(): Promise<void>
  readonly events: AsyncIterable<SandboxEvent>
```

Three implementations ship:

| Implementation | File | Availability |
|---------------|------|--------------|
| `NativeSandbox` | `packages/executor/src/sandboxes/native.ts` | Always |
| `WasmSandbox` | `packages/executor/src/sandboxes/wasm.ts` | When `@extism/extism` installed |
| `DockerSandbox` | `packages/executor/src/sandboxes/docker.ts` | Stub — always `isAvailable() = false` |

The `SandboxRegistry` holds one instance of each and resolves by `SandboxType`
at runtime. `OrchestratorService.runDirect()` uses it for direct-mode tasks.

---

## Durability: MessageBus + CheckpointService

Two mechanisms ensure crash recovery:

1. **MessageBus** (`packages/executor/src/message-bus.ts`) — Persists all
   inter-process messages in the `task_messages` SQLite table. On restart,
   in-flight `inbound` messages are re-delivered to the appropriate sandbox.

2. **CheckpointService** (`packages/executor/src/checkpoint-service.ts`) —
   Writes a `Checkpoint` row after each agent turn, recording the full
   conversation history and pending tool calls. On restart,
   `buildRecoveryPrompt()` constructs a resume prompt from the last checkpoint
   so the agent continues from where it paused.

See [docs/durability.md](durability.md) for the full recovery flow.
```

---

### Task 3: Write `docs/sandbox-guide.md`

**Files:**
- Create: `docs/sandbox-guide.md`

- [ ] **Step 1: Write `docs/sandbox-guide.md`**

```markdown
# Sandbox Guide

## What is a Sandbox?

A sandbox is the isolation layer that wraps the Claude Code SDK `query()` call
for a single execution.  The Claude Code SDK is always the execution engine —
what changes between tasks is how isolated the agent's environment is.

Three sandbox types are available:

| Type | Isolation | Status |
|------|-----------|--------|
| `native` | None — agent runs directly in host process | Production-ready |
| `wasm` | Extism WebAssembly plugin with memory/CPU limits | Beta |
| `docker` | Container isolation | Stub — not yet implemented |

---

## The `ISandbox` Interface

Defined in `packages/core/src/interfaces/sandbox.ts`:

```typescript
interface ISandbox {
  readonly name: SandboxType;      // "native" | "wasm" | "docker"
  readonly description: string;

  start(config: SandboxStartConfig): Promise<SandboxInstance>;
  stop(instance: SandboxInstance): Promise<void>;
  isAvailable(): Promise<boolean>;
}
```

`SandboxStartConfig` carries the executionId, `SandboxConfig` (resource limits),
`AgentConfig` (Claude SDK settings), and a writable `dataDir`.

---

## The `SandboxInstance` Interface

```typescript
interface SandboxInstance {
  readonly id: string;
  readonly sandboxType: SandboxType;

  execute(params: SandboxExecuteParams): Promise<SandboxExecuteResult>;
  sendCommand(command: InboundCommand): Promise<void>;
  cancel(): Promise<void>;
  readonly events: AsyncIterable<SandboxEvent>;
}
```

`execute()` blocks until the agent finishes. It never throws for agent-level
failures — those are returned as `{ status: "failed", error: "..." }`.

`events` is an `AsyncIterable<SandboxEvent>` that emits log entries, text
deltas, tool use/result records, checkpoint snapshots, and turn-complete
summaries in real time.

---

## NativeSandbox

**File:** `packages/executor/src/sandboxes/native.ts`

Runs the Claude Code SDK `query()` directly in the host Bun process.  No
resource limits. Suitable for development and trusted automation workloads.

**SandboxConfig for native:**
```typescript
{ type: "native" }
```

`isAvailable()` always returns `true`.

---

## WasmSandbox

**File:** `packages/executor/src/sandboxes/wasm.ts`

Uses the `@extism/extism` library to run the agent inside a WebAssembly plugin
with configurable memory and CPU limits.  Network access to the Anthropic API
is allowed by default and can be disabled.

**SandboxConfig for wasm:**
```typescript
{
  type: "wasm",
  networkEnabled?: boolean,    // default: true
  maxMemoryMb?: number,        // default: 512
  maxCpuPercent?: number,      // default: 80 (0–100)
  ports?: number[],            // ports exposed from the sandbox
}
```

`isAvailable()` returns `true` when `@extism/extism` is importable.

---

## DockerSandbox

**File:** `packages/executor/src/sandboxes/docker.ts`

Stub implementation.  `isAvailable()` always returns `false` so the orchestrator
falls back to the next available sandbox type.  Container wiring is not yet
implemented.

**SandboxConfig for docker:**
```typescript
{
  type: "docker",
  image?: string,             // default: "baara-next/sandbox:latest"
  networkEnabled?: boolean,   // default: true
  ports?: number[],
  volumeMounts?: string[],    // host paths to bind-mount
}
```

---

## SandboxRegistry

`packages/executor/src/sandbox-registry.ts`

The registry holds one `ISandbox` instance per type and resolves by name:

```typescript
const registry = await createDefaultSandboxRegistry({ dataDir });
const sandbox = registry.get("native"); // throws if not found
```

`createDefaultSandboxRegistry()` (exported from `@baara-next/executor`)
registers `NativeSandbox`, `WasmSandbox`, and `DockerSandbox` automatically.

---

## SandboxConfig on a Task

`SandboxConfig` is stored as a JSON blob in the `tasks` table.  When creating
or updating a task, pass `sandboxType` + `sandboxConfig` together:

```bash
curl -X POST http://localhost:3000/api/tasks \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "my-wasm-task",
    "prompt": "analyse this dataset",
    "sandboxType": "wasm",
    "sandboxConfig": {
      "type": "wasm",
      "maxMemoryMb": 256,
      "maxCpuPercent": 40,
      "networkEnabled": true
    }
  }'
```

---

## Adding a New Sandbox

1. Create `packages/executor/src/sandboxes/my-sandbox.ts`.
2. Implement `ISandbox` and `SandboxInstance`.
3. Add `"my-type"` to the `SandboxType` union in
   `packages/core/src/types.ts`.
4. Add a matching arm to `SandboxConfig` (discriminated union, same file).
5. Register in `createDefaultSandboxRegistry()` in
   `packages/executor/src/index.ts`.
6. `isAvailable()` should return `false` when your sandbox's prerequisites
   aren't installed so the system degrades gracefully.
```

---

### Task 4: Write `docs/mcp-integration.md`

**Files:**
- Create: `docs/mcp-integration.md`

- [ ] **Step 1: Write `docs/mcp-integration.md`**

```markdown
# MCP Integration

BAARA Next exposes a 27-tool Model Context Protocol (MCP) server in two
transport modes:

| Transport | How to connect |
|-----------|---------------|
| **Stdio** | `baara mcp-server` — add to `.mcp.json` for Claude Code |
| **HTTP** | `POST /mcp` on the running server |

---

## Claude Code (stdio transport)

Add to `.mcp.json` in your project root or `~/.claude/mcp.json`:

```json
{
  "mcpServers": {
    "baara-next": {
      "command": "bun",
      "args": [
        "run",
        "/absolute/path/to/baara-next/packages/cli/src/index.ts",
        "mcp-server"
      ],
      "env": {
        "ANTHROPIC_API_KEY": "${ANTHROPIC_API_KEY}",
        "BAARA_SHELL_ENABLED": "true"
      }
    }
  }
}
```

Claude Code will start the process on demand and communicate over stdin/stdout.
The MCP server connects to the running BAARA Next HTTP server on the default
port (3000). To connect to a different URL, set `BAARA_SERVER_URL`.

---

## HTTP transport

The running server also accepts JSON-RPC 2.0 requests directly:

```bash
# initialize
curl -X POST http://localhost:3000/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize"}'

# list tools
curl -X POST http://localhost:3000/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'

# call a tool
curl -X POST http://localhost:3000/mcp \
  -H 'Content-Type: application/json' \
  -d '{
    "jsonrpc":"2.0","id":3,"method":"tools/call",
    "params":{
      "name":"create_task",
      "arguments":{"name":"my-task","prompt":"echo hello"}
    }
  }'
```

If `BAARA_API_KEY` is set on the server, include `X-Api-Key: <key>` in the
request header.

---

## Tool Catalog

### Task tools (6)

| Tool | Description |
|------|-------------|
| `list_tasks` | List all tasks with status, cron schedule, and execution mode |
| `get_task` | Get full details of a task by name or UUID |
| `create_task` | Create a new task |
| `update_task` | Update an existing task by name or UUID |
| `delete_task` | Delete a task by name or UUID |
| `toggle_task` | Toggle a task enabled/disabled |

**`create_task` parameters:**
```json
{
  "name": "my-task",
  "prompt": "analyse the logs in /var/log/app.log",
  "description": "Log analysis task",
  "sandboxType": "native",
  "sandboxConfig": { "type": "native" },
  "executionMode": "queued",
  "priority": 2,
  "maxRetries": 3,
  "timeoutMs": 60000,
  "allowedTools": ["Read", "Bash"],
  "cronExpression": "0 9 * * 1-5",
  "projectId": "proj-uuid"
}
```

---

### Execution tools (9)

| Tool | Description |
|------|-------------|
| `run_task` | Execute a task immediately in direct mode (bypasses queue) |
| `submit_task` | Submit a task to the execution queue and return immediately |
| `list_executions` | List executions for a task with optional status filter |
| `get_execution` | Get full details of an execution by UUID |
| `get_execution_events` | Get the event timeline for an execution |
| `cancel_execution` | Cancel a running or queued execution |
| `retry_execution` | Manually retry a failed or timed-out execution |
| `get_system_status` | Get system health: task counts, queue depths, DLQ count |
| `get_execution_logs` | Get structured JSONL log entries for an execution |

**`get_execution_logs` parameters:**
```json
{
  "executionId": "exec-uuid",
  "level": "error",
  "search": "timeout",
  "limit": 100,
  "offset": 0
}
```

---

### Queue tools (4)

| Tool | Description |
|------|-------------|
| `list_queues` | List all queues with depth, active count, and concurrency settings |
| `get_queue_info` | Get detailed information for a specific queue by name |
| `dlq_list` | List all dead-lettered executions that have exhausted their retries |
| `dlq_retry` | Retry a dead-lettered execution by submitting it again |

Queue names: `transfer`, `timer`, `visibility`, `dlq`.

---

### HITL tools (2)

| Tool | Description |
|------|-------------|
| `list_pending_input` | List all executions paused and waiting for human input |
| `provide_input` | Deliver a response to an execution waiting for human input |

**`provide_input` parameters:**
```json
{
  "executionId": "exec-uuid",
  "response": "yes, proceed with the deployment"
}
```

---

### Template tools (2)

| Tool | Description |
|------|-------------|
| `list_templates` | List all available task templates with agent config |
| `create_task_from_template` | Create a new task using a template as the base config |

---

### Project tools (2)

| Tool | Description |
|------|-------------|
| `list_projects` | List all projects with task counts and descriptions |
| `set_active_project` | Set the active project to scope task operations |

---

### Claude Code integration tools (2)

| Tool | Description |
|------|-------------|
| `discover_plugins` | Discover installed Claude Code plugins, skills, and agents from `~/.claude/` |
| `run_skill` | Load a Claude Code skill by name and return its markdown content |

---

## MCP Server Info

```json
{
  "protocolVersion": "2024-11-05",
  "serverInfo": { "name": "baara-next", "version": "0.1.0" },
  "capabilities": { "tools": {} }
}
```
```

---

### Task 5: Write `docs/api-reference.md`

**Files:**
- Create: `docs/api-reference.md`

- [ ] **Step 1: Write `docs/api-reference.md`**

```markdown
# API Reference

Base URL: `http://localhost:3000`

Authentication: If `BAARA_API_KEY` is set, all `/api/*` and `/mcp` routes
require `X-Api-Key: <key>` or `Authorization: Bearer <key>`.

---

## Tasks

### `GET /api/tasks`

List all tasks.

**Query params:**
- `projectId` — filter by project UUID (optional)

**Response 200:**
```json
[
  {
    "id": "uuid",
    "name": "my-task",
    "description": "...",
    "prompt": "...",
    "sandboxType": "native",
    "sandboxConfig": { "type": "native" },
    "executionMode": "queued",
    "priority": 2,
    "maxRetries": 3,
    "timeoutMs": 30000,
    "enabled": true,
    "cronExpression": null,
    "projectId": null,
    "agentConfig": null,
    "createdAt": "ISO8601",
    "updatedAt": "ISO8601"
  }
]
```

---

### `GET /api/tasks/:id`

Get a single task by UUID or name.

**Response 200:** Task object (same shape as list item).
**Response 404:** `{ "error": "Task not found: \"name\"" }`

---

### `POST /api/tasks`

Create a task.

**Request body:**
```json
{
  "name": "my-task",
  "prompt": "echo hello",
  "description": "optional",
  "sandboxType": "native",
  "sandboxConfig": { "type": "native" },
  "executionMode": "queued",
  "priority": 2,
  "maxRetries": 3,
  "timeoutMs": 30000,
  "cronExpression": null,
  "agentConfig": null,
  "projectId": null
}
```

**Response 201:** Full Task object.
**Response 400:** `{ "error": "name is required" }`
**Response 409:** `{ "error": "Task 'name' already exists" }`

---

### `PUT /api/tasks/:id`

Update a task. All fields optional.

**Response 200:** Updated Task object.
**Response 404:** `{ "error": "..." }`

---

### `DELETE /api/tasks/:id`

Delete a task.

**Response 200:** `{ "ok": true }`
**Response 404:** `{ "error": "..." }`

---

### `POST /api/tasks/:id/toggle`

Toggle enabled/disabled.

**Response 200:** Updated Task object.

---

### `POST /api/tasks/:id/submit`

Submit the task to the queue.

**Response 201:** Execution object (status: `queued`).
**Response 404:** `{ "error": "..." }`

---

### `POST /api/tasks/:id/run`

Run the task directly (bypasses queue, blocks until complete).

**Response 200:** Execution object (status: `completed` or `failed`).
**Response 404:** `{ "error": "..." }`

---

## Executions

### `GET /api/executions`

List executions.

**Query params:**
- `taskId` — filter by task UUID
- `status` — filter by execution status
- `limit` — max results (default: 50, max: 1000)

**Response 200:** Array of Execution objects.

---

### `GET /api/executions/pending-input`

List executions paused and waiting for human input.

**Response 200:** Array of Execution objects.

---

### `GET /api/executions/:id`

Get a single execution.

**Response 200:** Execution object.
**Response 404:** `{ "error": "..." }`

---

### `GET /api/executions/:id/events`

Get the event timeline for an execution.

**Query params:**
- `afterSeq` — return only events with seq > this value (for polling)
- `limit` — max events (default: all, max: 500)

**Response 200:** Array of event objects.

---

### `GET /api/executions/:id/logs`

Get structured JSONL log entries.

**Query params:**
- `level` — filter by log level (`info`, `warn`, `error`, `debug`)
- `search` — case-insensitive text search
- `limit` — max entries (default: 200, max: 2000)
- `offset` — skip N entries

**Response 200:**
```json
{
  "executionId": "uuid",
  "entries": [
    { "ts": "ISO8601", "level": "info", "msg": "...", "executionId": "uuid" }
  ],
  "total": 42
}
```

---

### `POST /api/executions/:id/cancel`

Cancel a running or queued execution.

**Response 200:** `{ "ok": true }`
**Response 404:** Not found.
**Response 409:** Invalid state transition.

---

### `POST /api/executions/:id/retry`

Retry a failed or timed-out execution.

**Response 200:** New Execution object.

---

### `POST /api/executions/:id/input`

Provide a response to a `waiting_for_input` execution.

**Request body:** `{ "response": "yes" }`

**Response 200:** `{ "ok": true }`
**Response 404:** Execution not found.
**Response 409:** No pending input request.

---

## Queues

### `GET /api/queues`

List all queues.

**Response 200:**
```json
[
  {
    "name": "transfer",
    "depth": 3,
    "activeCount": 1,
    "maxConcurrency": 5,
    "createdAt": "ISO8601"
  }
]
```

---

### `GET /api/queues/:name`

Get details for a specific queue.

**Response 200:** QueueInfo object.
**Response 404:** `{ "error": "Queue not found: \"name\"" }`

---

## Chat

### `POST /api/chat`

Start or continue a conversation with the BAARA Next agent. Returns an SSE stream.

**Request body:**
```json
{
  "message": "List my tasks and run the one named daily-report",
  "sessionId": "optional-session-uuid",
  "threadId": "optional-thread-uuid",
  "activeProjectId": null
}
```

**Response 200:** `Content-Type: text/event-stream`

Each SSE event has `event: message` (or `event: done` for the final event). The
`data` field contains a JSON object.  Event types:

| `type` | Payload |
|--------|---------|
| `system` | `{ sessionId, threadId, toolCount }` — handshake |
| `text` | `{ content: string }` — complete text block |
| `text_delta` | `{ delta: string }` — streaming text chunk |
| `tool_use` | `{ name: string, input: object }` — MCP tool invoked |
| `tool_result` | `{ name: string, output: unknown, isError: boolean }` |
| `result` | `{ text, isError, usage: { inputTokens, outputTokens }, costUsd, durationMs }` |
| `error` | `{ message: string }` |
| `done` | `{}` — stream complete |

---

### `GET /api/chat/sessions`

List all conversation threads.

**Response 200:** Array of Thread objects `{ id, title, createdAt, updatedAt }`.

---

### `GET /api/chat/sessions/:id`

Get a single thread.

**Response 200:** Thread object.
**Response 404:** `{ "error": "Session not found" }`

---

### `PUT /api/chat/sessions/:id/rename`

Rename a thread.

**Request body:** `{ "title": "My conversation" }`

**Response 200:** Updated Thread object.

---

## System

### `GET /api/health`

Liveness probe.

**Response 200:** `{ "status": "ok", "uptime": 42, "version": "0.1.0" }`

---

### `GET /api/system/status`

Detailed system status.

**Response 200:**
```json
{
  "uptime": 120,
  "version": "0.1.0",
  "queues": {
    "transfer": { "depth": 0, "active": 0 }
  },
  "totals": {
    "queued": 0,
    "active": 0,
    "deadLettered": 0,
    "waitingForInput": 0
  }
}
```

---

## Internal (production-mode agent transport)

These routes are used by `HttpTransport` when running in multi-process
production mode. Not intended for direct client use.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/internal/executions/poll` | Agent polls for assigned executions |
| `POST` | `/internal/executions/:id/complete` | Agent reports completion |
| `POST` | `/internal/executions/:id/heartbeat` | Agent liveness ping |
| `GET` | `/internal/executions/:id/input` | Agent polls for HITL input |

---

## MCP (JSON-RPC 2.0)

See [mcp-integration.md](mcp-integration.md) for the full tool reference.

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/mcp` | JSON-RPC 2.0 endpoint |

Methods: `initialize`, `tools/list`, `tools/call`.
```

---

### Task 6: Write `docs/chat-architecture.md`

**Files:**
- Create: `docs/chat-architecture.md`

- [ ] **Step 1: Write `docs/chat-architecture.md`**

```markdown
# Chat Architecture

## Overview

The chat system connects a user to a Claude agent via `POST /api/chat`, which
returns a Server-Sent Events (SSE) stream.  The agent has access to all 27
BAARA Next MCP tools, giving it full control over task creation, submission,
monitoring, and human-in-the-loop response delivery — all within the same
conversation turn.

---

## SSE Protocol

Every SSE event follows this wire format:

```
event: message\n
id: <monotonic-int>\n
data: <json-object>\n
\n
```

The final event in a stream uses `event: done` (not `event: message`):

```
event: done\n
id: <n>\n
data: {"type":"done"}\n
\n
```

---

## Event Types

### `system` — Handshake

Sent as the first event of every stream.  Allows the client to persist the
session and thread IDs for future continuation.

```json
{
  "type": "system",
  "sessionId": "sdk-session-uuid",
  "threadId": "thread-uuid",
  "toolCount": 27
}
```

### `text_delta` — Streaming text chunk

Emitted as the model produces text, before the full assistant turn completes.
Suitable for real-time rendering in the chat UI.

```json
{ "type": "text_delta", "delta": "Sure, I'll" }
```

### `text` — Complete text block

A full text content block from one assistant turn.

```json
{ "type": "text", "content": "Sure, I'll create that task for you now." }
```

### `tool_use` — MCP tool invoked

```json
{
  "type": "tool_use",
  "name": "create_task",
  "input": { "name": "daily-report", "prompt": "generate the daily report" }
}
```

### `tool_result` — MCP tool response

```json
{
  "type": "tool_result",
  "name": "create_task",
  "output": { "ok": true, "data": { "id": "uuid", "name": "daily-report" } },
  "isError": false
}
```

### `result` — Final turn summary

```json
{
  "type": "result",
  "text": null,
  "isError": false,
  "usage": { "inputTokens": 1024, "outputTokens": 256 },
  "costUsd": 0.003,
  "durationMs": 2100
}
```

### `error` — Stream error

```json
{ "type": "error", "message": "Claude API quota exceeded" }
```

### `done` — Stream complete

```json
{ "type": "done" }
```

---

## Thread Model

Every chat POST creates or continues a **thread**.  A thread is a lightweight
record in the `threads` SQLite table:

```sql
CREATE TABLE threads (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  createdAt  TEXT NOT NULL,
  updatedAt  TEXT NOT NULL
);
```

- If `threadId` is not provided in the request, a new thread is created
  automatically using the first 60 characters of the message as the title.
- If `threadId` is provided, the thread's `updatedAt` is refreshed.
- Threads are visible in the sidebar of the web UI and via
  `GET /api/chat/sessions`.

---

## Session Persistence

The Agent SDK saves conversation history as a session file in
`~/.baara/sessions/<sessionId>.jsonl` (or the configured `dataDir`).
Passing `sessionId` to a subsequent `POST /api/chat` request resumes from
exactly that session, so Claude remembers the context of previous turns.

When a conversation resumes, the SDK replays the stored `ConversationMessage[]`
as the initial context before processing the new user message.

---

## Inline Cards (web UI)

When the agent calls a BAARA tool, the web UI renders an **inline card** in the
message stream rather than raw JSON.  The card type is derived from the MCP tool
name:

| Tool called | Card rendered |
|-------------|---------------|
| `create_task` / `get_task` | TaskCard — name, sandboxType, status |
| `run_task` / `submit_task` | ExecutionCard — status, duration, output |
| `list_tasks` | TaskListCard — sortable table |
| `get_system_status` | StatusCard — queue gauges, DLQ count |
| `dlq_list` | DlqCard — dead-letter entries with retry button |
| `list_pending_input` | HitlCard — blocked executions with input form |

Cards are rendered from the `tool_result` SSE event before the text reply
that explains them.

---

## Request Flow

```
Browser (POST /api/chat)
  │
  ▼
chatRoutes — parses body, creates/resolves thread
  │
  ▼
gatherChatContext() — queries store for active project, thread title
buildSystemPrompt() — constructs agent instructions
createBaaraMcpServer() — fresh MCP server instance
  │
  ▼
streamSSE() — opens SSE response
  │
  ▼
query() [Agent SDK]
  │  yields system, assistant, stream_event, result messages
  ▼
SSE event mapper
  │  converts SDK messages → BAARA SSE event types
  ▼
Browser receives SSE stream
```
```

---

### Task 7: Write `docs/durability.md`

**Files:**
- Create: `docs/durability.md`

- [ ] **Step 1: Write `docs/durability.md`**

```markdown
# Durability

BAARA Next is designed so that a process crash (OOM, SIGKILL, host reboot) does
not lose work.  Two mechanisms cooperate: the **MessageBus** for command
delivery and the **CheckpointService** for conversation history.

---

## What Is Recovered After a Crash

| State | Recovered? | How |
|-------|-----------|-----|
| Task definitions | Yes | SQLite `tasks` table |
| Queue state (queued/assigned executions) | Yes | SQLite `executions` table; orchestrator re-enqueues on start |
| In-flight agent conversation history | Yes | CheckpointService writes after each turn |
| Undelivered HITL responses | Yes | MessageBus re-delivers from `task_messages` |
| JSONL log lines already written | Yes | Log files are append-only |
| In-process memory (model cache, agent loop vars) | No | Agent starts a new turn from last checkpoint |
| Partial tool call results | Partial | Re-runs from last checkpoint; idempotent tools are safe |

---

## Checkpoint Model

`CheckpointService` (`packages/executor/src/checkpoint-service.ts`) writes a
`Checkpoint` row to the `task_messages` table after each completed agent turn:

```typescript
interface Checkpoint {
  id: string;
  executionId: string;
  turnCount: number;
  conversationHistory: ConversationMessage[];  // full message array
  pendingToolCalls: string[];                  // names of in-flight tool calls
  agentState: Record<string, unknown>;         // SDK session metadata
  timestamp: string;
}
```

The checkpoint includes the **complete** conversation history up to that turn,
not just the delta.  This makes recovery independent of prior checkpoints.

---

## Recovery Flow

On server restart, `OrchestratorService.start()` scans for executions in
`running` or `assigned` status and re-enqueues them:

```
startup
  │
  ▼
store.listExecutions({ status: "running" })
store.listExecutions({ status: "assigned" })
  │
  ▼
For each recovery candidate:
  loadLastCheckpoint(executionId)
    │
    ▼  (checkpoint found)
  buildRecoveryPrompt(checkpoint)
    │  Returns a system-level message explaining the recovery context
    │  and the conversation history up to the last completed turn
    ▼
  re-enqueue with checkpoint data attached
    │
    ▼
AgentService picks up the execution
  │
  ▼
SandboxInstance.execute({ checkpoint, prompt: recoveryPrompt })
  │  Agent SDK resumes from conversationHistory
  ▼
Execution continues from turn N+1
```

`buildRecoveryPrompt()` (`packages/executor/src/recovery.ts`) constructs a
prompt like:

```
[Recovery context]
This execution was interrupted at turn 3.
The conversation history has been restored.
Pending tool calls at time of interruption: Bash, Read.
Please resume from where you left off.
```

---

## MessageBus

`MessageBus` (`packages/executor/src/message-bus.ts`) persists all
inter-process messages in the `task_messages` SQLite table:

```sql
CREATE TABLE task_messages (
  id          TEXT PRIMARY KEY,
  executionId TEXT NOT NULL,
  direction   TEXT NOT NULL,   -- "inbound" | "outbound"
  messageType TEXT NOT NULL,
  payload     TEXT NOT NULL,
  status      TEXT NOT NULL,   -- "pending" | "delivered" | "acknowledged"
  createdAt   TEXT NOT NULL
);
```

On delivery, the sandbox changes `status` to `delivered`.  On acknowledgement
(after processing), it changes to `acknowledged`.  On restart, any `pending`
or `delivered` `inbound` messages are re-delivered to the appropriate sandbox.

---

## Comparison to Temporal

| Feature | BAARA Next | Temporal |
|---------|-----------|---------|
| Durability model | SQLite checkpoint + re-queue | Workflow history in Temporal server |
| Dependencies | None (embedded SQLite) | Temporal server + worker infrastructure |
| Recovery granularity | Per agent turn (seconds) | Per workflow step (deterministic replay) |
| Deterministic replay | No | Yes |
| Cluster support | No | Yes |
| Suitable for | Single-machine agent automation | Distributed microservice orchestration |

BAARA Next trades deterministic replay for simplicity: it re-runs from the last
checkpoint rather than replaying the full workflow history.  This is sufficient
for interactive agent tasks and automation workloads that do not require strict
exactly-once semantics.
```

---

### Task 8: Write `docs/configuration.md`

**Files:**
- Create: `docs/configuration.md`

- [ ] **Step 1: Write `docs/configuration.md`**

```markdown
# Configuration

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | — | **Required.** API key for Claude model access. Used by agent and chat. |
| `BAARA_API_KEY` | — | If set, all `/api/*` and `/mcp` routes require `X-Api-Key: <key>` or `Authorization: Bearer <key>`. If unset, all routes are unauthenticated. |
| `BAARA_SHELL_ENABLED` | `false` | Set to `true` to allow shell-type tasks (`executionType: "shell"`) to execute system commands. Disabled by default for safety. |
| `BAARA_SERVER_URL` | `http://localhost:3000` | URL used by `baara mcp-server` (stdio mode) to connect to the running HTTP server. |
| `BAARA_AUTH_MODE` | `apikey` | Authentication mode. Currently only `apikey` is supported. |

---

## CLI Flags (`bun start`)

| Flag | Default | Description |
|------|---------|-------------|
| `--port <port>` | `3000` | HTTP server port |
| `--hostname <host>` | `0.0.0.0` | Hostname to bind to. Use `127.0.0.1` to restrict to localhost. |
| `--data-dir <dir>` | `~/.baara` | Directory for the SQLite database and JSONL log files |
| `--mode <mode>` | `dev` | Execution mode. `dev` = single-process. `production` = not yet implemented. |

### Examples

```bash
# Start on port 8080 with a custom data directory
ANTHROPIC_API_KEY=sk-ant-... bun start --port 8080 --data-dir ./data

# Restrict to localhost only
bun start --hostname 127.0.0.1

# Enable API key auth
BAARA_API_KEY=my-secret bun start
```

---

## Data Directory Layout

```
~/.baara/                   (or --data-dir)
├── baara.db                SQLite database
└── logs/
    ├── exec-uuid-1.jsonl   JSONL log file per execution
    └── exec-uuid-2.jsonl
```

JSONL log files are created by `LogWriter` during execution and are retained
after the execution completes.  The `GET /api/executions/:id/logs` endpoint
reads from these files.

---

## Rate Limiting

BAARA Next applies in-memory per-IP rate limiting on mutation endpoints:

| Route group | Limit |
|-------------|-------|
| Task submit/run, execution retry/cancel, chat | 10 requests per minute |
| MCP endpoint (`/mcp/*`) | 300 requests per minute |

Limits reset per 60-second window.  Exceeding the limit returns HTTP 429.

To disable rate limiting (not recommended in production), modify
`RATE_LIMIT_MAX` in `packages/server/src/app.ts`.

---

## Security Headers

All responses include:

```
Content-Security-Policy: default-src 'self'; ...
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
```

CORS is restricted to `http://localhost:3000` and `http://127.0.0.1:3000` by
default.  To add origins, pass `allowedOrigins` to `createApp()`.
```

---

### Task 9: Write `docs/contributing.md`

**Files:**
- Create: `docs/contributing.md`

- [ ] **Step 1: Write `docs/contributing.md`**

```markdown
# Contributing

## Prerequisites

- **Bun 1.3+** — install from https://bun.sh
- **Node.js 20+** — for tools that haven't yet fully migrated to Bun
- **Git**
- An `ANTHROPIC_API_KEY` for running tests that invoke the Claude API

---

## Dev Setup

```bash
git clone https://github.com/fakoli/baara-next.git
cd baara-next
bun install
ANTHROPIC_API_KEY=sk-ant-... bun start
```

The server starts at `http://localhost:3000`.

---

## Running Tests

```bash
# Type-check all 10 packages
bun run typecheck

# Run unit tests across all packages
bun run test

# Run smoke tests (requires a running server or boots one in-process)
bun run test:smoke

# Run smoke tests with shell execution enabled
BAARA_SHELL_ENABLED=true bun run test:smoke
```

To run tests for a single package:

```bash
cd packages/orchestrator
bun test
```

---

## Package Overview

| Package | Entry point | Primary exports |
|---------|------------|-----------------|
| `core` | `src/types.ts` + `src/interfaces/` | Types, interfaces, error classes |
| `store` | `src/index.ts` | `createStore()`, `IStore` implementation |
| `orchestrator` | `src/index.ts` | `OrchestratorService`, `TaskManager` |
| `agent` | `src/index.ts` | `AgentService` |
| `executor` | `src/index.ts` | `SandboxRegistry`, `MessageBus`, `CheckpointService`, `LogWriter`, sandboxes |
| `transport` | `src/index.ts` | `createTransport()`, `DevTransport`, `HttpTransport` |
| `server` | `src/index.ts` | `createServer()`, `createApp()`, route factories |
| `mcp` | `src/index.ts` | `createBaaraMcpServer()`, `runStdioMcpServer()`, `createMcpHttpApp()` |
| `cli` | `src/index.ts` | Commander program, all sub-commands |
| `web` | `src/main.tsx` | React 18 app (Vite build) |

---

## Code Style

- **TypeScript strict mode** everywhere. `noImplicitAny`, `strictNullChecks`,
  `noUncheckedIndexedAccess` all enabled.
- **No ORM** — raw SQL via `bun:sqlite`.  Queries live in `packages/store/src/`.
- **No global singletons** — all dependencies are passed explicitly via
  constructor arguments or factory function parameters.
- **No `any` in public APIs** — use `unknown` and narrow at call sites.
- **No `process.exit()` outside CLI entry points** — throw or return errors.
- **Hono** for all HTTP routing.
- **Commander** for all CLI parsing.
- **Bun test runner** for all tests (`import { describe, it, expect } from "bun:test"`).

---

## PR Guidelines

1. **One concern per PR.** Bug fix or feature, not both.
2. **All existing tests pass** (`bun run typecheck && bun run test`).
3. **New tests for new behaviour** — add to the relevant package `src/__tests__/`
   directory or `tests/smoke/` for integration-level scenarios.
4. **No new dependencies without discussion** — Bun is the runtime; the goal is
   minimal external dependencies.
5. **Update docs** if you change a public API, add a new MCP tool, or change
   configuration options.

---

## Commit Message Style

```
type(scope): short summary

longer body if needed

Co-Authored-By: ...
```

Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`.

Scope: package name (`core`, `server`, `mcp`, etc.) or `smoke` for test changes.
```

---

### Task 10: Update `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md`

Replace the entire contents of `CLAUDE.md` with the following, which reflects
the full Phases 2-5 state of the codebase:

- [ ] **Step 1: Write updated `CLAUDE.md`**

```markdown
# BAARA Next

"baara" means "work" in Mandinka.

## Runtime and Language

100% TypeScript on Bun runtime. No Go, no Rust, no native addons.

## Architecture

Three cooperating components:

| Component | Responsibility |
|-----------|---------------|
| Orchestrator | Queue management, retry scheduling, health monitoring, cron execution, HITL coordination |
| Agent | Polling loop that dequeues assigned executions and dispatches them to runtimes/sandboxes |
| Executor | Sandbox isolation layer (Native, Wasm/Extism, Docker stub), MessageBus, CheckpointService, LogWriter |

In dev mode all three run in a single process.  The DevTransport connects
them via in-process function calls.

## Monorepo Packages (10)

| Package | Scope |
|---------|-------|
| `core` | Shared types, interfaces (`IStore`, `IOrchestratorService`, `ISandbox`), error classes |
| `store` | Persistence layer (SQLite via `bun:sqlite`). Owns all migrations and query methods. |
| `orchestrator` | `OrchestratorService` — queue manager, scheduler, health monitor, retry logic, HITL |
| `agent` | `AgentService` — runtime polling loop, execution dispatch |
| `executor` | `SandboxRegistry`, `NativeSandbox`, `WasmSandbox`, `DockerSandbox`, `MessageBus`, `CheckpointService`, `LogWriter` |
| `transport` | `DevTransport` (in-process) and `HttpTransport` (network) |
| `server` | Hono HTTP API, WebSocket broadcast, rate limiting, API key auth |
| `mcp` | 27-tool MCP server — HTTP transport (`/mcp`) + stdio transport (`baara mcp-server`) |
| `cli` | Commander CLI — `start`, `tasks`, `executions`, `queues`, `chat`, `mcp-server`, `admin` |
| `web` | React 18 / Vite / Tailwind chat-centric frontend |

## Execution Model

Tasks are templates.  Executions are stateful attempts to run a task.

**11 execution states:**
`created → queued → assigned → running → waiting_for_input`
Terminal: `completed | failed | timed_out | cancelled`
Recovery: `retry_scheduled → queued (new attempt) → ... → dead_lettered`

**Sandbox types (`SandboxType`):**
- `native` — no isolation, runs agent in host process (always available)
- `wasm` — Extism WebAssembly isolation (available when `@extism/extism` installed)
- `docker` — container isolation (stub, always unavailable)

**Execution modes (`ExecutionMode`):**
- `direct` — `POST /api/tasks/:id/run` — bypasses queue, blocks until completion
- `queued` — `POST /api/tasks/:id/submit` — enqueued, processed by agent polling loop

## Key Interfaces

```typescript
// packages/core/src/interfaces/sandbox.ts
interface ISandbox {
  start(config: SandboxStartConfig): Promise<SandboxInstance>;
  stop(instance: SandboxInstance): Promise<void>;
  isAvailable(): Promise<boolean>;
}

// packages/core/src/types.ts
type SandboxConfig =
  | { type: "native" }
  | { type: "wasm"; maxMemoryMb?: number; maxCpuPercent?: number; networkEnabled?: boolean }
  | { type: "docker"; image?: string; networkEnabled?: boolean; volumeMounts?: string[] };
```

## MCP Server (27 tools)

| Group | Count | Tools |
|-------|-------|-------|
| Tasks | 6 | `list_tasks`, `get_task`, `create_task`, `update_task`, `delete_task`, `toggle_task` |
| Executions | 9 | `run_task`, `submit_task`, `list_executions`, `get_execution`, `get_execution_events`, `cancel_execution`, `retry_execution`, `get_system_status`, `get_execution_logs` |
| Queues | 4 | `list_queues`, `get_queue_info`, `dlq_list`, `dlq_retry` |
| HITL | 2 | `list_pending_input`, `provide_input` |
| Templates | 2 | `list_templates`, `create_task_from_template` |
| Projects | 2 | `list_projects`, `set_active_project` |
| Claude Code | 2 | `discover_plugins`, `run_skill` |

## HTTP API Endpoints

```
/api/health             GET
/api/system/status      GET
/api/tasks              GET POST
/api/tasks/:id          GET PUT DELETE
/api/tasks/:id/toggle   POST
/api/tasks/:id/run      POST
/api/tasks/:id/submit   POST
/api/executions         GET
/api/executions/pending-input  GET
/api/executions/:id     GET
/api/executions/:id/events     GET
/api/executions/:id/logs       GET
/api/executions/:id/cancel     POST
/api/executions/:id/retry      POST
/api/executions/:id/input      POST
/api/queues             GET
/api/queues/:name       GET
/api/chat               POST  (SSE stream)
/api/chat/sessions      GET
/api/chat/sessions/:id  GET
/api/chat/sessions/:id/rename  PUT
/mcp                    POST  (JSON-RPC 2.0)
/internal/...           (agent transport — production mode only)
```

## Chat SSE Events

Events are JSON objects with a `type` field:
`system` | `text` | `text_delta` | `tool_use` | `tool_result` | `result` | `error` | `done`

## Durability

- **MessageBus** — persists commands in `task_messages` table; re-delivers on restart
- **CheckpointService** — writes `Checkpoint` row after each agent turn; `buildRecoveryPrompt()` re-constructs context on resume

## Commands

```sh
bun start                   # Run CLI entry point directly via Bun
bun run typecheck            # Type-check all 10 packages (via turbo)
bun run test                 # Run all package tests
bun run test:smoke           # Run end-to-end smoke tests
turbo build                  # Build all packages in dependency order
turbo dev                    # Start all packages in watch/dev mode
turbo clean                  # Remove all build artifacts
```

## Key Conventions

- **TypeScript:** strict mode everywhere; `tsconfig.base.json` is the shared base config.
- **Database:** SQLite only, accessed via `bun:sqlite`. No ORM.
- **HTTP:** Hono for all HTTP servers and routers.
- **CLI:** Commander for all command-line interfaces.
- **Modules:** `moduleResolution: bundler` — use `bun` import semantics throughout.
- **Package layout:** each package under `packages/` extends `../../tsconfig.base.json` and outputs to `dist/`.
- **Tests:** `bun:test` everywhere. Smoke tests in `tests/smoke/` boot real in-process servers.
- **No process.exit()** outside CLI entry points.
- **No global singletons** — all deps are passed via constructor/factory arguments.
```

---

### Verification

- [ ] All markdown files are valid and render correctly on GitHub (no broken
  links to files that don't exist yet).
- [ ] `docs/api-reference.md` endpoint list matches the routes mounted in
  `packages/server/src/app.ts`.
- [ ] The 27-tool count in every doc matches the sum in `packages/mcp/src/server.ts`
  (6 + 9 + 4 + 2 + 2 + 2 + 2 = 27).
- [ ] `CLAUDE.md` command table includes `test:smoke`.

# Plan A: Core Types + ISandbox Interface + SandboxRegistry

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan.

**Goal:** Replace the multi-runtime model with a single-engine + pluggable-sandbox architecture by updating the core type system, creating the ISandbox interface hierarchy, and replacing RuntimeRegistry with SandboxRegistry.

**Spec reference:** Sub-Spec A of `docs/superpowers/specs/2026-04-04-phase5-sandbox-durability-design.md`

**Architecture:** `ExecutionType` is removed. `SandboxType = "native" | "wasm" | "docker"` replaces it. `SandboxConfig` is a discriminated union with per-sandbox settings. `AgentConfig` becomes purely Claude Code SDK settings. `ISandbox` / `SandboxInstance` replace `IRuntime`. `SandboxRegistry` replaces `RuntimeRegistry`.

**Key invariant:** The Claude Code SDK `query()` call is the only execution engine. What changes between tasks is the sandbox isolation layer wrapping the agent.

---

### Task 1: Update `packages/core/src/types.ts`

**Files:**
- Modify: `packages/core/src/types.ts`

Replace `ExecutionType` with `SandboxType`, add `SandboxConfig` discriminated union, update `AgentConfig` to be purely Claude Code SDK settings, update `Task` to use `sandboxType` + `sandboxConfig`, add `Checkpoint` and `ConversationMessage` types, add `SandboxEvent` and `InboundCommand` discriminated unions.

- [ ] **Step 1: Write failing typecheck test**

```typescript
// packages/core/src/__tests__/types-phase5.test.ts
import { describe, it, expect } from "bun:test";
import type {
  SandboxType,
  SandboxConfig,
  AgentConfig,
  Task,
  Checkpoint,
  ConversationMessage,
  SandboxEvent,
  InboundCommand,
} from "../types.ts";

describe("Phase 5 types", () => {
  it("SandboxType is a union of native | wasm | docker", () => {
    const t: SandboxType = "native";
    expect(["native", "wasm", "docker"]).toContain(t);
  });

  it("SandboxConfig discriminated union narrows correctly", () => {
    const cfg: SandboxConfig = { type: "wasm", maxMemoryMb: 256 };
    if (cfg.type === "wasm") {
      expect(cfg.maxMemoryMb).toBe(256);
    }
  });

  it("Task uses sandboxType and sandboxConfig", () => {
    const task = {} as Task;
    // TypeScript will error if these fields don't exist
    const _st: SandboxType = task.sandboxType;
    const _sc: SandboxConfig = task.sandboxConfig;
    expect(true).toBe(true);
  });

  it("Checkpoint has required fields", () => {
    const cp = {} as Checkpoint;
    const _id: string = cp.id;
    const _execId: string = cp.executionId;
    const _turns: number = cp.turnCount;
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 2: Run test** (expected: FAIL — SandboxType, SandboxConfig, Checkpoint not exported)

```bash
cd packages/core && bun test src/__tests__/types-phase5.test.ts
# Expected: Type errors — SandboxType, SandboxConfig, Checkpoint not found
```

- [ ] **Step 3: Write implementation**

Replace the content of `packages/core/src/types.ts` with the following (preserving all existing types not listed as changed, only modifying/adding the ones specified):

Remove from the file:
- `export type ExecutionType = "cloud_code" | "wasm" | "wasm_edge" | "shell";`
- `export type RuntimeCapability = ...` (retained for now — used by orchestrator interface; will be removed in a later cleanup task after IOrchestratorService is updated)

Add/replace in `packages/core/src/types.ts`:

```typescript
// ---------------------------------------------------------------------------
// Sandbox type system (replaces ExecutionType)
// ---------------------------------------------------------------------------

/** The isolation layer wrapping the Claude Code SDK agent. */
export type SandboxType = "native" | "wasm" | "docker";

/**
 * Per-sandbox isolation configuration stored as a JSON blob on Task.
 * Discriminated by `type` to allow strongly-typed per-sandbox settings.
 */
export type SandboxConfig =
  | { type: "native" }
  | {
      type: "wasm";
      /** Allow outbound network access (to Claude API). Default: true. */
      networkEnabled?: boolean;
      /** Wasm memory ceiling in MB. Default: 512. */
      maxMemoryMb?: number;
      /** CPU utilisation cap as a percentage (0–100). Default: 80. */
      maxCpuPercent?: number;
      /** Ports exposed from the sandbox. */
      ports?: number[];
    }
  | {
      type: "docker";
      /** Container image. Default: "baara-next/sandbox:latest". */
      image?: string;
      /** Allow outbound network access. Default: true. */
      networkEnabled?: boolean;
      /** Ports exposed from the container. */
      ports?: number[];
      /** Host paths to bind-mount into the container. */
      volumeMounts?: string[];
    };
```

Replace the existing `AgentConfig` interface with:

```typescript
// ---------------------------------------------------------------------------
// AgentConfig — Claude Code SDK settings only
// ---------------------------------------------------------------------------

/** Per-server MCP configuration forwarded to the Agent SDK. */
export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

/**
 * Configuration for the Claude Code SDK agent.
 * All fields optional — absent values use SDK defaults.
 * Stored as a JSON blob on Task.
 */
export interface AgentConfig {
  /** Claude model identifier. Default: "claude-sonnet-4-20250514". */
  model?: string;
  /** Tool names the agent is permitted to invoke. */
  allowedTools?: string[];
  /** Maximum agent turns (soft limit). */
  maxTurns?: number;
  /** Spending cap for the execution in USD. */
  budgetUsd?: number;
  /** Claude permission mode string. Default: "default". */
  permissionMode?: string;
  /** Additional system prompt text prepended to the base prompt. */
  systemPrompt?: string;
  /** Named MCP server configs, serialised as JSON in the DB. */
  mcpServers?: Record<string, McpServerConfig>;
}
```

Replace the existing `Task` interface with:

```typescript
// ---------------------------------------------------------------------------
// Task
// ---------------------------------------------------------------------------

/**
 * A persisted task definition. Tasks are templates for executions; they are
 * not themselves stateful — all runtime state lives on `Execution`.
 */
export interface Task {
  id: string;
  name: string;
  description: string;
  prompt: string;
  /** Optional cron expression for scheduled recurring execution. */
  cronExpression?: string;
  /** Maximum wall-clock time allowed per execution attempt in milliseconds. */
  timeoutMs: number;
  /** The sandbox isolation layer to use. */
  sandboxType: SandboxType;
  /** Per-sandbox isolation settings (JSON blob in SQLite). */
  sandboxConfig: SandboxConfig;
  /** Claude Code SDK settings (JSON blob in SQLite). */
  agentConfig: AgentConfig;
  priority: Priority;
  targetQueue: string;
  maxRetries: number;
  executionMode: ExecutionMode;
  enabled: boolean;
  /** Optional grouping; null means the task belongs to no project. */
  projectId?: string | null;
  createdAt: string;
  updatedAt: string;
}
```

Update `CreateTaskInput` and `UpdateTaskInput` to replace `executionType` with `sandboxType` + `sandboxConfig`:

```typescript
export interface CreateTaskInput {
  name: string;
  description?: string;
  prompt: string;
  cronExpression?: string | null;
  timeoutMs?: number;
  sandboxType?: SandboxType;
  sandboxConfig?: SandboxConfig;
  agentConfig?: AgentConfig;
  priority?: Priority;
  targetQueue?: string;
  maxRetries?: number;
  executionMode?: ExecutionMode;
  enabled?: boolean;
  projectId?: string | null;
}

export interface UpdateTaskInput {
  name?: string;
  description?: string;
  prompt?: string;
  cronExpression?: string | null;
  timeoutMs?: number;
  sandboxType?: SandboxType;
  sandboxConfig?: SandboxConfig;
  agentConfig?: AgentConfig;
  priority?: Priority;
  targetQueue?: string;
  maxRetries?: number;
  executionMode?: ExecutionMode;
  enabled?: boolean;
  projectId?: string | null;
}
```

Add at the bottom of `packages/core/src/types.ts`:

```typescript
// ---------------------------------------------------------------------------
// Checkpoint and ConversationMessage
// ---------------------------------------------------------------------------

/**
 * A content block in a conversation message (mirrors Claude API structure).
 */
export interface ContentBlock {
  type: "text" | "tool_use" | "tool_result";
  [key: string]: unknown;
}

/**
 * A single message in a conversation history.
 */
export interface ConversationMessage {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

/**
 * A conversation-level checkpoint. Written periodically by the sandbox to
 * `task_messages` so execution can resume after a crash.
 */
export interface Checkpoint {
  id: string;
  executionId: string;
  turnCount: number;
  conversationHistory: ConversationMessage[];
  /** Names of tool calls that were in-flight at checkpoint time. */
  pendingToolCalls: string[];
  /** Opaque SDK session metadata. */
  agentState: Record<string, unknown>;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// SandboxEvent — real-time event stream from a running sandbox
// ---------------------------------------------------------------------------

/**
 * Events emitted by a running SandboxInstance.
 * Consumed by the orchestrator WebSocket broadcaster and JSONL log writer.
 */
export type SandboxEvent =
  | { type: "log"; level: "info" | "warn" | "error" | "debug"; message: string; timestamp: string }
  | { type: "text_delta"; delta: string }
  | { type: "tool_use"; name: string; input: unknown }
  | { type: "tool_result"; name: string; output: unknown; isError: boolean }
  | { type: "hitl_request"; prompt: string; options?: string[] }
  | { type: "checkpoint"; checkpoint: Checkpoint }
  | { type: "turn_complete"; turnCount: number; inputTokens: number; outputTokens: number };

// ---------------------------------------------------------------------------
// InboundCommand — commands sent to a running execution
// ---------------------------------------------------------------------------

/**
 * Commands delivered to a running execution via the SQLite message queue.
 * Includes HITL responses, additional prompts, and pause/resume signals.
 */
export type InboundCommand =
  | { type: "command"; prompt: string }
  | { type: "hitl_response"; response: string }
  | { type: "pause" }
  | { type: "resume" };
```

- [ ] **Step 4: Run test** (expected: PASS)

```bash
cd packages/core && bun test src/__tests__/types-phase5.test.ts
# Expected: all 4 tests pass
```

- [ ] **Step 5: Run full typecheck**

```bash
cd packages/core && bun run typecheck
# Expected: 0 errors
```

---

### Task 2: Create `packages/core/src/interfaces/sandbox.ts`

**Files:**
- Create: `packages/core/src/interfaces/sandbox.ts`
- Modify: `packages/core/src/interfaces/index.ts`

Define `ISandbox`, `SandboxInstance`, `SandboxStartConfig`, and `SandboxExecuteParams`. These replace `IRuntime` as the contract between the orchestrator and execution backends.

- [ ] **Step 1: Write failing typecheck test**

```typescript
// packages/core/src/__tests__/sandbox-interface.test.ts
import { describe, it, expect } from "bun:test";
import type { ISandbox, SandboxInstance, SandboxStartConfig, SandboxExecuteParams } from "../interfaces/sandbox.ts";

describe("ISandbox interface shape", () => {
  it("ISandbox has required members", () => {
    const s = {} as ISandbox;
    const _name: string = s.name;
    const _desc: string = s.description;
    expect(true).toBe(true);
  });

  it("SandboxInstance has execute, sendCommand, events, cancel", () => {
    const inst = {} as SandboxInstance;
    const _id: string = inst.id;
    const _type: string = inst.sandboxType;
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 2: Run test** (expected: FAIL — sandbox.ts not found)

```bash
cd packages/core && bun test src/__tests__/sandbox-interface.test.ts
# Expected: error: Cannot find module '../interfaces/sandbox.ts'
```

- [ ] **Step 3: Write implementation**

`packages/core/src/interfaces/sandbox.ts`:

```typescript
// @baara-next/core — ISandbox interface and supporting types

import type {
  AgentConfig,
  Checkpoint,
  InboundCommand,
  SandboxConfig,
  SandboxEvent,
  SandboxType,
} from "../types.ts";

// ---------------------------------------------------------------------------
// SandboxStartConfig
// ---------------------------------------------------------------------------

/**
 * Parameters passed to ISandbox.start() to initialise a new sandbox instance.
 */
export interface SandboxStartConfig {
  /** The execution ID this instance will serve. */
  executionId: string;
  /** Isolation-level configuration (memory, network, etc.). */
  sandboxConfig: SandboxConfig;
  /** Claude Code SDK settings for the agent inside this sandbox. */
  agentConfig: AgentConfig;
  /** Writable directory the sandbox may use for scratch files, sessions, logs. */
  dataDir: string;
}

// ---------------------------------------------------------------------------
// SandboxExecuteParams
// ---------------------------------------------------------------------------

/**
 * Parameters passed to SandboxInstance.execute() to run the agent.
 */
export interface SandboxExecuteParams {
  executionId: string;
  /** The initial user prompt for this execution. */
  prompt: string;
  /** Tool names the agent is allowed to invoke (subset of AgentConfig.allowedTools). */
  tools: string[];
  /** Claude Code SDK settings resolved at runtime. */
  agentConfig: AgentConfig;
  /** If provided, the agent resumes from this checkpoint context. */
  checkpoint?: Checkpoint;
  /** Additional environment variables injected into the execution context. */
  environment?: Record<string, string>;
  /** Hard wall-clock deadline in milliseconds. */
  timeout: number;
}

// ---------------------------------------------------------------------------
// SandboxInstance
// ---------------------------------------------------------------------------

/**
 * A running sandbox instance bound to a single execution.
 *
 * Created by ISandbox.start(). The caller calls execute() once, then
 * stop() on the parent ISandbox when done.
 */
export interface SandboxInstance {
  /** Unique identifier for this instance (typically the executionId). */
  readonly id: string;
  /** Which sandbox type this instance belongs to. */
  readonly sandboxType: SandboxType;

  /**
   * Run the Claude Code SDK agent inside this sandbox to completion.
   *
   * Returns a terminal result. Never throws for agent-level failures —
   * those are returned as { status: "failed", error: "..." }.
   */
  execute(params: SandboxExecuteParams): Promise<SandboxExecuteResult>;

  /**
   * Deliver an inbound command to the running agent.
   *
   * Commands are queued durably in task_messages; the sandbox polls
   * and consumes them during execution.
   */
  sendCommand(command: InboundCommand): Promise<void>;

  /**
   * Real-time event stream emitted by the sandbox.
   *
   * Callers iterate this with `for await (const event of instance.events)`.
   * The stream ends when execute() resolves.
   */
  readonly events: AsyncIterable<SandboxEvent>;

  /**
   * Request cancellation of the running execution.
   *
   * Returns immediately; the sandbox must eventually resolve execute()
   * with { status: "cancelled" }.
   */
  cancel(): Promise<void>;
}

// ---------------------------------------------------------------------------
// SandboxExecuteResult
// ---------------------------------------------------------------------------

/**
 * Terminal result returned by SandboxInstance.execute().
 */
export interface SandboxExecuteResult {
  status: "completed" | "failed" | "timed_out" | "cancelled";
  output?: string;
  error?: string;
  inputTokens?: number;
  outputTokens?: number;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// ISandbox
// ---------------------------------------------------------------------------

/**
 * A pluggable sandbox backend. Three implementations ship with Phase 5:
 *   - NativeSandbox  — no isolation, runs agent in host process
 *   - WasmSandbox    — Extism WebAssembly isolation
 *   - DockerSandbox  — container isolation (stub; isAvailable returns false)
 *
 * Sandboxes are stateless with respect to individual executions.
 * All mutable execution state lives in the store.
 */
export interface ISandbox {
  /** Machine-readable identifier matching SandboxType. */
  readonly name: SandboxType;
  /** Human-readable description for logs and health endpoints. */
  readonly description: string;

  /**
   * Prepare a sandbox instance ready to execute one task.
   *
   * For NativeSandbox: no-op, returns immediately.
   * For WasmSandbox: initialises the Extism plugin with resource limits.
   * For DockerSandbox: would pull the image and start a container (not yet implemented).
   */
  start(config: SandboxStartConfig): Promise<SandboxInstance>;

  /**
   * Tear down a sandbox instance and release all resources.
   *
   * Called after execute() resolves. Idempotent — safe to call on an
   * already-stopped instance.
   */
  stop(instance: SandboxInstance): Promise<void>;

  /**
   * Return true if this sandbox type is available on the current system.
   *
   * NativeSandbox: always true.
   * WasmSandbox: true if @extism/extism is importable.
   * DockerSandbox: false (not yet implemented).
   */
  isAvailable(): Promise<boolean>;
}
```

Update `packages/core/src/interfaces/index.ts` to export the new sandbox types:

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
```

- [ ] **Step 4: Run test** (expected: PASS)

```bash
cd packages/core && bun test src/__tests__/sandbox-interface.test.ts
# Expected: 2 tests pass
```

- [ ] **Step 5: Run full typecheck**

```bash
cd packages/core && bun run typecheck
# Expected: 0 errors
```

---

### Task 3: Create `packages/executor/src/sandbox-registry.ts`

**Files:**
- Create: `packages/executor/src/sandbox-registry.ts`

`SandboxRegistry` follows the same Map-based pattern as `RuntimeRegistry` but operates on `ISandbox` instances. `getForTask` matches by `task.sandboxType`. `getAvailable()` filters by `ISandbox.isAvailable()`.

- [ ] **Step 1: Write failing test**

```typescript
// packages/executor/src/__tests__/sandbox-registry.test.ts
import { describe, it, expect } from "bun:test";
import { SandboxRegistry } from "../sandbox-registry.ts";
import type { ISandbox, SandboxInstance, SandboxStartConfig } from "@baara-next/core";
import type { Task } from "@baara-next/core";

const makeFakeSandbox = (name: "native" | "wasm" | "docker", available = true): ISandbox => ({
  name,
  description: `Fake ${name} sandbox`,
  isAvailable: async () => available,
  start: async (_config: SandboxStartConfig): Promise<SandboxInstance> => {
    throw new Error("not needed");
  },
  stop: async (_instance: SandboxInstance): Promise<void> => {},
});

describe("SandboxRegistry", () => {
  it("registers and retrieves a sandbox by name", () => {
    const registry = new SandboxRegistry();
    const native = makeFakeSandbox("native");
    registry.register(native);
    expect(registry.get("native")).toBe(native);
  });

  it("getForTask returns the sandbox matching task.sandboxType", () => {
    const registry = new SandboxRegistry();
    const native = makeFakeSandbox("native");
    registry.register(native);
    const task = { sandboxType: "native" } as Task;
    expect(registry.getForTask(task)).toBe(native);
  });

  it("getForTask throws when sandboxType is not registered", () => {
    const registry = new SandboxRegistry();
    const task = { sandboxType: "docker" } as Task;
    expect(() => registry.getForTask(task)).toThrow(/No sandbox registered/);
  });

  it("getAvailable filters to only available sandboxes", async () => {
    const registry = new SandboxRegistry();
    registry.register(makeFakeSandbox("native", true));
    registry.register(makeFakeSandbox("docker", false));
    const available = await registry.getAvailable();
    expect(available.map((s) => s.name)).toEqual(["native"]);
  });
});
```

- [ ] **Step 2: Run test** (expected: FAIL — sandbox-registry.ts not found)

```bash
cd packages/executor && bun test src/__tests__/sandbox-registry.test.ts
# Expected: error: Cannot find module '../sandbox-registry.ts'
```

- [ ] **Step 3: Write implementation**

`packages/executor/src/sandbox-registry.ts`:

```typescript
// @baara-next/executor — SandboxRegistry
//
// Central map of named sandbox implementations. The orchestrator queries this
// registry to find the correct sandbox for a given task, and to advertise
// which sandbox types are currently available on the host.

import type { ISandbox, Task } from "@baara-next/core";

/**
 * Maintains a sandboxType → ISandbox map and answers availability queries.
 *
 * Populated at startup with three hardcoded implementations:
 *   NativeSandbox   — always available
 *   WasmSandbox     — available if @extism/extism is importable
 *   DockerSandbox   — stub (isAvailable returns false)
 */
export class SandboxRegistry {
  private readonly sandboxes = new Map<string, ISandbox>();

  /**
   * Register a sandbox under its `.name`.
   *
   * If a sandbox with the same name is already registered it is silently
   * replaced — this allows hot-reloading in development.
   */
  register(sandbox: ISandbox): void {
    this.sandboxes.set(sandbox.name, sandbox);
  }

  /**
   * Return the sandbox registered under `name`, or `undefined` if absent.
   */
  get(name: string): ISandbox | undefined {
    return this.sandboxes.get(name);
  }

  /**
   * Return the sandbox that handles `task.sandboxType`.
   *
   * @throws {Error} if no sandbox is registered for the task's sandbox type.
   */
  getForTask(task: Task): ISandbox {
    const sandbox = this.sandboxes.get(task.sandboxType);
    if (!sandbox) {
      throw new Error(
        `No sandbox registered for sandboxType "${task.sandboxType}". ` +
          `Registered sandboxes: [${[...this.sandboxes.keys()].join(", ")}]`
      );
    }
    return sandbox;
  }

  /**
   * Return all registered sandboxes that report isAvailable() = true.
   *
   * Calls isAvailable() on each sandbox in parallel.
   */
  async getAvailable(): Promise<ISandbox[]> {
    const all = Array.from(this.sandboxes.values());
    const results = await Promise.all(
      all.map(async (s) => ({ sandbox: s, available: await s.isAvailable() }))
    );
    return results.filter((r) => r.available).map((r) => r.sandbox);
  }

  /** Return all registered sandboxes regardless of availability. */
  getAll(): ISandbox[] {
    return Array.from(this.sandboxes.values());
  }
}
```

- [ ] **Step 4: Run test** (expected: PASS)

```bash
cd packages/executor && bun test src/__tests__/sandbox-registry.test.ts
# Expected: 4 tests pass
```

---

### Task 4: Update `packages/executor/src/index.ts`

**Files:**
- Modify: `packages/executor/src/index.ts`

Export `SandboxRegistry` and `createDefaultSandboxRegistry`. Keep the old runtime exports temporarily so the build doesn't break while downstream consumers are updated in Task 5.

- [ ] **Step 1: Write failing typecheck test**

```typescript
// packages/executor/src/__tests__/index-exports.test.ts
import { describe, it, expect } from "bun:test";

describe("executor barrel exports", () => {
  it("exports SandboxRegistry", async () => {
    const mod = await import("../index.ts");
    expect(typeof mod.SandboxRegistry).toBe("function");
  });

  it("exports createDefaultSandboxRegistry", async () => {
    const mod = await import("../index.ts");
    expect(typeof mod.createDefaultSandboxRegistry).toBe("function");
  });
});
```

- [ ] **Step 2: Run test** (expected: FAIL — SandboxRegistry not exported)

```bash
cd packages/executor && bun test src/__tests__/index-exports.test.ts
# Expected: undefined is not a function
```

- [ ] **Step 3: Write implementation**

Replace `packages/executor/src/index.ts` with:

```typescript
// @baara-next/executor — Public API barrel

// Phase 5: Sandbox architecture
export { SandboxRegistry } from "./sandbox-registry.ts";
export { NativeSandbox } from "./sandboxes/native.ts";
export { WasmSandbox } from "./sandboxes/wasm.ts";
export { DockerSandbox } from "./sandboxes/docker.ts";

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

Also create the three sandbox implementation stubs (these will be fleshed out in Phase 5 Sub-Specs D and E):

`packages/executor/src/sandboxes/native.ts`:

```typescript
// @baara-next/executor/sandboxes — NativeSandbox
//
// Runs the Claude Code SDK agent directly in the host process.
// No isolation boundary. Fastest option; suitable for trusted tasks.

import type {
  ISandbox,
  SandboxInstance,
  SandboxStartConfig,
  SandboxExecuteParams,
  SandboxExecuteResult,
  SandboxEvent,
  InboundCommand,
} from "@baara-next/core";

class NativeSandboxInstance implements SandboxInstance {
  readonly id: string;
  readonly sandboxType = "native" as const;
  private _cancelled = false;
  private _eventQueue: SandboxEvent[] = [];

  constructor(config: SandboxStartConfig) {
    this.id = config.executionId;
  }

  async execute(params: SandboxExecuteParams): Promise<SandboxExecuteResult> {
    const start = Date.now();
    // TODO: Call Claude Code SDK query() here in Phase 5 Sub-Spec D
    // For now, return a stub result so the type system is satisfied.
    if (this._cancelled) {
      return { status: "cancelled", durationMs: Date.now() - start };
    }
    return {
      status: "completed",
      output: `[NativeSandbox stub] Would execute: ${params.prompt.slice(0, 80)}`,
      durationMs: Date.now() - start,
    };
  }

  async sendCommand(command: InboundCommand): Promise<void> {
    if (command.type === "pause" || command.type === "resume") {
      // TODO: wire to agent pause/resume in Phase 5
    }
  }

  get events(): AsyncIterable<SandboxEvent> {
    return {
      [Symbol.asyncIterator]: async function* (this: NativeSandboxInstance) {
        // Events will be pushed here as the SDK emits them
        for (const event of this._eventQueue) {
          yield event;
        }
      }.bind(this),
    };
  }

  async cancel(): Promise<void> {
    this._cancelled = true;
  }
}

export class NativeSandbox implements ISandbox {
  readonly name = "native" as const;
  readonly description = "Direct execution in the host process (no isolation)";

  constructor(private readonly dataDir: string) {}

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async start(config: SandboxStartConfig): Promise<SandboxInstance> {
    return new NativeSandboxInstance(config);
  }

  async stop(instance: SandboxInstance): Promise<void> {
    await instance.cancel();
  }
}
```

`packages/executor/src/sandboxes/wasm.ts`:

```typescript
// @baara-next/executor/sandboxes — WasmSandbox
//
// Extism WebAssembly sandbox. Provides memory, CPU, and network isolation.
// The Claude Code SDK runs in the host process; Extism mediates all I/O
// through host functions that enforce sandbox constraints.
//
// Implementation is a stub — full Extism integration in Phase 5 Sub-Spec D.

import type {
  ISandbox,
  SandboxInstance,
  SandboxStartConfig,
  SandboxExecuteParams,
  SandboxExecuteResult,
  SandboxEvent,
  InboundCommand,
} from "@baara-next/core";

class WasmSandboxInstance implements SandboxInstance {
  readonly id: string;
  readonly sandboxType = "wasm" as const;

  constructor(config: SandboxStartConfig) {
    this.id = config.executionId;
  }

  async execute(_params: SandboxExecuteParams): Promise<SandboxExecuteResult> {
    throw new Error(
      "WasmSandbox.execute() is not yet implemented — coming in Phase 5 Sub-Spec D"
    );
  }

  async sendCommand(_command: InboundCommand): Promise<void> {
    throw new Error("WasmSandbox.sendCommand() not yet implemented");
  }

  get events(): AsyncIterable<SandboxEvent> {
    return {
      [Symbol.asyncIterator]: async function* () {
        // Yields nothing until Extism integration is implemented
      },
    };
  }

  async cancel(): Promise<void> {
    // No-op in stub
  }
}

export class WasmSandbox implements ISandbox {
  readonly name = "wasm" as const;
  readonly description = "Extism WebAssembly sandbox with configurable isolation";

  constructor(private readonly _dataDir: string) {}

  async isAvailable(): Promise<boolean> {
    try {
      await import("@extism/extism");
      return true;
    } catch {
      return false;
    }
  }

  async start(config: SandboxStartConfig): Promise<SandboxInstance> {
    const available = await this.isAvailable();
    if (!available) {
      throw new Error(
        "WasmSandbox is not available: @extism/extism is not installed. " +
          "Run: bun add @extism/extism"
      );
    }
    return new WasmSandboxInstance(config);
  }

  async stop(_instance: SandboxInstance): Promise<void> {
    // TODO: dispose the Extism plugin in Sub-Spec D
  }
}
```

`packages/executor/src/sandboxes/docker.ts`:

```typescript
// @baara-next/executor/sandboxes — DockerSandbox
//
// Container isolation sandbox. Not yet implemented — isAvailable() always
// returns false so it is never selected for real tasks.
// Scaffolded here so the registry and type system are complete.

import type {
  ISandbox,
  SandboxInstance,
  SandboxStartConfig,
} from "@baara-next/core";

export class DockerSandbox implements ISandbox {
  readonly name = "docker" as const;
  readonly description = "Docker container sandbox (not yet implemented)";

  async isAvailable(): Promise<boolean> {
    return false;
  }

  async start(_config: SandboxStartConfig): Promise<SandboxInstance> {
    throw new Error(
      "DockerSandbox is not yet implemented. " +
        "Create a task with sandboxType: 'native' or 'wasm' instead."
    );
  }

  async stop(_instance: SandboxInstance): Promise<void> {
    // No-op
  }
}
```

- [ ] **Step 4: Run test** (expected: PASS)

```bash
cd packages/executor && bun test src/__tests__/index-exports.test.ts
# Expected: 2 tests pass
```

- [ ] **Step 5: Run full typecheck**

```bash
cd packages/executor && bun run typecheck
# Expected: 0 errors
```

---

### Task 5: Update downstream consumers

**Files:**
- Modify: `packages/orchestrator/src/orchestrator-service.ts`
- Modify: `packages/cli/src/commands/start.ts`
- Modify: `packages/cli/src/commands/tasks.ts`

Update each file to use `SandboxRegistry` instead of `RuntimeRegistry`, `sandboxType` instead of `executionType`, and `createDefaultSandboxRegistry` instead of `createDefaultRegistry`.

- [ ] **Step 1: Update `packages/orchestrator/src/orchestrator-service.ts`**

Change the `RuntimeRegistry` import to `SandboxRegistry`:

```typescript
// Before:
import type { RuntimeRegistry } from "@baara-next/executor";

// After:
import type { SandboxRegistry } from "@baara-next/executor";
```

Update the constructor parameter type:

```typescript
// Before:
constructor(
  private readonly store: IStore,
  private readonly runtimeRegistry?: RuntimeRegistry,
)

// After:
constructor(
  private readonly store: IStore,
  private readonly sandboxRegistry?: SandboxRegistry,
)
```

Update `runDirect()` to use `sandboxRegistry` and call the new sandbox API:

```typescript
async runDirect(taskId: string): Promise<Execution> {
  if (!this.sandboxRegistry) {
    throw new Error(
      "runDirect requires a SandboxRegistry — pass one as the second argument to OrchestratorService"
    );
  }

  const task = this._requireTask(taskId);
  const sandbox = this.sandboxRegistry.getForTask(task);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  // Transition through the required path: created → queued → assigned → running.
  this.store.createExecution(id, task.id, task.targetQueue, task.priority, now);
  emitExecutionCreated(this.store, id, task.id, task.targetQueue, 1);

  this.store.updateExecutionStatus(id, "queued");
  emitExecutionQueued(this.store, id, task.targetQueue);

  this.store.updateExecutionStatus(id, "assigned");
  emitExecutionAssigned(this.store, id, "direct");

  this.store.updateExecutionStatus(id, "running", {
    startedAt: new Date().toISOString(),
  });
  emitExecutionStarted(this.store, id);

  // Start the sandbox instance and execute.
  let result: import("@baara-next/core").ExecuteResult;
  const sandboxInstance = await sandbox.start({
    executionId: id,
    sandboxConfig: task.sandboxConfig,
    agentConfig: task.agentConfig,
    dataDir: "", // dataDir is not available here; will be wired in Phase 5 full integration
  });

  try {
    const sandboxResult = await sandboxInstance.execute({
      executionId: id,
      prompt: task.prompt,
      tools: task.agentConfig.allowedTools ?? [],
      agentConfig: task.agentConfig,
      timeout: task.timeoutMs,
    });
    result = {
      status: sandboxResult.status,
      output: sandboxResult.output,
      error: sandboxResult.error,
      inputTokens: sandboxResult.inputTokens,
      outputTokens: sandboxResult.outputTokens,
      durationMs: sandboxResult.durationMs,
    };
  } catch (err) {
    result = {
      status: "failed",
      error: String(err),
      durationMs: Date.now() - new Date(now).getTime(),
    };
  } finally {
    await sandbox.stop(sandboxInstance);
  }

  await this.handleExecutionComplete(id, result);
  return this.store.getExecution(id)!;
}
```

Also remove the unused `RuntimeCapability` import from the `matchTask` signature area (it stays in `IOrchestratorService` for now but the concrete class doesn't need to import it directly if unused).

- [ ] **Step 2: Update `packages/cli/src/commands/start.ts`**

Replace `createDefaultRegistry` import with `createDefaultSandboxRegistry` and update the wiring:

```typescript
// Before:
import { createDefaultRegistry } from "@baara-next/executor";

// After:
import { createDefaultSandboxRegistry } from "@baara-next/executor";
```

Update the registry creation:

```typescript
// Before:
const registry = await createDefaultRegistry({ dataDir });
const orchestrator = new OrchestratorService(store, registry);
const agent = new AgentService(transport, registry.getAll());

// After:
const registry = await createDefaultSandboxRegistry(dataDir);
const orchestrator = new OrchestratorService(store, registry);
// AgentService receives sandbox implementations for the agent worker pool
const agent = new AgentService(transport, registry.getAll());
```

- [ ] **Step 3: Update `packages/cli/src/commands/tasks.ts`**

Replace `executionType` references with `sandboxType` in the display and create commands:

In `tasks list` — the table row builder:
```typescript
// Before:
t.executionType,

// After:
t.sandboxType,
```

In `tasks create` — the option flag and description:
```typescript
// Before:
.option(
  "--type <type>",
  "Execution type: cloud_code | shell | wasm | wasm_edge",
  "cloud_code"
)

// After:
.option(
  "--sandbox <type>",
  "Sandbox type: native | wasm | docker",
  "native"
)
```

In `tasks create` — the `CreateTaskInput` construction:
```typescript
// Before:
const input: CreateTaskInput = {
  ...
  executionType: opts.type as CreateTaskInput["executionType"],
  ...
};

// After:
const input: CreateTaskInput = {
  ...
  sandboxType: opts.sandbox as CreateTaskInput["sandboxType"],
  sandboxConfig: { type: (opts.sandbox as "native" | "wasm" | "docker") ?? "native" },
  ...
};
```

Update the options type annotation:
```typescript
// Before (in create action opts type):
type: string;

// After:
sandbox: string;
```

- [ ] **Step 4: Run full typecheck on affected packages**

```bash
cd packages/orchestrator && bun run typecheck
cd packages/cli && bun run typecheck
cd packages/executor && bun run typecheck
# Expected: 0 errors in each
```

- [ ] **Step 5: Run the test suite**

```bash
bun run turbo test --filter=@baara-next/core --filter=@baara-next/executor --filter=@baara-next/orchestrator
# Expected: all tests pass
```

---

### Task 6: Update `packages/store` for the new Task schema

**Files:**
- Modify: `packages/store/src/sqlite-store.ts`

The migration (adding `sandbox_type`, `sandbox_config` columns, renaming `execution_type`) is handled in Plan B, Task 2. This task updates the `rowToTask` mapper and the `createTask` / `updateTask` methods to use the new field names after migration 3 runs.

> Note: This task must be executed AFTER Plan B Task 2 (migration 3) is in place. The migration renames `execution_type` to `sandbox_type` and adds `sandbox_config`. The store methods here consume those new columns.

- [ ] **Step 1: Update `rowToTask` in `sqlite-store.ts`**

```typescript
// Before:
function rowToTask(row: unknown): Task {
  const r = row as Record<string, unknown>;
  return {
    ...
    executionType: r["execution_type"] as Task["executionType"],
    agentConfig: r["agent_config"]
      ? JSON.parse(r["agent_config"] as string)
      : null,
    ...
  };
}

// After:
function rowToTask(row: unknown): Task {
  const r = row as Record<string, unknown>;
  return {
    id: r["id"] as string,
    name: r["name"] as string,
    description: r["description"] as string,
    prompt: r["prompt"] as string,
    cronExpression: (r["cron_expression"] as string | null) ?? undefined,
    timeoutMs: r["timeout_ms"] as number,
    sandboxType: (r["sandbox_type"] as Task["sandboxType"]) ?? "native",
    sandboxConfig: r["sandbox_config"]
      ? (JSON.parse(r["sandbox_config"] as string) as Task["sandboxConfig"])
      : { type: "native" },
    agentConfig: r["agent_config"]
      ? (JSON.parse(r["agent_config"] as string) as Task["agentConfig"])
      : {},
    priority: r["priority"] as Priority,
    targetQueue: r["target_queue"] as string,
    maxRetries: r["max_retries"] as number,
    executionMode: r["execution_mode"] as Task["executionMode"],
    enabled: (r["enabled"] as number) === 1,
    projectId: (r["project_id"] as string | null) ?? null,
    createdAt: r["created_at"] as string,
    updatedAt: r["updated_at"] as string,
  };
}
```

- [ ] **Step 2: Update `createTask` method**

```typescript
// Before INSERT:
`INSERT INTO tasks (
  id, name, description, prompt, cron_expression,
  timeout_ms, execution_type, agent_config, priority, target_queue,
  max_retries, execution_mode, enabled, project_id
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
[
  id,
  input.name,
  input.description ?? "",
  input.prompt,
  input.cronExpression ?? null,
  input.timeoutMs ?? 300000,
  input.executionType ?? "cloud_code",
  input.agentConfig ? JSON.stringify(input.agentConfig) : null,
  ...
]

// After INSERT (uses migration-3 column names):
`INSERT INTO tasks (
  id, name, description, prompt, cron_expression,
  timeout_ms, sandbox_type, sandbox_config, agent_config, priority, target_queue,
  max_retries, execution_mode, enabled, project_id
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
[
  id,
  input.name,
  input.description ?? "",
  input.prompt,
  input.cronExpression ?? null,
  input.timeoutMs ?? 300000,
  input.sandboxType ?? "native",
  input.sandboxConfig ? JSON.stringify(input.sandboxConfig) : JSON.stringify({ type: "native" }),
  input.agentConfig ? JSON.stringify(input.agentConfig) : JSON.stringify({}),
  input.priority ?? 1,
  input.targetQueue ?? "transfer",
  input.maxRetries ?? 0,
  input.executionMode ?? "queued",
  input.enabled !== false ? 1 : 0,
  input.projectId ?? null,
]
```

- [ ] **Step 3: Update `updateTask` method**

Replace the `executionType` branch with `sandboxType` and add `sandboxConfig`:

```typescript
// Before:
if (input.executionType !== undefined) { fields.push("execution_type = ?"); values.push(input.executionType); }
if (input.agentConfig !== undefined) {
  fields.push("agent_config = ?");
  values.push(input.agentConfig ? JSON.stringify(input.agentConfig) : null);
}

// After:
if (input.sandboxType !== undefined) { fields.push("sandbox_type = ?"); values.push(input.sandboxType); }
if (input.sandboxConfig !== undefined) {
  fields.push("sandbox_config = ?");
  values.push(JSON.stringify(input.sandboxConfig));
}
if (input.agentConfig !== undefined) {
  fields.push("agent_config = ?");
  values.push(JSON.stringify(input.agentConfig));
}
```

- [ ] **Step 4: Run store typecheck and tests**

```bash
cd packages/store && bun run typecheck
bun run turbo test --filter=@baara-next/store
# Expected: 0 typecheck errors, all tests pass
```

---

### Verification

- [ ] **End-to-end: native sandbox task runs via CLI**

```bash
# Start the server
bun start start --mode dev &

# Create a task with sandboxType: native
bun start tasks create \
  --name "phase5-test" \
  --prompt "Echo the current date" \
  --sandbox native

# Run it directly
bun start tasks run phase5-test --json
# Expected: execution with status: "completed"
```

- [ ] **SandboxRegistry.getAvailable() filters correctly**

```bash
bun -e "
import { createDefaultSandboxRegistry } from './packages/executor/src/index.ts';
const reg = await createDefaultSandboxRegistry('/tmp');
const avail = await reg.getAvailable();
console.log('Available sandboxes:', avail.map(s => s.name));
// Expected: ['native'] if @extism/extism not installed, ['native', 'wasm'] if it is
"
```

- [ ] **Docker sandbox returns clean error**

```typescript
// Confirm DockerSandbox.isAvailable() === false and start() throws
const docker = new DockerSandbox();
console.log(await docker.isAvailable()); // false
// Calling start() throws: "DockerSandbox is not yet implemented"
```

- [ ] **Full monorepo typecheck**

```bash
bun run turbo typecheck
# Expected: 0 errors across all packages
```

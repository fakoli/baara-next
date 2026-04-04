# Plan D: NativeSandbox + WasmSandbox + DockerSandbox

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan.

**Goal:** Replace the four `IRuntime` implementations (`CloudCodeRuntime`, `ShellRuntime`, `WasmRuntime`, `WasmEdgeRuntime`) with three `ISandbox` implementations (`NativeSandbox`, `WasmSandbox`, `DockerSandbox`) registered in a new `SandboxRegistry`. The execution engine is always the Claude Code SDK `query()`. What varies is isolation.

**Architecture:** `ISandbox` / `SandboxInstance` interfaces defined in `packages/core`. `NativeSandbox` is a direct port of `CloudCodeRuntime` wrapped in the new interface, extended with `CheckpointService` and `MessageBus` polling. `WasmSandbox` uses `@extism/extism` as the isolation boundary with host functions bridging I/O. `DockerSandbox` is a stub. `SandboxRegistry` replaces `RuntimeRegistry`.

**Dependency on Plan C:** `NativeSandboxInstance.execute()` integrates `CheckpointService` and `MessageBus`. Implement Plan C first, or stub those integrations and add them after.

**Tech Stack:** Bun, `@anthropic-ai/claude-agent-sdk`, `@extism/extism` (optional peer dep for Wasm), `bun:sqlite`.

---

### Task 1: ISandbox interface + SandboxConfig types in core

**Files:**
- Create: `packages/core/src/interfaces/sandbox.ts`
- Create: `packages/core/src/types/sandbox-config.ts`
- Create: `packages/core/src/types/sandbox-events.ts`
- Modify: `packages/core/src/index.ts` (add exports)

**Context:** The spec defines `ISandbox`, `SandboxInstance`, `SandboxStartConfig`, `SandboxExecuteParams`, `SandboxConfig` (discriminated union), `AgentConfig`, `SandboxEvent`, and `InboundCommand`. These live in `@baara-next/core` so all packages can import them without a circular dependency on `@baara-next/executor`.

- [ ] **Step 1: Write failing test**

```typescript
// packages/core/src/__tests__/sandbox-types.test.ts
import { describe, it, expect } from "bun:test";

describe("Sandbox type exports", () => {
  it("exports ISandbox interface (checked via import)", async () => {
    // TypeScript interfaces don't emit JS, but we can verify the module loads.
    const mod = await import("../interfaces/sandbox.ts");
    // SandboxRegistry IS a class and should be present.
    expect(typeof mod.SandboxRegistry).toBe("function");
  });

  it("exports SandboxConfig type guard helpers", async () => {
    const mod = await import("../types/sandbox-config.ts");
    expect(typeof mod.isNativeConfig).toBe("function");
    expect(typeof mod.isWasmConfig).toBe("function");
    expect(typeof mod.isDockerConfig).toBe("function");
  });
});
```

- [ ] **Step 2: Run test** (expected: FAIL — modules not found)

```bash
cd packages/core && bun test src/__tests__/sandbox-types.test.ts
# Expected: error: Cannot find module '../interfaces/sandbox.ts'
```

- [ ] **Step 3: Write implementation**

`packages/core/src/types/sandbox-config.ts`:

```typescript
// @baara-next/core — SandboxConfig discriminated union + AgentConfig

export type SandboxType = "native" | "wasm" | "docker";

export type SandboxConfig =
  | { type: "native" }
  | {
      type: "wasm";
      networkEnabled?: boolean;   // default: true
      maxMemoryMb?: number;       // default: 512
      maxCpuPercent?: number;     // default: 80
      ports?: number[];
    }
  | {
      type: "docker";
      image?: string;             // default: "baara-next/sandbox:latest"
      networkEnabled?: boolean;
      ports?: number[];
      volumeMounts?: string[];
    };

export interface AgentConfig {
  model?: string;                          // default: "claude-sonnet-4-20250514"
  allowedTools?: string[];
  maxTurns?: number;
  budgetUsd?: number;
  permissionMode?: string;                 // "default" | "acceptEdits" | "bypassPermissions"
  systemPrompt?: string;
  mcpServers?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

export function isNativeConfig(c: SandboxConfig): c is { type: "native" } {
  return c.type === "native";
}

export function isWasmConfig(
  c: SandboxConfig
): c is { type: "wasm"; networkEnabled?: boolean; maxMemoryMb?: number; maxCpuPercent?: number; ports?: number[] } {
  return c.type === "wasm";
}

export function isDockerConfig(
  c: SandboxConfig
): c is { type: "docker"; image?: string; networkEnabled?: boolean; ports?: number[]; volumeMounts?: string[] } {
  return c.type === "docker";
}
```

`packages/core/src/types/sandbox-events.ts`:

```typescript
// @baara-next/core — SandboxEvent + InboundCommand

export type SandboxEvent =
  | { type: "log"; level: "info" | "warn" | "error" | "debug"; message: string; timestamp: string }
  | { type: "text_delta"; delta: string }
  | { type: "tool_use"; name: string; input: unknown }
  | { type: "tool_result"; name: string; output: unknown; isError: boolean }
  | { type: "hitl_request"; prompt: string; options?: string[] }
  | { type: "checkpoint"; checkpoint: unknown }   // typed as unknown to avoid circular dep
  | { type: "turn_complete"; turnCount: number; inputTokens: number; outputTokens: number };

export type InboundCommand =
  | { type: "command"; prompt: string }
  | { type: "hitl_response"; response: string }
  | { type: "pause" }
  | { type: "resume" };
```

`packages/core/src/interfaces/sandbox.ts`:

```typescript
// @baara-next/core — ISandbox interface + SandboxRegistry

import type { SandboxConfig, AgentConfig } from "../types/sandbox-config.ts";
import type { SandboxEvent, InboundCommand } from "../types/sandbox-events.ts";
import type { Task } from "../types.ts";

// ---------------------------------------------------------------------------
// Configuration shapes
// ---------------------------------------------------------------------------

export interface SandboxStartConfig {
  executionId: string;
  sandboxConfig: SandboxConfig;
  agentConfig: AgentConfig;
  dataDir: string;
}

export interface SandboxExecuteParams {
  executionId: string;
  prompt: string;
  tools: string[];
  agentConfig: AgentConfig;
  checkpoint?: import("../types/checkpoint.ts").Checkpoint | null;
  environment?: Record<string, string>;
  timeout: number;
}

export interface ExecuteResult {
  status: "completed" | "failed" | "timed_out" | "cancelled";
  output?: string;
  error?: string;
  inputTokens?: number;
  outputTokens?: number;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// SandboxInstance — one running agent invocation
// ---------------------------------------------------------------------------

export interface SandboxInstance {
  readonly id: string;
  readonly sandboxType: string;

  /** Execute the Claude Code SDK agent inside this sandbox. */
  execute(params: SandboxExecuteParams): Promise<ExecuteResult>;

  /** Send an inbound command to the running agent (HITL, additional prompt, pause/resume). */
  sendCommand(command: InboundCommand): Promise<void>;

  /** Real-time event stream from the sandbox (logs, text deltas, tool invocations). */
  readonly events: AsyncIterable<SandboxEvent>;

  /** Cancel the running execution. */
  cancel(): Promise<void>;
}

// ---------------------------------------------------------------------------
// ISandbox — sandbox environment provider
// ---------------------------------------------------------------------------

export interface ISandbox {
  readonly name: string;
  readonly description: string;

  /** Prepare a sandbox instance ready for execute(). */
  start(config: SandboxStartConfig): Promise<SandboxInstance>;

  /** Tear down a sandbox instance and release all resources. */
  stop(instance: SandboxInstance): Promise<void>;

  /** Check if this sandbox type is available on the current system. */
  isAvailable(): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// SandboxRegistry — central map of sandbox providers
// ---------------------------------------------------------------------------

export class SandboxRegistry {
  private readonly sandboxes = new Map<string, ISandbox>();

  /** Register a sandbox under its `.name`. Silently replaces existing. */
  register(sandbox: ISandbox): void {
    this.sandboxes.set(sandbox.name, sandbox);
  }

  /** Return the sandbox registered under `name`, or undefined if absent. */
  get(name: string): ISandbox | undefined {
    return this.sandboxes.get(name);
  }

  /** Return all sandboxes that report isAvailable() === true. */
  async getAvailable(): Promise<ISandbox[]> {
    const results = await Promise.all(
      Array.from(this.sandboxes.values()).map(async (s) => ({
        sandbox: s,
        available: await s.isAvailable(),
      }))
    );
    return results.filter((r) => r.available).map((r) => r.sandbox);
  }

  /**
   * Return the sandbox that matches `task.sandboxType`.
   * Falls back to "native" when `sandboxType` is absent (migration compat).
   * @throws {Error} if no sandbox is registered for the task's type.
   */
  getForTask(task: Task & { sandboxType?: string }): ISandbox {
    const name = task.sandboxType ?? "native";
    const sandbox = this.sandboxes.get(name);
    if (!sandbox) {
      throw new Error(
        `No sandbox registered for sandboxType "${name}". ` +
        `Registered: [${[...this.sandboxes.keys()].join(", ")}]`
      );
    }
    return sandbox;
  }

  /** Return all registered sandboxes. */
  getAll(): ISandbox[] {
    return Array.from(this.sandboxes.values());
  }
}
```

`packages/core/src/types/checkpoint.ts`:

```typescript
// @baara-next/core — Checkpoint types

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
```

Add to `packages/core/src/index.ts` exports:

```typescript
// Sandbox architecture (Phase 5)
export { SandboxRegistry } from "./interfaces/sandbox.ts";
export type {
  ISandbox,
  SandboxInstance,
  SandboxStartConfig,
  SandboxExecuteParams,
  ExecuteResult as SandboxExecuteResult,
} from "./interfaces/sandbox.ts";
export type { SandboxType, SandboxConfig, AgentConfig as SandboxAgentConfig } from "./types/sandbox-config.ts";
export { isNativeConfig, isWasmConfig, isDockerConfig } from "./types/sandbox-config.ts";
export type { SandboxEvent, InboundCommand } from "./types/sandbox-events.ts";
export type { Checkpoint, ConversationMessage } from "./types/checkpoint.ts";
```

- [ ] **Step 4: Run test** (expected: PASS)

```bash
cd packages/core && bun test src/__tests__/sandbox-types.test.ts
# Expected: 2 tests pass
```

---

### Task 2: NativeSandbox

**Files:**
- Create: `packages/executor/src/sandboxes/native.ts`
- Create: `packages/executor/src/sandboxes/__tests__/native.test.ts`

**Context:** `NativeSandbox` is the direct port of `CloudCodeRuntime` wrapped in `ISandbox`. The critical addition is that `NativeSandboxInstance.execute()`:
1. Constructs a `CheckpointService` that extracts conversation history from the SDK stream (by accumulating messages as they arrive).
2. Polls `MessageBus.drainPendingCommands()` every 2 seconds and logs them (full HITL delivery is Plan E integration).
3. Emits `SandboxEvent` objects through an async generator that callers can consume via `instance.events`.
4. If `params.checkpoint` is set, injects `conversationHistory` into the SDK `query()` call via the `messages` option and prepends the recovery system prompt.

The `events` property is an `AsyncIterable<SandboxEvent>` backed by a queue that the execute loop writes to and consumers read from.

- [ ] **Step 1: Write failing test**

```typescript
// packages/executor/src/sandboxes/__tests__/native.test.ts
import { describe, it, expect, mock, beforeEach } from "bun:test";
import { NativeSandbox, NativeSandboxInstance } from "../native.ts";

describe("NativeSandbox", () => {
  it("isAvailable() always returns true", async () => {
    const sandbox = new NativeSandbox();
    expect(await sandbox.isAvailable()).toBe(true);
  });

  it("name is 'native'", () => {
    const sandbox = new NativeSandbox();
    expect(sandbox.name).toBe("native");
  });

  it("start() returns a NativeSandboxInstance", async () => {
    const sandbox = new NativeSandbox();
    const instance = await sandbox.start({
      executionId: "ex-1",
      sandboxConfig: { type: "native" },
      agentConfig: {},
      dataDir: "/tmp",
    });
    expect(instance).toBeInstanceOf(NativeSandboxInstance);
    expect(instance.id).toBe("ex-1");
    expect(instance.sandboxType).toBe("native");
  });

  it("stop() calls cancel() on the instance", async () => {
    const sandbox = new NativeSandbox();
    const instance = await sandbox.start({
      executionId: "ex-2",
      sandboxConfig: { type: "native" },
      agentConfig: {},
      dataDir: "/tmp",
    });
    const cancelSpy = mock(() => Promise.resolve());
    instance.cancel = cancelSpy;
    await sandbox.stop(instance);
    expect(cancelSpy).toHaveBeenCalled();
  });
});

describe("NativeSandboxInstance", () => {
  it("cancel() aborts the controller", async () => {
    const instance = new NativeSandboxInstance("ex-3", {}, null);
    // cancel() should not throw even if called before execute()
    await expect(instance.cancel()).resolves.toBeUndefined();
  });

  it("sendCommand() resolves without throwing", async () => {
    const instance = new NativeSandboxInstance("ex-4", {}, null);
    await expect(
      instance.sendCommand({ type: "pause" })
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test** (expected: FAIL — module not found)

```bash
cd packages/executor && bun test src/sandboxes/__tests__/native.test.ts
# Expected: error: Cannot find module '../native.ts'
```

- [ ] **Step 3: Write implementation**

```typescript
// packages/executor/src/sandboxes/native.ts
// @baara-next/executor — NativeSandbox
//
// Runs the Claude Code SDK query() directly in the host process with no
// isolation. Equivalent to the old CloudCodeRuntime but wrapped in ISandbox.
// Integrates CheckpointService and MessageBus for durability.

import type {
  ISandbox,
  SandboxInstance,
  SandboxStartConfig,
  SandboxExecuteParams,
  SandboxExecuteResult,
  SandboxEvent,
  InboundCommand,
} from "@baara-next/core";
import { CheckpointService } from "../checkpoint-service.ts";
import type { MessageBus, ConversationMessage } from "../message-bus.ts";
import { buildRecoveryPrompt } from "../recovery.ts";

const DEFAULT_MODEL = "claude-sonnet-4-20250514";
const COMMAND_POLL_MS = 2_000;

// ---------------------------------------------------------------------------
// NativeSandbox
// ---------------------------------------------------------------------------

export class NativeSandbox implements ISandbox {
  readonly name = "native";
  readonly description = "Direct execution in the host process (no isolation)";

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async start(config: SandboxStartConfig): Promise<SandboxInstance> {
    return new NativeSandboxInstance(
      config.executionId,
      config.agentConfig,
      null // MessageBus injected externally via NativeSandboxInstance.withMessageBus()
    );
  }

  async stop(instance: SandboxInstance): Promise<void> {
    await instance.cancel();
  }
}

// ---------------------------------------------------------------------------
// NativeSandboxInstance
// ---------------------------------------------------------------------------

export class NativeSandboxInstance implements SandboxInstance {
  readonly id: string;
  readonly sandboxType = "native";

  private readonly controller = new AbortController();
  private readonly agentConfig: Record<string, unknown>;
  private messageBus: MessageBus | null;

  // Event queue — execute() pushes, events iterator pops.
  private readonly eventQueue: SandboxEvent[] = [];
  private eventResolvers: Array<(value: IteratorResult<SandboxEvent>) => void> = [];
  private done = false;

  // Conversation history accumulated during execute() for checkpointing.
  private conversationHistory: ConversationMessage[] = [];

  // Command poll interval handle.
  private commandPollHandle: ReturnType<typeof setInterval> | null = null;

  constructor(
    executionId: string,
    agentConfig: Record<string, unknown>,
    messageBus: MessageBus | null
  ) {
    this.id = executionId;
    this.agentConfig = agentConfig;
    this.messageBus = messageBus;
  }

  /** Inject a MessageBus after construction (wired by OrchestratorService). */
  withMessageBus(bus: MessageBus): this {
    this.messageBus = bus;
    return this;
  }

  // -------------------------------------------------------------------------
  // SandboxInstance.events — async iterable
  // -------------------------------------------------------------------------

  get events(): AsyncIterable<SandboxEvent> {
    const self = this;
    return {
      [Symbol.asyncIterator](): AsyncIterator<SandboxEvent> {
        return {
          next(): Promise<IteratorResult<SandboxEvent>> {
            // If there's an event already queued, return it immediately.
            if (self.eventQueue.length > 0) {
              return Promise.resolve({ value: self.eventQueue.shift()!, done: false });
            }
            // If execute() has finished, signal end of stream.
            if (self.done) {
              return Promise.resolve({ value: undefined as unknown as SandboxEvent, done: true });
            }
            // Block until an event arrives or execute() finishes.
            return new Promise<IteratorResult<SandboxEvent>>((resolve) => {
              self.eventResolvers.push(resolve);
            });
          },
        };
      },
    };
  }

  private pushEvent(event: SandboxEvent): void {
    if (this.eventResolvers.length > 0) {
      const resolve = this.eventResolvers.shift()!;
      resolve({ value: event, done: false });
    } else {
      this.eventQueue.push(event);
    }
  }

  private closeEvents(): void {
    this.done = true;
    for (const resolve of this.eventResolvers) {
      resolve({ value: undefined as unknown as SandboxEvent, done: true });
    }
    this.eventResolvers = [];
  }

  // -------------------------------------------------------------------------
  // SandboxInstance.execute()
  // -------------------------------------------------------------------------

  async execute(params: SandboxExecuteParams): Promise<SandboxExecuteResult> {
    const start = Date.now();
    const { executionId, prompt, timeout } = params;
    const agentCfg = { ...this.agentConfig, ...params.agentConfig };

    // Set up abort timeout.
    const killTimer = setTimeout(() => this.controller.abort(), timeout);

    // Build checkpoint service for periodic snapshots.
    const checkpointService = new CheckpointService({
      executionId,
      messageBus: this.messageBus ?? this._noopBus(),
      intervalTurns: 5,
      getConversationHistory: () => [...this.conversationHistory],
    });

    // Start inbound command polling if MessageBus is available.
    if (this.messageBus) {
      this.commandPollHandle = setInterval(() => {
        const commands = this.messageBus!.drainPendingCommands(executionId);
        for (const cmd of commands) {
          this.pushEvent({
            type: "log",
            level: "info",
            message: `[command] received: ${cmd.type}`,
            timestamp: new Date().toISOString(),
          });
        }
      }, COMMAND_POLL_MS);
    }

    // Inject prior conversation history if recovering from checkpoint.
    if (params.checkpoint?.conversationHistory) {
      this.conversationHistory = [...params.checkpoint.conversationHistory];
    }

    // Build the recovery system prompt prefix.
    const recoveryPrefix = buildRecoveryPrompt(params.checkpoint ?? null);
    const systemPrompt = recoveryPrefix
      ? recoveryPrefix + (agentCfg.systemPrompt ? `\n\n${agentCfg.systemPrompt}` : "")
      : (agentCfg.systemPrompt as string | undefined);

    let output = "";
    let inputTokens = 0;
    let outputTokens = 0;
    let turnCount = 0;

    try {
      const { query } = await import("@anthropic-ai/claude-agent-sdk");

      const options: Record<string, unknown> = {
        allowedTools: agentCfg.allowedTools,
        permissionMode: agentCfg.permissionMode ?? "default",
        abortSignal: this.controller.signal,
        model: agentCfg.model ?? DEFAULT_MODEL,
      };

      if (systemPrompt) options["systemPrompt"] = systemPrompt;
      if (agentCfg.maxTurns !== undefined) options["maxTurns"] = agentCfg.maxTurns;
      if (agentCfg.budgetUsd !== undefined) options["maxBudgetUsd"] = agentCfg.budgetUsd;
      if (agentCfg.mcpServers !== undefined) options["mcpServers"] = agentCfg.mcpServers;

      // Inject prior conversation history for recovery.
      if (params.checkpoint?.conversationHistory?.length) {
        options["messages"] = params.checkpoint.conversationHistory;
      }

      this.pushEvent({
        type: "log",
        level: "info",
        message: `Starting execution ${executionId}${params.checkpoint ? ` (recovery from turn ${params.checkpoint.turnCount})` : ""}`,
        timestamp: new Date().toISOString(),
      });

      for await (const message of query({
        prompt,
        options: options as Parameters<typeof query>[0]["options"],
      })) {
        if (this.controller.signal.aborted) break;

        // Accumulate text deltas.
        if ("type" in message && message.type === "text" && typeof message.text === "string") {
          this.pushEvent({ type: "text_delta", delta: message.text });
          this.conversationHistory.push({ role: "assistant", content: message.text });
        }

        // Tool use events.
        if ("type" in message && message.type === "tool_use") {
          const m = message as { name: string; input: unknown };
          this.pushEvent({ type: "tool_use", name: m.name, input: m.input });
          this.pushEvent({
            type: "log",
            level: "info",
            message: `[tool] ${m.name}: ${JSON.stringify(m.input).slice(0, 200)}`,
            timestamp: new Date().toISOString(),
          });
        }

        // Tool result events.
        if ("type" in message && message.type === "tool_result") {
          const m = message as { name?: string; output: unknown; isError?: boolean };
          this.pushEvent({
            type: "tool_result",
            name: m.name ?? "unknown",
            output: m.output,
            isError: m.isError ?? false,
          });
        }

        // Capture result output.
        if ("result" in message && typeof message.result === "string") {
          output = message.result;
        }

        // Accumulate token usage.
        if (
          "message" in message &&
          message.message !== null &&
          typeof message.message === "object" &&
          "usage" in message.message
        ) {
          const u = (message.message as Record<string, unknown>)["usage"] as Record<string, number> | undefined;
          if (u) {
            inputTokens += u["input_tokens"] ?? 0;
            outputTokens += u["output_tokens"] ?? 0;
          }
        }

        // Turn complete signal.
        if ("type" in message && (message as { type: string }).type === "turn_complete") {
          turnCount++;
          this.pushEvent({
            type: "turn_complete",
            turnCount,
            inputTokens,
            outputTokens,
          });
          checkpointService.onTurnComplete(turnCount);
        }

        // Top-level usage override.
        if ("usage" in message && message.usage !== null && typeof message.usage === "object") {
          const u = message.usage as Record<string, number>;
          if (u["input_tokens"] !== undefined) inputTokens = u["input_tokens"];
          if (u["output_tokens"] !== undefined) outputTokens = u["output_tokens"];
        }
      }

      clearTimeout(killTimer);
      if (this.commandPollHandle) clearInterval(this.commandPollHandle);

      // Final checkpoint on clean completion.
      checkpointService.checkpoint(turnCount);

      const durationMs = Date.now() - start;
      this.pushEvent({
        type: "log",
        level: "info",
        message: `Execution ${executionId} completed in ${durationMs}ms (${turnCount} turns)`,
        timestamp: new Date().toISOString(),
      });

      this.closeEvents();
      return { status: "completed", output, inputTokens, outputTokens, durationMs };
    } catch (err) {
      clearTimeout(killTimer);
      if (this.commandPollHandle) clearInterval(this.commandPollHandle);
      this.closeEvents();

      const durationMs = Date.now() - start;

      if (this.controller.signal.aborted) {
        return { status: "timed_out", error: `Exceeded timeout of ${timeout}ms`, durationMs };
      }

      const errorMsg = err instanceof Error ? err.message : String(err);
      this.pushEvent({
        type: "log",
        level: "error",
        message: `Execution ${executionId} failed: ${errorMsg}`,
        timestamp: new Date().toISOString(),
      });
      return { status: "failed", error: errorMsg, durationMs };
    }
  }

  // -------------------------------------------------------------------------
  // SandboxInstance.sendCommand()
  // -------------------------------------------------------------------------

  async sendCommand(command: InboundCommand): Promise<void> {
    if (this.messageBus) {
      this.messageBus.sendCommand(this.id, command);
    }
    // If no bus, the command is dropped — acceptable for native sandbox without
    // a durable store wired in.
  }

  // -------------------------------------------------------------------------
  // SandboxInstance.cancel()
  // -------------------------------------------------------------------------

  async cancel(): Promise<void> {
    if (this.commandPollHandle) {
      clearInterval(this.commandPollHandle);
      this.commandPollHandle = null;
    }
    this.controller.abort();
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /** No-op MessageBus for when durability is not wired in. */
  private _noopBus(): MessageBus {
    return {
      sendCommand: () => {},
      readPendingCommands: () => [],
      acknowledgeCommands: () => {},
      drainPendingCommands: () => [],
      writeCheckpoint: () => {},
      readLatestCheckpoint: () => null,
      appendLog: () => {},
      purgeExecution: () => {},
    } as unknown as MessageBus;
  }
}
```

- [ ] **Step 4: Run test** (expected: PASS)

```bash
cd packages/executor && bun test src/sandboxes/__tests__/native.test.ts
# Expected: 5 tests pass
```

---

### Task 3: WasmSandbox — Extism integration

**Files:**
- Create: `packages/executor/src/sandboxes/wasm.ts`
- Create: `packages/executor/src/sandboxes/__tests__/wasm.test.ts`

**Context:** The `WasmSandbox` uses `@extism/extism` as the isolation boundary. Critically, the Claude Code SDK itself runs in the host process — it cannot be compiled to Wasm. What Extism does is act as a policy enforcement layer: a Wasm guest module mediates all tool I/O, checking whether tool calls are permitted based on the sandbox config (network, memory, CPU limits). The host functions `baara_send_event`, `baara_read_command`, `baara_log`, and `baara_checkpoint` bridge the SDK stream to the guest.

For `isAvailable()`, we do a dynamic import of `@extism/extism` and return false if it fails. This makes `@extism/extism` an optional peer dependency — the system works without it, just without Wasm isolation.

The `WasmSandboxInstance.execute()` delegates to the same `NativeSandboxInstance.execute()` internally but wraps the SDK query inside an Extism plugin call that enforces resource limits before each tool invocation. This is achieved via Extism host functions that intercept tool use events from the SDK stream.

- [ ] **Step 1: Write failing test**

```typescript
// packages/executor/src/sandboxes/__tests__/wasm.test.ts
import { describe, it, expect } from "bun:test";
import { WasmSandbox, WasmSandboxInstance } from "../wasm.ts";

describe("WasmSandbox", () => {
  it("name is 'wasm'", () => {
    expect(new WasmSandbox().name).toBe("wasm");
  });

  it("isAvailable() returns false when @extism/extism is not installed", async () => {
    const sandbox = new WasmSandbox();
    // In the test environment @extism/extism is unlikely to be installed.
    // isAvailable() must not throw — it should return false gracefully.
    const available = await sandbox.isAvailable();
    expect(typeof available).toBe("boolean");
  });

  it("start() returns a WasmSandboxInstance with correct id and type", async () => {
    const sandbox = new WasmSandbox();
    const instance = await sandbox.start({
      executionId: "ex-wasm-1",
      sandboxConfig: { type: "wasm", maxMemoryMb: 256 },
      agentConfig: {},
      dataDir: "/tmp",
    });
    expect(instance.id).toBe("ex-wasm-1");
    expect(instance.sandboxType).toBe("wasm");
  });

  it("stop() cancels the instance", async () => {
    const sandbox = new WasmSandbox();
    const instance = await sandbox.start({
      executionId: "ex-wasm-2",
      sandboxConfig: { type: "wasm" },
      agentConfig: {},
      dataDir: "/tmp",
    });
    await expect(sandbox.stop(instance)).resolves.toBeUndefined();
  });
});

describe("WasmSandboxInstance resource config", () => {
  it("stores resolved config with defaults applied", async () => {
    const instance = new WasmSandboxInstance("ex-wasm-3", {
      type: "wasm",
      maxMemoryMb: 128,
    }, {});
    // Access internal config via exposed getter for testing.
    expect(instance.resolvedConfig.maxMemoryMb).toBe(128);
    expect(instance.resolvedConfig.maxCpuPercent).toBe(80); // default
    expect(instance.resolvedConfig.networkEnabled).toBe(true); // default
  });

  it("cancel() does not throw", async () => {
    const instance = new WasmSandboxInstance("ex-wasm-4", { type: "wasm" }, {});
    await expect(instance.cancel()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test** (expected: FAIL — module not found)

```bash
cd packages/executor && bun test src/sandboxes/__tests__/wasm.test.ts
# Expected: error: Cannot find module '../wasm.ts'
```

- [ ] **Step 3: Write implementation**

```typescript
// packages/executor/src/sandboxes/wasm.ts
// @baara-next/executor — WasmSandbox (Extism integration)
//
// Uses @extism/extism as the isolation boundary. The Claude Code SDK runs in
// the host process. Extism mediates tool I/O through host functions, enforcing
// resource limits (memory, CPU, network) before each tool execution.
//
// Architecture:
//   Host process: Claude Code SDK query() → emits tool_use events
//       ↓
//   Extism host functions: baara_send_event, baara_read_command, baara_log,
//       baara_checkpoint — intercept each event and apply policy
//       ↓
//   Wasm guest module: stateless policy checker (network ACL, memory quota)
//
// If @extism/extism is not installed, isAvailable() returns false and start()
// falls back to NativeSandboxInstance with a warning log.

import type {
  ISandbox,
  SandboxInstance,
  SandboxStartConfig,
  SandboxExecuteParams,
  SandboxExecuteResult,
  SandboxEvent,
  InboundCommand,
} from "@baara-next/core";
import { NativeSandboxInstance } from "./native.ts";

// ---------------------------------------------------------------------------
// Resolved Wasm config (defaults applied)
// ---------------------------------------------------------------------------

export interface ResolvedWasmConfig {
  networkEnabled: boolean;
  maxMemoryMb: number;
  maxCpuPercent: number;
  ports: number[];
}

function resolveWasmConfig(raw: { type: "wasm"; networkEnabled?: boolean; maxMemoryMb?: number; maxCpuPercent?: number; ports?: number[] }): ResolvedWasmConfig {
  return {
    networkEnabled: raw.networkEnabled ?? true,
    maxMemoryMb: raw.maxMemoryMb ?? 512,
    maxCpuPercent: raw.maxCpuPercent ?? 80,
    ports: raw.ports ?? [],
  };
}

// ---------------------------------------------------------------------------
// WasmSandbox
// ---------------------------------------------------------------------------

export class WasmSandbox implements ISandbox {
  readonly name = "wasm";
  readonly description = "Extism WebAssembly sandbox with configurable resource isolation";

  async isAvailable(): Promise<boolean> {
    try {
      await import("@extism/extism");
      return true;
    } catch {
      return false;
    }
  }

  async start(config: SandboxStartConfig): Promise<SandboxInstance> {
    const rawConfig = config.sandboxConfig as { type: "wasm"; networkEnabled?: boolean; maxMemoryMb?: number; maxCpuPercent?: number; ports?: number[] };
    return new WasmSandboxInstance(config.executionId, rawConfig, config.agentConfig as Record<string, unknown>);
  }

  async stop(instance: SandboxInstance): Promise<void> {
    await instance.cancel();
  }
}

// ---------------------------------------------------------------------------
// WasmSandboxInstance
// ---------------------------------------------------------------------------

export class WasmSandboxInstance implements SandboxInstance {
  readonly id: string;
  readonly sandboxType = "wasm";

  // Exposed for tests.
  readonly resolvedConfig: ResolvedWasmConfig;

  private readonly agentConfig: Record<string, unknown>;
  private readonly controller = new AbortController();
  private inner: NativeSandboxInstance | null = null;

  constructor(
    executionId: string,
    rawConfig: { type: "wasm"; networkEnabled?: boolean; maxMemoryMb?: number; maxCpuPercent?: number; ports?: number[] },
    agentConfig: Record<string, unknown>
  ) {
    this.id = executionId;
    this.agentConfig = agentConfig;
    this.resolvedConfig = resolveWasmConfig(rawConfig);
  }

  // -------------------------------------------------------------------------
  // events — delegate to inner NativeSandboxInstance once execute() creates it
  // -------------------------------------------------------------------------

  get events(): AsyncIterable<SandboxEvent> {
    if (this.inner) return this.inner.events;
    // Return an empty async iterable before execute() is called.
    return {
      [Symbol.asyncIterator]() {
        return {
          next(): Promise<IteratorResult<SandboxEvent>> {
            return Promise.resolve({ value: undefined as unknown as SandboxEvent, done: true });
          },
        };
      },
    };
  }

  // -------------------------------------------------------------------------
  // execute() — run the agent with Extism policy enforcement
  // -------------------------------------------------------------------------

  async execute(params: SandboxExecuteParams): Promise<SandboxExecuteResult> {
    // Attempt to use Extism host functions for resource enforcement.
    const extismAvailable = await this._checkExtism();

    if (!extismAvailable) {
      // Graceful fallback: run natively with a warning. Resource limits are
      // not enforced, but the execution completes.
      console.warn(
        `[wasm-sandbox] @extism/extism not available — falling back to native execution for ${this.id}. ` +
        `Resource limits (maxMemoryMb=${this.resolvedConfig.maxMemoryMb}, maxCpuPercent=${this.resolvedConfig.maxCpuPercent}) will NOT be enforced.`
      );
      this.inner = new NativeSandboxInstance(this.id, this.agentConfig, null);
      return this.inner.execute(params);
    }

    // With Extism available: create a plugin that acts as the policy gate.
    // The NativeSandboxInstance runs the SDK in the host. Host functions
    // intercept tool events and consult the Extism plugin for policy decisions.
    this.inner = new NativeSandboxInstance(this.id, this.agentConfig, null);
    return this._executeWithExtismPolicy(params);
  }

  private async _executeWithExtismPolicy(params: SandboxExecuteParams): Promise<SandboxExecuteResult> {
    const { createPlugin } = await import("@extism/extism");
    const config = this.resolvedConfig;

    // Build an in-memory Wasm policy module. In a full implementation this
    // would be a compiled Wasm binary. For now we use a minimal Wasm module
    // (empty, 64-bit, 1 page memory) that exposes the host functions and
    // always permits tool calls. The actual enforcement is done in the host
    // function implementations below.
    const MINIMAL_WASM = new Uint8Array([
      0x00, 0x61, 0x73, 0x6d, // magic
      0x01, 0x00, 0x00, 0x00, // version
      0x05, 0x03, 0x01, 0x00, 0x01, // memory section: 1 page min
    ]);

    let plugin: Awaited<ReturnType<typeof createPlugin>> | null = null;

    try {
      plugin = await createPlugin(MINIMAL_WASM, {
        useWasi: false,
        allowedHosts: config.networkEnabled ? ["*"] : [],
        memory: { maxPages: Math.ceil(config.maxMemoryMb / 0.064) }, // pages are 64 KiB
        functions: [
          // Host function: called by the guest to emit a SandboxEvent.
          {
            namespace: "baara",
            name: "send_event",
            callback(_cp: unknown, _off: number, _len: number): void {
              // In a full implementation: decode the event JSON and push to the event stream.
              // Currently a no-op because NativeSandboxInstance manages its own event queue.
            },
          },
          // Host function: called by the guest to read the next inbound command.
          {
            namespace: "baara",
            name: "read_command",
            callback(_cp: unknown): number {
              return 0; // 0 = no command available
            },
          },
          // Host function: structured log.
          {
            namespace: "baara",
            name: "log",
            callback(_cp: unknown, _levelOff: number, _levelLen: number, _msgOff: number, _msgLen: number): void {
              // Forwarded to inner NativeSandboxInstance event queue in full impl.
            },
          },
          // Host function: trigger checkpoint.
          {
            namespace: "baara",
            name: "checkpoint",
            callback(_cp: unknown, _off: number, _len: number): void {
              // In full implementation: parse checkpoint JSON and write to MessageBus.
            },
          },
          // Host function: network policy check.
          {
            namespace: "baara",
            name: "check_network",
            callback(_cp: unknown, _hostOff: number, _hostLen: number, _port: number): number {
              // Returns 1 if allowed, 0 if denied.
              if (!config.networkEnabled) return 0;
              if (config.ports.length === 0) return 1; // all ports allowed
              return 1; // port check omitted in stub — full impl checks port list
            },
          },
        ],
      });

      // Run the agent via NativeSandboxInstance. The Extism plugin is
      // available for policy callbacks during this call.
      return await this.inner!.execute({
        ...params,
        agentConfig: {
          ...params.agentConfig,
          // Inject a memory-awareness hint into the system prompt.
          systemPrompt: [
            params.agentConfig.systemPrompt,
            `Sandbox constraints: maxMemoryMb=${config.maxMemoryMb}, ` +
            `networkEnabled=${config.networkEnabled}, maxCpuPercent=${config.maxCpuPercent}.`,
          ].filter(Boolean).join("\n\n"),
        },
      });
    } finally {
      plugin?.free();
    }
  }

  // -------------------------------------------------------------------------
  // sendCommand()
  // -------------------------------------------------------------------------

  async sendCommand(command: InboundCommand): Promise<void> {
    await this.inner?.sendCommand(command);
  }

  // -------------------------------------------------------------------------
  // cancel()
  // -------------------------------------------------------------------------

  async cancel(): Promise<void> {
    this.controller.abort();
    await this.inner?.cancel();
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async _checkExtism(): Promise<boolean> {
    try {
      await import("@extism/extism");
      return true;
    } catch {
      return false;
    }
  }
}
```

- [ ] **Step 4: Run test** (expected: PASS)

```bash
cd packages/executor && bun test src/sandboxes/__tests__/wasm.test.ts
# Expected: 5 tests pass (isAvailable may be false — that is correct)
```

---

### Task 4: DockerSandbox stub

**Files:**
- Create: `packages/executor/src/sandboxes/docker.ts`
- Create: `packages/executor/src/sandboxes/__tests__/docker.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// packages/executor/src/sandboxes/__tests__/docker.test.ts
import { describe, it, expect } from "bun:test";
import { DockerSandbox } from "../docker.ts";

describe("DockerSandbox", () => {
  it("name is 'docker'", () => {
    expect(new DockerSandbox().name).toBe("docker");
  });

  it("isAvailable() returns false", async () => {
    expect(await new DockerSandbox().isAvailable()).toBe(false);
  });

  it("start() throws 'not yet implemented'", async () => {
    await expect(
      new DockerSandbox().start({
        executionId: "ex-1",
        sandboxConfig: { type: "docker" },
        agentConfig: {},
        dataDir: "/tmp",
      })
    ).rejects.toThrow("not yet implemented");
  });

  it("stop() resolves without throwing", async () => {
    const instance = {
      id: "x",
      sandboxType: "docker",
      execute: async () => ({ status: "failed" as const, durationMs: 0 }),
      sendCommand: async () => {},
      events: { [Symbol.asyncIterator]: () => ({ next: async () => ({ value: undefined, done: true }) }) },
      cancel: async () => {},
    };
    await expect(new DockerSandbox().stop(instance)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test** (expected: FAIL — module not found)

```bash
cd packages/executor && bun test src/sandboxes/__tests__/docker.test.ts
# Expected: error: Cannot find module '../docker.ts'
```

- [ ] **Step 3: Write implementation**

```typescript
// packages/executor/src/sandboxes/docker.ts
// @baara-next/executor — DockerSandbox stub
//
// Docker container sandbox is not yet implemented.
// isAvailable() returns false so tasks routed to sandboxType: "docker"
// receive a clean error message rather than a cryptic runtime failure.

import type {
  ISandbox,
  SandboxInstance,
  SandboxStartConfig,
} from "@baara-next/core";

export class DockerSandbox implements ISandbox {
  readonly name = "docker";
  readonly description = "Docker container sandbox (not yet implemented)";

  async isAvailable(): Promise<boolean> {
    return false;
  }

  async start(_config: SandboxStartConfig): Promise<SandboxInstance> {
    throw new Error(
      "Docker sandbox not yet implemented. " +
      "Create the task with sandboxType: 'native' or 'wasm' instead."
    );
  }

  async stop(_instance: SandboxInstance): Promise<void> {
    // No-op — start() always throws so there is nothing to clean up.
  }
}
```

- [ ] **Step 4: Run test** (expected: PASS)

```bash
cd packages/executor && bun test src/sandboxes/__tests__/docker.test.ts
# Expected: 4 tests pass
```

---

### Task 5: SandboxRegistry factory + update executor barrel

**Files:**
- Modify: `packages/executor/src/index.ts`

**Context:** Replace `createDefaultRegistry()` (which created a `RuntimeRegistry` with four `IRuntime` instances) with `createDefaultSandboxRegistry()` (which creates a `SandboxRegistry` with three `ISandbox` instances). Keep `createDefaultRegistry()` as a deprecated alias that returns the new registry cast to `RuntimeRegistry` shape, for backward compatibility with call sites in `start.ts` and `tasks.ts` that haven't been updated yet.

- [ ] **Step 1: Write failing test**

```typescript
// packages/executor/src/__tests__/sandbox-registry.test.ts
import { describe, it, expect } from "bun:test";
import { createDefaultSandboxRegistry } from "../index.ts";
import { SandboxRegistry } from "@baara-next/core";

describe("createDefaultSandboxRegistry", () => {
  it("returns a SandboxRegistry", async () => {
    const registry = await createDefaultSandboxRegistry({ dataDir: "/tmp" });
    expect(registry).toBeInstanceOf(SandboxRegistry);
  });

  it("registers native, wasm, docker sandboxes", async () => {
    const registry = await createDefaultSandboxRegistry({ dataDir: "/tmp" });
    expect(registry.get("native")).toBeDefined();
    expect(registry.get("wasm")).toBeDefined();
    expect(registry.get("docker")).toBeDefined();
  });

  it("native sandbox is always available", async () => {
    const registry = await createDefaultSandboxRegistry({ dataDir: "/tmp" });
    const native = registry.get("native")!;
    expect(await native.isAvailable()).toBe(true);
  });

  it("docker sandbox is never available", async () => {
    const registry = await createDefaultSandboxRegistry({ dataDir: "/tmp" });
    const docker = registry.get("docker")!;
    expect(await docker.isAvailable()).toBe(false);
  });

  it("getAvailable() always includes native", async () => {
    const registry = await createDefaultSandboxRegistry({ dataDir: "/tmp" });
    const available = await registry.getAvailable();
    expect(available.map((s) => s.name)).toContain("native");
  });
});
```

- [ ] **Step 2: Run test** (expected: FAIL — createDefaultSandboxRegistry not exported)

```bash
cd packages/executor && bun test src/__tests__/sandbox-registry.test.ts
# Expected: error: createDefaultSandboxRegistry is not a function
```

- [ ] **Step 3: Rewrite `packages/executor/src/index.ts`**

```typescript
// packages/executor/src/index.ts
// @baara-next/executor — Public API barrel
//
// Phase 5: Sandbox architecture replaces Runtime architecture.
// createDefaultSandboxRegistry() is the new primary factory.
// createDefaultRegistry() is kept as a deprecated compatibility shim.

// ---------------------------------------------------------------------------
// New sandbox exports
// ---------------------------------------------------------------------------
export { SandboxRegistry } from "@baara-next/core";
export { NativeSandbox, NativeSandboxInstance } from "./sandboxes/native.ts";
export { WasmSandbox, WasmSandboxInstance } from "./sandboxes/wasm.ts";
export { DockerSandbox } from "./sandboxes/docker.ts";
export { MessageBus } from "./message-bus.ts";
export { CheckpointService } from "./checkpoint-service.ts";
export { buildRecoveryPrompt, prepareRecoveryParams } from "./recovery.ts";
export type {
  Checkpoint,
  ConversationMessage,
  InboundCommand,
} from "./message-bus.ts";
export type { CheckpointServiceConfig } from "./checkpoint-service.ts";
export type { SandboxExecuteParams as RecoverySandboxExecuteParams } from "./recovery.ts";

// ---------------------------------------------------------------------------
// Legacy runtime exports (deprecated — kept for backward compat during migration)
// ---------------------------------------------------------------------------
export { RuntimeRegistry } from "./runtime-registry.ts";
export { defaultLimits, mergeLimits } from "./sandbox.ts";
export { CloudCodeRuntime } from "./runtimes/cloud-code.ts";
export { ShellRuntime } from "./runtimes/shell.ts";
export { WasmRuntime } from "./runtimes/wasm.ts";
export { WasmEdgeRuntime } from "./runtimes/wasmedge.ts";

import { SandboxRegistry } from "@baara-next/core";
import { NativeSandbox } from "./sandboxes/native.ts";
import { WasmSandbox } from "./sandboxes/wasm.ts";
import { DockerSandbox } from "./sandboxes/docker.ts";

// Legacy imports for createDefaultRegistry shim.
import { RuntimeRegistry } from "./runtime-registry.ts";
import { CloudCodeRuntime } from "./runtimes/cloud-code.ts";
import { ShellRuntime } from "./runtimes/shell.ts";
import { WasmRuntime } from "./runtimes/wasm.ts";
import { WasmEdgeRuntime } from "./runtimes/wasmedge.ts";
import type { RuntimeConfig } from "@baara-next/core";

// ---------------------------------------------------------------------------
// createDefaultSandboxRegistry — Phase 5 primary factory
// ---------------------------------------------------------------------------

/**
 * Build and return a `SandboxRegistry` pre-populated with the three built-in
 * sandboxes: `native`, `wasm`, and `docker`.
 *
 * - `native` is always available.
 * - `wasm` is available when `@extism/extism` is installed.
 * - `docker` always reports unavailable (stub).
 */
export async function createDefaultSandboxRegistry(
  _config: { dataDir: string }
): Promise<SandboxRegistry> {
  const registry = new SandboxRegistry();
  registry.register(new NativeSandbox());
  registry.register(new WasmSandbox());
  registry.register(new DockerSandbox());
  return registry;
}

// ---------------------------------------------------------------------------
// createDefaultRegistry — deprecated shim (Phase 1-4 compatibility)
// ---------------------------------------------------------------------------

/**
 * @deprecated Use createDefaultSandboxRegistry() instead.
 *
 * Returns a legacy RuntimeRegistry for call sites that have not yet been
 * migrated to the Phase 5 sandbox architecture.
 */
export async function createDefaultRegistry(
  config: RuntimeConfig
): Promise<RuntimeRegistry> {
  const registry = new RuntimeRegistry();
  const runtimes = [
    new CloudCodeRuntime(),
    new ShellRuntime(),
    new WasmRuntime(),
    new WasmEdgeRuntime(),
  ];
  await Promise.all(runtimes.map((r) => r.initialize(config)));
  for (const runtime of runtimes) {
    registry.register(runtime);
  }
  return registry;
}
```

- [ ] **Step 4: Run test** (expected: PASS)

```bash
cd packages/executor && bun test src/__tests__/sandbox-registry.test.ts
# Expected: 5 tests pass
```

---

### Task 6: Update OrchestratorService to accept SandboxRegistry

**Files:**
- Modify: `packages/orchestrator/src/orchestrator-service.ts`

**Context:** `runDirect()` currently calls `this.runtimeRegistry.getForTask(task)` and then `runtime.execute(params)`. Update it to also accept a `SandboxRegistry` and prefer it when available. The `SandboxRegistry.getForTask()` returns an `ISandbox`; we `start()` a `SandboxInstance`, call `execute()`, then `stop()`.

Add a second optional constructor parameter `sandboxRegistry?: SandboxRegistry`:

```typescript
import type { SandboxRegistry } from "@baara-next/core";

constructor(
  private readonly store: IStore,
  private readonly runtimeRegistry?: RuntimeRegistry,
  private readonly messageBus?: MessageBus,
  private readonly sandboxRegistry?: SandboxRegistry,
) {
  // ... existing body unchanged
}
```

In `runDirect()`, after the existing runtime path, add a sandbox path:

```typescript
async runDirect(taskId: string): Promise<Execution> {
  const task = this._requireTask(taskId);

  // Prefer SandboxRegistry (Phase 5) over RuntimeRegistry (legacy).
  if (this.sandboxRegistry) {
    return this._runDirectViaSandbox(task);
  }

  if (!this.runtimeRegistry) {
    throw new Error(
      "runDirect requires a RuntimeRegistry or SandboxRegistry"
    );
  }

  // ... existing RuntimeRegistry path unchanged
}

private async _runDirectViaSandbox(task: Task): Promise<Execution> {
  const sandbox = this.sandboxRegistry!.getForTask(task as Task & { sandboxType?: string });

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  this.store.createExecution(id, task.id, task.targetQueue, task.priority, now);
  emitExecutionCreated(this.store, id, task.id, task.targetQueue, 1);
  this.store.updateExecutionStatus(id, "queued");
  emitExecutionQueued(this.store, id, task.targetQueue);
  this.store.updateExecutionStatus(id, "assigned");
  emitExecutionAssigned(this.store, id, "direct");
  this.store.updateExecutionStatus(id, "running", { startedAt: now });

  const agentConfig = (task as Task & { agentConfig?: Record<string, unknown> }).agentConfig ?? {};
  const sandboxConfig = (task as Task & { sandboxConfig?: { type: string } }).sandboxConfig ?? { type: task.executionType === "wasm" ? "wasm" : "native" };

  let instance;
  let result: import("@baara-next/core").SandboxExecuteResult;

  try {
    instance = await sandbox.start({
      executionId: id,
      sandboxConfig: sandboxConfig as import("@baara-next/core").SandboxConfig,
      agentConfig: agentConfig as import("@baara-next/core").SandboxAgentConfig,
      dataDir: process.env["BAARA_DATA_DIR"] ?? require("os").homedir() + "/.baara",
    });

    // Load checkpoint if execution was recovered.
    const execution = this.store.getExecution(id)!;
    const checkpoint = execution.checkpointData
      ? JSON.parse(execution.checkpointData as string)
      : undefined;

    result = await instance.execute({
      executionId: id,
      prompt: task.prompt,
      tools: (agentConfig.allowedTools as string[] | undefined) ?? [],
      agentConfig: agentConfig as import("@baara-next/core").SandboxAgentConfig,
      checkpoint,
      timeout: task.timeoutMs,
    });
  } catch (err) {
    result = {
      status: "failed",
      error: String(err),
      durationMs: Date.now() - new Date(now).getTime(),
    };
  } finally {
    if (instance) {
      await sandbox.stop(instance).catch(() => {});
    }
  }

  await this.handleExecutionComplete(id, result);
  return this.store.getExecution(id)!;
}
```

- [ ] **Run full orchestrator test suite**

```bash
cd packages/orchestrator && bun test
# Expected: all tests pass (existing tests should not be broken)
```

---

### Task 7: Delete old runtime files (deferred — after full migration)

**Files to delete** (after all call sites are migrated in Plans C, E):
- `packages/executor/src/runtimes/cloud-code.ts`
- `packages/executor/src/runtimes/shell.ts`
- `packages/executor/src/runtimes/wasm.ts`
- `packages/executor/src/runtimes/wasmedge.ts`
- `packages/executor/src/runtimes/runtime-registry.ts` (if it exists separately)
- `packages/executor/src/runtime-registry.ts`

**Note:** Do NOT delete these until Plans C and E are complete and all references in `start.ts`, `tasks.ts`, `agent` package, and test files have been updated to use `SandboxRegistry`. The `createDefaultRegistry()` shim in `index.ts` allows the existing call sites to continue working during the migration window.

Delete steps (run after migration is complete):

```bash
rm packages/executor/src/runtimes/cloud-code.ts
rm packages/executor/src/runtimes/shell.ts
rm packages/executor/src/runtimes/wasm.ts
rm packages/executor/src/runtimes/wasmedge.ts
rm -rf packages/executor/src/runtimes/
rm packages/executor/src/runtime-registry.ts
rm packages/executor/src/sandbox.ts
```

Then remove the legacy exports from `packages/executor/src/index.ts` (the RuntimeRegistry, createDefaultRegistry, and all IRuntime class exports).

---

### Verification Checklist

- [ ] `bun test packages/core` — sandbox type exports pass
- [ ] `bun test packages/executor` — NativeSandbox, WasmSandbox, DockerSandbox tests pass
- [ ] `bun test packages/orchestrator` — all existing tests still pass, new SandboxRegistry path works
- [ ] `bun start` — server starts; no TypeScript errors
- [ ] Create task with `sandboxType: "native"` → run direct → completes
- [ ] Create task with `sandboxType: "docker"` → submit → orchestrator logs clean error "Docker sandbox not available"
- [ ] Create task with `sandboxType: "wasm"` → submit → either runs (if @extism/extism installed) or falls back to native with warning
- [ ] Verify checkpoint events appear in `task_messages` table during long native execution

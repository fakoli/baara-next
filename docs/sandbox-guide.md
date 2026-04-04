# Sandbox Guide

BAARA Next runs every agent task through a sandbox — an isolation layer that
wraps the Claude Code SDK `query()` call. Three sandbox types ship in Phase 5:
`native`, `wasm`, and `docker`. All three implement the same `ISandbox` interface
so the orchestrator can swap them per task without touching execution logic.

---

## ISandbox Interface

```typescript
// packages/core/src/interfaces/sandbox.ts

export interface ISandbox {
  /** Machine-readable identifier — matches SandboxType. */
  readonly name: SandboxType;
  /** Human-readable description for logs and health endpoints. */
  readonly description: string;

  /**
   * Prepare a sandbox instance ready to execute one task.
   * NativeSandbox: no-op, returns immediately.
   * WasmSandbox: initialises the Extism plugin with resource limits.
   * DockerSandbox: would pull image and start container (stub, not yet implemented).
   */
  start(config: SandboxStartConfig): Promise<SandboxInstance>;

  /**
   * Tear down a sandbox instance and release all resources.
   * Idempotent — safe to call on an already-stopped instance.
   */
  stop(instance: SandboxInstance): Promise<void>;

  /**
   * Return true if this sandbox type is available on the current system.
   * NativeSandbox: always true.
   * WasmSandbox: true if @extism/extism is importable.
   * DockerSandbox: false (not yet implemented).
   */
  isAvailable(): Promise<boolean>;
}

export interface SandboxStartConfig {
  executionId: string;
  sandboxConfig: SandboxConfig;       // discriminated union per sandbox type
  agentConfig: AgentConfig;           // Claude Code SDK settings
  dataDir: string;                    // writable scratch directory
}

export interface SandboxInstance {
  readonly id: string;
  readonly sandboxType: SandboxType;

  /** Run the agent to completion. Never throws for agent-level failures. */
  execute(params: SandboxExecuteParams): Promise<SandboxExecuteResult>;

  /** Deliver an inbound command (HITL response, pause, resume) to the agent. */
  sendCommand(command: InboundCommand): Promise<void>;

  /** Real-time event stream. Iterate with `for await (const e of instance.events)`. */
  readonly events: AsyncIterable<SandboxEvent>;

  /** Request cancellation. Resolves immediately; execute() will resolve with cancelled. */
  cancel(): Promise<void>;
}

export interface SandboxExecuteParams {
  executionId: string;
  prompt: string;
  tools: string[];                    // allowed tool names subset
  agentConfig: AgentConfig;
  checkpoint?: Checkpoint;            // if recovering from a crash
  environment?: Record<string, string>;
  timeout: number;                    // hard wall-clock deadline in ms
}

export interface SandboxExecuteResult {
  status: "completed" | "failed" | "timed_out" | "cancelled";
  output?: string;
  error?: string;
  inputTokens?: number;
  outputTokens?: number;
  durationMs: number;
}
```

---

## SandboxConfig — Per-Type Options

`SandboxConfig` is a discriminated union stored as a JSON blob on the `Task`
row. The `type` field selects the sandbox; the remaining fields configure it.

### Native

```typescript
{ type: "native" }
```

No isolation options. The agent runs directly in the host Bun process with full
access to the filesystem and network. Use for development and trusted workloads.

### Wasm (Extism)

```typescript
{
  type: "wasm";
  networkEnabled?: boolean;    // allow outbound network to Claude API; default: true
  maxMemoryMb?: number;        // Wasm memory ceiling in MB; default: 512
  maxCpuPercent?: number;      // CPU cap 0–100; default: 80
  ports?: number[];            // ports exposed from the sandbox
}
```

The Wasm sandbox uses the [Extism](https://extism.org/) WebAssembly runtime.
The Claude Code SDK runs inside the Wasm plugin with enforced memory and CPU
limits. The host provides WASI-like functions for network access.

Requires `@extism/extism` to be installed:

```sh
bun add @extism/extism
```

Check availability before assigning Wasm tasks:

```typescript
const wasm = registry.get("wasm");
if (wasm && await wasm.isAvailable()) {
  // safe to dispatch
}
```

### Docker (Stub)

```typescript
{
  type: "docker";
  image?: string;          // default: "baara-next/sandbox:latest"
  networkEnabled?: boolean;
  ports?: number[];
  volumeMounts?: string[]; // host paths to bind-mount
}
```

The Docker sandbox is a stub. `isAvailable()` returns `false` on all systems.
The interface is complete and ready for implementation — see
[Adding a New Sandbox Type](#adding-a-new-sandbox-type) below.

---

## Sandbox Implementations

### NativeSandbox

**Location:** `packages/executor/src/sandboxes/native.ts`

`start()` returns a `NativeSandboxInstance` immediately. `execute()` calls
`query()` from the Claude Code SDK directly in the host process. Events are
emitted by iterating the SDK's async generator and converting each SDK message
into `SandboxEvent` objects.

Checkpoints are written by `CheckpointService` inside the event loop, every
`intervalTurns` completed turns (default: 5). On recovery, the checkpoint's
`conversationHistory` is passed to the SDK as prior message history and the
recovery system prompt is prepended.

### WasmSandbox

**Location:** `packages/executor/src/sandboxes/wasm.ts`

`start()` initialises an Extism plugin from a pre-compiled `.wasm` file that
bundles the Claude Code SDK. The plugin receives a `SandboxStartConfig` payload
and the host provides WASI-compatible host functions for file I/O and HTTP.

Resource limits (`maxMemoryMb`, `maxCpuPercent`) are set on the Extism plugin
constructor. `execute()` calls the plugin's exported `run` function, which
returns a serialised `SandboxExecuteResult` when done.

### DockerSandbox (Stub)

**Location:** `packages/executor/src/sandboxes/docker.ts`

`isAvailable()` always returns `false`. All other methods throw
`NotImplementedError`. The interface is correct; a real implementation would
call `docker run` and connect via a Unix socket or HTTP.

---

## SandboxRegistry

The registry is a `Map<SandboxType, ISandbox>`. It is created by
`createDefaultSandboxRegistry()` in `packages/executor/src/registry.ts`:

```typescript
export async function createDefaultSandboxRegistry(
  opts: { dataDir: string }
): Promise<SandboxRegistry> {
  const registry = new Map<SandboxType, ISandbox>();
  registry.set("native", new NativeSandbox(opts));
  const wasm = new WasmSandbox(opts);
  if (await wasm.isAvailable()) {
    registry.set("wasm", wasm);
  }
  // DockerSandbox excluded — isAvailable() always false
  return registry;
}
```

The orchestrator calls `registry.get(task.sandboxType ?? "native")` before
dispatching an execution. If the requested sandbox is not in the registry (e.g.,
Wasm is unavailable), the orchestrator falls back to `native`.

---

## Adding a New Sandbox Type

To add a new sandbox type (e.g., `firecracker`):

**Step 1 — Extend SandboxType in `packages/core/src/types.ts`:**

```typescript
export type SandboxType = "native" | "wasm" | "docker" | "firecracker";

export type SandboxConfig =
  | { type: "native" }
  | { type: "wasm"; /* ... */ }
  | { type: "docker"; /* ... */ }
  | {
      type: "firecracker";
      vcpuCount?: number;
      memoryMb?: number;
    };
```

**Step 2 — Implement ISandbox:**

```typescript
// packages/executor/src/sandboxes/firecracker.ts
import type { ISandbox, SandboxInstance, SandboxStartConfig } from "@baara-next/core";

export class FirecrackerSandbox implements ISandbox {
  readonly name = "firecracker" as const;
  readonly description = "Firecracker microVM isolation";

  async isAvailable(): Promise<boolean> {
    // Check if /dev/kvm exists and firecracker binary is on PATH
    return false; // implement real check
  }

  async start(config: SandboxStartConfig): Promise<SandboxInstance> {
    // Boot a microVM, return a FirecrackerSandboxInstance
    throw new Error("not implemented");
  }

  async stop(instance: SandboxInstance): Promise<void> {
    // Terminate the microVM
  }
}
```

**Step 3 — Register in `createDefaultSandboxRegistry()`:**

```typescript
import { FirecrackerSandbox } from "./sandboxes/firecracker.ts";

const fc = new FirecrackerSandbox(opts);
if (await fc.isAvailable()) {
  registry.set("firecracker", fc);
}
```

**Step 4 — Use in a task:**

```json
{
  "name": "my-isolated-task",
  "prompt": "...",
  "sandboxType": "firecracker",
  "sandboxConfig": { "type": "firecracker", "vcpuCount": 2, "memoryMb": 1024 }
}
```

---

## Resource Limits Summary

| Sandbox | Memory | CPU | Network | Filesystem |
|---------|--------|-----|---------|------------|
| `native` | host limit | host limit | full | full |
| `wasm` | `maxMemoryMb` (default 512 MB) | `maxCpuPercent` (default 80%) | configurable | host WASI mount |
| `docker` | Docker `--memory` (stub) | Docker `--cpus` (stub) | configurable | bind mounts |

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

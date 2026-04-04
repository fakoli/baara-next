// @baara-next/core — IRuntime interface and execution parameter types

import type { HealthStatus, RuntimeCapability, Task } from "../types.ts";

// ---------------------------------------------------------------------------
// Execution I/O types
// ---------------------------------------------------------------------------

/**
 * Parameters passed to `IRuntime.execute`.  The runtime must not reach back
 * into the store; everything it needs is supplied here.
 */
export interface ExecuteParams {
  executionId: string;
  task: Task;
  /** Pre-existing operator input available at the start of this attempt. */
  input?: string;
  /** Hard deadline in milliseconds; the runtime must abort and return `timed_out`. */
  timeout: number;
  resourceLimits?: ResourceLimits;
  /** Additional environment variables injected into the execution context. */
  environment?: Record<string, string>;
}

/**
 * The terminal result of a single execution attempt.  Every field that may be
 * absent in failure paths is explicitly optional rather than typed as
 * `T | null` to keep downstream pattern matching clean.
 */
export interface ExecuteResult {
  status: "completed" | "failed" | "timed_out" | "cancelled";
  output?: string;
  error?: string;
  inputTokens?: number;
  outputTokens?: number;
  /** Elapsed wall-clock time of the execution attempt in milliseconds. */
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Runtime configuration
// ---------------------------------------------------------------------------

/**
 * Opaque configuration passed to `IRuntime.initialize`.
 *
 * `dataDir` is required; all other keys are runtime-specific and validated
 * by the concrete implementation.
 */
export interface RuntimeConfig {
  /** Writable directory the runtime may use for scratch files, sessions, etc. */
  dataDir: string;
  [key: string]: unknown;
}

/**
 * Resource guardrails for a single execution.  All fields are optional;
 * absent fields mean "no limit enforced by this runtime".
 */
export interface ResourceLimits {
  /** Maximum resident memory in megabytes. */
  maxMemoryMb?: number;
  /** Maximum CPU utilisation as a percentage (0–100). */
  maxCpuPercent?: number;
  /** Hard wall-clock time limit in milliseconds (mirrors `ExecuteParams.timeout`). */
  maxDurationMs?: number;
  /** Spending cap for LLM API calls in USD. */
  budgetUsd?: number;
}

// ---------------------------------------------------------------------------
// IRuntime
// ---------------------------------------------------------------------------

/**
 * A pluggable execution backend.  One runtime may handle `cloud_code` tasks
 * using the Claude Agent SDK; another may run `wasm` payloads in a sandbox.
 *
 * Runtimes are stateless with respect to individual executions — all
 * mutable state lives in the store and is passed in via `ExecuteParams`.
 */
export interface IRuntime {
  /** Human-readable name used in logs and health endpoints. */
  readonly name: string;

  /** The set of `RuntimeCapability` values this runtime can satisfy. */
  readonly capabilities: readonly RuntimeCapability[];

  /**
   * Perform one-time setup (e.g. start a sandbox process, warm up a WASM
   * engine, validate API keys).
   *
   * Must be called once before any `execute` calls.
   */
  initialize(config: RuntimeConfig): Promise<void>;

  /**
   * Run the task described by `params` to completion.
   *
   * Implementations must respect `params.timeout` and return
   * `{ status: "timed_out" }` rather than throwing when the deadline expires.
   *
   * All thrown errors are treated as unexpected crashes; prefer returning a
   * `failed` result with a descriptive `error` string.
   */
  execute(params: ExecuteParams): Promise<ExecuteResult>;

  /**
   * Request cancellation of a running execution.
   *
   * The call returns immediately; the actual execution may take a short time
   * to terminate.  The runtime must eventually resolve `execute` with
   * `{ status: "cancelled" }`.
   */
  cancel(executionId: string): Promise<void>;

  /**
   * Probe the runtime's own health.  Used by the health monitor to surface
   * slow or unresponsive runtimes in the orchestrator dashboard.
   */
  healthCheck(): Promise<{ status: HealthStatus }>;

  /**
   * Tear down all runtime resources (background processes, file handles,
   * network connections).
   *
   * After `shutdown()` resolves, no further method calls are valid.
   */
  shutdown(): Promise<void>;
}

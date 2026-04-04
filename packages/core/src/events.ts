// @baara-next/core — Execution Event Catalog
//
// All events share a common header (BaseEvent) and are distinguished by their
// `type` discriminant.  The full union type `ExecutionEvent` is used for
// typed event streams, persistence, and SSE payloads.

import type { ExecutionStatus, HealthStatus } from "./types.ts";

// ---------------------------------------------------------------------------
// Base
// ---------------------------------------------------------------------------

export interface BaseEvent {
  /** UUID for this event record. */
  id: string;
  /** The execution this event belongs to. */
  executionId: string;
  /** Monotonically increasing sequence number within the execution. */
  eventSeq: number;
  /** ISO-8601 timestamp of when the event was recorded. */
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Lifecycle events
// ---------------------------------------------------------------------------

/** Emitted when an execution row is first inserted into the store. */
export interface ExecutionCreated extends BaseEvent {
  type: "execution_created";
  taskId: string;
  queueName: string;
  attempt: number;
}

/** Emitted when the execution is placed on a durable queue. */
export interface ExecutionQueued extends BaseEvent {
  type: "execution_queued";
  queueName: string;
}

/** Emitted when a worker claims the execution from the queue. */
export interface ExecutionAssigned extends BaseEvent {
  type: "execution_assigned";
  agentId: string;
}

/** Emitted when the agent begins processing (first tool call or LLM turn). */
export interface ExecutionStarted extends BaseEvent {
  type: "execution_started";
}

// ---------------------------------------------------------------------------
// Turn / tool events
// ---------------------------------------------------------------------------

/** Emitted at the start of each agent conversation turn. */
export interface TurnStarted extends BaseEvent {
  type: "turn_started";
  turnNumber: number;
}

/** Emitted when an agent turn finishes (before the next turn or terminal event). */
export interface TurnCompleted extends BaseEvent {
  type: "turn_completed";
  turnNumber: number;
  /** Partial text output produced by this turn, if any. */
  output?: string;
}

/** Emitted when the agent invokes a tool. */
export interface ToolInvoked extends BaseEvent {
  type: "tool_invoked";
  toolName: string;
  /** Serialised input arguments (JSON string to avoid schema explosion). */
  input: string;
}

/** Emitted when a tool call returns, whether successfully or with an error. */
export interface ToolCompleted extends BaseEvent {
  type: "tool_completed";
  toolName: string;
  success: boolean;
  /** Serialised tool result or error message. */
  output: string;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Checkpoint / heartbeat
// ---------------------------------------------------------------------------

/** Emitted when the agent writes a mid-execution checkpoint. */
export interface CheckpointCreated extends BaseEvent {
  type: "checkpoint_created";
  /** Opaque checkpoint identifier (e.g. a content hash). */
  checkpointId: string;
}

/** Emitted by the agent to signal liveness during a long-running execution. */
export interface HeartbeatReceived extends BaseEvent {
  type: "heartbeat_received";
  turnCount: number;
  healthStatus: HealthStatus;
}

// ---------------------------------------------------------------------------
// Human-in-the-loop
// ---------------------------------------------------------------------------

/** Emitted when the agent pauses and requests operator input. */
export interface InputRequested extends BaseEvent {
  type: "input_requested";
  inputRequestId: string;
  prompt: string;
  options?: string[];
}

/** Emitted when the operator provides a response to the input request. */
export interface InputProvided extends BaseEvent {
  type: "input_provided";
  inputRequestId: string;
  response: string;
}

/** Emitted when the input request timeout expires before a response arrives. */
export interface InputTimedOut extends BaseEvent {
  type: "input_timed_out";
  inputRequestId: string;
}

// ---------------------------------------------------------------------------
// Terminal events
// ---------------------------------------------------------------------------

/** Emitted when the execution reaches `completed` status. */
export interface ExecutionCompleted extends BaseEvent {
  type: "execution_completed";
  output?: string;
  inputTokens?: number;
  outputTokens?: number;
  durationMs: number;
}

/** Emitted when the execution reaches `failed` status. */
export interface ExecutionFailed extends BaseEvent {
  type: "execution_failed";
  error: string;
  durationMs: number;
}

/** Emitted when the execution exceeds its configured `timeoutMs`. */
export interface ExecutionTimedOut extends BaseEvent {
  type: "execution_timed_out";
  durationMs: number;
}

/** Emitted when an operator or API call cancels the execution. */
export interface ExecutionCancelled extends BaseEvent {
  type: "execution_cancelled";
  /** Who or what triggered the cancellation. */
  reason?: string;
}

// ---------------------------------------------------------------------------
// Retry / dead-letter
// ---------------------------------------------------------------------------

/** Emitted when a failed/timed-out execution is scheduled for a retry attempt. */
export interface RetryScheduled extends BaseEvent {
  type: "retry_scheduled";
  nextAttempt: number;
  /** Delay before the retry is enqueued, in milliseconds. */
  delayMs: number;
}

/**
 * Emitted when the retry delay has elapsed and the new attempt is enqueued.
 * Follows `RetryScheduled` once the delay expires.
 */
export interface RetryStarted extends BaseEvent {
  type: "retry_started";
  attempt: number;
}

/**
 * Emitted when the execution has exhausted all retry attempts and is moved
 * to the dead-letter queue.
 */
export interface DeadLettered extends BaseEvent {
  type: "dead_lettered";
  /** The previous terminal status that triggered dead-lettering. */
  previousStatus: Extract<ExecutionStatus, "failed" | "timed_out">;
  totalAttempts: number;
}

// ---------------------------------------------------------------------------
// Union
// ---------------------------------------------------------------------------

export type ExecutionEvent =
  | ExecutionCreated
  | ExecutionQueued
  | ExecutionAssigned
  | ExecutionStarted
  | TurnStarted
  | TurnCompleted
  | ToolInvoked
  | ToolCompleted
  | CheckpointCreated
  | HeartbeatReceived
  | InputRequested
  | InputProvided
  | InputTimedOut
  | ExecutionCompleted
  | ExecutionFailed
  | ExecutionTimedOut
  | ExecutionCancelled
  | RetryScheduled
  | RetryStarted
  | DeadLettered;

/** Narrow an `ExecutionEvent` to a specific type using the `type` discriminant. */
export type EventOfType<T extends ExecutionEvent["type"]> = Extract<
  ExecutionEvent,
  { type: T }
>;

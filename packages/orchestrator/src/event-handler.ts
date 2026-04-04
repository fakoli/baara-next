// @baara-next/orchestrator — Event Handler
//
// Helper functions that construct typed ExecutionEvent objects (from
// @baara-next/core) with auto-generated IDs and timestamps, then persist
// them via store.appendEvent().
//
// Each function resolves the next eventSeq by reading the highest existing
// sequence number for the execution and incrementing by 1.  This keeps event
// ordering deterministic without requiring callers to track sequence state.

import type { IStore } from "@baara-next/core";
import type {
  ExecuteResult,
} from "@baara-next/core";
import type { ExecutionStatus } from "@baara-next/core";

// ---------------------------------------------------------------------------
// Sequence helper
// ---------------------------------------------------------------------------

/**
 * Return the next monotonically increasing event sequence number for the
 * given execution.  Uses a single MAX aggregate query via getMaxEventSeq
 * instead of fetching all events — O(1) regardless of event log length.
 */
function nextSeq(store: IStore, executionId: string): number {
  return store.getMaxEventSeq(executionId) + 1;
}

function makeBase(store: IStore, executionId: string) {
  return {
    id: crypto.randomUUID(),
    executionId,
    eventSeq: nextSeq(store, executionId),
    timestamp: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Lifecycle events
// ---------------------------------------------------------------------------

export function emitExecutionCreated(
  store: IStore,
  executionId: string,
  taskId: string,
  queueName: string,
  attempt: number
): void {
  store.appendEvent({
    ...makeBase(store, executionId),
    type: "execution_created",
    taskId,
    queueName,
    attempt,
  });
}

export function emitExecutionQueued(
  store: IStore,
  executionId: string,
  queueName: string
): void {
  store.appendEvent({
    ...makeBase(store, executionId),
    type: "execution_queued",
    queueName,
  });
}

export function emitExecutionAssigned(
  store: IStore,
  executionId: string,
  agentId: string
): void {
  store.appendEvent({
    ...makeBase(store, executionId),
    type: "execution_assigned",
    agentId,
  });
}

export function emitExecutionStarted(store: IStore, executionId: string): void {
  store.appendEvent({
    ...makeBase(store, executionId),
    type: "execution_started",
  });
}

// ---------------------------------------------------------------------------
// Terminal events
// ---------------------------------------------------------------------------

export function emitExecutionCompleted(
  store: IStore,
  executionId: string,
  output: string | undefined,
  inputTokens: number | undefined,
  outputTokens: number | undefined,
  durationMs: number
): void {
  store.appendEvent({
    ...makeBase(store, executionId),
    type: "execution_completed",
    output,
    inputTokens,
    outputTokens,
    durationMs,
  });
}

export function emitExecutionFailed(
  store: IStore,
  executionId: string,
  error: string,
  durationMs: number
): void {
  store.appendEvent({
    ...makeBase(store, executionId),
    type: "execution_failed",
    error,
    durationMs,
  });
}

export function emitExecutionTimedOut(
  store: IStore,
  executionId: string,
  durationMs: number
): void {
  store.appendEvent({
    ...makeBase(store, executionId),
    type: "execution_timed_out",
    durationMs,
  });
}

export function emitExecutionCancelled(
  store: IStore,
  executionId: string,
  reason?: string
): void {
  store.appendEvent({
    ...makeBase(store, executionId),
    type: "execution_cancelled",
    reason,
  });
}

// ---------------------------------------------------------------------------
// Retry / dead-letter events
// ---------------------------------------------------------------------------

export function emitRetryScheduled(
  store: IStore,
  executionId: string,
  nextAttempt: number,
  delayMs: number
): void {
  store.appendEvent({
    ...makeBase(store, executionId),
    type: "retry_scheduled",
    nextAttempt,
    delayMs,
  });
}

export function emitRetryStarted(
  store: IStore,
  executionId: string,
  attempt: number
): void {
  store.appendEvent({
    ...makeBase(store, executionId),
    type: "retry_started",
    attempt,
  });
}

export function emitDeadLettered(
  store: IStore,
  executionId: string,
  previousStatus: Extract<ExecutionStatus, "failed" | "timed_out">,
  totalAttempts: number
): void {
  store.appendEvent({
    ...makeBase(store, executionId),
    type: "dead_lettered",
    previousStatus,
    totalAttempts,
  });
}

// ---------------------------------------------------------------------------
// Human-in-the-loop events
// ---------------------------------------------------------------------------

export function emitInputRequested(
  store: IStore,
  executionId: string,
  inputRequestId: string,
  prompt: string,
  options?: string[]
): void {
  store.appendEvent({
    ...makeBase(store, executionId),
    type: "input_requested",
    inputRequestId,
    prompt,
    options,
  });
}

export function emitInputProvided(
  store: IStore,
  executionId: string,
  inputRequestId: string,
  response: string
): void {
  store.appendEvent({
    ...makeBase(store, executionId),
    type: "input_provided",
    inputRequestId,
    response,
  });
}

// ---------------------------------------------------------------------------
// Convenience: emit the correct terminal event from an ExecuteResult
// ---------------------------------------------------------------------------

export function emitTerminalFromResult(
  store: IStore,
  executionId: string,
  result: ExecuteResult
): void {
  switch (result.status) {
    case "completed":
      emitExecutionCompleted(
        store,
        executionId,
        result.output,
        result.inputTokens,
        result.outputTokens,
        result.durationMs
      );
      break;
    case "failed":
      emitExecutionFailed(
        store,
        executionId,
        result.error ?? "unknown error",
        result.durationMs
      );
      break;
    case "timed_out":
      emitExecutionTimedOut(store, executionId, result.durationMs);
      break;
    case "cancelled":
      emitExecutionCancelled(store, executionId, "agent reported cancelled");
      break;
  }
}

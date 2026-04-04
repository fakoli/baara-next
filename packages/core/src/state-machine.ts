// @baara-next/core — Execution State Machine
//
// Defines which status transitions are valid and enforces the constraint at
// runtime via `validateTransition`.  Any code that updates an execution's
// status must call `validateTransition` first; the store implementation is the
// natural enforcement point.

import type { ExecutionStatus } from "./types.ts";
import { InvalidStateTransitionError } from "./errors.ts";

// ---------------------------------------------------------------------------
// Transition table
// ---------------------------------------------------------------------------

/**
 * Maps each status to the set of statuses it may transition to.
 *
 * Terminal states (completed, cancelled, dead_lettered) have no outgoing
 * transitions — they are absent as keys rather than mapped to an empty array,
 * so callers that iterate the map do not need to special-case them.
 *
 * Rationale for each group:
 *   created        — can be queued immediately or cancelled before queuing
 *   queued         — claimed by a worker (assigned) or abandoned (cancelled/timed_out)
 *   assigned       — worker begins execution (running) or times out before starting
 *   running        — normal completion paths plus human-in-the-loop pause
 *   waiting_for_input — input arrives (back to running) or operator cancels
 *   failed         — retry machinery or dead-letter if retries exhausted
 *   timed_out      — same retry path as failed
 *   retry_scheduled — delay elapsed; re-enqueue
 */
export const VALID_TRANSITIONS: ReadonlyMap<
  ExecutionStatus,
  readonly ExecutionStatus[]
> = new Map([
  ["created", ["queued", "cancelled"]],
  ["queued", ["assigned", "cancelled", "timed_out"]],
  ["assigned", ["running", "timed_out"]],
  [
    "running",
    ["completed", "failed", "timed_out", "cancelled", "waiting_for_input"],
  ],
  ["waiting_for_input", ["running", "cancelled"]],
  ["failed", ["retry_scheduled", "dead_lettered"]],
  ["timed_out", ["retry_scheduled", "dead_lettered"]],
  ["retry_scheduled", ["queued", "cancelled"]],
  // Terminal: completed, cancelled, dead_lettered — no entries.
]);

// ---------------------------------------------------------------------------
// Terminal state helpers
// ---------------------------------------------------------------------------

const TERMINAL_STATUSES: ReadonlySet<ExecutionStatus> = new Set([
  "completed",
  "cancelled",
  "dead_lettered",
]);

/** Returns true if the given status is a terminal state with no outgoing transitions. */
export function isTerminal(status: ExecutionStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Asserts that transitioning an execution from `from` to `to` is permitted
 * by the state machine.
 *
 * Throws `InvalidStateTransitionError` if the transition is not listed in
 * `VALID_TRANSITIONS`.  Callers that update execution status must call this
 * before persisting the change.
 *
 * @param from - Current execution status.
 * @param to   - Requested next status.
 * @param executionId - Optional; included in the error message when provided.
 *
 * @throws {InvalidStateTransitionError}
 */
export function validateTransition(
  from: ExecutionStatus,
  to: ExecutionStatus,
  executionId?: string
): void {
  const allowed = VALID_TRANSITIONS.get(from);

  if (allowed === undefined || !(allowed as readonly string[]).includes(to)) {
    throw new InvalidStateTransitionError(from, to, executionId);
  }
}

/**
 * Returns the valid next statuses for a given current status, or an empty
 * array if the status is terminal or unknown.
 */
export function allowedTransitions(
  from: ExecutionStatus
): readonly ExecutionStatus[] {
  return VALID_TRANSITIONS.get(from) ?? [];
}

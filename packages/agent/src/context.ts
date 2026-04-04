// @baara-next/agent — Per-execution context
//
// Carries all metadata for a single execution attempt.  The context is created
// once at the start of `executeTask` and threaded through every helper that
// needs to know about the current execution.

import type { Task, TaskAssignment } from "@baara-next/core";

/**
 * Immutable snapshot of the information available at the start of a single
 * execution attempt.  Helpers receive the context rather than individual
 * parameters so the call signatures stay stable as new fields are added.
 */
export interface ExecutionContext {
  readonly executionId: string;
  readonly task: Task;
  readonly attempt: number;
  readonly startTime: number;
  turnCount: number;
}

/**
 * Create a fresh `ExecutionContext` from a `TaskAssignment`.
 *
 * `startTime` is set to `Date.now()` at the moment of creation.
 */
export function createContext(assignment: TaskAssignment): ExecutionContext {
  return {
    executionId: assignment.executionId,
    task: assignment.task,
    attempt: assignment.attempt,
    startTime: Date.now(),
    turnCount: 0,
  };
}

/**
 * Returns the number of milliseconds elapsed since the context was created.
 */
export function elapsed(ctx: ExecutionContext): number {
  return Date.now() - ctx.startTime;
}

/**
 * Returns `true` if the elapsed time exceeds `task.timeoutMs`.
 *
 * When this returns `true` the caller should abort the execution and report
 * `{ status: "timed_out" }`.
 */
export function isTimedOut(ctx: ExecutionContext): boolean {
  return elapsed(ctx) >= ctx.task.timeoutMs;
}

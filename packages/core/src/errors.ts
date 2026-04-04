// @baara-next/core — Error Hierarchy
//
// Every error class extends BaaraError so callers can catch all BAARA errors
// with a single `catch (e) { if (e instanceof BaaraError) ... }` clause, or
// narrow to a specific subclass for fine-grained handling.
//
// Rules enforced here:
//   - Never call sys.exit() — raise and let the caller decide.
//   - Never swallow exceptions silently.
//   - Always include the offending value in the message so the caller can
//     diagnose without re-running.

// ---------------------------------------------------------------------------
// Base
// ---------------------------------------------------------------------------

/** Root class for all errors originating from the BAARA execution engine. */
export class BaaraError extends Error {
  // Declared as `string` so subclasses can override with a narrower literal
  // without TypeScript rejecting the assignment.
  override readonly name: string = "BaaraError";

  constructor(message: string) {
    super(message);
    // Restore the prototype chain broken by transpilers.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ---------------------------------------------------------------------------
// Not-found errors
// ---------------------------------------------------------------------------

/** Raised when a task with the requested id does not exist in the store. */
export class TaskNotFoundError extends BaaraError {
  override readonly name = "TaskNotFoundError";

  constructor(readonly taskId: string) {
    super(`Task not found: "${taskId}"`);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Raised when an execution with the requested id does not exist in the store. */
export class ExecutionNotFoundError extends BaaraError {
  override readonly name = "ExecutionNotFoundError";

  constructor(readonly executionId: string) {
    super(`Execution not found: "${executionId}"`);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Raised when a project with the requested id does not exist in the store. */
export class ProjectNotFoundError extends BaaraError {
  override readonly name = "ProjectNotFoundError";

  constructor(readonly projectId: string) {
    super(`Project not found: "${projectId}"`);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Raised when a template with the requested id does not exist in the store. */
export class TemplateNotFoundError extends BaaraError {
  override readonly name = "TemplateNotFoundError";

  constructor(readonly templateId: string) {
    super(`Template not found: "${templateId}"`);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Raised when a thread with the requested id does not exist in the store. */
export class ThreadNotFoundError extends BaaraError {
  override readonly name = "ThreadNotFoundError";

  constructor(readonly threadId: string) {
    super(`Thread not found: "${threadId}"`);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ---------------------------------------------------------------------------
// State machine errors
// ---------------------------------------------------------------------------

/**
 * Raised by `validateTransition` when the requested status transition is not
 * listed in `VALID_TRANSITIONS`.
 */
export class InvalidStateTransitionError extends BaaraError {
  override readonly name = "InvalidStateTransitionError";

  constructor(
    readonly from: string,
    readonly to: string,
    readonly executionId?: string
  ) {
    const ctx = executionId ? ` (execution: "${executionId}")` : "";
    super(`Invalid state transition: "${from}" → "${to}"${ctx}`);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ---------------------------------------------------------------------------
// Queue errors
// ---------------------------------------------------------------------------

/**
 * Raised when an enqueue operation is attempted on a queue that has reached
 * its capacity or depth limit.
 */
export class QueueFullError extends BaaraError {
  override readonly name = "QueueFullError";

  constructor(readonly queueName: string, readonly currentDepth: number) {
    super(
      `Queue "${queueName}" is full (current depth: ${currentDepth})`
    );
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ---------------------------------------------------------------------------
// Budget / resource errors
// ---------------------------------------------------------------------------

/**
 * Raised when a running execution exceeds the `budgetUsd` limit configured
 * in `AgentConfig`.
 */
export class BudgetExceededError extends BaaraError {
  override readonly name = "BudgetExceededError";

  constructor(
    readonly executionId: string,
    readonly limitUsd: number,
    readonly actualUsd: number
  ) {
    super(
      `Execution "${executionId}" exceeded budget: limit $${limitUsd.toFixed(4)}, actual $${actualUsd.toFixed(4)}`
    );
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ---------------------------------------------------------------------------
// Timeout errors
// ---------------------------------------------------------------------------

/**
 * Raised when a task execution exceeds its configured `timeoutMs`.
 * Distinct from `InputTimeoutError` which is scoped to a human-in-the-loop pause.
 */
export class TimeoutError extends BaaraError {
  override readonly name = "TimeoutError";

  constructor(readonly executionId: string, readonly timeoutMs: number) {
    super(
      `Execution "${executionId}" timed out after ${timeoutMs}ms`
    );
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Raised when an `InputRequest` is not answered within its configured
 * `timeoutMs` window.
 */
export class InputTimeoutError extends BaaraError {
  override readonly name = "InputTimeoutError";

  constructor(
    readonly inputRequestId: string,
    readonly executionId: string,
    readonly timeoutMs: number
  ) {
    super(
      `Input request "${inputRequestId}" for execution "${executionId}" timed out after ${timeoutMs}ms`
    );
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ---------------------------------------------------------------------------
// Input request errors
// ---------------------------------------------------------------------------

/**
 * Raised when no pending InputRequest exists for the given execution.
 * Distinct from ExecutionNotFoundError: the execution exists but has no
 * unanswered input request.
 */
export class InputRequestNotFoundError extends BaaraError {
  override readonly name = "InputRequestNotFoundError";

  constructor(readonly executionId: string) {
    super(`No pending input request for execution "${executionId}"`);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ---------------------------------------------------------------------------
// Concurrency / duplicate errors
// ---------------------------------------------------------------------------

/**
 * Raised when an operation would create a duplicate that the store's
 * uniqueness constraints forbid (e.g. two tasks with the same name).
 */
export class DuplicateEntityError extends BaaraError {
  override readonly name = "DuplicateEntityError";

  constructor(
    readonly entityType: string,
    readonly field: string,
    readonly value: string
  ) {
    super(
      `${entityType} with ${field} "${value}" already exists`
    );
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// @baara-next/core — IStore interface
//
// The store is the single source of truth for all persisted state.  Nothing
// outside the store implementation may issue SQL directly.  Services call
// store methods; routes and agents call services.
//
// All read methods are synchronous because the underlying SQLite driver
// (bun:sqlite) runs queries synchronously.  Write methods are also
// synchronous for the same reason but are expressed as `void` returns to
// signal that callers must not rely on a returned value for mutations.

import type {
  CreateProjectInput,
  CreateTaskInput,
  CreateTemplateInput,
  Execution,
  ExecutionStatus,
  InputRequest,
  Priority,
  Project,
  QueueInfo,
  SendMessageInput,
  Task,
  TaskMessage,
  Template,
  Thread,
  UpdateTaskInput,
} from "../types.ts";
import type { ExecutionEvent } from "../events.ts";

// Re-export so interfaces/index.ts can surface these alongside IStore.
export type { TaskMessage, SendMessageInput } from "../types.ts";

export interface IStore {
  // -------------------------------------------------------------------------
  // Tasks
  // -------------------------------------------------------------------------

  /** Return all tasks, optionally filtered to a single project. */
  listTasks(projectId?: string): Task[];

  /** Return the task with the given id, or null if not found. */
  getTask(id: string): Task | null;

  /** Return the task with the given name, or null if not found. */
  getTaskByName(name: string): Task | null;

  /**
   * Insert a new task row.
   *
   * The caller is responsible for generating `id` (e.g. `crypto.randomUUID()`).
   * Throws `DuplicateEntityError` if a task with the same name already exists.
   */
  createTask(id: string, input: CreateTaskInput): Task;

  /**
   * Apply a partial update to an existing task.
   *
   * Throws `TaskNotFoundError` if `id` is unknown.
   */
  updateTask(id: string, input: UpdateTaskInput): Task;

  /**
   * Delete a task by id.
   *
   * Throws `TaskNotFoundError` if `id` is unknown.
   */
  deleteTask(id: string): void;

  // -------------------------------------------------------------------------
  // Executions
  // -------------------------------------------------------------------------

  /**
   * Insert a new execution row in `created` status.
   *
   * The caller supplies `id` and the initial scheduling metadata.
   * `attempt` defaults to 1 for first-run executions.
   */
  createExecution(
    id: string,
    taskId: string,
    queueName: string,
    priority: Priority,
    scheduledAt: string,
    attempt?: number
  ): Execution;

  /** Return the execution with the given id, or null if not found. */
  getExecution(id: string): Execution | null;

  /**
   * Return executions for a task, newest first.
   *
   * @param opts.limit  - Maximum number of rows to return (default: no limit).
   * @param opts.status - Filter to a specific status.
   */
  listExecutions(
    taskId: string,
    opts?: { limit?: number; status?: ExecutionStatus }
  ): Execution[];

  /**
   * Transition an execution to a new status and apply optional field updates
   * atomically.
   *
   * Throws `ExecutionNotFoundError` if `id` is unknown.
   * Throws `InvalidStateTransitionError` if the transition is not permitted.
   */
  updateExecutionStatus(
    id: string,
    status: ExecutionStatus,
    updates?: Partial<Execution>
  ): void;

  /**
   * Update mutable fields on an execution WITHOUT changing its status.
   *
   * No state-machine validation is performed — use this for in-place updates
   * such as heartbeat health status and turn count where the status does not
   * change.
   *
   * Throws `ExecutionNotFoundError` if `id` is unknown.
   */
  updateExecutionFields(
    id: string,
    updates: Partial<Pick<Execution, "turnCount" | "healthStatus" | "checkpointData">>
  ): void;

  /**
   * Atomically dequeue the highest-priority `queued` execution from the named
   * queue, transition it to `assigned`, and return it.
   *
   * Returns null when the queue is empty.
   */
  dequeueExecution(queueName: string): Execution | null;

  /** Return all executions in `dead_lettered` status, newest first. */
  getDeadLetteredExecutions(): Execution[];

  /** Return all executions currently in `waiting_for_input` status. */
  getPendingInputExecutions(): Execution[];

  /**
   * Return executions across all tasks, newest first.
   *
   * @param opts.status - Filter to a specific status.
   * @param opts.limit  - Maximum number of rows to return (default: 50).
   */
  listAllExecutions(opts?: { status?: ExecutionStatus; limit?: number }): Execution[];

  /**
   * Return the count of executions with the given status.
   *
   * Implemented as a single `SELECT COUNT(*)` query — O(1) regardless of
   * total execution volume. Prefer this over `listAllExecutions` when only
   * a count is needed.
   */
  countExecutionsByStatus(status: ExecutionStatus): number;

  // -------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------

  /**
   * Append an event to the execution event log.
   *
   * `eventSeq` must be monotonically increasing within an execution; the
   * store implementation is responsible for enforcing this constraint.
   */
  appendEvent(event: ExecutionEvent): void;

  /**
   * Return events for an execution in ascending `eventSeq` order.
   *
   * @param opts.afterSeq - Return only events with eventSeq > afterSeq (for paging).
   * @param opts.limit    - Maximum number of events to return.
   */
  listEvents(
    executionId: string,
    opts?: { afterSeq?: number; limit?: number }
  ): ExecutionEvent[];

  /**
   * Return the highest event_seq value for the given execution, or 0 if no
   * events have been appended yet.
   *
   * Used by event-handler to compute the next sequence number in O(1) via a
   * single MAX aggregate query rather than fetching all events.
   */
  getMaxEventSeq(executionId: string): number;

  // -------------------------------------------------------------------------
  // Input Requests
  // -------------------------------------------------------------------------

  /**
   * Persist a new input request.
   *
   * `id` and `createdAt` are generated by the store implementation.
   */
  createInputRequest(
    request: Omit<InputRequest, "id" | "createdAt">
  ): InputRequest;

  /**
   * Return the active (pending) input request for the given execution, or null
   * if none exists.
   */
  getInputRequest(executionId: string): InputRequest | null;

  /**
   * Record the operator's response and mark the input request as `responded`.
   *
   * Throws `ExecutionNotFoundError` if no pending input request exists for
   * `executionId`.
   */
  respondToInput(executionId: string, response: string): void;

  // -------------------------------------------------------------------------
  // Queues
  // -------------------------------------------------------------------------

  /** Return metadata snapshots for all known queues. */
  listQueues(): QueueInfo[];

  /** Return metadata for a single queue, or null if the queue does not exist. */
  getQueueInfo(name: string): QueueInfo | null;

  // -------------------------------------------------------------------------
  // Templates
  // -------------------------------------------------------------------------

  listTemplates(): Template[];

  getTemplate(id: string): Template | null;

  /**
   * Insert a new template.
   *
   * Throws `DuplicateEntityError` if a template with the same name already exists.
   */
  createTemplate(id: string, input: CreateTemplateInput): Template;

  /**
   * Delete a template by id.
   *
   * Throws `TemplateNotFoundError` if `id` is unknown.
   */
  deleteTemplate(id: string): void;

  // -------------------------------------------------------------------------
  // Projects
  // -------------------------------------------------------------------------

  listProjects(): Project[];

  getProject(id: string): Project | null;

  /**
   * Insert a new project.
   *
   * Throws `DuplicateEntityError` if a project with the same name already exists.
   */
  createProject(id: string, input: CreateProjectInput): Project;

  /**
   * Apply a partial update to an existing project.
   *
   * Throws `ProjectNotFoundError` if `id` is unknown.
   */
  updateProject(id: string, input: Partial<CreateProjectInput>): Project;

  /**
   * Delete a project by id.
   *
   * Throws `ProjectNotFoundError` if `id` is unknown.
   */
  deleteProject(id: string): void;

  // -------------------------------------------------------------------------
  // Threads
  // -------------------------------------------------------------------------

  /**
   * Insert a new thread row.
   *
   * The caller is responsible for generating `id` (e.g. `crypto.randomUUID()`).
   */
  createThread(id: string, title: string): Thread;

  /** Return the thread with the given id, or null if not found. */
  getThread(id: string): Thread | null;

  /**
   * Return threads, newest first.
   *
   * @param opts.limit - Maximum number of rows to return (default: no limit).
   */
  listThreads(opts?: { limit?: number }): Thread[];

  /**
   * Apply a partial update to an existing thread.
   *
   * Throws `ThreadNotFoundError` if `id` is unknown.
   */
  updateThread(id: string, updates: { title?: string }): Thread;

  /**
   * Delete a thread by id.
   *
   * Throws `ThreadNotFoundError` if `id` is unknown.
   * Executions linked to this thread have their thread_id set to NULL
   * (ON DELETE SET NULL).
   */
  deleteThread(id: string): void;

  /**
   * Associate an execution with a thread.
   *
   * Throws `ExecutionNotFoundError` if `executionId` is unknown.
   * Throws `ThreadNotFoundError` if `threadId` is unknown.
   */
  linkExecutionToThread(executionId: string, threadId: string): void;

  /**
   * Return executions linked to a thread, newest first.
   *
   * @param opts.limit - Maximum number of rows to return (default: no limit).
   */
  listExecutionsByThread(threadId: string, opts?: { limit?: number }): Execution[];

  // -------------------------------------------------------------------------
  // Task Messages — durable command queue and checkpoint store
  // -------------------------------------------------------------------------

  /**
   * Insert a new message row into task_messages with status 'pending'.
   *
   * The caller is responsible for generating `id` (e.g. `crypto.randomUUID()`).
   */
  sendMessage(input: SendMessageInput): void;

  /**
   * Return messages for an execution filtered by direction and optionally
   * by status, ordered by created_at ASC (oldest first).
   */
  readMessages(
    executionId: string,
    direction: "inbound" | "outbound",
    status?: "pending" | "delivered" | "acknowledged"
  ): TaskMessage[];

  /**
   * Update the status of the given message IDs to 'acknowledged'.
   *
   * No-ops for IDs that do not exist or are already acknowledged.
   */
  acknowledgeMessages(messageIds: string[]): void;

  /**
   * Return the most recently created message for an execution matching
   * the given direction and messageType, or null if none exists.
   *
   * Used by readLatestCheckpoint to find the most recent checkpoint row.
   */
  readLatestMessage(
    executionId: string,
    direction: "inbound" | "outbound",
    messageType: string
  ): TaskMessage | null;

  // -------------------------------------------------------------------------
  // Settings
  // -------------------------------------------------------------------------

  /**
   * Retrieve a named setting string, or null if the key has never been set.
   *
   * Settings are a simple key-value store for operator-configurable strings
   * (e.g. system prompt overrides, feature flags).
   */
  getSetting(key: string): string | null;

  /** Persist a setting, creating or replacing the existing value. */
  setSetting(key: string, value: string): void;

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Flush pending writes and close the database connection.
   *
   * After `close()` returns, no further method calls on this store are valid.
   */
  close(): void;
}

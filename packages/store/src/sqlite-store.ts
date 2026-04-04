// @baara-next/store — SQLiteStore
//
// Implements IStore from @baara-next/core using bun:sqlite.
// All mutations are synchronous; no ORM; raw SQL only.
// Row-to-type mappers translate snake_case DB columns to camelCase TS fields.

import { Database } from "bun:sqlite";
import type { SQLQueryBindings } from "bun:sqlite";
import type {
  IStore,
  Task,
  CreateTaskInput,
  UpdateTaskInput,
  Execution,
  ExecutionStatus,
  InputRequest,
  Priority,
  Project,
  CreateProjectInput,
  QueueInfo,
  Template,
  CreateTemplateInput,
  ExecutionEvent,
  HealthStatus,
  Thread,
  TaskMessage,
  SendMessageInput,
  ThreadMessage,
  AppendThreadMessageInput,
} from "@baara-next/core";
import {
  TaskNotFoundError,
  ExecutionNotFoundError,
  InputRequestNotFoundError,
  ProjectNotFoundError,
  TemplateNotFoundError,
  ThreadNotFoundError,
  DuplicateEntityError,
  validateTransition,
} from "@baara-next/core";
import { runMigrations } from "./migrations.ts";

// ---------------------------------------------------------------------------
// SQLiteStore
// ---------------------------------------------------------------------------

export class SQLiteStore implements IStore {
  private db: Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    runMigrations(this.db);
  }

  // -------------------------------------------------------------------------
  // Tasks
  // -------------------------------------------------------------------------

  listTasks(projectId?: string): Task[] {
    if (projectId) {
      return this.db
        .query("SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at DESC")
        .all(projectId)
        .map(rowToTask);
    }
    return this.db
      .query("SELECT * FROM tasks ORDER BY created_at DESC")
      .all()
      .map(rowToTask);
  }

  getTask(id: string): Task | null {
    const row = this.db.query("SELECT * FROM tasks WHERE id = ?").get(id);
    return row ? rowToTask(row) : null;
  }

  getTaskByName(name: string): Task | null {
    const row = this.db.query("SELECT * FROM tasks WHERE name = ?").get(name);
    return row ? rowToTask(row) : null;
  }

  createTask(id: string, input: CreateTaskInput): Task {
    try {
      this.db.run(
        `INSERT INTO tasks (
          id, name, description, prompt, cron_expression,
          timeout_ms, sandbox_type, sandbox_config, agent_config, priority, target_queue,
          max_retries, execution_mode, enabled, project_id, target_thread_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          input.name,
          input.description ?? "",
          input.prompt,
          input.cronExpression ?? null,
          input.timeoutMs ?? 300000,
          input.sandboxType ?? "native",
          input.sandboxConfig ? JSON.stringify(input.sandboxConfig) : '{"type":"native"}',
          input.agentConfig ? JSON.stringify(input.agentConfig) : null,
          input.priority ?? 1,
          input.targetQueue ?? "transfer",
          input.maxRetries ?? 0,
          input.executionMode ?? "queued",
          input.enabled !== false ? 1 : 0,
          input.projectId ?? null,
          input.targetThreadId ?? null,
        ]
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("UNIQUE constraint failed")) {
        throw new DuplicateEntityError("Task", "name", input.name);
      }
      throw err;
    }
    return this.getTask(id)!;
  }

  updateTask(id: string, input: UpdateTaskInput): Task {
    const existing = this.getTask(id);
    if (!existing) throw new TaskNotFoundError(id);

    const fields: string[] = [];
    const values: unknown[] = [];

    if (input.name !== undefined) { fields.push("name = ?"); values.push(input.name); }
    if (input.description !== undefined) { fields.push("description = ?"); values.push(input.description); }
    if (input.prompt !== undefined) { fields.push("prompt = ?"); values.push(input.prompt); }
    if (input.cronExpression !== undefined) { fields.push("cron_expression = ?"); values.push(input.cronExpression ?? null); }
    if (input.timeoutMs !== undefined) { fields.push("timeout_ms = ?"); values.push(input.timeoutMs); }
    if (input.sandboxType !== undefined) { fields.push("sandbox_type = ?"); values.push(input.sandboxType); }
    if (input.sandboxConfig !== undefined) {
      fields.push("sandbox_config = ?");
      values.push(JSON.stringify(input.sandboxConfig));
    }
    if (input.agentConfig !== undefined) {
      fields.push("agent_config = ?");
      values.push(input.agentConfig ? JSON.stringify(input.agentConfig) : null);
    }
    if (input.priority !== undefined) { fields.push("priority = ?"); values.push(input.priority); }
    if (input.targetQueue !== undefined) { fields.push("target_queue = ?"); values.push(input.targetQueue); }
    if (input.maxRetries !== undefined) { fields.push("max_retries = ?"); values.push(input.maxRetries); }
    if (input.executionMode !== undefined) { fields.push("execution_mode = ?"); values.push(input.executionMode); }
    if (input.enabled !== undefined) { fields.push("enabled = ?"); values.push(input.enabled ? 1 : 0); }
    if (input.projectId !== undefined) { fields.push("project_id = ?"); values.push(input.projectId ?? null); }
    if (input.targetThreadId !== undefined) { fields.push("target_thread_id = ?"); values.push(input.targetThreadId ?? null); }

    if (fields.length === 0) return existing;

    fields.push("updated_at = datetime('now')");
    values.push(id);

    try {
      this.db.run(`UPDATE tasks SET ${fields.join(", ")} WHERE id = ?`, values as SQLQueryBindings[]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("UNIQUE constraint failed")) {
        throw new DuplicateEntityError("Task", "name", input.name ?? "");
      }
      throw err;
    }
    return this.getTask(id)!;
  }

  deleteTask(id: string): void {
    const existing = this.getTask(id);
    if (!existing) throw new TaskNotFoundError(id);
    this.db.run("DELETE FROM tasks WHERE id = ?", [id]);
  }

  // -------------------------------------------------------------------------
  // Executions
  // -------------------------------------------------------------------------

  createExecution(
    id: string,
    taskId: string,
    queueName: string,
    priority: Priority,
    scheduledAt: string,
    attempt: number = 1
  ): Execution {
    this.db.run(
      `INSERT INTO executions (
        id, task_id, queue_name, priority, status, attempt, scheduled_at
      ) VALUES (?, ?, ?, ?, 'created', ?, ?)`,
      [id, taskId, queueName, priority, attempt, scheduledAt]
    );
    return this.getExecution(id)!;
  }

  getExecution(id: string): Execution | null {
    const row = this.db.query("SELECT * FROM executions WHERE id = ?").get(id);
    return row ? rowToExecution(row) : null;
  }

  listExecutions(
    taskId: string,
    opts?: { limit?: number; status?: ExecutionStatus }
  ): Execution[] {
    let sql = "SELECT * FROM executions WHERE task_id = ?";
    const params: unknown[] = [taskId];

    if (opts?.status) {
      sql += " AND status = ?";
      params.push(opts.status);
    }
    sql += " ORDER BY created_at DESC";
    if (opts?.limit) {
      sql += " LIMIT ?";
      params.push(opts.limit);
    }

    return this.db.query(sql).all(...(params as SQLQueryBindings[])).map(rowToExecution);
  }

  updateExecutionStatus(
    id: string,
    status: ExecutionStatus,
    updates?: Partial<Execution>
  ): void {
    const existing = this.getExecution(id);
    if (!existing) throw new ExecutionNotFoundError(id);

    // Validate transition via the core state machine
    validateTransition(existing.status, status, id);

    const fields = ["status = ?"];
    const values: unknown[] = [status];

    if (updates?.startedAt !== undefined) { fields.push("started_at = ?"); values.push(updates.startedAt ?? null); }
    if (updates?.completedAt !== undefined) { fields.push("completed_at = ?"); values.push(updates.completedAt ?? null); }
    if (updates?.durationMs !== undefined) { fields.push("duration_ms = ?"); values.push(updates.durationMs ?? null); }
    if (updates?.output !== undefined) { fields.push("output = ?"); values.push(updates.output ?? null); }
    if (updates?.error !== undefined) { fields.push("error = ?"); values.push(updates.error ?? null); }
    if (updates?.inputTokens !== undefined) { fields.push("input_tokens = ?"); values.push(updates.inputTokens ?? null); }
    if (updates?.outputTokens !== undefined) { fields.push("output_tokens = ?"); values.push(updates.outputTokens ?? null); }
    if (updates?.healthStatus !== undefined) { fields.push("health_status = ?"); values.push(updates.healthStatus); }
    if (updates?.turnCount !== undefined) { fields.push("turn_count = ?"); values.push(updates.turnCount); }
    if (updates?.checkpointData !== undefined) { fields.push("checkpoint_data = ?"); values.push(updates.checkpointData ?? null); }

    values.push(id);
    this.db.run(`UPDATE executions SET ${fields.join(", ")} WHERE id = ?`, values as SQLQueryBindings[]);
  }

  updateExecutionFields(
    id: string,
    updates: Partial<Pick<Execution, "turnCount" | "healthStatus" | "checkpointData">>
  ): void {
    const existing = this.getExecution(id);
    if (!existing) throw new ExecutionNotFoundError(id);

    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.turnCount !== undefined) { fields.push("turn_count = ?"); values.push(updates.turnCount); }
    if (updates.healthStatus !== undefined) { fields.push("health_status = ?"); values.push(updates.healthStatus); }
    if (updates.checkpointData !== undefined) { fields.push("checkpoint_data = ?"); values.push(updates.checkpointData ?? null); }

    if (fields.length === 0) return;

    values.push(id);
    this.db.run(`UPDATE executions SET ${fields.join(", ")} WHERE id = ?`, values as SQLQueryBindings[]);
  }

  /**
   * Atomically dequeue the highest-priority queued execution from the named
   * queue, transition it to `assigned`, and return it.
   *
   * Uses a transaction that reads the current status, validates the state
   * machine transition (queued → assigned), then updates the row.  This
   * prevents silently transitioning executions that are in a non-queued state
   * (e.g. cancelled) if they somehow match the WHERE clause.
   */
  dequeueExecution(queueName: string): Execution | null {
    let result: Execution | null = null;
    this.db.transaction(() => {
      const row = this.db.query(
        `SELECT * FROM executions WHERE queue_name = ? AND status = 'queued'
         ORDER BY priority ASC, created_at ASC LIMIT 1`
      ).get(queueName);
      if (!row) return;
      validateTransition("queued", "assigned");
      const rowId = (row as Record<string, unknown>)["id"] as string;
      this.db.run(
        `UPDATE executions SET status = 'assigned' WHERE id = ?`,
        [rowId]
      );
      const updated = this.db.query(`SELECT * FROM executions WHERE id = ?`).get(rowId);
      result = updated ? rowToExecution(updated) : null;
    })();
    return result;
  }

  getDeadLetteredExecutions(): Execution[] {
    return this.db
      .query("SELECT * FROM executions WHERE status = 'dead_lettered' ORDER BY created_at DESC")
      .all()
      .map(rowToExecution);
  }

  getPendingInputExecutions(): Execution[] {
    return this.db
      .query("SELECT * FROM executions WHERE status = 'waiting_for_input' ORDER BY created_at DESC")
      .all()
      .map(rowToExecution);
  }

  listAllExecutions(opts?: { status?: ExecutionStatus; limit?: number }): Execution[] {
    let sql = "SELECT * FROM executions";
    const params: unknown[] = [];
    if (opts?.status) {
      sql += " WHERE status = ?";
      params.push(opts.status);
    }
    sql += " ORDER BY created_at DESC";
    if (opts?.limit) {
      sql += " LIMIT ?";
      params.push(opts.limit);
    }
    return this.db.query(sql).all(...(params as SQLQueryBindings[])).map(rowToExecution);
  }

  countExecutionsByStatus(status: ExecutionStatus): number {
    const row = this.db
      .query("SELECT COUNT(*) AS count FROM executions WHERE status = ?")
      .get(status) as { count: number } | null;
    return row?.count ?? 0;
  }

  // -------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------

  appendEvent(event: ExecutionEvent): void {
    this.db.run(
      `INSERT INTO events (id, execution_id, event_seq, type, payload, timestamp)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        event.id,
        event.executionId,
        event.eventSeq,
        event.type,
        JSON.stringify(event),
        event.timestamp,
      ]
    );
  }

  listEvents(
    executionId: string,
    opts?: { afterSeq?: number; limit?: number }
  ): ExecutionEvent[] {
    let sql = "SELECT payload FROM events WHERE execution_id = ?";
    const params: unknown[] = [executionId];

    if (opts?.afterSeq !== undefined) {
      sql += " AND event_seq > ?";
      params.push(opts.afterSeq);
    }
    sql += " ORDER BY event_seq ASC";
    if (opts?.limit !== undefined) {
      sql += " LIMIT ?";
      params.push(opts.limit);
    }

    const rows = this.db.query(sql).all(...(params as SQLQueryBindings[])) as Array<{ payload: string }>;
    return rows.map((r) => JSON.parse(r.payload) as ExecutionEvent);
  }

  getMaxEventSeq(executionId: string): number {
    const row = this.db
      .query("SELECT COALESCE(MAX(event_seq), 0) AS max_seq FROM events WHERE execution_id = ?")
      .get(executionId) as { max_seq: number } | null;
    return row?.max_seq ?? 0;
  }

  // -------------------------------------------------------------------------
  // Input Requests
  // -------------------------------------------------------------------------

  createInputRequest(
    request: Omit<InputRequest, "id" | "createdAt">
  ): InputRequest {
    const id = crypto.randomUUID();
    this.db.run(
      `INSERT INTO input_requests (
        id, execution_id, prompt, options, context,
        response, status, timeout_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        request.executionId,
        request.prompt,
        request.options ? JSON.stringify(request.options) : null,
        request.context ?? null,
        request.response ?? null,
        request.status,
        request.timeoutMs,
      ]
    );
    return this.getInputRequestById(id)!;
  }

  getInputRequest(executionId: string): InputRequest | null {
    const row = this.db
      .query(
        "SELECT * FROM input_requests WHERE execution_id = ? AND status = 'pending' ORDER BY created_at ASC LIMIT 1"
      )
      .get(executionId);
    return row ? rowToInputRequest(row) : null;
  }

  respondToInput(executionId: string, response: string): void {
    const pending = this.getInputRequest(executionId);
    if (!pending) throw new InputRequestNotFoundError(executionId);

    this.db.run(
      `UPDATE input_requests
       SET response = ?, status = 'responded', responded_at = datetime('now')
       WHERE id = ?`,
      [response, pending.id]
    );
  }

  getInputRequestById(id: string): InputRequest | null {
    const row = this.db
      .query("SELECT * FROM input_requests WHERE id = ?")
      .get(id);
    return row ? rowToInputRequest(row) : null;
  }

  // -------------------------------------------------------------------------
  // Queues
  // -------------------------------------------------------------------------

  listQueues(): QueueInfo[] {
    const rows = this.db
      .query(
        `SELECT q.name, q.max_concurrency, q.created_at,
           COALESCE(SUM(CASE WHEN e.status = 'queued' THEN 1 ELSE 0 END), 0) AS depth,
           COALESCE(SUM(CASE WHEN e.status IN ('assigned','running','waiting_for_input') THEN 1 ELSE 0 END), 0) AS active_count
         FROM queues q
         LEFT JOIN executions e ON e.queue_name = q.name
         GROUP BY q.name`
      )
      .all() as Array<{
        name: string;
        max_concurrency: number;
        created_at: string;
        depth: number;
        active_count: number;
      }>;

    return rows.map((q) => ({
      name: q.name,
      depth: q.depth,
      activeCount: q.active_count,
      maxConcurrency: q.max_concurrency,
      createdAt: q.created_at,
    }));
  }

  getQueueInfo(name: string): QueueInfo | null {
    const q = this.db.query("SELECT * FROM queues WHERE name = ?").get(name) as {
      name: string;
      max_concurrency: number;
      created_at: string;
    } | null;
    if (!q) return null;

    const depth = (
      this.db
        .query(
          "SELECT COUNT(*) as count FROM executions WHERE queue_name = ? AND status = 'queued'"
        )
        .get(name) as { count: number }
    ).count;
    const active = (
      this.db
        .query(
          "SELECT COUNT(*) as count FROM executions WHERE queue_name = ? AND status IN ('assigned', 'running')"
        )
        .get(name) as { count: number }
    ).count;

    return {
      name: q.name,
      depth,
      activeCount: active,
      maxConcurrency: q.max_concurrency,
      createdAt: q.created_at,
    };
  }

  updateQueueConcurrency(name: string, maxConcurrency: number): QueueInfo | null {
    if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1) {
      throw new Error("maxConcurrency must be a positive integer");
    }
    const existing = this.db.query("SELECT name FROM queues WHERE name = ?").get(name) as { name: string } | null;
    if (!existing) return null;
    this.db.run("UPDATE queues SET max_concurrency = ? WHERE name = ?", [maxConcurrency, name]);
    return this.getQueueInfo(name);
  }

  // -------------------------------------------------------------------------
  // Templates
  // -------------------------------------------------------------------------

  listTemplates(): Template[] {
    return this.db
      .query("SELECT * FROM templates ORDER BY created_at DESC")
      .all()
      .map(rowToTemplate);
  }

  getTemplate(id: string): Template | null {
    const row = this.db.query("SELECT * FROM templates WHERE id = ?").get(id);
    return row ? rowToTemplate(row) : null;
  }

  createTemplate(id: string, input: CreateTemplateInput): Template {
    try {
      this.db.run(
        `INSERT INTO templates (id, name, description, agent_config)
         VALUES (?, ?, ?, ?)`,
        [id, input.name, input.description ?? "", JSON.stringify(input.agentConfig)]
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("UNIQUE constraint failed")) {
        throw new DuplicateEntityError("Template", "name", input.name);
      }
      throw err;
    }
    return this.getTemplate(id)!;
  }

  deleteTemplate(id: string): void {
    const existing = this.getTemplate(id);
    if (!existing) throw new TemplateNotFoundError(id);
    this.db.run("DELETE FROM templates WHERE id = ?", [id]);
  }

  // -------------------------------------------------------------------------
  // Projects
  // -------------------------------------------------------------------------

  listProjects(): Project[] {
    return this.db
      .query("SELECT * FROM projects ORDER BY created_at DESC")
      .all()
      .map(rowToProject);
  }

  getProject(id: string): Project | null {
    const row = this.db.query("SELECT * FROM projects WHERE id = ?").get(id);
    return row ? rowToProject(row) : null;
  }

  createProject(id: string, input: CreateProjectInput): Project {
    try {
      this.db.run(
        `INSERT INTO projects (id, name, description, instructions, working_directory)
         VALUES (?, ?, ?, ?, ?)`,
        [
          id,
          input.name,
          input.description ?? "",
          input.instructions ?? "",
          input.workingDirectory ?? "",
        ]
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("UNIQUE constraint failed")) {
        throw new DuplicateEntityError("Project", "name", input.name);
      }
      throw err;
    }
    return this.getProject(id)!;
  }

  updateProject(id: string, input: Partial<CreateProjectInput>): Project {
    const existing = this.getProject(id);
    if (!existing) throw new ProjectNotFoundError(id);

    const fields: string[] = [];
    const values: unknown[] = [];

    if (input.name !== undefined) { fields.push("name = ?"); values.push(input.name); }
    if (input.description !== undefined) { fields.push("description = ?"); values.push(input.description); }
    if (input.instructions !== undefined) { fields.push("instructions = ?"); values.push(input.instructions); }
    if (input.workingDirectory !== undefined) { fields.push("working_directory = ?"); values.push(input.workingDirectory); }

    if (fields.length === 0) return existing;

    fields.push("updated_at = datetime('now')");
    values.push(id);

    this.db.run(`UPDATE projects SET ${fields.join(", ")} WHERE id = ?`, values as SQLQueryBindings[]);
    return this.getProject(id)!;
  }

  deleteProject(id: string): void {
    const existing = this.getProject(id);
    if (!existing) throw new ProjectNotFoundError(id);

    // project_id FK has ON DELETE SET NULL — SQLite handles unlinking automatically
    this.db.run("DELETE FROM projects WHERE id = ?", [id]);
  }

  // -------------------------------------------------------------------------
  // Threads
  // -------------------------------------------------------------------------

  createThread(id: string, title: string): Thread {
    this.db.run(
      `INSERT INTO threads (id, title) VALUES (?, ?)`,
      [id, title]
    );
    return this.getThread(id)!;
  }

  getThread(id: string): Thread | null {
    const row = this.db.query("SELECT * FROM threads WHERE id = ?").get(id);
    return row ? rowToThread(row) : null;
  }

  listThreads(opts?: { limit?: number }): Thread[] {
    let sql = "SELECT * FROM threads ORDER BY created_at DESC";
    const params: unknown[] = [];
    if (opts?.limit) {
      sql += " LIMIT ?";
      params.push(opts.limit);
    }
    return this.db
      .query(sql)
      .all(...(params as SQLQueryBindings[]))
      .map(rowToThread);
  }

  updateThread(id: string, updates: { title?: string }): Thread {
    const existing = this.getThread(id);
    if (!existing) throw new ThreadNotFoundError(id);

    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.title !== undefined) {
      fields.push("title = ?");
      values.push(updates.title);
    }

    if (fields.length === 0) return existing;

    fields.push("updated_at = datetime('now')");
    values.push(id);

    this.db.run(
      `UPDATE threads SET ${fields.join(", ")} WHERE id = ?`,
      values as SQLQueryBindings[]
    );
    return this.getThread(id)!;
  }

  deleteThread(id: string): void {
    if (id === "00000000-0000-0000-0000-000000000000") {
      throw new Error("The Main thread cannot be deleted");
    }
    const existing = this.getThread(id);
    if (!existing) throw new ThreadNotFoundError(id);
    // thread_id FK on executions is ON DELETE SET NULL — SQLite handles unlinking
    this.db.run("DELETE FROM threads WHERE id = ?", [id]);
  }

  linkExecutionToThread(executionId: string, threadId: string): void {
    const exec = this.getExecution(executionId);
    if (!exec) throw new ExecutionNotFoundError(executionId);

    const thread = this.getThread(threadId);
    if (!thread) throw new ThreadNotFoundError(threadId);

    this.db.run(
      "UPDATE executions SET thread_id = ? WHERE id = ?",
      [threadId, executionId]
    );
  }

  listExecutionsByThread(
    threadId: string,
    opts?: { limit?: number }
  ): Execution[] {
    let sql = "SELECT * FROM executions WHERE thread_id = ? ORDER BY created_at DESC";
    const params: unknown[] = [threadId];
    if (opts?.limit) {
      sql += " LIMIT ?";
      params.push(opts.limit);
    }
    return this.db
      .query(sql)
      .all(...(params as SQLQueryBindings[]))
      .map(rowToExecution);
  }

  // -------------------------------------------------------------------------
  // Thread Messages — chat history for the thread sidebar replay
  // -------------------------------------------------------------------------

  appendThreadMessage(input: AppendThreadMessageInput): ThreadMessage {
    this.db.run(
      `INSERT INTO thread_messages (id, thread_id, role, content, tool_calls)
       VALUES (?, ?, ?, ?, ?)`,
      [input.id, input.threadId, input.role, input.content, input.toolCalls]
    );
    const row = this.db
      .query("SELECT * FROM thread_messages WHERE id = ?")
      .get(input.id);
    return rowToThreadMessage(row as Record<string, unknown>);
  }

  listThreadMessages(threadId: string): ThreadMessage[] {
    const rows = this.db
      .query(
        "SELECT * FROM thread_messages WHERE thread_id = ? ORDER BY created_at ASC"
      )
      .all(threadId as SQLQueryBindings) as Array<Record<string, unknown>>;
    return rows.map(rowToThreadMessage);
  }

  // -------------------------------------------------------------------------
  // Task Messages
  // -------------------------------------------------------------------------

  sendMessage(input: SendMessageInput): void {
    this.db.run(
      `INSERT INTO task_messages (id, execution_id, direction, message_type, payload)
       VALUES (?, ?, ?, ?, ?)`,
      [
        input.id,
        input.executionId,
        input.direction,
        input.messageType,
        input.payload,
      ]
    );
  }

  readMessages(
    executionId: string,
    direction: "inbound" | "outbound",
    status?: "pending" | "delivered" | "acknowledged"
  ): TaskMessage[] {
    let sql =
      "SELECT * FROM task_messages WHERE execution_id = ? AND direction = ?";
    const params: unknown[] = [executionId, direction];

    if (status !== undefined) {
      sql += " AND status = ?";
      params.push(status);
    }

    sql += " ORDER BY created_at ASC";

    const rows = this.db
      .query(sql)
      .all(...(params as SQLQueryBindings[])) as Array<Record<string, unknown>>;
    return rows.map(rowToTaskMessage);
  }

  acknowledgeMessages(messageIds: string[]): void {
    if (messageIds.length === 0) return;
    const placeholders = messageIds.map(() => "?").join(", ");
    this.db.run(
      `UPDATE task_messages SET status = 'acknowledged' WHERE id IN (${placeholders})`,
      messageIds as SQLQueryBindings[]
    );
  }

  readLatestMessage(
    executionId: string,
    direction: "inbound" | "outbound",
    messageType: string
  ): TaskMessage | null {
    // rowid tiebreak is safe here: id is TEXT PRIMARY KEY (not a rowid alias),
    // so SQLite assigns an independent rowid that monotonically increases with
    // insertion order, making it a reliable tie-breaker for same-second rows.
    const row = this.db
      .query(
        `SELECT * FROM task_messages
         WHERE execution_id = ? AND direction = ? AND message_type = ?
         ORDER BY created_at DESC, rowid DESC LIMIT 1`
      )
      .get(executionId, direction, messageType);
    return row ? rowToTaskMessage(row as Record<string, unknown>) : null;
  }

  // -------------------------------------------------------------------------
  // Settings
  // -------------------------------------------------------------------------

  getSetting(key: string): string | null {
    const row = this.db
      .query("SELECT value FROM settings WHERE key = ?")
      .get(key) as { value: string } | null;
    return row?.value ?? null;
  }

  setSetting(key: string, value: string): void {
    this.db.run(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')`,
      [key, value, value]
    );
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  close(): void {
    // Flush WAL before closing
    this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    this.db.close();
  }
}

// ---------------------------------------------------------------------------
// Row mappers — snake_case DB → camelCase TS
// ---------------------------------------------------------------------------

function rowToTask(row: unknown): Task {
  const r = row as Record<string, unknown>;
  const sandboxType = (r["sandbox_type"] as Task["sandboxType"]) ?? "native";
  // executionType is deprecated; map sandbox_type back to a compatible ExecutionType value for callers
  // that still reference the old field. This shim is removed in Phase 5 Plan E cleanup.
  const legacyMap: Record<string, string> = { native: "cloud_code", wasm: "wasm", docker: "cloud_code" };
  return {
    id: r["id"] as string,
    name: r["name"] as string,
    description: r["description"] as string,
    prompt: r["prompt"] as string,
    cronExpression: (r["cron_expression"] as string | null) ?? undefined,
    timeoutMs: r["timeout_ms"] as number,
    executionType: (legacyMap[sandboxType] ?? "cloud_code") as Task["executionType"],
    sandboxType,
    sandboxConfig: r["sandbox_config"]
      ? JSON.parse(r["sandbox_config"] as string)
      : { type: "native" },
    agentConfig: r["agent_config"]
      ? JSON.parse(r["agent_config"] as string)
      : null,
    priority: r["priority"] as Priority,
    targetQueue: r["target_queue"] as string,
    maxRetries: r["max_retries"] as number,
    executionMode: r["execution_mode"] as Task["executionMode"],
    enabled: (r["enabled"] as number) === 1,
    projectId: (r["project_id"] as string | null) ?? null,
    targetThreadId: (r["target_thread_id"] as string | null) ?? null,
    createdAt: r["created_at"] as string,
    updatedAt: r["updated_at"] as string,
  };
}

function rowToTaskMessage(r: Record<string, unknown>): TaskMessage {
  return {
    id: r["id"] as string,
    executionId: r["execution_id"] as string,
    direction: r["direction"] as "inbound" | "outbound",
    messageType: r["message_type"] as string,
    payload: r["payload"] as string,
    status: r["status"] as "pending" | "delivered" | "acknowledged",
    createdAt: r["created_at"] as string,
  };
}

function rowToThreadMessage(r: Record<string, unknown>): ThreadMessage {
  return {
    id: r["id"] as string,
    threadId: r["thread_id"] as string,
    role: r["role"] as "user" | "agent",
    content: (r["content"] as string) ?? "",
    toolCalls: (r["tool_calls"] as string) ?? "[]",
    createdAt: r["created_at"] as string,
  };
}

function rowToExecution(row: unknown): Execution {
  const r = row as Record<string, unknown>;
  return {
    id: r["id"] as string,
    taskId: r["task_id"] as string,
    queueName: r["queue_name"] as string,
    priority: r["priority"] as Priority,
    status: r["status"] as ExecutionStatus,
    attempt: r["attempt"] as number,
    scheduledAt: r["scheduled_at"] as string,
    startedAt: (r["started_at"] as string | null) ?? null,
    completedAt: (r["completed_at"] as string | null) ?? null,
    durationMs: (r["duration_ms"] as number | null) ?? null,
    output: (r["output"] as string | null) ?? null,
    error: (r["error"] as string | null) ?? null,
    inputTokens: (r["input_tokens"] as number | null) ?? null,
    outputTokens: (r["output_tokens"] as number | null) ?? null,
    healthStatus: (r["health_status"] as HealthStatus) ?? "healthy",
    turnCount: (r["turn_count"] as number) ?? 0,
    checkpointData: (r["checkpoint_data"] as string | null) ?? null,
    threadId: (r["thread_id"] as string | null) ?? null,
    createdAt: r["created_at"] as string,
  };
}

function rowToInputRequest(row: unknown): InputRequest {
  const r = row as Record<string, unknown>;
  return {
    id: r["id"] as string,
    executionId: r["execution_id"] as string,
    prompt: r["prompt"] as string,
    options: r["options"]
      ? JSON.parse(r["options"] as string)
      : undefined,
    context: (r["context"] as string | null) ?? undefined,
    response: (r["response"] as string | null) ?? null,
    status: r["status"] as InputRequest["status"],
    timeoutMs: r["timeout_ms"] as number,
    createdAt: r["created_at"] as string,
    respondedAt: (r["responded_at"] as string | null) ?? undefined,
  };
}

function rowToTemplate(row: unknown): Template {
  const r = row as Record<string, unknown>;
  return {
    id: r["id"] as string,
    name: r["name"] as string,
    description: r["description"] as string,
    agentConfig: JSON.parse(r["agent_config"] as string),
    createdAt: r["created_at"] as string,
    updatedAt: r["updated_at"] as string,
  };
}

function rowToProject(row: unknown): Project {
  const r = row as Record<string, unknown>;
  return {
    id: r["id"] as string,
    name: r["name"] as string,
    description: r["description"] as string,
    instructions: r["instructions"] as string,
    workingDirectory: r["working_directory"] as string,
    createdAt: r["created_at"] as string,
    updatedAt: r["updated_at"] as string,
  };
}

function rowToThread(row: unknown): Thread {
  const r = row as Record<string, unknown>;
  return {
    id: r["id"] as string,
    title: r["title"] as string,
    createdAt: r["created_at"] as string,
    updatedAt: r["updated_at"] as string,
  };
}

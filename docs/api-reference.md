# API Reference

All endpoints are served by the Hono HTTP server. Base URL: `http://localhost:3000`.

**Authentication:** If `BAARA_API_KEY` is set, every `/api/*` and `/mcp` request
must include one of:
- Header: `X-Api-Key: <key>`
- Header: `Authorization: Bearer <key>`

**Rate limiting:** Mutation endpoints are capped at 10 requests/minute per IP.
`/mcp` is capped at 300 requests/minute.

**Error format:**

```json
{ "error": "Human-readable description of what went wrong" }
```

---

## Tasks

### `GET /api/tasks`

List all tasks. Optionally filter by project.

**Query params:**
- `projectId` (optional) — UUID; returns only tasks belonging to this project.

**Response `200`:**

```json
[
  {
    "id": "uuid",
    "name": "daily-report",
    "description": "...",
    "prompt": "...",
    "cronExpression": "0 9 * * 1-5",
    "timeoutMs": 120000,
    "sandboxType": "native",
    "sandboxConfig": { "type": "native" },
    "agentConfig": { "model": "claude-sonnet-4-20250514", "allowedTools": ["Bash"] },
    "priority": 2,
    "targetQueue": "transfer",
    "maxRetries": 3,
    "executionMode": "queued",
    "enabled": true,
    "projectId": null,
    "createdAt": "2026-04-02T10:00:00.000Z",
    "updatedAt": "2026-04-02T10:00:00.000Z"
  }
]
```

---

### `GET /api/tasks/:id`

Get a single task by UUID or by name (name lookup falls back if UUID lookup
finds nothing).

**Response `200`:** Task object (same shape as list).

**Response `404`:**

```json
{ "error": "Task not found: \"my-task\"" }
```

---

### `POST /api/tasks`

Create a new task.

**Request body:**

```json
{
  "name": "daily-report",
  "prompt": "Summarise open GitHub issues and post to Slack.",
  "description": "Daily issue summary",
  "cronExpression": "0 9 * * 1-5",
  "timeoutMs": 120000,
  "sandboxType": "native",
  "sandboxConfig": { "type": "native" },
  "agentConfig": {
    "model": "claude-sonnet-4-20250514",
    "allowedTools": ["Bash", "Read", "Write"],
    "maxTurns": 20,
    "budgetUsd": 0.50
  },
  "priority": 2,
  "targetQueue": "transfer",
  "maxRetries": 3,
  "executionMode": "queued",
  "enabled": true,
  "projectId": null
}
```

Required: `name`, `prompt`.

**Response `201`:** Created task object.

**Response `400`:** Missing required field.

**Response `409`:** A task with this name already exists.

---

### `PUT /api/tasks/:id`

Update an existing task. All fields are optional — only provided fields are
changed.

**Request body:** Any subset of `CreateTaskInput` fields.

**Response `200`:** Updated task object.

**Response `404`:** Task not found.

---

### `DELETE /api/tasks/:id`

Delete a task.

**Response `200`:**

```json
{ "ok": true }
```

**Response `404`:** Task not found.

---

### `POST /api/tasks/:id/toggle`

Toggle a task's `enabled` field.

**Response `200`:** Updated task object.

**Response `404`:** Task not found.

---

### `POST /api/tasks/:id/run`

Run a task immediately in direct mode, bypassing the queue. The request blocks
until the execution completes (may take 30+ seconds for agent tasks).

**Response `200`:** Completed `Execution` object.

**Response `404`:** Task not found.

---

### `POST /api/tasks/:id/submit`

Submit a task to the execution queue. Returns immediately with the new
execution in `queued` status.

**Response `201`:** New `Execution` object with `status: "queued"`.

**Response `404`:** Task not found.

---

## Executions

### `GET /api/executions`

List executions. Without `taskId`, returns all executions across all tasks
(newest first, default limit 50).

**Query params:**
- `taskId` (optional) — filter to executions for a specific task.
- `status` (optional) — one of the 11 `ExecutionStatus` values.
- `limit` (optional) — integer, max 1000.

**Response `200`:** Array of `Execution` objects.

---

### `GET /api/executions/pending-input`

Return all executions currently in `waiting_for_input` status.

**Response `200`:** Array of `Execution` objects.

---

### `GET /api/executions/:id`

Get a single execution by UUID.

**Response `200`:**

```json
{
  "id": "uuid",
  "taskId": "task-uuid",
  "queueName": "transfer",
  "priority": 2,
  "status": "running",
  "attempt": 1,
  "scheduledAt": "2026-04-02T10:00:00.000Z",
  "startedAt": "2026-04-02T10:00:01.000Z",
  "completedAt": null,
  "durationMs": null,
  "output": null,
  "error": null,
  "inputTokens": 1240,
  "outputTokens": 328,
  "healthStatus": "healthy",
  "turnCount": 3,
  "checkpointData": null,
  "threadId": null,
  "createdAt": "2026-04-02T10:00:00.000Z"
}
```

**Response `404`:** Execution not found.

---

### `GET /api/executions/:id/events`

Get the event timeline for an execution in ascending `eventSeq` order.

**Query params:**
- `afterSeq` (optional) — return only events with seq > this value (for paging).
- `limit` (optional) — integer, max 500.

**Response `200`:** Array of `ExecutionEvent` objects.

---

### `GET /api/executions/:id/logs`

Get structured JSONL log entries for an execution.

**Query params:**
- `level` (optional) — `info` | `warn` | `error` | `debug`.
- `search` (optional) — case-insensitive text search in log messages.
- `limit` (optional) — integer, max 2000 (default: no limit).
- `offset` (optional) — number of entries to skip (pagination).

**Response `200`:**

```json
{
  "executionId": "uuid",
  "entries": [
    { "ts": "2026-04-02T10:00:01.123Z", "level": "info", "msg": "Agent started", "executionId": "uuid" },
    { "ts": "2026-04-02T10:00:02.456Z", "level": "error", "msg": "Tool call failed: connection refused", "executionId": "uuid" }
  ],
  "total": 2
}
```

**Response `404`:** Execution not found.

---

### `POST /api/executions/:id/cancel`

Cancel a running or queued execution.

**Response `200`:**

```json
{ "ok": true }
```

**Response `404`:** Execution not found.

**Response `409`:** Execution is in a terminal state that does not permit
cancellation (e.g., already `completed`).

---

### `POST /api/executions/:id/retry`

Manually retry a failed or timed-out execution.

**Response `200`:** New `Execution` object for the retry attempt.

**Response `404`:** Execution not found.

---

### `POST /api/executions/:id/input`

Provide a human-in-the-loop response to an execution in `waiting_for_input`
status. The execution transitions back to `running` immediately.

**Request body:**

```json
{ "response": "Yes, proceed with the file deletion." }
```

Required: `response` (string).

**Response `200`:**

```json
{ "ok": true }
```

**Response `400`:** Missing or invalid `response` field.

**Response `404`:** Execution not found.

**Response `409`:** No pending input request exists for this execution.

---

## Queues

### `GET /api/queues`

List all queues with current depth and capacity.

**Response `200`:**

```json
[
  { "name": "transfer", "depth": 2, "activeCount": 1, "maxConcurrency": 5, "createdAt": "..." },
  { "name": "timer",    "depth": 0, "activeCount": 0, "maxConcurrency": 2, "createdAt": "..." },
  { "name": "visibility","depth": 0, "activeCount": 0, "maxConcurrency": 10, "createdAt": "..." },
  { "name": "dlq",      "depth": 1, "activeCount": 0, "maxConcurrency": 1, "createdAt": "..." }
]
```

---

### `GET /api/queues/:name`

Get details for a single queue.

**Response `200`:** Single `QueueInfo` object.

**Response `404`:** Queue not found.

---

### `GET /api/queues/dlq`

List all executions in the dead-letter queue (`dead_lettered` status).

**Response `200`:** Array of `Execution` objects.

---

### `POST /api/queues/dlq/:executionId/retry`

Retry a dead-lettered execution by submitting it again.

**Response `200`:** New `Execution` object.

**Response `404`:** Execution not found.

---

## Chat

### `POST /api/chat`

Send a message and receive a Server-Sent Events (SSE) stream. The agent runs
with all 27 MCP tools available; tool calls appear as inline events in the
stream.

**Request body:**

```json
{
  "message": "Create a task that runs the test suite and report back.",
  "sessionId": "existing-session-uuid-or-omit-for-new",
  "threadId": "existing-thread-uuid-or-omit-for-new",
  "activeProjectId": "project-uuid-or-null"
}
```

Required: `message`. All other fields optional — omit `sessionId` and
`threadId` to start a fresh conversation.

**Response:** `Content-Type: text/event-stream`

See [docs/chat-architecture.md](chat-architecture.md) for the full event type
reference and streaming protocol.

---

### `GET /api/chat/sessions`

List all chat sessions (threads), newest first.

**Response `200`:**

```json
[
  { "id": "uuid", "title": "Create a task that runs the test suite", "createdAt": "...", "updatedAt": "..." }
]
```

---

### `GET /api/chat/sessions/:id`

Get a single session/thread by UUID.

**Response `200`:** Thread object.

**Response `404`:** Session not found.

---

### `PUT /api/chat/sessions/:id/rename`

Rename a thread's title.

**Request body:**

```json
{ "title": "My renamed conversation" }
```

**Response `200`:** Updated thread object.

**Response `400`:** Missing or invalid `title`.

**Response `404`:** Session not found.

---

## System

### `GET /api/health`

Liveness probe. Returns `200` as long as the server process is alive.

**Response `200`:**

```json
{ "status": "ok", "uptime": 3600, "version": "0.1.0" }
```

---

### `GET /api/system/status`

System health snapshot: uptime, queue depths, active counts, DLQ depth, HITL
backlog.

**Response `200`:**

```json
{
  "uptime": 3600,
  "version": "0.1.0",
  "queues": {
    "transfer":   { "depth": 2, "active": 1 },
    "timer":      { "depth": 0, "active": 0 },
    "visibility": { "depth": 0, "active": 0 },
    "dlq":        { "depth": 1, "active": 0 }
  },
  "totals": {
    "queued": 2,
    "active": 1,
    "deadLettered": 1,
    "waitingForInput": 0
  }
}
```

---

## Internal (Agent Transport)

Internal routes are used by production-mode `HttpTransport` agents. They are
protected by the same `BAARA_API_KEY` guard as `/api/*` if a key is configured.
Do not call these from application code — use the orchestrator methods instead.

### `POST /internal/poll`

Agent polls for the next available task assignment.

**Request body:**

```json
{ "agentId": "agent-1", "capabilities": ["llm", "sandbox"] }
```

**Response `200`:** Task assignment object or `null` if the queue is empty.

---

### `POST /internal/start`

Agent transitions an execution to `running` status.

**Request body:**

```json
{ "executionId": "uuid" }
```

**Response `200`:** `{ "ok": true }`

---

### `POST /internal/complete`

Agent reports execution completion with result.

**Request body:**

```json
{
  "executionId": "uuid",
  "result": {
    "status": "completed",
    "output": "Report generated at reports/2026-04-02.md",
    "durationMs": 45200
  }
}
```

**Response `200`:** `{ "ok": true }`

---

### `POST /internal/heartbeat`

Agent liveness ping. Must be called periodically to keep the health monitor
from marking the execution as `unresponsive`.

**Request body:**

```json
{ "agentId": "agent-1", "executionId": "uuid", "turnCount": 5 }
```

**Response `200`:** `{ "ok": true }`

---

### `POST /internal/input-request`

Agent requests human input. Transitions the execution to `waiting_for_input`
and creates a pending `InputRequest`.

**Request body:**

```json
{
  "executionId": "uuid",
  "prompt": "The destination path already exists. Overwrite?",
  "options": ["Yes, overwrite", "No, abort"]
}
```

**Response `200`:** `{ "ok": true }`

---

### `POST /internal/input-poll`

Agent polls for a HITL response. Returns the response if the operator has
answered, otherwise returns `null`.

**Request body:**

```json
{ "executionId": "uuid" }
```

**Response `200`:** `{ "response": "Yes, overwrite" }` or `null`.

---

## MCP

### `POST /mcp`

JSON-RPC 2.0 endpoint for all 27 BAARA Next tools. Supports `initialize`,
`tools/list`, and `tools/call` methods.

See [docs/mcp-integration.md](mcp-integration.md) for the full protocol
description and tool catalog.

**Response `200`:** JSON-RPC 2.0 response object.

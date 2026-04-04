# MCP Integration

BAARA Next exposes 27 tools via the Model Context Protocol (MCP). The same tool
set is available through three transports — pick the one that matches your
client.

---

## Transports

### stdio (Claude Code via `.mcp.json`)

The CLI command `baara mcp-server` starts an MCP server on stdin/stdout
following the JSON-RPC 2.0 protocol. Claude Code reads `.mcp.json` in your
project root to locate it.

Add this to `.mcp.json` in your project:

```json
{
  "mcpServers": {
    "baara-next": {
      "command": "bun",
      "args": ["run", "/path/to/baara-next/packages/cli/src/index.ts", "mcp-server"],
      "env": {
        "ANTHROPIC_API_KEY": "${ANTHROPIC_API_KEY}"
      }
    }
  }
}
```

The `mcp-server` command connects to the same SQLite database as the running
server (default: `~/.baara/baara.db`). You can override this with
`--data-dir`:

```json
{
  "args": ["run", "/path/to/baara-next/packages/cli/src/index.ts", "mcp-server", "--data-dir", "/data/baara"]
}
```

### HTTP (`/mcp`)

The HTTP server exposes an MCP endpoint at `POST /mcp`. Remote clients send
JSON-RPC 2.0 requests in the request body and receive JSON-RPC 2.0 responses.

If `BAARA_API_KEY` is set, the `/mcp` endpoint requires the same auth as
`/api/*` — pass `X-Api-Key: <key>` or `Authorization: Bearer <key>`.

```sh
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

### In-process (chat route)

When the chat SSE endpoint (`POST /api/chat`) handles a request, it creates an
in-process MCP server — a fresh instance per request — and passes it directly
to the Agent SDK `query()` call. No network hop; tool calls execute synchronously
in the same Bun process.

---

## JSON-RPC Protocol

All three transports speak JSON-RPC 2.0. Three methods are supported:

### `initialize`

Handshake. Returns server info and capabilities.

```json
// Request
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}

// Response
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2024-11-05",
    "capabilities": { "tools": {} },
    "serverInfo": { "name": "baara-next", "version": "0.1.0" }
  }
}
```

### `tools/list`

Returns all 27 tools with their name, description, and JSON Schema input spec.

```json
// Request
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}

// Response (abbreviated)
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "tools": [
      { "name": "list_tasks", "description": "...", "inputSchema": { ... } },
      ...
    ]
  }
}
```

### `tools/call`

Invoke a tool by name with its arguments.

```json
// Request
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "create_task",
    "arguments": {
      "name": "daily-report",
      "prompt": "Generate a summary of open GitHub issues and post to Slack."
    }
  }
}

// Response
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": { "ok": true, "data": { "id": "uuid", "name": "daily-report", ... } }
}
```

---

## 27 Tools by Category

### Task Management (6 tools)

| Tool | Description | Required params |
|------|-------------|-----------------|
| `list_tasks` | List all tasks with status, cron, sandbox type, and execution mode | — |
| `get_task` | Get full task details | `nameOrId` |
| `create_task` | Create a new task | `name`, `prompt` |
| `update_task` | Update an existing task | `nameOrId` + any field |
| `delete_task` | Delete a task | `nameOrId` |
| `toggle_task` | Toggle enabled/disabled | `nameOrId` |

**`create_task` parameters:**

```json
{
  "name": "daily-report",
  "prompt": "Summarise open GitHub issues and post to #alerts.",
  "description": "Daily issue summary",
  "cronExpression": "0 9 * * 1-5",
  "sandboxType": "native",
  "sandboxConfig": {},
  "executionMode": "queued",
  "priority": 1,
  "maxRetries": 3,
  "timeoutMs": 120000,
  "allowedTools": ["Bash", "Read"],
  "projectId": "uuid-or-null"
}
```

`sandboxType` values: `"native"` (default), `"wasm"`, `"docker"`.
`priority` values: `0` = critical, `1` = high, `2` = normal, `3` = low.

---

### Execution Management (9 tools)

| Tool | Description | Required params |
|------|-------------|-----------------|
| `run_task` | Execute immediately in direct mode (bypasses queue) | `nameOrId` |
| `submit_task` | Submit to execution queue, return immediately | `nameOrId` |
| `list_executions` | List executions for a task | `taskNameOrId` |
| `get_execution` | Get full execution detail | `executionId` |
| `get_execution_events` | Get event timeline in ascending order | `executionId` |
| `cancel_execution` | Cancel a running or queued execution | `executionId` |
| `retry_execution` | Manually retry a failed or timed-out execution | `executionId` |
| `get_system_status` | Queue depths, task counts, DLQ count | — |
| `get_execution_logs` | Read JSONL log entries with level/search/offset filters | `executionId` |

**`list_executions` parameters:**

```json
{
  "taskNameOrId": "daily-report",
  "status": "failed",
  "limit": 20
}
```

**`get_execution_logs` parameters:**

```json
{
  "executionId": "uuid",
  "level": "error",
  "search": "timeout",
  "limit": 100,
  "offset": 0
}
```

---

### Queue Management (4 tools)

| Tool | Description | Required params |
|------|-------------|-----------------|
| `list_queues` | List all queues with depth, active count, concurrency | — |
| `get_queue_info` | Get details for a specific queue | `name` |
| `dlq_list` | List all dead-lettered executions | — |
| `dlq_retry` | Retry a dead-lettered execution | `executionId` |

Named queues: `transfer`, `timer`, `visibility`, `dlq`.

---

### Human-in-the-Loop (2 tools)

| Tool | Description | Required params |
|------|-------------|-----------------|
| `list_pending_input` | List executions paused, waiting for human input | — |
| `provide_input` | Deliver a response to a blocked execution | `executionId`, `response` |

**`provide_input` example:**

```json
{
  "executionId": "uuid-of-waiting-execution",
  "response": "Yes, proceed with the deletion."
}
```

---

### Templates (2 tools)

| Tool | Description | Required params |
|------|-------------|-----------------|
| `list_templates` | List reusable agent configuration presets | — |
| `create_task_from_template` | Create a task using a template's `agentConfig` | `templateId`, `name`, `prompt` |

Templates store an `AgentConfig` preset (model, allowed tools, system prompt)
that is applied as the base when creating new tasks.

---

### Projects (2 tools)

| Tool | Description | Required params |
|------|-------------|-----------------|
| `list_projects` | List all projects with task counts | — |
| `set_active_project` | Scope task operations to a project | `nameOrId` |

Pass an empty string to `set_active_project` to clear the active project and
return to unscoped mode.

---

### Claude Code Integration (2 tools)

| Tool | Description | Required params |
|------|-------------|-----------------|
| `discover_plugins` | List Claude Code plugins, skills, and agents from `~/.claude/plugins/` | — |
| `run_skill` | Load a skill's markdown content as execution context | `name` |

**`run_skill` example:**

```json
{
  "name": "superpowers:writing-plans",
  "arguments": "--draft"
}
```

The `run_skill` tool reads the skill's markdown file from disk and returns its
full content. This is how chat conversations can invoke installed Claude Code
skills without leaving the BAARA Next interface.

---

## Tool Response Format

All tools return a JSON object with this shape:

```json
// Success
{ "ok": true, "data": { ... } }

// Not found
{ "ok": false, "error": "Task not found: my-task" }

// Failure
{ "ok": false, "error": "Execution failed: connection refused" }
```

The `data` field shape varies per tool — refer to the tool descriptions above or
call `tools/list` to see the full JSON Schema for each input.

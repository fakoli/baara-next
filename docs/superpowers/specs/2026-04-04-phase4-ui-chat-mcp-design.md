# Phase 4 Design Spec: Chat-Centric UI, MCP Control Plane & Pretext Integration

## Context

BAARA Next is a durable agentic task execution engine. Phases 1-3 built the core engine: 9 TypeScript packages, 11-state execution machine, multi-queue processing, retry with backoff, health monitoring, and a working CLI. Phase 4 adds the user-facing surfaces: a chat-centric web UI, an MCP server exposing 27 tools, and SSE streaming — turning the engine into something users actually interact with.

The key differentiator: this is not Temporal. Users don't submit jobs via API requests and structured payloads. They talk to an agent in a chat window, and the agent creates, runs, monitors, and troubleshoots tasks on their behalf — using the same MCP tools that Claude Code can access externally.

---

## User Stories

### Job Submission

- As a user, I can describe a task in natural language in the chat window, and the agent creates and configures it via MCP tools, showing me an inline card with Edit/Run/Disable actions.
- As a user, I can submit a job from the CLI (`baara tasks submit <name>`) to integrate with scripts and automation.
- As a user, I can browse tasks in the right panel and click to run/submit without typing.

### Job Status & Health Monitoring

- As a user, I can see running/queued/failed counts in the header at all times without navigating anywhere.
- As a user, I can see each execution's health status (healthy/slow/unresponsive) with color-coded indicators in the right panel.
- As a user, I am alerted to problems in context — failed executions appear as inline cards in the chat thread where the task was created.

### Troubleshooting & Log Inspection

- As a user, I can click any execution in the right panel to see a tab-based detail view (Overview/Events/Logs/Tools) without leaving the current page.
- As a user, I can search and filter log output within the Logs tab.
- As a user, I can ask the agent "what failed in the last hour?" and get inline execution cards with error details and Retry buttons.
- As a user, I never need to jump between disconnected tools — everything is reachable from either the chat or the right panel.

### Human-in-the-Loop

- As a user, when an execution needs my input, I see an inline HITL card in the chat with a prompt and response field. I type my response and the execution resumes.
- As a user, I can see all pending input requests in the right panel's Executions tab filtered to `waiting_for_input`.

### Dynamic Continuation

- As a user, I can click any completed thread in the left sidebar to load its history and continue the conversation with full prior context.
- As a user, I can act on prior output — branching, extending, or redirecting what already happened.

---

## Architecture

### Layout: Three-Zone Chat-Centric Design

```
+------------+-----------------------------------+--------------------+
| Header: BAARA Next  v0.1.0       3 running . 1 queued . 0 failed SD|
+------------+-----------------------------------+--------------------+
|            |                                   |                    |
| Left       |         Chat Window               |  Right Panel       |
| Sidebar    |         (primary)                  |  (tabbed)          |
|            |                                   |                    |
| Threads    |  Agent messages                   | [Tasks][Execs][Q]  |
| & Sessions |  Inline cards                     |                    |
|            |  Tool indicators                  | Execution list     |
| [New Thread]|  Streaming text                  | with detail view   |
| [collapse] |                                   |                    |
|            |  [message input ----------- Send]  | [collapse]         |
|            |  27 tools . sonnet 4.6 . $0.12    |                    |
+------------+-----------------------------------+--------------------+
```

**Header**: Product name, version badge, right-aligned stats (running/queued/failed with glowing dots), avatar with dropdown menu (appearance, settings, sign out).

**Left sidebar** (collapsible): Thread navigator. Each thread = conversation + linked executions. Grouped by date. Shows title, execution count badge, status indicator, relative timestamp. "New Thread" button. Collapse via `<` button; expand via edge chevron.

**Center — Chat window** (primary, largest pane): SSE streaming messages. Inline cards for tasks, executions, queues, HITL prompts. Tool invocation indicators. Input bar with MCP tool count, model name, session cost. MCP control (which MCPs/plugins are active) lives inside the chat, not the header.

**Right panel** (collapsible, tabbed): Three tabs — Tasks, Executions, Queues. Search/filter bar. Click any item to expand detail view inline. Execution detail has sub-tabs: Overview, Events, Logs, Tools. Collapse via `>` tab; expand via edge chevron.

**Both panels collapse independently**: Chat window expands to fill freed space. User can go full-width chat when focused on conversation.

### Design Language

- **Fonts**: DM Sans (body), JetBrains Mono (code/data)
- **Theme**: Dark — `#0a0a12` deep background, `#111119` surface, `#6366f1` indigo accent
- **Status colors**: Green (`#22c55e`) running/completed, Yellow (`#eab308`) queued, Red (`#ef4444`) failed, Blue (`#3b82f6`) waiting_for_input
- **Cards**: Dark raised backgrounds (`#1a1a25`), contextual border colors, monospace for data fields
- **Transitions**: 200ms ease for panel collapse, 120ms for hover states

---

## MCP Server: 25 Tools, Two Transports

### Package: `packages/mcp` (new)

```
packages/mcp/
  src/
    index.ts              # Barrel + createBaaraMcpServer()
    tools/
      tasks.ts            # list_tasks, get_task, create_task, update_task, delete_task, toggle_task
      executions.ts       # run_task, submit_task, list_executions, get_execution, get_execution_events, cancel_execution, retry_execution
      queues.ts           # list_queues, get_queue_info, dlq_list, dlq_retry
      hitl.ts             # list_pending_input, provide_input, get_execution_logs
      templates.ts        # list_templates, create_task_from_template
      projects.ts         # list_projects, set_active_project
      claude-code.ts      # discover_plugins, run_skill
    server.ts             # HTTP-based MCP endpoint (mounted at /mcp on main server)
    stdio.ts              # stdio-based MCP for `baara mcp-server` CLI command
  package.json
  tsconfig.json
```

### Tool Catalog (27 tools)

**Tier 1 — Core (15 tools)**


| Tool                   | Description                            | Returns                                   |
| ---------------------- | -------------------------------------- | ----------------------------------------- |
| `list_tasks`           | List all tasks with status, cron, mode | Task[] summary                            |
| `get_task`             | Get task by name or ID                 | Task detail                               |
| `create_task`          | Create a new task                      | Task (rendered as inline card)            |
| `update_task`          | Update task fields                     | Task (rendered as inline card)            |
| `delete_task`          | Delete a task                          | Confirmation                              |
| `toggle_task`          | Toggle task enabled/disabled           | Task (rendered as inline card)            |
| `run_task`             | Execute task directly (bypass queue)   | Execution (rendered as inline card)       |
| `submit_task`          | Submit task to queue                   | Execution (rendered as inline card)       |
| `list_executions`      | List executions with optional filters  | Execution[] (rendered as table)           |
| `get_execution`        | Get execution detail                   | Execution (rendered as inline card)       |
| `get_execution_events` | Get event timeline                     | ExecutionEvent[] (rendered as timeline)   |
| `cancel_execution`     | Cancel a running/queued execution      | Confirmation                              |
| `retry_execution`      | Retry a failed execution               | Execution (rendered as inline card)       |
| `get_system_status`    | Get system health overview             | SystemStatus (rendered as mini-dashboard) |
| `get_execution_logs`   | Get filtered log output                | Log lines                                 |


**Tier 2 — Operational (6 tools)**


| Tool                 | Description                                   |
| -------------------- | --------------------------------------------- |
| `list_queues`        | List all queues with depth/active/concurrency |
| `get_queue_info`     | Get queue detail                              |
| `dlq_list`           | List dead-lettered executions                 |
| `dlq_retry`          | Retry a dead-lettered execution               |
| `list_pending_input` | List executions waiting for human input       |
| `provide_input`      | Provide response to a blocked execution       |


**Tier 3 — Power User (6 tools)**


| Tool                        | Description                                        |
| --------------------------- | -------------------------------------------------- |
| `list_templates`            | Browse reusable task templates                     |
| `create_task_from_template` | Create task from template with overrides           |
| `list_projects`             | List projects                                      |
| `set_active_project`        | Scope session to a project                         |
| `discover_plugins`          | Discover Claude Code plugins/skills/agents         |
| `run_skill`                 | Execute a Claude Code skill from within BAARA chat |


### Dual Transport

**In-process (web UI chat)**: The MCP server is created via `createSdkMcpServer()` from the Agent SDK and passed directly to `query()` as `mcpServers: { baara: server }`. Tools call `IStore` and `IOrchestratorService` directly — no HTTP, no serialization.

**HTTP endpoint (`/mcp`)**: Mounted on the main Hono server. Remote clients (including Claude Code via `.mcp.json`) connect here. Same tool definitions, but wrapped in HTTP request/response.

**stdio (`baara mcp-server`)**: A CLI command that starts a stdio-based MCP server. Claude Code connects via:

```json
{
  "mcpServers": {
    "baara": {
      "command": "baara",
      "args": ["mcp-server", "--data-dir", "~/.baara"]
    }
  }
}
```

This gives Claude Code users full access to the 27 tools from their terminal without opening the web UI.

---

## Chat Architecture

### SSE Streaming

```
POST /api/chat { message, sessionId?, threadId? }
  |
  v
gatherChatContext()
  - task counts, queue depths, recent failures, active project
  - thread-specific execution history (if threadId provided)
  |
  v
buildSystemPrompt(context)
  - Identity: "You are BAARA Next, a durable task execution assistant"
  - Capabilities: 27 tools available, what each does
  - Defaults: execution type defaults to cloud_code, mode to queued, etc.
  - Live state: running/queued/failed counts, recent errors
  - Thread context: prior executions in this thread
  |
  v
Agent SDK query() with:
  - systemPrompt: dynamic (above)
  - mcpServers: { baara: inProcessMcpServer }
  - maxTurns: 20
  - budgetUsd: 0.50
  - streaming: true
  |
  v
SSE stream events to browser:
  - system:      { tools, sessionId, threadId }
  - text_delta:  { delta: "I'll create..." }
  - tool_use:    { name: "create_task", input: {...} }
  - tool_result: { name: "create_task", output: Task }
  - result:      { usage: { inputTokens, outputTokens }, cost }
  - done:        {}
```

### Inline Cards

When a tool returns structured data, the frontend detects the type and renders a rich card:


| Tool Result      | Card Type             | Actions                     |
| ---------------- | --------------------- | --------------------------- |
| Task object      | Task card             | Edit, Run Now, Disable      |
| Execution object | Execution card        | View Details, Retry, Cancel |
| Execution[]      | Compact table         | Click row to expand         |
| QueueInfo[]      | Queue summary bars    | —                           |
| SystemStatus     | Health mini-dashboard | —                           |
| InputRequest     | HITL prompt           | Response input + Submit     |


**Card actions** send follow-up messages to the chat. Clicking "Run Now" on a task card sends `"Run task <name> now"` — the agent processes it conversationally, keeping the interaction unified.

### Sessions & Threads

**Thread** = a logical grouping of a conversation and its linked executions.

**Database additions:**

- `threads` table: `id`, `title`, `created_at`, `updated_at`
- `executions` table gains `thread_id` column (nullable FK to threads)
- Agent SDK sessions stored at `~/.baara/sessions/`, tagged with `thread_id`

**Thread lifecycle:**

1. User clicks "New Thread" → creates thread record, opens empty chat
2. User sends message → creates Agent SDK session linked to thread
3. Agent creates/runs tasks → resulting executions linked to thread via `thread_id`
4. User clicks completed thread → loads conversation history + execution results
5. User types new message → conversation resumes with full prior context

---

## Pretext Integration

### Where Used

Pretext (`@chenglou/pretext`) provides pre-DOM text measurement for three components with variable-height content:


| Component                | Why Pretext                                                                                                             | Measurement                                                                       |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| **Chat message feed**    | Messages vary wildly (one-liners to multi-paragraph with code). Virtual scrolling needs accurate heights before render. | `prepare(messageText, '13.5px DM Sans')` + `layout(prepared, containerWidth, 21)` |
| **Execution log viewer** | Hundreds of log lines with variable lengths. Prevents "jumping scroll" during tailing.                                  | `prepare(logLine, '12px JetBrains Mono')` + `layout(prepared, logWidth, 18)`      |
| **Event timeline**       | Event payloads vary (short heartbeat vs long tool invocation). Smooth scrolling through variable-height cards.          | `prepare(payloadText, '12px JetBrains Mono')` + `layout(prepared, cardWidth, 18)` |


### `usePretext` Hook

```typescript
import { prepare, layout } from '@chenglou/pretext';
import { useState, useEffect, useRef } from 'react';

export function usePretext(text: string, font: string, lineHeight: number) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  const preparedRef = useRef(prepare(text, font));

  useEffect(() => {
    preparedRef.current = prepare(text, font);
  }, [text, font]);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width;
      const result = layout(preparedRef.current, width, lineHeight);
      setHeight(result.height);
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [lineHeight]);

  return { containerRef, height };
}
```

### Where NOT Used

Dashboard stat cards, task tables, queue metrics, forms, modals — all fixed-height or CSS-managed. Pretext adds no value there.

### Font Matching

Pretext font strings must exactly match CSS declarations:

- Chat messages: `'13.5px DM Sans'` (matches `font-size: 13.5px; font-family: 'DM Sans'`)
- Code/logs: `'12px JetBrains Mono'` (matches `font-size: 12px; font-family: 'JetBrains Mono'`)

Font loading: call `prepare()` only after `document.fonts.ready` resolves. If fonts load late, call `clearCache()` and re-prepare.

---

## Right Panel: Execution Detail (Tab-Based)

When a user clicks an execution in the right panel's Executions tab, the detail view expands inline within the panel:

### Overview Tab

- Status badge (color-coded), duration, attempt count, token usage (4 stat cards in 2x2 grid)
- Error box if failed (red background, monospace error text)
- Action buttons: Retry, Cancel, View in Chat
- Task info: name, type, prompt preview

### Events Tab

- Vertical timeline of execution events
- Each event: timestamp, type badge, expandable payload
- Pretext used for variable-height payload sizing
- Auto-scrolls to latest for running executions

### Logs Tab

- Raw stdout/stderr output
- Search bar (text filter within log content)
- Pretext used for virtualized line rendering
- Copy button for full output

### Tools Tab

- List of MCP tools invoked during execution
- Each: tool name, input params (collapsed), output (collapsed), duration
- Expandable per-invocation

---

## CLI Parity

Every action available in the web UI is also available via CLI:


| Web UI Action                         | CLI Equivalent                                |
| ------------------------------------- | --------------------------------------------- |
| Chat message                          | `baara chat` (interactive REPL)               |
| Create task (via chat or right panel) | `baara tasks create <name> --prompt "..."`    |
| Run task                              | `baara tasks run <name>`                      |
| Submit to queue                       | `baara tasks submit <name>`                   |
| View execution detail                 | `baara executions inspect <id>`               |
| View event timeline                   | `baara executions events <id>`                |
| Cancel execution                      | `baara executions cancel <id>`                |
| Retry execution                       | `baara executions retry <id>`                 |
| Provide HITL input                    | `baara executions respond <id> --input "..."` |
| View pending input                    | `baara executions pending-input`              |
| View queues                           | `baara queues list`                           |
| DLQ retry                             | `baara queues dlq retry <id>`                 |
| System status                         | `baara admin health`                          |
| Connect MCP to Claude Code            | `baara mcp-server` (stdio)                    |


---

## New Packages & Files

### New: `packages/mcp`

25 MCP tool definitions + dual transport (in-process + stdio)

### Modified: `packages/server`

- `src/routes/chat.ts` — full SSE streaming implementation (replaces 501 stub)
- `src/app.ts` — mount `/mcp` endpoint

### Modified: `packages/web`

- Complete rewrite of chat-centric layout
- New components: InlineCard, ToolIndicator, ThreadList, ChatMessage, usePretext hook
- Pretext dependency added

### Modified: `packages/cli`

- `src/commands/mcp-server.ts` — new `baara mcp-server` command
- `src/commands/chat.ts` — interactive REPL chat (like original BAARA)

### Modified: `packages/core`

- `src/types.ts` — add `Thread` type
- `src/interfaces/store.ts` — add thread CRUD methods

### Modified: `packages/store`

- `src/sqlite-store.ts` — add `threads` table, `thread_id` column on executions
- `src/migrations.ts` — migration for thread schema

---

## Verification Plan

1. `baara start` boots with MCP server active
2. Open web UI → chat-centric layout loads with three zones
3. Type "create a task that echoes hello every minute" → agent creates task, inline card appears
4. Click "Run Now" on the card → agent runs, execution card appears with output
5. Collapse left panel → chat expands full-width
6. Collapse right panel → chat fills entire width
7. Click a thread in left sidebar → conversation history loads
8. Type new message in loaded thread → conversation resumes
9. Right panel Executions tab → click failed execution → Overview tab shows error → Logs tab shows output
10. From Claude Code terminal: configure `.mcp.json` with `baara mcp-server` → `mcp__baara__list_tasks` works
11. `baara chat` in CLI → interactive REPL with same MCP tools
12. Header stats update in real-time via WebSocket


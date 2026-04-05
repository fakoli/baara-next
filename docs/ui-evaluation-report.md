# BAARA Next — Web UI Evaluation Report

**Date:** 2026-04-05
**Version:** v0.1.0
**URL:** http://localhost:5173/ (Vite dev server) backed by http://localhost:3000 (API server)

---

## Executive Summary

The BAARA Next web UI is functional and well-structured. The three-zone layout (ThreadList, ChatWindow, ControlPanel) works correctly with proper collapse/expand behavior. Chat, task management, thread navigation, and execution monitoring all operate as expected. Three defects were identified, none critical.

---

## Test Results

### 1. Layout and Rendering

| Feature | Status | Notes |
|---------|--------|-------|
| Three-zone layout | PASS | Header + ThreadList + ChatWindow + ControlPanel |
| Header status indicators | PASS | 0 running (green), 0 queued (yellow), 0 failed (red) |
| Left sidebar collapse/expand | PASS | ThreadList collapses; expand button appears on left edge |
| Right panel collapse/expand | PASS | ControlPanel collapses; expand button appears on right edge |
| Both panels collapsed | PASS | ChatWindow fills full width; no overflow |
| Re-expansion | PASS | Both panels restore correctly from collapsed state |
| Responsive content centering | PASS | Welcome screen centers in available space |
| User avatar | PASS | "SD" initials displayed correctly |

### 2. Chat Interface

| Feature | Status | Notes |
|---------|--------|-------|
| Message input field | PASS | Placeholder "Message BAARA Next...", accepts text |
| Send via Enter key | PASS | Submits message and clears input |
| Send via button | PASS | Blue arrow button submits |
| Quick action buttons | PASS | 4 buttons on welcome screen send pre-defined messages |
| SSE streaming | PASS | Agent response streams in with cursor animation |
| Tool call pills | PASS | Rendered as checkmark + name pills with completion status |
| Tool call detail labels | PASS | e.g., "mcp_baara__create_task — test-ping" shows name |
| Agent text bubble | PASS | Dark background, proper line height and padding |
| User text bubble | PASS | Accent-colored background, right-aligned |
| Bold text rendering | PASS | `**bold**` renders correctly |
| Emoji rendering | PASS | Checkmark and chart emojis display properly |
| Code inline rendering | PASS | Backtick code renders with distinct background |
| Session cost tracking | PASS | Updates from $0.00 as messages are sent |
| Markdown table rendering | **FAIL** | Tables render as raw pipe-delimited text (see Defect #1) |
| Tool result blocks | OBSERVATION | Show `"(completed)"` string; actual data in agent text |

### 3. Thread Management

| Feature | Status | Notes |
|---------|--------|-------|
| Create new thread (+ New) | PASS | Creates "New Thread" entry, resets chat to welcome |
| Thread list grouping | PASS | "Main" pinned at top, "TODAY" group for recent threads |
| Thread title from first message | PASS | Title auto-set from first message (truncated) |
| Switch between threads | PASS | Full conversation history loads correctly |
| Session cost reset on thread switch | PASS | New thread shows $0.00 |
| Thread timestamp display | PASS | "just now" relative timestamps |

### 4. Task Management

| Feature | Status | Notes |
|---------|--------|-------|
| Create task via chat | PASS | Natural language creates task with correct settings |
| List tasks via chat | PASS | Shows all tasks with full detail |
| Delete task via chat | PASS | Removes task; ControlPanel updates immediately |
| Task output routing to thread | PASS | Execution output lands as agent message in target thread |
| ControlPanel real-time refresh | PASS | Task count updates after create/delete without manual refresh |

### 5. ControlPanel Tabs

| Feature | Status | Notes |
|---------|--------|-------|
| Tasks tab | PASS | Shows task count, filter input, "+ New" button, task list |
| Tasks — click to edit | PASS | Expands inline task editor with all fields |
| Tasks — "+ New" form | PASS | Shows empty form with sensible defaults |
| Tasks — "Run" button | PASS | Visible on task items for immediate execution |
| Tasks — editor fields | PASS | Name, Prompt, Pre-request Instructions, all config fields |
| Tasks — Agent Config section | PASS | Model, Allowed Tools, Budget (USD) |
| Tasks — Output Thread selector | PASS | Dropdown with available threads |
| Tasks — Save/Cancel buttons | PASS | Visible at bottom of editor form |
| Execs tab | PASS | Shows executions with status badge, duration, timestamp |
| Execs — filter input | PASS | "Filter execs..." input available |
| Execs — click for detail | PASS | Expands execution detail with 4 sub-tabs |
| Execs — Overview sub-tab | PASS | Status, duration, attempt, tokens, health badge |
| Execs — Events sub-tab | PASS | Timeline: created → queued → assigned → completed |
| Execs — Logs sub-tab | PASS | Search filter + execution output text |
| Execs — Tools sub-tab | PASS | Shows tool invocations (or "No tool invocations") |
| Queues tab | PASS | All 4 queues: dlq, timer, transfer, visibility |
| Queues — queue cards | PASS | Name, description, capacity bar, active/max counts |
| Queues — filter input | PASS | "Filter queues..." input available |

### 6. Footer Status Bar

| Feature | Status | Notes |
|---------|--------|-------|
| Permission mode toggle | PASS | Cycles: Auto (green) → Ask (yellow) → Locked (red) |
| Tool count indicator | PASS | "27 tools" with green dot |
| Model selector | PASS | "sonnet 4.6" dropdown |
| System instructions tag | PASS | Gear icon with "System" label |
| Session cost display | PASS | "$X.XX this session" updates on each message |

---

## Defects

### Defect #1 — Markdown Tables Not Rendered (Medium)

**Location:** `packages/web/src/components/ChatMessage.tsx:161`
**Description:** Agent responses containing markdown tables (pipe-delimited syntax) render as raw text instead of formatted HTML tables.
**Root Cause:** The `react-markdown` library (v10.1.0) is installed but the `remark-gfm` plugin is not. Without `remark-gfm`, GitHub Flavored Markdown features (tables, strikethrough, task lists) are not supported.
**Fix:**
1. `bun add remark-gfm` in `packages/web`
2. Update ChatMessage.tsx:
   ```tsx
   import remarkGfm from 'remark-gfm';
   <Markdown remarkPlugins={[remarkGfm]}>{message.text}</Markdown>
   ```
3. Add CSS for table styling in the `.chat-markdown` class.

### Defect #2 — "Execution Type" Label Uses Deprecated Terminology (Low)

**Location:** `packages/web/src/components/TaskEditor.tsx` (task edit form)
**Description:** The task editor form labels the sandbox selection field as "Execution Type" and shows values like `cloud_code`. Per CLAUDE.md and Migration 3, the canonical name is "Sandbox Type" with values `native`, `wasm`, `docker`. The old `ExecutionType` / `cloud_code` terminology is deprecated.
**Fix:** Rename label from "Execution Type" to "Sandbox Type" and map dropdown values to `native`/`wasm`/`docker`.

### Defect #3 — New Task Form Defaults to Deprecated "cloud_code" (Low)

**Location:** `packages/web/src/components/TaskEditor.tsx` (new task form)
**Description:** The "+ New" task creation form defaults the execution type to `cloud_code` instead of `native`. This is consistent with Defect #2 — the form uses the old value set.
**Fix:** Change default value to `native` when updating the label per Defect #2.

---

## Observations (Non-Defects)

1. **Tool result blocks show "(completed)"** — Both ToolSearch and MCP tool results render as `"(completed)"` text blocks. The InlineCard component renders specialized cards for known tools (create_task, run_task, etc.), but generic tool results only show the completion string. This may be intentional to keep the UI clean, but showing a collapsible JSON block for the raw result could improve debuggability.

2. **Thread title truncation** — Long thread titles are truncated with "..." in the sidebar. This is expected behavior given the sidebar width constraints.

3. **Welcome screen disappears on first message** — The welcome screen with quick actions is replaced by the chat view after the first message. There is no way to return to it within the same thread. This is standard chat UI behavior.

---

## Feature Catalogue (Confirmed Working)

For building the Playwright test framework, the following features are confirmed operational:

### Chat Features
- [ ] Send message via input + Enter
- [ ] Send message via send button
- [ ] Quick action buttons on welcome screen
- [ ] SSE streaming with cursor animation
- [ ] Tool call pill rendering with checkmarks
- [ ] Agent response text rendering (bold, code, emoji)
- [ ] Session cost accumulation
- [ ] Multi-turn conversation continuity

### Thread Features
- [ ] Create new thread via "+ New"
- [ ] Switch between threads (loads history)
- [ ] Thread title auto-generation from first message
- [ ] Thread grouping (Main pinned, TODAY section)

### Task Management Features
- [ ] Create task via chat
- [ ] List tasks via chat
- [ ] Delete task via chat
- [ ] Task output routing to designated thread
- [ ] ControlPanel auto-refresh on task CRUD

### ControlPanel Features
- [ ] Tab switching (Tasks, Execs, Queues)
- [ ] Tasks: list, filter, edit, create new
- [ ] Execs: list, filter, detail view (Overview/Events/Logs/Tools)
- [ ] Queues: list with capacity info

### Layout Features
- [ ] Left sidebar collapse/expand
- [ ] Right panel collapse/expand
- [ ] Both collapsed simultaneously
- [ ] Permission mode cycling (Auto/Ask/Locked)
- [ ] Model selector dropdown

---

## CLI Evaluation

### CLI Test Results

| Command | Status | Notes |
|---------|--------|-------|
| `baara --help` | PASS | Lists all commands: start, tasks, executions, queues, admin, mcp-server, chat |
| `baara --version` | PASS | Shows version number |
| `baara tasks list` | PASS | Formatted table: ID, Name, Type, Mode, Status, Priority |
| `baara tasks get <name>` | PASS | Resolves by name or UUID; shows full task detail |
| `baara tasks get --json` | PASS | JSON output mode works |
| `baara tasks create` | PASS | Creates task, returns UUID |
| `baara tasks run <name>` | PASS | Executes task directly |
| `baara tasks delete <name>` | **FAIL** | Does not resolve by name — requires full UUID (see Defect #4) |
| `baara exec list --task-id <id>` | PASS | Lists executions for a task; supports `--json` |
| `baara exec inspect <id>` | PASS (full UUID only) | Shows execution detail; short ID prefix fails (see Defect #4) |
| `baara exec events <id>` | PASS (full UUID only) | Shows event timeline (seq, type, timestamp) |
| `baara queues list` | PASS | Formatted table: Name, Depth, Active, Max Concurrency, Created |
| `baara admin health` | PASS | Status summary: queues, executions, dead-lettered, waiting |
| `baara admin config` | PASS | Shows data dir, DB path, version, system prompt |

### CLI Defect

### Defect #4 — CLI ID Resolution Inconsistent (Medium)

**Location:** `packages/cli/src/commands/tasks.ts`, `packages/cli/src/commands/executions.ts`
**Description:** CLI `list` commands display truncated 8-char IDs, but most mutation/inspection commands require the full UUID. Only `tasks get` has a name-fallback. Commands `delete`, `enable`, `disable`, `exec inspect`, `exec events`, `exec cancel`, `exec retry` all fail with short IDs or task names.
**Impact:** Users must copy full UUIDs from `--json` output to use most commands, defeating the purpose of the truncated display.
**Fix:** Add a `resolveTaskId(store, input)` helper that tries: (1) exact UUID match, (2) prefix match, (3) name match. Apply to all task-accepting commands. Add similar `resolveExecutionId` for execution commands.

---

## Resolution Log

| Defect | Status | Resolution |
|--------|--------|------------|
| #1 — Markdown tables | **FIXED** | Installed `remark-gfm@4.0.1`, added `remarkPlugins={[remarkGfm]}` to `<Markdown>` in ChatMessage.tsx |
| #2 — "Execution Type" label | Open | Rename to "Sandbox Type" in TaskEditor.tsx |
| #3 — Default "cloud_code" | Open | Change default to "native" in TaskEditor.tsx |
| #4 — CLI ID resolution | Open | Add prefix/name resolution helpers |

---

## Next Steps

1. **Fix Defects #2 & #3** (deprecated terminology) — cosmetic but important for consistency
2. **Fix Defect #4** (CLI ID resolution) — usability improvement for CLI users
3. **Build Playwright test suite** using the feature catalogue above
4. **MCP integration review** — covers both UI config and CLI `mcp-server` command

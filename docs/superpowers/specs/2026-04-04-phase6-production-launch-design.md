# Phase 6 Design Spec: Smoke Tests, Documentation & GitHub Launch

## Context

BAARA Next Phases 1-5 are complete: 10 packages, 143 TypeScript files, all typecheck clean. The engine works end-to-end in dev mode. Phase 6 ships it: automated smoke tests, comprehensive documentation, updated CLAUDE.md, and a public GitHub launch.

## Decisions

| Decision | Choice |
|----------|--------|
| Production multi-process mode | Deferred — single-process dev mode is sufficient for launch |
| Test level | Smoke tests (10 tests covering critical paths) |
| README style | Layered — product hook + quick start on top, technical depth in docs/ |
| GitHub repo | `baara-next` — public |

---

## Part 1: Smoke Test Suite

**Location:** `tests/smoke/` at the monorepo root

**Runner:** Bun's built-in test runner (`bun test`)

**Pattern:** Each test starts a real server in-process, runs the scenario via HTTP, and tears down.

### Test List (10 tests)

| # | File | What it tests |
|---|------|---------------|
| 1 | `01-boot.test.ts` | `baara start` boots, `GET /api/health` returns 200 with `{ status: "ok" }` |
| 2 | `02-task-crud.test.ts` | POST create → GET list → GET by name → PUT update → DELETE → verify gone |
| 3 | `03-submit-execute.test.ts` | Create shell task → POST submit → wait → GET execution shows `completed` with output |
| 4 | `04-retry-dlq.test.ts` | Create failing task (maxRetries=2) → submit → wait → verify `dead_lettered` execution exists |
| 5 | `05-direct-run.test.ts` | POST `/api/tasks/:id/run` → returns completed execution with output inline |
| 6 | `06-mcp-endpoint.test.ts` | POST `/mcp` with `initialize` → `tools/list` (27 tools) → `tools/call create_task` |
| 7 | `07-chat-sse.test.ts` | POST `/api/chat` → read SSE stream → verify `system` event + at least one `text` event |
| 8 | `08-thread-model.test.ts` | POST `/api/chat` → verify thread created → GET `/api/chat/sessions` returns it |
| 9 | `09-sandbox-config.test.ts` | Create task with `sandboxType: "wasm"` + `sandboxConfig` → GET task → verify stored correctly |
| 10 | `10-logs-api.test.ts` | Run task → GET `/api/executions/:id/logs` → verify JSONL entries returned |

### Test Helper

`tests/smoke/helpers.ts`:
- `startServer(opts?)` → boots the server in-process, returns `{ baseUrl, cleanup }`
- `waitForExecution(baseUrl, execId, targetStatus, timeoutMs)` → polls until status matches
- `fetch(path)` wrapper with baseUrl

### Configuration

`tests/smoke/bunfig.toml` or root-level test config:
```toml
[test]
root = "tests/smoke"
timeout = 30000
```

Environment: `BAARA_SHELL_ENABLED=true`, temp data dir per test (cleaned up after).

---

## Part 2: Documentation

### `README.md` (root of baara-next/)

1. **Hero**: `# BAARA Next` + tagline: "Durable agentic task execution engine" + badges (TypeScript, Bun, MIT)
2. **What is BAARA Next?**: 3 sentences — run durable agent tasks that survive crashes, control them through a chat-centric UI or Claude Code, pluggable sandbox isolation
3. **Quick Start**: 4 commands — clone, install, start, open browser
4. **Features**: Bullet list of key capabilities
5. **Architecture**: Simplified component diagram, link to `docs/architecture.md`
6. **Claude Code Integration**: `.mcp.json` snippet, link to `docs/mcp-integration.md`
7. **CLI Quick Reference**: Command table
8. **Contributing**: Link to `docs/contributing.md`
9. **License**: MIT

### `docs/` directory

| File | Content |
|------|---------|
| `architecture.md` | 10-package overview, component diagram, data flow (task → queue → agent → sandbox → result), state machine (11 states with diagram), event sourcing model |
| `sandbox-guide.md` | ISandbox interface, NativeSandbox/WasmSandbox/DockerSandbox, how to implement a new sandbox, SandboxConfig options, resource limits |
| `mcp-integration.md` | Connecting from Claude Code (stdio .mcp.json), HTTP endpoint (/mcp), 27-tool catalog with descriptions and parameter schemas |
| `api-reference.md` | Every REST endpoint: method, path, request body, response body, status codes. Grouped by: tasks, executions, queues, chat, system, internal, mcp |
| `chat-architecture.md` | SSE streaming protocol, event types, inline card rendering, thread model, session management |
| `durability.md` | Checkpoint model, recovery flow, Temporal comparison table, what is/isn't recovered |
| `configuration.md` | config.toml reference, all environment variables (BAARA_API_KEY, BAARA_SHELL_ENABLED, etc.), CLI flags |
| `contributing.md` | Prerequisites (Bun), dev setup, running tests, package overview, code style, PR guidelines |

### `CLAUDE.md` update

Refresh to reflect current state: 10 packages, sandbox architecture, 27 MCP tools, MessageBus, CheckpointService, all commands, all conventions.

---

## Part 3: Git Init + GitHub Launch

### Steps

1. `cd baara-next && git init`
2. Update `.gitignore` — add `.superpowers/` (brainstorm artifacts)
3. `git add -A && git commit` — single initial commit
4. `gh repo create fakoli/baara-next --public --description "Durable agentic task execution engine" --source . --push`

### Commit message

```
feat: BAARA Next — durable agentic task execution engine

10-package TypeScript/Bun monorepo:
- Orchestrator with 11-state execution machine, multi-queue, exponential backoff
- Pluggable sandbox architecture (Native, Wasm/Extism, Docker stub)
- 27-tool MCP server (HTTP + stdio transports)
- Chat-centric web UI (React/Vite/Tailwind, SSE streaming, inline cards)
- Conversation-level checkpointing with crash recovery
- JSONL logging with real-time WebSocket streaming
- Thread model linking conversations to executions
- CLI with full parity (chat REPL, mcp-server, task management)
```

---

## Verification

1. `bun test` — all 10 smoke tests pass
2. `bun run typecheck` — all 10 packages pass
3. `bun start` — boots cleanly, web UI loads at localhost:3000
4. README renders correctly on GitHub
5. `.mcp.json` example works with Claude Code

# Herald Agent Status

**Date:** 2026-04-02
**Task:** Phase 6 Plan B — Write all documentation for BAARA Next GitHub launch

## Status: COMPLETE

All documentation files have been written with real, accurate content drawn
from source code.

---

## Files Written

### Monorepo root
- `README.md` — Hero + badges + 4-command quick start + features + ASCII
  architecture diagram + Claude Code `.mcp.json` example + CLI table +
  configuration table + docs index

### `docs/`
- `docs/architecture.md` — 10-package table, full component diagram (ASCII),
  6-step data flow, 11-state machine diagram, hybrid event sourcing model,
  sandbox architecture diagram
- `docs/sandbox-guide.md` — Full ISandbox/SandboxInstance/SandboxExecuteResult
  TypeScript definitions, 3 implementations (Native/Wasm/Docker), 4-step guide
  to adding a new sandbox type, SandboxConfig options per type, resource limits
  table
- `docs/mcp-integration.md` — 3 transports (stdio/.mcp.json, HTTP /mcp,
  in-process), JSON-RPC protocol (initialize/tools/list/tools/call examples),
  all 27 tools in 7 groups with descriptions, required params, and example
  payloads
- `docs/api-reference.md` — Every endpoint: Tasks (8), Executions (8), Queues
  (4), Chat (4), System (2), Internal (6), MCP (1). Full request body, response
  format, and status codes.
- `docs/chat-architecture.md` — SSE streaming protocol, all 7 event types with
  JSON examples, inline card rendering table, thread model, session continuity
  (resume vs new), session file management
- `docs/durability.md` — Temporal comparison table, checkpoint model (full
  TypeScript interface), CheckpointService API, 5-step recovery flow, recovery
  system prompt example, what IS recovered / what is NOT recovered, IMessageBus
  checkpoint methods
- `docs/configuration.md` — All env vars (ANTHROPIC_API_KEY, BAARA_API_KEY,
  BAARA_AUTH_MODE, BAARA_SHELL_ENABLED, PORT, HOST, NEXUS_DIR), bun start CLI
  flags, global CLI flags, per-command flags for all 7 commands, data directory
  layout, minimal production setup
- `docs/contributing.md` — Prerequisites, 3-command dev setup, test commands,
  10-package overview table, code conventions (strict TS, no any, ISandbox
  pattern, SQL in store only), PR guidelines, project structure

### Updated
- `CLAUDE.md` — Refreshed for Phases 2-5: 10 packages, SandboxType/SandboxConfig
  (not ExecutionType), 27 MCP tools (not 19), ISandbox/IMessageBus interfaces,
  CheckpointService, SandboxRegistry, state machine transitions, all current CLI
  commands

---

## Source Files Read

All content was derived from live source code. No invented capabilities.

- `packages/core/src/types.ts` — SandboxType, SandboxConfig, ExecutionStatus,
  Task, Execution, Checkpoint, SandboxEvent, InboundCommand, TaskMessage
- `packages/core/src/state-machine.ts` — VALID_TRANSITIONS map (11 states)
- `packages/core/src/interfaces/sandbox.ts` — ISandbox, SandboxInstance
- `packages/core/src/interfaces/store.ts` — IStore (all methods)
- `packages/core/src/interfaces/message-bus.ts` — IMessageBus
- `packages/server/src/app.ts` — middleware, route mounting, auth, rate limiting
- `packages/server/src/routes/tasks.ts` — task route handlers
- `packages/server/src/routes/executions.ts` — execution route handlers
- `packages/server/src/routes/chat.ts` — SSE streaming, event types
- `packages/server/src/routes/system.ts` — health, status
- `packages/server/src/routes/internal.ts` — poll, start, complete, heartbeat, HITL
- `packages/mcp/src/server.ts` — createAllTools, handleJsonRpc, createBaaraMcpServer
- `packages/mcp/src/tools/tasks.ts` — 6 task tools
- `packages/mcp/src/tools/executions.ts` — 9 execution tools
- `packages/mcp/src/tools/queues.ts` — 4 queue tools
- `packages/mcp/src/tools/hitl.ts` — 2 HITL tools
- `packages/mcp/src/tools/templates.ts` — 2 template tools
- `packages/mcp/src/tools/projects.ts` — 2 project tools
- `packages/mcp/src/tools/claude-code.ts` — 2 Claude Code tools
- `packages/cli/src/index.ts` — command registration
- `packages/cli/src/commands/start.ts` — full dev-mode wiring
- `packages/executor/src/checkpoint-service.ts` — CheckpointService
- `packages/executor/src/recovery.ts` — buildRecoveryPrompt, prepareRecoveryParams
- `docs/superpowers/specs/2026-04-04-phase5-sandbox-durability-design.md` — Temporal comparison

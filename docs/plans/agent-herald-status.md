# Herald Agent Status

**Date:** 2026-04-04
**Task:** Update CLAUDE.md and .remember/remember.md for fresh LLM onboarding

## Status: COMPLETE

---

## Files Written

### `CLAUDE.md` (complete rewrite)

Full developer reference for a fresh LLM session. Sections:

1. Project identity and quick commands
2. Architecture overview (3 services + sandbox model + component wiring)
3. 10 packages table
4. Key types — SandboxType, SandboxConfig, ExecutionMode, ExecutionStatus, Priority, AgentConfig,
   Task, Execution, Checkpoint, Thread, ThreadMessage, SandboxEvent, InboundCommand
5. Key interfaces — ISandbox, IMessageBus, IStore (method groups table)
6. State machine — full transition table
7. Database schema — all 5 migrations, table-by-table column descriptions
8. MCP tools — 27 tools in 7 groups
9. Chat system — SSE protocol, request/response format, permission modes, permission resolution
   endpoint, systemInstructions sanitization, inline cards table, thread and session continuity
10. Web UI — three-zone ASCII diagram, key components table, Zustand stores table
11. Security model — auth layers table (API key, /internal fail-closed, rate limiting, CORS, CSP)
12. Task output routing — targetThreadId logic, MAIN_THREAD_ID fallback, summary message format
13. Durability — checkpoint write path, recovery flow, what IS/IS NOT recovered
14. CLI commands table
15. Development workflow — branch/PR rules, critic rule, typecheck before commit
16. Key conventions and pitfalls — TypeScript, database, routing, sandboxes, transport, Bun
17. File index (docs/ directory)

### `/.remember/remember.md` (created/updated)

Handoff note with:
- Project identity and one-paragraph architecture summary
- 10 packages list
- Current feature state (all 5 migrations, permission system, model selector, system instructions,
  task output routing, MAIN_THREAD_ID)
- Web UI layout ASCII diagram
- Security model summary
- Development rules (7 rules)
- Key file paths table (15 files)
- Open work items (DockerSandbox stub, HttpTransport, session GC)
- Docs inventory

---

## Source Files Read

All content derived from live source. No invented capabilities.

- `CLAUDE.md` — prior content (Phases 2-5)
- `README.md` — features, quick start, configuration table
- `packages/core/src/types.ts` — all types including MAIN_THREAD_ID, Task.targetThreadId, ThreadMessage
- `packages/core/src/interfaces/store.ts` — IStore full interface
- `packages/core/src/interfaces/sandbox.ts` — ISandbox, SandboxInstance, SandboxStartConfig, SandboxExecuteParams
- `packages/core/src/state-machine.ts` — VALID_TRANSITIONS, validateTransition, allowedTransitions
- `packages/orchestrator/src/orchestrator-service.ts` — submitTask, runDirect, handleExecutionComplete (output routing), recoverExecution
- `packages/server/src/routes/chat.ts` — ChatRequest type, permissionMode handling, SSE event loop, permission resolution endpoint
- `packages/server/src/app.ts` — auth middleware, /internal fail-closed, rate limiting, CORS, CSP headers
- `packages/server/src/routes/internal.ts` — internal transport routes
- `packages/cli/src/commands/start.ts` — full dev-mode component wiring
- `packages/web/src/App.tsx` — three-zone layout, collapse state
- `packages/web/src/stores/chat-store.ts` — Zustand store, SSE event dispatch, permission flow
- `packages/store/src/migrations.ts` — all 5 migrations with full SQL
- `docs/architecture.md` — component diagram, data flow, event sourcing model
- `docs/durability.md` — checkpoint model, recovery flow, Temporal comparison
- `docs/chat-architecture.md` — SSE protocol, event types, thread model, inline cards

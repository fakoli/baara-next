# Project: baara-next — Defend the Moat + Prove Durability

## Summary

baara-next is a TypeScript-native, local-first durable agentic task execution engine
wrapping the Claude Code SDK. Competitive research (May 2026) confirmed that baara-next
occupies a genuinely uncontested 5-axis intersection — TS-native runtime, Claude Code
SDK as first-class executor, queue + DLQ + retry scheduler, SQLite local-first single
binary, and MCP server as self-control plane — where no competitor (Mastra, Vercel WDK,
Anthropic Claude Managed Agents, Temporal, Inngest AgentKit) checks all five.

This phase combines Theme A (defend the uncontested intersection) and Theme B (prove
the durability claim is real, not theoretical). The phase ships when (1) baara-next
demonstrably survives orchestrator and agent crashes mid-execution with provable
checkpoint recovery in a multi-process configuration, and (2) MCP-as-self-control-plane
is the headline identity in the README, docs, and discoverable feature surface — not
a footnote.

Success is measured by engineering milestones: the chaos suite ships green, the
2-process deployment is documented and reproducible, and the MCP-identity README is
live. The phase budget is 6-8 weeks at solo + AI part-time capacity
(~10-15 effective human-hours/week). If task estimates exceed the ≤80 effective
human-hour ceiling, scope-cut F004 or F005 rather than extend the phase.

## Goals

- G001: Make `HttpTransport` production-ready for a 2-process (orchestrator + agent) deployment.
- G002: Build a chaos test suite that exercises checkpoint recovery under real failure modes.
- G003: Ship an execution timeline UI with per-step input/output, tool calls, tokens, duration.
- G004: Make MCP-as-self-control-plane the README's first sentence and the marketing identity.
- G005: Grow the first-class MCP tool surface and deepen the permission UX.
- G006: Bring the Wasm sandbox feature surface up to parity with the Native sandbox.
- G007: Remove the Docker sandbox stub from the SandboxRegistry and the codebase.
- G008: Resolve the replay-debug feasibility question via a time-boxed spike so that "replay debug" is either committed to a follow-on phase or dropped explicitly.

## Non-Goals

- NG001: Multi-user auth, RBAC, team scoping (Theme C — explicitly deferred; Anthropic just entered this lane on 2026-05-19).
- NG002: Hosted / cloud offering. baara-next stays self-hosted-first.
- NG003: First-class multi-agent crew primitives (CrewAI-style). Sub-agents stay routed through Claude Code SDK's Task tool.
- NG004: Persistent memory primitive (Letta/Mastra-style knowledge thread). Threads remain conversation history.
- NG005: Multi-language SDKs. TypeScript remains the only supported runtime and executor language.

## Requirements

### F001 — Durability proof

- R001: `HttpTransport` must support running OrchestratorService and AgentService in separate processes communicating over HTTP, with full state correctness vs `DevTransport`.
- R002: A chaos test suite must include: (a) kill orchestrator mid-execution, (b) kill agent mid-tool-call, (c) network partition between agent and orchestrator in 2-process mode. Each test must demonstrate correct resumption from the latest checkpoint. (SQLite mid-write corruption was originally scoped but deferred due to OS/filesystem reproducibility concerns flagged by the planner — see structural concern #4. Track for a follow-on issue if revisiting.)
- R003: Recovery must be measurable: the test suite must report time-to-resume, turns-replayed (should be 0 for clean checkpoints), and tool-results-lost (should be bounded to in-flight calls after last checkpoint).
- R004: A multi-process deployment guide must exist at `docs/multi-process.md` covering setup, secrets, network topology, and operational procedures.
- R021: A time-boxed replay-debug feasibility spike (1-2 effective days) must produce a written outcome document at `docs/spikes/replay-debug.md` covering (a) whether deterministic replay is feasible given LLM non-determinism, (b) what a non-deterministic "pseudo-replay" would look like and whether it adds value over the F002 timeline UI, (c) a recommendation: commit to a follow-on phase, fold into F002, or drop explicitly. The recommendation must be acted on before phase end.

### F002 — Execution timeline UI

- R005: The web UI must include an execution timeline view showing every turn, every tool call, every checkpoint, every state transition, with timestamps and durations.
- R006: Tool inputs and outputs must be inspectable inline (collapsible JSON) directly in the timeline.
- R007: The timeline must render a 50-turn execution in <2 seconds and remain interactive (scrubbable, expandable) for 500-turn executions.
- R008: The execution detail page must link directly to the JSONL log file path for offline analysis.

### F003 — MCP-as-self-control identity

- R009: The README's first paragraph must lead with the MCP-as-self-control-plane positioning, framed for Claude Code power users who want durable queue + DLQ + checkpoint semantics around their Claude Code SDK executions. The 5-axis intersection must appear above the install instructions.
- R010: The MCP tool count must grow from 27 to ≥32 (the existing 27 plus at least 5 new tools). Quality over round-number quantity: each new tool must exercise the self-control surface in a distinct way (introspection, planning, queue inspection, checkpoint inspection, dependency graph or similar). Filler tools that pad the count without earning their place are explicitly out of scope.
- R011: Documentation must include a dedicated `docs/mcp-self-control.md` page explaining the philosophy: the agent runs itself through MCP.
- R012: The `docs/architecture.md` 10-package overview must be updated to highlight MCP as the control plane, not just an integration surface.

### F004 — Permission UX deepening

- R013: The `ask` permission mode must support a richer action set: allow once, allow for this task, allow for this tool type, deny. Each decision must be auditable.
- R014: A permission audit log must be queryable per execution and per task, surfacing what was granted, when, and by whom (where "whom" in this single-user system means the chat session ID or `auto` for non-`ask` decisions; see RISK-004 + NG001).

### F005 — Wasm sandbox parity

- R016: WasmSandbox must support tool-output streaming (currently NativeSandbox-only).
- R017: WasmSandbox memory/CPU limits must be enforced with documented limits (kill-on-breach, not soft).
- R018: WasmSandbox network policy must support explicit allow/deny lists per task.
- R019: A `docs/sandbox-guide.md` update must compare Native vs Wasm feature support in a parity matrix.
- R020: The Docker sandbox files (`packages/executor/src/sandbox/docker.ts` and related) must be removed. SandboxRegistry must no longer reference DockerSandbox. Tests must verify only Native and Wasm sandboxes are registered. `docs/sandbox-guide.md` must mention only Native and Wasm.

## Acceptance Criteria

- AC001: A reproducible test (in CI) demonstrates baara-next surviving orchestrator crash mid-execution, with the execution resuming from latest checkpoint and completing successfully on the new attempt.
- AC002: A reproducible test demonstrates baara-next surviving agent crash mid-tool-call, with the execution resuming and completing.
- AC003: A reproducible test demonstrates a 2-process deployment (orchestrator + agent in separate processes via `HttpTransport`) running a 20-turn execution successfully.
- AC004: A user, following only `docs/multi-process.md`, can stand up a 2-process baara-next on a single machine in <15 minutes.
- AC005: The web UI renders a 50-turn execution timeline in <2 seconds (measured with the React profiler); a manual review confirms tool inputs and outputs are inspectable; a 500-turn timeline remains scrubbable, defined as ≥60fps scroll OR interaction-to-paint <100ms during scrubbing, whichever is easier to measure with the React profiler.
- AC006: A new visitor to the GitHub repo reads the README's first paragraph and can correctly state, in their own words, what MCP-as-self-control-plane means.
- AC007: The MCP tool count reported by `list_tools` is ≥32, and at least 5 of the new tools demonstrably exercise self-control (introspection, planning, queue/checkpoint inspection).
- AC008: The `ask` mode permission UX has been used through ≥10 sessions with the deeper action set; the audit log query returns correct grants for each session.
- AC009: The WasmSandbox feature parity matrix in `docs/sandbox-guide.md` shows Native ↔ Wasm parity for streaming, limits enforcement, and network policy.
- AC010: `grep -r DockerSandbox packages/` returns 0 results; `bun test:smoke` passes; `docs/sandbox-guide.md` mentions only Native and Wasm.
- AC011: `docs/spikes/replay-debug.md` exists with a feasibility verdict, a pseudo-replay description, and a recommendation. The recommendation is acted on before phase end (committed to follow-on phase, folded into F002, or dropped — whichever is chosen).

## Risks

- RISK-001 (Existential): **Anthropic Claude Managed Agents + self-hosted sandboxes (2026-05-19)** is the first-party answer to a similar problem and carries the Anthropic brand. Mitigation: position baara-next as explicitly *not* hosted by Anthropic — your machine, your DB, your data, your orchestration. This phase doesn't try to match Anthropic; it doubles down on what they don't offer (SQLite local-first single-binary; queue + DLQ; MCP self-control).
- RISK-002 (Catch-up): **Mastra momentum** (24K stars, $35M raised, production customers). Mitigation: differentiate on the axes Mastra doesn't have — Claude Code SDK as executor, MCP-as-self-control-plane, sandbox tier. Do not try to compete with Mastra on model router breadth.
- RISK-003 (Scope): A+B is two themes in one phase. The temptation to drift into Theme C (multi-user, RBAC) must be resisted; it is explicitly NG001.
- RISK-004 (Capacity, confirmed): Solo + AI assistance, part-time (~10-15 effective human-hours/week). The phase scope (5 features over 6-8 weeks) must fit that capacity. The planner should target ≤80 effective human-hours total work across all tasks; if estimates exceed this budget, scope-cut F004 or F005 rather than extending the phase.
- RISK-005 (Wasm complexity): F-SANDBOX (Wasm parity) is technically deep — Extism's limits enforcement and network policy may require non-trivial Extism upstream work or workarounds.
- RISK-006 (Observability scope): An Inngest-quality timeline UI is significant frontend work. The phase must define a "good enough v1" cutoff to avoid blocking on UX polish.

## Open Questions

All initial open questions (OQ001-OQ007) were resolved at PRD review time. OQ005 (replay-style debug) was resolved with a time-boxed spike whose outcome itself becomes the next open question — tracked as R021 + AC011 inside F001, not as a free-standing OQ.

## Features

### F001: Durability proof

`HttpTransport` production-ready for a 2-process deployment, a chaos test suite that
exercises real failure modes (orchestrator crash, agent crash, SQLite mid-write, network
partition), a documented multi-process deployment guide, and a time-boxed replay-debug
feasibility spike whose outcome decides whether replay debug joins a follow-on phase,
folds into the F002 timeline, or is dropped. Closes the most credible technical
objection to the durability claim.

**Requirements:** R001, R002, R003, R004, R021

### F002: Execution timeline UI

Inngest-quality timeline view of every turn, tool call, checkpoint, and state transition,
with inline collapsible JSON for tool inputs/outputs. Closes the observability gap
against Inngest and Trigger.dev.

**Requirements:** R005, R006, R007, R008

### F003: MCP-as-self-control identity

README rewrite making MCP-as-self-control-plane the headline identity, growth of the
first-class MCP tool surface from 27 to ≥32 tools (including at least 5 new tools that
exercise self-control: introspection, planning, queue inspection, checkpoint inspection,
dependency graph), and a dedicated `docs/mcp-self-control.md` philosophy page. Makes the
uncontested moat visible.

**Requirements:** R009, R010, R011, R012

### F004: Permission UX deepening

Richer `ask` mode action set (allow once / allow for task / allow for tool type / deny)
and a queryable permission audit log per execution and per task. Deepens what makes MCP
self-control trustworthy in production. Per-task locked allowlists (originally R015 /
T014) were descoped from this phase to fit the ≤80h budget; track for a follow-on phase.

**Requirements:** R013, R014

### F005: Wasm sandbox parity + Docker removal

Brings WasmSandbox up to NativeSandbox parity (tool-output streaming, hard-enforced
memory/CPU limits, explicit network allow/deny lists per task, and a Native ↔ Wasm
parity matrix in `docs/sandbox-guide.md`) and removes the Docker sandbox stub entirely.
After this feature ships, SandboxRegistry collapses to Native + Wasm only, removing
dead code and simplifying the sandbox tier of the 5-axis intersection.

**Requirements:** R016, R017, R018, R019, R020

## Tasks

### T001: Harden HttpTransport for 2-process correctness

**Feature:** F001
**Priority:** critical
**Likely files:** packages/transport/src/http-transport.ts, packages/transport/src/factory.ts, packages/server/src/routes/internal.ts, packages/cli/src/commands/start.ts

Audit `HttpTransport` against `DevTransport` for behavioural parity: every method the orchestrator exposes to the agent must route correctly over HTTP, with identical error semantics, retry on transient failures, and clean timeout handling. Wire a `--mode http` start option so the orchestrator and agent can each be spawned in their own process pointed at a shared SQLite DB. The `/internal/*` route group must be the only surface the agent talks to and must fail-closed when `BAARA_API_KEY` is unset.

**Acceptance criteria:**

- `HttpTransport` implements every method on the transport interface that `DevTransport` does, with parity-tested error paths.
- Running `bun start --mode http --role orchestrator` and `bun start --mode http --role agent` against a shared `~/.baara/baara.db` produces a working pair where the agent picks up and runs queued executions.
- Transient network failures (connection refused, 503) are retried with bounded exponential backoff; terminal errors propagate without retry.
- Unsetting `BAARA_API_KEY` causes every `/internal/*` request to return 503 with a clear message.

**Verification:**

- `turbo typecheck`
- `bun test packages/transport/`
- `BAARA_API_KEY=test-key bun start --mode http --role orchestrator & sleep 2 && BAARA_API_KEY=test-key BAARA_ORCHESTRATOR_URL=http://localhost:3000 bun start --mode http --role agent`

### T002: Build chaos test suite for crash + partition scenarios

**Feature:** F001
**Priority:** critical
**Likely files:** tests/chaos/orchestrator-crash.test.ts, tests/chaos/agent-crash.test.ts, tests/chaos/network-partition.test.ts, tests/chaos/helpers.ts, package.json

Create a new `tests/chaos/` suite with three scenarios from R002: (a) kill orchestrator mid-execution, (b) kill agent mid-tool-call, (c) network partition between agent and orchestrator in 2-process mode. Each test spawns the 2-process configuration, drives a multi-turn execution, injects the failure, and asserts the execution resumes from the latest checkpoint and reaches `completed`. Add a `bun test:chaos` script to `package.json`. (SQLite mid-write corruption was originally a fourth scenario but was descoped from this phase per Decision 1 + structural concern #4; track in a follow-on issue.)

**Acceptance criteria:**

- `tests/chaos/orchestrator-crash.test.ts` SIGKILLs the orchestrator mid-execution; the orchestrator restarts and the execution resumes from checkpoint and completes.
- `tests/chaos/agent-crash.test.ts` SIGKILLs the agent mid-tool-call; the orchestrator detects the stuck execution via health monitor, schedules a retry, and the new agent attempt resumes from checkpoint.
- `tests/chaos/network-partition.test.ts` blocks agent→orchestrator traffic for N seconds in 2-process mode; once traffic resumes the agent reconnects and the execution completes.
- `bun test:chaos` runs all three tests green.

**Verification:**

- `bun test:chaos`
- `turbo typecheck`

### T003: Instrument checkpoint recovery metrics

**Feature:** F001
**Priority:** high
**Likely files:** packages/executor/src/recovery.ts, packages/orchestrator/src/orchestrator-service.ts, packages/core/src/types.ts, tests/chaos/helpers.ts

When recovery happens the chaos suite (and any operator) must see three numbers: time-to-resume (ms between failure detection and the new attempt starting), turns-replayed (should be 0 for a clean checkpoint), and tool-results-lost (count of tool calls between last checkpoint and crash). Add these fields to the recovery code path, expose them on the recovered Execution row (event log or a dedicated `recovery_metrics` field on the execution event payload), and assert on them in the chaos tests.

**Acceptance criteria:**

- A recovery emits an event of type `recovery_complete` with payload `{ timeToResumeMs, turnsReplayed, toolResultsLost }`.
- `turnsReplayed` is 0 when recovery starts from a clean checkpoint boundary; >0 only if the engine ever replays.
- The chaos suite reads these metrics and asserts on bounded values per scenario.

**Verification:**

- `bun test:chaos -t "recovery metrics"`
- `bun test packages/executor/`

### T004: Author multi-process deployment guide

**Feature:** F001
**Priority:** high
**Likely files:** docs/multi-process.md, docs/configuration.md, README.md

Create `docs/multi-process.md` from scratch covering: prerequisites, env vars (`BAARA_API_KEY`, `BAARA_ORCHESTRATOR_URL`, `BAARA_DATA_DIR`), the two start commands (orchestrator role, agent role), shared SQLite mount considerations, network topology (single-machine vs LAN), secrets handling, log locations, restart procedures, and a troubleshooting section. Target: a new user can stand up the 2-process configuration in <15 minutes.

**Acceptance criteria:**

- `docs/multi-process.md` exists and includes Prerequisites, Setup, Configuration, Operations, and Troubleshooting sections.
- The guide is referenced from `README.md` and `docs/configuration.md`.
- Walking through the guide on a clean machine produces a working 2-process baara-next in <15 minutes (timed manual run).

**Verification:**

- `test -f docs/multi-process.md`
- `grep -l multi-process docs/configuration.md README.md`

### T005: Replay-debug feasibility spike

**Feature:** F001
**Priority:** medium
**Likely files:** docs/spikes/replay-debug.md

A time-boxed (1-2 effective days) spike. Write `docs/spikes/replay-debug.md` covering (a) whether deterministic replay is feasible given LLM non-determinism (answer expected: no), (b) what a non-deterministic "pseudo-replay" would look like — replay the event log and re-render tool calls without re-running the LLM — and whether it adds value beyond the F002 timeline UI, (c) a recommendation: commit to a follow-on phase, fold into F002, or drop explicitly. The recommendation must be acted on before phase end.

**Acceptance criteria:**

- `docs/spikes/replay-debug.md` exists with sections "Feasibility", "Pseudo-replay sketch", and "Recommendation".
- The recommendation is one of: "follow-on phase", "fold into F002", "drop".
- Whichever recommendation is chosen, a follow-up issue or PRD entry is created (or F002 scope is updated) before phase end.

**Verification:**

- `test -f docs/spikes/replay-debug.md`
- `grep -E "Recommendation" docs/spikes/replay-debug.md`

### T006: Backend timeline endpoint for execution events

**Feature:** F002
**Priority:** high
**Likely files:** packages/server/src/routes/executions.ts, packages/store/src/sqlite-store.ts, packages/core/src/types.ts

Add a `GET /api/executions/:id/timeline` endpoint that returns a normalized, ordered list of timeline entries from the `events` table joined with checkpoint markers: each entry has `{ seq, timestamp, type, durationMs, payload }` where `type` is one of `turn_start`, `turn_complete`, `tool_use`, `tool_result`, `checkpoint`, `state_transition`, `hitl_request`. The endpoint must paginate (default 200, max 1000) and support `?after_seq=N` for incremental fetches so the UI can stream growth on a live execution.

**Acceptance criteria:**

- `GET /api/executions/:id/timeline` returns ordered timeline entries for any execution.
- `?after_seq=N` returns only entries with `event_seq > N`.
- A 500-turn execution returns the first page in <300ms on a warm DB.
- Pagination metadata (`nextSeq`, `hasMore`) is in the response.

**Verification:**

- `bun test packages/server/ -t "timeline"`
- `curl -sH "X-Api-Key: $BAARA_API_KEY" http://localhost:3000/api/executions/<id>/timeline | jq '.entries | length'`

### T007: Timeline UI component with collapsible tool inputs/outputs

**Feature:** F002
**Priority:** high
**Likely files:** packages/web/src/components/ExecutionTimeline.tsx, packages/web/src/components/ExecutionDetail.tsx, packages/web/src/stores/execution-store.ts, packages/web/src/hooks/useExecutionTimeline.ts

Build `ExecutionTimeline.tsx` that renders the `/api/executions/:id/timeline` response as a vertical scrubbable timeline. Each entry shows timestamp, duration, type icon, and (for tool calls) collapsible JSON for input and output. Wire it into `ExecutionDetail.tsx` so the existing execution detail view gains a "Timeline" tab. Use virtualization (or windowing) so a 500-turn execution stays responsive.

**Acceptance criteria:**

- Opening an execution detail page shows a Timeline tab populated from the timeline endpoint.
- Tool inputs and outputs render as collapsible JSON blocks inline in the timeline.
- A 50-turn execution timeline renders in <2 seconds on a development laptop (measured with the React profiler).
- A 500-turn execution stays scrubbable (60fps scrolling) — virtualization or windowing implemented.

**Verification:**

- `cd packages/web && bun run build`
- `cd tests/e2e && npx playwright test specs/execution-timeline.spec.ts`

### T008: Link execution detail to JSONL log file path

**Feature:** F002
**Priority:** medium
**Likely files:** packages/web/src/components/ExecutionDetail.tsx, packages/server/src/routes/executions.ts, packages/executor/src/log-writer.ts

The execution detail page must display the absolute filesystem path to the JSONL log for the execution and offer a copy-to-clipboard button. The path comes from the same logsDir / executionId convention `log-writer.ts` uses today. Expose it on `GET /api/executions/:id` as `logFilePath`.

**Acceptance criteria:**

- `GET /api/executions/:id` response includes `logFilePath`.
- The execution detail page renders the path with a copy button.
- The path resolves to an actual readable file for completed executions.

**Verification:**

- `bun test packages/server/ -t "logFilePath"`
- `curl -sH "X-Api-Key: $BAARA_API_KEY" http://localhost:3000/api/executions/<id> | jq '.logFilePath'`

### T009: Add 5 self-control MCP tools

**Feature:** F003
**Priority:** high
**Likely files:** packages/mcp/src/tools/introspection.ts, packages/mcp/src/tools/planning.ts, packages/mcp/src/tools/checkpoint.ts, packages/mcp/src/tools/queues.ts, packages/mcp/src/tools/dependency-graph.ts, packages/mcp/src/index.ts, packages/mcp/src/server.ts

Add at least 5 new MCP tools that each exercise a distinct self-control surface: (1) `introspect_execution` (return current turn, checkpoint state, pending tools for a running execution), (2) `plan_task_graph` (let an agent propose a graph of dependent tasks), (3) `list_checkpoints` (inspect checkpoint history for an execution), (4) `inspect_queue_depth_by_priority` (deeper than the existing `list_queues`), (5) `get_dependency_graph` (read task→task dependency edges if/when introduced; minimum viable: return the planned graph from `plan_task_graph`). Total MCP tool count must reach ≥32.

**Acceptance criteria:**

- `list_tools` MCP call returns ≥32 tools.
- Each new tool has Zod input/output schemas, a description, and a unit test that exercises happy + error paths.
- Each new tool is wired into the in-process, stdio, and HTTP MCP modes.

**Verification:**

- `bun test packages/mcp/`
- `bun run packages/cli/src/index.ts mcp-server <<<'{"jsonrpc":"2.0","method":"tools/list","id":1}' | jq '.result.tools | length'`

### T010: Rewrite README to lead with MCP-as-self-control

**Feature:** F003
**Priority:** high
**Likely files:** README.md

Rewrite the README's opening so the first paragraph leads with the MCP-as-self-control-plane positioning, framed for Claude Code power users who want durable queue + DLQ + checkpoint semantics around their Claude Code SDK executions. The 5-axis intersection (TS-native, Claude Code SDK executor, queue+DLQ+retry, SQLite local-first, MCP self-control) must appear above the install instructions. The existing Quick Start moves below the positioning. A reader unfamiliar with baara-next must be able to state, in their own words, what MCP-as-self-control-plane means after reading the first paragraph.

**Acceptance criteria:**

- `README.md` first paragraph names MCP-as-self-control-plane explicitly.
- The 5-axis intersection appears before the `## Quick Start` heading.
- A manual review by a fresh reader confirms AC006.

**Verification:**

- `head -40 README.md | grep -i "MCP"`
- `awk '/## Quick Start/{exit} {print}' README.md | grep -i "5-axis\|five-axis\|intersection"`

### T011: Author docs/mcp-self-control.md philosophy page

**Feature:** F003
**Priority:** medium
**Likely files:** docs/mcp-self-control.md, docs/architecture.md, docs/mcp-integration.md

Create `docs/mcp-self-control.md` explaining the philosophy: the agent runs itself through MCP. Cover what self-control means (introspection, planning, queue/checkpoint inspection), how the existing 27 tools plus the 5 new ones from T009 instantiate it, why this is uncontested in the market (5-axis intersection), and worked examples of an agent calling its own MCP tools. Update `docs/architecture.md` so the 10-package overview frames MCP as the control plane (not just an integration surface). Cross-link from `docs/mcp-integration.md`.

**Acceptance criteria:**

- `docs/mcp-self-control.md` exists with sections "Philosophy", "Tool surface", "Worked example", "Why uncontested".
- `docs/architecture.md` MCP section is rewritten to call out MCP as the control plane.
- `docs/mcp-integration.md` links to `mcp-self-control.md`.

**Verification:**

- `test -f docs/mcp-self-control.md`
- `grep -l "mcp-self-control" docs/architecture.md docs/mcp-integration.md`

### T012: Extend `ask` mode action set

**Feature:** F004
**Priority:** high
**Likely files:** packages/server/src/routes/chat.ts, packages/web/src/stores/chat-store.ts, packages/web/src/components/ChatMessage.tsx, packages/core/src/types.ts

Today the `ask` permission decision is `allow | allow_task | deny`. Add `allow_tool_type` (allow this tool name for the rest of the session). Update the permission_request SSE event and the `POST /api/chat/permission` body schema. Update the chat store and UI prompt to surface the four options.

**Acceptance criteria:**

- `POST /api/chat/permission` accepts `decision: "allow" | "allow_task" | "allow_tool_type" | "deny"`.
- The UI prompt shows all four options when a permission request arrives.
- `allow_tool_type` causes subsequent calls to the same tool name in the same session to bypass the permission prompt.
- A session-end audit lists every decision in order.

**Verification:**

- `bun test packages/server/ -t "permission"`
- `bun test tests/smoke/07-chat-sse.test.ts`

### T013: Permission audit log per execution and per task

**Feature:** F004
**Priority:** high
**Likely files:** packages/store/src/migrations.ts, packages/store/src/sqlite-store.ts, packages/server/src/routes/chat.ts, packages/server/src/routes/executions.ts, packages/core/src/interfaces/store.ts, packages/mcp/src/tools/introspection.ts

Add a `permission_audit` table (migration 6) recording each decision: `id`, `execution_id`, `task_id`, `session_id`, `tool_name`, `tool_input` (JSON), `decision`, `decided_at`, `decided_by` (user identifier or `auto` if non-ask mode). Expose `GET /api/executions/:id/permissions` and `GET /api/tasks/:id/permissions`. Add an `introspect_permissions` MCP tool (count this toward the ≥32 in T009 if convenient, or add it as a 6th tool).

**Acceptance criteria:**

- Schema version reaches 6; `permission_audit` table exists with the listed columns.
- Every permission decision in `ask` mode writes a row.
- `GET /api/executions/:id/permissions` returns all decisions for an execution.
- `GET /api/tasks/:id/permissions` returns decisions across all executions of a task.
- ≥10 sessions of manual use produce a queryable audit trail (AC008).

**Verification:**

- `bun test packages/store/ -t "permission_audit"`
- `bun test packages/server/ -t "permissions"`

### T015: WasmSandbox tool-output streaming parity

**Feature:** F005
**Priority:** high
**Likely files:** packages/executor/src/sandboxes/wasm.ts, packages/executor/src/sandbox.ts, packages/executor/src/__tests__/wasm.test.ts

NativeSandbox streams tool outputs as `tool_result` events as the SDK emits them. WasmSandbox today buffers them. Wire the Extism plugin's host functions so each tool output is forwarded as a `SandboxEvent` of type `tool_result` immediately. The integration must preserve the existing `events: AsyncIterable<SandboxEvent>` contract.

**Acceptance criteria:**

- A WasmSandbox execution running a multi-tool task emits `tool_result` events as each tool returns (not in a final batch).
- The unit test asserts event ordering and timing across tool calls.
- Parity confirmed against an equivalent NativeSandbox run.

**Verification:**

- `bun test packages/executor/src/sandboxes/__tests__/wasm.test.ts`

### T016: Enforce WasmSandbox memory and CPU limits (kill-on-breach)

**Feature:** F005
**Priority:** high
**Likely files:** packages/executor/src/sandboxes/wasm.ts, docs/sandbox-guide.md, packages/executor/src/__tests__/wasm.test.ts

Per R017, limits must be hard (kill-on-breach), not soft. Wire the Extism configuration so `maxMemoryMb` and `maxCpuPercent` from `SandboxConfig` are enforced at the plugin runtime level. Document the limits, the enforcement mechanism, and the failure mode (execution status, error message). Add a test that allocates beyond the limit and asserts the execution is killed with an actionable error.

**Acceptance criteria:**

- A Wasm task configured with `maxMemoryMb: 64` that allocates 128 MB is killed with `OOM` or equivalent surfaced as `error` on the execution.
- A Wasm task that pegs CPU above `maxCpuPercent` is killed (or throttled then killed) with a CPU-limit error.
- `docs/sandbox-guide.md` documents the limits, defaults, and behaviour.

**Verification:**

- `bun test packages/executor/src/sandboxes/__tests__/wasm.test.ts -t "limits"`

### T017: WasmSandbox network allow/deny lists per task

**Feature:** F005
**Priority:** medium
**Likely files:** packages/executor/src/sandboxes/wasm.ts, packages/core/src/types.ts, packages/web/src/components/TaskEditor.tsx, docs/sandbox-guide.md

Add `networkAllowList?: string[]` and `networkDenyList?: string[]` to the Wasm variant of `SandboxConfig`. Enforce via the Extism HTTP host function (or a wrapper) so any outbound request to a host not on the allowlist (or on the denylist) is rejected. Surface the configuration in `TaskEditor`.

**Acceptance criteria:**

- A Wasm task with `networkAllowList: ["api.example.com"]` succeeds only on calls to that host; calls to others return a network policy error.
- A Wasm task with `networkDenyList: ["evil.example.com"]` blocks that host while allowing others.
- `TaskEditor` exposes the lists.
- `docs/sandbox-guide.md` documents the policy semantics.

**Verification:**

- `bun test packages/executor/src/sandboxes/__tests__/wasm.test.ts -t "network"`

### T018: Native ↔ Wasm parity matrix in docs/sandbox-guide.md

**Feature:** F005
**Priority:** medium
**Likely files:** docs/sandbox-guide.md

Add a parity matrix table to `docs/sandbox-guide.md` comparing NativeSandbox and WasmSandbox across at least: tool-output streaming, memory limits, CPU limits, network policy, startup latency, available host functions, supported `SandboxEvent` types. Mark each cell as `✓ supported`, `✓ supported (limited)`, or `✗ not supported`. After T015-T017 land, Native ↔ Wasm parity must be `✓` for streaming, limits, and network policy (AC009).

**Acceptance criteria:**

- `docs/sandbox-guide.md` contains a "Parity matrix" section with the matrix table.
- All three of streaming, limits enforcement, and network policy show parity ✓ for both sandboxes.

**Verification:**

- `grep -A 30 "Parity matrix" docs/sandbox-guide.md`

### T019: Remove DockerSandbox from codebase

**Feature:** F005
**Priority:** medium
**Likely files:** packages/executor/src/sandboxes/docker.ts, packages/executor/src/sandboxes/__tests__/docker.test.ts, packages/executor/src/sandbox-registry.ts, packages/executor/src/index.ts, packages/executor/src/__tests__/sandbox-registry.test.ts, packages/executor/src/__tests__/index-exports.test.ts, packages/executor/src/__tests__/sandbox-factory.test.ts, docs/sandbox-guide.md, README.md

Delete `packages/executor/src/sandboxes/docker.ts` and its test. Remove all DockerSandbox imports and registrations from `sandbox-registry.ts`, `index.ts`, and all tests in `packages/executor/src/__tests__/`. Update `docs/sandbox-guide.md` and `README.md` to mention only Native and Wasm. After this task, `grep -r DockerSandbox packages/` must return zero results.

**Acceptance criteria:**

- `grep -r DockerSandbox packages/` returns 0 results (AC010).
- `bun test:smoke` passes (AC010).
- `docs/sandbox-guide.md` mentions only Native and Wasm.
- `SandboxType` is narrowed to `"native" | "wasm"` (or, if backward-compat needed, `"docker"` is left in the union but the value is unregistered — pick one and document).

**Verification:**

- `! grep -r DockerSandbox packages/`
- `bun test:smoke`
- `turbo typecheck`


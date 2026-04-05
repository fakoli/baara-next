# Playwright E2E Test Framework — Execution Plan

**Goal:** Build a Playwright test framework that validates all confirmed-working BAARA Next web UI features with action latency measurement.
**Spec:** docs/specs/2026-04-05-playwright-e2e-framework.md
**Language:** TypeScript
**Crew:** fakoli-crew v1.0.0 (7 agents)

---

## Scout Findings

- `--data-dir` and `--port` CLI flags confirmed in `packages/cli/src/commands/start.ts`
- Vite proxy target is hardcoded to `localhost:3000` in `packages/web/vite.config.ts` — must be made configurable via env var so each test file can point Vite at its own backend port
- Zero `data-testid` attributes exist in React components — all ~15 must be added
- Existing smoke tests at `tests/smoke/` use in-process server with `bun:test` and `tests/smoke/helpers.ts` — different pattern from Playwright but useful reference for server wiring
- Backend does NOT serve static web files — E2E tests need both a backend process and Vite dev server per test file
- API routes confirmed: `/api/tasks` (CRUD + run/submit/toggle), `/api/executions` (list/inspect/events/logs/cancel/retry), `/api/queues` (list/get/dlq), `/api/system/status`, `/api/chat` (POST SSE + threads)

## File Map

| File | Responsibility | Task |
|------|---------------|------|
| `packages/web/vite.config.ts` | Make proxy target configurable via `VITE_API_URL` env var | Task 1 |
| `packages/web/src/components/ThreadList.tsx` | Add `data-testid` attributes | Task 1 |
| `packages/web/src/components/ChatWindow.tsx` | Add `data-testid` attributes | Task 1 |
| `packages/web/src/components/ChatInput.tsx` | Add `data-testid` attributes | Task 1 |
| `packages/web/src/components/ChatMessage.tsx` | Add `data-testid` attributes | Task 1 |
| `packages/web/src/components/ControlPanel.tsx` | Add `data-testid` attributes | Task 1 |
| `packages/web/src/components/Header.tsx` | Add `data-testid` attributes | Task 1 |
| `tests/e2e/package.json` | Playwright dependency, scripts | Task 2 |
| `tests/e2e/tsconfig.json` | TypeScript config for test files | Task 2 |
| `tests/e2e/playwright.config.ts` | Playwright settings (workers, timeout, retries) | Task 2 |
| `tests/e2e/helpers/server.ts` | Start/stop backend + Vite per test file | Task 3 |
| `tests/e2e/helpers/api.ts` | HTTP client for test preconditions | Task 3 |
| `tests/e2e/helpers/fixtures.ts` | Custom Playwright fixtures wiring server + API + timings | Task 3 |
| `tests/e2e/helpers/selectors.ts` | Centralized UI selectors | Task 3 |
| `tests/e2e/helpers/measure.ts` | Action latency measurement + threshold classification | Task 3 |
| `tests/e2e/specs/layout.spec.ts` | Three-zone layout, collapse/expand tests | Task 4 |
| `tests/e2e/specs/queues.spec.ts` | Queue cards, capacity display | Task 4 |
| `tests/e2e/specs/controls.spec.ts` | Permission mode, model selector | Task 4 |
| `tests/e2e/specs/chat.spec.ts` | Message send, SSE streaming, tool calls, markdown | Task 5 |
| `tests/e2e/specs/threads.spec.ts` | Thread create, switch, history | Task 5 |
| `tests/e2e/specs/tasks.spec.ts` | Task CRUD via chat, output routing | Task 5 |
| `tests/e2e/specs/executions.spec.ts` | Execution detail, sub-tabs | Task 5 |
| `tests/e2e/report-latency.ts` | Aggregate timing JSON into summary table | Task 6 |
| `root package.json` | Add test:e2e, test:e2e:ci, test:e2e:report scripts | Task 6 |
| `.gitignore` | Add tests/e2e/results/ | Task 6 |

---

### Task 1: Add data-testid attributes to React components and make Vite proxy configurable

**Intent:** Prepare the web package for Playwright testing by adding `data-testid` attributes to all structural UI elements and making the Vite proxy target configurable via environment variable.
**Acceptance criteria:**
- Every React component listed in the spec's `data-testid` table has the specified attributes (`thread-list`, `thread-collapse`, `thread-expand`, `chat-window`, `chat-send`, `msg-user`, `msg-agent`, `control-panel`, `cp-collapse`, `cp-expand`, `header-status`, `permission-mode`, `model-selector`, `session-cost`)
- `vite.config.ts` reads the API proxy target from `process.env.VITE_API_URL`, falling back to `http://localhost:3000`
- `bunx tsc --noEmit` passes in `packages/web` with zero errors
- Existing UI behavior is unchanged — no visual or functional regressions
**Scope:** `packages/web/vite.config.ts`, `packages/web/src/components/ThreadList.tsx`, `packages/web/src/components/ChatWindow.tsx`, `packages/web/src/components/ChatInput.tsx`, `packages/web/src/components/ChatMessage.tsx`, `packages/web/src/components/ControlPanel.tsx`, `packages/web/src/components/Header.tsx`
**Agent:** welder
**Verify:** `cd packages/web && bunx tsc --noEmit && grep -r 'data-testid' src/components/ | wc -l` (should be >= 14)
**Depends on:** (none)

---

### Task 2: Scaffold E2E test infrastructure (package, config, dependencies)

**Intent:** Create the `tests/e2e/` directory structure with Playwright dependency, TypeScript config, and Playwright configuration file.
**Acceptance criteria:**
- `tests/e2e/package.json` declares `@playwright/test` as a dependency
- `tests/e2e/tsconfig.json` extends the root `tsconfig.base.json`
- `tests/e2e/playwright.config.ts` is configured with `workers: 1`, `timeout: 60_000`, `retries: 0`, `reporter: 'list'`
- `npx playwright install chromium` succeeds from `tests/e2e/`
- Directory structure matches the spec: `helpers/`, `specs/`, `journeys/`, `results/`
**Scope:** `tests/e2e/package.json`, `tests/e2e/tsconfig.json`, `tests/e2e/playwright.config.ts`
**Agent:** welder
**Verify:** `cd tests/e2e && cat playwright.config.ts && ls helpers/ specs/ journeys/`
**Depends on:** (none)

---

### Task 3: Build test helpers (server lifecycle, API client, fixtures, selectors, latency measurement)

**Intent:** Implement the five helper modules that every spec file depends on: server process management, HTTP API client for preconditions, custom Playwright fixtures, centralized selectors, and action latency measurement.
**Acceptance criteria:**
- `server.ts` starts a backend process (`bun run packages/cli/src/index.ts -- start`) with a unique temp `--data-dir` and random `--port`, polls `/api/system/status` until ready, and kills + cleans up on teardown. It also starts a Vite dev server with `VITE_API_URL` pointing at the backend port
- `api.ts` exposes `createTask`, `runTask`, `getExecution`, `waitForExecution`, `listThreads`, `getThreadMessages`, `getSystemStatus`, `deleteTask` — all calling the real REST API at the correct paths (`/api/tasks`, `/api/executions`, etc.)
- `fixtures.ts` exports a custom `test` extending `@playwright/test` with `server`, `apiClient`, and `timings` fixtures. Server starts in `beforeAll` scope per test file
- `selectors.ts` exports a `Selectors` const matching all `data-testid` values from Task 1
- `measure.ts` implements the `measure()` wrapper with default thresholds per action category and writes timing JSON to `tests/e2e/results/` on fixture teardown
- All helpers compile with zero TypeScript errors
**Scope:** `tests/e2e/helpers/server.ts`, `tests/e2e/helpers/api.ts`, `tests/e2e/helpers/fixtures.ts`, `tests/e2e/helpers/selectors.ts`, `tests/e2e/helpers/measure.ts`
**Agent:** welder
**Verify:** `cd tests/e2e && npx tsc --noEmit`
**Depends on:** Task 1, Task 2

---

### Task 4: Write CI-safe spec files (layout, queues, controls)

**Intent:** Implement the three spec files that do NOT require `ANTHROPIC_API_KEY` — they test UI rendering, layout behavior, and static server state only.
**Acceptance criteria:**
- `layout.spec.ts`: tests three-zone layout renders, both sidebars collapse independently, both re-expand, header shows status indicators (0 running, 0 queued, 0 failed), welcome screen appears with quick action buttons
- `queues.spec.ts`: tests all 4 queue cards (dlq, timer, transfer, visibility) are visible with correct names, descriptions, and capacity numbers matching API response
- `controls.spec.ts`: tests permission mode cycles through Auto → Ask → Locked on click, model selector is visible, session cost shows "$0.00" on fresh load
- No test uses `page.waitForTimeout()` — all waits use Playwright auto-retry
- Every user action is wrapped in `measure()` for latency collection
- All three specs pass with `npx playwright test`
**Scope:** `tests/e2e/specs/layout.spec.ts`, `tests/e2e/specs/queues.spec.ts`, `tests/e2e/specs/controls.spec.ts`
**Agent:** welder
**Verify:** `cd tests/e2e && npx playwright test specs/layout.spec.ts specs/queues.spec.ts specs/controls.spec.ts`
**Depends on:** Task 3

---

### Task 5: Write local-only spec files (chat, threads, tasks, executions)

**Intent:** Implement the four spec files that require `ANTHROPIC_API_KEY` — they test Claude SDK interaction, SSE streaming, task CRUD, and output routing.
**Acceptance criteria:**
- `chat.spec.ts`: tests sending a message via input, SSE streaming produces agent response with tool call pills and text content, quick action buttons submit pre-defined messages, session cost increases after a message, markdown tables render as `<table>` elements (remark-gfm verification)
- `threads.spec.ts`: tests creating a new thread shows empty welcome screen, switching to a previous thread loads its message history, thread title auto-generates from first message, Main thread is always pinned at top
- `tasks.spec.ts`: tests creating a task via chat makes it appear in ControlPanel Tasks tab, deleting a task via chat removes it from ControlPanel, running a task routes output to the designated thread (two-layer assertion: UI + `apiClient.getThreadMessages()`)
- `executions.spec.ts`: tests execution appears in Execs tab after running a task, clicking execution shows detail view with Overview sub-tab (status, duration, tokens), Events sub-tab shows state machine timeline, Logs sub-tab shows execution output text
- All four specs are wrapped in `test.describe('@local-only', ...)` for CI exclusion
- No `page.waitForTimeout()` — all waits use auto-retry or `waitForExecution()` polling
- Every user action is wrapped in `measure()` for latency collection
- Output routing verification: at least one test creates a task with `targetThreadId`, runs it, waits for completion, and asserts the output message exists in the target thread via API
**Scope:** `tests/e2e/specs/chat.spec.ts`, `tests/e2e/specs/threads.spec.ts`, `tests/e2e/specs/tasks.spec.ts`, `tests/e2e/specs/executions.spec.ts`
**Agent:** welder
**Verify:** `cd tests/e2e && ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY npx playwright test specs/chat.spec.ts specs/threads.spec.ts specs/tasks.spec.ts specs/executions.spec.ts`
**Depends on:** Task 3

---

### Task 6: Wire up reporting script and root package.json scripts

**Intent:** Create the latency report aggregator and add convenience scripts to the root `package.json` so the full suite can be run with `bun run test:e2e`.
**Acceptance criteria:**
- `report-latency.ts` reads all `tests/e2e/results/timings-*.json` files, aggregates per action (min, avg, max, p95), classifies each as fast/acceptable/slow using the default thresholds, and prints a formatted table to stdout
- Root `package.json` has scripts: `test:e2e` (runs all specs), `test:e2e:ci` (runs CI-safe specs only via `--grep-invert @local-only`), `test:e2e:report` (runs the report aggregator)
- `tests/e2e/results/` is in `.gitignore`
- Running `bun run test:e2e:report` after a test run produces readable output
**Scope:** `tests/e2e/report-latency.ts`, `package.json`, `.gitignore`
**Agent:** welder
**Verify:** `bun run test:e2e:report` (after at least one test run generates timing files)
**Depends on:** Task 4

---

### Task 7: Full suite review and validation

**Intent:** Run the complete test suite, review all code for quality, verify acceptance criteria from the spec, and produce a pass/fail scorecard.
**Acceptance criteria:**
- All 7 spec files pass (3 CI-safe + 4 local-only)
- Latency report generates without errors
- No `page.waitForTimeout()` in any spec file
- Every spec file uses the custom `test` fixture from `fixtures.ts`
- Temp directories are cleaned up after test run (no orphan `baara-e2e-*` dirs in system temp)
- Typecheck passes across all test files
**Scope:** `tests/e2e/`
**Agent:** sentinel
**Verify:** `cd tests/e2e && npx playwright test && bun run ../../report-latency.ts`
**Depends on:** Task 5, Task 6

---

## Wave Plan

```
Wave 1 (parallel):  Task 1 (data-testid + vite config)
                    Task 2 (scaffold e2e infrastructure)

Wave 2 (sequential): Task 3 (helpers — depends on 1 + 2)

Wave 3 (parallel):  Task 4 (CI-safe specs)
                    Task 5 (local-only specs)

Wave 4 (sequential): Task 6 (reporting + scripts — depends on 4)

Wave 5 (sequential): Task 7 (full validation — depends on 5 + 6)
```

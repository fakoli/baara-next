# Task Validation Suite — Execution Plan

**Goal:** Build a validation suite exercising every task execution path at three difficulty levels with timing metrics from both API and UI perspectives.
**Spec:** docs/specs/2026-04-05-task-validation-suite.md
**Language:** TypeScript
**Crew:** fakoli-crew v1.0.0

---

## Scout Findings

- `listAllExecutions(opts?)` exists in store (sqlite-store.ts:311) — supports status filter and limit
- `listExecutions(taskId, opts?)` exists (sqlite-store.ts:199) — for cron polling by task ID
- `POST /api/tasks/:id/submit` returns execution (201) — for queued mode
- `POST /api/tasks/:id/run` returns execution directly — for direct mode
- Cron scheduler at `packages/orchestrator/src/scheduler.ts` handles scheduled execution
- E2E helpers (`tests/e2e/helpers/server.ts`, `api.ts`) use Node APIs and can be copied for the validation package
- E2E API client already has `createTask`, `runTask`, `getExecution`, `waitForExecution`, `deleteTask` — validation needs `submitTask` and `listExecutionsByTask` added
- Wasm sandbox availability is runtime-dependent — specs must check at test time

## File Map

| File | Responsibility | Task |
|------|---------------|------|
| `tests/validation/package.json` | Dependencies | Task 1 |
| `tests/validation/tsconfig.json` | TypeScript config | Task 1 |
| `tests/validation/playwright.config.ts` | Playwright config (120s timeout) | Task 1 |
| `tests/validation/helpers/server.ts` | Server lifecycle (copy from E2E, adapt) | Task 2 |
| `tests/validation/helpers/api.ts` | API client (extend from E2E with submitTask, listExecutionsByTask) | Task 2 |
| `tests/validation/helpers/fixtures.ts` | Custom fixtures with metrics collection | Task 2 |
| `tests/validation/helpers/metrics.ts` | ValidationTiming types + timing capture + sanity checks | Task 2 |
| `tests/validation/helpers/task-definitions.ts` | All ~21 task definitions across 7 categories x 3 difficulties | Task 2 |
| `tests/validation/suites/api/native-direct.spec.ts` | native + direct: easy/med/hard | Task 3 |
| `tests/validation/suites/api/native-queued.spec.ts` | native + queued: easy/med/hard | Task 3 |
| `tests/validation/suites/api/wasm-direct.spec.ts` | wasm + direct: easy/med/hard | Task 3 |
| `tests/validation/suites/api/wasm-queued.spec.ts` | wasm + queued: easy/med/hard | Task 3 |
| `tests/validation/suites/api/cron-trigger.spec.ts` | cron-scheduled: easy/med/hard | Task 4 |
| `tests/validation/suites/api/output-routing.spec.ts` | thread routing: easy/med/hard | Task 4 |
| `tests/validation/suites/api/retry-recovery.spec.ts` | retry + checkpoint: easy/med/hard | Task 4 |
| `tests/validation/suites/ui/chat-session-new.spec.ts` | UI timing from new session | Task 5 |
| `tests/validation/suites/ui/chat-session-existing.spec.ts` | UI timing from existing session | Task 5 |
| `tests/validation/report-validation.ts` | Aggregate timing JSON into summary table | Task 6 |
| `tests/validation/report-validation.test.ts` | Unit test for report generator | Task 6 |
| `package.json` (root) | Add test:validation scripts | Task 6 |
| `.gitignore` | Add tests/validation/results/ | Task 6 |

---

### Task 1: Scaffold validation test infrastructure

**Intent:** Create the `tests/validation/` directory structure with Playwright dependency, TypeScript config, and Playwright configuration file matching the spec's requirements.
**Acceptance criteria:**
- `tests/validation/package.json` declares `@playwright/test` and `@types/node` as dependencies
- `tests/validation/tsconfig.json` extends root `tsconfig.base.json` with Node/Playwright-compatible overrides (same pattern as `tests/e2e/tsconfig.json`)
- `tests/validation/playwright.config.ts` has `workers: 1`, `timeout: 120_000`, `retries: 0`, projects for both `suites/api` and `suites/ui` directories
- Empty directories created: `helpers/`, `suites/api/`, `suites/ui/`, `results/`
- `bun install` and `npx playwright install chromium` succeed from `tests/validation/`
**Scope:** `tests/validation/package.json`, `tests/validation/tsconfig.json`, `tests/validation/playwright.config.ts`
**Agent:** welder
**Verify:** `cd tests/validation && cat playwright.config.ts && ls helpers/ suites/api/ suites/ui/`
**Depends on:** (none)

---

### Task 2: Build validation helpers (server, API client, fixtures, metrics, task definitions)

**Intent:** Implement the five helper modules: server lifecycle, extended API client, custom Playwright fixtures with metrics collection, timing measurement types with sanity invariants, and the complete set of ~21 task definitions.
**Acceptance criteria:**
- `server.ts` follows the same pattern as `tests/e2e/helpers/server.ts` — spawns backend + Vite, polls until ready, cleans up on teardown. Read the E2E version and adapt it.
- `api.ts` extends the E2E API client with two additional methods: `submitTask(taskId)` calling `POST /api/tasks/:id/submit` and `listExecutionsByTask(taskId)` calling `GET /api/executions?task_id=:id`. Read `tests/e2e/helpers/api.ts` and `packages/server/src/routes/tasks.ts` + `packages/server/src/routes/executions.ts` for exact API shapes.
- `fixtures.ts` exports a custom `test` with worker-scoped `server` and `apiClient`, and test-scoped `metrics` (collects `ValidationTiming[]`, writes to `results/` on teardown)
- `metrics.ts` exports `ValidationTiming` and `ValidationReport` types, a `captureApiTiming()` function that polls an execution and records timeToStart/timeToFirstResponse/totalDuration, and a `validateTimingSanity()` function that asserts the ordering invariants
- `task-definitions.ts` exports all ~21 `TaskDefinition` objects organized by category, with difficulty-appropriate prompts: easy uses shell commands (`echo hello`), medium uses multi-tool prompts, hard uses multi-turn reasoning prompts. Each definition includes `expectedBehavior` description.
- All helpers compile with `npx tsc --noEmit`
**Scope:** `tests/validation/helpers/server.ts`, `tests/validation/helpers/api.ts`, `tests/validation/helpers/fixtures.ts`, `tests/validation/helpers/metrics.ts`, `tests/validation/helpers/task-definitions.ts`
**Agent:** welder
**Verify:** `cd tests/validation && npx tsc --noEmit`
**Depends on:** Task 1

---

### Task 3: Write sandbox x execution-mode spec files (native-direct, native-queued, wasm-direct, wasm-queued)

**Intent:** Implement the four core API-driven spec files that validate the sandbox type and execution mode matrix at all three difficulty levels.
**Acceptance criteria:**
- Each spec file iterates over easy/medium/hard definitions from `task-definitions.ts` for its category
- Each test creates a task via API, runs or submits it (direct vs queued), captures timing via `captureApiTiming()`, validates timing sanity, records the `ValidationTiming`, and cleans up the task
- `wasm-direct.spec.ts` and `wasm-queued.spec.ts` skip with `test.skip()` when wasm sandbox is unavailable (check via `GET /api/system/status` or a dedicated availability check)
- Easy tests do NOT require `ANTHROPIC_API_KEY` (shell commands only)
- Medium and hard tests are wrapped in `test.describe('@local-only', ...)`
- All four specs compile and the easy tests pass
**Scope:** `tests/validation/suites/api/native-direct.spec.ts`, `tests/validation/suites/api/native-queued.spec.ts`, `tests/validation/suites/api/wasm-direct.spec.ts`, `tests/validation/suites/api/wasm-queued.spec.ts`
**Agent:** welder
**Verify:** `cd tests/validation && npx playwright test suites/api/native-direct.spec.ts suites/api/native-queued.spec.ts --grep-invert @local-only`
**Depends on:** Task 2

---

### Task 4: Write feature-path spec files (cron-trigger, output-routing, retry-recovery)

**Intent:** Implement the three API-driven spec files that validate feature-specific execution paths: cron scheduling, output routing to threads, and retry with recovery.
**Acceptance criteria:**
- `cron-trigger.spec.ts`: creates tasks with `*/1 * * * *` cron expression, polls `listExecutionsByTask()` for up to 90 seconds until an execution appears, measures timing from the execution's `scheduledAt` field
- `output-routing.spec.ts`: creates tasks with `targetThreadId` set to a specific thread, runs the task, waits for completion, verifies the output message exists in the target thread via `getThreadMessages()`
- `retry-recovery.spec.ts`: creates tasks with tight `timeoutMs` (e.g., 5000ms) designed to fail on first attempt, verifies retry creates a new execution attempt, measures total time across all attempts
- Easy tests do NOT require `ANTHROPIC_API_KEY`; medium/hard wrapped in `@local-only`
- All three specs compile and easy tests pass
**Scope:** `tests/validation/suites/api/cron-trigger.spec.ts`, `tests/validation/suites/api/output-routing.spec.ts`, `tests/validation/suites/api/retry-recovery.spec.ts`
**Agent:** welder
**Verify:** `cd tests/validation && npx playwright test suites/api/cron-trigger.spec.ts suites/api/output-routing.spec.ts suites/api/retry-recovery.spec.ts --grep-invert @local-only`
**Depends on:** Task 2

---

### Task 5: Write UI-driven timing spec files (new session, existing session)

**Intent:** Implement the two Playwright browser-driven spec files that capture timing metrics from the user's perspective through the chat interface.
**Acceptance criteria:**
- `chat-session-new.spec.ts`: navigates to a fresh page, types prompt, sends via chat input, measures time from send click to first `[data-testid="msg-agent"]` visible (timeToFirstResponse) and to agent message complete (totalDuration). Runs for easy/medium/hard prompts.
- `chat-session-existing.spec.ts`: sends an initial message to establish a session, then sends a second message and measures the same timing metrics. Captures session resumption overhead vs cold start.
- Both specs record `ValidationTiming` with `interface: "ui-new-session"` or `"ui-existing-session"`
- All tests wrapped in `test.describe('@local-only', ...)` since they require real SDK calls
- No `page.waitForTimeout()` — all waits use Playwright auto-retry with generous timeouts
**Scope:** `tests/validation/suites/ui/chat-session-new.spec.ts`, `tests/validation/suites/ui/chat-session-existing.spec.ts`
**Agent:** welder
**Verify:** `cd tests/validation && npx tsc --noEmit`
**Depends on:** Task 2

---

### Task 6: Build report generator, unit test, and root scripts

**Intent:** Create the validation report aggregator with unit test and wire up convenience scripts in the root `package.json`.
**Acceptance criteria:**
- `report-validation.ts` reads all `tests/validation/results/timings-*.json` files, aggregates per task definition (min/avg/max/p95 for each timing field), groups by category and difficulty, and prints a formatted table to stdout
- `report-validation.test.ts` feeds known JSON fixture data to the report generator and asserts correct avg/p95 calculations. Runs with `bun test tests/validation/report-validation.test.ts`.
- Root `package.json` has scripts: `test:validation`, `test:validation:ci`, `test:validation:report`
- `tests/validation/results/` is in `.gitignore`
- Running `bun run test:validation:report` with no timing files prints a helpful message instead of crashing
**Scope:** `tests/validation/report-validation.ts`, `tests/validation/report-validation.test.ts`, `package.json`, `.gitignore`
**Agent:** welder
**Verify:** `bun test tests/validation/report-validation.test.ts`
**Depends on:** Task 3

---

### Task 7: Full suite validation

**Intent:** Run the complete validation suite, verify all acceptance criteria from the spec, and produce a pass/fail scorecard.
**Acceptance criteria:**
- All 7 API-driven spec files execute (easy tests pass, wasm skips gracefully if unavailable)
- Both UI-driven spec files compile without errors
- Validation report generates without errors from timing data
- `report-validation.test.ts` passes
- No `page.waitForTimeout()` in any spec file
- TypeScript compiles clean across all validation files
- Zero orphan tasks or temp directories after suite completion
**Scope:** `tests/validation/`
**Agent:** sentinel
**Verify:** `cd tests/validation && npx playwright test --grep-invert @local-only && bun test report-validation.test.ts`
**Depends on:** Task 4, Task 5, Task 6

---

## Wave Plan

```
Wave 1:              Task 1 (scaffold infrastructure)

Wave 2:              Task 2 (helpers — depends on 1)

Wave 3 (parallel):   Task 3 (sandbox x mode specs)
                     Task 4 (feature-path specs)
                     Task 5 (UI-driven specs)

Wave 4:              Task 6 (reporting + scripts — depends on 3)

Wave 5:              Task 7 (sentinel validation — depends on 4, 5, 6)
```

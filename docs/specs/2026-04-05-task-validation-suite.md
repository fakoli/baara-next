# Task Type Validation Suite — Spec

**Date:** 2026-04-05
**Status:** Draft
**Scope:** End-to-end validation of all task types across difficulty levels with timing metrics

---

## Goal

Build a validation suite that exercises every task execution path (sandbox type x execution mode x feature) at three difficulty levels, captures timing metrics (time-to-start, time-to-first-response, total duration) from both API and UI perspectives, and produces a structured report.

## Context

The BAARA Next system supports multiple task execution paths: native and wasm sandboxes, direct and queued execution modes, cron scheduling, output routing to threads, and retry with checkpoint recovery. The UI evaluation (2026-04-05) confirmed the web interface works correctly, and the Playwright E2E framework validates rendering and basic CRUD. This validation suite goes deeper — it exercises the execution engine across all paths and measures performance.

---

## Architecture

```
tests/validation/
  package.json                      # @playwright/test dependency
  tsconfig.json                     # Extends root tsconfig.base.json
  playwright.config.ts              # workers: 1, timeout: 120_000
  helpers/
    server.ts                       # Server lifecycle (reuses E2E pattern)
    api.ts                          # API client (reuses E2E pattern)
    fixtures.ts                     # Custom fixtures: server, apiClient, metrics
    metrics.ts                      # Timing capture + classification
    task-definitions.ts             # All ~20 test case definitions
  suites/
    api/                            # API-driven timing (no browser)
      native-direct.spec.ts         # native + direct: easy/med/hard
      native-queued.spec.ts         # native + queued: easy/med/hard
      wasm-direct.spec.ts           # wasm + direct: easy/med/hard
      wasm-queued.spec.ts           # wasm + queued: easy/med/hard
      cron-trigger.spec.ts          # cron-scheduled: easy/med/hard
      output-routing.spec.ts        # thread routing: easy/med/hard
      retry-recovery.spec.ts        # retry + checkpoint: easy/med/hard
    ui/                             # Browser-driven timing (Playwright)
      chat-session-new.spec.ts      # Timing from new session
      chat-session-existing.spec.ts # Timing from existing session
  results/                          # Timing JSON output (gitignored)
  report-validation.ts              # Aggregates results into summary table
  report-validation.test.ts         # Unit test for report generator
```

### Key Decisions

- **API-driven suites** call REST endpoints directly — no browser overhead. Isolates infrastructure timing from UI rendering cost.
- **UI-driven suites** use Playwright to measure from the user's perspective — includes SSE parsing, React rendering, and Vite proxy latency.
- **`task-definitions.ts`** is the single source of truth for all test cases. Each spec imports definitions for its category and iterates over difficulties.
- **Server lifecycle** reuses the same pattern from `tests/e2e/helpers/`: temp data-dir, random ports, backend + Vite, cleanup on teardown.
- **Separate from E2E.** Runs via `bun run test:validation`, not `bun run test:e2e`. The validation suite is long-running (hard tasks involve multi-turn SDK calls) and should not slow down CI.

---

## Data Model

### TaskDefinition

```typescript
type Difficulty = "easy" | "medium" | "hard";
type SandboxType = "native" | "wasm";
type ExecutionMode = "direct" | "queued";
type TaskCategory =
  | "native-direct" | "native-queued"
  | "wasm-direct" | "wasm-queued"
  | "cron-trigger" | "output-routing" | "retry-recovery";

interface TaskDefinition {
  id: string;                    // e.g., "native-direct-easy"
  category: TaskCategory;
  difficulty: Difficulty;
  name: string;                  // Task name for creation
  prompt: string;                // The actual prompt
  sandboxType: SandboxType;
  executionMode: ExecutionMode;
  cronExpression?: string;       // For cron-trigger tasks
  targetThreadId?: string;       // For output-routing tasks (null = Main)
  maxRetries?: number;           // For retry-recovery tasks
  timeoutMs?: number;            // Override default
  expectedBehavior: string;      // Human description of expected outcome
}
```

### Difficulty Matrix

| Difficulty | Prompt | Infrastructure |
|-----------|--------|----------------|
| Easy | Single shell command: `echo hello` | Default config, no retries, no routing |
| Medium | Multi-tool: "List all tasks and show queue status" | 1 retry, output routing to a thread |
| Hard | Multi-turn: "Create a health check task, run it, verify it completed, report results" | 3 retries, checkpoint every 2 turns, output routing, budget limit |

### ValidationTiming

```typescript
interface ValidationTiming {
  taskDefinitionId: string;
  category: TaskCategory;
  difficulty: Difficulty;
  interface: "api" | "ui-new-session" | "ui-existing-session";
  timeToStartMs: number;         // Request → execution status "running"
  timeToFirstResponseMs: number; // Request → first output
  totalDurationMs: number;       // Request → terminal status
  executionId: string;
  status: "completed" | "failed" | "timed_out";
  timestamp: string;
}
```

### ValidationReport

```typescript
interface ValidationReport {
  runId: string;
  startedAt: string;
  completedAt: string;
  timings: ValidationTiming[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    byCategory: Record<TaskCategory, { avg: number; p95: number }>;
    byDifficulty: Record<Difficulty, { avg: number; p95: number }>;
  };
}
```

---

## Data Flow

### API-Driven Suites (7 spec files, ~21 test cases)

For each task definition:

1. Create task via `apiClient.createTask(definition)`.
2. Record `T0 = Date.now()`.
3. Run task:
   - Direct mode: `POST /api/tasks/:id/run`
   - Queued mode: `POST /api/tasks/:id/submit`
   - Cron: create with cron expression, wait for scheduled execution
4. Poll `GET /api/executions/:id` every 200ms:
   - First poll returning status `"running"` → `timeToStartMs = now - T0`
   - First poll returning output or events → `timeToFirstResponseMs = now - T0`
   - Terminal status → `totalDurationMs = now - T0`
5. Record `ValidationTiming` with `interface: "api"`.
6. Cleanup: delete task in `finally` block.

### Cron Task Timing

For cron-triggered tasks, the test creates the task with `*/1 * * * *` (every minute). It then polls `GET /api/executions?task_id=X` for up to 90 seconds until an execution appears. Timing is measured from the execution's `scheduledAt` timestamp.

### Retry/Recovery Timing

For retry-recovery tasks, the test creates a task designed to fail on the first attempt (tight timeout or a prompt that triggers a timeout). It verifies:
- The retry mechanism fires.
- A new execution attempt is created.
- Total time across all attempts is measured until terminal status.

### UI-Driven Suites (2 spec files)

**`chat-session-new.spec.ts`:**
1. Navigate to fresh page (new session, no threadId).
2. Record `T0`.
3. Type prompt, click send.
4. Wait for first `[data-testid="msg-agent"]` visible → `timeToFirstResponseMs`.
5. Wait for agent message to stop streaming → `totalDurationMs`.
6. Run for easy, medium, hard prompts.

**`chat-session-existing.spec.ts`:**
1. Send an initial message to establish a session.
2. Record `T0`.
3. Send second message (the actual test prompt).
4. Same timing capture.
5. Measures session resumption overhead vs cold start.

### Timing Collection and Reporting

Each spec writes to `tests/validation/results/timings-{spec}-{timestamp}.json`. The report generator reads all timing files and produces a table:

```
Category        | Difficulty | Interface      | Start(ms) | FirstResp(ms) | Total(ms) | Status
native-direct   | easy       | api            | 45        | 1200          | 12400     | completed
native-direct   | easy       | ui-new-session | 120       | 2300          | 14200     | completed
...
```

Plus a summary section with avg/p95 grouped by category and by difficulty.

---

## Error Handling

### Expected Failures (data, not errors)

Task execution failures are expected in retry-recovery tests. A `failed` or `timed_out` status is recorded in `ValidationTiming.status` — it is data, not a test failure.

### Test Failures

- Server fails to start → fixture throws, spec file skipped with descriptive error.
- Polling exceeds maximum wait (120s API, 90s cron, 60s UI) → test fails with timeout message identifying the task definition.
- Task creation returns non-2xx → test fails immediately with API error body.
- Execution never appears after submit (queued mode) → test fails after 30s poll timeout.

### Tolerated Conditions

- Wasm sandbox `isAvailable()` returning false → wasm specs skipped with `test.skip()` and a log message.
- Cron not firing within 90s → recorded as `timed_out`, not a test infrastructure error.
- Hard tasks hitting budget limits → recorded with actual status, timing still captured.

### Cleanup Guarantees

- Every task created is deleted in a `finally` block regardless of outcome.
- Server temp dirs cleaned up by fixture teardown.
- Cleanup failures log warnings but do not fail tests.

---

## Verification

### Metric Sanity Invariants

Every `ValidationTiming` record is checked inline:
- `timeToStartMs <= timeToFirstResponseMs <= totalDurationMs`
- `timeToStartMs >= 0`
- `status` matches `getExecution()` result
- `executionId` is a valid UUID

### Smoke Check

Easy/native-direct has a known baseline (~12s total, <200ms API overhead from E2E reports). Significant deviation indicates a measurement bug.

### Report Generator Test

`report-validation.test.ts` feeds known JSON fixtures to `report-validation.ts` and asserts correct avg/p95 calculations.

### CI-Safe Subset

API-driven easy tests (native-direct-easy, native-queued-easy) run without `ANTHROPIC_API_KEY` using shell prompts. All medium/hard tests are `@local-only`.

---

## Running the Suite

```bash
bun run test:validation              # Full suite (local, needs API key)
bun run test:validation:ci           # Easy-only smoke check (no API key)
bun run test:validation:report       # Generate summary table from results
```

### Scripts in root package.json

```json
{
  "test:validation": "cd tests/validation && npx playwright test",
  "test:validation:ci": "cd tests/validation && npx playwright test --grep-invert @local-only",
  "test:validation:report": "bun run tests/validation/report-validation.ts"
}
```

---

## Out of Scope

- Docker sandbox testing (stubbed out, `isAvailable()` always returns false)
- Visual regression testing
- Load/stress testing (concurrent task submissions)
- Web UI diagnostic toggle (System B — separate spec)
- MCP integration testing

---

## Acceptance Criteria

1. All 7 API-driven spec files execute against a live server with fresh database per file.
2. Both UI-driven spec files capture timing from new and existing sessions.
3. Every test case records a `ValidationTiming` with all fields populated.
4. `report-validation.ts` produces a readable summary table grouped by category and difficulty.
5. Metric sanity invariants hold for every timing record.
6. Easy tests (CI-safe) pass without `ANTHROPIC_API_KEY`.
7. Wasm specs gracefully skip when wasm sandbox is unavailable.
8. Zero orphan tasks or temp directories after suite completion.
9. `report-validation.test.ts` passes with known fixture data.
10. Root `package.json` has `test:validation`, `test:validation:ci`, `test:validation:report` scripts.

# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: suites/api/cron-trigger.spec.ts >> cron-trigger easy: cron task fires and execution appears within 90s
- Location: suites/api/cron-trigger.spec.ts:72:5

# Error details

```
Error: No cron execution appeared for task a44e9f70-88c6-4e0b-8f90-96d00c46f6bc within 90000ms
```

# Test source

```ts
  1   | // tests/validation/suites/api/cron-trigger.spec.ts
  2   | //
  3   | // Validates that cron-scheduled tasks fire and produce executions.
  4   | //
  5   | // Strategy:
  6   | //   1. Create a cron task using getDefinitionsByCategory("cron-trigger").
  7   | //   2. Poll listExecutionsByTask(taskId) until at least one execution appears
  8   | //      (up to 90 seconds — cron fires every 1 minute per "*/1 * * * *").
  9   | //   3. Measure scheduling latency from execution.scheduledAt to wall clock.
  10  | //   4. Record timing via captureApiTiming on the first observed execution.
  11  | //
  12  | // Tagging:
  13  | //   - easy:   NOT @local-only — runs in CI.
  14  | //   - medium: @local-only — cron scheduling relies on a long-lived server.
  15  | //   - hard:   @local-only — same reason.
  16  | 
  17  | import { test, expect } from "../../helpers/fixtures";
  18  | import { getDefinitionsByCategory } from "../../helpers/task-definitions";
  19  | import { captureApiTiming, validateTimingSanity } from "../../helpers/metrics";
  20  | import type { ValidationTiming } from "../../helpers/metrics";
  21  | 
  22  | // ---------------------------------------------------------------------------
  23  | // Constants
  24  | // ---------------------------------------------------------------------------
  25  | 
  26  | /** Maximum ms to wait for the first cron-triggered execution to appear. */
  27  | const CRON_POLL_TIMEOUT_MS = 90_000;
  28  | /** Poll interval when waiting for a cron execution to appear. */
  29  | const CRON_POLL_INTERVAL_MS = 2_000;
  30  | 
  31  | const DEFS = getDefinitionsByCategory("cron-trigger");
  32  | 
  33  | // ---------------------------------------------------------------------------
  34  | // Helper: poll listExecutionsByTask until at least one execution appears.
  35  | // Returns the first execution found, or throws if deadline is exceeded.
  36  | // ---------------------------------------------------------------------------
  37  | 
  38  | async function waitForFirstCronExecution(
  39  |   apiClient: { listExecutionsByTask(taskId: string): Promise<Array<{ id: string; scheduledAt: string; status: string; [key: string]: unknown }>> },
  40  |   taskId: string,
  41  |   timeoutMs: number
  42  | ): Promise<{ id: string; scheduledAt: string; status: string; [key: string]: unknown }> {
  43  |   const deadline = Date.now() + timeoutMs;
  44  |   while (Date.now() < deadline) {
  45  |     const executions = await apiClient.listExecutionsByTask(taskId);
  46  |     if (executions.length > 0) {
  47  |       return executions[0];
  48  |     }
  49  |     await new Promise((resolve) => setTimeout(resolve, CRON_POLL_INTERVAL_MS));
  50  |   }
> 51  |   throw new Error(
      |         ^ Error: No cron execution appeared for task a44e9f70-88c6-4e0b-8f90-96d00c46f6bc within 90000ms
  52  |     `No cron execution appeared for task ${taskId} within ${timeoutMs}ms`
  53  |   );
  54  | }
  55  | 
  56  | // ---------------------------------------------------------------------------
  57  | // Tests
  58  | // ---------------------------------------------------------------------------
  59  | 
  60  | const easyDef = DEFS.find((d) => d.difficulty === "easy");
  61  | const mediumDef = DEFS.find((d) => d.difficulty === "medium");
  62  | const hardDef = DEFS.find((d) => d.difficulty === "hard");
  63  | 
  64  | if (!easyDef || !mediumDef || !hardDef) {
  65  |   throw new Error("Missing cron-trigger task definitions — check task-definitions.ts");
  66  | }
  67  | 
  68  | // ---------------------------------------------------------------------------
  69  | // Easy — not @local-only; runs in CI
  70  | // ---------------------------------------------------------------------------
  71  | 
  72  | test("cron-trigger easy: cron task fires and execution appears within 90s", async ({
  73  |   apiClient,
  74  |   metrics,
  75  | }) => {
  76  |   const def = easyDef;
  77  | 
  78  |   const task = await apiClient.createTask({
  79  |     name: def.name,
  80  |     prompt: def.prompt,
  81  |     executionMode: def.executionMode,
  82  |     sandboxType: def.sandboxType,
  83  |     cronExpression: def.cronExpression ?? undefined,
  84  |     enabled: true,
  85  |     maxRetries: def.maxRetries ?? 0,
  86  |     timeoutMs: def.timeoutMs ?? 30_000,
  87  |   });
  88  | 
  89  |   try {
  90  |     // t0 is when we registered the task; cron fires from this moment forward.
  91  |     const t0 = Date.now();
  92  | 
  93  |     // Wait for the scheduler to fire the first execution.
  94  |     const firstExecution = await waitForFirstCronExecution(
  95  |       apiClient,
  96  |       task.id,
  97  |       CRON_POLL_TIMEOUT_MS
  98  |     );
  99  | 
  100 |     // Measure scheduling latency: how long from t0 until scheduledAt.
  101 |     const scheduledEpoch = new Date(firstExecution.scheduledAt).getTime();
  102 |     const schedulingLatencyMs = scheduledEpoch - t0;
  103 | 
  104 |     // scheduledAt may be slightly before t0 if the cron tick was already pending;
  105 |     // that is acceptable.  We only assert it's a valid date.
  106 |     expect(Number.isFinite(scheduledEpoch)).toBe(true);
  107 | 
  108 |     // Capture full execution timing (waits for terminal status).
  109 |     const partialTiming = await captureApiTiming(
  110 |       apiClient,
  111 |       firstExecution.id,
  112 |       t0,
  113 |       120_000
  114 |     );
  115 | 
  116 |     const timing: ValidationTiming = {
  117 |       ...partialTiming,
  118 |       taskDefinitionId: def.id,
  119 |       category: def.category,
  120 |       difficulty: def.difficulty,
  121 |       interface: "api",
  122 |     };
  123 | 
  124 |     validateTimingSanity(timing);
  125 |     metrics.push(timing);
  126 | 
  127 |     // The execution must reach a terminal status.
  128 |     expect(timing.status).toMatch(/^(completed|failed|timed_out|dead_lettered|cancelled)$/);
  129 | 
  130 |     // Log scheduling latency for observability (not a hard assertion).
  131 |     console.log(
  132 |       `[cron-trigger easy] scheduling latency: ${schedulingLatencyMs}ms, ` +
  133 |       `execution status: ${timing.status}, ` +
  134 |       `total duration: ${timing.totalDurationMs}ms`
  135 |     );
  136 |   } finally {
  137 |     await apiClient.deleteTask(task.id);
  138 |   }
  139 | });
  140 | 
  141 | // ---------------------------------------------------------------------------
  142 | // Medium — @local-only: requires a persistent server for cron scheduling
  143 | // ---------------------------------------------------------------------------
  144 | 
  145 | test("@local-only cron-trigger medium: cron fires and execution list grows", async ({
  146 |   apiClient,
  147 |   metrics,
  148 | }) => {
  149 |   const def = mediumDef;
  150 | 
  151 |   const task = await apiClient.createTask({
```
// tests/validation/helpers/task-definitions.ts
//
// All ~21 TaskDefinition objects used across validation spec files.
// Each definition maps to one task that will be created in the server, run,
// and measured during validation.

// ---------------------------------------------------------------------------
// Well-known IDs (mirrors packages/core/src/types.ts)
// ---------------------------------------------------------------------------

/** The Main thread always exists (seeded by migration 5). */
const MAIN_THREAD_ID = "00000000-0000-0000-0000-000000000000";

// ---------------------------------------------------------------------------
// TaskDefinition type
// ---------------------------------------------------------------------------

export type SandboxType = "native" | "wasm" | "docker";
export type ExecutionMode = "direct" | "queued";
export type Difficulty = "easy" | "medium" | "hard";

export interface TaskDefinition {
  /** Stable ID used as a key in timing reports. */
  id: string;
  /** Category grouping (e.g. "native-direct", "cron-trigger"). */
  category: string;
  /** Difficulty tier. */
  difficulty: Difficulty;
  /** Human-readable task name (unique within a test run). */
  name: string;
  /** The prompt sent to the agent. */
  prompt: string;
  /** Sandbox isolation layer. */
  sandboxType: SandboxType;
  /** Queue or direct execution. */
  executionMode: ExecutionMode;
  /** Cron schedule string (if this is a recurring task). */
  cronExpression?: string;
  /** Override for output routing. Null means route to Main thread. */
  targetThreadId?: string | null;
  /** Maximum retry attempts. */
  maxRetries?: number;
  /** Wall-clock timeout per attempt in ms. */
  timeoutMs?: number;
  /** Human-readable description of what a passing run looks like. */
  expectedBehavior: string;
}

// ---------------------------------------------------------------------------
// Category: native-direct
// Native sandbox, runs directly (bypasses queue).
// ---------------------------------------------------------------------------

const NATIVE_DIRECT_EASY: TaskDefinition = {
  id: "native-direct-easy",
  category: "native-direct",
  difficulty: "easy",
  name: "val-native-direct-easy",
  prompt: "echo hello",
  sandboxType: "native",
  executionMode: "direct",
  expectedBehavior: "Execution completes successfully; output contains 'hello'.",
};

const NATIVE_DIRECT_MEDIUM: TaskDefinition = {
  id: "native-direct-medium",
  category: "native-direct",
  difficulty: "medium",
  name: "val-native-direct-medium",
  prompt: "List all tasks and show queue status",
  sandboxType: "native",
  executionMode: "direct",
  expectedBehavior: "Execution completes with output describing tasks and queue depths.",
};

const NATIVE_DIRECT_HARD: TaskDefinition = {
  id: "native-direct-hard",
  category: "native-direct",
  difficulty: "hard",
  name: "val-native-direct-hard",
  prompt: "Create a health check task, run it, verify completion, report results",
  sandboxType: "native",
  executionMode: "direct",
  expectedBehavior: "Execution completes; output references task creation, run, and completion status.",
};

// ---------------------------------------------------------------------------
// Category: native-queued
// Native sandbox, routed through the queue worker.
// ---------------------------------------------------------------------------

const NATIVE_QUEUED_EASY: TaskDefinition = {
  id: "native-queued-easy",
  category: "native-queued",
  difficulty: "easy",
  name: "val-native-queued-easy",
  prompt: "echo hello",
  sandboxType: "native",
  executionMode: "queued",
  expectedBehavior: "Execution enters queue, is picked up by a worker, completes successfully.",
};

const NATIVE_QUEUED_MEDIUM: TaskDefinition = {
  id: "native-queued-medium",
  category: "native-queued",
  difficulty: "medium",
  name: "val-native-queued-medium",
  prompt: "List all tasks and show queue status",
  sandboxType: "native",
  executionMode: "queued",
  expectedBehavior: "Execution passes through the queue and completes with task/queue output.",
};

const NATIVE_QUEUED_HARD: TaskDefinition = {
  id: "native-queued-hard",
  category: "native-queued",
  difficulty: "hard",
  name: "val-native-queued-hard",
  prompt: "Create a health check task, run it, verify completion, report results",
  sandboxType: "native",
  executionMode: "queued",
  expectedBehavior: "Queued execution completes; output references task lifecycle steps.",
};

// ---------------------------------------------------------------------------
// Category: wasm-direct
// Wasm sandbox (Extism), runs directly.
// ---------------------------------------------------------------------------

const WASM_DIRECT_EASY: TaskDefinition = {
  id: "wasm-direct-easy",
  category: "wasm-direct",
  difficulty: "easy",
  name: "val-wasm-direct-easy",
  prompt: "echo hello",
  sandboxType: "wasm",
  executionMode: "direct",
  expectedBehavior: "Wasm sandbox executes successfully; output contains 'hello'.",
};

const WASM_DIRECT_MEDIUM: TaskDefinition = {
  id: "wasm-direct-medium",
  category: "wasm-direct",
  difficulty: "medium",
  name: "val-wasm-direct-medium",
  prompt: "List all tasks and show queue status",
  sandboxType: "wasm",
  executionMode: "direct",
  expectedBehavior: "Wasm sandbox completes; output describes tasks and queue depths.",
};

const WASM_DIRECT_HARD: TaskDefinition = {
  id: "wasm-direct-hard",
  category: "wasm-direct",
  difficulty: "hard",
  name: "val-wasm-direct-hard",
  prompt: "Create a health check task, run it, verify completion, report results",
  sandboxType: "wasm",
  executionMode: "direct",
  expectedBehavior: "Wasm sandbox completes; output references full task lifecycle.",
};

// ---------------------------------------------------------------------------
// Category: wasm-queued
// Wasm sandbox, routed through the queue worker.
// ---------------------------------------------------------------------------

const WASM_QUEUED_EASY: TaskDefinition = {
  id: "wasm-queued-easy",
  category: "wasm-queued",
  difficulty: "easy",
  name: "val-wasm-queued-easy",
  prompt: "echo hello",
  sandboxType: "wasm",
  executionMode: "queued",
  expectedBehavior: "Wasm queued execution completes successfully.",
};

const WASM_QUEUED_MEDIUM: TaskDefinition = {
  id: "wasm-queued-medium",
  category: "wasm-queued",
  difficulty: "medium",
  name: "val-wasm-queued-medium",
  prompt: "List all tasks and show queue status",
  sandboxType: "wasm",
  executionMode: "queued",
  expectedBehavior: "Wasm queued execution completes with task/queue output.",
};

const WASM_QUEUED_HARD: TaskDefinition = {
  id: "wasm-queued-hard",
  category: "wasm-queued",
  difficulty: "hard",
  name: "val-wasm-queued-hard",
  prompt: "Create a health check task, run it, verify completion, report results",
  sandboxType: "wasm",
  executionMode: "queued",
  expectedBehavior: "Wasm queued execution completes; output references task lifecycle steps.",
};

// ---------------------------------------------------------------------------
// Category: cron-trigger
// Native sandbox with cron schedule.  All use executionMode "queued" because
// cron-triggered tasks are always enqueued by the scheduler.
// ---------------------------------------------------------------------------

const CRON_TRIGGER_EASY: TaskDefinition = {
  id: "cron-trigger-easy",
  category: "cron-trigger",
  difficulty: "easy",
  name: "val-cron-trigger-easy",
  prompt: "echo cron-easy",
  sandboxType: "native",
  executionMode: "queued",
  cronExpression: "*/1 * * * *",
  expectedBehavior: "Cron task fires at least once; execution completes with output containing 'cron-easy'.",
};

const CRON_TRIGGER_MEDIUM: TaskDefinition = {
  id: "cron-trigger-medium",
  category: "cron-trigger",
  difficulty: "medium",
  name: "val-cron-trigger-medium",
  prompt: "List running executions",
  sandboxType: "native",
  executionMode: "queued",
  cronExpression: "*/1 * * * *",
  expectedBehavior: "Cron task fires; execution completes with a list of running executions.",
};

const CRON_TRIGGER_HARD: TaskDefinition = {
  id: "cron-trigger-hard",
  category: "cron-trigger",
  difficulty: "hard",
  name: "val-cron-trigger-hard",
  prompt: "Check system health and report",
  sandboxType: "native",
  executionMode: "queued",
  cronExpression: "*/1 * * * *",
  expectedBehavior: "Cron task fires; execution completes with a system health report.",
};

// ---------------------------------------------------------------------------
// Category: output-routing
// Verifies that task output lands in the correct thread.
// Easy routes to MAIN_THREAD_ID; medium/hard use separate target threads
// (tests must create those threads and pass their IDs when creating tasks).
// The targetThreadId values here are defaults — tests may override medium/hard.
// ---------------------------------------------------------------------------

const OUTPUT_ROUTING_EASY: TaskDefinition = {
  id: "output-routing-easy",
  category: "output-routing",
  difficulty: "easy",
  name: "val-output-routing-easy",
  prompt: "echo routed",
  sandboxType: "native",
  executionMode: "direct",
  targetThreadId: MAIN_THREAD_ID,
  expectedBehavior: "Output lands in the Main thread as a thread_messages row.",
};

const OUTPUT_ROUTING_MEDIUM: TaskDefinition = {
  id: "output-routing-medium",
  category: "output-routing",
  difficulty: "medium",
  name: "val-output-routing-medium",
  prompt: "Show queue depths",
  sandboxType: "native",
  executionMode: "direct",
  // null means the test must inject a real targetThreadId before creating the task.
  targetThreadId: null,
  expectedBehavior: "Output lands in the custom target thread, not in Main.",
};

const OUTPUT_ROUTING_HARD: TaskDefinition = {
  id: "output-routing-hard",
  category: "output-routing",
  difficulty: "hard",
  name: "val-output-routing-hard",
  prompt: "Create and run a task, summarize results",
  sandboxType: "native",
  executionMode: "direct",
  // null means the test must inject a real targetThreadId before creating the task.
  targetThreadId: null,
  expectedBehavior: "Output lands in the custom target thread; summary includes task name and status.",
};

// ---------------------------------------------------------------------------
// Category: retry-recovery
// Tasks with tight timeouts and retry budgets to exercise the retry/DLQ path.
// ---------------------------------------------------------------------------

const RETRY_RECOVERY_EASY: TaskDefinition = {
  id: "retry-recovery-easy",
  category: "retry-recovery",
  difficulty: "easy",
  name: "val-retry-recovery-easy",
  prompt: "echo hello",
  sandboxType: "native",
  executionMode: "direct",
  timeoutMs: 30_000,
  maxRetries: 1,
  expectedBehavior: "Execution completes within the generous timeout with 1 retry budget.",
};

const RETRY_RECOVERY_MEDIUM: TaskDefinition = {
  id: "retry-recovery-medium",
  category: "retry-recovery",
  difficulty: "medium",
  name: "val-retry-recovery-medium",
  prompt: "List all tasks and show queue status",
  sandboxType: "native",
  executionMode: "direct",
  timeoutMs: 15_000,
  maxRetries: 2,
  expectedBehavior: "Execution completes or retries up to 2 times before terminal status.",
};

const RETRY_RECOVERY_HARD: TaskDefinition = {
  id: "retry-recovery-hard",
  category: "retry-recovery",
  difficulty: "hard",
  name: "val-retry-recovery-hard",
  prompt: "Create a health check task, run it, verify completion, report results",
  sandboxType: "native",
  executionMode: "direct",
  timeoutMs: 5_000,
  maxRetries: 3,
  expectedBehavior: "Execution is likely to time out; retries up to 3x; eventually dead-lettered or completes.",
};

// ---------------------------------------------------------------------------
// Master list (all 21 definitions)
// ---------------------------------------------------------------------------

const ALL_DEFINITIONS: TaskDefinition[] = [
  NATIVE_DIRECT_EASY,
  NATIVE_DIRECT_MEDIUM,
  NATIVE_DIRECT_HARD,
  NATIVE_QUEUED_EASY,
  NATIVE_QUEUED_MEDIUM,
  NATIVE_QUEUED_HARD,
  WASM_DIRECT_EASY,
  WASM_DIRECT_MEDIUM,
  WASM_DIRECT_HARD,
  WASM_QUEUED_EASY,
  WASM_QUEUED_MEDIUM,
  WASM_QUEUED_HARD,
  CRON_TRIGGER_EASY,
  CRON_TRIGGER_MEDIUM,
  CRON_TRIGGER_HARD,
  OUTPUT_ROUTING_EASY,
  OUTPUT_ROUTING_MEDIUM,
  OUTPUT_ROUTING_HARD,
  RETRY_RECOVERY_EASY,
  RETRY_RECOVERY_MEDIUM,
  RETRY_RECOVERY_HARD,
];

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/**
 * Return all definitions whose `category` field matches `category`.
 */
export function getDefinitionsByCategory(category: string): TaskDefinition[] {
  return ALL_DEFINITIONS.filter((d) => d.category === category);
}

/**
 * Return all definitions whose `difficulty` field matches `difficulty`.
 */
export function getDefinitionsByDifficulty(difficulty: Difficulty): TaskDefinition[] {
  return ALL_DEFINITIONS.filter((d) => d.difficulty === difficulty);
}

/**
 * Return all 21 task definitions.
 */
export function getAllDefinitions(): TaskDefinition[] {
  return ALL_DEFINITIONS.slice();
}

// Re-export the well-known constant so test files can reference it without
// duplicating the UUID string.
export { MAIN_THREAD_ID };

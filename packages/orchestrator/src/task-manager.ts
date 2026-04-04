// @baara-next/orchestrator — Task Manager
//
// CRUD facade over the store with input sanitisation.  Ported from
// BAARA v1's TaskService, adapted to the @baara-next/core types.
//
// Sanitisation rules (matching BAARA v1 behaviour):
//   - timeoutMs   clamped to [1 000, 3 600 000]
//   - maxRetries  clamped to [0, 10]
//   - budgetUsd   ceiling of $10 (agentConfig.budgetUsd)
//   - executionType must be one of the valid ExecutionType values
//   - permissionMode must be one of the valid mode strings
//
// ID generation: crypto.randomUUID() — no external dependency needed.

import type { IStore } from "@baara-next/core";
import type {
  Task,
  CreateTaskInput,
  UpdateTaskInput,
  ExecutionType,
} from "@baara-next/core";
import { TaskNotFoundError } from "@baara-next/core";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 3_600_000;
const MIN_RETRIES = 0;
const MAX_RETRIES = 10;
const MAX_BUDGET_USD = 10.0;

const VALID_EXECUTION_TYPES: ExecutionType[] = [
  "cloud_code",
  "wasm",
  "wasm_edge",
  "shell",
];

const VALID_PERMISSION_MODES: string[] = [
  "default",
  "acceptEdits",
  "bypassPermissions",
];

// ---------------------------------------------------------------------------
// Input sanitisation
// ---------------------------------------------------------------------------

function sanitizeInput(input: CreateTaskInput | UpdateTaskInput): void {
  // Clamp timeoutMs
  if (input.timeoutMs !== undefined) {
    input.timeoutMs = Math.min(
      Math.max(input.timeoutMs, MIN_TIMEOUT_MS),
      MAX_TIMEOUT_MS
    );
  }

  // Clamp maxRetries
  if (input.maxRetries !== undefined) {
    input.maxRetries = Math.min(
      Math.max(input.maxRetries, MIN_RETRIES),
      MAX_RETRIES
    );
  }

  // Hard-reject invalid executionType
  if (input.executionType !== undefined) {
    if (!VALID_EXECUTION_TYPES.includes(input.executionType)) {
      throw new Error(
        `Invalid executionType: "${input.executionType}". ` +
          `Must be one of: ${VALID_EXECUTION_TYPES.join(", ")}`
      );
    }
  }

  // Validate and normalise agentConfig
  if (input.agentConfig) {
    const ac = input.agentConfig;

    // Hard-reject invalid permissionMode
    if (ac.permissionMode !== undefined) {
      if (!VALID_PERMISSION_MODES.includes(ac.permissionMode)) {
        throw new Error(
          `Invalid permissionMode: "${ac.permissionMode}". ` +
            `Must be one of: ${VALID_PERMISSION_MODES.join(", ")}`
        );
      }
    }

    // Enforce budgetUsd ceiling
    if (ac.budgetUsd !== undefined) {
      ac.budgetUsd = Math.min(ac.budgetUsd, MAX_BUDGET_USD);
    }

    // Clamp maxTurns to a sane range [1, 200]
    if (ac.maxTurns !== undefined) {
      ac.maxTurns = Math.min(Math.max(ac.maxTurns, 1), 200);
    }
  }
}

// ---------------------------------------------------------------------------
// TaskManager
// ---------------------------------------------------------------------------

export class TaskManager {
  constructor(private store: IStore) {}

  // -------------------------------------------------------------------------
  // Read operations
  // -------------------------------------------------------------------------

  listTasks(projectId?: string): Task[] {
    return this.store.listTasks(projectId);
  }

  getTask(id: string): Task | null {
    return this.store.getTask(id);
  }

  getTaskByName(name: string): Task | null {
    return this.store.getTaskByName(name);
  }

  // -------------------------------------------------------------------------
  // Write operations
  // -------------------------------------------------------------------------

  createTask(input: CreateTaskInput): Task {
    sanitizeInput(input);
    return this.store.createTask(crypto.randomUUID(), input);
  }

  updateTask(id: string, input: UpdateTaskInput): Task {
    sanitizeInput(input);
    return this.store.updateTask(id, input);
  }

  deleteTask(id: string): void {
    this.store.deleteTask(id);
  }

  /**
   * Invert the `enabled` flag of a task.
   *
   * Throws `TaskNotFoundError` if `id` is unknown.
   */
  toggleTask(id: string): Task {
    const task = this.store.getTask(id);
    if (!task) throw new TaskNotFoundError(id);
    return this.store.updateTask(id, { enabled: !task.enabled });
  }
}

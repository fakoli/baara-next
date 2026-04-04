// @baara-next/cli — Output formatters
//
// Provides simple ASCII-table and structured output helpers for CLI commands.
// All formatters produce strings; callers are responsible for printing them.

import type { Task, Execution } from "@baara-next/core";

// ---------------------------------------------------------------------------
// ASCII table
// ---------------------------------------------------------------------------

/**
 * Render a simple ASCII table from headers and rows.
 *
 * Each column is padded to the width of the widest cell in that column
 * (header or data).  Columns are separated by two spaces.
 *
 * @example
 * console.log(formatTable(["ID", "Name", "Status"], rows));
 */
export function formatTable(headers: string[], rows: string[][]): string {
  // Compute column widths.
  const widths = headers.map((h, i) => {
    const maxRow = rows.reduce(
      (max, row) => Math.max(max, (row[i] ?? "").length),
      0
    );
    return Math.max(h.length, maxRow);
  });

  const pad = (cell: string, width: number) => cell.padEnd(width);
  const sep = "  ";

  const headerLine = headers.map((h, i) => pad(h, widths[i]!)).join(sep);
  const divider = widths.map((w) => "-".repeat(w)).join(sep);
  const dataLines = rows.map((row) =>
    row.map((cell, i) => pad(cell, widths[i]!)).join(sep)
  );

  return [headerLine, divider, ...dataLines].join("\n");
}

// ---------------------------------------------------------------------------
// JSON
// ---------------------------------------------------------------------------

/** Pretty-print any value as indented JSON. */
export function formatJson(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

// ---------------------------------------------------------------------------
// Task summary
// ---------------------------------------------------------------------------

/**
 * Single-line human-readable summary of a task.
 *
 * Format:  [enabled|disabled]  ID   NAME   TYPE   MODE
 */
export function formatTask(task: Task): string {
  const status = task.enabled ? "enabled " : "disabled";
  const id = task.id.slice(0, 8);
  const type = task.executionType.padEnd(12);
  const mode = task.executionMode.padEnd(8);
  return `[${status}]  ${id}  ${task.name.padEnd(30)}  ${type}  ${mode}`;
}

/**
 * Multi-line detailed view of a task.
 */
export function formatTaskDetail(task: Task): string {
  const lines = [
    `Task: ${task.name}`,
    `  ID:          ${task.id}`,
    `  Description: ${task.description || "(none)"}`,
    `  Type:        ${task.executionType}`,
    `  Mode:        ${task.executionMode}`,
    `  Priority:    ${task.priority}`,
    `  Queue:       ${task.targetQueue}`,
    `  Enabled:     ${task.enabled}`,
    `  Max retries: ${task.maxRetries}`,
    `  Timeout:     ${task.timeoutMs}ms`,
    `  Cron:        ${task.cronExpression ?? "(none)"}`,
    `  Project:     ${task.projectId ?? "(none)"}`,
    `  Created:     ${task.createdAt}`,
    `  Updated:     ${task.updatedAt}`,
    `  Prompt:`,
    ...task.prompt.split("\n").map((l) => `    ${l}`),
  ];
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Execution summary
// ---------------------------------------------------------------------------

/**
 * Single-line human-readable summary of an execution.
 */
export function formatExecution(exec: Execution): string {
  const id = exec.id.slice(0, 8);
  const taskId = exec.taskId.slice(0, 8);
  const status = exec.status.padEnd(20);
  const attempt = `attempt=${exec.attempt}`;
  const dur = exec.durationMs != null ? `${exec.durationMs}ms` : "-";
  return `${id}  task=${taskId}  ${status}  ${attempt}  dur=${dur}`;
}

/**
 * Multi-line detailed view of an execution.
 */
export function formatExecutionDetail(exec: Execution): string {
  const lines = [
    `Execution: ${exec.id}`,
    `  Task ID:     ${exec.taskId}`,
    `  Status:      ${exec.status}`,
    `  Health:      ${exec.healthStatus}`,
    `  Attempt:     ${exec.attempt}`,
    `  Queue:       ${exec.queueName}`,
    `  Priority:    ${exec.priority}`,
    `  Scheduled:   ${exec.scheduledAt}`,
    `  Started:     ${exec.startedAt ?? "-"}`,
    `  Completed:   ${exec.completedAt ?? "-"}`,
    `  Duration:    ${exec.durationMs != null ? exec.durationMs + "ms" : "-"}`,
    `  Turn count:  ${exec.turnCount}`,
    `  Input tok:   ${exec.inputTokens ?? "-"}`,
    `  Output tok:  ${exec.outputTokens ?? "-"}`,
  ];
  if (exec.output) {
    lines.push(`  Output:`);
    exec.output.split("\n").forEach((l) => lines.push(`    ${l}`));
  }
  if (exec.error) {
    lines.push(`  Error:`);
    exec.error.split("\n").forEach((l) => lines.push(`    ${l}`));
  }
  return lines.join("\n");
}

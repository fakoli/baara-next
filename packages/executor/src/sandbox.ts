// @baara-next/executor — Resource limit defaults and merging
//
/** Resource limits utilities — not yet enforced by runtimes. Reserved for Phase 5 sandboxing. */

import type { ResourceLimits } from "@baara-next/core";

/**
 * System-wide default resource limits applied when neither the task nor
 * the orchestrator supply explicit constraints.
 */
export function defaultLimits(): ResourceLimits {
  return {
    maxMemoryMb: 512,
    maxCpuPercent: 80,
    maxDurationMs: 300_000, // 5 minutes
    budgetUsd: 2.00,
  };
}

/**
 * Merge task-level limits on top of global limits.
 *
 * Task values take precedence; any field absent in `taskLimits` falls back to
 * the corresponding value in `globalLimits`, and then to `defaultLimits()`.
 *
 * @param taskLimits   - Per-task override, may be undefined.
 * @param globalLimits - Operator-configured system limits, may be undefined.
 */
export function mergeLimits(
  taskLimits?: ResourceLimits,
  globalLimits?: ResourceLimits,
): ResourceLimits {
  const base = defaultLimits();
  const merged: ResourceLimits = { ...base };

  // Apply global overrides.
  if (globalLimits) {
    if (globalLimits.maxMemoryMb !== undefined)
      merged.maxMemoryMb = globalLimits.maxMemoryMb;
    if (globalLimits.maxCpuPercent !== undefined)
      merged.maxCpuPercent = globalLimits.maxCpuPercent;
    if (globalLimits.maxDurationMs !== undefined)
      merged.maxDurationMs = globalLimits.maxDurationMs;
    if (globalLimits.budgetUsd !== undefined)
      merged.budgetUsd = globalLimits.budgetUsd;
  }

  // Apply task overrides — highest priority.
  if (taskLimits) {
    if (taskLimits.maxMemoryMb !== undefined)
      merged.maxMemoryMb = taskLimits.maxMemoryMb;
    if (taskLimits.maxCpuPercent !== undefined)
      merged.maxCpuPercent = taskLimits.maxCpuPercent;
    if (taskLimits.maxDurationMs !== undefined)
      merged.maxDurationMs = taskLimits.maxDurationMs;
    if (taskLimits.budgetUsd !== undefined)
      merged.budgetUsd = taskLimits.budgetUsd;
  }

  return merged;
}

// tests/sli/helpers.ts
//
// SLI test helpers — extends smoke test helpers with timing utilities
// for measuring latencies against SLO targets.

import { expect } from "bun:test";

export {
  startServer,
  makeApi,
  waitForExecution,
  type ServerHandle,
  type StartServerOpts,
} from "../smoke/helpers.ts";

/**
 * Measure the wall-clock duration of an async operation.
 * Returns both the function's return value and the elapsed time in ms.
 */
export async function measure<T>(
  fn: () => Promise<T>
): Promise<{ result: T; durationMs: number }> {
  const start = performance.now();
  const result = await fn();
  return { result, durationMs: performance.now() - start };
}

/**
 * Log an SLI value and assert it meets the SLO target.
 *
 * @param name   - SLI identifier (e.g. "api.health.latency")
 * @param actual - Measured value
 * @param target - SLO target (assertion: actual <= target)
 * @param unit   - Unit label for logging (default: "ms")
 */
export function assertSLO(
  name: string,
  actual: number,
  target: number,
  unit: string = "ms"
): void {
  console.log(`  SLI ${name}: ${actual.toFixed(1)}${unit} (target: <${target}${unit})`);
  expect(actual).toBeLessThanOrEqual(target);
}

/**
 * Compute the p99 value from a sorted array of durations.
 * The array need not be sorted in advance — this function sorts it.
 */
export function p99(samples: number[]): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.ceil(sorted.length * 0.99) - 1;
  return sorted[Math.max(0, idx)]!;
}

// Re-export bun:test primitives so callers can import from a single location.
export { describe, it, expect, beforeAll, afterAll } from "bun:test";

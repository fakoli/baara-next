// tests/e2e/helpers/measure.ts
//
// Latency measurement utility for E2E tests.
// Wraps an async operation, measures wall-clock duration, classifies it against
// per-prefix thresholds, and returns both the result and the timing record.

export interface ActionTiming {
  action: string;
  durationMs: number;
  threshold: "fast" | "acceptable" | "slow";
}

interface Thresholds {
  fast: number;
  acceptable: number;
}

// Default thresholds keyed by action-name prefix.
// Evaluated in order; first match wins.
const DEFAULT_THRESHOLDS: Array<{ prefix: string; thresholds: Thresholds }> = [
  { prefix: "chat:first_token", thresholds: { fast: 2000, acceptable: 5000 } },
  { prefix: "chat:", thresholds: { fast: 15000, acceptable: 30000 } },
  { prefix: "ui:", thresholds: { fast: 100, acceptable: 300 } },
  { prefix: "api:", thresholds: { fast: 200, acceptable: 500 } },
  { prefix: "thread:", thresholds: { fast: 300, acceptable: 1000 } },
  { prefix: "server:", thresholds: { fast: 3000, acceptable: 5000 } },
  { prefix: "cp:", thresholds: { fast: 500, acceptable: 1000 } },
];

function resolveThresholds(name: string, override?: Thresholds): Thresholds {
  if (override) return override;
  for (const entry of DEFAULT_THRESHOLDS) {
    if (name.startsWith(entry.prefix)) return entry.thresholds;
  }
  // Fallback when no prefix matches.
  return { fast: 500, acceptable: 2000 };
}

function classify(durationMs: number, thresholds: Thresholds): ActionTiming["threshold"] {
  if (durationMs <= thresholds.fast) return "fast";
  if (durationMs <= thresholds.acceptable) return "acceptable";
  return "slow";
}

/**
 * Measures the wall-clock duration of `fn`, classifies it against
 * `thresholds` (defaulting to prefix-based rules), and returns both the
 * result and an `ActionTiming` record.
 *
 * @param name          Human-readable action name, optionally prefixed with
 *                      "ui:", "chat:", "api:", "thread:", "server:", or "cp:".
 * @param fn            Async operation to measure.
 * @param thresholds    Optional override for fast/acceptable cutoffs.
 */
export async function measure<T>(
  name: string,
  fn: () => Promise<T>,
  thresholds?: Thresholds
): Promise<{ result: T; timing: ActionTiming }> {
  const resolved = resolveThresholds(name, thresholds);
  const start = Date.now();
  const result = await fn();
  const durationMs = Date.now() - start;
  const timing: ActionTiming = {
    action: name,
    durationMs,
    threshold: classify(durationMs, resolved),
  };
  return { result, timing };
}

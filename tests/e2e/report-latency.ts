// tests/e2e/report-latency.ts
//
// Latency report aggregator for BAARA Next E2E timing files.
// Reads all timings-*.json files from tests/e2e/results/, aggregates per
// action name, and prints a formatted table to stdout.
//
// Usage:
//   bun run tests/e2e/report-latency.ts

import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ActionTiming {
  action: string;
  durationMs: number;
  threshold: "fast" | "acceptable" | "slow";
}

interface TimingFile {
  test: string;
  file: string;
  timings: ActionTiming[];
  writtenAt: string;
}

interface AggregatedAction {
  action: string;
  count: number;
  min: number;
  avg: number;
  max: number;
  p95: number;
  rating: "fast" | "acceptable" | "slow";
}

// ---------------------------------------------------------------------------
// Thresholds (mirrors measure.ts DEFAULT_THRESHOLDS + fallback)
// ---------------------------------------------------------------------------

interface Thresholds {
  fast: number;
  acceptable: number;
}

const DEFAULT_THRESHOLDS: Array<{ prefix: string; thresholds: Thresholds }> = [
  { prefix: "chat:first_token", thresholds: { fast: 2000, acceptable: 5000 } },
  { prefix: "chat:", thresholds: { fast: 15000, acceptable: 30000 } },
  { prefix: "ui:", thresholds: { fast: 100, acceptable: 300 } },
  { prefix: "api:", thresholds: { fast: 200, acceptable: 500 } },
  { prefix: "thread:", thresholds: { fast: 300, acceptable: 1000 } },
  { prefix: "server:", thresholds: { fast: 3000, acceptable: 5000 } },
  { prefix: "cp:", thresholds: { fast: 500, acceptable: 1000 } },
];

function resolveThresholds(name: string): Thresholds {
  for (const entry of DEFAULT_THRESHOLDS) {
    if (name.startsWith(entry.prefix)) return entry.thresholds;
  }
  return { fast: 500, acceptable: 2000 };
}

function classify(durationMs: number, thresholds: Thresholds): "fast" | "acceptable" | "slow" {
  if (durationMs <= thresholds.fast) return "fast";
  if (durationMs <= thresholds.acceptable) return "acceptable";
  return "slow";
}

// ---------------------------------------------------------------------------
// Percentile helper
// ---------------------------------------------------------------------------

function p95(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = Math.ceil(0.95 * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const RESULTS_DIR = path.resolve(__dirname, "results");

function loadTimingFiles(): TimingFile[] {
  if (!fs.existsSync(RESULTS_DIR)) {
    return [];
  }

  const files = fs
    .readdirSync(RESULTS_DIR)
    .filter((f) => f.startsWith("timings-") && f.endsWith(".json"));

  const results: TimingFile[] = [];
  for (const file of files) {
    const fullPath = path.join(RESULTS_DIR, file);
    try {
      const raw = fs.readFileSync(fullPath, "utf-8");
      const parsed = JSON.parse(raw) as TimingFile;
      results.push(parsed);
    } catch {
      console.error(`Warning: could not parse ${file}, skipping.`);
    }
  }
  return results;
}

function aggregate(files: TimingFile[]): AggregatedAction[] {
  // Group durations by action name.
  const byAction = new Map<string, number[]>();

  for (const file of files) {
    for (const timing of file.timings) {
      const existing = byAction.get(timing.action);
      if (existing) {
        existing.push(timing.durationMs);
      } else {
        byAction.set(timing.action, [timing.durationMs]);
      }
    }
  }

  const aggregated: AggregatedAction[] = [];
  for (const [action, durations] of byAction) {
    const sorted = [...durations].sort((a, b) => a - b);
    const count = sorted.length;
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const avg = Math.round(durations.reduce((s, d) => s + d, 0) / count);
    const p95val = p95(sorted);
    const thresholds = resolveThresholds(action);
    const rating = classify(avg, thresholds);

    aggregated.push({ action, count, min, avg, max, p95: p95val, rating });
  }

  // Sort alphabetically by action name for stable output.
  aggregated.sort((a, b) => a.action.localeCompare(b.action));
  return aggregated;
}

function ratingLabel(rating: "fast" | "acceptable" | "slow"): string {
  switch (rating) {
    case "fast":
      return "fast";
    case "acceptable":
      return "acceptable";
    case "slow":
      return "SLOW";
  }
}

function pad(s: string, width: number, right = false): string {
  if (right) return s.padStart(width);
  return s.padEnd(width);
}

function formatMs(ms: number): string {
  return `${ms}ms`;
}

function printTable(rows: AggregatedAction[]): void {
  // Compute column widths dynamically.
  const headers = ["Action", "Count", "Min", "Avg", "Max", "P95", "Rating"];

  const colWidths = [
    Math.max(headers[0].length, ...rows.map((r) => r.action.length)),
    Math.max(headers[1].length, ...rows.map((r) => String(r.count).length)),
    Math.max(headers[2].length, ...rows.map((r) => formatMs(r.min).length)),
    Math.max(headers[3].length, ...rows.map((r) => formatMs(r.avg).length)),
    Math.max(headers[4].length, ...rows.map((r) => formatMs(r.max).length)),
    Math.max(headers[5].length, ...rows.map((r) => formatMs(r.p95).length)),
    Math.max(headers[6].length, ...rows.map((r) => ratingLabel(r.rating).length)),
  ];

  const sep = colWidths.map((w) => "-".repeat(w + 2)).join("+");
  const divider = `+${sep}+`;

  function row(cells: string[]): string {
    const padded = cells.map((c, i) => {
      // Right-align numeric columns (Count, Min, Avg, Max, P95).
      const numeric = i >= 1 && i <= 5;
      return ` ${pad(c, colWidths[i], numeric)} `;
    });
    return `|${padded.join("|")}|`;
  }

  console.log(divider);
  console.log(row(headers));
  console.log(divider);
  for (const r of rows) {
    console.log(
      row([
        r.action,
        String(r.count),
        formatMs(r.min),
        formatMs(r.avg),
        formatMs(r.max),
        formatMs(r.p95),
        ratingLabel(r.rating),
      ])
    );
  }
  console.log(divider);
}

function main(): void {
  const files = loadTimingFiles();

  if (files.length === 0) {
    console.log(
      "No timing files found in tests/e2e/results/.\n" +
        "Run the E2E tests first with: bun run test:e2e"
    );
    return;
  }

  const totalTimings = files.reduce((s, f) => s + f.timings.length, 0);
  console.log(
    `\nLatency Report — ${files.length} file(s), ${totalTimings} timing(s)\n`
  );

  const rows = aggregate(files);
  printTable(rows);
  console.log();
}

main();

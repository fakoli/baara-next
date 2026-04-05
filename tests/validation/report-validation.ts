// tests/validation/report-validation.ts
//
// Validation report aggregator for BAARA Next validation timing files.
// Reads all timings-*.json files from tests/validation/results/, aggregates per
// taskDefinitionId, and prints a formatted table to stdout.
//
// Usage:
//   bun run tests/validation/report-validation.ts

import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Types (mirrors ValidationTiming from helpers/metrics.ts)
// ---------------------------------------------------------------------------

export interface ValidationTiming {
  taskDefinitionId: string;
  category: string;
  difficulty: string;
  interface: string;
  timeToStartMs: number;
  timeToFirstResponseMs: number;
  totalDurationMs: number;
  executionId: string;
  status: string;
  timestamp: string;
}

export interface TimingFile {
  test: string;
  file: string;
  timings: ValidationTiming[];
  writtenAt: string;
}

export interface AggregatedEntry {
  taskDefinitionId: string;
  category: string;
  difficulty: string;
  interface: string;
  count: number;
  status: string;
  timeToStart: Stats;
  timeToFirstResponse: Stats;
  totalDuration: Stats;
}

export interface Stats {
  min: number;
  avg: number;
  max: number;
  p95: number;
}

export interface CategorySummary {
  category: string;
  avgStart: number;
  p95Start: number;
  avgFirstResponse: number;
  p95FirstResponse: number;
  avgTotal: number;
  p95Total: number;
  count: number;
}

export interface DifficultySummary {
  difficulty: string;
  avgStart: number;
  p95Start: number;
  avgFirstResponse: number;
  p95FirstResponse: number;
  avgTotal: number;
  p95Total: number;
  count: number;
}

export interface AggregationResult {
  entries: AggregatedEntry[];
  byCategoryEntries: CategorySummary[];
  byDifficultyEntries: DifficultySummary[];
}

// ---------------------------------------------------------------------------
// Percentile helper
// ---------------------------------------------------------------------------

export function calcP95(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = Math.ceil(0.95 * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function calcStats(values: number[]): Stats {
  if (values.length === 0) return { min: 0, avg: 0, max: 0, p95: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const avg = Math.round(values.reduce((s, v) => s + v, 0) / values.length);
  const p95 = calcP95(sorted);
  return { min, avg, max, p95 };
}

// ---------------------------------------------------------------------------
// File loading
// ---------------------------------------------------------------------------

export function loadTimingFiles(resultsDir: string): TimingFile[] {
  if (!fs.existsSync(resultsDir)) {
    return [];
  }

  const files = fs
    .readdirSync(resultsDir)
    .filter((f) => f.startsWith("timings-") && f.endsWith(".json"));

  const results: TimingFile[] = [];
  for (const file of files) {
    const fullPath = path.join(resultsDir, file);
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

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

export function aggregate(files: TimingFile[]): AggregationResult {
  // Collect all timings keyed by taskDefinitionId.
  const byId = new Map<
    string,
    {
      category: string;
      difficulty: string;
      interface: string;
      status: string;
      starts: number[];
      firstResponses: number[];
      totals: number[];
    }
  >();

  for (const file of files) {
    for (const t of file.timings) {
      const existing = byId.get(t.taskDefinitionId);
      if (existing) {
        existing.starts.push(t.timeToStartMs);
        existing.firstResponses.push(t.timeToFirstResponseMs);
        existing.totals.push(t.totalDurationMs);
        // Last status wins — reasonable for aggregation.
        existing.status = t.status;
      } else {
        byId.set(t.taskDefinitionId, {
          category: t.category,
          difficulty: t.difficulty,
          interface: t.interface,
          status: t.status,
          starts: [t.timeToStartMs],
          firstResponses: [t.timeToFirstResponseMs],
          totals: [t.totalDurationMs],
        });
      }
    }
  }

  const entries: AggregatedEntry[] = [];
  for (const [taskDefinitionId, data] of byId) {
    entries.push({
      taskDefinitionId,
      category: data.category,
      difficulty: data.difficulty,
      interface: data.interface,
      count: data.starts.length,
      status: data.status,
      timeToStart: calcStats(data.starts),
      timeToFirstResponse: calcStats(data.firstResponses),
      totalDuration: calcStats(data.totals),
    });
  }

  // Sort by category then difficulty then taskDefinitionId.
  entries.sort((a, b) => {
    const cat = a.category.localeCompare(b.category);
    if (cat !== 0) return cat;
    const diff = a.difficulty.localeCompare(b.difficulty);
    if (diff !== 0) return diff;
    return a.taskDefinitionId.localeCompare(b.taskDefinitionId);
  });

  // --- By-category summary ---
  const catMap = new Map<string, { starts: number[]; firstResponses: number[]; totals: number[] }>();
  for (const e of entries) {
    const existing = catMap.get(e.category);
    if (existing) {
      existing.starts.push(...Array(e.count).fill(e.timeToStart.avg));
      existing.firstResponses.push(...Array(e.count).fill(e.timeToFirstResponse.avg));
      existing.totals.push(...Array(e.count).fill(e.totalDuration.avg));
    } else {
      catMap.set(e.category, {
        starts: Array(e.count).fill(e.timeToStart.avg),
        firstResponses: Array(e.count).fill(e.timeToFirstResponse.avg),
        totals: Array(e.count).fill(e.totalDuration.avg),
      });
    }
  }

  const byCategoryEntries: CategorySummary[] = [];
  for (const [category, data] of catMap) {
    const startStats = calcStats(data.starts);
    const firstResponseStats = calcStats(data.firstResponses);
    const totalStats = calcStats(data.totals);
    byCategoryEntries.push({
      category,
      avgStart: startStats.avg,
      p95Start: startStats.p95,
      avgFirstResponse: firstResponseStats.avg,
      p95FirstResponse: firstResponseStats.p95,
      avgTotal: totalStats.avg,
      p95Total: totalStats.p95,
      count: data.starts.length,
    });
  }
  byCategoryEntries.sort((a, b) => a.category.localeCompare(b.category));

  // --- By-difficulty summary ---
  const diffMap = new Map<string, { starts: number[]; firstResponses: number[]; totals: number[] }>();
  for (const e of entries) {
    const existing = diffMap.get(e.difficulty);
    if (existing) {
      existing.starts.push(...Array(e.count).fill(e.timeToStart.avg));
      existing.firstResponses.push(...Array(e.count).fill(e.timeToFirstResponse.avg));
      existing.totals.push(...Array(e.count).fill(e.totalDuration.avg));
    } else {
      diffMap.set(e.difficulty, {
        starts: Array(e.count).fill(e.timeToStart.avg),
        firstResponses: Array(e.count).fill(e.timeToFirstResponse.avg),
        totals: Array(e.count).fill(e.totalDuration.avg),
      });
    }
  }

  const byDifficultyEntries: DifficultySummary[] = [];
  for (const [difficulty, data] of diffMap) {
    const startStats = calcStats(data.starts);
    const firstResponseStats = calcStats(data.firstResponses);
    const totalStats = calcStats(data.totals);
    byDifficultyEntries.push({
      difficulty,
      avgStart: startStats.avg,
      p95Start: startStats.p95,
      avgFirstResponse: firstResponseStats.avg,
      p95FirstResponse: firstResponseStats.p95,
      avgTotal: totalStats.avg,
      p95Total: totalStats.p95,
      count: data.starts.length,
    });
  }

  const DIFFICULTY_ORDER: Record<string, number> = { easy: 0, medium: 1, hard: 2 };
  byDifficultyEntries.sort(
    (a, b) =>
      (DIFFICULTY_ORDER[a.difficulty] ?? 99) - (DIFFICULTY_ORDER[b.difficulty] ?? 99)
  );

  return { entries, byCategoryEntries, byDifficultyEntries };
}

// ---------------------------------------------------------------------------
// Table formatting helpers
// ---------------------------------------------------------------------------

function pad(s: string, width: number, rightAlign = false): string {
  if (rightAlign) return s.padStart(width);
  return s.padEnd(width);
}

function ms(n: number): string {
  return `${n}ms`;
}

function makeDivider(colWidths: number[]): string {
  return `+${colWidths.map((w) => "-".repeat(w + 2)).join("+")}+`;
}

function makeRow(cells: string[], colWidths: number[], rightAlignCols: Set<number>): string {
  const padded = cells.map((c, i) =>
    ` ${pad(c, colWidths[i], rightAlignCols.has(i))} `
  );
  return `|${padded.join("|")}|`;
}

// ---------------------------------------------------------------------------
// Print main table
// ---------------------------------------------------------------------------

export function printMainTable(entries: AggregatedEntry[]): void {
  const headers = [
    "Category",
    "Difficulty",
    "Interface",
    "Start avg/p95",
    "FirstResp avg/p95",
    "Total avg/p95",
    "Count",
    "Status",
  ];

  const rows = entries.map((e) => [
    e.category,
    e.difficulty,
    e.interface,
    `${ms(e.timeToStart.avg)} / ${ms(e.timeToStart.p95)}`,
    `${ms(e.timeToFirstResponse.avg)} / ${ms(e.timeToFirstResponse.p95)}`,
    `${ms(e.totalDuration.avg)} / ${ms(e.totalDuration.p95)}`,
    String(e.count),
    e.status,
  ]);

  const colWidths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i].length))
  );

  // Right-align Count column (index 6).
  const rightAlignCols = new Set([6]);

  const divider = makeDivider(colWidths);
  console.log(divider);
  console.log(makeRow(headers, colWidths, rightAlignCols));
  console.log(divider);
  for (const row of rows) {
    console.log(makeRow(row, colWidths, rightAlignCols));
  }
  console.log(divider);
}

// ---------------------------------------------------------------------------
// Print category summary
// ---------------------------------------------------------------------------

function printCategorySummary(rows: CategorySummary[]): void {
  console.log("\nSummary by Category:\n");

  const headers = ["Category", "Count", "Start avg", "Start p95", "FirstResp avg", "FirstResp p95", "Total avg", "Total p95"];
  const dataRows = rows.map((r) => [
    r.category,
    String(r.count),
    ms(r.avgStart),
    ms(r.p95Start),
    ms(r.avgFirstResponse),
    ms(r.p95FirstResponse),
    ms(r.avgTotal),
    ms(r.p95Total),
  ]);

  const colWidths = headers.map((h, i) =>
    Math.max(h.length, ...dataRows.map((r) => r[i].length))
  );

  const rightAlignCols = new Set([1, 2, 3, 4, 5, 6, 7]);
  const divider = makeDivider(colWidths);
  console.log(divider);
  console.log(makeRow(headers, colWidths, rightAlignCols));
  console.log(divider);
  for (const row of dataRows) {
    console.log(makeRow(row, colWidths, rightAlignCols));
  }
  console.log(divider);
}

// ---------------------------------------------------------------------------
// Print difficulty summary
// ---------------------------------------------------------------------------

function printDifficultySummary(rows: DifficultySummary[]): void {
  console.log("\nSummary by Difficulty:\n");

  const headers = ["Difficulty", "Count", "Start avg", "Start p95", "FirstResp avg", "FirstResp p95", "Total avg", "Total p95"];
  const dataRows = rows.map((r) => [
    r.difficulty,
    String(r.count),
    ms(r.avgStart),
    ms(r.p95Start),
    ms(r.avgFirstResponse),
    ms(r.p95FirstResponse),
    ms(r.avgTotal),
    ms(r.p95Total),
  ]);

  const colWidths = headers.map((h, i) =>
    Math.max(h.length, ...dataRows.map((r) => r[i].length))
  );

  const rightAlignCols = new Set([1, 2, 3, 4, 5, 6, 7]);
  const divider = makeDivider(colWidths);
  console.log(divider);
  console.log(makeRow(headers, colWidths, rightAlignCols));
  console.log(divider);
  for (const row of dataRows) {
    console.log(makeRow(row, colWidths, rightAlignCols));
  }
  console.log(divider);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const RESULTS_DIR = path.resolve(__dirname, "results");

export function main(): void {
  const files = loadTimingFiles(RESULTS_DIR);

  if (files.length === 0) {
    console.log(
      "No timing files found in tests/validation/results/.\n" +
        "Run the validation tests first with: bun run test:validation"
    );
    return;
  }

  const totalTimings = files.reduce((s, f) => s + f.timings.length, 0);
  console.log(
    `\nValidation Latency Report — ${files.length} file(s), ${totalTimings} timing(s)\n`
  );

  const { entries, byCategoryEntries, byDifficultyEntries } = aggregate(files);

  printMainTable(entries);
  printCategorySummary(byCategoryEntries);
  printDifficultySummary(byDifficultyEntries);
  console.log();
}

// Only run when executed directly (bun run report-validation.ts),
// not when imported by tests.
if (import.meta.main) {
  main();
}

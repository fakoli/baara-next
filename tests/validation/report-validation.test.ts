// tests/validation/report-validation.test.ts
//
// Unit tests for the report-validation aggregator.
// Uses Bun's built-in test runner; no server required.
//
// Run:
//   bun test tests/validation/report-validation.test.ts

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  loadTimingFiles,
  aggregate,
  calcP95,
  type TimingFile,
  type ValidationTiming,
} from "./report-validation.ts";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeFile(timings: ValidationTiming[]): TimingFile {
  return {
    test: "fixture",
    file: "fixture.ts",
    timings,
    writtenAt: new Date().toISOString(),
  };
}

function makeTiming(overrides: Partial<ValidationTiming>): ValidationTiming {
  return {
    taskDefinitionId: "native-direct-easy",
    category: "native-direct",
    difficulty: "easy",
    interface: "api",
    timeToStartMs: 100,
    timeToFirstResponseMs: 500,
    totalDurationMs: 1000,
    executionId: "exec-1",
    status: "completed",
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Temporary directory helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "baara-validation-test-"));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeTmpFile(name: string, data: TimingFile): string {
  const filePath = path.join(tmpDir, name);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  return filePath;
}

// ---------------------------------------------------------------------------
// calcP95 tests
// ---------------------------------------------------------------------------

describe("calcP95", () => {
  it("returns 0 for empty array", () => {
    expect(calcP95([])).toBe(0);
  });

  it("returns the single element for a one-element array", () => {
    expect(calcP95([42])).toBe(42);
  });

  it("returns the largest element for a two-element array (p95 ceiling)", () => {
    // ceil(0.95 * 2) - 1 = ceil(1.9) - 1 = 2 - 1 = 1 → sorted[1]
    expect(calcP95([10, 20])).toBe(20);
  });

  it("correctly computes p95 for 20 sorted values", () => {
    // 1..20 sorted
    const sorted = Array.from({ length: 20 }, (_, i) => i + 1);
    // ceil(0.95 * 20) - 1 = ceil(19) - 1 = 19 - 1 = 18 → sorted[18] = 19
    expect(calcP95(sorted)).toBe(19);
  });

  it("correctly computes p95 for 100 sorted values", () => {
    // 1..100 sorted
    const sorted = Array.from({ length: 100 }, (_, i) => i + 1);
    // ceil(0.95 * 100) - 1 = 95 - 1 = 94 → sorted[94] = 95
    expect(calcP95(sorted)).toBe(95);
  });
});

// ---------------------------------------------------------------------------
// loadTimingFiles tests
// ---------------------------------------------------------------------------

describe("loadTimingFiles", () => {
  it("returns empty array when results dir does not exist", () => {
    const nonExistent = path.join(tmpDir, "does-not-exist");
    expect(loadTimingFiles(nonExistent)).toEqual([]);
  });

  it("returns empty array when dir exists but has no timing files", () => {
    const emptyDir = path.join(tmpDir, "empty");
    fs.mkdirSync(emptyDir, { recursive: true });
    fs.writeFileSync(path.join(emptyDir, "other-file.json"), "{}");
    expect(loadTimingFiles(emptyDir)).toEqual([]);
  });

  it("loads a single valid timing file", () => {
    const dir = path.join(tmpDir, "single");
    fs.mkdirSync(dir, { recursive: true });
    const fixture = makeFile([makeTiming({})]);
    fs.writeFileSync(path.join(dir, "timings-test-123.json"), JSON.stringify(fixture));
    const result = loadTimingFiles(dir);
    expect(result).toHaveLength(1);
    expect(result[0].timings).toHaveLength(1);
  });

  it("skips malformed JSON files without crashing", () => {
    const dir = path.join(tmpDir, "malformed");
    fs.mkdirSync(dir, { recursive: true });
    const good = makeFile([makeTiming({})]);
    fs.writeFileSync(path.join(dir, "timings-good-1.json"), JSON.stringify(good));
    fs.writeFileSync(path.join(dir, "timings-bad-2.json"), "{ not valid json");
    const result = loadTimingFiles(dir);
    // Only the good file should be returned.
    expect(result).toHaveLength(1);
  });

  it("loads multiple timing files", () => {
    const dir = path.join(tmpDir, "multi");
    fs.mkdirSync(dir, { recursive: true });
    for (let i = 1; i <= 3; i++) {
      const fixture = makeFile([makeTiming({ executionId: `exec-${i}` })]);
      fs.writeFileSync(path.join(dir, `timings-spec-${i}.json`), JSON.stringify(fixture));
    }
    const result = loadTimingFiles(dir);
    expect(result).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// aggregate — avg/p95 correctness
// ---------------------------------------------------------------------------

describe("aggregate", () => {
  it("returns empty entries for empty file list", () => {
    const result = aggregate([]);
    expect(result.entries).toHaveLength(0);
    expect(result.byCategoryEntries).toHaveLength(0);
    expect(result.byDifficultyEntries).toHaveLength(0);
  });

  it("computes correct avg and min/max for a single timing", () => {
    const files = [makeFile([makeTiming({ timeToStartMs: 100, timeToFirstResponseMs: 500, totalDurationMs: 1000 })])];
    const { entries } = aggregate(files);
    expect(entries).toHaveLength(1);
    const e = entries[0];
    expect(e.taskDefinitionId).toBe("native-direct-easy");
    expect(e.timeToStart.avg).toBe(100);
    expect(e.timeToStart.min).toBe(100);
    expect(e.timeToStart.max).toBe(100);
    expect(e.timeToStart.p95).toBe(100);
    expect(e.timeToFirstResponse.avg).toBe(500);
    expect(e.totalDuration.avg).toBe(1000);
  });

  it("computes correct avg across multiple timings for the same taskDefinitionId", () => {
    const t1 = makeTiming({ timeToStartMs: 100, timeToFirstResponseMs: 400, totalDurationMs: 800, executionId: "e1" });
    const t2 = makeTiming({ timeToStartMs: 200, timeToFirstResponseMs: 600, totalDurationMs: 1200, executionId: "e2" });
    const files = [makeFile([t1, t2])];
    const { entries } = aggregate(files);
    expect(entries).toHaveLength(1);
    const e = entries[0];
    expect(e.count).toBe(2);
    expect(e.timeToStart.avg).toBe(150);
    expect(e.timeToStart.min).toBe(100);
    expect(e.timeToStart.max).toBe(200);
    expect(e.timeToFirstResponse.avg).toBe(500);
    expect(e.totalDuration.avg).toBe(1000);
  });

  it("computes correct p95 across ten timings", () => {
    // 10 timings: timeToStartMs = 10, 20, 30, ..., 100
    const timings = Array.from({ length: 10 }, (_, i) =>
      makeTiming({ timeToStartMs: (i + 1) * 10, timeToFirstResponseMs: 500, totalDurationMs: 1000, executionId: `e${i}` })
    );
    const files = [makeFile(timings)];
    const { entries } = aggregate(files);
    expect(entries).toHaveLength(1);
    // sorted: [10,20,30,40,50,60,70,80,90,100]
    // p95: ceil(0.95*10)-1 = ceil(9.5)-1 = 10-1 = 9 → sorted[9] = 100
    expect(entries[0].timeToStart.p95).toBe(100);
  });

  it("groups distinct taskDefinitionIds as separate entries", () => {
    const t1 = makeTiming({ taskDefinitionId: "native-direct-easy", category: "native-direct", difficulty: "easy" });
    const t2 = makeTiming({ taskDefinitionId: "native-direct-medium", category: "native-direct", difficulty: "medium" });
    const t3 = makeTiming({ taskDefinitionId: "wasm-queued-easy", category: "wasm-queued", difficulty: "easy" });
    const files = [makeFile([t1, t2, t3])];
    const { entries } = aggregate(files);
    expect(entries).toHaveLength(3);
    const ids = entries.map((e) => e.taskDefinitionId);
    expect(ids).toContain("native-direct-easy");
    expect(ids).toContain("native-direct-medium");
    expect(ids).toContain("wasm-queued-easy");
  });

  it("entries are sorted by category then difficulty then id", () => {
    const timings = [
      makeTiming({ taskDefinitionId: "wasm-queued-easy", category: "wasm-queued", difficulty: "easy" }),
      makeTiming({ taskDefinitionId: "native-direct-medium", category: "native-direct", difficulty: "medium" }),
      makeTiming({ taskDefinitionId: "native-direct-easy", category: "native-direct", difficulty: "easy" }),
    ];
    const { entries } = aggregate([makeFile(timings)]);
    expect(entries[0].taskDefinitionId).toBe("native-direct-easy");
    expect(entries[1].taskDefinitionId).toBe("native-direct-medium");
    expect(entries[2].taskDefinitionId).toBe("wasm-queued-easy");
  });

  it("produces correct byCategoryEntries", () => {
    const timings = [
      makeTiming({ taskDefinitionId: "native-direct-easy", category: "native-direct", timeToStartMs: 100 }),
      makeTiming({ taskDefinitionId: "native-direct-medium", category: "native-direct", timeToStartMs: 300, difficulty: "medium" }),
      makeTiming({ taskDefinitionId: "wasm-queued-easy", category: "wasm-queued", timeToStartMs: 500 }),
    ];
    const { byCategoryEntries } = aggregate([makeFile(timings)]);
    expect(byCategoryEntries).toHaveLength(2);
    const nativeEntry = byCategoryEntries.find((e) => e.category === "native-direct");
    expect(nativeEntry).toBeDefined();
    // native-direct has timings with avg start 100 and 300 → mean = 200
    expect(nativeEntry!.avgStart).toBe(200);
    const wasmEntry = byCategoryEntries.find((e) => e.category === "wasm-queued");
    expect(wasmEntry!.avgStart).toBe(500);
  });

  it("produces correct byDifficultyEntries sorted easy→medium→hard", () => {
    const timings = [
      makeTiming({ taskDefinitionId: "t-hard", category: "cat", difficulty: "hard", timeToStartMs: 900 }),
      makeTiming({ taskDefinitionId: "t-medium", category: "cat", difficulty: "medium", timeToStartMs: 500 }),
      makeTiming({ taskDefinitionId: "t-easy", category: "cat", difficulty: "easy", timeToStartMs: 100 }),
    ];
    const { byDifficultyEntries } = aggregate([makeFile(timings)]);
    expect(byDifficultyEntries).toHaveLength(3);
    expect(byDifficultyEntries[0].difficulty).toBe("easy");
    expect(byDifficultyEntries[1].difficulty).toBe("medium");
    expect(byDifficultyEntries[2].difficulty).toBe("hard");
    expect(byDifficultyEntries[0].avgStart).toBe(100);
    expect(byDifficultyEntries[1].avgStart).toBe(500);
    expect(byDifficultyEntries[2].avgStart).toBe(900);
  });

  it("aggregates timings across multiple files for the same taskDefinitionId", () => {
    const file1 = makeFile([makeTiming({ timeToStartMs: 100, executionId: "e1" })]);
    const file2 = makeFile([makeTiming({ timeToStartMs: 200, executionId: "e2" })]);
    const { entries } = aggregate([file1, file2]);
    expect(entries).toHaveLength(1);
    expect(entries[0].count).toBe(2);
    expect(entries[0].timeToStart.avg).toBe(150);
    expect(entries[0].timeToStart.min).toBe(100);
    expect(entries[0].timeToStart.max).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// loadTimingFiles + aggregate integration
// ---------------------------------------------------------------------------

describe("loadTimingFiles + aggregate (integration)", () => {
  it("round-trips fixture data through the full pipeline", () => {
    const dir = path.join(tmpDir, "integration");
    fs.mkdirSync(dir, { recursive: true });

    const timings: ValidationTiming[] = [
      makeTiming({ taskDefinitionId: "native-direct-easy", timeToStartMs: 45, timeToFirstResponseMs: 1200, totalDurationMs: 12400, executionId: "a" }),
      makeTiming({ taskDefinitionId: "native-direct-easy", timeToStartMs: 55, timeToFirstResponseMs: 1400, totalDurationMs: 11600, executionId: "b" }),
      makeTiming({ taskDefinitionId: "wasm-queued-medium", category: "wasm-queued", difficulty: "medium", timeToStartMs: 300, timeToFirstResponseMs: 2000, totalDurationMs: 20000, executionId: "c" }),
    ];

    fs.writeFileSync(path.join(dir, "timings-spec-001.json"), JSON.stringify(makeFile(timings.slice(0, 2)), null, 2));
    fs.writeFileSync(path.join(dir, "timings-spec-002.json"), JSON.stringify(makeFile(timings.slice(2)), null, 2));

    const files = loadTimingFiles(dir);
    expect(files).toHaveLength(2);

    const { entries, byCategoryEntries, byDifficultyEntries } = aggregate(files);

    // Two distinct taskDefinitionIds.
    expect(entries).toHaveLength(2);

    // native-direct-easy: avg start = (45+55)/2 = 50
    const nde = entries.find((e) => e.taskDefinitionId === "native-direct-easy");
    expect(nde).toBeDefined();
    expect(nde!.count).toBe(2);
    expect(nde!.timeToStart.avg).toBe(50);
    expect(nde!.timeToStart.min).toBe(45);
    expect(nde!.timeToStart.max).toBe(55);
    // p95 of [45,55]: ceil(0.95*2)-1 = 1 → sorted[1] = 55
    expect(nde!.timeToStart.p95).toBe(55);
    expect(nde!.timeToFirstResponse.avg).toBe(1300);
    expect(nde!.totalDuration.avg).toBe(12000);

    // wasm-queued-medium
    const wqm = entries.find((e) => e.taskDefinitionId === "wasm-queued-medium");
    expect(wqm).toBeDefined();
    expect(wqm!.timeToStart.avg).toBe(300);

    // Category summaries
    expect(byCategoryEntries).toHaveLength(2);

    // Difficulty summaries: easy + medium
    expect(byDifficultyEntries).toHaveLength(2);
    expect(byDifficultyEntries[0].difficulty).toBe("easy");
    expect(byDifficultyEntries[1].difficulty).toBe("medium");
  });
});

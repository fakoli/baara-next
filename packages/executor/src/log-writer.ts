// @baara-next/executor — JSONL Log Writer
//
// Appends structured log entries to {logsDir}/{executionId}.jsonl.
// One file per execution. Directory created lazily on first write.
// readLogEntries() reads back entries with optional filtering + pagination.

import { mkdirSync, existsSync, appendFileSync } from "fs";
import { join } from "path";

// ---------------------------------------------------------------------------
// LogEntry type
// ---------------------------------------------------------------------------

export interface LogEntry {
  ts: string;                              // ISO 8601
  level: "info" | "warn" | "error" | "debug";
  msg: string;                             // Human-readable message
  executionId: string;
  threadId?: string;
  meta?: Record<string, unknown>;          // Tool name, token counts, etc.
}

// ---------------------------------------------------------------------------
// LogWriter
// ---------------------------------------------------------------------------

export class LogWriter {
  constructor(private readonly logsDir: string) {}

  /**
   * Append a log entry to the execution's JSONL file.
   * Creates the log directory on the first write if it doesn't exist.
   */
  async append(executionId: string, entry: LogEntry): Promise<void> {
    if (!existsSync(this.logsDir)) {
      mkdirSync(this.logsDir, { recursive: true });
    }
    const path = this.logPath(executionId);
    appendFileSync(path, JSON.stringify(entry) + "\n", "utf8");
  }

  /**
   * Return the absolute path to the log file for an execution.
   */
  logPath(executionId: string): string {
    return join(this.logsDir, `${executionId}.jsonl`);
  }
}

// ---------------------------------------------------------------------------
// ReadLogOptions
// ---------------------------------------------------------------------------

export interface ReadLogOptions {
  level?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

// ---------------------------------------------------------------------------
// readLogEntries — read + filter JSONL log file
// ---------------------------------------------------------------------------

/**
 * Read JSONL log entries for an execution with optional filtering and pagination.
 *
 * Returns an empty array if the file does not exist (execution not started
 * or logs not yet written).
 */
export async function readLogEntries(
  logsDir: string,
  executionId: string,
  options: ReadLogOptions = {}
): Promise<LogEntry[]> {
  const path = join(logsDir, `${executionId}.jsonl`);

  if (!existsSync(path)) return [];

  const text = await Bun.file(path).text();
  const lines = text.trim().split("\n").filter(Boolean);

  let entries: LogEntry[] = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line) as LogEntry);
    } catch {
      // Skip malformed lines silently.
    }
  }

  // Apply level filter.
  if (options.level) {
    const lvl = options.level.toLowerCase();
    entries = entries.filter((e) => e.level === lvl);
  }

  // Apply case-insensitive search filter against msg.
  if (options.search) {
    const needle = options.search.toLowerCase();
    entries = entries.filter((e) => e.msg.toLowerCase().includes(needle));
  }

  // Apply pagination.
  const offset = options.offset ?? 0;
  const limit = options.limit ?? entries.length;
  return entries.slice(offset, offset + limit);
}

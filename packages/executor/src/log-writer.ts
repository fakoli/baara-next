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
   * Synchronous — uses appendFileSync internally.
   */
  append(executionId: string, entry: LogEntry): void {
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
 * Streams the file line-by-line via Bun.file().stream() to avoid loading the
 * entire file into memory for large log files.
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

  const stream = Bun.file(path).stream();
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let entries: LogEntry[] = [];

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        // Process any remaining content in the buffer.
        if (buffer.trim()) {
          try {
            entries.push(JSON.parse(buffer.trim()) as LogEntry);
          } catch {
            // Skip malformed trailing line.
          }
        }
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      // Keep the last (potentially incomplete) chunk in the buffer.
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          entries.push(JSON.parse(line) as LogEntry);
        } catch {
          // Skip malformed lines silently.
        }
      }
    }
  } finally {
    reader.releaseLock();
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

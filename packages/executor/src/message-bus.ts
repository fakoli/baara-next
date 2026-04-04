// @baara-next/executor — MessageBus
//
// Implements IMessageBus by wrapping IStore message methods.
//
// All methods are synchronous because the underlying SQLite driver (bun:sqlite)
// runs queries synchronously. The implementation matches the store convention.
//
// Two write paths for log entries:
//   1. task_messages table (durable — survives crashes)
//   2. {dataDir}/logs/{executionId}.jsonl (fast read for web UI + CLI)
//
// The JSONL path is append-only. Log rotation is handled externally by a
// cleanup job that deletes files older than event_retention_days.

import { mkdirSync, appendFileSync } from "fs";
import { join } from "path";
import type {
  IMessageBus,
  PendingCommand,
  IStore,
  Checkpoint,
  InboundCommand,
} from "@baara-next/core";

// ---------------------------------------------------------------------------
// LogEntry — JSONL line format
// ---------------------------------------------------------------------------

interface LogEntry {
  ts: string;
  level: "info" | "warn" | "error" | "debug";
  msg: string;
  executionId: string;
}

// ---------------------------------------------------------------------------
// MessageBus
// ---------------------------------------------------------------------------

export class MessageBus implements IMessageBus {
  private readonly logsDir: string;

  constructor(
    private readonly store: IStore,
    /** Writable data directory; logs are written to {dataDir}/logs/. */
    dataDir: string
  ) {
    this.logsDir = join(dataDir, "logs");
    // Ensure logs directory exists at construction time.
    try {
      mkdirSync(this.logsDir, { recursive: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `MessageBus: failed to create logs directory at "${this.logsDir}". ` +
          `Check that "${dataDir}" exists and is writable. Cause: ${msg}`
      );
    }
  }

  // -------------------------------------------------------------------------
  // Inbound command queue (orchestrator → sandbox)
  // -------------------------------------------------------------------------

  sendCommand(executionId: string, command: InboundCommand): void {
    this.store.sendMessage({
      id: crypto.randomUUID(),
      executionId,
      direction: "inbound",
      messageType: command.type,
      payload: JSON.stringify(command),
    });
  }

  readPendingCommands(executionId: string): PendingCommand[] {
    const rows = this.store.readMessages(executionId, "inbound", "pending");
    return rows.map((row) => ({
      id: row.id,
      command: JSON.parse(row.payload) as InboundCommand,
    }));
  }

  acknowledgeCommands(messageIds: string[]): void {
    this.store.acknowledgeMessages(messageIds);
  }

  // -------------------------------------------------------------------------
  // Checkpoint management (sandbox → orchestrator)
  // -------------------------------------------------------------------------

  writeCheckpoint(executionId: string, checkpoint: Checkpoint): void {
    this.store.sendMessage({
      id: crypto.randomUUID(),
      executionId,
      direction: "outbound",
      messageType: "checkpoint",
      payload: JSON.stringify(checkpoint),
    });
  }

  readLatestCheckpoint(executionId: string): Checkpoint | null {
    const row = this.store.readLatestMessage(executionId, "outbound", "checkpoint");
    if (!row) return null;
    return JSON.parse(row.payload) as Checkpoint;
  }

  // -------------------------------------------------------------------------
  // Structured log append (sandbox → file + queue)
  // -------------------------------------------------------------------------

  appendLog(
    executionId: string,
    level: "info" | "warn" | "error" | "debug",
    message: string
  ): void {
    const ts = new Date().toISOString();

    const entry: LogEntry = {
      ts,
      level,
      msg: message,
      executionId,
    };

    const entryJson = JSON.stringify(entry);

    // 1. Write to task_messages (durable path — survives process crashes)
    this.store.sendMessage({
      id: crypto.randomUUID(),
      executionId,
      direction: "outbound",
      messageType: "log",
      payload: entryJson,
    });

    // 2. Append to JSONL file (fast read path for web UI and CLI)
    const logPath = join(this.logsDir, `${executionId}.jsonl`);
    appendFileSync(logPath, entryJson + "\n", "utf8");
  }
}

// @baara-next/core — IMessageBus interface
//
// The message bus is the durable communication channel between the orchestrator
// and running sandbox instances. It wraps the task_messages SQLite table.
//
// Inbound: commands sent TO a running execution (HITL responses, pause/resume,
//          additional prompts).
// Outbound: messages FROM a running execution (checkpoints, log lines, events).

import type { Checkpoint, InboundCommand } from "../types.ts";

// ---------------------------------------------------------------------------
// PendingCommand — a queued inbound command with its message ID
// ---------------------------------------------------------------------------

/**
 * An inbound command retrieved from the task_messages queue, together with
 * its message ID for acknowledgement.
 */
export interface PendingCommand {
  /** The task_messages row ID — pass to acknowledgeCommands() after processing. */
  id: string;
  command: InboundCommand;
}

// ---------------------------------------------------------------------------
// IMessageBus
// ---------------------------------------------------------------------------

/**
 * Durable communication channel for running executions.
 *
 * Backed by the `task_messages` SQLite table. Implementations must be safe
 * to call from any process that shares the same SQLite file.
 */
export interface IMessageBus {
  // -------------------------------------------------------------------------
  // Inbound command queue (orchestrator → sandbox)
  // -------------------------------------------------------------------------

  /**
   * Enqueue an inbound command for a running execution.
   *
   * The command is persisted in `task_messages` with status `pending`.
   * The sandbox polls this queue and processes commands between agent turns.
   */
  sendCommand(executionId: string, command: InboundCommand): void;

  /**
   * Return all pending (unacknowledged) inbound commands for an execution,
   * ordered by `created_at ASC` (oldest first).
   *
   * Commands remain in `pending` status until acknowledgeCommands() is called.
   */
  readPendingCommands(executionId: string): PendingCommand[];

  /**
   * Mark the given message IDs as `acknowledged`.
   *
   * Call this after the sandbox has successfully processed the commands.
   * Acknowledged commands are retained for audit but excluded from future
   * readPendingCommands() calls.
   */
  acknowledgeCommands(messageIds: string[]): void;

  // -------------------------------------------------------------------------
  // Checkpoint management (sandbox → orchestrator)
  // -------------------------------------------------------------------------

  /**
   * Persist a checkpoint as an outbound `checkpoint` message.
   *
   * The checkpoint is stored as a JSON payload in `task_messages`.
   * Multiple checkpoints may exist per execution — only the latest matters.
   */
  writeCheckpoint(executionId: string, checkpoint: Checkpoint): void;

  /**
   * Return the most recently written checkpoint for an execution, or null
   * if no checkpoint exists.
   *
   * Used by the recovery flow to resume from the last known-good state.
   */
  readLatestCheckpoint(executionId: string): Checkpoint | null;

  // -------------------------------------------------------------------------
  // Structured log append (sandbox → file + queue)
  // -------------------------------------------------------------------------

  /**
   * Append a structured log entry for an execution.
   *
   * The entry is:
   *   1. Persisted as an outbound `log` message in `task_messages`.
   *   2. Appended to `{dataDir}/logs/{executionId}.jsonl` (JSONL format).
   *
   * The JSONL file is the primary read path for the web UI Logs tab and
   * the `baara executions logs <id>` CLI command.
   */
  appendLog(executionId: string, level: "info" | "warn" | "error" | "debug", message: string): void;
}

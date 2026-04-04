// @baara-next/agent — Turn lifecycle manager
//
// Tracks the number of agent turns within a single execution and enforces
// soft and hard turn limits.  The soft limit prompts for human input before
// continuing; the hard limit terminates the execution unconditionally.

import type { ITransport } from "@baara-next/core";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type TurnAction = "continue" | "request_input" | "terminate";

export interface TurnDecision {
  action: TurnAction;
  reason?: string;
}

// ---------------------------------------------------------------------------
// TurnManager
// ---------------------------------------------------------------------------

/**
 * Manages the turn counter and limit enforcement for a single execution.
 *
 * @param maxTurnsSoft   - Turn count at which the agent should request human
 *                         input before proceeding (from `task.agentConfig`).
 * @param maxTurnsHard   - Absolute maximum; execution terminates once reached
 *                         (global default: 100).
 * @param transport      - Used to send a heartbeat on every turn.
 * @param agentId        - Identifies this agent in heartbeat calls.
 * @param executionId    - The execution whose turns are being tracked.
 */
export class TurnManager {
  private currentTurn = 0;

  /**
   * Set to true by `beforeTurn` after it increments the counter.
   * Reset to false at the start of each cycle so that `recordTurn` can
   * increment exactly once per turn when `beforeTurn` was not called.
   */
  private turnIncrementedThisCycle = false;

  constructor(
    private readonly maxTurnsSoft: number,
    private readonly maxTurnsHard: number,
    private readonly transport: ITransport,
    private readonly agentId: string,
    private readonly executionId: string,
  ) {}

  /** The number of turns that have been started. */
  get turnCount(): number {
    return this.currentTurn;
  }

  /**
   * Called at the beginning of each agent turn.
   *
   * Increments the turn counter, sends a heartbeat, and returns a decision
   * telling the agent whether to continue, pause for input, or terminate.
   */
  async beforeTurn(): Promise<TurnDecision> {
    this.turnIncrementedThisCycle = false;
    this.currentTurn += 1;
    this.turnIncrementedThisCycle = true;

    // Best-effort heartbeat — failures must not abort the turn.
    try {
      await this.transport.heartbeat(
        this.agentId,
        this.executionId,
        this.currentTurn,
      );
    } catch {
      // Intentionally swallowed.
    }

    if (this.currentTurn >= this.maxTurnsHard) {
      return {
        action: "terminate",
        reason: `Hard turn limit reached (${this.maxTurnsHard})`,
      };
    }

    if (this.currentTurn >= this.maxTurnsSoft) {
      return {
        action: "request_input",
        reason: `Soft turn limit reached (${this.maxTurnsSoft}); awaiting operator approval to continue`,
      };
    }

    return { action: "continue" };
  }

  /**
   * Explicitly record that a turn has been completed.
   *
   * Safe to call regardless of whether `beforeTurn` was invoked for the
   * current turn — it only increments the counter when `beforeTurn` has not
   * already done so, preventing double-counting.
   *
   * Runtimes that manage their own turn loop and bypass `beforeTurn` should
   * call this at the end of each turn to keep the TurnManager in sync.
   */
  recordTurn(): void {
    if (!this.turnIncrementedThisCycle) {
      // beforeTurn was not called this cycle — increment manually.
      this.currentTurn += 1;
    }
    // Reset for the next cycle regardless of which path was taken.
    this.turnIncrementedThisCycle = false;
  }
}

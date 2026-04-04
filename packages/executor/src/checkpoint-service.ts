// @baara-next/executor — CheckpointService
//
// Runs inside a SandboxInstance. Receives turn-complete notifications from the
// SDK event loop and writes periodic Checkpoint snapshots to the MessageBus.
//
// Usage:
//   const cs = new CheckpointService({ executionId, messageBus, intervalTurns: 5, getConversationHistory });
//   // inside the SDK stream loop, after each assistant turn:
//   cs.onTurnComplete(turnCount);
//   // on HITL pause or explicit checkpoint request:
//   cs.checkpoint(turnCount);

import type { IMessageBus } from "@baara-next/core";
import type { Checkpoint, ConversationMessage } from "@baara-next/core";

export interface CheckpointServiceConfig {
  executionId: string;
  messageBus: IMessageBus;
  /** Write a checkpoint every N completed turns. Default: 5. */
  intervalTurns?: number;
  /** Callback that returns the current conversation history from the SDK session. */
  getConversationHistory: () => ConversationMessage[];
  /** Optional: return in-flight tool names at checkpoint time. */
  getPendingToolCalls?: () => string[];
}

export class CheckpointService {
  private readonly executionId: string;
  private readonly messageBus: IMessageBus;
  private readonly intervalTurns: number;
  private readonly getConversationHistory: () => ConversationMessage[];
  private readonly getPendingToolCalls: () => string[];

  constructor(config: CheckpointServiceConfig) {
    this.executionId = config.executionId;
    this.messageBus = config.messageBus;
    this.intervalTurns = config.intervalTurns ?? 5;
    this.getConversationHistory = config.getConversationHistory;
    this.getPendingToolCalls = config.getPendingToolCalls ?? (() => []);
  }

  /**
   * Call this after every completed assistant turn.
   * Writes a checkpoint when `turnCount` is a multiple of `intervalTurns`.
   */
  onTurnComplete(turnCount: number): void {
    if (turnCount > 0 && turnCount % this.intervalTurns === 0) {
      this.checkpoint(turnCount);
    }
  }

  /**
   * Write a checkpoint immediately regardless of the interval.
   * Use on HITL pause, on explicit operator request, or on clean completion.
   */
  checkpoint(turnCount: number): void {
    const cp: Checkpoint = {
      id: crypto.randomUUID(),
      executionId: this.executionId,
      turnCount,
      conversationHistory: this.getConversationHistory(),
      pendingToolCalls: this.getPendingToolCalls(),
      agentState: {},
      timestamp: new Date().toISOString(),
    };
    this.messageBus.writeCheckpoint(this.executionId, cp);
  }
}

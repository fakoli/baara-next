import { describe, it, expect, mock, beforeEach } from "bun:test";
import { CheckpointService } from "../checkpoint-service.ts";
import type { IMessageBus } from "@baara-next/core";
import type { Checkpoint } from "@baara-next/core";

function makeMockBus(): IMessageBus & { written: Checkpoint[] } {
  const written: Checkpoint[] = [];
  return {
    written,
    writeCheckpoint(_execId: string, cp: Checkpoint) { written.push(cp); },
    sendCommand: mock(() => {}),
    readPendingCommands: mock(() => []),
    acknowledgeCommands: mock(() => {}),
    readLatestCheckpoint: mock(() => null),
    appendLog: mock(() => {}),
  } as unknown as IMessageBus & { written: Checkpoint[] };
}

describe("CheckpointService", () => {
  let bus: IMessageBus & { written: Checkpoint[] };
  let service: CheckpointService;
  const executionId = "ex-checkpoint-test";

  beforeEach(() => {
    bus = makeMockBus();
    service = new CheckpointService({
      executionId,
      messageBus: bus,
      intervalTurns: 3,
      getConversationHistory: () => [
        { role: "user", content: "hello" },
        { role: "assistant", content: "world" },
      ],
    });
  });

  it("does not checkpoint before the interval is reached", () => {
    service.onTurnComplete(1);
    service.onTurnComplete(2);
    expect(bus.written).toHaveLength(0);
  });

  it("checkpoints exactly at the interval", () => {
    service.onTurnComplete(1);
    service.onTurnComplete(2);
    service.onTurnComplete(3);
    expect(bus.written).toHaveLength(1);
    expect(bus.written[0]!.turnCount).toBe(3);
    expect(bus.written[0]!.conversationHistory).toHaveLength(2);
  });

  it("checkpoints at every subsequent interval", () => {
    for (let i = 1; i <= 9; i++) service.onTurnComplete(i);
    expect(bus.written).toHaveLength(3); // turns 3, 6, 9
  });

  it("immediate checkpoint() writes regardless of interval", () => {
    service.checkpoint(2);
    expect(bus.written).toHaveLength(1);
    expect(bus.written[0]!.turnCount).toBe(2);
  });

  it("checkpoint payload includes executionId and timestamp", () => {
    service.checkpoint(1);
    expect(bus.written[0]!.executionId).toBe(executionId);
    expect(bus.written[0]!.timestamp).toBeTruthy();
    expect(bus.written[0]!.id).toBeTruthy();
  });
});

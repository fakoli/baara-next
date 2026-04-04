import { describe, it, expect } from "bun:test";
import type { IMessageBus } from "../interfaces/message-bus.ts";
import type { InboundCommand, Checkpoint } from "../types.ts";

describe("IMessageBus interface shape", () => {
  it("IMessageBus has all required methods", () => {
    const bus = {} as IMessageBus;

    // These type assertions will fail at compile time if the methods are absent.
    // Assigned to void to suppress noUnusedLocals.
    void (bus.sendCommand as (id: string, cmd: InboundCommand) => void);
    void (bus.readPendingCommands as (id: string) => Array<{ id: string; command: InboundCommand }>);
    void (bus.acknowledgeCommands as (ids: string[]) => void);
    void (bus.writeCheckpoint as (id: string, cp: Checkpoint) => void);
    void (bus.readLatestCheckpoint as (id: string) => Checkpoint | null);
    void (bus.appendLog as (id: string, level: "info" | "warn" | "error" | "debug", message: string) => void);

    expect(true).toBe(true);
  });
});

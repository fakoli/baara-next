// @baara-next/server — sandboxEventToWsEvent tests
import { describe, it, expect } from "bun:test";
import { sandboxEventToWsEvent } from "../ws.ts";
import type { SandboxEvent } from "@baara-next/core";

describe("sandboxEventToWsEvent", () => {
  it("converts log event", () => {
    const event: SandboxEvent = {
      type: "log",
      level: "info",
      message: "test",
      timestamp: "2026-04-04T00:00:00Z",
    };
    const ws = sandboxEventToWsEvent("ex-1", event);
    expect(ws).not.toBeNull();
    expect(ws!.type).toBe("execution_log");
    expect((ws as { executionId: string }).executionId).toBe("ex-1");
  });

  it("converts text_delta event", () => {
    const event: SandboxEvent = { type: "text_delta", delta: "hello" };
    const ws = sandboxEventToWsEvent("ex-1", event);
    expect(ws!.type).toBe("execution_text_delta");
    expect((ws as { delta: string }).delta).toBe("hello");
  });

  it("converts tool_use event", () => {
    const event: SandboxEvent = { type: "tool_use", name: "Bash", input: { command: "ls" } };
    const ws = sandboxEventToWsEvent("ex-1", event);
    expect(ws!.type).toBe("execution_tool_event");
    expect((ws as { eventType: string }).eventType).toBe("tool_use");
  });

  it("converts tool_result event", () => {
    const event: SandboxEvent = { type: "tool_result", name: "Bash", output: "ok", isError: false };
    const ws = sandboxEventToWsEvent("ex-1", event);
    expect(ws!.type).toBe("execution_tool_event");
    expect((ws as { eventType: string }).eventType).toBe("tool_result");
  });

  it("returns null for checkpoint event (not broadcast to clients)", () => {
    const event: SandboxEvent = {
      type: "checkpoint",
      checkpoint: {
        id: "c1",
        executionId: "ex-1",
        turnCount: 1,
        conversationHistory: [],
        pendingToolCalls: [],
        agentState: {},
        timestamp: "2026-04-04T00:00:00Z",
      },
    };
    expect(sandboxEventToWsEvent("ex-1", event)).toBeNull();
  });

  it("returns null or WsEvent for turn_complete event (must not throw)", () => {
    const event: SandboxEvent = { type: "turn_complete", turnCount: 1, inputTokens: 100, outputTokens: 50 };
    // turn_complete broadcasts as a status update — either null or a valid WsEvent
    const ws = sandboxEventToWsEvent("ex-1", event);
    // Must not throw; result is null or object
    expect(ws === null || typeof ws === "object").toBe(true);
  });
});

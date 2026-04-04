import { describe, it, expect } from "bun:test";
import { buildRecoveryPrompt, prepareRecoveryParams } from "../recovery.ts";
import type { Checkpoint } from "@baara-next/core";

const baseCheckpoint: Checkpoint = {
  id: "cp-1",
  executionId: "ex-1",
  turnCount: 7,
  conversationHistory: [
    { role: "user", content: "Run the test suite" },
    { role: "assistant", content: "Running npm test..." },
  ],
  pendingToolCalls: ["Bash"],
  agentState: {},
  timestamp: "2026-04-04T10:00:00Z",
};

describe("buildRecoveryPrompt", () => {
  it("includes the turn count", () => {
    const prompt = buildRecoveryPrompt(baseCheckpoint);
    expect(prompt).toContain("7");
  });

  it("includes RECOVERY CONTEXT header", () => {
    const prompt = buildRecoveryPrompt(baseCheckpoint);
    expect(prompt).toContain("RECOVERY CONTEXT");
  });

  it("includes pending tool call names", () => {
    const prompt = buildRecoveryPrompt(baseCheckpoint);
    expect(prompt).toContain("Bash");
  });

  it("instructs the agent not to repeat completed work", () => {
    const prompt = buildRecoveryPrompt(baseCheckpoint);
    expect(prompt).toMatch(/verify|do not repeat|check/i);
  });

  it("returns empty string when no checkpoint provided", () => {
    expect(buildRecoveryPrompt(null)).toBe("");
  });
});

describe("prepareRecoveryParams", () => {
  it("returns params with checkpoint populated", () => {
    const params = prepareRecoveryParams(baseCheckpoint, {
      executionId: "ex-2",
      prompt: "Run the test suite",
      tools: ["Bash", "Read"],
      agentConfig: { model: "claude-sonnet-4-20250514" },
      timeout: 300_000,
    });
    expect(params.checkpoint).toBe(baseCheckpoint);
    expect(params.executionId).toBe("ex-2");
  });

  it("prepends recovery prompt to agentConfig.systemPrompt", () => {
    const params = prepareRecoveryParams(baseCheckpoint, {
      executionId: "ex-2",
      prompt: "original prompt",
      tools: [],
      agentConfig: { systemPrompt: "Be concise." },
      timeout: 300_000,
    });
    expect(params.agentConfig.systemPrompt).toContain("RECOVERY CONTEXT");
    expect(params.agentConfig.systemPrompt).toContain("Be concise.");
  });
});

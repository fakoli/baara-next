import { describe, it, expect } from "bun:test";
import type {
  SandboxType,
  SandboxConfig,
  AgentConfig,
  Task,
  Checkpoint,
  ConversationMessage,
  SandboxEvent,
  InboundCommand,
} from "../types.ts";

describe("Phase 5 types", () => {
  it("SandboxType is a union of native | wasm | docker", () => {
    const t: SandboxType = "native";
    expect(["native", "wasm", "docker"]).toContain(t);
  });

  it("SandboxConfig discriminated union narrows correctly", () => {
    const cfg: SandboxConfig = { type: "wasm", maxMemoryMb: 256 };
    if (cfg.type === "wasm") {
      expect(cfg.maxMemoryMb).toBe(256);
    }
  });

  it("Task accepts sandboxType and sandboxConfig fields", () => {
    const task = {} as Task;
    // TypeScript will error if these fields don't exist on the type
    void (task.sandboxType as SandboxType | undefined);
    void (task.sandboxConfig as SandboxConfig | undefined);
    expect(true).toBe(true);
  });

  it("Checkpoint has required fields", () => {
    const cp = {} as Checkpoint;
    void (cp.id as string);
    void (cp.executionId as string);
    void (cp.turnCount as number);
    expect(true).toBe(true);
  });

  it("AgentConfig accepts systemPrompt field", () => {
    const cfg: AgentConfig = { model: "claude-opus-4", systemPrompt: "Be helpful." };
    expect(cfg.systemPrompt).toBe("Be helpful.");
  });

  it("SandboxEvent is a discriminated union", () => {
    const event: SandboxEvent = { type: "log", level: "info", message: "hello", timestamp: new Date().toISOString() };
    expect(event.type).toBe("log");
  });

  it("InboundCommand is a discriminated union", () => {
    const cmd: InboundCommand = { type: "command", prompt: "continue" };
    expect(cmd.type).toBe("command");
  });

  it("ConversationMessage accepts string or ContentBlock[] content", () => {
    const msg: ConversationMessage = { role: "user", content: "hello" };
    expect(msg.role).toBe("user");
    const msg2: ConversationMessage = { role: "assistant", content: [{ type: "text" }] };
    expect(msg2.role).toBe("assistant");
  });
});

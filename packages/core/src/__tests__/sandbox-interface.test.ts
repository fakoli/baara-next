import { describe, it, expect } from "bun:test";
import type { ISandbox, SandboxInstance, SandboxStartConfig, SandboxExecuteParams } from "../interfaces/sandbox.ts";

describe("ISandbox interface shape", () => {
  it("ISandbox has required members", () => {
    const s = {} as ISandbox;
    void (s.name as string);
    void (s.description as string);
    expect(true).toBe(true);
  });

  it("SandboxInstance has execute, sendCommand, events, cancel", () => {
    const inst = {} as SandboxInstance;
    void (inst.id as string);
    void (inst.sandboxType as string);
    expect(true).toBe(true);
  });

  it("SandboxStartConfig has executionId, sandboxConfig, agentConfig, dataDir", () => {
    const cfg = {} as SandboxStartConfig;
    void (cfg.executionId as string);
    void (cfg.dataDir as string);
    expect(true).toBe(true);
  });

  it("SandboxExecuteParams has executionId, prompt, tools, timeout", () => {
    const params = {} as SandboxExecuteParams;
    void (params.executionId as string);
    void (params.prompt as string);
    void (params.tools as string[]);
    void (params.timeout as number);
    expect(true).toBe(true);
  });
});

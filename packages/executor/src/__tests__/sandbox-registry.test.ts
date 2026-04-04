import { describe, it, expect } from "bun:test";
import { SandboxRegistry } from "../sandbox-registry.ts";
import type { ISandbox, SandboxInstance, SandboxStartConfig } from "@baara-next/core";
import type { Task } from "@baara-next/core";

const makeFakeSandbox = (name: "native" | "wasm" | "docker", available = true): ISandbox => ({
  name,
  description: `Fake ${name} sandbox`,
  isAvailable: async () => available,
  start: async (_config: SandboxStartConfig): Promise<SandboxInstance> => {
    throw new Error("not needed");
  },
  stop: async (_instance: SandboxInstance): Promise<void> => {},
});

describe("SandboxRegistry", () => {
  it("registers and retrieves a sandbox by name", () => {
    const registry = new SandboxRegistry();
    const native = makeFakeSandbox("native");
    registry.register(native);
    expect(registry.get("native")).toBe(native);
  });

  it("getForTask returns the sandbox matching task.sandboxType", () => {
    const registry = new SandboxRegistry();
    const native = makeFakeSandbox("native");
    registry.register(native);
    const task = { sandboxType: "native" } as Task;
    expect(registry.getForTask(task)).toBe(native);
  });

  it("getForTask throws when sandboxType is not registered", () => {
    const registry = new SandboxRegistry();
    const task = { id: "test-id", sandboxType: "docker" } as Task;
    expect(() => registry.getForTask(task)).toThrow(/No sandbox registered/);
  });

  it("getAvailable filters to only available sandboxes", async () => {
    const registry = new SandboxRegistry();
    registry.register(makeFakeSandbox("native", true));
    registry.register(makeFakeSandbox("docker", false));
    const available = await registry.getAvailable();
    expect(available.map((s) => s.name)).toEqual(["native"]);
  });

  it("getAll returns all registered sandboxes", () => {
    const registry = new SandboxRegistry();
    registry.register(makeFakeSandbox("native"));
    registry.register(makeFakeSandbox("wasm"));
    expect(registry.getAll()).toHaveLength(2);
  });
});

// packages/executor/src/__tests__/sandbox-factory.test.ts
// Tests for createDefaultSandboxRegistry factory function.
import { describe, it, expect } from "bun:test";
import { createDefaultSandboxRegistry } from "../index.ts";
import { SandboxRegistry } from "../sandbox-registry.ts";

describe("createDefaultSandboxRegistry", () => {
  it("returns a SandboxRegistry", async () => {
    const registry = await createDefaultSandboxRegistry({ dataDir: "/tmp" });
    expect(registry).toBeInstanceOf(SandboxRegistry);
  });

  it("registers native, wasm, docker sandboxes", async () => {
    const registry = await createDefaultSandboxRegistry({ dataDir: "/tmp" });
    expect(registry.get("native")).toBeDefined();
    expect(registry.get("wasm")).toBeDefined();
    expect(registry.get("docker")).toBeDefined();
  });

  it("native sandbox is always available", async () => {
    const registry = await createDefaultSandboxRegistry({ dataDir: "/tmp" });
    const native = registry.get("native")!;
    expect(await native.isAvailable()).toBe(true);
  });

  it("docker sandbox isAvailable() returns a boolean without throwing", async () => {
    // Returns true when Docker is installed and the daemon is running,
    // false otherwise. Both are valid — what matters is no exception is thrown.
    const registry = await createDefaultSandboxRegistry({ dataDir: "/tmp" });
    const docker = registry.get("docker")!;
    const available = await docker.isAvailable();
    expect(typeof available).toBe("boolean");
  });

  it("getAvailable() always includes native", async () => {
    const registry = await createDefaultSandboxRegistry({ dataDir: "/tmp" });
    const available = await registry.getAvailable();
    expect(available.map((s) => s.name)).toContain("native");
  });

  it("also accepts a bare string dataDir for backward compat", async () => {
    const registry = await createDefaultSandboxRegistry("/tmp");
    expect(registry).toBeInstanceOf(SandboxRegistry);
  });
});

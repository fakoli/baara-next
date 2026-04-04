import { describe, it, expect } from "bun:test";

describe("executor barrel exports", () => {
  it("exports SandboxRegistry", async () => {
    const mod = await import("../index.ts");
    expect(typeof mod.SandboxRegistry).toBe("function");
  });

  it("exports createDefaultSandboxRegistry", async () => {
    const mod = await import("../index.ts");
    expect(typeof mod.createDefaultSandboxRegistry).toBe("function");
  });

  it("exports NativeSandbox", async () => {
    const mod = await import("../index.ts");
    expect(typeof mod.NativeSandbox).toBe("function");
  });

  it("exports WasmSandbox", async () => {
    const mod = await import("../index.ts");
    expect(typeof mod.WasmSandbox).toBe("function");
  });

  it("exports DockerSandbox", async () => {
    const mod = await import("../index.ts");
    expect(typeof mod.DockerSandbox).toBe("function");
  });

  it("still exports RuntimeRegistry for backward compat", async () => {
    const mod = await import("../index.ts");
    expect(typeof mod.RuntimeRegistry).toBe("function");
  });

  it("still exports createDefaultRegistry for backward compat", async () => {
    const mod = await import("../index.ts");
    expect(typeof mod.createDefaultRegistry).toBe("function");
  });
});

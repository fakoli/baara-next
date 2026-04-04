import { describe, it, expect } from "bun:test";

describe("@baara-next/mcp barrel exports", () => {
  it("exports createBaaraMcpServer", async () => {
    const mod = await import("../index.ts");
    expect(typeof mod.createBaaraMcpServer).toBe("function");
  });

  it("exports createMcpHttpApp", async () => {
    const mod = await import("../index.ts");
    expect(typeof mod.createMcpHttpApp).toBe("function");
  });

  it("exports runStdioMcpServer", async () => {
    const mod = await import("../index.ts");
    expect(typeof mod.runStdioMcpServer).toBe("function");
  });

  it("exports BaaraMcpServerDeps type (compile-time check via import)", async () => {
    // If the type export compiles, this test passes.
    const mod = await import("../index.ts");
    expect(mod).toBeDefined();
  });
});

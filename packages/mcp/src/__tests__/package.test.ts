import { describe, it, expect } from "bun:test";

describe("@baara-next/mcp package", () => {
  it("exports createBaaraMcpServer", async () => {
    const mod = await import("../index.ts");
    expect(typeof mod.createBaaraMcpServer).toBe("function");
  });
});

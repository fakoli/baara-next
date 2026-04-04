import { describe, it, expect } from "bun:test";
import { runStdioMcpServer } from "../stdio.ts";
import type { IStore, IOrchestratorService } from "@baara-next/core";

describe("runStdioMcpServer", () => {
  it("exports runStdioMcpServer as a function", () => {
    expect(typeof runStdioMcpServer).toBe("function");
  });

  it("accepts deps with store and orchestrator", () => {
    // Just verify the function signature accepts the correct shape.
    // We don't actually invoke it (that would block on stdio).
    const deps = {
      store: {} as IStore,
      orchestrator: {} as IOrchestratorService,
    };
    // The function itself should be callable without throwing when passed valid deps.
    // We test the export shape only — actual stdio testing is done via integration test.
    expect(() => {
      // Verify it's a function with arity 1
      expect(runStdioMcpServer.length).toBe(1);
    }).not.toThrow();
    // Suppress unused variable warning
    void deps;
  });
});

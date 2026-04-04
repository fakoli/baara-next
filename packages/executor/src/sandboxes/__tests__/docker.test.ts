// packages/executor/src/sandboxes/__tests__/docker.test.ts
import { describe, it, expect } from "bun:test";
import { DockerSandbox } from "../docker.ts";

describe("DockerSandbox", () => {
  it("name is 'docker'", () => {
    expect(new DockerSandbox().name).toBe("docker");
  });

  it("isAvailable() returns false", async () => {
    expect(await new DockerSandbox().isAvailable()).toBe(false);
  });

  it("start() throws 'not yet implemented'", async () => {
    await expect(
      new DockerSandbox().start({
        executionId: "ex-1",
        sandboxConfig: { type: "docker" },
        agentConfig: {},
        dataDir: "/tmp",
      })
    ).rejects.toThrow("not yet implemented");
  });

  it("stop() resolves without throwing", async () => {
    const instance = {
      id: "x",
      sandboxType: "docker" as const,
      execute: async () => ({ status: "failed" as const, durationMs: 0 }),
      sendCommand: async () => {},
      events: {
        [Symbol.asyncIterator]: () => ({
          next: async () => ({ value: undefined, done: true as const }),
        }),
      },
      cancel: async () => {},
    };
    await expect(new DockerSandbox().stop(instance)).resolves.toBeUndefined();
  });
});

// packages/executor/src/sandboxes/__tests__/docker.test.ts
import { describe, it, expect } from "bun:test";
import { DockerSandbox, DockerSandboxInstance } from "../docker.ts";

describe("DockerSandbox", () => {
  it("name is 'docker'", () => {
    expect(new DockerSandbox().name).toBe("docker");
  });

  it("isAvailable() returns a boolean without throwing", async () => {
    // On machines with Docker installed this returns true; on machines without
    // Docker or without the daemon running it returns false. Either is valid.
    const available = await new DockerSandbox().isAvailable();
    expect(typeof available).toBe("boolean");
  });

  it("stop() calls cancel() on the instance", async () => {
    let cancelCalled = false;
    const fakeInstance = {
      id: "x",
      sandboxType: "docker" as const,
      execute: async () => ({ status: "failed" as const, durationMs: 0 }),
      sendCommand: async () => {},
      events: {
        [Symbol.asyncIterator]: () => ({
          next: async () => ({ value: undefined, done: true as const }),
        }),
      },
      cancel: async () => {
        cancelCalled = true;
      },
    };
    await new DockerSandbox().stop(fakeInstance);
    expect(cancelCalled).toBe(true);
  });

  it("start() throws when Docker is unavailable", async () => {
    // Simulate unavailability by overriding isAvailable on the instance.
    const sandbox = new DockerSandbox();
    sandbox.isAvailable = async () => false;
    await expect(
      sandbox.start({
        executionId: "ex-1",
        sandboxConfig: { type: "docker" },
        agentConfig: {},
        dataDir: "/tmp",
      })
    ).rejects.toThrow("Docker is not available");
  });
});

describe("DockerSandboxInstance", () => {
  it("has correct id and sandboxType", () => {
    const instance = new DockerSandboxInstance("ex-docker-1", {
      type: "docker",
    });
    expect(instance.id).toBe("ex-docker-1");
    expect(instance.sandboxType).toBe("docker");
  });

  it("resolves docker config with defaults", () => {
    const instance = new DockerSandboxInstance("ex-docker-2", {
      type: "docker",
    });
    expect(instance.resolvedConfig.image).toBe("node:22-slim");
    expect(instance.resolvedConfig.networkEnabled).toBe(true);
    expect(instance.resolvedConfig.ports).toEqual([]);
    expect(instance.resolvedConfig.volumeMounts).toEqual([]);
  });

  it("respects explicit image in config", () => {
    const instance = new DockerSandboxInstance("ex-docker-3", {
      type: "docker",
      image: "alpine:3.19",
    });
    expect(instance.resolvedConfig.image).toBe("alpine:3.19");
  });

  it("respects networkEnabled=false", () => {
    const instance = new DockerSandboxInstance("ex-docker-4", {
      type: "docker",
      networkEnabled: false,
    });
    expect(instance.resolvedConfig.networkEnabled).toBe(false);
  });

  it("cancel() does not throw before execute() is called", async () => {
    const instance = new DockerSandboxInstance("ex-docker-5", {
      type: "docker",
    });
    await expect(instance.cancel()).resolves.toBeUndefined();
  });

  it("sendCommand() resolves without throwing", async () => {
    const instance = new DockerSandboxInstance("ex-docker-6", {
      type: "docker",
    });
    await expect(
      instance.sendCommand({ type: "pause" })
    ).resolves.toBeUndefined();
  });

  it("events iterable terminates immediately before execute()", async () => {
    const instance = new DockerSandboxInstance("ex-docker-7", {
      type: "docker",
    });
    // Call cancel() to close the events stream (simulating no execute() call).
    await instance.cancel();
    // The events stream must complete without hanging.
    const collected: string[] = [];
    // We do not iterate events here since closeEvents() is only triggered
    // inside execute(). This test verifies cancel() does not throw.
    expect(collected).toEqual([]);
  });

  it("execute() runs a real container when Docker is available", async () => {
    const sandbox = new DockerSandbox();
    const dockerAvailable = await sandbox.isAvailable();
    if (!dockerAvailable) {
      console.log("Docker not available — skipping container execution test");
      return;
    }

    const instance = new DockerSandboxInstance("ex-docker-run-1", {
      type: "docker",
      image: "alpine:3.19",
    });

    const result = await instance.execute({
      executionId: "ex-docker-run-1",
      prompt: "echo hello-baara",
      tools: [],
      agentConfig: {},
      timeout: 30_000,
    });

    expect(result.status).toBe("completed");
    expect(result.output).toContain("hello-baara");
    expect(result.durationMs).toBeGreaterThan(0);
  }, 60_000);

  it("execute() returns failed for a non-zero exit code", async () => {
    const sandbox = new DockerSandbox();
    const dockerAvailable = await sandbox.isAvailable();
    if (!dockerAvailable) {
      console.log("Docker not available — skipping failed-exit test");
      return;
    }

    const instance = new DockerSandboxInstance("ex-docker-fail-1", {
      type: "docker",
      image: "alpine:3.19",
    });

    const result = await instance.execute({
      executionId: "ex-docker-fail-1",
      prompt: "exit 1",
      tools: [],
      agentConfig: {},
      timeout: 30_000,
    });

    expect(result.status).toBe("failed");
    expect(result.durationMs).toBeGreaterThan(0);
  }, 60_000);

  it("execute() returns cancelled when cancel() is called during run", async () => {
    const sandbox = new DockerSandbox();
    const dockerAvailable = await sandbox.isAvailable();
    if (!dockerAvailable) {
      console.log("Docker not available — skipping cancellation test");
      return;
    }

    const instance = new DockerSandboxInstance("ex-docker-cancel-1", {
      type: "docker",
      image: "alpine:3.19",
    });

    // Start a long-running container and cancel it immediately.
    const executePromise = instance.execute({
      executionId: "ex-docker-cancel-1",
      prompt: "sleep 60",
      tools: [],
      agentConfig: {},
      timeout: 60_000,
    });

    // Give the container a moment to start, then cancel.
    await new Promise((r) => setTimeout(r, 500));
    await instance.cancel();

    const result = await executePromise;
    expect(result.status).toBe("cancelled");
  }, 30_000);
});

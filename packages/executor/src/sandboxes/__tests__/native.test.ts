// packages/executor/src/sandboxes/__tests__/native.test.ts
import { describe, it, expect, mock } from "bun:test";
import { NativeSandbox, NativeSandboxInstance } from "../native.ts";

describe("NativeSandbox", () => {
  it("isAvailable() always returns true", async () => {
    const sandbox = new NativeSandbox();
    expect(await sandbox.isAvailable()).toBe(true);
  });

  it("name is 'native'", () => {
    const sandbox = new NativeSandbox();
    expect(sandbox.name).toBe("native");
  });

  it("start() returns a NativeSandboxInstance", async () => {
    const sandbox = new NativeSandbox();
    const instance = await sandbox.start({
      executionId: "ex-1",
      sandboxConfig: { type: "native" },
      agentConfig: {},
      dataDir: "/tmp",
    });
    expect(instance).toBeInstanceOf(NativeSandboxInstance);
    expect(instance.id).toBe("ex-1");
    expect(instance.sandboxType).toBe("native");
  });

  it("stop() calls cancel() on the instance", async () => {
    const sandbox = new NativeSandbox();
    const instance = await sandbox.start({
      executionId: "ex-2",
      sandboxConfig: { type: "native" },
      agentConfig: {},
      dataDir: "/tmp",
    });
    const cancelSpy = mock(() => Promise.resolve());
    instance.cancel = cancelSpy;
    await sandbox.stop(instance);
    expect(cancelSpy).toHaveBeenCalled();
  });
});

describe("NativeSandboxInstance", () => {
  it("cancel() aborts the controller", async () => {
    const instance = new NativeSandboxInstance("ex-3", {}, null);
    // cancel() should not throw even if called before execute()
    await expect(instance.cancel()).resolves.toBeUndefined();
  });

  it("sendCommand() resolves without throwing", async () => {
    const instance = new NativeSandboxInstance("ex-4", {}, null);
    await expect(
      instance.sendCommand({ type: "pause" })
    ).resolves.toBeUndefined();
  });
});

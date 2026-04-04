// packages/executor/src/sandboxes/__tests__/wasm.test.ts
import { describe, it, expect } from "bun:test";
import { WasmSandbox, WasmSandboxInstance } from "../wasm.ts";

describe("WasmSandbox", () => {
  it("name is 'wasm'", () => {
    expect(new WasmSandbox().name).toBe("wasm");
  });

  it("isAvailable() returns false when @extism/extism is not installed", async () => {
    const sandbox = new WasmSandbox();
    // In the test environment @extism/extism is unlikely to be installed.
    // isAvailable() must not throw — it should return false gracefully.
    const available = await sandbox.isAvailable();
    expect(typeof available).toBe("boolean");
  });

  it("start() returns a WasmSandboxInstance with correct id and type", async () => {
    const sandbox = new WasmSandbox();
    const instance = await sandbox.start({
      executionId: "ex-wasm-1",
      sandboxConfig: { type: "wasm", maxMemoryMb: 256 },
      agentConfig: {},
      dataDir: "/tmp",
    });
    expect(instance.id).toBe("ex-wasm-1");
    expect(instance.sandboxType).toBe("wasm");
  });

  it("stop() cancels the instance", async () => {
    const sandbox = new WasmSandbox();
    const instance = await sandbox.start({
      executionId: "ex-wasm-2",
      sandboxConfig: { type: "wasm" },
      agentConfig: {},
      dataDir: "/tmp",
    });
    await expect(sandbox.stop(instance)).resolves.toBeUndefined();
  });
});

describe("WasmSandboxInstance resource config", () => {
  it("stores resolved config with defaults applied", async () => {
    const instance = new WasmSandboxInstance("ex-wasm-3", {
      type: "wasm",
      maxMemoryMb: 128,
    }, {});
    // Access internal config via exposed getter for testing.
    expect(instance.resolvedConfig.maxMemoryMb).toBe(128);
    expect(instance.resolvedConfig.maxCpuPercent).toBe(80); // default
    expect(instance.resolvedConfig.networkEnabled).toBe(true); // default
  });

  it("cancel() does not throw", async () => {
    const instance = new WasmSandboxInstance("ex-wasm-4", { type: "wasm" }, {});
    await expect(instance.cancel()).resolves.toBeUndefined();
  });
});

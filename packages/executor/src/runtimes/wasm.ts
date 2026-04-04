// @baara-next/executor — Wasm runtime (placeholder)
//
// The WebAssembly sandbox runtime is not yet implemented.  This stub satisfies
// the `IRuntime` interface so the registry can be fully populated without
// leaving any capability gaps.

import type {
  IRuntime,
  RuntimeCapability,
  RuntimeConfig,
  ExecuteParams,
  ExecuteResult,
} from "@baara-next/core";

export class WasmRuntime implements IRuntime {
  readonly name = "wasm";
  readonly capabilities: readonly RuntimeCapability[] = ["sandbox"];

  async initialize(_config: RuntimeConfig): Promise<void> {
    // No-op — nothing to initialise yet.
  }

  async execute(_params: ExecuteParams): Promise<ExecuteResult> {
    return {
      status: "failed",
      error: "Wasm runtime not yet implemented",
      durationMs: 0,
    };
  }

  async cancel(_executionId: string): Promise<void> {
    // No-op — no running process to kill.
  }

  async healthCheck(): Promise<{ status: "healthy" }> {
    return { status: "healthy" };
  }

  async shutdown(): Promise<void> {
    // No-op.
  }
}

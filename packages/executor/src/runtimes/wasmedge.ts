// @baara-next/executor — WasmEdge runtime (placeholder)
//
// The WasmEdge GPU-accelerated sandbox runtime is not yet implemented.  This
// stub satisfies `IRuntime` so the registry is fully populated.

import type {
  IRuntime,
  RuntimeCapability,
  RuntimeConfig,
  ExecuteParams,
  ExecuteResult,
} from "@baara-next/core";

export class WasmEdgeRuntime implements IRuntime {
  readonly name = "wasm_edge";
  readonly capabilities: readonly RuntimeCapability[] = ["gpu", "sandbox"];

  async initialize(_config: RuntimeConfig): Promise<void> {
    // No-op — nothing to initialise yet.
  }

  async execute(_params: ExecuteParams): Promise<ExecuteResult> {
    return {
      status: "failed",
      error: "WasmEdge runtime not yet implemented",
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

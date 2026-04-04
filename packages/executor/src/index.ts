// @baara-next/executor — Public API barrel

// Phase 5: JSONL Log Writer + Reader
export { LogWriter, readLogEntries } from "./log-writer.ts";
export type { LogEntry, ReadLogOptions } from "./log-writer.ts";

// Phase 5: Communication layer
export { MessageBus } from "./message-bus.ts";

// Phase 5: Checkpointing + Recovery
export { CheckpointService } from "./checkpoint-service.ts";
export { buildRecoveryPrompt, prepareRecoveryParams } from "./recovery.ts";
export type { CheckpointServiceConfig } from "./checkpoint-service.ts";
export type { SandboxExecuteParams as ExecutorSandboxExecuteParams } from "./recovery.ts";

// Phase 5: Sandbox architecture
export { SandboxRegistry } from "./sandbox-registry.ts";
export { NativeSandbox, NativeSandboxInstance } from "./sandboxes/native.ts";
export { WasmSandbox, WasmSandboxInstance } from "./sandboxes/wasm.ts";
export { DockerSandbox, DockerSandboxInstance } from "./sandboxes/docker.ts";
export type { ResolvedWasmConfig } from "./sandboxes/wasm.ts";
export type { ResolvedDockerConfig } from "./sandboxes/docker.ts";

// Legacy runtime exports — kept during migration, to be removed in Phase 5 cleanup
export { RuntimeRegistry } from "./runtime-registry.ts";
export { defaultLimits, mergeLimits } from "./sandbox.ts";
export { CloudCodeRuntime } from "./runtimes/cloud-code.ts";
export { ShellRuntime } from "./runtimes/shell.ts";

import { SandboxRegistry } from "./sandbox-registry.ts";
import { NativeSandbox } from "./sandboxes/native.ts";
import { WasmSandbox } from "./sandboxes/wasm.ts";
import { DockerSandbox } from "./sandboxes/docker.ts";
import { RuntimeRegistry } from "./runtime-registry.ts";
import { CloudCodeRuntime } from "./runtimes/cloud-code.ts";
import { ShellRuntime } from "./runtimes/shell.ts";
import type { RuntimeConfig } from "@baara-next/core";

/**
 * Build and return a SandboxRegistry pre-populated with the three built-in
 * sandboxes: `native`, `wasm`, and `docker`.
 *
 * - `native` is always available.
 * - `wasm` is available when `@extism/extism` is installed.
 * - `docker` is available when Docker is installed and the daemon is running.
 *
 * Accepts either a bare dataDir string (legacy call sites) or a config object.
 */
export async function createDefaultSandboxRegistry(
  _config: string | { dataDir: string }
): Promise<SandboxRegistry> {
  const registry = new SandboxRegistry();
  registry.register(new NativeSandbox());
  registry.register(new WasmSandbox());
  registry.register(new DockerSandbox());
  return registry;
}

/**
 * Build and return a `RuntimeRegistry` pre-populated with all four built-in
 * runtimes: `cloud_code`, `shell`, `wasm`, and `wasm_edge`.
 *
 * Each runtime receives the same `config` object passed to `initialize`.
 *
 * Call this once at startup and pass the registry to `AgentService`.
 *
 * @deprecated Use `createDefaultSandboxRegistry` instead.
 */
export async function createDefaultRegistry(
  config: RuntimeConfig,
): Promise<RuntimeRegistry> {
  const registry = new RuntimeRegistry();

  const runtimes = [
    new CloudCodeRuntime(),
    new ShellRuntime(),
  ];

  await Promise.all(runtimes.map((r) => r.initialize(config)));

  for (const runtime of runtimes) {
    registry.register(runtime);
  }

  return registry;
}

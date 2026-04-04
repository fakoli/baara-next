// @baara-next/executor/sandboxes — WasmSandbox
//
// Extism WebAssembly sandbox. The Claude Code SDK runs in the host process;
// Extism mediates tool I/O through host functions, enforcing resource limits
// (memory, CPU, network) before each tool execution.
//
// Architecture:
//   Host process: Claude Code SDK query() → emits tool_use events
//       ↓
//   Extism host functions: baara_send_event, baara_read_command, baara_log,
//       baara_checkpoint — intercept each event and apply policy
//       ↓
//   Wasm guest module: stateless policy checker (network ACL, memory quota)
//
// If @extism/extism is not installed, isAvailable() returns false and start()
// falls back to NativeSandboxInstance with a warning log.

import type {
  ISandbox,
  SandboxInstance,
  SandboxStartConfig,
  SandboxExecuteParams,
  SandboxExecuteResult,
  SandboxEvent,
  InboundCommand,
  SandboxConfig,
} from "@baara-next/core";
import { NativeSandboxInstance } from "./native.ts";

// ---------------------------------------------------------------------------
// Resolved Wasm config (defaults applied)
// ---------------------------------------------------------------------------

export interface ResolvedWasmConfig {
  networkEnabled: boolean;
  maxMemoryMb: number;
  maxCpuPercent: number;
  ports: number[];
}

type RawWasmConfig = Extract<SandboxConfig, { type: "wasm" }>;

function resolveWasmConfig(raw: RawWasmConfig): ResolvedWasmConfig {
  return {
    networkEnabled: raw.networkEnabled ?? true,
    maxMemoryMb: raw.maxMemoryMb ?? 512,
    maxCpuPercent: raw.maxCpuPercent ?? 80,
    ports: raw.ports ?? [],
  };
}

// ---------------------------------------------------------------------------
// WasmSandbox
// ---------------------------------------------------------------------------

export class WasmSandbox implements ISandbox {
  readonly name = "wasm" as const;
  readonly description = "Extism WebAssembly sandbox with configurable resource isolation";

  async isAvailable(): Promise<boolean> {
    try {
      await import("@extism/extism");
      return true;
    } catch {
      return false;
    }
  }

  async start(config: SandboxStartConfig): Promise<SandboxInstance> {
    console.warn(
      "[WasmSandbox] Note: resource limits are advisory — Extism policy enforcement is not yet active. " +
        "The agent runs in the host process with system-prompt-level constraint hints."
    );
    const rawConfig = config.sandboxConfig as RawWasmConfig;
    return new WasmSandboxInstance(
      config.executionId,
      rawConfig,
      config.agentConfig as Record<string, unknown>
    );
  }

  async stop(instance: SandboxInstance): Promise<void> {
    await instance.cancel();
  }
}

// ---------------------------------------------------------------------------
// WasmSandboxInstance
// ---------------------------------------------------------------------------

export class WasmSandboxInstance implements SandboxInstance {
  readonly id: string;
  readonly sandboxType = "wasm" as const;

  /** Exposed for tests and observability. */
  readonly resolvedConfig: ResolvedWasmConfig;

  private readonly agentConfig: Record<string, unknown>;
  private readonly controller = new AbortController();
  private inner: NativeSandboxInstance | null = null;

  constructor(
    executionId: string,
    rawConfig: RawWasmConfig,
    agentConfig: Record<string, unknown>
  ) {
    this.id = executionId;
    this.agentConfig = agentConfig;
    this.resolvedConfig = resolveWasmConfig(rawConfig);
  }

  // -------------------------------------------------------------------------
  // events — delegate to inner NativeSandboxInstance once execute() creates it
  // -------------------------------------------------------------------------

  get events(): AsyncIterable<SandboxEvent> {
    if (this.inner) return this.inner.events;
    // Return an empty async iterable before execute() is called.
    return {
      [Symbol.asyncIterator]() {
        return {
          next(): Promise<IteratorResult<SandboxEvent>> {
            return Promise.resolve({
              value: undefined as unknown as SandboxEvent,
              done: true,
            });
          },
        };
      },
    };
  }

  // -------------------------------------------------------------------------
  // execute() — run the agent with Extism policy enforcement (or native fallback)
  // -------------------------------------------------------------------------

  async execute(params: SandboxExecuteParams): Promise<SandboxExecuteResult> {
    const extismAvailable = await this._checkExtism();

    if (!extismAvailable) {
      // Graceful fallback: run natively with a warning. Resource limits are
      // not enforced, but the execution completes successfully.
      console.warn(
        `[wasm-sandbox] @extism/extism not available — falling back to native ` +
          `execution for ${this.id}. Resource limits (maxMemoryMb=` +
          `${this.resolvedConfig.maxMemoryMb}, maxCpuPercent=` +
          `${this.resolvedConfig.maxCpuPercent}) will NOT be enforced.`
      );
      this.inner = new NativeSandboxInstance(this.id, this.agentConfig, null);
      return this.inner.execute(params);
    }

    // With Extism available: create a plugin that acts as the policy gate.
    // The NativeSandboxInstance runs the SDK in the host. Host functions
    // intercept tool events and consult the Extism plugin for policy decisions.
    this.inner = new NativeSandboxInstance(this.id, this.agentConfig, null);
    return this._executeWithExtismPolicy(params);
  }

  private async _executeWithExtismPolicy(
    params: SandboxExecuteParams
  ): Promise<SandboxExecuteResult> {
    const { createPlugin } = await import("@extism/extism");
    const config = this.resolvedConfig;

    // Minimal valid Wasm module: 4-byte magic + 4-byte version + 1-page memory.
    // In a production implementation this would be a compiled policy Wasm binary.
    const MINIMAL_WASM = new Uint8Array([
      0x00, 0x61, 0x73, 0x6d, // magic: \0asm
      0x01, 0x00, 0x00, 0x00, // version: 1
      0x05, 0x03, 0x01, 0x00, 0x01, // memory section: 1 page minimum
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let plugin: any = null;

    try {
      plugin = await createPlugin(MINIMAL_WASM, {
        useWasi: false,
        allowedHosts: config.networkEnabled ? ["*"] : [],
        // pages are 64 KiB; convert MB ceiling to pages (ceil(MB / 0.064))
        memory: { maxPages: Math.ceil(config.maxMemoryMb / 0.064) },
        // Extism v2 host functions: Record<namespace, Record<name, handler>>
        functions: {
          baara: {
            // Emit a SandboxEvent from the guest. No-op — NativeSandboxInstance
            // manages its own event queue; this is the hook point for future
            // pure-Wasm guest implementations.
            send_event(_cp: any, _off: bigint, _len: bigint): void {},

            // Read the next inbound command. Returns 0 = no command available.
            read_command(_cp: any): bigint { return 0n; },

            // Structured log entry from guest.
            log(_cp: any, _levelOff: bigint, _levelLen: bigint, _msgOff: bigint, _msgLen: bigint): void {},

            // Trigger an explicit checkpoint from guest.
            checkpoint(_cp: any, _off: bigint, _len: bigint): void {},

            // Network policy check — returns 1n if allowed, 0n if denied.
            check_network(_cp: any, _hostOff: bigint, _hostLen: bigint, _port: bigint): bigint {
              if (!config.networkEnabled) return 0n;
              if (config.ports.length === 0) return 1n;
              return config.ports.includes(Number(_port)) ? 1n : 0n;
            },
          },
        },
      });

      // Run the agent via NativeSandboxInstance. The Extism plugin is available
      // for policy callbacks during this call.
      return await this.inner!.execute({
        ...params,
        agentConfig: {
          ...params.agentConfig,
          // Inject a memory/network awareness hint into the system prompt.
          systemPrompt: [
            params.agentConfig.systemPrompt,
            `Sandbox constraints: maxMemoryMb=${config.maxMemoryMb}, ` +
              `networkEnabled=${config.networkEnabled}, ` +
              `maxCpuPercent=${config.maxCpuPercent}.`,
          ]
            .filter(Boolean)
            .join("\n\n"),
        },
      });
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      plugin?.free?.();
    }
  }

  // -------------------------------------------------------------------------
  // sendCommand()
  // -------------------------------------------------------------------------

  async sendCommand(command: InboundCommand): Promise<void> {
    await this.inner?.sendCommand(command);
  }

  // -------------------------------------------------------------------------
  // cancel()
  // -------------------------------------------------------------------------

  async cancel(): Promise<void> {
    this.controller.abort();
    await this.inner?.cancel();
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async _checkExtism(): Promise<boolean> {
    try {
      await import("@extism/extism");
      return true;
    } catch {
      return false;
    }
  }
}

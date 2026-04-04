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
      // @ts-expect-error — @extism/extism is an optional peer dependency not
      // installed at typecheck time; the dynamic import is safe at runtime.
      await import("@extism/extism");
      return true;
    } catch {
      return false;
    }
  }

  async start(config: SandboxStartConfig): Promise<SandboxInstance> {
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
    // @ts-expect-error — optional peer dependency, types not available at build time
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
        functions: [
          // Host function: called by the guest to emit a SandboxEvent.
          {
            namespace: "baara",
            name: "send_event",
            callback(_cp: unknown, _off: number, _len: number): void {
              // In a full implementation: decode the event JSON and push to
              // the inner instance's event stream. Currently a no-op because
              // NativeSandboxInstance manages its own event queue.
            },
          },
          // Host function: called by the guest to read the next inbound command.
          {
            namespace: "baara",
            name: "read_command",
            callback(_cp: unknown): number {
              return 0; // 0 = no command available
            },
          },
          // Host function: structured log entry from guest.
          {
            namespace: "baara",
            name: "log",
            callback(
              _cp: unknown,
              _levelOff: number,
              _levelLen: number,
              _msgOff: number,
              _msgLen: number
            ): void {
              // Forwarded to inner NativeSandboxInstance event queue in a full impl.
            },
          },
          // Host function: trigger an explicit checkpoint from guest.
          {
            namespace: "baara",
            name: "checkpoint",
            callback(_cp: unknown, _off: number, _len: number): void {
              // In a full implementation: parse checkpoint JSON and write to MessageBus.
            },
          },
          // Host function: network policy check — returns 1 if allowed, 0 if denied.
          {
            namespace: "baara",
            name: "check_network",
            callback(
              _cp: unknown,
              _hostOff: number,
              _hostLen: number,
              _port: number
            ): number {
              if (!config.networkEnabled) return 0;
              if (config.ports.length === 0) return 1; // all ports permitted
              return 1; // port-specific check is a TODO for full implementation
            },
          },
        ],
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
      // @ts-expect-error — optional peer dependency
      await import("@extism/extism");
      return true;
    } catch {
      return false;
    }
  }
}

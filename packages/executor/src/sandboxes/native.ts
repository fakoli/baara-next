// @baara-next/executor/sandboxes — NativeSandbox
//
// Runs the Claude Code SDK agent directly in the host process with no
// isolation boundary. Equivalent to the old CloudCodeRuntime but wrapped in
// ISandbox. Integrates CheckpointService and MessageBus for durability.

import type {
  ISandbox,
  SandboxInstance,
  SandboxStartConfig,
  SandboxExecuteParams,
  SandboxExecuteResult,
  SandboxEvent,
  InboundCommand,
  IMessageBus,
  ConversationMessage,
} from "@baara-next/core";
import { CheckpointService } from "../checkpoint-service.ts";
import { buildRecoveryPrompt } from "../recovery.ts";

const DEFAULT_MODEL = "claude-sonnet-4-20250514";
const COMMAND_POLL_MS = 2_000;

// ---------------------------------------------------------------------------
// NativeSandbox
// ---------------------------------------------------------------------------

export class NativeSandbox implements ISandbox {
  readonly name = "native" as const;
  readonly description = "Direct execution in the host process (no isolation)";

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async start(config: SandboxStartConfig): Promise<SandboxInstance> {
    return new NativeSandboxInstance(
      config.executionId,
      config.agentConfig as Record<string, unknown>,
      null // MessageBus injected externally via withMessageBus()
    );
  }

  async stop(instance: SandboxInstance): Promise<void> {
    await instance.cancel();
  }
}

// ---------------------------------------------------------------------------
// NativeSandboxInstance
// ---------------------------------------------------------------------------

export class NativeSandboxInstance implements SandboxInstance {
  readonly id: string;
  readonly sandboxType = "native" as const;

  private readonly controller = new AbortController();
  private readonly agentConfig: Record<string, unknown>;
  private messageBus: IMessageBus | null;

  // Event queue — execute() pushes, events iterator pops.
  private readonly eventQueue: SandboxEvent[] = [];
  private readonly eventResolvers: Array<(value: IteratorResult<SandboxEvent>) => void> = [];
  private done = false;

  // Conversation history accumulated during execute() for checkpointing.
  private conversationHistory: ConversationMessage[] = [];

  // Command poll interval handle.
  private commandPollHandle: ReturnType<typeof setInterval> | null = null;

  // Additional prompts queued by inbound "command" messages for the next SDK turn.
  private _pendingPrompts: string[] = [];

  // Pause flag — when true the execute loop delays before proceeding.
  private _paused = false;

  constructor(
    executionId: string,
    agentConfig: Record<string, unknown>,
    messageBus: IMessageBus | null
  ) {
    this.id = executionId;
    this.agentConfig = agentConfig;
    this.messageBus = messageBus;
  }

  /** Inject a MessageBus after construction (wired by OrchestratorService). */
  withMessageBus(bus: IMessageBus): this {
    this.messageBus = bus;
    return this;
  }

  // -------------------------------------------------------------------------
  // SandboxInstance.events — async iterable (push/pull queue pattern)
  // -------------------------------------------------------------------------

  get events(): AsyncIterable<SandboxEvent> {
    const self = this;
    return {
      [Symbol.asyncIterator](): AsyncIterator<SandboxEvent> {
        return {
          next(): Promise<IteratorResult<SandboxEvent>> {
            // If there is already a queued event, return it immediately.
            if (self.eventQueue.length > 0) {
              return Promise.resolve({
                value: self.eventQueue.shift()!,
                done: false,
              });
            }
            // If execute() has finished, signal end of stream.
            if (self.done) {
              return Promise.resolve({
                value: undefined as unknown as SandboxEvent,
                done: true,
              });
            }
            // Block until an event arrives or execute() finishes.
            return new Promise<IteratorResult<SandboxEvent>>((resolve) => {
              self.eventResolvers.push(resolve);
            });
          },
        };
      },
    };
  }

  private pushEvent(event: SandboxEvent): void {
    if (this.eventResolvers.length > 0) {
      const resolve = this.eventResolvers.shift()!;
      resolve({ value: event, done: false });
    } else {
      this.eventQueue.push(event);
    }
  }

  private closeEvents(): void {
    this.done = true;
    for (const resolve of this.eventResolvers) {
      resolve({ value: undefined as unknown as SandboxEvent, done: true });
    }
    this.eventResolvers.length = 0;
  }

  // -------------------------------------------------------------------------
  // SandboxInstance.execute()
  // -------------------------------------------------------------------------

  async execute(params: SandboxExecuteParams): Promise<SandboxExecuteResult> {
    const start = Date.now();
    const { executionId, prompt, timeout } = params;
    const agentCfg = { ...this.agentConfig, ...params.agentConfig };

    // Set up abort-on-timeout.
    const killTimer = setTimeout(() => this.controller.abort(), timeout);

    // Build checkpoint service for periodic snapshots.
    const checkpointService = new CheckpointService({
      executionId,
      messageBus: this.messageBus ?? this._noopBus(),
      intervalTurns: 5,
      getConversationHistory: () => [...this.conversationHistory],
    });

    // Start inbound command polling if MessageBus is available.
    if (this.messageBus) {
      const bus = this.messageBus;
      this.commandPollHandle = setInterval(() => {
        const pending = bus.readPendingCommands(executionId);
        const ids = pending.map((p) => p.id);
        for (const cmd of pending) {
          this.pushEvent({
            type: "log",
            level: "info",
            message: `[command] received: ${cmd.command.type}`,
            timestamp: new Date().toISOString(),
          });
          switch (cmd.command.type) {
            case "command":
              // Queue the additional prompt for the next SDK turn.
              this._pendingPrompts.push(cmd.command.prompt);
              break;
            case "hitl_response":
              // Handled by the HITL flow separately (via provideInput).
              break;
            case "pause":
              this._paused = true;
              break;
            case "resume":
              this._paused = false;
              break;
          }
        }
        if (ids.length > 0) {
          bus.acknowledgeCommands(ids);
        }
      }, COMMAND_POLL_MS);
    }

    // Inject prior conversation history if recovering from checkpoint.
    if (params.checkpoint?.conversationHistory) {
      this.conversationHistory = [...params.checkpoint.conversationHistory];
    }

    // Build the recovery system prompt prefix.
    const recoveryPrefix = buildRecoveryPrompt(params.checkpoint ?? null);
    const systemPrompt = recoveryPrefix
      ? recoveryPrefix +
        (agentCfg.systemPrompt ? `\n\n${agentCfg.systemPrompt as string}` : "")
      : (agentCfg.systemPrompt as string | undefined);

    let output = "";
    let inputTokens = 0;
    let outputTokens = 0;
    let turnCount = 0;

    try {
      const { query } = await import("@anthropic-ai/claude-agent-sdk");

      const options: Record<string, unknown> = {
        allowedTools: agentCfg.allowedTools,
        permissionMode: agentCfg.permissionMode ?? "default",
        abortSignal: this.controller.signal,
        model: agentCfg.model ?? DEFAULT_MODEL,
      };

      if (systemPrompt) options["systemPrompt"] = systemPrompt;
      if (agentCfg.maxTurns !== undefined) options["maxTurns"] = agentCfg.maxTurns;
      if (agentCfg.budgetUsd !== undefined) options["maxBudgetUsd"] = agentCfg.budgetUsd;
      if (agentCfg.mcpServers !== undefined) options["mcpServers"] = agentCfg.mcpServers;

      // Inject prior conversation history for recovery.
      if (params.checkpoint?.conversationHistory?.length) {
        options["messages"] = params.checkpoint.conversationHistory;
      }

      this.pushEvent({
        type: "log",
        level: "info",
        message:
          `Starting execution ${executionId}` +
          (params.checkpoint
            ? ` (recovery from turn ${params.checkpoint.turnCount})`
            : ""),
        timestamp: new Date().toISOString(),
      });

      for await (const message of query({
        prompt,
        options: options as Parameters<typeof query>[0]["options"],
      })) {
        if (this.controller.signal.aborted) break;

        // When paused, spin-wait (checking abort every 500ms) before processing
        // the next SDK message.
        while (this._paused && !this.controller.signal.aborted) {
          await new Promise<void>((resolve) => setTimeout(resolve, 500));
        }
        if (this.controller.signal.aborted) break;

        // Accumulate text deltas.
        if (
          "type" in message &&
          (message as { type: string }).type === "text" &&
          typeof (message as unknown as { text?: unknown }).text === "string"
        ) {
          const text = (message as unknown as { text: string }).text;
          this.pushEvent({ type: "text_delta", delta: text });
          this.conversationHistory.push({ role: "assistant", content: text });
        }

        // Tool use events.
        if (
          "type" in message &&
          (message as { type: string }).type === "tool_use"
        ) {
          const m = message as unknown as { name: string; input: unknown };
          this.pushEvent({ type: "tool_use", name: m.name, input: m.input });
          this.pushEvent({
            type: "log",
            level: "info",
            message: `[tool] ${m.name}: ${JSON.stringify(m.input).slice(0, 200)}`,
            timestamp: new Date().toISOString(),
          });
        }

        // Tool result events.
        if (
          "type" in message &&
          (message as { type: string }).type === "tool_result"
        ) {
          const m = message as {
            name?: string;
            output: unknown;
            isError?: boolean;
          };
          this.pushEvent({
            type: "tool_result",
            name: m.name ?? "unknown",
            output: m.output,
            isError: m.isError ?? false,
          });
        }

        // Capture result output.
        if ("result" in message && typeof (message as { result?: unknown }).result === "string") {
          output = (message as { result: string }).result;
        }

        // Accumulate token usage from assistant turn messages.
        if (
          "message" in message &&
          (message as { message?: unknown }).message !== null &&
          typeof (message as { message?: unknown }).message === "object" &&
          "usage" in ((message as unknown as { message: object }).message)
        ) {
          const u = ((message as unknown as { message: Record<string, unknown> }).message)[
            "usage"
          ] as Record<string, number> | undefined;
          if (u) {
            inputTokens += u["input_tokens"] ?? 0;
            outputTokens += u["output_tokens"] ?? 0;
          }
        }

        // Turn complete signal.
        if (
          "type" in message &&
          (message as { type: string }).type === "turn_complete"
        ) {
          turnCount++;
          this.pushEvent({
            type: "turn_complete",
            turnCount,
            inputTokens,
            outputTokens,
          });
          checkpointService.onTurnComplete(turnCount);
        }

        // Top-level usage override.
        if (
          "usage" in message &&
          (message as { usage?: unknown }).usage !== null &&
          typeof (message as { usage?: unknown }).usage === "object"
        ) {
          const u = (message as { usage: Record<string, number> }).usage;
          if (u["input_tokens"] !== undefined) inputTokens = u["input_tokens"];
          if (u["output_tokens"] !== undefined) outputTokens = u["output_tokens"];
        }
      }

      clearTimeout(killTimer);
      if (this.commandPollHandle) {
        clearInterval(this.commandPollHandle);
        this.commandPollHandle = null;
      }

      // Final checkpoint on clean completion.
      checkpointService.checkpoint(turnCount);

      const durationMs = Date.now() - start;
      this.pushEvent({
        type: "log",
        level: "info",
        message: `Execution ${executionId} completed in ${durationMs}ms (${turnCount} turns)`,
        timestamp: new Date().toISOString(),
      });

      this.closeEvents();
      return { status: "completed", output, inputTokens, outputTokens, durationMs };
    } catch (err) {
      clearTimeout(killTimer);
      if (this.commandPollHandle) {
        clearInterval(this.commandPollHandle);
        this.commandPollHandle = null;
      }
      this.closeEvents();

      const durationMs = Date.now() - start;

      if (this.controller.signal.aborted) {
        return {
          status: "timed_out",
          error: `Exceeded timeout of ${timeout}ms`,
          durationMs,
        };
      }

      const errorMsg = err instanceof Error ? err.message : String(err);
      this.pushEvent({
        type: "log",
        level: "error",
        message: `Execution ${executionId} failed: ${errorMsg}`,
        timestamp: new Date().toISOString(),
      });
      return { status: "failed", error: errorMsg, durationMs };
    }
  }

  // -------------------------------------------------------------------------
  // SandboxInstance.sendCommand()
  // -------------------------------------------------------------------------

  async sendCommand(command: InboundCommand): Promise<void> {
    if (this.messageBus) {
      this.messageBus.sendCommand(this.id, command);
    }
    // If no bus, the command is dropped — acceptable for native sandbox without
    // a durable store wired in.
  }

  // -------------------------------------------------------------------------
  // SandboxInstance.cancel()
  // -------------------------------------------------------------------------

  async cancel(): Promise<void> {
    if (this.commandPollHandle) {
      clearInterval(this.commandPollHandle);
      this.commandPollHandle = null;
    }
    this.controller.abort();
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /** No-op IMessageBus for when durability is not wired in. */
  private _noopBus(): IMessageBus {
    return {
      sendCommand: () => {},
      readPendingCommands: () => [],
      acknowledgeCommands: () => {},
      writeCheckpoint: () => {},
      readLatestCheckpoint: () => null,
      appendLog: () => {},
    };
  }
}

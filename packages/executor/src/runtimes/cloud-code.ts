// @baara-next/executor — CloudCode runtime (Claude Agent SDK)
//
// Runs tasks using `query()` from `@anthropic-ai/claude-agent-sdk`.
// Ported from BAARA v1's `executeAgentSdk()`.

import type {
  IRuntime,
  RuntimeCapability,
  RuntimeConfig,
  ExecuteParams,
  ExecuteResult,
} from "@baara-next/core";

const DEFAULT_MODEL = "claude-sonnet-4-20250514";

export class CloudCodeRuntime implements IRuntime {
  readonly name = "cloud_code";
  readonly capabilities: readonly RuntimeCapability[] = ["llm", "network"];

  // Map from executionId → AbortController so cancel() can abort the stream.
  private readonly controllers = new Map<string, AbortController>();

  async initialize(_config: RuntimeConfig): Promise<void> {
    // No-op — the Agent SDK reads ANTHROPIC_API_KEY from the environment.
  }

  async execute(params: ExecuteParams): Promise<ExecuteResult> {
    const start = Date.now();
    const { executionId, task, timeout } = params;
    const agentConfig = task.agentConfig ?? {};

    const controller = new AbortController();
    this.controllers.set(executionId, controller);

    const killTimer = setTimeout(() => controller.abort(), timeout);

    let output = "";
    let inputTokens = 0;
    let outputTokens = 0;

    try {
      // Dynamic import keeps the SDK out of the module graph when not used.
      const { query } = await import("@anthropic-ai/claude-agent-sdk");

      const options: Record<string, unknown> = {
        allowedTools: agentConfig.allowedTools,
        permissionMode: agentConfig.permissionMode ?? "default",
        abortSignal: controller.signal,
      };

      const model = agentConfig.model ?? DEFAULT_MODEL;
      options["model"] = model;

      if (agentConfig.maxTurns !== undefined) {
        options["maxTurns"] = agentConfig.maxTurns;
      }
      if (agentConfig.budgetUsd !== undefined) {
        options["maxBudgetUsd"] = agentConfig.budgetUsd;
      }
      if (agentConfig.mcpServers !== undefined) {
        options["mcpServers"] = agentConfig.mcpServers;
      }

      // Propagate working directory from the task if available.
      const taskAny = task as unknown as { workingDirectory?: string };
      if (taskAny.workingDirectory) {
        options["cwd"] = taskAny.workingDirectory;
      }

      for await (const message of query({
        prompt: task.prompt,
        options: options as Parameters<typeof query>[0]["options"],
      })) {
        if (controller.signal.aborted) break;

        // Capture the text result from the SDK's result message.
        if ("result" in message && typeof message.result === "string") {
          output = message.result;
        }

        // Accumulate token usage from assistant turn messages.
        if (
          "message" in message &&
          message.message !== null &&
          typeof message.message === "object" &&
          "usage" in message.message
        ) {
          const usage = (message.message as unknown as Record<string, unknown>)["usage"];
          if (usage && typeof usage === "object") {
            const u = usage as Record<string, number>;
            inputTokens += u["input_tokens"] ?? 0;
            outputTokens += u["output_tokens"] ?? 0;
          }
        }

        // Top-level usage field on result messages overrides accumulated totals.
        if (
          "usage" in message &&
          message.usage !== null &&
          typeof message.usage === "object"
        ) {
          const u = message.usage as Record<string, number>;
          if (u["input_tokens"] !== undefined) inputTokens = u["input_tokens"];
          if (u["output_tokens"] !== undefined) outputTokens = u["output_tokens"];
        }
      }

      clearTimeout(killTimer);
      const durationMs = Date.now() - start;

      return {
        status: "completed",
        output,
        inputTokens,
        outputTokens,
        durationMs,
      };
    } catch (err) {
      clearTimeout(killTimer);
      const durationMs = Date.now() - start;

      if (controller.signal.aborted) {
        return {
          status: "timed_out",
          error: `Exceeded timeout of ${timeout}ms`,
          durationMs,
        };
      }

      return {
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
        durationMs,
      };
    } finally {
      this.controllers.delete(executionId);
    }
  }

  async cancel(executionId: string): Promise<void> {
    this.controllers.get(executionId)?.abort();
  }

  async healthCheck(): Promise<{ status: "healthy" }> {
    return { status: "healthy" };
  }

  async shutdown(): Promise<void> {
    // Abort all in-flight streams.
    for (const controller of this.controllers.values()) {
      controller.abort();
    }
    this.controllers.clear();
  }
}

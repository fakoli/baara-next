// @baara-next/executor — Recovery utilities
//
// Builds the recovery system prompt and assembles SandboxExecuteParams for
// resumed executions. Called by OrchestratorService.recoverExecution() after
// a crash is detected and a latest checkpoint has been loaded.

import type { Checkpoint, AgentConfig } from "@baara-next/core";

// ---------------------------------------------------------------------------
// SandboxExecuteParams (local shape — matches ISandbox spec)
// ---------------------------------------------------------------------------

export interface SandboxExecuteParams {
  executionId: string;
  prompt: string;
  tools: string[];
  agentConfig: AgentConfig;
  checkpoint?: Checkpoint | null;
  environment?: Record<string, string>;
  timeout: number;
}

// ---------------------------------------------------------------------------
// buildRecoveryPrompt
// ---------------------------------------------------------------------------

/**
 * Generate the recovery context block to prepend to the system prompt.
 *
 * Returns an empty string when `checkpoint` is null (no prior state available).
 * The caller is responsible for prepending this to any existing system prompt.
 */
export function buildRecoveryPrompt(checkpoint: Checkpoint | null): string {
  if (!checkpoint) return "";

  const pendingStr =
    checkpoint.pendingToolCalls.length > 0
      ? `In-flight tool calls at checkpoint time: ${checkpoint.pendingToolCalls.join(", ")}.`
      : "No tool calls were in flight at checkpoint time.";

  const lastUserMsg = [...checkpoint.conversationHistory]
    .reverse()
    .find((m) => m.role === "user");
  const lastContext =
    typeof lastUserMsg?.content === "string"
      ? `The last user instruction was: "${lastUserMsg.content.slice(0, 200)}"`
      : "";

  return [
    "RECOVERY CONTEXT: This is a resumed execution. You were previously working on this",
    `task and completed ${checkpoint.turnCount} turns before the session was interrupted.`,
    "",
    pendingStr,
    lastContext,
    "",
    "Please check the current state and continue from where you left off. Do not repeat",
    "work that has already been completed — verify the current state first, then proceed.",
    "---",
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}

// ---------------------------------------------------------------------------
// prepareRecoveryParams
// ---------------------------------------------------------------------------

/**
 * Build the full `SandboxExecuteParams` for a recovered execution.
 *
 * - Injects the prior `conversationHistory` via the `checkpoint` field so the
 *   SDK receives it as message history (implementation in NativeSandboxInstance).
 * - Prepends the recovery system prompt to any existing `agentConfig.systemPrompt`.
 * - All other params are passed through unchanged.
 */
export function prepareRecoveryParams(
  checkpoint: Checkpoint,
  base: SandboxExecuteParams
): SandboxExecuteParams {
  const recoveryPrefix = buildRecoveryPrompt(checkpoint);

  const existingSystemPrompt = base.agentConfig.systemPrompt ?? "";
  const newSystemPrompt = existingSystemPrompt
    ? `${recoveryPrefix}\n\n${existingSystemPrompt}`
    : recoveryPrefix;

  return {
    ...base,
    checkpoint,
    agentConfig: {
      ...base.agentConfig,
      systemPrompt: newSystemPrompt,
    },
  };
}

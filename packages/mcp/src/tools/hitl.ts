// @baara-next/mcp — Human-in-the-loop tools (2 tools)
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { IStore, IOrchestratorService } from "@baara-next/core";
import { ok, err } from "../helpers.ts";

export function createHitlTools(deps: {
  store: IStore;
  orchestrator: IOrchestratorService;
}) {
  const { store, orchestrator } = deps;

  // 1. list_pending_input — executions waiting for human operator input
  const listPendingInput = tool(
    "list_pending_input",
    "List all executions currently paused and waiting for human input",
    {},
    async () => {
      const executions = store.getPendingInputExecutions();
      if (executions.length === 0) {
        return ok({ message: "No executions are waiting for input.", pending: [] });
      }
      const results = executions.map((e) => {
        const request = store.getInputRequest(e.id);
        return {
          executionId: e.id,
          taskId: e.taskId,
          attempt: e.attempt,
          turnCount: e.turnCount,
          prompt: request?.prompt ?? null,
          options: request?.options ?? null,
          context: request?.context ?? null,
          requestedAt: request?.createdAt ?? null,
          timeoutMs: request?.timeoutMs ?? null,
        };
      });
      return ok(results);
    }
  );

  // 2. provide_input — deliver a response to a blocked execution
  const provideInput = tool(
    "provide_input",
    "Provide a response to an execution that is waiting for human input",
    {
      executionId: z.string().describe("Execution UUID currently in waiting_for_input status"),
      response: z.string().describe("The response to deliver to the execution"),
    },
    async ({ executionId, response }) => {
      try {
        await orchestrator.provideInput(executionId, response);
        return ok({ delivered: true, executionId, response });
      } catch (e) {
        return err(`Failed to provide input: ${String(e)}`);
      }
    }
  );

  return [listPendingInput, provideInput];
}

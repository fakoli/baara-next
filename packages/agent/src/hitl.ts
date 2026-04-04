// @baara-next/agent — Human-in-the-loop input helper
//
// Thin wrapper around `ITransport.requestInput` that surfaces a typed error
// when the transport signals that the input window has timed out.

import { InputTimeoutError } from "@baara-next/core";
import type { ITransport } from "@baara-next/core";

/**
 * Block until the operator provides a response for `executionId`.
 *
 * The transport is responsible for creating the `InputRequest` record,
 * transitioning the execution to `waiting_for_input`, and polling or
 * subscribing for the operator's answer.
 *
 * @param transport   - Transport used to deliver the request.
 * @param executionId - The execution that is waiting for input.
 * @param prompt      - Question or instruction shown to the operator.
 * @param options     - Optional list of suggested reply choices.
 * @returns           The operator's response string.
 * @throws            `InputTimeoutError` when the request expires before a
 *                    response is received.
 */
export async function requestInput(
  transport: ITransport,
  executionId: string,
  prompt: string,
  options?: string[],
): Promise<string> {
  try {
    return await transport.requestInput(executionId, prompt, options);
  } catch (err) {
    // Re-surface timeout signals as the canonical BAARA error type so callers
    // can pattern-match without inspecting raw strings.
    if (err instanceof InputTimeoutError) throw err;

    // The transport may signal a timeout via a plain Error with a message
    // containing "timed_out" or "timeout".  Normalise that here.
    if (
      err instanceof Error &&
      (err.message.includes("timed_out") || err.message.includes("timeout"))
    ) {
      throw new InputTimeoutError(
        "unknown",      // inputRequestId not available at this layer
        executionId,
        0,              // timeoutMs not available here either
      );
    }

    throw err;
  }
}

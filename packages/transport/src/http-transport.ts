// @baara-next/transport — HttpTransport
//
// Production transport: delegates every ITransport method to the orchestrator's
// internal REST endpoints via fetch.  The "internal" endpoints are not exposed
// to end-users — they are accessed only from agent processes.
//
// Long-poll design:
//   - pollTask uses a 30-second AbortSignal timeout.  The orchestrator may
//     hold the connection open while no work is queued (long-poll semantics),
//     OR it may respond immediately with null; both are valid.
//   - requestInput long-polls for a response with a 5-minute timeout to
//     accommodate operators who may take several minutes to respond.

import type { RuntimeCapability } from "@baara-next/core";
import type { ITransport, TaskAssignment, ExecuteResult } from "@baara-next/core";

// ---------------------------------------------------------------------------
// HttpTransport
// ---------------------------------------------------------------------------

/**
 * HTTP transport for production / multi-process deployments.
 *
 * Each agent runs in its own process and communicates with the orchestrator
 * via a lightweight REST API on `/internal/*`.
 */
export class HttpTransport implements ITransport {
  private readonly baseUrl: string;

  /**
   * @param baseUrl - Base URL of the orchestrator HTTP server.
   *   Example: "http://localhost:3000"
   *   The transport appends `/internal/*` paths to this value.
   */
  constructor(baseUrl: string) {
    // Strip trailing slash for clean URL construction.
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  // ---------------------------------------------------------------------------
  // ITransport implementation
  // ---------------------------------------------------------------------------

  /**
   * Ask the orchestrator for the next available execution.
   *
   * Uses a 30-second AbortSignal so the connection does not hang indefinitely
   * when the server is busy or the poll is slow.
   */
  async pollTask(
    agentId: string,
    capabilities: RuntimeCapability[]
  ): Promise<TaskAssignment | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    try {
      const res = await fetch(`${this.baseUrl}/internal/poll`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId, capabilities }),
        signal: controller.signal,
      });

      if (res.status === 204) return null;  // No content — no work available.
      if (!res.ok) throw new Error(`pollTask HTTP ${res.status}: ${await res.text()}`);

      const body = (await res.json()) as { assignment: TaskAssignment | null };
      return body.assignment ?? null;
    } catch (err) {
      // AbortError means the 30s timeout fired — no assignment available.
      if (err instanceof Error && err.name === "AbortError") return null;
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Notify the orchestrator that the agent is starting execution.
   *
   * Transitions the execution from `assigned` to `running` and sets `startedAt`.
   */
  async startExecution(executionId: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/internal/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ executionId }),
    });

    if (!res.ok) {
      throw new Error(`startExecution HTTP ${res.status}: ${await res.text()}`);
    }
  }

  /**
   * Report the final result of an execution to the orchestrator.
   */
  async completeExecution(
    executionId: string,
    result: ExecuteResult
  ): Promise<void> {
    const res = await fetch(`${this.baseUrl}/internal/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ executionId, result }),
    });

    if (!res.ok) {
      throw new Error(`completeExecution HTTP ${res.status}: ${await res.text()}`);
    }
  }

  /**
   * Request operator input and long-poll for the response.
   *
   * Phase 1: POST to `/internal/input-request` — creates the InputRequest
   *   record and transitions the execution to `waiting_for_input`.
   * Phase 2: POST to `/internal/input-poll` — long-polls until the operator
   *   responds (or the 5-minute timeout fires).
   */
  async requestInput(
    executionId: string,
    prompt: string,
    options?: string[]
  ): Promise<string> {
    // Phase 1 — create the input request.
    const createRes = await fetch(`${this.baseUrl}/internal/input-request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ executionId, prompt, options }),
    });

    if (!createRes.ok) {
      throw new Error(
        `requestInput (create) HTTP ${createRes.status}: ${await createRes.text()}`
      );
    }

    const { inputRequestId } = (await createRes.json()) as { inputRequestId: string };

    // Phase 2 — long-poll for the operator's response.
    const POLL_TIMEOUT_MS = 5 * 60 * 1_000; // 5 minutes
    const POLL_INTERVAL_MS = 2_000;
    const deadline = Date.now() + POLL_TIMEOUT_MS;

    while (Date.now() < deadline) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);

      try {
        const pollRes = await fetch(`${this.baseUrl}/internal/input-poll`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ executionId, inputRequestId }),
          signal: controller.signal,
        });

        if (!pollRes.ok) {
          throw new Error(
            `requestInput (poll) HTTP ${pollRes.status}: ${await pollRes.text()}`
          );
        }

        const body = (await pollRes.json()) as {
          status: "pending" | "responded" | "timed_out";
          response?: string;
        };

        if (body.status === "responded" && body.response !== undefined) {
          return body.response;
        }

        if (body.status === "timed_out") {
          throw new Error(`timed_out: input request ${inputRequestId} expired`);
        }

        // Still pending — wait before the next poll cycle.
        await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          // The 30s fetch timeout fired — just retry the poll.
          continue;
        }
        throw err;
      } finally {
        clearTimeout(timeout);
      }
    }

    throw new Error(`timed_out: input request ${inputRequestId} not answered within ${POLL_TIMEOUT_MS}ms`);
  }

  /**
   * Send a liveness heartbeat to the orchestrator.
   */
  async heartbeat(
    agentId: string,
    executionId: string,
    turnCount: number
  ): Promise<void> {
    const res = await fetch(`${this.baseUrl}/internal/heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId, executionId, turnCount }),
    });

    if (!res.ok) {
      throw new Error(`heartbeat HTTP ${res.status}: ${await res.text()}`);
    }
  }
}

// @baara-next/agent — Heartbeat checkpoint helper
//
// Provides start/stop functions for the periodic liveness signal sent to the
// orchestrator during a long-running execution.  The heartbeat is independent
// of individual turns so the orchestrator's watchdog can distinguish a slow
// execution from a crashed agent.

import type { ITransport } from "@baara-next/core";

export interface HeartbeatHandle {
  /** Start sending heartbeats on a fixed interval. */
  start(): void;
  /** Cancel the interval timer and stop all future heartbeats. */
  stop(): void;
}

/**
 * Create a handle that periodically calls `transport.heartbeat` while an
 * execution is running.
 *
 * The handle is created in a stopped state; call `start()` to begin.
 *
 * @param transport      - Transport used to deliver heartbeat signals.
 * @param agentId        - The ID of the agent sending the signal.
 * @param executionId    - The execution to keep alive.
 * @param getTurnCount   - Callback returning the current turn counter.
 * @param intervalMs     - How often to send a heartbeat (default: 5 000 ms).
 */
export function createHeartbeat(
  transport: ITransport,
  agentId: string,
  executionId: string,
  getTurnCount: () => number,
  intervalMs = 5_000,
): HeartbeatHandle {
  let timer: ReturnType<typeof setInterval> | undefined;

  return {
    start() {
      if (timer !== undefined) return; // idempotent
      timer = setInterval(async () => {
        try {
          await transport.heartbeat(agentId, executionId, getTurnCount());
        } catch {
          // Heartbeat failures must never crash the execution loop.
        }
      }, intervalMs);
    },

    stop() {
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
    },
  };
}

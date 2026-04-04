// @baara-next/server — WebSocket support
//
// Provides a function that returns the Bun.serve WebSocket options object
// and a broadcast helper for pushing events to all connected clients.
//
// WebSocket event types (Phase 5 additions in bold):
//   execution_status_changed  — { type, executionId, status, taskId }
//   queue_depth_changed       — { type, queueName, depth, activeCount }
//   execution_log             — { type, executionId, level, message, timestamp }
//   execution_text_delta      — { type, executionId, delta }
//   execution_tool_event      — { type, executionId, eventType, name, data }

import type { ServerWebSocket } from "bun";
import type { SandboxEvent } from "@baara-next/core";

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export interface ExecutionStatusChangedEvent {
  type: "execution_status_changed";
  executionId: string;
  taskId: string;
  status: string;
  timestamp: string;
}

export interface QueueDepthChangedEvent {
  type: "queue_depth_changed";
  queueName: string;
  depth: number;
  activeCount: number;
  timestamp: string;
}

// Phase 5 new event types:

export interface ExecutionLogEvent {
  type: "execution_log";
  executionId: string;
  level: string;
  message: string;
  timestamp: string;
}

export interface ExecutionTextDeltaEvent {
  type: "execution_text_delta";
  executionId: string;
  delta: string;
}

export interface ExecutionToolEvent {
  type: "execution_tool_event";
  executionId: string;
  eventType: "tool_use" | "tool_result";
  name: string;
  data: unknown;
}

export type WsEvent =
  | ExecutionStatusChangedEvent
  | QueueDepthChangedEvent
  | ExecutionLogEvent
  | ExecutionTextDeltaEvent
  | ExecutionToolEvent;

// ---------------------------------------------------------------------------
// Client tracking
// ---------------------------------------------------------------------------

/** All currently connected WebSocket clients. */
const clients = new Set<ServerWebSocket<unknown>>();

/**
 * Send `event` to all connected WebSocket clients.
 *
 * JSON serialises the event before sending.  Clients that have closed since
 * the last broadcast are silently removed from the tracking set.
 */
export function broadcast(event: WsEvent): void {
  const payload = JSON.stringify(event);
  for (const ws of clients) {
    try {
      ws.send(payload);
    } catch {
      // Client disconnected — remove from set.
      clients.delete(ws);
    }
  }
}

// ---------------------------------------------------------------------------
// sandboxEventToWsEvent — converts SandboxEvent → WsEvent
// ---------------------------------------------------------------------------

/**
 * Convert a SandboxEvent emitted by a sandbox instance to a WebSocket event
 * suitable for broadcasting to web clients.
 *
 * Returns null for event types that are not broadcast to clients (e.g.,
 * checkpoint events — those are internal durability state, not UI-relevant).
 */
export function sandboxEventToWsEvent(
  executionId: string,
  event: SandboxEvent
): WsEvent | null {
  switch (event.type) {
    case "log":
      return {
        type: "execution_log",
        executionId,
        level: event.level,
        message: event.message,
        timestamp: event.timestamp,
      } satisfies ExecutionLogEvent;

    case "text_delta":
      return {
        type: "execution_text_delta",
        executionId,
        delta: event.delta,
      } satisfies ExecutionTextDeltaEvent;

    case "tool_use":
      return {
        type: "execution_tool_event",
        executionId,
        eventType: "tool_use",
        name: event.name,
        data: event.input,
      } satisfies ExecutionToolEvent;

    case "tool_result":
      return {
        type: "execution_tool_event",
        executionId,
        eventType: "tool_result",
        name: event.name,
        data: { output: event.output, isError: event.isError },
      } satisfies ExecutionToolEvent;

    case "turn_complete":
      // Broadcast as a status update so the UI can show turn progress.
      return {
        type: "execution_status_changed",
        executionId,
        taskId: "",
        status: `running:turn_${event.turnCount}`,
        timestamp: new Date().toISOString(),
      } satisfies ExecutionStatusChangedEvent;

    case "checkpoint":
    case "hitl_request":
      // Not broadcast to generic WebSocket clients — handled via dedicated API.
      return null;

    default:
      return null;
  }
}

/**
 * Broadcast all relevant events from a sandbox event stream to connected
 * WebSocket clients. Called by the orchestrator's runDirect/sandbox path.
 */
export function broadcastSandboxEvents(
  executionId: string,
  events: AsyncIterable<SandboxEvent>
): void {
  // Fire-and-forget async loop — errors are logged but not propagated.
  void (async () => {
    try {
      for await (const event of events) {
        const wsEvent = sandboxEventToWsEvent(executionId, event);
        if (wsEvent) broadcast(wsEvent);
      }
    } catch (err) {
      console.error(`[ws] Error streaming events for ${executionId}:`, err);
    }
  })();
}

// ---------------------------------------------------------------------------
// Bun.serve WebSocket option factory
// ---------------------------------------------------------------------------

/**
 * Returns the `websocket` option object for `Bun.serve`.
 *
 * Usage:
 * ```ts
 * Bun.serve({
 *   fetch: app.fetch,
 *   websocket: createWebSocketOptions(),
 *   port: 3000,
 * });
 * ```
 *
 * Clients connect to `ws://host/ws`.  The HTTP upgrade handler should be
 * added to the Hono app separately (see `attachWsUpgrade`).
 */
export function createWebSocketOptions(): Bun.WebSocketHandler<unknown> {
  return {
    open(ws) {
      clients.add(ws);
    },
    close(ws) {
      clients.delete(ws);
    },
    message(_ws, _message) {
      // Server-push only; incoming messages are ignored.
    },
  };
}

/**
 * Returns the number of currently connected WebSocket clients.
 * Useful for health/metrics endpoints.
 */
export function connectedClientCount(): number {
  return clients.size;
}

// @baara-next/server — Public API barrel

export { createApp } from "./app.ts";
export type { AppDeps, CreateAppResult } from "./app.ts";

export {
  broadcast,
  createWebSocketOptions,
  connectedClientCount,
  sandboxEventToWsEvent,
  broadcastSandboxEvents,
} from "./ws.ts";
export type {
  ExecutionStatusChangedEvent,
  QueueDepthChangedEvent,
  ExecutionLogEvent,
  ExecutionTextDeltaEvent,
  ExecutionToolEvent,
  WsEvent,
} from "./ws.ts";

// Re-export route factories for use by integration tests or custom compositions.
export { taskRoutes } from "./routes/tasks.ts";
export { executionRoutes } from "./routes/executions.ts";
export { queueRoutes } from "./routes/queues.ts";
export { systemRoutes } from "./routes/system.ts";
export { chatRoutes } from "./routes/chat.ts";

/**
 * Create a Bun.serve-compatible server object wrapping the Hono app.
 *
 * @param deps    - Application dependencies (orchestrator, store, etc.)
 * @param port    - TCP port to listen on (default: 3000)
 * @param hostname - Hostname to bind to (default: "0.0.0.0")
 */
import { createApp, type AppDeps } from "./app.ts";
import { createWebSocketOptions } from "./ws.ts";

export interface ServerInstance {
  port: number;
  hostname: string;
  fetch: (req: Request) => Response | Promise<Response>;
  websocket: ReturnType<typeof createWebSocketOptions>;
  /** Clear on server shutdown to stop the rate-limiter cleanup interval. */
  rateLimitCleanupHandle: ReturnType<typeof setInterval>;
}

export function createServer(
  deps: AppDeps,
  port = 3000,
  hostname = "0.0.0.0"
): ServerInstance {
  const { app, rateLimitCleanupHandle } = createApp(deps);
  return {
    port,
    hostname,
    fetch: app.fetch,
    websocket: createWebSocketOptions(),
    rateLimitCleanupHandle,
  };
}

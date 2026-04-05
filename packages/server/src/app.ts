// @baara-next/server — Hono Application
//
// Configures middleware (CORS, rate limiting, API key auth) and mounts all
// route groups.  The function returns the configured Hono app; callers are
// responsible for binding it to a port via Bun.serve.

import { Hono } from "hono";
import { cors } from "hono/cors";
import type { IOrchestratorService, IStore } from "@baara-next/core";
import type { DevTransport } from "@baara-next/transport";

import { taskRoutes } from "./routes/tasks.ts";
import { executionRoutes } from "./routes/executions.ts";
import { queueRoutes } from "./routes/queues.ts";
import { systemRoutes } from "./routes/system.ts";
import { chatRoutes } from "./routes/chat.ts";
import { internalRoutes } from "./routes/internal.ts";
import { createMcpHttpApp } from "@baara-next/mcp";

// ---------------------------------------------------------------------------
// AppDeps
// ---------------------------------------------------------------------------

export interface AppDeps {
  orchestrator: IOrchestratorService;
  store: IStore;
  /** Optional: DevTransport reference for HITL input delivery in dev mode. */
  devTransport?: DevTransport;
  /** If set, all /api/* requests must include X-Api-Key or Bearer token. */
  apiKey?: string;
  /** CORS origins to allow (defaults to localhost variants). */
  allowedOrigins?: string[];
  /** Data directory path — forwarded to chat routes for session file storage. */
  dataDir?: string;
  /** Logs directory path — forwarded to execution routes for JSONL log reading. */
  logsDir?: string;
}

// ---------------------------------------------------------------------------
// Rate limiter — simple in-memory per-IP counter (mirrors BAARA v1 design)
// ---------------------------------------------------------------------------

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_MAP_MAX_SIZE = 10_000;

function makeRateLimiter(maxRequests: number = RATE_LIMIT_MAX) {
  const rateLimitMap = new Map<string, { count: number; windowStart: number }>();

  // Periodically remove entries whose window has expired to prevent unbounded
  // memory growth.  The handle is returned so callers can clear it on shutdown.
  const cleanupHandle = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of rateLimitMap) {
      if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
        rateLimitMap.delete(key);
      }
    }
  }, 60_000);

  function checkRateLimit(ip: string): boolean {
    // If the map exceeds the size cap, evict the oldest 10% of entries
    // (Map preserves insertion order) rather than clearing everything at once.
    if (rateLimitMap.size >= RATE_LIMIT_MAP_MAX_SIZE) {
      const deleteCount = Math.ceil(rateLimitMap.size * 0.1);
      let i = 0;
      for (const key of rateLimitMap.keys()) {
        if (i++ >= deleteCount) break;
        rateLimitMap.delete(key);
      }
    }
    const now = Date.now();
    const entry = rateLimitMap.get(ip);
    if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
      rateLimitMap.set(ip, { count: 1, windowStart: now });
      return true;
    }
    entry.count++;
    return entry.count <= maxRequests;
  }

  function middleware() {
    return async function (c: Parameters<Parameters<Hono["use"]>[1]>[0], next: () => Promise<void>) {
      // Prefer x-real-ip (set by a trusted reverse proxy) over x-forwarded-for
      // (trivially spoofable by the client).  Fall back to the raw socket address
      // when neither header is present.
      // Allow tests to disable rate limiting entirely.
      if (process.env["BAARA_DISABLE_RATE_LIMIT"] === "true") {
        await next();
        return;
      }
      const ip = c.req.header("x-real-ip")
        || (c.env as Record<string, unknown>)?.["ip"] as string | undefined
        || c.req.header("x-forwarded-for")?.split(",")[0]?.trim()
        || "unknown";
      if (!checkRateLimit(ip)) {
        return c.json({ error: `Rate limit exceeded. Max ${maxRequests} requests per minute.` }, 429);
      }
      await next();
    };
  }

  return { middleware, cleanupHandle };
}

// ---------------------------------------------------------------------------
// createApp
// ---------------------------------------------------------------------------

export interface CreateAppResult {
  app: Hono;
  /** Clear this interval handle on server shutdown to prevent timer leaks. */
  rateLimitCleanupHandle: ReturnType<typeof setInterval>;
}

export function createApp(deps: AppDeps): CreateAppResult {
  const app = new Hono();

  // Rate limiter — constructed per createApp call to avoid shared module state.
  const { middleware: rateLimitMiddleware, cleanupHandle: rateLimitCleanupHandle } = makeRateLimiter();

  // Default allowed origins (development + local access).
  const allowedOrigins = new Set(
    deps.allowedOrigins ?? [
      "http://localhost:3000",
      "http://127.0.0.1:3000",
    ]
  );

  // Security headers on all responses.
  app.use("*", async (c, next) => {
    await next();
    c.header(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self';"
    );
    c.header("X-Content-Type-Options", "nosniff");
    c.header("X-Frame-Options", "DENY");
  });

  // CORS — exact origin allowlist.
  app.use(
    cors({
      origin: (origin) => (allowedOrigins.has(origin) ? origin : ""),
      allowHeaders: ["Content-Type", "X-Api-Key", "Authorization"],
      allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    })
  );

  // API key auth on all /api/* routes (if configured).
  const { apiKey } = deps;
  app.use("/api/*", async (c, next) => {
    if (apiKey) {
      const provided =
        c.req.header("X-Api-Key") ??
        c.req.header("Authorization")?.replace("Bearer ", "");
      if (provided !== apiKey) {
        return c.json({ error: "Unauthorized" }, 401);
      }
    }
    await next();
  });

  // API key auth on all /internal/* routes.
  // When no API key is configured, /internal/* is disabled entirely (503) to
  // prevent unauthenticated access to agent transport endpoints.
  const internal = new Hono();
  internal.use("*", async (c, next) => {
    if (!apiKey) {
      return c.json({ error: "BAARA_API_KEY not configured; /internal/* is disabled" }, 503);
    }
    const provided = c.req.header("x-api-key");
    if (provided !== apiKey) return c.json({ error: "Unauthorized" }, 401);
    await next();
  });

  // Rate limiting on mutation endpoints.
  const rlMiddleware = rateLimitMiddleware();
  app.use("/api/tasks/:id/run", rlMiddleware);
  app.use("/api/tasks/:id/submit", rlMiddleware);
  app.use("/api/executions/:id/retry", rlMiddleware);
  app.use("/api/chat", rlMiddleware);
  app.use("/api/chat/sessions/:id/rename", rlMiddleware);
  // Also rate-limit delete, cancel, and input endpoints.
  app.use("/api/tasks/:id", rlMiddleware);
  app.use("/api/executions/:id/cancel", rlMiddleware);
  app.use("/api/executions/:id/input", rlMiddleware);

  // Mount route groups.
  app.route("/api/tasks", taskRoutes(deps.orchestrator, deps.store));
  app.route("/api/executions", executionRoutes(deps.orchestrator, deps.store, deps.devTransport, deps.logsDir));
  app.route("/api/queues", queueRoutes(deps.store));
  app.route("/api", systemRoutes(deps.store));
  app.route("/api/chat", chatRoutes({ store: deps.store, orchestrator: deps.orchestrator, dataDir: deps.dataDir ?? "" }));

  // MCP HTTP endpoint — remote clients connect here.
  // Apply API key auth on /mcp if configured (same guard as /api/*).
  if (apiKey) {
    app.use("/mcp/*", async (c, next) => {
      const provided = c.req.header("x-api-key") ?? c.req.header("authorization")?.replace("Bearer ", "");
      if (provided !== apiKey) return c.json({ error: "Unauthorized" }, 401);
      await next();
    });
  }
  // MCP clients issue multiple RPCs per tool call — use a higher cap (300/min)
  // than the default 10/min used for mutation endpoints.
  const { middleware: mcpRateLimitMiddleware } = makeRateLimiter(300);
  app.use("/mcp/*", mcpRateLimitMiddleware());
  app.route("/mcp", createMcpHttpApp({ store: deps.store, orchestrator: deps.orchestrator, logsDir: deps.logsDir }));

  // Internal agent transport routes (used by production-mode HttpTransport).
  // Auth guard is applied on the `internal` sub-app above.
  internal.route(
    "/",
    internalRoutes(
      deps.orchestrator as Parameters<typeof internalRoutes>[0],
      deps.store
    )
  );
  app.route("/internal", internal);

  // Global error handler — no internal details leaked to clients.
  app.onError((err, c) => {
    console.error("[server] request error", err);
    return c.json({ error: "Internal server error" }, 500);
  });

  return { app, rateLimitCleanupHandle };
}

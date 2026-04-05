// tests/smoke/helpers.ts
//
// Shared test helper for smoke tests.
// Starts a real in-process BAARA Next server on a random port with a temp
// data dir.  Returns { baseUrl, cleanup } so each test can boot and tear down
// its own isolated instance.

import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createStore } from "@baara-next/store";
import { OrchestratorService } from "@baara-next/orchestrator";
import { AgentService } from "@baara-next/agent";
import {
  createDefaultRegistry,
  createDefaultSandboxRegistry,
  MessageBus,
} from "@baara-next/executor";
import { createTransport } from "@baara-next/transport";
import { createServer, broadcast } from "@baara-next/server";

export interface ServerHandle {
  baseUrl: string;
  cleanup: () => Promise<void>;
}

export interface StartServerOpts {
  /** Extra env vars to set for this server instance. */
  env?: Record<string, string>;
}

/**
 * Boot a complete in-process BAARA Next server on a random available port.
 * Uses a fresh temp directory as the data dir so each test is fully isolated.
 *
 * @returns { baseUrl, cleanup } — call cleanup() in afterAll / afterEach.
 */
export async function startServer(opts: StartServerOpts = {}): Promise<ServerHandle> {
  // Apply any extra env vars the test needs (e.g. BAARA_SHELL_ENABLED=true).
  // Always disable rate limiting in tests to avoid 429s on rapid calls.
  const envBackup: Record<string, string | undefined> = {};
  const testEnv = { BAARA_DISABLE_RATE_LIMIT: "true", ...opts.env };
  for (const [k, v] of Object.entries(testEnv)) {
    envBackup[k] = process.env[k];
    process.env[k] = v;
  }

  // Unique temp dir for this server instance.
  const dataDir = join(tmpdir(), `baara-smoke-${crypto.randomUUID()}`);
  mkdirSync(dataDir, { recursive: true });

  const dbPath = join(dataDir, "baara.db");
  const logsDir = join(dataDir, "logs");
  mkdirSync(logsDir, { recursive: true });

  // Wire everything exactly as start.ts does — same order, same deps.
  const store = createStore(dbPath);
  const sandboxRegistry = await createDefaultSandboxRegistry({ dataDir });
  const legacyRegistry = await createDefaultRegistry({ dataDir });
  const messageBus = new MessageBus(store, dataDir);
  const orchestrator = new OrchestratorService(
    store,
    legacyRegistry,
    messageBus,
    sandboxRegistry,
  );
  const transport = createTransport({
    mode: "dev",
    orchestrator: {
      matchTask: orchestrator.matchTask.bind(orchestrator),
      startExecution: orchestrator.startExecution.bind(orchestrator),
      handleExecutionComplete: orchestrator.handleExecutionComplete.bind(orchestrator),
      requestInput: orchestrator.requestInput.bind(orchestrator),
      heartbeat: orchestrator.heartbeat.bind(orchestrator),
    },
  });
  const agent = new AgentService(transport, legacyRegistry.getAll());
  const serverConfig = createServer(
    { orchestrator, store, devTransport: transport, dataDir, logsDir },
    0, // port 0 = OS assigns a random available port
    "127.0.0.1"
  );

  orchestrator.start();
  await agent.start();

  orchestrator.onVisibilityBatch((batch) => {
    for (const item of batch) {
      broadcast({
        type: "execution_status_changed",
        executionId: item.executionId,
        taskId: "",
        status: item.status,
        timestamp: new Date().toISOString(),
      });
    }
  });

  const server = Bun.serve({
    port: serverConfig.port,
    hostname: serverConfig.hostname,
    fetch: serverConfig.fetch,
    websocket: serverConfig.websocket,
    // Increase idle timeout so long-running /run and /submit requests
    // (which block for up to 30 s waiting for Claude Code) don't get
    // disconnected before the response arrives.
    idleTimeout: 120,
  });

  // Bun assigns the real port after bind when port=0.
  const port = (server as { port: number }).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const cleanup = async (): Promise<void> => {
    clearInterval(serverConfig.rateLimitCleanupHandle);
    try { await agent.stop(); } catch { /* ignore */ }
    orchestrator.stop();
    try { store.close(); } catch { /* ignore */ }
    server.stop(true);

    // Remove temp dir.
    try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }

    // Restore env vars.
    for (const [k, v] of Object.entries(envBackup)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };

  return { baseUrl, cleanup };
}

/**
 * Poll GET /api/executions/:id until the execution reaches `targetStatus`
 * or the timeout expires.  Throws if the timeout is reached.
 */
export async function waitForExecution(
  baseUrl: string,
  executionId: string,
  targetStatus: string,
  timeoutMs = 15_000
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${baseUrl}/api/executions/${executionId}`);
    if (res.ok) {
      const body = (await res.json()) as Record<string, unknown>;
      if (body["status"] === targetStatus) return body;
      // If execution has reached a terminal state other than the target, fail fast.
      const terminal = new Set(["completed", "failed", "cancelled", "dead_lettered", "timed_out"]);
      if (terminal.has(body["status"] as string) && body["status"] !== targetStatus) {
        throw new Error(
          `Execution ${executionId} reached terminal status "${body["status"]}" but expected "${targetStatus}"`
        );
      }
    }
    await Bun.sleep(200);
  }
  throw new Error(
    `waitForExecution timed out after ${timeoutMs}ms waiting for status "${targetStatus}" on ${executionId}`
  );
}

/**
 * Thin fetch wrapper that prepends baseUrl.
 */
export function makeApi(baseUrl: string) {
  return async function apiFetch(
    path: string,
    init?: RequestInit
  ): Promise<Response> {
    return fetch(`${baseUrl}${path}`, init);
  };
}

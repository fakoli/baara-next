// @baara-next/cli — start command
//
// The main wiring command.  Two execution modes:
//   - dev:  single-process — orchestrator + agent + HTTP server with DevTransport (in-process)
//   - http: multi-process  — orchestrator + agent run in separate processes
//           communicating over HTTP via the /internal/* routes.
//
// In --mode http you must pass --role to pick which side this process plays:
//   --role orchestrator  → orchestrator + HTTP server + store, NO local agent
//   --role agent         → AgentService + HttpTransport, NO orchestrator/server/store
//
// http mode requires BAARA_API_KEY to be set (the /internal/* middleware in
// @baara-next/server fails closed with 503 otherwise).  The agent role also
// requires BAARA_ORCHESTRATOR_URL pointing at the orchestrator process.

import { Command } from "commander";
import { mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { createStore } from "@baara-next/store";
import { OrchestratorService } from "@baara-next/orchestrator";
import { AgentService } from "@baara-next/agent";
import { createDefaultRegistry, createDefaultSandboxRegistry, MessageBus } from "@baara-next/executor";
import { createTransport } from "@baara-next/transport";
import { createServer, broadcast } from "@baara-next/server";

interface StartOpts {
  mode: string;
  role: string;
  port: string;
  dataDir: string;
  hostname: string;
}

export function registerStartCommand(program: Command): void {
  program
    .command("start")
    .description("Start BAARA Next server (orchestrator + agent + HTTP API)")
    .option(
      "--mode <mode>",
      "Execution mode: dev (single-process) or http (multi-process)",
      "dev"
    )
    .option(
      "--role <role>",
      "Process role in http mode: 'orchestrator' or 'agent' (ignored in dev mode)",
      "both"
    )
    .option("--port <port>", "HTTP server port (orchestrator role only)", "3000")
    .option(
      "--data-dir <dir>",
      "Data directory for the SQLite database and sandbox state",
      join(homedir(), ".baara")
    )
    .option("--hostname <hostname>", "Hostname to bind to (orchestrator role only)", "0.0.0.0")
    .action(async (opts: StartOpts) => {
      // ---------------------------------------------------------------------------
      // Validate mode + role combinations
      // ---------------------------------------------------------------------------
      if (opts.mode !== "dev" && opts.mode !== "http") {
        console.error(`Error: unknown --mode '${opts.mode}' (expected 'dev' or 'http')`);
        process.exit(1);
      }
      if (opts.mode === "http") {
        if (opts.role !== "orchestrator" && opts.role !== "agent") {
          console.error("Error: --mode http requires --role orchestrator or --role agent");
          process.exit(1);
        }
        if (!process.env["BAARA_API_KEY"]) {
          console.error("Error: BAARA_API_KEY environment variable is required in --mode http");
          process.exit(1);
        }
      }

      // ---------------------------------------------------------------------------
      // Agent-only role: AgentService + HttpTransport.  No orchestrator, server, or DB.
      // ---------------------------------------------------------------------------
      if (opts.mode === "http" && opts.role === "agent") {
        await runAgentRole(opts);
        return;
      }

      // ---------------------------------------------------------------------------
      // Orchestrator role (dev mode OR http+orchestrator).
      // Identical setup; in http+orchestrator the local AgentService is skipped
      // because agents run in separate processes.
      // ---------------------------------------------------------------------------
      await runOrchestratorRole(opts);
    });
}

// ---------------------------------------------------------------------------
// Agent role
// ---------------------------------------------------------------------------

async function runAgentRole(opts: StartOpts): Promise<void> {
  const orchestratorUrl = process.env["BAARA_ORCHESTRATOR_URL"];
  if (!orchestratorUrl) {
    console.error("Error: BAARA_ORCHESTRATOR_URL environment variable is required for --role agent");
    process.exit(1);
  }
  const apiKey = process.env["BAARA_API_KEY"];

  mkdirSync(opts.dataDir, { recursive: true });
  const legacyRegistry = await createDefaultRegistry({ dataDir: opts.dataDir });

  const transport = createTransport({
    mode: "http",
    baseUrl: orchestratorUrl,
    apiKey,
  });
  const agent = new AgentService(transport, legacyRegistry.getAll());

  console.log("BAARA Next — starting agent role");
  console.log(`  Orchestrator: ${orchestratorUrl}`);
  console.log(`  Data dir:     ${opts.dataDir}`);

  await agent.start();

  console.log("  Agent started; polling for work. Press Ctrl+C to stop.\n");

  let shuttingDown = false;
  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\nReceived ${signal} — shutting down agent…`);
    try {
      await agent.stop();
    } catch (err) {
      console.error("Agent stop error:", err);
    }
    console.log("BAARA Next agent stopped.");
    process.exit(0);
  }

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("unhandledRejection", (reason) => {
    console.error("[process] Unhandled promise rejection:", reason);
  });
  process.on("uncaughtException", (err) => {
    console.error("[process] Uncaught exception:", err);
    void shutdown("uncaughtException");
  });
}

// ---------------------------------------------------------------------------
// Orchestrator role (dev or http+orchestrator)
// ---------------------------------------------------------------------------

async function runOrchestratorRole(opts: StartOpts): Promise<void> {
  const port = parseInt(opts.port, 10);
  const dataDir = opts.dataDir;
  const includeLocalAgent = opts.mode === "dev"; // http+orchestrator skips the in-process agent

  mkdirSync(dataDir, { recursive: true });
  const dbPath = join(dataDir, "baara.db");

  const roleLabel = opts.mode === "http" ? " (role: orchestrator)" : "";
  console.log(`BAARA Next — starting in ${opts.mode} mode${roleLabel}`);
  console.log(`  Data dir: ${dataDir}`);
  console.log(`  Database: ${dbPath}`);

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

  // DevTransport is only used by the local AgentService in dev mode and by the
  // server's HITL input route (provideInput).  In http+orchestrator mode the
  // local agent is skipped but we still construct a DevTransport reference so
  // the chat HITL flow keeps working for any executions started directly via
  // the orchestrator (e.g. through `baara tasks run`).
  const devTransport = createTransport({
    mode: "dev",
    orchestrator: {
      matchTask: orchestrator.matchTask.bind(orchestrator),
      startExecution: orchestrator.startExecution.bind(orchestrator),
      handleExecutionComplete: orchestrator.handleExecutionComplete.bind(orchestrator),
      requestInput: orchestrator.requestInput.bind(orchestrator),
      heartbeat: orchestrator.heartbeat.bind(orchestrator),
    },
  });

  const agent = includeLocalAgent
    ? new AgentService(devTransport, legacyRegistry.getAll())
    : null;

  const logsDir = join(dataDir, "logs");
  const apiKey = process.env["BAARA_API_KEY"];
  const allowedOrigins = process.env["BAARA_ALLOWED_ORIGINS"]
    ? process.env["BAARA_ALLOWED_ORIGINS"].split(",").map((o) => o.trim())
    : undefined;
  const serverConfig = createServer(
    { orchestrator, store, devTransport, apiKey, dataDir, logsDir, allowedOrigins },
    port,
    opts.hostname
  );

  orchestrator.start();
  if (agent) await agent.start();

  // Wire visibility-batch events to the WebSocket broadcast layer so connected
  // clients receive live status updates.
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
    idleTimeout: 120, // seconds — needed for long-running SDK calls and SSE streams
  });

  const hostLabel = opts.hostname === "0.0.0.0" ? "localhost" : opts.hostname;
  console.log(`\nBAARA Next running at http://${hostLabel}:${port}`);
  console.log(`  API key auth: ${apiKey ? "enabled" : "disabled (set BAARA_API_KEY to enable)"}`);
  if (!agent) {
    console.log("  Local agent: disabled (http+orchestrator role; start agent processes separately)");
  }
  console.log("  Press Ctrl+C to stop\n");

  if (!apiKey) {
    console.warn("  WARNING: BAARA_API_KEY is not set — /api/* routes are unauthenticated and /internal/* returns 503");
  }

  let shuttingDown = false;

  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\nReceived ${signal} — shutting down gracefully…`);

    clearInterval(serverConfig.rateLimitCleanupHandle);

    if (agent) {
      try {
        await agent.stop();
      } catch (err) {
        console.error("Agent stop error:", err);
      }
    }

    orchestrator.stop();

    try {
      store.close();
    } catch (err) {
      console.error("Store close error:", err);
    }

    server.stop(true);
    console.log("BAARA Next stopped.");
    process.exit(0);
  }

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  process.on("unhandledRejection", (reason) => {
    console.error("[process] Unhandled promise rejection:", reason);
  });

  process.on("uncaughtException", (err) => {
    console.error("[process] Uncaught exception:", err);
    void shutdown("uncaughtException");
  });
}

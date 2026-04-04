// @baara-next/cli — start command
//
// The main wiring command: starts the orchestrator, agent, and HTTP server
// in a single process (dev mode) or as separate networked processes
// (production mode, not yet implemented).
//
// Dev mode flow:
//   1. Ensure data directory exists
//   2. Create store (SQLite)
//   3. Create executor runtimes and registry
//   4. Create MessageBus (durable channel, enables checkpointing + recovery)
//   5. Create OrchestratorService (wired to registry + messageBus)
//   6. Create DevTransport wired to orchestrator methods
//   7. Create AgentService with transport + runtimes
//   8. Create HTTP server
//   9. Start everything
//  10. Graceful shutdown on SIGINT/SIGTERM

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

export function registerStartCommand(program: Command): void {
  program
    .command("start")
    .description("Start BAARA Next server (orchestrator + agent + HTTP API)")
    .option(
      "--mode <mode>",
      "Execution mode: dev (single-process) or production",
      "dev"
    )
    .option("--port <port>", "HTTP server port", "3000")
    .option(
      "--data-dir <dir>",
      "Data directory for the SQLite database",
      join(homedir(), ".baara")
    )
    .option("--hostname <hostname>", "Hostname to bind to", "0.0.0.0")
    .action(async (opts: { mode: string; port: string; dataDir: string; hostname: string }) => {
      const port = parseInt(opts.port, 10);
      const dataDir = opts.dataDir;

      // ---------------------------------------------------------------------------
      // 1. Ensure data directory exists
      // ---------------------------------------------------------------------------
      mkdirSync(dataDir, { recursive: true });

      const dbPath = join(dataDir, "baara.db");

      console.log(`BAARA Next — starting in ${opts.mode} mode`);
      console.log(`  Data dir: ${dataDir}`);
      console.log(`  Database: ${dbPath}`);

      // ---------------------------------------------------------------------------
      // 2. Create store
      // ---------------------------------------------------------------------------
      const store = createStore(dbPath);

      // ---------------------------------------------------------------------------
      // 3. Create executor registries
      //    - sandboxRegistry (Phase 5): used by OrchestratorService.runDirect()
      //    - legacyRegistry: provides IRuntime[] for AgentService polling loop
      // ---------------------------------------------------------------------------
      const sandboxRegistry = await createDefaultSandboxRegistry({ dataDir });
      const legacyRegistry = await createDefaultRegistry({ dataDir });

      // ---------------------------------------------------------------------------
      // 4. Create MessageBus (durable channel between orchestrator and sandboxes)
      // ---------------------------------------------------------------------------
      const messageBus = new MessageBus(store, dataDir);

      // ---------------------------------------------------------------------------
      // 5. Create orchestrator (sandboxRegistry drives runDirect; messageBus enables recovery)
      // ---------------------------------------------------------------------------
      const orchestrator = new OrchestratorService(
        store,
        legacyRegistry,
        messageBus,
        sandboxRegistry,
      );

      // ---------------------------------------------------------------------------
      // 6. Create transport (DevTransport wired to orchestrator)
      // ---------------------------------------------------------------------------
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

      // ---------------------------------------------------------------------------
      // 7. Create agent
      // ---------------------------------------------------------------------------
      const agent = new AgentService(transport, legacyRegistry.getAll());

      // ---------------------------------------------------------------------------
      // 8. Create HTTP server
      // ---------------------------------------------------------------------------
      const logsDir = join(dataDir, "logs");
      const apiKey = process.env["BAARA_API_KEY"];
      const serverConfig = createServer(
        { orchestrator, store, devTransport: transport, apiKey, dataDir, logsDir },
        port,
        opts.hostname
      );

      // ---------------------------------------------------------------------------
      // 9. Start everything
      // ---------------------------------------------------------------------------
      orchestrator.start();
      await agent.start();

      // Wire visibility-batch events from the orchestrator's queue manager to
      // the WebSocket broadcast layer so connected clients receive live status
      // updates.
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

      console.log(`\nBAARA Next running at http://${opts.hostname === "0.0.0.0" ? "localhost" : opts.hostname}:${port}`);
      console.log(`  API key auth: ${apiKey ? "enabled" : "disabled (set BAARA_API_KEY to enable)"}`);
      console.log("  Press Ctrl+C to stop\n");

      if (!apiKey) {
        console.warn("  WARNING: BAARA_API_KEY is not set — /api/* routes are unauthenticated");
      }

      // ---------------------------------------------------------------------------
      // 9. Graceful shutdown
      // ---------------------------------------------------------------------------
      let shuttingDown = false;

      async function shutdown(signal: string): Promise<void> {
        if (shuttingDown) return;
        shuttingDown = true;
        console.log(`\nReceived ${signal} — shutting down gracefully…`);

        // Stop rate-limiter cleanup interval first to avoid spurious work.
        clearInterval(serverConfig.rateLimitCleanupHandle);

        try {
          await agent.stop();
        } catch (err) {
          console.error("Agent stop error:", err);
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
    });
}

// tests/validation/helpers/server.ts
//
// Server lifecycle helper for BAARA Next validation tests.
// Adapted from tests/e2e/helpers/server.ts — same pattern: spawns backend +
// Vite, polls until ready, kills + cleans up.
//
// Key difference from e2e: temp dir prefix is "baara-val-" instead of "baara-e2e-".
//
// IMPORTANT: Uses node:child_process (not Bun) because Playwright runs on Node.

import * as cp from "node:child_process";
import * as net from "node:net";
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// ServerInstance — returned by startServer()
// ---------------------------------------------------------------------------

export interface ServerInstance {
  /** Port the BAARA Next backend HTTP server is listening on. */
  backendPort: number;
  /** Port the Vite dev server is listening on. */
  vitePort: number;
  /** Vite base URL (used as Playwright's baseURL). */
  baseURL: string;
  /** Backend API base URL (used by the API client). */
  apiURL: string;
  /** Temporary data directory created for this server instance. */
  dataDir: string;
  /** Terminates both processes and removes the temp directory. */
  cleanup(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Bind to port 0 and read the assigned port, then close immediately.
 * Returns the available port number.
 */
function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to determine available port")));
        return;
      }
      const { port } = address;
      server.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
    server.on("error", reject);
  });
}

/**
 * Poll `url` with GET every `intervalMs` until a 200 response arrives, or
 * `timeoutMs` elapses.  Throws if the timeout is reached.
 */
async function pollUntilReady(
  url: string,
  timeoutMs: number,
  intervalMs = 200,
  label = url
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(intervalMs) });
      if (res.ok) return;
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for ${label} to become ready. Last error: ${lastError}`
  );
}

/**
 * Send SIGTERM to a child process and, after `graceMs`, SIGKILL if still alive.
 */
function killProcess(child: cp.ChildProcess, graceMs = 3000): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.killed) {
      resolve();
      return;
    }

    const forceKill = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* already dead */ }
    }, graceMs);

    child.once("exit", () => {
      clearTimeout(forceKill);
      resolve();
    });

    try { child.kill("SIGTERM"); } catch { /* already dead */ }
  });
}

// ---------------------------------------------------------------------------
// startServer
// ---------------------------------------------------------------------------

/**
 * Start a BAARA Next backend and a Vite dev server, each in a subprocess.
 *
 * - Creates a fresh temp directory under os.tmpdir() with prefix "baara-val-".
 * - Assigns random available ports for both servers.
 * - Polls until both are healthy before returning.
 * - The returned `cleanup()` method kills both processes and removes the temp dir.
 */
export async function startServer(): Promise<ServerInstance> {
  // 1. Temp data directory — validation-specific prefix.
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "baara-val-"));

  // 2. Pick random ports.
  const backendPort = await getAvailablePort();
  const vitePort = await getAvailablePort();

  // 3. Resolve project root (two levels up from tests/validation/helpers/).
  const projectRoot = path.resolve(__dirname, "../../..");

  // 4. Spawn the BAARA Next backend.
  //    Uses "bun run" so the CLI entry point can use Bun APIs (bun:sqlite, etc.).
  const backendArgs = [
    "run",
    path.join(projectRoot, "packages/cli/src/index.ts"),
    "--",
    "start",
    "--port",
    String(backendPort),
    "--data-dir",
    dataDir,
  ];

  const backend = cp.spawn("bun", backendArgs, {
    cwd: projectRoot,
    env: {
      ...process.env,
      BAARA_DISABLE_RATE_LIMIT: "true",
      BAARA_ALLOWED_ORIGINS: `http://localhost:${vitePort},http://127.0.0.1:${vitePort}`,
    },
    stdio: "pipe",
  });

  // Surface backend stderr in the test runner output for debugging.
  backend.stderr?.on("data", (chunk: Buffer) => {
    process.stderr.write(`[backend] ${chunk.toString()}`);
  });

  // 5. Spawn the Vite dev server.
  const vite = cp.spawn("bunx", ["vite", "--port", String(vitePort), "--host", "127.0.0.1"], {
    cwd: path.join(projectRoot, "packages/web"),
    env: {
      ...process.env,
      VITE_API_URL: `http://localhost:${backendPort}`,
    },
    stdio: "pipe",
  });

  vite.stderr?.on("data", (chunk: Buffer) => {
    process.stderr.write(`[vite] ${chunk.toString()}`);
  });

  // 6. Poll until both servers are healthy.
  const backendStatusURL = `http://localhost:${backendPort}/api/system/status`;
  const viteURL = `http://localhost:${vitePort}`;

  await Promise.all([
    pollUntilReady(backendStatusURL, 15_000, 200, "backend"),
    pollUntilReady(viteURL, 10_000, 200, "vite"),
  ]);

  // 7. Build the ServerInstance.
  const apiURL = `http://localhost:${backendPort}`;
  const baseURL = viteURL;

  const cleanup = async (): Promise<void> => {
    await Promise.all([killProcess(backend), killProcess(vite)]);
    try {
      fs.rmSync(dataDir, { recursive: true, force: true });
    } catch {
      // Non-fatal — the OS will clean up tmpdir eventually.
    }
  };

  return {
    backendPort,
    vitePort,
    baseURL,
    apiURL,
    dataDir,
    cleanup,
  };
}

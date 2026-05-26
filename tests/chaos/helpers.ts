// 2-process spawn helpers for chaos tests. Boots a real orchestrator and a
// real agent in separate child processes against a shared SQLite DB.
//
// Fidelity: tests use ShellRuntime (BAARA_SHELL_ENABLED=true) so they don't
// need an Anthropic API key. ShellRuntime is single-shot, so what these tests
// exercise is the transport-layer reconnect/retry path on the HttpTransport
// after the orchestrator process is killed and restarted — not Claude Code
// SDK multi-turn checkpoint replay (which would require real LLM execution).
//
// Known limitations (follow-on):
//   - pickFreePort has a TOCTOU window between probe-release and spawn-bind.
//     Resilient fix needs the CLI to log its actually-bound port on stdout
//     so this helper can parse it instead of pre-allocating.
//   - Child processes inherit the full parent env; consider an allowlist
//     before adding tests that exercise auth/permission boundaries.

import { spawn, type Subprocess } from "bun";
import { mkdirSync, rmSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(HERE, "..", "..");
const CLI_ENTRY = join(PROJECT_ROOT, "packages", "cli", "src", "index.ts");

export interface ChaosSetup {
  baseUrl: string;
  apiKey: string;
  dataDir: string;
  port: number;
  orchestrator: Subprocess;
  agent: Subprocess;
}

export interface SetupOpts {
  apiKey?: string;
}

// ---------------------------------------------------------------------------
// Process control
// ---------------------------------------------------------------------------

async function pickFreePort(): Promise<number> {
  const s = Bun.serve({ port: 0, fetch: () => new Response("ok") });
  const port = (s as { port: number }).port;
  s.stop(true);
  return port;
}

async function waitFor(
  condition: () => Promise<boolean>,
  label: string,
  timeoutMs = 15_000,
  intervalMs = 150
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await condition()) return;
    } catch {
      // Condition threw — treat as not-yet-true.
    }
    await Bun.sleep(intervalMs);
  }
  throw new Error(`waitFor(${label}) timed out after ${timeoutMs}ms`);
}

function spawnOrchestrator(
  port: number,
  dataDir: string,
  apiKey: string
): Subprocess {
  return spawn({
    cmd: [
      "bun", "run", CLI_ENTRY,
      "start",
      "--mode", "http",
      "--role", "orchestrator",
      "--port", String(port),
      "--data-dir", dataDir,
      "--hostname", "127.0.0.1",
    ],
    env: {
      ...process.env,
      BAARA_API_KEY: apiKey,
      BAARA_DISABLE_RATE_LIMIT: "true",
      BAARA_SHELL_ENABLED: "true",
    },
    cwd: PROJECT_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
}

function spawnAgent(
  orchestratorUrl: string,
  dataDir: string,
  apiKey: string
): Subprocess {
  return spawn({
    cmd: [
      "bun", "run", CLI_ENTRY,
      "start",
      "--mode", "http",
      "--role", "agent",
      "--data-dir", dataDir,
    ],
    env: {
      ...process.env,
      BAARA_API_KEY: apiKey,
      BAARA_ORCHESTRATOR_URL: orchestratorUrl,
      BAARA_DISABLE_RATE_LIMIT: "true",
      BAARA_SHELL_ENABLED: "true",
    },
    cwd: PROJECT_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
}

export async function orchestratorReady(baseUrl: string, apiKey: string): Promise<boolean> {
  const res = await fetch(`${baseUrl}/api/system/status`, {
    headers: { "X-Api-Key": apiKey },
  });
  return res.ok;
}

export { waitFor };

/**
 * Wait until the child process writes `marker` to stdout. After the marker
 * arrives the reader is fully drained in the background to prevent kernel
 * pipe-buffer back-pressure on long-running tests.
 */
async function waitForStdoutMarker(
  proc: Subprocess,
  marker: string,
  label: string,
  timeoutMs = 15_000
): Promise<void> {
  const stream = proc.stdout as ReadableStream<Uint8Array>;
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  let buf = "";
  const deadline = Date.now() + timeoutMs;
  let detached = false;
  try {
    while (Date.now() < deadline) {
      const remaining = deadline - Date.now();
      const result = await Promise.race([
        reader.read(),
        Bun.sleep(remaining).then(() => null),
      ]);
      if (result === null) break;
      if (result.done) throw new Error(`${label}: stdout closed before "${marker}"`);
      buf += decoder.decode(result.value);
      if (buf.includes(marker)) {
        detached = true;
        void (async () => {
          try {
            while (true) {
              const r = await reader.read();
              if (r.done) return;
            }
          } catch {
            // ignore; the reader is released on process exit
          }
        })();
        return;
      }
    }
    throw new Error(`${label}: marker "${marker}" not seen within ${timeoutMs}ms`);
  } finally {
    if (!detached) {
      try { reader.releaseLock(); } catch { /* ignore */ }
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Boot a 2-process orchestrator + agent pair on a free port with a fresh
 * temp data dir. Caller must call `teardown` when done (or call it via
 * test framework afterEach).
 */
export async function setupChaos(opts: SetupOpts = {}): Promise<ChaosSetup> {
  const port = await pickFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const apiKey = opts.apiKey ?? `chaos-${crypto.randomUUID()}`;
  const dataDir = join(tmpdir(), `baara-chaos-${crypto.randomUUID()}`);
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(join(dataDir, "agent"), { recursive: true });

  const orchestrator = spawnOrchestrator(port, dataDir, apiKey);
  await waitFor(() => orchestratorReady(baseUrl, apiKey), "orchestrator bind");

  const agent = spawnAgent(baseUrl, join(dataDir, "agent"), apiKey);
  // The agent has no HTTP health endpoint; the CLI prints this exact line
  // once AgentService.start() resolves and the poll loop is running.
  await waitForStdoutMarker(agent, "Agent started; polling for work", "agent ready");

  return { baseUrl, apiKey, dataDir, port, orchestrator, agent };
}

/**
 * SIGKILL a process and wait for it to exit. The caller should follow up with
 * a readiness check (e.g. waitFor(!orchestratorReady(...))) before assuming
 * the listening port is free — that check naturally handles TIME_WAIT delays
 * by returning ECONNREFUSED until the kernel releases the socket.
 */
export async function killProcess(proc: Subprocess): Promise<void> {
  try {
    proc.kill("SIGKILL");
  } catch {
    // Already dead.
  }
  try {
    await proc.exited;
  } catch {
    // Some Bun versions reject on SIGKILL; the exit code is not load-bearing here.
  }
}

/**
 * Re-spawn the orchestrator on the same port + dataDir. If readiness times
 * out the new subprocess is killed so it cannot leak past test teardown.
 */
export async function restartOrchestrator(setup: ChaosSetup): Promise<Subprocess> {
  const newOrch = spawnOrchestrator(setup.port, setup.dataDir, setup.apiKey);
  try {
    await waitFor(() => orchestratorReady(setup.baseUrl, setup.apiKey), "orchestrator restart bind");
  } catch (err) {
    try { newOrch.kill("SIGKILL"); } catch { /* ignore */ }
    try { await newOrch.exited; } catch { /* ignore */ }
    throw err;
  }
  return newOrch;
}

/**
 * Tear down all child processes and remove the temp data dir.
 * Safe to call multiple times.
 */
export async function teardown(setup: ChaosSetup, extras: Subprocess[] = []): Promise<void> {
  const procs = [setup.orchestrator, setup.agent, ...extras];
  for (const p of procs) {
    try { p.kill("SIGTERM"); } catch { /* already dead */ }
  }
  await Bun.sleep(200);
  for (const p of procs) {
    try { p.kill("SIGKILL"); } catch { /* already dead */ }
  }
  for (const p of procs) {
    try { await p.exited; } catch { /* ignore */ }
  }
  try {
    rmSync(setup.dataDir, { recursive: true, force: true });
  } catch {
    // Temp dir may already be gone.
  }
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

export interface TaskInput {
  name: string;
  prompt: string;
  timeoutMs?: number;
  executionType?: string;
}

/** Create a task via POST /api/tasks. Returns the created task's id. */
export async function createTask(
  setup: ChaosSetup,
  input: TaskInput
): Promise<string> {
  const res = await fetch(`${setup.baseUrl}/api/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Api-Key": setup.apiKey },
    body: JSON.stringify({
      name: input.name,
      description: input.name,
      prompt: input.prompt,
      timeoutMs: input.timeoutMs ?? 30_000,
      executionType: input.executionType ?? "shell",
      priority: 0,
      targetQueue: "transfer",
      maxRetries: 1,
      executionMode: "queued",
      enabled: true,
    }),
  });
  if (!res.ok) throw new Error(`createTask failed: ${res.status} ${await res.text()}`);
  const task = (await res.json()) as { id: string };
  return task.id;
}

/** Submit a task for execution. Returns the execution id. */
export async function submitTask(
  setup: ChaosSetup,
  taskId: string
): Promise<string> {
  const res = await fetch(`${setup.baseUrl}/api/tasks/${taskId}/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Api-Key": setup.apiKey },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(`submitTask failed: ${res.status} ${await res.text()}`);
  const execution = (await res.json()) as { id: string };
  return execution.id;
}

/** Fetch an execution's current state. */
export async function getExecution(
  setup: ChaosSetup,
  executionId: string
): Promise<Record<string, unknown> | null> {
  const res = await fetch(`${setup.baseUrl}/api/executions/${executionId}`, {
    headers: { "X-Api-Key": setup.apiKey },
  });
  if (!res.ok) return null;
  return (await res.json()) as Record<string, unknown>;
}

/**
 * Poll until an execution reaches one of `targetStatuses` (or a terminal
 * status outside the target set, which throws).
 */
export async function waitForExecution(
  setup: ChaosSetup,
  executionId: string,
  targetStatuses: string | string[],
  timeoutMs = 30_000
): Promise<Record<string, unknown>> {
  const targets = new Set(Array.isArray(targetStatuses) ? targetStatuses : [targetStatuses]);
  const terminal = new Set(["completed", "failed", "cancelled", "dead_lettered", "timed_out"]);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const body = await getExecution(setup, executionId);
    if (body) {
      const status = body["status"] as string;
      if (targets.has(status)) return body;
      if (terminal.has(status) && !targets.has(status)) {
        throw new Error(
          `waitForExecution: ${executionId} reached terminal "${status}" but expected ${[...targets].join("|")}`
        );
      }
    }
    await Bun.sleep(250);
  }
  throw new Error(
    `waitForExecution timed out after ${timeoutMs}ms waiting for ${[...targets].join("|")} on ${executionId}`
  );
}

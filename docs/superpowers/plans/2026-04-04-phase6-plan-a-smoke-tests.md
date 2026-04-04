# Plan A: Smoke Test Suite

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan.

**Goal:** Build a 10-test smoke test suite using Bun's built-in test runner that validates all critical paths of the BAARA Next engine end-to-end: boot, CRUD, execution, retry/DLQ, direct run, MCP, chat SSE, thread model, sandbox config persistence, and logs.

**Spec reference:** Part 1 of `docs/superpowers/specs/2026-04-04-phase6-production-launch-design.md`

**Architecture:** Each test file starts a real server in-process on a random port using a temp SQLite database, runs HTTP scenarios against it, then tears down. No mocking. The helper in `tests/smoke/helpers.ts` wires together the exact same startup sequence as `packages/cli/src/commands/start.ts` without going through Commander.

---

### Task 1: Create `tests/smoke/helpers.ts`

**Files:**
- Create: `tests/smoke/helpers.ts`

The test helper must replicate the wiring in `start.ts` (steps 1-9) as a plain async function — no Commander, no `process.exit`. It must return `{ baseUrl, cleanup }` where `cleanup()` shuts everything down cleanly.

- [ ] **Step 1: Verify directory**

```bash
ls tests/ 2>/dev/null || mkdir -p tests/smoke
```

- [ ] **Step 2: Write `tests/smoke/helpers.ts`**

```typescript
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
  const envBackup: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(opts.env ?? {})) {
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
    0, // port 0 = random available port
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
```

---

### Task 2: Create `tests/smoke/01-boot.test.ts`

**Files:**
- Create: `tests/smoke/01-boot.test.ts`

Verify the server boots cleanly and `/api/health` returns 200 with `{ status: "ok" }`.

- [ ] **Step 1: Write test**

```typescript
// tests/smoke/01-boot.test.ts
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { startServer, type ServerHandle } from "./helpers.ts";

describe("01-boot", () => {
  let handle: ServerHandle;

  beforeAll(async () => {
    handle = await startServer();
  });

  afterAll(async () => {
    await handle.cleanup();
  });

  it("GET /api/health returns 200 with status ok", async () => {
    const res = await fetch(`${handle.baseUrl}/api/health`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body["status"]).toBe("ok");
    expect(typeof body["uptime"]).toBe("number");
    expect(body["version"]).toBe("0.1.0");
  });

  it("GET /api/system/status returns queue info", async () => {
    const res = await fetch(`${handle.baseUrl}/api/system/status`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(typeof body["uptime"]).toBe("number");
    expect(typeof body["queues"]).toBe("object");
  });
});
```

---

### Task 3: Create `tests/smoke/02-task-crud.test.ts`

**Files:**
- Create: `tests/smoke/02-task-crud.test.ts`

Full CRUD cycle: POST create → GET list → GET by name → PUT update → DELETE → verify 404.

- [ ] **Step 1: Write test**

```typescript
// tests/smoke/02-task-crud.test.ts
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { startServer, makeApi, type ServerHandle } from "./helpers.ts";

describe("02-task-crud", () => {
  let handle: ServerHandle;
  let api: ReturnType<typeof makeApi>;

  beforeAll(async () => {
    handle = await startServer();
    api = makeApi(handle.baseUrl);
  });

  afterAll(async () => {
    await handle.cleanup();
  });

  let taskId: string;
  const taskName = `smoke-crud-${Date.now()}`;

  it("POST /api/tasks creates a task", async () => {
    const res = await api("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: taskName,
        prompt: "echo hello from smoke test",
        description: "Smoke test CRUD task",
        sandboxType: "native",
        executionMode: "direct",
      }),
    });
    expect(res.status).toBe(201);
    const task = await res.json() as Record<string, unknown>;
    expect(task["name"]).toBe(taskName);
    expect(task["id"]).toBeTruthy();
    taskId = task["id"] as string;
  });

  it("GET /api/tasks returns the task in the list", async () => {
    const res = await api("/api/tasks");
    expect(res.status).toBe(200);
    const tasks = await res.json() as Array<Record<string, unknown>>;
    expect(tasks.some((t) => t["id"] === taskId)).toBe(true);
  });

  it("GET /api/tasks/:name resolves by name", async () => {
    const res = await api(`/api/tasks/${encodeURIComponent(taskName)}`);
    expect(res.status).toBe(200);
    const task = await res.json() as Record<string, unknown>;
    expect(task["id"]).toBe(taskId);
  });

  it("PUT /api/tasks/:id updates the task", async () => {
    const res = await api(`/api/tasks/${taskId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: "Updated description" }),
    });
    expect(res.status).toBe(200);
    const task = await res.json() as Record<string, unknown>;
    expect(task["description"]).toBe("Updated description");
  });

  it("DELETE /api/tasks/:id removes the task", async () => {
    const res = await api(`/api/tasks/${taskId}`, { method: "DELETE" });
    expect(res.status).toBe(200);
  });

  it("GET /api/tasks/:id returns 404 after deletion", async () => {
    const res = await api(`/api/tasks/${taskId}`);
    expect(res.status).toBe(404);
  });
});
```

---

### Task 4: Create `tests/smoke/03-submit-execute.test.ts`

**Files:**
- Create: `tests/smoke/03-submit-execute.test.ts`

Create a shell task, submit it to the queue, poll until `completed`, verify output contains `hello`.

- [ ] **Step 1: Write test**

```typescript
// tests/smoke/03-submit-execute.test.ts
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { startServer, makeApi, waitForExecution, type ServerHandle } from "./helpers.ts";

describe("03-submit-execute", () => {
  let handle: ServerHandle;
  let api: ReturnType<typeof makeApi>;

  beforeAll(async () => {
    handle = await startServer({ env: { BAARA_SHELL_ENABLED: "true" } });
    api = makeApi(handle.baseUrl);
  });

  afterAll(async () => {
    await handle.cleanup();
  });

  it("creates a shell task, submits it, and waits for completed", async () => {
    // Create task
    const createRes = await api("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `smoke-execute-${Date.now()}`,
        prompt: "echo hello smoke",
        sandboxType: "native",
        executionType: "shell",
        executionMode: "queued",
        timeoutMs: 10000,
        maxRetries: 0,
      }),
    });
    expect(createRes.status).toBe(201);
    const task = await createRes.json() as Record<string, unknown>;
    const taskId = task["id"] as string;

    // Submit to queue
    const submitRes = await api(`/api/tasks/${taskId}/submit`, { method: "POST" });
    expect(submitRes.status).toBe(201);
    const execution = await submitRes.json() as Record<string, unknown>;
    const execId = execution["id"] as string;
    expect(execId).toBeTruthy();

    // Poll until completed
    const final = await waitForExecution(handle.baseUrl, execId, "completed", 20_000);
    expect(final["status"]).toBe("completed");
    expect(typeof final["output"]).toBe("string");
    expect((final["output"] as string).toLowerCase()).toContain("hello");
  });
});
```

---

### Task 5: Create `tests/smoke/04-retry-dlq.test.ts`

**Files:**
- Create: `tests/smoke/04-retry-dlq.test.ts`

Create a task that always fails (`exit 1`), configure `maxRetries=2`, submit it, then wait for `dead_lettered`.

- [ ] **Step 1: Write test**

```typescript
// tests/smoke/04-retry-dlq.test.ts
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { startServer, makeApi, waitForExecution, type ServerHandle } from "./helpers.ts";

describe("04-retry-dlq", () => {
  let handle: ServerHandle;
  let api: ReturnType<typeof makeApi>;

  beforeAll(async () => {
    handle = await startServer({ env: { BAARA_SHELL_ENABLED: "true" } });
    api = makeApi(handle.baseUrl);
  });

  afterAll(async () => {
    await handle.cleanup();
  });

  it("failing task with maxRetries=2 ends in dead_lettered", async () => {
    // Create a task guaranteed to fail
    const createRes = await api("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `smoke-dlq-${Date.now()}`,
        prompt: "exit 1",
        sandboxType: "native",
        executionType: "shell",
        executionMode: "queued",
        timeoutMs: 5000,
        maxRetries: 2,
      }),
    });
    expect(createRes.status).toBe(201);
    const task = await createRes.json() as Record<string, unknown>;
    const taskId = task["id"] as string;

    // Submit
    const submitRes = await api(`/api/tasks/${taskId}/submit`, { method: "POST" });
    expect(submitRes.status).toBe(201);
    const execution = await submitRes.json() as Record<string, unknown>;
    const execId = execution["id"] as string;

    // Wait for dead_lettered — allow generous timeout for 3 attempts (initial + 2 retries)
    const final = await waitForExecution(handle.baseUrl, execId, "dead_lettered", 60_000);
    expect(final["status"]).toBe("dead_lettered");

    // Verify DLQ list includes this execution
    const dlqRes = await api("/api/executions?status=dead_lettered");
    expect(dlqRes.status).toBe(200);
    const dlqList = await dlqRes.json() as Array<Record<string, unknown>>;
    expect(dlqList.some((e) => e["id"] === execId)).toBe(true);
  });
});
```

---

### Task 6: Create `tests/smoke/05-direct-run.test.ts`

**Files:**
- Create: `tests/smoke/05-direct-run.test.ts`

POST `/api/tasks/:id/run` (direct mode, bypasses queue) and verify the execution returns `completed` with output inline.

- [ ] **Step 1: Write test**

```typescript
// tests/smoke/05-direct-run.test.ts
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { startServer, makeApi, type ServerHandle } from "./helpers.ts";

describe("05-direct-run", () => {
  let handle: ServerHandle;
  let api: ReturnType<typeof makeApi>;

  beforeAll(async () => {
    handle = await startServer({ env: { BAARA_SHELL_ENABLED: "true" } });
    api = makeApi(handle.baseUrl);
  });

  afterAll(async () => {
    await handle.cleanup();
  });

  it("POST /api/tasks/:id/run returns a completed execution inline", async () => {
    // Create task
    const createRes = await api("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `smoke-direct-${Date.now()}`,
        prompt: "echo direct-run-output",
        sandboxType: "native",
        executionType: "shell",
        executionMode: "direct",
        timeoutMs: 10000,
        maxRetries: 0,
      }),
    });
    expect(createRes.status).toBe(201);
    const task = await createRes.json() as Record<string, unknown>;
    const taskId = task["id"] as string;

    // Direct run — blocks until completion
    const runRes = await api(`/api/tasks/${taskId}/run`, { method: "POST" });
    expect(runRes.status).toBe(200);
    const execution = await runRes.json() as Record<string, unknown>;

    expect(execution["status"]).toBe("completed");
    expect(typeof execution["output"]).toBe("string");
    expect((execution["output"] as string).toLowerCase()).toContain("direct-run-output");
    expect(execution["id"]).toBeTruthy();
  });
});
```

---

### Task 7: Create `tests/smoke/06-mcp-endpoint.test.ts`

**Files:**
- Create: `tests/smoke/06-mcp-endpoint.test.ts`

POST `/mcp` with `initialize`, verify `tools/list` returns exactly 27 tools, then call `create_task` via `tools/call`.

- [ ] **Step 1: Write test**

```typescript
// tests/smoke/06-mcp-endpoint.test.ts
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { startServer, makeApi, type ServerHandle } from "./helpers.ts";

describe("06-mcp-endpoint", () => {
  let handle: ServerHandle;
  let api: ReturnType<typeof makeApi>;

  beforeAll(async () => {
    handle = await startServer();
    api = makeApi(handle.baseUrl);
  });

  afterAll(async () => {
    await handle.cleanup();
  });

  async function rpc(method: string, params?: Record<string, unknown>) {
    const res = await api("/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method,
        params,
      }),
    });
    expect(res.status).toBe(200);
    return res.json() as Promise<Record<string, unknown>>;
  }

  it("initialize returns server info with protocolVersion", async () => {
    const resp = await rpc("initialize");
    const result = resp["result"] as Record<string, unknown>;
    expect(result["protocolVersion"]).toBeTruthy();
    const serverInfo = result["serverInfo"] as Record<string, unknown>;
    expect(serverInfo["name"]).toBe("baara-next");
  });

  it("tools/list returns exactly 27 tools", async () => {
    const resp = await rpc("tools/list");
    const result = resp["result"] as Record<string, unknown>;
    const tools = result["tools"] as unknown[];
    expect(tools.length).toBe(27);
  });

  it("tools/list tool names include expected tool names", async () => {
    const resp = await rpc("tools/list");
    const result = resp["result"] as Record<string, unknown>;
    const tools = result["tools"] as Array<{ name: string }>;
    const names = tools.map((t) => t.name);
    expect(names).toContain("list_tasks");
    expect(names).toContain("create_task");
    expect(names).toContain("run_task");
    expect(names).toContain("submit_task");
    expect(names).toContain("list_executions");
    expect(names).toContain("get_execution");
    expect(names).toContain("cancel_execution");
    expect(names).toContain("retry_execution");
    expect(names).toContain("get_system_status");
    expect(names).toContain("get_execution_logs");
    expect(names).toContain("list_queues");
    expect(names).toContain("get_queue_info");
    expect(names).toContain("dlq_list");
    expect(names).toContain("dlq_retry");
    expect(names).toContain("list_pending_input");
    expect(names).toContain("provide_input");
    expect(names).toContain("list_templates");
    expect(names).toContain("create_task_from_template");
    expect(names).toContain("list_projects");
    expect(names).toContain("set_active_project");
    expect(names).toContain("discover_plugins");
    expect(names).toContain("run_skill");
  });

  it("tools/call create_task creates a task via MCP", async () => {
    const taskName = `smoke-mcp-${Date.now()}`;
    const resp = await rpc("tools/call", {
      name: "create_task",
      arguments: {
        name: taskName,
        prompt: "echo created via mcp",
        sandboxType: "native",
      },
    });
    // Should be a result, not an error
    expect(resp["error"]).toBeUndefined();
    const result = resp["result"] as Record<string, unknown>;
    // MCP tools return { ok: true, data: {...} } or { ok: false, error: "..." }
    expect(result).toBeTruthy();
  });
});
```

---

### Task 8: Create `tests/smoke/07-chat-sse.test.ts`

**Files:**
- Create: `tests/smoke/07-chat-sse.test.ts`

POST `/api/chat` and read the SSE stream. Verify a `system` event and at least one `text` event arrive before `done`. Requires `ANTHROPIC_API_KEY` to be set in the environment.

- [ ] **Step 1: Write test**

```typescript
// tests/smoke/07-chat-sse.test.ts
//
// NOTE: This test requires ANTHROPIC_API_KEY in the environment.
// If the key is absent, the test is skipped.
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { startServer, makeApi, type ServerHandle } from "./helpers.ts";

describe("07-chat-sse", () => {
  let handle: ServerHandle;
  let api: ReturnType<typeof makeApi>;

  beforeAll(async () => {
    if (!process.env["ANTHROPIC_API_KEY"]) {
      console.log("[07-chat-sse] Skipping: ANTHROPIC_API_KEY not set");
      return;
    }
    handle = await startServer();
    api = makeApi(handle.baseUrl);
  });

  afterAll(async () => {
    if (handle) await handle.cleanup();
  });

  /**
   * Read lines from an SSE stream response.
   * Returns all parsed `data:` payloads as parsed JSON objects.
   * Stops after the `done` event or `maxEvents` events.
   */
  async function readSseEvents(
    res: Response,
    maxEvents = 50
  ): Promise<Array<Record<string, unknown>>> {
    const events: Array<Record<string, unknown>> = [];
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (events.length < maxEvents) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.startsWith("data:")) {
          const raw = line.slice(5).trim();
          try {
            const parsed = JSON.parse(raw) as Record<string, unknown>;
            events.push(parsed);
            if (parsed["type"] === "done") {
              reader.cancel();
              return events;
            }
          } catch { /* skip malformed */ }
        }
      }
    }
    reader.cancel();
    return events;
  }

  it("POST /api/chat streams system event and at least one text event", async () => {
    if (!process.env["ANTHROPIC_API_KEY"]) return;

    const res = await api("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Say exactly: hello smoke" }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");

    const events = await readSseEvents(res, 100);
    const types = events.map((e) => e["type"]);

    // Must have a system handshake event
    expect(types).toContain("system");
    // Must have at least one text or text_delta event
    const hasText = types.includes("text") || types.includes("text_delta");
    expect(hasText).toBe(true);
    // Stream must end with done
    expect(types[types.length - 1]).toBe("done");

    // System event must contain session and thread IDs
    const systemEvent = events.find((e) => e["type"] === "system");
    expect(systemEvent?.["sessionId"]).toBeTruthy();
    expect(systemEvent?.["threadId"]).toBeTruthy();
  });
});
```

---

### Task 9: Create `tests/smoke/08-thread-model.test.ts`

**Files:**
- Create: `tests/smoke/08-thread-model.test.ts`

POST `/api/chat` (without providing a threadId), capture the threadId from the `system` SSE event, then verify `GET /api/chat/sessions` returns that thread.

- [ ] **Step 1: Write test**

```typescript
// tests/smoke/08-thread-model.test.ts
//
// NOTE: This test requires ANTHROPIC_API_KEY in the environment.
// If the key is absent, the test is skipped.
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { startServer, makeApi, type ServerHandle } from "./helpers.ts";

describe("08-thread-model", () => {
  let handle: ServerHandle;
  let api: ReturnType<typeof makeApi>;

  beforeAll(async () => {
    if (!process.env["ANTHROPIC_API_KEY"]) {
      console.log("[08-thread-model] Skipping: ANTHROPIC_API_KEY not set");
      return;
    }
    handle = await startServer();
    api = makeApi(handle.baseUrl);
  });

  afterAll(async () => {
    if (handle) await handle.cleanup();
  });

  async function firstSseEvent(res: Response): Promise<Record<string, unknown> | null> {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (let i = 0; i < 20; i++) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.startsWith("data:")) {
          try {
            const parsed = JSON.parse(line.slice(5).trim()) as Record<string, unknown>;
            if (parsed["type"] === "system") {
              reader.cancel();
              return parsed;
            }
          } catch { /* skip */ }
        }
      }
    }
    reader.cancel();
    return null;
  }

  it("POST /api/chat creates a thread visible in GET /api/chat/sessions", async () => {
    if (!process.env["ANTHROPIC_API_KEY"]) return;

    const res = await api("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "hello" }),
    });
    expect(res.status).toBe(200);

    const systemEvent = await firstSseEvent(res);
    expect(systemEvent).not.toBeNull();
    const threadId = systemEvent?.["threadId"] as string | undefined;
    expect(threadId).toBeTruthy();

    // Thread should now appear in sessions list
    const sessionsRes = await api("/api/chat/sessions");
    expect(sessionsRes.status).toBe(200);
    const sessions = await sessionsRes.json() as Array<Record<string, unknown>>;
    expect(sessions.some((s) => s["id"] === threadId)).toBe(true);
  });
});
```

---

### Task 10: Create `tests/smoke/09-sandbox-config.test.ts`

**Files:**
- Create: `tests/smoke/09-sandbox-config.test.ts`

Create a task with `sandboxType: "wasm"` and a full `sandboxConfig`, then GET the task and verify the fields are stored and returned correctly.

- [ ] **Step 1: Write test**

```typescript
// tests/smoke/09-sandbox-config.test.ts
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { startServer, makeApi, type ServerHandle } from "./helpers.ts";

describe("09-sandbox-config", () => {
  let handle: ServerHandle;
  let api: ReturnType<typeof makeApi>;

  beforeAll(async () => {
    handle = await startServer();
    api = makeApi(handle.baseUrl);
  });

  afterAll(async () => {
    await handle.cleanup();
  });

  it("task created with sandboxType=wasm and sandboxConfig is stored and returned correctly", async () => {
    const sandboxConfig = {
      type: "wasm",
      networkEnabled: true,
      maxMemoryMb: 256,
      maxCpuPercent: 50,
    };

    const createRes = await api("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `smoke-sandbox-${Date.now()}`,
        prompt: "print('hello wasm')",
        sandboxType: "wasm",
        sandboxConfig,
        executionMode: "direct",
        timeoutMs: 10000,
      }),
    });
    expect(createRes.status).toBe(201);
    const task = await createRes.json() as Record<string, unknown>;
    const taskId = task["id"] as string;

    // GET by ID and verify fields round-tripped correctly
    const getRes = await api(`/api/tasks/${taskId}`);
    expect(getRes.status).toBe(200);
    const fetched = await getRes.json() as Record<string, unknown>;

    expect(fetched["sandboxType"]).toBe("wasm");

    const storedConfig = fetched["sandboxConfig"] as Record<string, unknown>;
    expect(storedConfig["type"]).toBe("wasm");
    expect(storedConfig["networkEnabled"]).toBe(true);
    expect(storedConfig["maxMemoryMb"]).toBe(256);
    expect(storedConfig["maxCpuPercent"]).toBe(50);
  });
});
```

---

### Task 11: Create `tests/smoke/10-logs-api.test.ts`

**Files:**
- Create: `tests/smoke/10-logs-api.test.ts`

Run a shell task directly, then GET `/api/executions/:id/logs` and verify the `entries` array is returned (may be empty if JSONL logs dir is not populated, but endpoint must return 200 and correct shape).

- [ ] **Step 1: Write test**

```typescript
// tests/smoke/10-logs-api.test.ts
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { startServer, makeApi, type ServerHandle } from "./helpers.ts";

describe("10-logs-api", () => {
  let handle: ServerHandle;
  let api: ReturnType<typeof makeApi>;

  beforeAll(async () => {
    handle = await startServer({ env: { BAARA_SHELL_ENABLED: "true" } });
    api = makeApi(handle.baseUrl);
  });

  afterAll(async () => {
    await handle.cleanup();
  });

  it("GET /api/executions/:id/logs returns correct shape after running a task", async () => {
    // Create and directly run a task
    const createRes = await api("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `smoke-logs-${Date.now()}`,
        prompt: "echo logs-test-output",
        sandboxType: "native",
        executionType: "shell",
        executionMode: "direct",
        timeoutMs: 10000,
        maxRetries: 0,
      }),
    });
    expect(createRes.status).toBe(201);
    const task = await createRes.json() as Record<string, unknown>;
    const taskId = task["id"] as string;

    const runRes = await api(`/api/tasks/${taskId}/run`, { method: "POST" });
    expect(runRes.status).toBe(200);
    const execution = await runRes.json() as Record<string, unknown>;
    const execId = execution["id"] as string;
    expect(execution["status"]).toBe("completed");

    // Fetch logs
    const logsRes = await api(`/api/executions/${execId}/logs`);
    expect(logsRes.status).toBe(200);

    const body = await logsRes.json() as Record<string, unknown>;
    expect(body["executionId"]).toBe(execId);
    expect(Array.isArray(body["entries"])).toBe(true);
    expect(typeof body["total"]).toBe("number");
  });

  it("GET /api/executions/nonexistent-id/logs returns 404", async () => {
    const res = await api("/api/executions/00000000-0000-0000-0000-000000000000/logs");
    expect(res.status).toBe(404);
  });
});
```

---

### Task 12: Add test script and bunfig.toml

**Files:**
- Modify: `package.json` (root)
- Create: `tests/smoke/bunfig.toml`

- [ ] **Step 1: Add `test:smoke` script to root `package.json`**

In the root `package.json` `scripts` object, add:

```json
"test:smoke": "bun test tests/smoke/"
```

The full `scripts` object should become:

```json
"scripts": {
  "start": "bun run packages/cli/src/index.ts start",
  "dev": "turbo dev",
  "build": "turbo build",
  "test": "turbo test",
  "test:smoke": "bun test tests/smoke/",
  "typecheck": "turbo typecheck",
  "clean": "turbo clean"
}
```

- [ ] **Step 2: Create `tests/smoke/bunfig.toml`**

```toml
[test]
timeout = 30000
```

---

### Verification

- [ ] **Run smoke tests:**

```bash
cd /path/to/baara-next
bun run test:smoke
```

Expected: all 10 test files run, boot/CRUD/sandbox tests pass unconditionally, chat/thread tests skip if `ANTHROPIC_API_KEY` is unset, execute/DLQ tests pass if `BAARA_SHELL_ENABLED=true`.

- [ ] **Confirm no typecheck regressions:**

```bash
bun run typecheck
```

Expected: all 10 packages pass.

# Plan B: Chat SSE Streaming

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Replace the 501 stub in `packages/server/src/routes/chat.ts` with full SSE streaming powered by the Agent SDK and the in-process MCP server from `packages/mcp`.

**Architecture:** Three new files compose a pipeline: `context.ts` reads live IStore state, `system-prompt.ts` assembles the dynamic prompt, and the rewritten `chat.ts` route drives Agent SDK `query()` and streams SSE events. Session management routes sit alongside the main chat endpoint.

**Tech Stack:** Hono `streamSSE`, `@anthropic-ai/claude-agent-sdk`, `@baara-next/mcp`, `@baara-next/core`

**Depends on:** Plan A (packages/mcp) and Plan D (Thread type + IStore thread methods) must be complete before implementing this plan.

---

### Task 1: Create packages/server/src/chat/context.ts

**Files:**
- Create: `packages/server/src/chat/context.ts`

- [ ] **Step 1: Create the file with the `ChatContext` type and `gatherChatContext` function.**

```typescript
// @baara-next/server — Chat context gathering
//
// Reads live IStore state for use in the dynamic system prompt.
// Keeps all DB access in one place so the prompt builder stays pure.

import type { IStore } from "@baara-next/core";
import type { Thread, Execution } from "@baara-next/core";

export interface ChatContext {
  // System-level counts
  totalTasks: number;
  enabledTasks: number;
  runningCount: number;
  queuedCount: number;
  failedCount: number;
  waitingForInputCount: number;

  // Queue health snapshot
  queues: Array<{
    name: string;
    depth: number;
    activeCount: number;
    maxConcurrency: number;
  }>;

  // Recent failures (last 5, most recent first)
  recentFailures: Array<{
    id: string;
    taskId: string;
    error: string | null;
    failedAt: string | null;
  }>;

  // Thread context (present only when threadId is supplied)
  thread: Thread | null;
  threadExecutions: Array<{
    id: string;
    taskId: string;
    status: string;
    durationMs: number | null;
    error: string | null;
    createdAt: string;
  }>;

  // Active project scoping (null if no project active in session)
  activeProjectId: string | null;
}

export function gatherChatContext(
  store: IStore,
  opts: { threadId?: string; activeProjectId?: string | null } = {}
): ChatContext {
  const tasks = store.listTasks();
  const executions = store.listExecutions();

  const runningCount = executions.filter((e) => e.status === "running").length;
  const queuedCount = executions.filter(
    (e) => e.status === "queued" || e.status === "assigned"
  ).length;
  const failedCount = executions.filter((e) => e.status === "failed").length;
  const waitingForInputCount = executions.filter(
    (e) => e.status === "waiting_for_input"
  ).length;

  // Last 5 failed executions sorted by createdAt desc
  const recentFailures: ChatContext["recentFailures"] = executions
    .filter((e) => e.status === "failed" && e.error)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 5)
    .map((e) => ({
      id: e.id,
      taskId: e.taskId,
      error: e.error ?? null,
      failedAt: e.completedAt ?? null,
    }));

  const queueInfos = store.listQueues();
  const queues: ChatContext["queues"] = queueInfos.map((q) => ({
    name: q.name,
    depth: q.depth,
    activeCount: q.activeCount,
    maxConcurrency: q.maxConcurrency,
  }));

  // Thread context — only populated when a threadId is provided
  let thread: Thread | null = null;
  let threadExecutions: ChatContext["threadExecutions"] = [];

  if (opts.threadId) {
    thread = store.getThread(opts.threadId) ?? null;
    if (thread) {
      const execs: Execution[] = store.listExecutionsByThread(opts.threadId);
      threadExecutions = execs.map((e) => ({
        id: e.id,
        taskId: e.taskId,
        status: e.status,
        durationMs: e.durationMs ?? null,
        error: e.error ?? null,
        createdAt: e.createdAt,
      }));
    }
  }

  return {
    totalTasks: tasks.length,
    enabledTasks: tasks.filter((t) => t.enabled).length,
    runningCount,
    queuedCount,
    failedCount,
    waitingForInputCount,
    queues,
    recentFailures,
    thread,
    threadExecutions,
    activeProjectId: opts.activeProjectId ?? null,
  };
}
```

---

### Task 2: Create packages/server/src/chat/system-prompt.ts

**Files:**
- Create: `packages/server/src/chat/system-prompt.ts`

- [ ] **Step 1: Create the file with `buildSystemPrompt`.**

```typescript
// @baara-next/server — Dynamic system prompt builder
//
// Builds the per-request system prompt by combining:
//   - Static identity and capability instructions
//   - Live state snapshot (running/queued/failed counts)
//   - Thread-specific execution history (when a threadId is active)

import type { ChatContext } from "./context.ts";

const TOOL_CATALOG = `
## Available Tools (27 total)

### Core — Task Management
- list_tasks         List all tasks with status, cron, and mode
- get_task           Get full task detail by name or ID
- create_task        Create a new task (returns inline card)
- update_task        Update task fields (returns inline card)
- delete_task        Delete a task
- toggle_task        Enable or disable a task (returns inline card)

### Core — Execution
- run_task           Execute a task immediately in direct mode
- submit_task        Submit a task to the queue
- list_executions    List executions with optional filters
- get_execution      Get execution detail (returns inline card)
- get_execution_events  Get event timeline for an execution
- cancel_execution   Cancel a running or queued execution
- retry_execution    Retry a failed execution (returns inline card)
- get_system_status  Get system health overview
- get_execution_logs Get filtered log output for an execution

### Operational — Queues & DLQ
- list_queues        List all queues with depth, active, and concurrency
- get_queue_info     Get detail for a single queue
- dlq_list           List dead-lettered executions
- dlq_retry          Retry a dead-lettered execution

### Operational — Human-in-the-Loop
- list_pending_input List executions waiting for human input
- provide_input      Provide a response to a blocked execution

### Power User — Templates & Projects
- list_templates     Browse reusable task templates
- create_task_from_template  Create a task from a template with field overrides
- list_projects      List all projects
- set_active_project Scope the session to a project

### Power User — Claude Code Integration
- discover_plugins   Discover Claude Code plugins, skills, and agents
- run_skill          Load and execute a Claude Code skill by name
`.trim();

const DEFAULTS = `
## Execution Defaults
- executionType: cloud_code (Claude Agent SDK)
- executionMode: queued (respects concurrency limits)
- priority: 2 (normal)
- maxRetries: 3
- timeoutMs: 300000 (5 minutes)

When a user asks you to "run" a task without specifying mode, prefer submit_task
(queued). Use run_task only when the user explicitly asks to run immediately or
says "now" / "directly".
`.trim();

function formatLiveState(ctx: ChatContext): string {
  const lines: string[] = [
    `## Live System State`,
    `- Running executions: ${ctx.runningCount}`,
    `- Queued executions:  ${ctx.queuedCount}`,
    `- Failed executions:  ${ctx.failedCount}`,
    `- Waiting for input:  ${ctx.waitingForInputCount}`,
    `- Total tasks:        ${ctx.totalTasks} (${ctx.enabledTasks} enabled)`,
  ];

  if (ctx.queues.length > 0) {
    lines.push("", "### Queue Depths");
    for (const q of ctx.queues) {
      lines.push(
        `- ${q.name}: depth=${q.depth} active=${q.activeCount}/${q.maxConcurrency}`
      );
    }
  }

  if (ctx.recentFailures.length > 0) {
    lines.push("", "### Recent Failures");
    for (const f of ctx.recentFailures) {
      const when = f.failedAt ? ` at ${f.failedAt}` : "";
      const errSnippet = f.error
        ? `  error: ${f.error.slice(0, 120)}${f.error.length > 120 ? "..." : ""}`
        : "";
      lines.push(`- execution ${f.id.slice(0, 8)} (task ${f.taskId.slice(0, 8)})${when}`);
      if (errSnippet) lines.push(`  ${errSnippet}`);
    }
  }

  if (ctx.activeProjectId) {
    lines.push("", `Active project scope: ${ctx.activeProjectId}`);
  }

  return lines.join("\n");
}

function formatThreadContext(ctx: ChatContext): string {
  if (!ctx.thread) return "";

  const lines: string[] = [
    "",
    `## Current Thread`,
    `Thread ID: ${ctx.thread.id}`,
    `Title: ${ctx.thread.title}`,
    `Created: ${ctx.thread.createdAt}`,
  ];

  if (ctx.threadExecutions.length > 0) {
    lines.push("", "### Executions in this Thread");
    for (const e of ctx.threadExecutions) {
      const dur = e.durationMs ? ` (${(e.durationMs / 1000).toFixed(1)}s)` : "";
      lines.push(`- ${e.id.slice(0, 8)} — ${e.status}${dur} — task ${e.taskId.slice(0, 8)}`);
      if (e.error && e.status === "failed") {
        lines.push(`  error: ${e.error.slice(0, 100)}`);
      }
    }
    lines.push(
      "",
      "When the user refers to prior executions or tasks without naming them explicitly, " +
        "assume they mean the executions listed above."
    );
  } else {
    lines.push("", "No executions have been created in this thread yet.");
  }

  return lines.join("\n");
}

export function buildSystemPrompt(ctx: ChatContext): string {
  return `You are BAARA Next, a durable agentic task execution assistant.

## Identity
You manage long-running tasks and executions on behalf of the user. Users describe
what they want in natural language and you create, run, monitor, and troubleshoot
tasks using your 27 built-in tools. You do not ask users to use an API or fill out
forms — you handle everything conversationally.

${TOOL_CATALOG}

${DEFAULTS}

## Inline Cards
When you create or retrieve structured data (Task, Execution, QueueInfo, InputRequest),
the frontend will render it as a rich inline card automatically. You do not need to
format these as markdown tables — just call the tool and the UI handles presentation.
For arrays of executions, call list_executions and the UI will render a compact table.

## Tone
- Concise and direct. Confirm actions after tools succeed.
- Proactively surface problems: if a tool returns an error, explain what failed and
  offer a fix.
- Never invent task IDs or execution IDs — always retrieve them with list_tasks or
  list_executions first.

${formatLiveState(ctx)}
${formatThreadContext(ctx)}`.trim();
}
```

---

### Task 3: Rewrite packages/server/src/routes/chat.ts

**Files:**
- Rewrite: `packages/server/src/routes/chat.ts`

- [ ] **Step 1: Replace the 501 stub with the full SSE streaming implementation.**

The route accepts `{ message, sessionId?, threadId? }`, builds context and system prompt, calls Agent SDK `query()` with streaming, and fans out SSE events. Session routes are mounted on the same router.

```typescript
// @baara-next/server — Chat routes (Phase 4)
//
// POST /api/chat                          — SSE streaming chat
// GET  /api/chat/sessions                 — list sessions
// GET  /api/chat/sessions/:id             — get session
// PUT  /api/chat/sessions/:id/rename      — rename session title

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { IStore } from "@baara-next/core";
import { createBaaraMcpServer } from "@baara-next/mcp";
import type { IOrchestratorService } from "@baara-next/core";
import { gatherChatContext } from "../chat/context.ts";
import { buildSystemPrompt } from "../chat/system-prompt.ts";

// ChatRoutes deps are threaded through from app.ts via chatRoutes(deps)
interface ChatDeps {
  store: IStore;
  orchestrator: IOrchestratorService;
  dataDir: string;
}

// ---------------------------------------------------------------------------
// Request / Response types
// ---------------------------------------------------------------------------

interface ChatRequest {
  message: string;
  sessionId?: string;
  threadId?: string;
  activeProjectId?: string | null;
}

// ---------------------------------------------------------------------------
// SSE event helpers
// ---------------------------------------------------------------------------

function sseEvent(type: string, data: unknown): string {
  return `data: ${JSON.stringify({ type, ...data })\n\n`;
}

// ---------------------------------------------------------------------------
// chatRoutes
// ---------------------------------------------------------------------------

export function chatRoutes(deps: ChatDeps): Hono {
  const router = new Hono();

  // -------------------------------------------------------------------------
  // POST /api/chat — main SSE streaming endpoint
  // -------------------------------------------------------------------------
  router.post("/", async (c) => {
    let body: ChatRequest;
    try {
      body = await c.req.json<ChatRequest>();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const { message, sessionId, threadId, activeProjectId } = body;
    if (!message || typeof message !== "string" || message.trim() === "") {
      return c.json({ error: "message is required" }, 400);
    }

    // Build context and system prompt synchronously before streaming starts
    const ctx = gatherChatContext(deps.store, { threadId, activeProjectId });
    const systemPrompt = buildSystemPrompt(ctx);

    // Create the in-process MCP server — new instance per request so tool
    // closures capture fresh store state
    const mcpServer = createBaaraMcpServer({
      store: deps.store,
      orchestrator: deps.orchestrator,
    });

    // Resolve or generate a session ID
    const resolvedSessionId = sessionId ?? crypto.randomUUID();

    return streamSSE(c, async (stream) => {
      // Send handshake event with resolved IDs so the client can persist them
      await stream.writeSSE({
        data: JSON.stringify({
          type: "system",
          sessionId: resolvedSessionId,
          threadId: threadId ?? null,
          toolCount: 27,
        }),
      });

      try {
        const sdkStream = query({
          prompt: message.trim(),
          systemPrompt,
          sessionId: resolvedSessionId,
          maxTurns: 20,
          budgetUsd: 0.5,
          mcpServers: { baara: mcpServer },
        });

        for await (const event of sdkStream) {
          switch (event.type) {
            case "text_delta":
              await stream.writeSSE({
                data: JSON.stringify({ type: "text_delta", delta: event.delta }),
              });
              break;

            case "tool_use":
              await stream.writeSSE({
                data: JSON.stringify({
                  type: "tool_use",
                  name: event.name,
                  input: event.input,
                }),
              });
              break;

            case "tool_result":
              await stream.writeSSE({
                data: JSON.stringify({
                  type: "tool_result",
                  name: event.name,
                  output: event.output,
                }),
              });
              break;

            case "result":
              await stream.writeSSE({
                data: JSON.stringify({
                  type: "result",
                  usage: {
                    inputTokens: event.usage?.inputTokens ?? 0,
                    outputTokens: event.usage?.outputTokens ?? 0,
                  },
                  cost: event.cost ?? null,
                }),
              });
              break;

            default:
              // Forward any other event types for forward compatibility
              await stream.writeSSE({
                data: JSON.stringify({ type: event.type }),
              });
          }
        }
      } catch (err) {
        console.error("[chat] stream error", err);
        await stream.writeSSE({
          data: JSON.stringify({
            type: "error",
            message: err instanceof Error ? err.message : "Stream failed",
          }),
        });
      } finally {
        await stream.writeSSE({ data: JSON.stringify({ type: "done" }) });
      }
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/chat/sessions — list all sessions (threads with session metadata)
  // -------------------------------------------------------------------------
  router.get("/sessions", (c) => {
    const threads = deps.store.listThreads();
    return c.json(threads);
  });

  // -------------------------------------------------------------------------
  // GET /api/chat/sessions/:id — get a single session / thread
  // -------------------------------------------------------------------------
  router.get("/sessions/:id", (c) => {
    const id = c.req.param("id");
    const thread = deps.store.getThread(id);
    if (!thread) {
      return c.json({ error: "Session not found" }, 404);
    }
    return c.json(thread);
  });

  // -------------------------------------------------------------------------
  // PUT /api/chat/sessions/:id/rename — rename a thread title
  // -------------------------------------------------------------------------
  router.put("/sessions/:id/rename", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json<{ title: string }>().catch(() => null);
    if (!body?.title || typeof body.title !== "string") {
      return c.json({ error: "title is required" }, 400);
    }
    const thread = deps.store.getThread(id);
    if (!thread) {
      return c.json({ error: "Session not found" }, 404);
    }
    const updated = deps.store.updateThread(id, { title: body.title.trim() });
    return c.json(updated);
  });

  return router;
}
```

---

### Task 4: Update packages/server/src/app.ts to pass deps to chatRoutes

**Files:**
- Modify: `packages/server/src/app.ts`

The current `app.ts` calls `chatRoutes()` with no arguments. Now that `chatRoutes` accepts `deps`, update the mount call and add `dataDir` to `AppDeps`.

- [ ] **Step 1: Add `dataDir` to the `AppDeps` interface.**

Find the `AppDeps` interface block and add `dataDir` after `allowedOrigins`:

```typescript
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
  dataDir: string;
}
```

- [ ] **Step 2: Update the chatRoutes mount call** to pass deps. Replace:

```typescript
  app.route("/api/chat", chatRoutes());
```

with:

```typescript
  app.route("/api/chat", chatRoutes({ store: deps.store, orchestrator: deps.orchestrator, dataDir: deps.dataDir }));
```

---

### Task 5: Update packages/cli/src/commands/start.ts to pass dataDir to createApp

**Files:**
- Modify: `packages/cli/src/commands/start.ts`

- [ ] **Step 1: Thread `dataDir` through to `createApp`.** Find the `createApp(...)` call in `start.ts` and add `dataDir` to the deps object:

```typescript
const { app, rateLimitCleanupHandle } = createApp({
  orchestrator,
  store,
  devTransport,
  dataDir,
});
```

---

### Task 6: Wire the rate limiter to session mutation endpoints in app.ts

**Files:**
- Modify: `packages/server/src/app.ts`

- [ ] **Step 1: Add the session rename endpoint to rate limiting.** After the existing `app.use("/api/chat", rlMiddleware)` line, add:

```typescript
  app.use("/api/chat/sessions/:id/rename", rlMiddleware);
```

---

## Verification

After completing all tasks, verify the following manually or with `bun run`:

1. `curl -X POST http://localhost:3000/api/chat -H 'Content-Type: application/json' -d '{"message":"list my tasks"}' --no-buffer` — should produce SSE lines beginning with `data: {"type":"system",...}` followed by `text_delta` events.
2. A `tool_use` event with `name: "list_tasks"` should appear followed by a `tool_result` event.
3. A `result` event with `usage.inputTokens > 0` should appear.
4. A final `done` event should close the stream.
5. `GET /api/chat/sessions` returns `[]` initially, then populates after a chat.
6. `PUT /api/chat/sessions/:id/rename` with `{"title":"My first thread"}` returns the updated thread.
7. TypeScript typechecks cleanly: `bunx tsc --noEmit` from the repo root.

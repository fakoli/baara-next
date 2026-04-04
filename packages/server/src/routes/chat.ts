// @baara-next/server — Chat routes (Phase 4)
//
// POST /api/chat                          — SSE streaming chat
// GET  /api/chat/sessions                 — list sessions (threads)
// GET  /api/chat/sessions/:id             — get session (thread)
// PUT  /api/chat/sessions/:id/rename      — rename session title

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { IStore, IOrchestratorService } from "@baara-next/core";
import { createBaaraMcpServer } from "@baara-next/mcp";
import { gatherChatContext } from "../chat/context.ts";
import { buildSystemPrompt } from "../chat/system-prompt.ts";

// ---------------------------------------------------------------------------
// ChatDeps — threaded through from app.ts via chatRoutes(deps)
// ---------------------------------------------------------------------------

export interface ChatDeps {
  store: IStore;
  orchestrator: IOrchestratorService;
  dataDir: string;
}

// ---------------------------------------------------------------------------
// Request types
// ---------------------------------------------------------------------------

interface ChatRequest {
  message: string;
  sessionId?: string;
  threadId?: string;
  activeProjectId?: string | null;
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

    const { message, sessionId, activeProjectId } = body;
    let { threadId } = body;
    if (!message || typeof message !== "string" || message.trim() === "") {
      return c.json({ error: "message is required" }, 400);
    }

    // Create a new thread when none is provided so every conversation is
    // persisted from the very first turn.
    if (!threadId) {
      const title = message.trim().slice(0, 60);
      const newThread = deps.store.createThread(crypto.randomUUID(), title);
      threadId = newThread.id;
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

    // Persist the user message before streaming starts so it is always
    // recorded even if the client disconnects mid-stream.
    deps.store.appendThreadMessage({
      id: crypto.randomUUID(),
      threadId: threadId,
      role: "user",
      content: message.trim(),
      toolCalls: "[]",
    });

    return streamSSE(c, async (stream) => {
      let eventId = 0;

      const abortController = new AbortController();
      stream.onAbort(() => {
        abortController.abort();
      });

      // Send handshake event so the client can persist the session/thread IDs.
      // threadId is always non-null here because we created one above.
      await stream.writeSSE({
        event: "message",
        id: String(eventId++),
        data: JSON.stringify({
          type: "system",
          sessionId: resolvedSessionId,
          threadId: threadId,
          toolCount: 27,
        }),
      });

      // Accumulators for persisting the agent response after streaming.
      let agentText = "";
      const agentToolCalls: Array<{ name: string; input: unknown; output: unknown | null }> = [];

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const options: Record<string, unknown> = {
          systemPrompt,
          mcpServers: { baara: mcpServer },
          permissionMode: "bypassPermissions",
          allowDangerouslySkipPermissions: true,
          maxTurns: 20,
          maxBudgetUsd: 0.5,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          abortController: abortController as any,
        };

        // Resume existing session when sessionId provided
        if (sessionId) {
          options.resume = sessionId;
        } else {
          options.sessionId = resolvedSessionId;
        }

        for await (const msg of query({
          prompt: message.trim(),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          options: options as any,
        })) {
          // --- System init message (MCP status, tool count, session ID) ---
          if (msg.type === "system" && "subtype" in msg && (msg as { subtype?: string }).subtype === "init") {
            // Already sent our own system event above; forward the SDK session_id
            // in case it differs from our generated one.
            const sdkSessionId = (msg as { session_id?: string }).session_id;
            if (sdkSessionId && sdkSessionId !== resolvedSessionId) {
              await stream.writeSSE({
                event: "message",
                id: String(eventId++),
                data: JSON.stringify({
                  type: "system",
                  sessionId: sdkSessionId,
                  threadId: threadId,
                  toolCount: 27,
                }),
              });
            }
            continue;
          }

          // --- Full assistant message (complete turn) ---
          if (msg.type === "assistant") {
            const contentBlocks = (msg as { message: { content: Array<{ type: string; text?: string; name?: string; input?: unknown; content?: unknown; is_error?: boolean }> } }).message.content;
            for (const block of contentBlocks) {
              if (block.type === "text" && block.text) {
                await stream.writeSSE({
                  event: "message",
                  id: String(eventId++),
                  data: JSON.stringify({ type: "text", content: block.text }),
                });
              } else if (block.type === "tool_use" || block.type === "mcp_tool_use") {
                agentToolCalls.push({ name: block.name ?? "", input: block.input ?? {}, output: null });
                await stream.writeSSE({
                  event: "message",
                  id: String(eventId++),
                  data: JSON.stringify({
                    type: "tool_use",
                    name: block.name,
                    input: block.input,
                  }),
                });
              } else if (block.type === "mcp_tool_result") {
                // Fill output for the most recent tool call with this name.
                for (let i = agentToolCalls.length - 1; i >= 0; i--) {
                  if (agentToolCalls[i]!.name === block.name && agentToolCalls[i]!.output === null) {
                    agentToolCalls[i] = { ...agentToolCalls[i]!, output: block.content };
                    break;
                  }
                }
                await stream.writeSSE({
                  event: "message",
                  id: String(eventId++),
                  data: JSON.stringify({
                    type: "tool_result",
                    name: block.name,
                    output: block.content,
                    isError: block.is_error ?? false,
                  }),
                });
              }
            }
            continue;
          }

          // --- Partial streaming (real-time text deltas as they arrive) ---
          if (msg.type === "stream_event") {
            const event = (msg as { event: { type: string; delta?: { type: string; text?: string } } }).event;
            if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
              agentText += event.delta.text ?? "";
              await stream.writeSSE({
                event: "message",
                id: String(eventId++),
                data: JSON.stringify({
                  type: "text_delta",
                  delta: event.delta.text ?? "",
                }),
              });
            }
            continue;
          }

          // --- Final result message ---
          if (msg.type === "result") {
            const resultMsg = msg as {
              type: "result";
              subtype?: string;
              result?: string;
              is_error: boolean;
              usage: { input_tokens: number; output_tokens: number };
              total_cost_usd: number;
              duration_ms: number;
            };

            // Persist the completed agent message for history replay.
            // Use result.result as the canonical text when available (it is the
            // full response text); fall back to the accumulated delta text.
            const finalText = resultMsg.result ?? agentText;
            if (finalText || agentToolCalls.length > 0) {
              try {
                deps.store.appendThreadMessage({
                  id: crypto.randomUUID(),
                  threadId: threadId,
                  role: "agent",
                  content: finalText,
                  toolCalls: JSON.stringify(agentToolCalls),
                });
              } catch (persistErr) {
                // Non-fatal: log but don't break the stream response.
                console.error("[chat] failed to persist agent message", persistErr);
              }
            }

            await stream.writeSSE({
              event: "message",
              id: String(eventId++),
              data: JSON.stringify({
                type: "result",
                text: resultMsg.result ?? null,
                isError: resultMsg.is_error,
                usage: {
                  inputTokens: resultMsg.usage.input_tokens,
                  outputTokens: resultMsg.usage.output_tokens,
                },
                cost: resultMsg.total_cost_usd,
                durationMs: resultMsg.duration_ms,
              }),
            });
            continue;
          }
        }
      } catch (err) {
        console.error("[chat] stream error", err);
        await stream.writeSSE({
          event: "message",
          id: String(eventId++),
          data: JSON.stringify({
            type: "error",
            message: err instanceof Error ? err.message : "Stream failed",
          }),
        });
      } finally {
        await stream.writeSSE({
          event: "done",
          id: String(eventId++),
          data: JSON.stringify({ type: "done" }),
        });
      }
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/chat/sessions — list all sessions (threads)
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
  // GET /api/chat/sessions/:id/messages — chat history for a thread
  //
  // Returns all persisted chat turns (user + agent) in chronological order.
  // The web client calls this when the user selects an existing thread in the
  // sidebar so it can replay the conversation.
  // -------------------------------------------------------------------------
  router.get("/sessions/:id/messages", (c) => {
    const id = c.req.param("id");
    const thread = deps.store.getThread(id);
    if (!thread) {
      return c.json({ error: "Session not found" }, 404);
    }
    const messages = deps.store.listThreadMessages(id);
    return c.json(messages);
  });

  // -------------------------------------------------------------------------
  // PUT /api/chat/sessions/:id/rename — rename a thread title
  // -------------------------------------------------------------------------
  router.put("/sessions/:id/rename", async (c) => {
    const id = c.req.param("id");
    let body: { title?: string } | null = null;
    try {
      body = await c.req.json<{ title: string }>();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
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

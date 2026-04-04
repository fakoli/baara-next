// @baara-next/server — Chat routes (Phase 4)
//
// POST /api/chat                          — SSE streaming chat
// POST /api/chat/permission               — resolve a pending tool permission request
// GET  /api/chat/sessions                 — list sessions (threads)
// GET  /api/chat/sessions/:id             — get session (thread)
// PUT  /api/chat/sessions/:id/rename      — rename session title

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { query, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import type { IStore, IOrchestratorService } from "@baara-next/core";
import { createAllTools } from "@baara-next/mcp";
import type { McpTool } from "@baara-next/mcp";
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
// Permission mode types
// ---------------------------------------------------------------------------

type PermissionMode = "auto" | "ask" | "locked";

// ---------------------------------------------------------------------------
// Pending permission resolution store (process-wide, keyed by requestId)
// ---------------------------------------------------------------------------

/**
 * Maps requestId → { resolve, sessionId }.
 * When the client calls POST /api/chat/permission, the resolver is invoked
 * with the decision string, unblocking the paused tool handler.
 * sessionId is verified against the POST body to prevent cross-session spoofing.
 */
const pendingPermissions = new Map<string, { resolve: (decision: string) => void; sessionId: string }>();

// ---------------------------------------------------------------------------
// Request types
// ---------------------------------------------------------------------------

interface ChatRequest {
  message: string;
  sessionId?: string;
  threadId?: string;
  activeProjectId?: string | null;
  /** Controls tool execution behaviour for this request */
  permissionMode?: PermissionMode;
  /** Claude model to use for this request */
  model?: string;
  /** Custom system instructions prepended to the base system prompt */
  systemInstructions?: string;
}

// ---------------------------------------------------------------------------
// Permission-aware MCP server factory
// ---------------------------------------------------------------------------

/**
 * Build an in-process MCP server whose tool handlers check permissions
 * before executing when permissionMode is "ask" or "locked".
 *
 * In "ask" mode every tool pauses and emits a permission_request SSE event,
 * then awaits a POST /api/chat/permission call before continuing.
 *
 * In "locked" mode only tools in approvedTools run; all others are denied
 * immediately without user interaction.
 */
function createPermissionAwareMcpServer(
  permissionMode: PermissionMode,
  approvedTools: Set<string>,
  sessionId: string,
  abortController: AbortController,
  sendPermissionRequest: (requestId: string, toolName: string, toolInput: Record<string, unknown>) => Promise<void>,
  baseTools: McpTool[]
) {
  if (permissionMode === "auto") {
    return createSdkMcpServer({ name: "baara-next", tools: baseTools });
  }

  // Wrap each tool handler with a permission check
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wrappedTools: McpTool[] = baseTools.map((tool) => ({
    ...tool,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handler: async (args: Record<string, unknown>, extra: unknown): Promise<any> => {
      const toolName = tool.name;

      // "locked" mode: only pre-approved tools run
      if (permissionMode === "locked") {
        if (!approvedTools.has(toolName)) {
          return {
            content: [
              {
                type: "text",
                text: `Tool "${toolName}" was denied: running in locked mode and this tool has not been pre-approved.`,
              },
            ],
            isError: true,
          };
        }
        // Pre-approved — fall through to execution
        return tool.handler(args, extra);
      }

      // "ask" mode: emit a permission request event and wait for user response
      if (permissionMode === "ask") {
        // Already approved for this task — skip the prompt
        if (approvedTools.has(toolName)) {
          return tool.handler(args, extra);
        }

        const requestId = crypto.randomUUID();
        const toolInput = args as Record<string, unknown>;

        // Send the SSE event and wait for the user's decision.
        // Register an abort listener to clean up the Map entry if the client
        // disconnects while the permission is pending (#1).
        let decision: string;
        try {
          decision = await new Promise<string>((resolve, reject) => {
            const cleanup = setTimeout(() => {
              if (pendingPermissions.delete(requestId)) {
                reject(new Error("Permission request timed out"));
              }
            }, 5 * 60 * 1000);

            pendingPermissions.set(requestId, { resolve: (d: string) => { clearTimeout(cleanup); resolve(d); }, sessionId });
            // Fire-and-forget the SSE emission (it's async but we don't await here
            // to avoid a promise ordering issue — the Map entry is set first)
            void sendPermissionRequest(requestId, toolName, toolInput);
            abortController.signal.addEventListener("abort", () => {
              clearTimeout(cleanup);
              if (pendingPermissions.delete(requestId)) {
                reject(new Error("Client disconnected"));
              }
            }, { once: true });
          });
        } catch {
          // Client disconnected — treat as a deny so the tool is not executed
          return {
            content: [
              {
                type: "text",
                text: `Tool "${toolName}" permission cancelled: client disconnected.`,
              },
            ],
            isError: true,
          };
        }

        if (decision === "deny") {
          return {
            content: [
              {
                type: "text",
                text: `Tool "${toolName}" was denied by the user.`,
              },
            ],
            isError: true,
          };
        }

        if (decision === "allow_task") {
          approvedTools.add(toolName);
        }

        return tool.handler(args, extra);
      }

      // Fallback: just execute
      return tool.handler(args, extra);
    },
  }));

  return createSdkMcpServer({ name: "baara-next", tools: wrappedTools });
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

    const { message, sessionId, activeProjectId, model, systemInstructions } = body;
    let { threadId } = body;
    if (!message || typeof message !== "string" || message.trim() === "") {
      return c.json({ error: "message is required" }, 400);
    }

    // Validate permissionMode — reject unknown values outright (#4)
    const validModes: PermissionMode[] = ["auto", "ask", "locked"];
    const rawMode = body.permissionMode;
    if (rawMode !== undefined && !validModes.includes(rawMode as PermissionMode)) {
      return c.json({ error: "permissionMode must be auto | ask | locked" }, 400);
    }
    const permissionMode: PermissionMode = (rawMode as PermissionMode | undefined) ?? "auto";

    // Validate systemInstructions length (#3)
    const MAX_SYSTEM_INSTRUCTIONS = 4000;
    if (systemInstructions && systemInstructions.length > MAX_SYSTEM_INSTRUCTIONS) {
      return c.json({ error: "systemInstructions too long" }, 400);
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
    const basePrompt = buildSystemPrompt(ctx);
    // Prepend custom user instructions when provided, wrapped in XML tags (#3).
    // Escape < and > so user-supplied text cannot inject or close the wrapper tag.
    const systemPrompt = systemInstructions?.trim()
      ? (() => {
          const safeInstructions = systemInstructions.trim()
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
          return `<user_instructions>\n${safeInstructions}\n</user_instructions>\n\n${basePrompt}`;
        })()
      : basePrompt;

    // Resolve or generate a session ID
    const resolvedSessionId = sessionId ?? crypto.randomUUID();

    // Compute the actual tool count so the handshake event is accurate (#6)
    const allTools = createAllTools({ store: deps.store, orchestrator: deps.orchestrator });
    const toolCount = allTools.length;

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
          toolCount,
        }),
      });

      // Accumulators for persisting the agent response after streaming.
      let agentText = "";
      const agentToolCalls: Array<{ name: string; input: unknown; output: unknown | null }> = [];

      try {
        // Per-request approved-tools set for "Allow for task" decisions
        const approvedTools = new Set<string>();

        // Helper: emit a permission_request SSE event and register the resolver
        async function sendPermissionRequest(
          requestId: string,
          toolName: string,
          toolInput: Record<string, unknown>
        ): Promise<void> {
          await stream.writeSSE({
            event: "message",
            id: String(eventId++),
            data: JSON.stringify({
              type: "permission_request",
              requestId,
              toolName,
              toolInput,
            }),
          });
        }

        // Build the MCP server — permission-aware when mode is ask/locked,
        // plain bypass when auto.
        const mcpServer = createPermissionAwareMcpServer(
          permissionMode,
          approvedTools,
          resolvedSessionId,
          abortController,
          sendPermissionRequest,
          allTools
        );

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const options: Record<string, unknown> = {
          systemPrompt,
          mcpServers: { baara: mcpServer },
          // Always bypass the SDK's own permission layer — we implement our own
          // in the wrapped tool handlers above.
          permissionMode: "bypassPermissions",
          allowDangerouslySkipPermissions: true,
          maxTurns: 20,
          maxBudgetUsd: 0.5,
          ...(model ? { model } : {}),
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
                  toolCount,
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
  // POST /api/chat/permission — resolve a pending tool permission request
  //
  // Body: { requestId: string; sessionId: string; decision: "allow" | "allow_task" | "deny" }
  // -------------------------------------------------------------------------
  router.post("/permission", async (c) => {
    let body: { requestId?: string; sessionId?: string; decision?: string };
    try {
      body = await c.req.json<{ requestId: string; sessionId: string; decision: string }>();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    const { requestId, sessionId: bodySessionId, decision } = body;
    if (!requestId || typeof requestId !== "string") {
      return c.json({ error: "requestId is required" }, 400);
    }
    if (!bodySessionId || typeof bodySessionId !== "string") {
      return c.json({ error: "sessionId is required" }, 400);
    }
    if (!decision || !["allow", "allow_task", "deny"].includes(decision)) {
      return c.json({ error: "decision must be allow | allow_task | deny" }, 400);
    }
    const entry = pendingPermissions.get(requestId);
    if (!entry) {
      return c.json({ error: "No pending permission request found for that requestId" }, 404);
    }
    // Verify the request belongs to the calling session (#2)
    if (entry.sessionId !== bodySessionId) {
      return c.json({ error: "sessionId does not match the pending request" }, 403);
    }
    pendingPermissions.delete(requestId);
    entry.resolve(decision);
    return c.json({ ok: true });
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

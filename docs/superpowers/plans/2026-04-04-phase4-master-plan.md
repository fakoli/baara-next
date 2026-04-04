# Phase 4 Master Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the chat-centric web UI, 27-tool MCP server, SSE chat streaming, thread model, and CLI chat — turning BAARA Next from a working engine into a user-facing product.

**Architecture:** Five independent sub-plans executed by fakoli-crew agents. Plans A+D run in parallel (no dependencies), then B+E in parallel (depend on A), then C (depends on B). Each plan produces working, testable software. Critic reviews after each plan completes.

**Tech Stack:** TypeScript/Bun, Hono, React/Vite/Zustand/Tailwind, Pretext, Claude Agent SDK (`tool()` + `createSdkMcpServer()`), Zod

---

## Execution Order

```
Wave 1 (parallel):
  Plan A: MCP Server + 27 Tools    → welder agent
  Plan D: Thread Model + Schema    → welder agent

Wave 2 (parallel, after A+D complete):
  Plan B: Chat SSE Streaming       → welder agent
  Plan E: stdio MCP + CLI chat     → welder agent

Wave 3 (after B complete):
  Plan C: Web UI Rewrite           → welder + guido agents

After each wave: critic review → fix → next wave
```

## Sub-Plan Files

| Plan | File | Scope |
|------|------|-------|
| A | `2026-04-04-phase4-plan-a-mcp-server.md` | `packages/mcp` — 27 tool definitions, in-process server, HTTP endpoint |
| B | `2026-04-04-phase4-plan-b-chat-streaming.md` | `packages/server/src/routes/chat.ts` — SSE streaming, system prompt, context gathering |
| C | `2026-04-04-phase4-plan-c-web-ui.md` | `packages/web` — chat-centric layout rewrite, inline cards, Pretext, thread sidebar |
| D | `2026-04-04-phase4-plan-d-thread-model.md` | `packages/core`, `packages/store` — threads table, thread_id on executions, CRUD |
| E | `2026-04-04-phase4-plan-e-cli-mcp.md` | `packages/cli` — `baara mcp-server` stdio command, `baara chat` REPL |

## Crew Assignment

| Agent | Role | Plans |
|-------|------|-------|
| **welder** (x3) | Implementation | A, B, D, E (parallel where possible) |
| **guido** | TypeScript design review on types/interfaces | A (tool types), D (thread types) |
| **critic** | Post-wave review | After each wave |
| **sentinel** | Final validation | After all waves |

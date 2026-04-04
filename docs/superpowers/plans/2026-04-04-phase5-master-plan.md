# Phase 5 Master Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the multi-engine executor with a single-engine (Claude Code SDK) + pluggable sandbox architecture, add durable communication (MessageBus), conversation-level checkpointing, JSONL logging, and real-time streaming.

**Architecture:** One execution engine (Claude Code SDK `query()`) wrapped by containerd-style pluggable sandboxes (Native, Wasm/Extism, Docker stub). Hybrid communication: WebSocket for real-time streaming, SQLite queue for durable commands. Conversation-level checkpointing for crash recovery.

**Tech Stack:** TypeScript/Bun, @extism/extism, @anthropic-ai/claude-agent-sdk, SQLite, WebSocket

---

## Execution Order

```
Wave 1 (parallel):
  Plan A: Core types + ISandbox + SandboxRegistry    → welder
  Plan B: Communication layer (MessageBus + migration) → welder

Wave 2 (parallel, after A+B):
  Plan C: Durability (checkpointing + recovery)       → welder
  Plan D: Sandbox implementations (Native + Wasm + Docker) → welder

Wave 3 (after C+D):
  Plan E: JSONL logging + WebSocket + MCP/CLI/Web updates → welder

After each wave: critic review → fix → next wave
```

## Sub-Plan Files

| Plan | File | Lines | Tasks | Scope |
|------|------|-------|-------|-------|
| A | `phase5-plan-a-sandbox-types.md` | 1,418 | 6 | Core types, ISandbox, SandboxRegistry |
| B | `phase5-plan-b-communication.md` | 1,260 | 5 | IMessageBus, task_messages table, MessageBus |
| C | `phase5-plan-c-durability.md` | 1,251 | 7 | CheckpointService, recovery, health monitor |
| D | `phase5-plan-d-sandbox-implementations.md` | 1,549 | 7 | NativeSandbox, WasmSandbox, DockerSandbox |
| E | `phase5-plan-e-logging-integration.md` | 1,498 | 8 | LogWriter, migration, MCP/CLI/Web updates |

**Total: 6,976 lines, 33 tasks**

## Crew Assignment

| Agent | Role | Plans |
|-------|------|-------|
| **welder** (x2-3) | Implementation | All plans |
| **critic** | Post-wave review | After each wave |
| **sentinel** | Final validation | After all waves |

# Durability

BAARA Next provides crash recovery through conversation-level checkpointing.
This document explains the checkpoint model, how recovery works, and how this
approach compares to Temporal's replay-based durability.

---

## Why Checkpoint-Based, Not Replay-Based

Temporal provides durable execution for deterministic workflows: every
function call is recorded; on crash the function is re-executed from the top
and previous results are memoized. This works because Temporal code must be
deterministic — the same inputs always produce the same outputs.

LLM agents are non-deterministic. Running the same prompt twice produces
different output each time. Replay-based durability is impossible for agents:
there is nothing to memoize, and re-replaying tool calls (creating files,
sending emails, calling APIs) causes duplicate side effects.

BAARA Next instead checkpoints the **conversation history** — the accumulated
message context built up over completed turns. On recovery, the agent receives
the prior context as message history and a recovery system prompt explaining
it is resuming. Recovery is O(1) regardless of how many turns preceded the crash.

---

## Temporal Comparison

| Property | Temporal | BAARA Next |
|----------|----------|------------|
| Recovery mechanism | Replay from event log | Load last checkpoint + inject context |
| Determinism required | Yes — code must be pure | No — agents are inherently non-deterministic |
| Recovery cost | O(history) — replays all prior events | O(1) — loads single checkpoint row |
| Tool call memoization | Yes — no duplicate side effects | No — idempotency is agent's responsibility |
| State store | Temporal cluster (separate service) | SQLite `task_messages` table (in-process) |
| Workflow definition | Temporal workflow DSL | Natural language prompt |
| Language requirement | Java, Go, TypeScript SDK | TypeScript on Bun |
| Infrastructure | Temporal server + workers | Single `bun start` |

---

## Checkpoint Model

A `Checkpoint` is a snapshot of the conversation state at a point in time:

```typescript
interface Checkpoint {
  id: string;
  executionId: string;
  /** Number of completed assistant turns at checkpoint time. */
  turnCount: number;
  /** Full Claude API message history accumulated so far. */
  conversationHistory: ConversationMessage[];
  /** Names of tool calls that were in-flight at checkpoint time. */
  pendingToolCalls: string[];
  /** Opaque SDK session metadata. */
  agentState: Record<string, unknown>;
  timestamp: string;
}
```

Checkpoints are stored in the `task_messages` SQLite table as `outbound`
messages with `messageType: "checkpoint"`. Multiple checkpoints may exist per
execution — only the most recent matters.

---

## CheckpointService

`CheckpointService` runs inside a `SandboxInstance`. It is called by the
execution loop after each completed agent turn.

```typescript
class CheckpointService {
  constructor(config: {
    executionId: string;
    messageBus: IMessageBus;
    intervalTurns?: number;          // default: 5
    getConversationHistory: () => ConversationMessage[];
    getPendingToolCalls?: () => string[];
  });

  /** Called after every turn. Writes a checkpoint every intervalTurns turns. */
  onTurnComplete(turnCount: number): void;

  /** Write a checkpoint immediately regardless of the interval. */
  checkpoint(turnCount: number): void;
}
```

`onTurnComplete(n)` writes a checkpoint when `n % intervalTurns === 0`. With
the default `intervalTurns: 5`, checkpoints are written at turns 5, 10, 15, …

Checkpoints are also written unconditionally on:
- HITL pause (before blocking on user input)
- Clean execution completion (final state snapshot)
- Any explicit call to `cs.checkpoint(turnCount)`

---

## Recovery Flow

The recovery flow runs when the OrchestratorService detects a crashed or
unresponsive execution.

```
1. Health monitor detects execution stuck in "running" with no heartbeat
   → marks execution healthStatus: "unresponsive"
   → calls orchestrator.recoverExecution(executionId)

2. Load latest checkpoint
   checkpoint = messageBus.readLatestCheckpoint(executionId)

3. Build recovery params
   params = prepareRecoveryParams(checkpoint, {
     executionId,
     prompt: task.prompt,        // original user prompt
     agentConfig: task.agentConfig,
     timeout: task.timeoutMs,
     tools: task.agentConfig?.allowedTools ?? [],
   })
   // params.checkpoint = the loaded checkpoint
   // params.agentConfig.systemPrompt = RECOVERY CONTEXT prefix + original systemPrompt

4. Create new execution row
   newExecution = store.createExecution(...)
   store.updateExecutionStatus(newExecution.id, "queued")

5. New execution is picked up by the agent service and dispatched
   The sandbox receives checkpoint in SandboxExecuteParams
   → NativeSandboxInstance passes conversationHistory to the SDK
   → Agent receives recovery system prompt:
     "RECOVERY CONTEXT: This is a resumed execution. You completed N turns
      before the session was interrupted. Please check the current state
      and continue from where you left off."
```

---

## Recovery System Prompt

`buildRecoveryPrompt(checkpoint)` generates the recovery context block:

```
RECOVERY CONTEXT: This is a resumed execution. You were previously working on
this task and completed 10 turns before the session was interrupted.

No tool calls were in flight at checkpoint time.
The last user instruction was: "Generate a report of all open issues..."

Please check the current state and continue from where you left off. Do not
repeat work that has already been completed — verify the current state first,
then proceed.
---
```

This block is prepended to any existing `agentConfig.systemPrompt`.

---

## What IS Recovered

After a crash and recovery:

- The **conversation history** up to the last checkpoint is passed to the SDK.
  The agent can see all prior turns, tool calls, and results.
- The **turn count** at which recovery happened is included in the recovery
  system prompt.
- The **last user message** (first 200 characters) is included as a reminder.
- The **pending tool calls** at checkpoint time are listed (informational — the
  agent decides whether to retry them).

---

## What Is NOT Recovered

- **In-flight tool call results** after the last checkpoint. If the agent was
  in the middle of turn 7 when it crashed and the last checkpoint was at turn 5,
  turns 6 and 7 are replayed from the agent's perspective. Any side effects from
  those turns (files written, API calls made) must be handled by the agent's
  idempotency logic — BAARA Next does not memoize them.
- **WebSocket streams**. Clients connected at crash time lose their SSE
  connection. They must reconnect to observe the recovered execution.
- **Agent SDK session files**. The recovered execution starts a new SDK session
  with injected history. The old session file is orphaned.

---

## IMessageBus: Checkpoint Storage

Checkpoints are written and read through `IMessageBus`:

```typescript
interface IMessageBus {
  /** Persist a checkpoint as an outbound task_messages row. */
  writeCheckpoint(executionId: string, checkpoint: Checkpoint): void;

  /** Load the most recently written checkpoint, or null if none exists. */
  readLatestCheckpoint(executionId: string): Checkpoint | null;
}
```

`readLatestCheckpoint` uses a single `SELECT ... ORDER BY created_at DESC
LIMIT 1` query — O(1) regardless of checkpoint count.

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

// @baara-next/core — Shared Entity Types

// ---------------------------------------------------------------------------
// Primitive union types
// ---------------------------------------------------------------------------

/** Task priority: 0 = critical, 1 = high, 2 = normal, 3 = low. */
export type Priority = 0 | 1 | 2 | 3;

/**
 * @deprecated Use `SandboxType` instead.
 * Kept for backward compatibility while downstream consumers migrate.
 */
export type ExecutionType = "cloud_code" | "wasm" | "wasm_edge" | "shell";

// ---------------------------------------------------------------------------
// Sandbox type system (replaces ExecutionType)
// ---------------------------------------------------------------------------

/** The isolation layer wrapping the Claude Code SDK agent. */
export type SandboxType = "native" | "wasm" | "docker";

/**
 * Per-sandbox isolation configuration stored as a JSON blob on Task.
 * Discriminated by `type` to allow strongly-typed per-sandbox settings.
 */
export type SandboxConfig =
  | { type: "native" }
  | {
      type: "wasm";
      /** Allow outbound network access (to Claude API). Default: true. */
      networkEnabled?: boolean;
      /** Wasm memory ceiling in MB. Default: 512. */
      maxMemoryMb?: number;
      /** CPU utilisation cap as a percentage (0–100). Default: 80. */
      maxCpuPercent?: number;
      /** Ports exposed from the sandbox. */
      ports?: number[];
    }
  | {
      type: "docker";
      /** Container image. Default: "baara-next/sandbox:latest". */
      image?: string;
      /** Allow outbound network access. Default: true. */
      networkEnabled?: boolean;
      /** Ports exposed from the container. */
      ports?: number[];
      /** Host paths to bind-mount into the container. */
      volumeMounts?: string[];
    };

/** Whether the task bypasses the queue (`direct`) or is enqueued for a worker (`queued`). */
export type ExecutionMode = "direct" | "queued";

/**
 * Full 11-state lifecycle for an execution.
 *
 * Terminal states: completed | cancelled | dead_lettered
 */
export type ExecutionStatus =
  | "created"
  | "queued"
  | "assigned"
  | "running"
  | "waiting_for_input"
  | "completed"
  | "failed"
  | "timed_out"
  | "cancelled"
  | "retry_scheduled"
  | "dead_lettered";

/** Reported liveness of a running execution as observed by the health monitor. */
export type HealthStatus = "healthy" | "slow" | "unresponsive";

/** Named durable queues managed by the orchestrator. */
export type QueueName = "transfer" | "timer" | "visibility" | "dlq";

/** Capabilities an agent runtime may advertise. */
export type RuntimeCapability =
  | "gpu"
  | "network"
  | "filesystem"
  | "llm"
  | "sandbox";

// ---------------------------------------------------------------------------
// AgentConfig — Claude Code SDK settings only
// ---------------------------------------------------------------------------

/** Per-server MCP configuration forwarded to the Agent SDK. */
export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

/**
 * Configuration for the Claude Code SDK agent.
 * All fields optional — absent values use SDK defaults.
 * Stored as a JSON blob on Task.
 */
export interface AgentConfig {
  /** Claude model identifier. Default: "claude-sonnet-4-20250514". */
  model?: string;
  /** Tool names the agent is permitted to invoke. */
  allowedTools?: string[];
  /** Maximum agent turns (soft limit). */
  maxTurns?: number;
  /** Spending cap for the execution in USD. */
  budgetUsd?: number;
  /** Claude permission mode string. Default: "default". */
  permissionMode?: string;
  /** Additional system prompt text prepended to the base prompt. */
  systemPrompt?: string;
  /** Named MCP server configs, serialised as JSON in the DB. */
  mcpServers?: Record<string, McpServerConfig>;
}

// ---------------------------------------------------------------------------
// Task
// ---------------------------------------------------------------------------

/**
 * A persisted task definition. Tasks are templates for executions; they are
 * not themselves stateful — all runtime state lives on `Execution`.
 */
export interface Task {
  id: string;
  name: string;
  description: string;
  prompt: string;
  /** Optional cron expression for scheduled recurring execution. */
  cronExpression?: string;
  /** Maximum wall-clock time allowed per execution attempt in milliseconds. */
  timeoutMs: number;
  /**
   * @deprecated Use `sandboxType` instead.
   * Kept for backward compatibility during Phase 5 migration.
   */
  executionType: ExecutionType;
  /**
   * The sandbox isolation layer to use. Replaces `executionType`.
   * Optional during Phase 5 migration; will be required after store migration.
   */
  sandboxType?: SandboxType;
  /**
   * Per-sandbox isolation settings (JSON blob in SQLite).
   * Optional during Phase 5 migration; will be required after store migration.
   */
  sandboxConfig?: SandboxConfig;
  /**
   * Claude Code SDK settings (JSON blob in SQLite).
   * Null means use system defaults; non-null for explicit overrides.
   */
  agentConfig: AgentConfig | null;
  priority: Priority;
  targetQueue: string;
  maxRetries: number;
  executionMode: ExecutionMode;
  enabled: boolean;
  /** Optional grouping; null means the task belongs to no project. */
  projectId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTaskInput {
  name: string;
  description?: string;
  prompt: string;
  cronExpression?: string | null;
  timeoutMs?: number;
  /** @deprecated Use `sandboxType` instead. */
  executionType?: ExecutionType;
  sandboxType?: SandboxType;
  sandboxConfig?: SandboxConfig;
  agentConfig?: AgentConfig | null;
  priority?: Priority;
  targetQueue?: string;
  maxRetries?: number;
  executionMode?: ExecutionMode;
  enabled?: boolean;
  projectId?: string | null;
}

export interface UpdateTaskInput {
  name?: string;
  description?: string;
  prompt?: string;
  cronExpression?: string | null;
  timeoutMs?: number;
  /** @deprecated Use `sandboxType` instead. */
  executionType?: ExecutionType;
  sandboxType?: SandboxType;
  sandboxConfig?: SandboxConfig;
  agentConfig?: AgentConfig | null;
  priority?: Priority;
  targetQueue?: string;
  maxRetries?: number;
  executionMode?: ExecutionMode;
  enabled?: boolean;
  projectId?: string | null;
}

// ---------------------------------------------------------------------------
// Execution  (was "Job" in BAARA v1)
// ---------------------------------------------------------------------------

/**
 * One attempt to run a `Task`. An execution moves through `ExecutionStatus`
 * states according to the transitions defined in `src/state-machine.ts`.
 *
 * A single task may produce many executions over its lifetime (retries,
 * scheduled recurrence, manual re-runs).
 */
export interface Execution {
  id: string;
  taskId: string;
  queueName: string;
  priority: Priority;
  status: ExecutionStatus;
  /** Attempt number, starting at 1. */
  attempt: number;
  scheduledAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  durationMs?: number | null;
  output?: string | null;
  error?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  healthStatus: HealthStatus;
  /** Number of agent turns completed so far. */
  turnCount: number;
  /** Opaque JSON blob for mid-execution checkpoint/resume data. */
  checkpointData?: string | null;
  /** Thread this execution belongs to, if created via chat. */
  threadId?: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// InputRequest
// ---------------------------------------------------------------------------

/**
 * A human-in-the-loop pause: the agent has asked for user input and the
 * execution is `waiting_for_input` until a response arrives or the timeout
 * expires.
 */
export interface InputRequest {
  id: string;
  executionId: string;
  prompt: string;
  /** Suggested response options shown to the operator; free-form if absent. */
  options?: string[];
  /** Additional context serialised from the agent's state at time of request. */
  context?: string;
  response?: string | null;
  status: "pending" | "responded" | "timed_out";
  timeoutMs: number;
  createdAt: string;
  respondedAt?: string | null;
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

/**
 * A reusable agent configuration preset that can be applied when creating
 * new tasks, stored independently of any specific task.
 */
export interface Template {
  id: string;
  name: string;
  description: string;
  /** Stored as a JSON blob. */
  agentConfig: AgentConfig;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTemplateInput {
  name: string;
  description?: string;
  agentConfig: AgentConfig;
}

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

/**
 * A logical grouping of tasks. Projects carry a working directory and
 * per-project system prompt additions that are merged at runtime.
 */
export interface Project {
  id: string;
  name: string;
  description: string;
  /** Additional instructions prepended to the agent system prompt for all tasks in this project. */
  instructions: string;
  /** Working directory for task executions that belong to this project. */
  workingDirectory: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectInput {
  name: string;
  description?: string;
  instructions?: string;
  workingDirectory?: string;
}

// ---------------------------------------------------------------------------
// Thread
// ---------------------------------------------------------------------------

/**
 * A logical grouping of a conversation and its linked executions.
 * Threads map to Agent SDK sessions stored at ~/.baara/sessions/.
 */
export interface Thread {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// QueueInfo
// ---------------------------------------------------------------------------

/**
 * Snapshot of queue depth and capacity, returned by store and API for
 * monitoring dashboards.
 */
export interface QueueInfo {
  name: string;
  depth: number;
  activeCount: number;
  maxConcurrency: number;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Checkpoint and ConversationMessage
// ---------------------------------------------------------------------------

/**
 * A content block in a conversation message (mirrors Claude API structure).
 */
export interface ContentBlock {
  type: "text" | "tool_use" | "tool_result";
  [key: string]: unknown;
}

/**
 * A single message in a conversation history.
 */
export interface ConversationMessage {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

/**
 * A conversation-level checkpoint. Written periodically by the sandbox to
 * `task_messages` so execution can resume after a crash.
 */
export interface Checkpoint {
  id: string;
  executionId: string;
  turnCount: number;
  conversationHistory: ConversationMessage[];
  /** Names of tool calls that were in-flight at checkpoint time. */
  pendingToolCalls: string[];
  /** Opaque SDK session metadata. */
  agentState: Record<string, unknown>;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// SandboxEvent — real-time event stream from a running sandbox
// ---------------------------------------------------------------------------

/**
 * Events emitted by a running SandboxInstance.
 * Consumed by the orchestrator WebSocket broadcaster and JSONL log writer.
 */
export type SandboxEvent =
  | { type: "log"; level: "info" | "warn" | "error" | "debug"; message: string; timestamp: string }
  | { type: "text_delta"; delta: string }
  | { type: "tool_use"; name: string; input: unknown }
  | { type: "tool_result"; name: string; output: unknown; isError: boolean }
  | { type: "hitl_request"; prompt: string; options?: string[] }
  | { type: "checkpoint"; checkpoint: Checkpoint }
  | { type: "turn_complete"; turnCount: number; inputTokens: number; outputTokens: number };

// ---------------------------------------------------------------------------
// InboundCommand — commands sent to a running execution
// ---------------------------------------------------------------------------

/**
 * Commands delivered to a running execution via the SQLite message queue.
 * Includes HITL responses, additional prompts, and pause/resume signals.
 */
export type InboundCommand =
  | { type: "command"; prompt: string }
  | { type: "hitl_response"; response: string }
  | { type: "pause" }
  | { type: "resume" };

// ---------------------------------------------------------------------------
// TaskMessage — a row in task_messages
// ---------------------------------------------------------------------------

/**
 * A persisted row in the task_messages table. Used by IStore and IMessageBus
 * to pass durable messages between the orchestrator and running sandboxes.
 */
export interface TaskMessage {
  id: string;
  executionId: string;
  direction: "inbound" | "outbound";
  messageType: string;
  payload: string;
  status: "pending" | "delivered" | "acknowledged";
  createdAt: string;
}

/**
 * Input for inserting a new task_messages row.
 */
export interface SendMessageInput {
  id: string;
  executionId: string;
  direction: "inbound" | "outbound";
  messageType: string;
  payload: string;
}

// ---------------------------------------------------------------------------
// ThreadMessage — a row in thread_messages (chat history)
// ---------------------------------------------------------------------------

/**
 * A persisted chat turn stored in the thread_messages table.
 * Written by the chat SSE route as messages stream in; replayed when the
 * user clicks an old thread in the sidebar.
 */
export interface ThreadMessage {
  id: string;
  threadId: string;
  role: "user" | "agent";
  /** Accumulated text content of the message. */
  content: string;
  /** Serialised tool call array (JSON string). Empty array when no tools were used. */
  toolCalls: string;
  createdAt: string;
}

/**
 * Input for inserting a new thread_messages row.
 */
export interface AppendThreadMessageInput {
  id: string;
  threadId: string;
  role: "user" | "agent";
  content: string;
  /** Pre-serialised JSON string of the tool calls array. */
  toolCalls: string;
}

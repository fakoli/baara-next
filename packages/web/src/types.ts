// Mirror of @baara-next/core types for the web frontend

export type Priority = 0 | 1 | 2 | 3;
export type ExecutionType = 'cloud_code' | 'wasm' | 'wasm_edge' | 'shell';
export type ExecutionMode = 'direct' | 'queued';
export type ExecutionStatus =
  | 'created'
  | 'queued'
  | 'assigned'
  | 'running'
  | 'waiting_for_input'
  | 'completed'
  | 'failed'
  | 'timed_out'
  | 'cancelled'
  | 'retry_scheduled'
  | 'dead_lettered';
export type HealthStatus = 'healthy' | 'slow' | 'unresponsive';
export type QueueName = 'transfer' | 'timer' | 'visibility' | 'dlq';

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface AgentConfig {
  model?: string;
  allowedTools?: string[];
  permissionMode?: string;
  maxTurns?: number;
  budgetUsd?: number;
  mcpServers?: Record<string, McpServerConfig>;
}

export interface Task {
  id: string;
  name: string;
  description: string;
  prompt: string;
  cronExpression?: string;
  timeoutMs: number;
  executionType: ExecutionType;
  agentConfig: AgentConfig | null;
  priority: Priority;
  targetQueue: string;
  maxRetries: number;
  executionMode: ExecutionMode;
  enabled: boolean;
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
  executionType?: ExecutionType;
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
  executionType?: ExecutionType;
  agentConfig?: AgentConfig | null;
  priority?: Priority;
  targetQueue?: string;
  maxRetries?: number;
  executionMode?: ExecutionMode;
  enabled?: boolean;
  projectId?: string | null;
}

export interface Execution {
  id: string;
  taskId: string;
  queueName: string;
  priority: Priority;
  status: ExecutionStatus;
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
  turnCount: number;
  checkpointData?: string | null;
  /** Thread this execution belongs to, if created via chat. */
  threadId?: string | null;
  createdAt: string;
}

export interface InputRequest {
  id: string;
  executionId: string;
  prompt: string;
  options?: string[];
  context?: string;
  response?: string | null;
  status: 'pending' | 'responded' | 'timed_out';
  timeoutMs: number;
  createdAt: string;
  respondedAt?: string | null;
}

export interface QueueInfo {
  name: string;
  depth: number;
  activeCount: number;
  maxConcurrency: number;
  createdAt: string;
}

export interface ExecutionEvent {
  id: string;
  executionId: string;
  eventSeq: number;
  type: string;
  timestamp: string;
  [key: string]: unknown;
}

export interface SystemStatus {
  uptime: number;
  version: string;
  queues: Record<string, { depth: number; active: number }>;
  totals: {
    queued: number;
    active: number;
    deadLettered: number;
    waitingForInput: number;
  };
}

// ---------------------------------------------------------------------------
// Thread
// ---------------------------------------------------------------------------

export interface Thread {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * A persisted chat turn from the thread_messages table.
 * Returned by GET /api/chat/sessions/:id/messages for history replay.
 */
export interface ThreadMessage {
  id: string;
  threadId: string;
  role: 'user' | 'agent';
  content: string;
  /** JSON-serialised array of tool calls */
  toolCalls: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Chat / SSE
// ---------------------------------------------------------------------------

export type SSEEventType =
  | 'system'
  | 'text'
  | 'text_delta'
  | 'tool_use'
  | 'tool_result'
  | 'result'
  | 'error'
  | 'done'
  | 'permission_request';

export type PermissionMode = 'auto' | 'ask' | 'locked';

export interface SSESystemEvent {
  type: 'system';
  sessionId: string;
  threadId: string | null;
  toolCount: number;
}

export interface SSETextEvent {
  type: 'text';
  content: string;
}

export interface SSETextDeltaEvent {
  type: 'text_delta';
  delta: string;
}

export interface SSEToolUseEvent {
  type: 'tool_use';
  name: string;
  input: Record<string, unknown>;
}

export interface SSEToolResultEvent {
  type: 'tool_result';
  name: string;
  output: unknown;
}

export interface SSEResultEvent {
  type: 'result';
  usage: { inputTokens: number; outputTokens: number };
  cost: number | null;
}

export interface SSEErrorEvent {
  type: 'error';
  message: string;
}

export interface SSEDoneEvent {
  type: 'done';
}

export interface SSEPermissionRequestEvent {
  type: 'permission_request';
  requestId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
}

export type SSEEvent =
  | SSESystemEvent
  | SSETextEvent
  | SSETextDeltaEvent
  | SSEToolUseEvent
  | SSEToolResultEvent
  | SSEResultEvent
  | SSEErrorEvent
  | SSEDoneEvent
  | SSEPermissionRequestEvent;

// ---------------------------------------------------------------------------
// Chat messages (local UI model)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Phase 5: Sandbox architecture
// ---------------------------------------------------------------------------

export type SandboxType = "native" | "wasm" | "docker";

export type SandboxConfig =
  | { type: "native" }
  | {
      type: "wasm";
      networkEnabled?: boolean;
      maxMemoryMb?: number;
      maxCpuPercent?: number;
      ports?: number[];
    }
  | {
      type: "docker";
      image?: string;
      networkEnabled?: boolean;
      ports?: number[];
      volumeMounts?: string[];
    };

// Updated Task shape — sandboxType + sandboxConfig coexist with executionType
// for backward compatibility.
export interface TaskV2 extends Omit<Task, "executionType"> {
  sandboxType: SandboxType;
  sandboxConfig: SandboxConfig | null;
  executionType?: ExecutionType; // kept for compat
}

export interface CreateTaskInputV2 extends Omit<CreateTaskInput, "executionType"> {
  sandboxType?: SandboxType;
  sandboxConfig?: SandboxConfig | null;
  executionType?: ExecutionType; // deprecated alias
}

export interface UpdateTaskInputV2 extends Omit<UpdateTaskInput, "executionType"> {
  sandboxType?: SandboxType;
  sandboxConfig?: SandboxConfig | null;
  executionType?: ExecutionType; // deprecated alias
}

// ---------------------------------------------------------------------------
// Phase 5: Log streaming
// ---------------------------------------------------------------------------

export interface LogEntry {
  ts: string;
  level: "info" | "warn" | "error" | "debug";
  msg: string;
  executionId: string;
  threadId?: string;
  meta?: Record<string, unknown>;
}

// New WebSocket event types for real-time log streaming.
export interface WsExecutionLogEvent {
  type: "execution_log";
  executionId: string;
  level: string;
  message: string;
  timestamp: string;
}

export interface WsExecutionTextDeltaEvent {
  type: "execution_text_delta";
  executionId: string;
  delta: string;
}

export interface WsExecutionToolEvent {
  type: "execution_tool_event";
  executionId: string;
  eventType: "tool_use" | "tool_result";
  name: string;
  data: unknown;
}

// Extended WsEvent union including Phase 5 event types.
export type WsEvent =
  | { type: "execution_status_changed"; executionId: string; taskId: string; status: string; timestamp: string }
  | { type: "queue_depth_changed"; queueName: string; depth: number; activeCount: number; timestamp: string }
  | WsExecutionLogEvent
  | WsExecutionTextDeltaEvent
  | WsExecutionToolEvent;

// ---------------------------------------------------------------------------
// Chat messages (local UI model)
// ---------------------------------------------------------------------------

export type ChatMessageRole = 'user' | 'agent';

export interface ChatMessage {
  id: string;
  role: ChatMessageRole;
  /** Accumulated text content */
  text: string;
  /** Tool calls attached to this agent turn */
  toolCalls: Array<{
    name: string;
    input: Record<string, unknown>;
    output: unknown | null;
  }>;
  /** Final token usage (only on agent messages, after 'result' event) */
  usage?: { inputTokens: number; outputTokens: number };
  cost?: number | null;
  /** Whether this message is still streaming */
  streaming: boolean;
  createdAt: string;
}

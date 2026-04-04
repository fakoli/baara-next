// @baara-next/core — Public API barrel
//
// Import from "@baara-next/core" to access all shared types, events, errors,
// the state machine, and interface contracts.  Nothing here has runtime
// behaviour beyond the error classes and the state machine transition map.

// --- Types ---
export type {
  Priority,
  ExecutionType,
  ExecutionMode,
  ExecutionStatus,
  HealthStatus,
  QueueName,
  RuntimeCapability,
  McpServerConfig,
  AgentConfig,
  Task,
  CreateTaskInput,
  UpdateTaskInput,
  Execution,
  InputRequest,
  Template,
  CreateTemplateInput,
  Project,
  CreateProjectInput,
  QueueInfo,
  Thread,
  // Phase 5: Sandbox type system
  SandboxType,
  SandboxConfig,
  ContentBlock,
  ConversationMessage,
  Checkpoint,
  SandboxEvent,
  InboundCommand,
  // Phase 5: Communication layer
  TaskMessage,
  SendMessageInput,
  // Chat history
  ThreadMessage,
  AppendThreadMessageInput,
} from "./types.ts";

// --- Events ---
export type {
  BaseEvent,
  ExecutionEvent,
  EventOfType,
  ExecutionCreated,
  ExecutionQueued,
  ExecutionAssigned,
  ExecutionStarted,
  TurnStarted,
  TurnCompleted,
  ToolInvoked,
  ToolCompleted,
  CheckpointCreated,
  HeartbeatReceived,
  InputRequested,
  InputProvided,
  InputTimedOut,
  ExecutionCompleted,
  ExecutionFailed,
  ExecutionTimedOut,
  ExecutionCancelled,
  RetryScheduled,
  RetryStarted,
  DeadLettered,
} from "./events.ts";

// --- Errors ---
export {
  BaaraError,
  TaskNotFoundError,
  ExecutionNotFoundError,
  ProjectNotFoundError,
  TemplateNotFoundError,
  ThreadNotFoundError,
  InvalidStateTransitionError,
  QueueFullError,
  BudgetExceededError,
  TimeoutError,
  InputTimeoutError,
  InputRequestNotFoundError,
  DuplicateEntityError,
} from "./errors.ts";

// --- State machine ---
export {
  VALID_TRANSITIONS,
  validateTransition,
  allowedTransitions,
  isTerminal,
} from "./state-machine.ts";

// --- Interfaces ---
export type {
  IOrchestratorService,
  TaskAssignment,
  IAgentService,
  IRuntime,
  ExecuteParams,
  ExecuteResult,
  RuntimeConfig,
  ResourceLimits,
  IStore,
  ITransport,
  // Phase 5: Sandbox interfaces
  ISandbox,
  SandboxInstance,
  SandboxExecuteResult,
  SandboxStartConfig,
  SandboxExecuteParams,
  // Phase 5: Communication layer
  IMessageBus,
  PendingCommand,
} from "./interfaces/index.ts";

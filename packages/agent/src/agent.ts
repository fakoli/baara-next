// @baara-next/agent — AgentService
//
// Long-lived worker that polls for tasks, executes them using the appropriate
// runtime, reports results, and never crashes the poll loop on a per-task error.

import type {
  IAgentService,
  IRuntime,
  ITransport,
  TaskAssignment,
  ExecuteResult,
  RuntimeCapability,
} from "@baara-next/core";
import { createContext } from "./context.ts";
import { createHeartbeat } from "./checkpoint.ts";

// Poll-loop back-off when there is no available work, in ms.
const POLL_BACKOFF_MS = 2_000;

// ---------------------------------------------------------------------------
// AgentService
// ---------------------------------------------------------------------------

/**
 * Implements `IAgentService`: polls for tasks, delegates execution to the
 * matching `IRuntime`, and reports results back via the transport.
 */
export class AgentService implements IAgentService {
  readonly agentId: string;

  private running = false;
  private currentTask: Promise<void> | null = null;
  private readonly runtimes: Map<string, IRuntime>;

  /**
   * @param transport - Communication channel to the orchestrator.
   * @param runtimes  - All registered runtimes.  The agent will advertise
   *                    their combined capabilities when polling.
   */
  constructor(
    private readonly transport: ITransport,
    runtimes: IRuntime[],
  ) {
    this.agentId = crypto.randomUUID();
    this.runtimes = new Map(runtimes.map((r) => [r.name, r]));
  }

  // -------------------------------------------------------------------------
  // IAgentService — lifecycle
  // -------------------------------------------------------------------------

  async start(): Promise<void> {
    if (this.running) return; // idempotent
    this.running = true;
    this.runLoop().catch(() => {
      // runLoop is intentionally long-lived and internally handles errors;
      // a rejection here means `stop()` was called or a programming bug
      // surfaced.  Either way we just let the loop terminate.
    });
  }

  async stop(): Promise<void> {
    this.running = false;
    // Wait for any in-flight task so we don't abandon it mid-way.
    if (this.currentTask) {
      await this.currentTask;
    }
  }

  // -------------------------------------------------------------------------
  // IAgentService — polling and execution
  // -------------------------------------------------------------------------

  async pollTask(): Promise<TaskAssignment | null> {
    return this.transport.pollTask(this.agentId, this.allCapabilities());
  }

  async executeTask(assignment: TaskAssignment): Promise<ExecuteResult> {
    const ctx = createContext(assignment);
    const task = assignment.task;

    // --- Select runtime ---
    const runtime = this.selectRuntimeForTask(task);
    if (!runtime) {
      return {
        status: "failed",
        error: `No runtime registered for task "${task.name}" (sandbox: ${task.sandboxType ?? "unknown"})`,
        durationMs: 0,
      };
    }

    // --- Heartbeat ---
    const heartbeat = createHeartbeat(
      this.transport,
      this.agentId,
      ctx.executionId,
      () => ctx.turnCount,
    );
    heartbeat.start();

    try {
      // Signal the orchestrator that we are starting work (assigned → running).
      await this.transport.startExecution(ctx.executionId);

      const result = await runtime.execute({
        executionId: ctx.executionId,
        task,
        timeout: task.timeoutMs,
      });

      // Shell and wasm runtimes complete in a single synchronous batch — there
      // is no per-turn callback, so we record the whole execution as 1 turn.
      // For cloud_code runtimes the Agent SDK manages turns internally via
      // agentConfig.maxTurns; ctx.turnCount is not incremented there because
      // the SDK does not surface per-turn callbacks to this layer.
      if (task.executionType !== "cloud_code") {
        ctx.turnCount = 1;
      }

      return result;
    } finally {
      heartbeat.stop();
    }
  }

  async heartbeat(executionId: string, turnCount: number): Promise<void> {
    await this.transport.heartbeat(this.agentId, executionId, turnCount);
  }

  async requestInput(
    executionId: string,
    prompt: string,
    options?: string[],
  ): Promise<string> {
    return this.transport.requestInput(executionId, prompt, options);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /** Collect all capabilities across every registered runtime. */
  private allCapabilities(): RuntimeCapability[] {
    const seen = new Set<RuntimeCapability>();
    for (const runtime of this.runtimes.values()) {
      for (const cap of runtime.capabilities) {
        seen.add(cap);
      }
    }
    return Array.from(seen);
  }

  /**
   * Select the appropriate runtime for a task.
   *
   * Fast path: if the task only has the Bash tool (or no tools), use ShellRuntime
   * for direct execution without an LLM call. This handles simple "echo hello" tasks.
   *
   * Agent path: if the task has multiple tools or needs agent reasoning, use
   * CloudCodeRuntime which calls the Claude Code SDK query().
   */
  private selectRuntimeForTask(task: { executionType: string; agentConfig: unknown }): IRuntime | undefined {
    const agentConfig = (task.agentConfig ?? {}) as Record<string, unknown>;
    const tools = (agentConfig.allowedTools ?? []) as string[];

    // If only Bash tool (or empty tools list), use shell runtime for fast execution
    const isSimpleShellTask = tools.length === 0 || (tools.length === 1 && tools[0] === "Bash");
    if (isSimpleShellTask && this.runtimes.has("shell")) {
      return this.runtimes.get("shell");
    }

    // Otherwise use the full agent SDK (cloud_code runtime)
    return this.runtimes.get(task.executionType) ?? this.runtimes.get("cloud_code");
  }

  /** Main poll-execute-report loop.  Never throws; runs until `running` is false. */
  private async runLoop(): Promise<void> {
    while (this.running) {
      const assignment = await this.pollTask().catch(() => null);

      if (!assignment) {
        // No work available — back off briefly.
        await sleep(POLL_BACKOFF_MS);
        continue;
      }

      // Track the in-flight task so stop() can await it.
      let resolve!: () => void;
      this.currentTask = new Promise<void>((res) => {
        resolve = res;
      });

      try {
        const result = await this.executeTask(assignment);
        await this.transport.completeExecution(assignment.executionId, result);
      } catch (err) {
        // Per-task errors must not kill the loop.  Report failure and continue.
        const message =
          err instanceof Error ? err.message : String(err);
        await this.transport
          .completeExecution(assignment.executionId, {
            status: "failed",
            error: message,
            durationMs: 0,
          })
          .catch(() => {
            // If even the error report fails, log and move on.
            console.error(
              `[agent:${this.agentId}] Failed to report error for execution ${assignment.executionId}:`,
              err,
            );
          });
      } finally {
        this.currentTask = null;
        resolve();
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// @baara-next/executor — Shell runtime
//
// Runs the task prompt as a shell script via `Bun.spawn(["sh", "-c", prompt])`.
// Ported from BAARA v1's `executeRawCode()`.

import type {
  IRuntime,
  RuntimeCapability,
  RuntimeConfig,
  ExecuteParams,
  ExecuteResult,
} from "@baara-next/core";

export class ShellRuntime implements IRuntime {
  readonly name = "shell";
  readonly capabilities: readonly RuntimeCapability[] = [
    "filesystem",
    "network",
  ];

  // Map from executionId → running subprocess so cancel() can kill it.
  private readonly procs = new Map<string, ReturnType<typeof Bun.spawn>>();

  // When true, all execute() calls immediately return a failed result.
  // Set to true in initialize() when BAARA_SHELL_ENABLED != "true".
  private disabled = false;

  async initialize(_config: RuntimeConfig): Promise<void> {
    const enabled = process.env.BAARA_SHELL_ENABLED;
    if (enabled !== "true") {
      this.disabled = true;
      console.warn("[ShellRuntime] Disabled. Set BAARA_SHELL_ENABLED=true to enable arbitrary code execution.");
    } else {
      console.warn("[ShellRuntime] WARNING: Shell runtime allows arbitrary code execution. Ensure API authentication is enabled (BAARA_API_KEY) in production.");
    }
  }

  async execute(params: ExecuteParams): Promise<ExecuteResult> {
    if (this.disabled) {
      return {
        status: "failed",
        error: "Shell runtime is disabled. Set BAARA_SHELL_ENABLED=true to enable.",
        durationMs: 0,
      };
    }

    const start = Date.now();
    const { executionId, task, timeout } = params;

    let proc: ReturnType<typeof Bun.spawn> | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;

    try {
      proc = Bun.spawn(["sh", "-c", task.prompt], {
        cwd: (task as unknown as { workingDirectory?: string }).workingDirectory ?? process.cwd(),
        stdout: "pipe",
        stderr: "pipe",
      });

      this.procs.set(executionId, proc);

      killTimer = setTimeout(() => {
        timedOut = true;
        proc?.kill();
      }, timeout);

      const exitCode = await proc.exited;
      clearTimeout(killTimer);

      const stdout = await Bun.readableStreamToText(
        proc.stdout as ReadableStream,
      );
      const stderr = await Bun.readableStreamToText(
        proc.stderr as ReadableStream,
      );

      const durationMs = Date.now() - start;

      if (timedOut) {
        return {
          status: "timed_out",
          error: `Exceeded timeout of ${timeout}ms`,
          durationMs,
        };
      }

      if (exitCode === 0) {
        return { status: "completed", output: stdout, durationMs };
      }

      return {
        status: "failed",
        error: stderr || `Exit code ${exitCode}`,
        output: stdout,
        durationMs,
      };
    } catch (err) {
      clearTimeout(killTimer);
      const durationMs = Date.now() - start;
      return {
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
        durationMs,
      };
    } finally {
      this.procs.delete(executionId);
    }
  }

  async cancel(executionId: string): Promise<void> {
    this.procs.get(executionId)?.kill();
  }

  async healthCheck(): Promise<{ status: "healthy" }> {
    return { status: "healthy" };
  }

  async shutdown(): Promise<void> {
    // Kill any still-running subprocesses.
    for (const proc of this.procs.values()) {
      try {
        proc.kill();
      } catch {
        // Ignore — process may have already exited.
      }
    }
    this.procs.clear();
  }
}

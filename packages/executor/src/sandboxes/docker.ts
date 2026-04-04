// @baara-next/executor/sandboxes — DockerSandbox
//
// Container isolation sandbox. Runs the agent prompt directly inside a Docker
// container via `docker run --rm`. For shell-only tasks this is sufficient;
// for full Claude Code SDK tasks a pre-built image with the SDK is needed.

import type {
  ISandbox,
  SandboxInstance,
  SandboxStartConfig,
  SandboxExecuteParams,
  SandboxExecuteResult,
  SandboxEvent,
  InboundCommand,
  SandboxConfig,
} from "@baara-next/core";
import { randomUUID } from "node:crypto";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Docker config (defaults applied)
// ---------------------------------------------------------------------------

type RawDockerConfig = Extract<SandboxConfig, { type: "docker" }>;

/** Docker-specific config with defaults filled in. */
export interface ResolvedDockerConfig {
  image: string;
  networkEnabled: boolean;
  ports: number[];
  volumeMounts: string[];
}

function resolveDockerConfig(raw: RawDockerConfig): ResolvedDockerConfig {
  return {
    image: raw.image ?? "node:22-slim",
    networkEnabled: raw.networkEnabled ?? true,
    ports: raw.ports ?? [],
    volumeMounts: raw.volumeMounts ?? [],
  };
}

// ---------------------------------------------------------------------------
// DockerSandbox
// ---------------------------------------------------------------------------

export class DockerSandbox implements ISandbox {
  readonly name = "docker" as const;
  readonly description = "Docker container sandbox for isolated agent execution";

  async isAvailable(): Promise<boolean> {
    try {
      const proc = Bun.spawn(["docker", "info"], {
        stdout: "ignore",
        stderr: "ignore",
      });
      const code = await proc.exited;
      return code === 0;
    } catch {
      return false;
    }
  }

  async start(config: SandboxStartConfig): Promise<SandboxInstance> {
    const available = await this.isAvailable();
    if (!available) {
      throw new Error(
        "Docker is not available. Install Docker and ensure the daemon is running."
      );
    }
    const rawConfig = config.sandboxConfig as RawDockerConfig;
    return new DockerSandboxInstance(config.executionId, rawConfig);
  }

  async stop(instance: SandboxInstance): Promise<void> {
    await instance.cancel();
  }
}

// ---------------------------------------------------------------------------
// DockerSandboxInstance
// ---------------------------------------------------------------------------

export class DockerSandboxInstance implements SandboxInstance {
  readonly id: string;
  readonly sandboxType = "docker" as const;

  /** Exposed for tests and observability. */
  readonly resolvedConfig: ResolvedDockerConfig;

  // Unique container name assigned at execute() time so cancel() can stop it.
  private containerName: string | null = null;
  private proc: ReturnType<typeof Bun.spawn> | null = null;
  private cancelled = false;

  // Event queue — execute() pushes, events iterator pops.
  private readonly eventQueue: SandboxEvent[] = [];
  private readonly eventResolvers: Array<
    (value: IteratorResult<SandboxEvent>) => void
  > = [];
  private done = false;

  constructor(executionId: string, rawConfig: RawDockerConfig) {
    this.id = executionId;
    this.resolvedConfig = resolveDockerConfig(rawConfig);
  }

  // -------------------------------------------------------------------------
  // SandboxInstance.events — async iterable (push/pull queue pattern)
  // -------------------------------------------------------------------------

  get events(): AsyncIterable<SandboxEvent> {
    const self = this;
    return {
      [Symbol.asyncIterator](): AsyncIterator<SandboxEvent> {
        return {
          next(): Promise<IteratorResult<SandboxEvent>> {
            if (self.eventQueue.length > 0) {
              return Promise.resolve({
                value: self.eventQueue.shift()!,
                done: false,
              });
            }
            if (self.done) {
              return Promise.resolve({
                value: undefined as unknown as SandboxEvent,
                done: true,
              });
            }
            return new Promise<IteratorResult<SandboxEvent>>((resolve) => {
              self.eventResolvers.push(resolve);
            });
          },
        };
      },
    };
  }

  private pushEvent(event: SandboxEvent): void {
    if (this.eventResolvers.length > 0) {
      const resolve = this.eventResolvers.shift()!;
      resolve({ value: event, done: false });
    } else {
      this.eventQueue.push(event);
    }
  }

  private closeEvents(): void {
    this.done = true;
    for (const resolve of this.eventResolvers) {
      resolve({ value: undefined as unknown as SandboxEvent, done: true });
    }
    this.eventResolvers.length = 0;
  }

  // -------------------------------------------------------------------------
  // SandboxInstance.execute()
  // -------------------------------------------------------------------------

  async execute(params: SandboxExecuteParams): Promise<SandboxExecuteResult> {
    const start = Date.now();
    const config = this.resolvedConfig;

    // Assign a unique container name so cancel() can `docker stop` it reliably.
    // Container names must match [a-zA-Z0-9_-].
    this.containerName = `baara-${params.executionId.replace(/[^a-zA-Z0-9_-]/g, "-")}-${randomUUID().slice(0, 8)}`;
    const containerName = this.containerName;

    this.pushEvent({
      type: "log",
      level: "info",
      message: `[docker] Starting execution ${params.executionId} in image ${config.image} (container: ${containerName})`,
      timestamp: new Date().toISOString(),
    });

    // Build docker run arguments.
    const args: string[] = [
      "docker", "run",
      "--rm",
      "--name", containerName,
    ];

    // Network isolation.
    if (!config.networkEnabled) {
      args.push("--network=none");
    }

    // Port mappings.
    for (const port of config.ports) {
      args.push("-p", `${port}:${port}`);
    }

    // Volume mounts.
    for (const mount of config.volumeMounts) {
      args.push("-v", mount);
    }

    // Pass ANTHROPIC_API_KEY via --env-file to avoid leaking it in process args.
    let envFile: string | null = null;
    if (process.env.ANTHROPIC_API_KEY) {
      envFile = join(tmpdir(), `baara-${randomUUID()}.env`);
      writeFileSync(envFile, `ANTHROPIC_API_KEY=${process.env.ANTHROPIC_API_KEY}\n`, { mode: 0o600 });
      args.push("--env-file", envFile);
    }

    // Inject any caller-supplied environment variables via individual -e flags.
    // These are not secret keys and do not need the env-file treatment.
    if (params.environment) {
      for (const [key, value] of Object.entries(params.environment)) {
        args.push("-e", `${key}=${value}`);
      }
    }

    // Pass the prompt via stdin instead of `sh -c` to avoid shell injection.
    args.push("-i", config.image, "sh");

    // Set up timeout abort.
    let timedOut = false;
    const timeoutHandle = setTimeout(async () => {
      timedOut = true;
      await this._stopContainer(containerName);
    }, params.timeout);

    try {
      this.proc = Bun.spawn(args, {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });

      // Write the prompt to stdin and close the stream.
      // Bun.spawn with stdin:"pipe" returns a FileSink; cast from the union type.
      const stdinSink = this.proc.stdin as import("bun").FileSink;
      stdinSink.write(params.prompt + "\n");
      stdinSink.end();

      const currentProc = this.proc;

      // Collect all stdout/stderr text. `docker stop` will gracefully stop the
      // container which causes the `docker run` process to exit, closing the
      // streams. This avoids hanging on cancelled or timed-out containers.
      // stdout/stderr are ReadableStream at runtime when mode is "pipe"; cast
      // because Bun's type allows `number` for fd-passing mode too.
      const [stdoutText, stderrText] = await Promise.all([
        Bun.readableStreamToText(currentProc.stdout as ReadableStream<Uint8Array>),
        Bun.readableStreamToText(currentProc.stderr as ReadableStream<Uint8Array>),
      ]);

      clearTimeout(timeoutHandle);
      const exitCode = await currentProc.exited;
      const durationMs = Date.now() - start;

      // Emit stdout lines as log events.
      for (const line of stdoutText.split("\n")) {
        if (line.length > 0) {
          this.pushEvent({
            type: "log",
            level: "info",
            message: line,
            timestamp: new Date().toISOString(),
          });
        }
      }

      // Emit stderr lines as error log events.
      for (const line of stderrText.split("\n")) {
        if (line.length > 0) {
          this.pushEvent({
            type: "log",
            level: "error",
            message: line,
            timestamp: new Date().toISOString(),
          });
        }
      }

      if (this.cancelled) {
        this.closeEvents();
        return { status: "cancelled", durationMs };
      }

      if (timedOut) {
        this.pushEvent({
          type: "log",
          level: "warn",
          message: `[docker] Execution ${params.executionId} timed out after ${params.timeout}ms`,
          timestamp: new Date().toISOString(),
        });
        this.closeEvents();
        return {
          status: "timed_out",
          error: `Exceeded timeout of ${params.timeout}ms`,
          durationMs,
        };
      }

      const output = stdoutText.trimEnd();

      if (exitCode !== 0) {
        const errorMsg =
          stderrText.trim() || `Container exited with code ${exitCode}`;
        this.pushEvent({
          type: "log",
          level: "error",
          message: `[docker] Execution ${params.executionId} failed (exit ${exitCode}): ${errorMsg}`,
          timestamp: new Date().toISOString(),
        });
        this.closeEvents();
        return { status: "failed", error: errorMsg, output, durationMs };
      }

      this.pushEvent({
        type: "log",
        level: "info",
        message: `[docker] Execution ${params.executionId} completed in ${durationMs}ms`,
        timestamp: new Date().toISOString(),
      });
      this.closeEvents();
      return { status: "completed", output, durationMs };
    } catch (err) {
      clearTimeout(timeoutHandle);
      this.closeEvents();
      const durationMs = Date.now() - start;

      if (this.cancelled) {
        return { status: "cancelled", durationMs };
      }

      if (timedOut) {
        return {
          status: "timed_out",
          error: `Exceeded timeout of ${params.timeout}ms`,
          durationMs,
        };
      }

      const errorMsg = err instanceof Error ? err.message : String(err);
      return { status: "failed", error: errorMsg, durationMs };
    } finally {
      this.proc = null;
      this.containerName = null;
      // Clean up the env file containing secrets.
      if (envFile) {
        try { unlinkSync(envFile); } catch {}
      }
    }
  }

  // -------------------------------------------------------------------------
  // SandboxInstance.sendCommand()
  // -------------------------------------------------------------------------

  async sendCommand(_command: InboundCommand): Promise<void> {
    // Docker sandbox does not support mid-execution command injection in this
    // implementation. Commands are silently dropped. A future implementation
    // could write to the container's stdin.
  }

  // -------------------------------------------------------------------------
  // SandboxInstance.cancel()
  // -------------------------------------------------------------------------

  async cancel(): Promise<void> {
    this.cancelled = true;
    const name = this.containerName;
    if (name) {
      await this._stopContainer(name);
    } else if (this.proc) {
      // Fallback: kill the docker CLI process if we don't have a container name.
      this.proc.kill();
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Stop a named Docker container. Uses `docker stop` which sends SIGTERM then
   * SIGKILL after 10 seconds. This gracefully terminates the `docker run`
   * foreground process, closing its stdout/stderr pipes.
   */
  private async _stopContainer(name: string): Promise<void> {
    try {
      const stopProc = Bun.spawn(["docker", "stop", name], {
        stdout: "ignore",
        stderr: "ignore",
      });
      await stopProc.exited;
    } catch {
      // Ignore errors: the container may have already exited.
    }
  }
}

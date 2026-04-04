// @baara-next/executor — SandboxRegistry
//
// Central map of named sandbox implementations. The orchestrator queries this
// registry to find the correct sandbox for a given task, and to advertise
// which sandbox types are currently available on the host.

import type { ISandbox, SandboxType, Task } from "@baara-next/core";

/**
 * Maintains a sandboxType → ISandbox map and answers availability queries.
 *
 * Populated at startup with three hardcoded implementations:
 *   NativeSandbox   — always available
 *   WasmSandbox     — available if @extism/extism is importable
 *   DockerSandbox   — stub (isAvailable returns false)
 */
export class SandboxRegistry {
  private readonly sandboxes = new Map<string, ISandbox>();

  /**
   * Register a sandbox under its `.name`.
   *
   * If a sandbox with the same name is already registered it is silently
   * replaced — this allows hot-reloading in development.
   */
  register(sandbox: ISandbox): void {
    this.sandboxes.set(sandbox.name, sandbox);
  }

  /**
   * Return the sandbox registered under `name`, or `undefined` if absent.
   */
  get(name: SandboxType): ISandbox | undefined {
    return this.sandboxes.get(name);
  }

  /**
   * Return the sandbox that handles `task.sandboxType`.
   *
   * @throws {Error} if no sandbox is registered for the task's sandbox type,
   *         or if the task does not have a sandboxType set.
   */
  getForTask(task: Task): ISandbox {
    const sandboxType = task.sandboxType;
    if (!sandboxType) {
      throw new Error(
        `Task "${task.id}" does not have a sandboxType set. ` +
          `Set sandboxType on the task before calling getForTask.`
      );
    }
    const sandbox = this.sandboxes.get(sandboxType);
    if (!sandbox) {
      throw new Error(
        `No sandbox registered for sandboxType "${sandboxType}". ` +
          `Registered sandboxes: [${[...this.sandboxes.keys()].join(", ")}]`
      );
    }
    return sandbox;
  }

  /**
   * Return all registered sandboxes that report isAvailable() = true.
   *
   * Calls isAvailable() on each sandbox in parallel.
   */
  async getAvailable(): Promise<ISandbox[]> {
    const all = Array.from(this.sandboxes.values());
    const results = await Promise.all(
      all.map(async (s) => ({ sandbox: s, available: await s.isAvailable() }))
    );
    return results.filter((r) => r.available).map((r) => r.sandbox);
  }

  /** Return all registered sandboxes regardless of availability. */
  getAll(): ISandbox[] {
    return Array.from(this.sandboxes.values());
  }
}

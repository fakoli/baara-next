// @baara-next/executor — RuntimeRegistry
//
// Central map of named runtimes.  The agent queries this registry to find the
// correct runtime for a given task, and to advertise the union of all
// capabilities when polling the orchestrator.

import type { IRuntime, Task, RuntimeCapability } from "@baara-next/core";

/**
 * Maintains a name → runtime map and answers capability queries.
 */
export class RuntimeRegistry {
  private readonly runtimes = new Map<string, IRuntime>();

  /**
   * Register a runtime under its `.name`.
   *
   * If a runtime with the same name is already registered, it is silently
   * replaced — this allows hot-reloading in development.
   */
  register(runtime: IRuntime): void {
    this.runtimes.set(runtime.name, runtime);
  }

  /**
   * Return the runtime registered under `name`, or `undefined` if absent.
   */
  get(name: string): IRuntime | undefined {
    return this.runtimes.get(name);
  }

  /**
   * Return the runtime that handles `task.executionType`.
   *
   * @throws {Error} if no runtime is registered for the task's execution type.
   */
  getForTask(task: Task): IRuntime {
    const runtime = this.runtimes.get(task.executionType);
    if (!runtime) {
      throw new Error(
        `No runtime registered for executionType "${task.executionType}". ` +
          `Registered runtimes: [${[...this.runtimes.keys()].join(", ")}]`,
      );
    }
    return runtime;
  }

  /** Return all registered runtimes. */
  getAll(): IRuntime[] {
    return Array.from(this.runtimes.values());
  }

  /** Return the de-duplicated union of capabilities across all runtimes. */
  getAllCapabilities(): RuntimeCapability[] {
    const seen = new Set<RuntimeCapability>();
    for (const runtime of this.runtimes.values()) {
      for (const cap of runtime.capabilities) {
        seen.add(cap);
      }
    }
    return Array.from(seen);
  }
}

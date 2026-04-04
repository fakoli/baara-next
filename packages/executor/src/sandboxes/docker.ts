// @baara-next/executor/sandboxes — DockerSandbox
//
// Container isolation sandbox. Not yet implemented — isAvailable() always
// returns false so it is never selected for real tasks.
// Scaffolded here so the registry and type system are complete.

import type {
  ISandbox,
  SandboxInstance,
  SandboxStartConfig,
} from "@baara-next/core";

export class DockerSandbox implements ISandbox {
  readonly name = "docker" as const;
  readonly description = "Docker container sandbox (not yet implemented)";

  async isAvailable(): Promise<boolean> {
    return false;
  }

  async start(_config: SandboxStartConfig): Promise<SandboxInstance> {
    throw new Error(
      "DockerSandbox is not yet implemented. " +
        "Create a task with sandboxType: 'native' or 'wasm' instead."
    );
  }

  async stop(_instance: SandboxInstance): Promise<void> {
    // No-op
  }
}

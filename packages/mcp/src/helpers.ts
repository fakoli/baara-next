// @baara-next/mcp — Shared response helpers
import type { IStore, Task } from "@baara-next/core";

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

/** Wrap a value as a successful MCP text response. */
export function ok(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

/** Wrap a message as a failed MCP text response. */
export function err(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}

/** Standard "task not found" error response. */
export function notFound(nameOrId: string) {
  return err(`Task not found: ${nameOrId}`);
}

// ---------------------------------------------------------------------------
// Task resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a task by name (checked first) or UUID.
 * Returns null if neither lookup succeeds.
 */
export function resolveTask(store: Pick<IStore, "getTask" | "getTaskByName">, nameOrId: string): Task | null {
  return store.getTaskByName(nameOrId) ?? store.getTask(nameOrId);
}

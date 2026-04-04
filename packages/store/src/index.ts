// @baara-next/store — Public API barrel

import type { IStore } from "@baara-next/core";
import { SQLiteStore } from "./sqlite-store.ts";

export { SQLiteStore } from "./sqlite-store.ts";
export { runMigrations } from "./migrations.ts";

/**
 * Create a new SQLiteStore, run pending migrations, and return it ready for
 * use.  This is the standard factory used by the orchestrator and CLI; callers
 * that need finer control (e.g. in-memory test databases) can construct
 * SQLiteStore directly.
 *
 * @param dbPath - Absolute path to the SQLite database file.  The file is
 *   created if it does not already exist.
 */
export function createStore(dbPath: string): IStore {
  // SQLiteStore constructor already calls runMigrations internally.
  return new SQLiteStore(dbPath);
}

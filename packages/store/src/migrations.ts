// @baara-next/store — Version-tracked migrations
//
// Migrations are keyed by integer version numbers stored in the `settings`
// table under the key "schema_version".  The initial migration (version 1)
// creates all 9 tables with their indexes.  Additional migrations are
// appended to MIGRATIONS and run once in order.

import type { Database } from "bun:sqlite";

// ---------------------------------------------------------------------------
// Migration list
// ---------------------------------------------------------------------------

type Migration = {
  version: number;
  description: string;
  up: string;
};

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: "Initial schema — all 9 tables with indexes",
    up: `
      -- Tasks: definitions that produce executions
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        prompt TEXT NOT NULL,
        cron_expression TEXT,
        timeout_ms INTEGER NOT NULL DEFAULT 300000,
        execution_type TEXT NOT NULL DEFAULT 'cloud_code',
        agent_config TEXT,
        priority INTEGER NOT NULL DEFAULT 1,
        target_queue TEXT NOT NULL DEFAULT 'transfer',
        max_retries INTEGER NOT NULL DEFAULT 0,
        execution_mode TEXT NOT NULL DEFAULT 'queued',
        enabled INTEGER NOT NULL DEFAULT 1,
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_name ON tasks(name);

      -- Executions: one attempt to run a task
      CREATE TABLE IF NOT EXISTS executions (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        queue_name TEXT NOT NULL,
        priority INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'created',
        attempt INTEGER NOT NULL DEFAULT 1,
        scheduled_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        duration_ms INTEGER,
        output TEXT,
        error TEXT,
        input_tokens INTEGER,
        output_tokens INTEGER,
        health_status TEXT NOT NULL DEFAULT 'healthy',
        turn_count INTEGER NOT NULL DEFAULT 0,
        checkpoint_data TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_executions_task
        ON executions(task_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_executions_queue_dequeue
        ON executions(queue_name, status, priority ASC, created_at ASC);

      -- Events: append-only execution log
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        execution_id TEXT NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
        event_seq INTEGER NOT NULL,
        type TEXT NOT NULL,
        payload TEXT NOT NULL,
        timestamp TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(execution_id, event_seq)
      );

      CREATE INDEX IF NOT EXISTS idx_events_execution
        ON events(execution_id, event_seq ASC);

      -- Input requests: human-in-the-loop pauses
      CREATE TABLE IF NOT EXISTS input_requests (
        id TEXT PRIMARY KEY,
        execution_id TEXT NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
        prompt TEXT NOT NULL,
        options TEXT,
        context TEXT,
        response TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        timeout_ms INTEGER NOT NULL DEFAULT 300000,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        responded_at TEXT
      );

      -- Templates: reusable agent config presets
      CREATE TABLE IF NOT EXISTS templates (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        agent_config TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Queues: capacity metadata
      CREATE TABLE IF NOT EXISTS queues (
        name TEXT PRIMARY KEY,
        max_concurrency INTEGER NOT NULL DEFAULT 3,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Projects: logical task groupings
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        instructions TEXT NOT NULL DEFAULT '',
        working_directory TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Settings: operator-configurable key-value store
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Seed the four durable queues
      INSERT OR IGNORE INTO queues (name, max_concurrency) VALUES
        ('transfer',   10),
        ('timer',       5),
        ('visibility',  5),
        ('dlq',         1);
    `,
  },
  {
    version: 2,
    description: "Add threads table and thread_id FK on executions",
    up: `
      -- Threads: logical groupings of chat conversations + linked executions
      CREATE TABLE IF NOT EXISTS threads (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- NOTE: ON DELETE SET NULL on ALTER TABLE ADD COLUMN is only enforced in SQLite >= 3.26.0.
      -- Bun bundles SQLite >= 3.40, so this is safe. If running on an older SQLite, the FK
      -- cascade will not fire — deleteThread() must manually NULL the thread_id.
      ALTER TABLE executions ADD COLUMN thread_id TEXT REFERENCES threads(id) ON DELETE SET NULL;

      CREATE INDEX IF NOT EXISTS idx_executions_thread
        ON executions(thread_id, created_at DESC);
    `,
  },
  {
    version: 3,
    description: "Add task_messages table; rename execution_type → sandbox_type on tasks; add sandbox_config",
    up: `
      -- SQLite does not support ALTER COLUMN DEFAULT. We use the recommended
      -- 12-step table-rebuild technique to rename execution_type → sandbox_type
      -- and set a new default value of 'native'.
      --
      -- Step 1: Create new tasks table with the desired schema.
      CREATE TABLE tasks_v3 (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        prompt TEXT NOT NULL,
        cron_expression TEXT,
        timeout_ms INTEGER NOT NULL DEFAULT 300000,
        sandbox_type TEXT NOT NULL DEFAULT 'native',
        sandbox_config TEXT NOT NULL DEFAULT '{"type":"native"}',
        agent_config TEXT,
        priority INTEGER NOT NULL DEFAULT 1,
        target_queue TEXT NOT NULL DEFAULT 'transfer',
        max_retries INTEGER NOT NULL DEFAULT 0,
        execution_mode TEXT NOT NULL DEFAULT 'queued',
        enabled INTEGER NOT NULL DEFAULT 1,
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Step 2: Copy existing rows, mapping execution_type → sandbox_type.
      --   cloud_code and shell → 'native'
      --   wasm              → 'wasm'
      --   wasm_edge         → 'wasm'  (GPU flag migrates to agent_config externally)
      INSERT INTO tasks_v3 (
        id, name, description, prompt, cron_expression,
        timeout_ms,
        sandbox_type,
        sandbox_config,
        agent_config, priority, target_queue,
        max_retries, execution_mode, enabled, project_id,
        created_at, updated_at
      )
      SELECT
        id, name, description, prompt, cron_expression,
        timeout_ms,
        CASE execution_type
          WHEN 'cloud_code' THEN 'native'
          WHEN 'shell'      THEN 'native'
          WHEN 'wasm_edge'  THEN 'wasm'
          ELSE execution_type
        END,
        CASE execution_type
          WHEN 'wasm'      THEN '{"type":"wasm"}'
          WHEN 'wasm_edge' THEN '{"type":"wasm"}'
          ELSE '{"type":"native"}'
        END,
        agent_config, priority, target_queue,
        max_retries, execution_mode, enabled, project_id,
        created_at, updated_at
      FROM tasks;

      -- Step 3: Drop the old indexes that referenced tasks.
      DROP INDEX IF EXISTS idx_tasks_name;

      -- Step 4: Drop the old table and rename the new one.
      DROP TABLE tasks;
      ALTER TABLE tasks_v3 RENAME TO tasks;

      -- Step 5: Recreate the index.
      CREATE INDEX IF NOT EXISTS idx_tasks_name ON tasks(name);

      -- task_messages: durable inbound command queue and outbound event log.
      -- Each execution gets its own partition inside this shared table.
      CREATE TABLE IF NOT EXISTS task_messages (
        id           TEXT PRIMARY KEY,
        execution_id TEXT NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
        direction    TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
        message_type TEXT NOT NULL,
        payload      TEXT NOT NULL,
        status       TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'delivered', 'acknowledged')),
        created_at   TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Composite index for the hot read paths:
      --   readPendingCommands: WHERE execution_id = ? AND direction = 'inbound' AND status = 'pending'
      --   readLatestCheckpoint: WHERE execution_id = ? AND direction = 'outbound' AND message_type = 'checkpoint'
      CREATE INDEX IF NOT EXISTS idx_task_messages_execution
        ON task_messages(execution_id, direction, status, created_at);
    `,
  },
];

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

/** Return the current schema version (0 if the settings table doesn't exist yet). */
function currentVersion(db: Database): number {
  try {
    const row = db
      .query("SELECT value FROM settings WHERE key = 'schema_version'")
      .get() as { value: string } | null;
    return row ? parseInt(row.value, 10) : 0;
  } catch {
    // settings table hasn't been created yet
    return 0;
  }
}

/** Record the applied version in the settings table. */
function setVersion(db: Database, version: number): void {
  db.run(
    `INSERT INTO settings (key, value, updated_at)
     VALUES ('schema_version', ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')`,
    [String(version), String(version)]
  );
}

/**
 * Run all pending migrations against the database in a single transaction.
 *
 * This function is idempotent: calling it on an already-current schema is a
 * no-op.  Each migration is executed inside its own transaction so a failure
 * in migration N does not leave a partial version-N+1 schema.
 */
export function runMigrations(db: Database): void {
  const current = currentVersion(db);

  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;

    db.transaction(() => {
      db.exec(migration.up);
      setVersion(db, migration.version);
    })();
  }
}

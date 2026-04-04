# Configuration

BAARA Next is configured through environment variables and CLI flags. There is
no config file — all settings are passed at startup.

---

## Environment Variables

### Required

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Claude API key. Required for agent execution and the `/api/chat` SSE endpoint. Get one at https://console.anthropic.com. |

### Security

| Variable | Default | Description |
|----------|---------|-------------|
| `BAARA_API_KEY` | (unset) | When set, all `/api/*` and `/mcp` requests must include this key as `X-Api-Key: <key>` or `Authorization: Bearer <key>`. When unset, all routes are unauthenticated. |
| `BAARA_AUTH_MODE` | `api-key` | Authentication mode. Currently only `api-key` is supported. |

**Warning:** If `BAARA_API_KEY` is not set, the server logs:

```
WARNING: BAARA_API_KEY is not set — /api/* routes are unauthenticated
```

Always set `BAARA_API_KEY` in any environment accessible from a network.

### Feature Flags

| Variable | Default | Description |
|----------|---------|-------------|
| `BAARA_SHELL_ENABLED` | `false` | When `true`, allows shell-based task execution. Equivalent to enabling the `Bash` tool for all tasks. |

### Server

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port. Overridden by `--port` CLI flag if both are set. |
| `HOST` | `0.0.0.0` | Hostname to bind. Use `127.0.0.1` to restrict to localhost. |
| `NEXUS_DIR` | `~/.baara` | Data directory for the SQLite database (`baara.db`), JSONL logs (`logs/`), and Agent SDK session files (`sessions/`). |

---

## `bun start` CLI Flags

The `start` command accepts flags that override environment variables:

```sh
bun start [options]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--port <port>` | `3000` | HTTP server port |
| `--hostname <hostname>` | `0.0.0.0` | Hostname to bind |
| `--data-dir <dir>` | `~/.baara` | Data directory path |
| `--mode <mode>` | `dev` | Execution mode: `dev` (single-process) or `production` |

**Examples:**

```sh
# Start on port 8080 with a custom data directory
ANTHROPIC_API_KEY=sk-ant-... bun start --port 8080 --data-dir /data/baara

# Bind to localhost only (no network exposure)
ANTHROPIC_API_KEY=sk-ant-... bun start --hostname 127.0.0.1

# Production mode (separate orchestrator and agent processes)
ANTHROPIC_API_KEY=sk-ant-... BAARA_API_KEY=my-secret bun start --mode production
```

---

## Global CLI Flags

All `baara` sub-commands accept these global flags:

| Flag | Default | Description |
|------|---------|-------------|
| `--data-dir <dir>` | `~/.baara` | Data directory containing `baara.db` |
| `--format <format>` | `table` | Output format: `table` or `json` |
| `--verbose` | `false` | Verbose logging |

---

## Per-Command Flags

### `baara tasks`

```sh
baara tasks list [--project <id>]
baara tasks get <name-or-id>
baara tasks create --name <n> --prompt <p> [--cron <expr>] [--sandbox <type>] [--mode queued|direct]
baara tasks update <name-or-id> [--name <n>] [--prompt <p>] [--enabled]
baara tasks delete <name-or-id>
baara tasks run <name-or-id>          # direct mode, blocks until complete
baara tasks submit <name-or-id>       # queued mode, returns immediately
baara tasks toggle <name-or-id>
```

### `baara executions`

```sh
baara executions list [--task <id>] [--status <status>] [--limit <n>]
baara executions get <id>
baara executions cancel <id>
baara executions retry <id>
baara executions logs <id> [--level <level>] [--search <text>] [--limit <n>]
baara executions events <id>
baara executions input <id> --response <text>
```

### `baara queues`

```sh
baara queues list
baara queues get <name>
baara queues dlq
baara queues dlq-retry <execution-id>
```

### `baara admin`

```sh
baara admin dlq            # list dead-lettered executions
baara admin dlq-retry <id> # retry a dead-lettered execution
baara admin status         # system status snapshot
```

### `baara chat`

```sh
baara chat [--session <id>] [--thread <id>]
```

Starts an interactive REPL. Each message is sent to `POST /api/chat` and the
SSE stream is rendered to the terminal. Press Ctrl+C to exit.

### `baara mcp-server`

```sh
baara mcp-server [--data-dir <dir>]
```

Starts the MCP stdio server. Used as the entry point for Claude Code integration
via `.mcp.json`. Reads from stdin, writes to stdout, following JSON-RPC 2.0.

---

## Data Directory Layout

After first `bun start`, the data directory contains:

```
~/.baara/
├── baara.db          # SQLite database (all tasks, executions, threads, events)
├── logs/             # JSONL execution logs
│   ├── <execution-id-1>.jsonl
│   ├── <execution-id-2>.jsonl
│   └── ...
└── sessions/         # Agent SDK conversation session files
    ├── <session-id-1>.json
    └── ...
```

The database file is safe to back up while the server is stopped. Session files
can be deleted without data loss — the next chat turn creates a new session.

---

## Minimal Production Setup

```sh
export ANTHROPIC_API_KEY=sk-ant-...
export BAARA_API_KEY=$(openssl rand -hex 32)
export NEXUS_DIR=/var/lib/baara

bun start --hostname 127.0.0.1 --port 3000
```

Put a reverse proxy (nginx, Caddy) in front for TLS termination.

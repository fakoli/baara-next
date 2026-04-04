# Contributing

---

## Prerequisites

- **Bun 1.3+** — https://bun.sh/docs/installation
- **Git 2.x+**
- **Node.js 20+** (for some tooling; Bun provides its own Node.js-compatible runtime)

Verify your setup:

```sh
bun --version   # 1.3.0 or higher
git --version   # 2.x
```

---

## Development Setup

```sh
# 1. Clone
git clone https://github.com/fakoli/baara-next.git
cd baara-next

# 2. Install dependencies
bun install

# 3. Start the development server
ANTHROPIC_API_KEY=sk-ant-... bun start
```

Open http://localhost:3000 in your browser.

The `bun start` command runs orchestrator, agent, and HTTP server in a single
process (dev mode). Source changes require a server restart.

---

## Running Tests

```sh
# Smoke tests — integration tests against a live SQLite database
bun test:smoke

# Type-check all packages
turbo typecheck

# Build all packages in dependency order
turbo build
```

The smoke tests (`packages/*/src/*.smoke.test.ts`) create an isolated test
database in a temporary directory and tear it down on completion. They do not
call the Anthropic API.

---

## Package Overview

| Package | Purpose |
|---------|---------|
| `packages/core` | Shared types (`Task`, `Execution`, `SandboxType`, etc.), interfaces (`IStore`, `ISandbox`, `IMessageBus`), state machine, error classes |
| `packages/store` | SQLite implementation of `IStore` via `bun:sqlite`. Schema migrations run at startup. |
| `packages/orchestrator` | `OrchestratorService`: queue management, retry scheduler, health monitor, DLQ. `TaskManager`: task CRUD business logic. |
| `packages/agent` | `AgentService`: polls for assigned executions via transport, drives the execution loop. |
| `packages/executor` | `SandboxRegistry`, `NativeSandbox`, `WasmSandbox`, `DockerSandbox`, `CheckpointService`, `MessageBus`, JSONL log reader/writer. |
| `packages/transport` | `DevTransport` (in-process promise-based bridge) and `HttpTransport` (production HTTP polling). |
| `packages/server` | Hono HTTP server with all route groups. `createApp()` accepts `AppDeps` and returns a configured `Hono` instance. |
| `packages/mcp` | 27-tool MCP server. `createBaaraMcpServer()` for in-process; stdio and HTTP transports via `handleJsonRpc()`. |
| `packages/cli` | Commander.js CLI entry point. All sub-commands registered in `src/commands/`. |
| `packages/web` | React 18/Vite/Tailwind frontend. `bun run dev` in this package for hot-reload. |

---

## Code Conventions

### TypeScript

- Strict mode everywhere (`"strict": true` in all `tsconfig.json`).
- No `any` — use `unknown` and narrow with type guards.
- `moduleResolution: bundler` — use Bun import semantics (no `.js` extension
  needed on `.ts` imports within a package; cross-package imports use the
  package name from `package.json`).
- Each package exports a public API from its `src/index.ts`; do not import
  internal paths from other packages.

### Interfaces

Follow the `ISandbox` pattern for pluggable components:
- Define the interface in `packages/core/src/interfaces/`.
- Export from `packages/core/src/index.ts`.
- Implement in the responsible package (e.g., `packages/executor`).
- Register via a factory function, not a global singleton.

### Database

- SQLite only, via `bun:sqlite`. No ORM, no query builder.
- All SQL lives in `packages/store/src/`. Nothing outside the store package may
  issue SQL directly.
- Schema migrations: add a new `migrate_vN` function in
  `packages/store/src/migrations.ts` and call it in order from `runMigrations()`.

### HTTP

- Hono for all HTTP. No Express.
- Route handlers should be thin: parse, validate, call a service method, return.
- Business logic belongs in service classes, not route handlers.

### Error handling

Use the typed error classes from `packages/core/src/errors.ts`:
- `TaskNotFoundError`
- `ExecutionNotFoundError`
- `InvalidStateTransitionError`
- `DuplicateEntityError`

Catch these in route handlers and return appropriate HTTP status codes.

### Testing

- Unit tests live alongside the source file: `foo.ts` → `foo.test.ts`.
- Smoke/integration tests use the `.smoke.test.ts` suffix.
- Use `bun:test` (`describe`, `it`, `expect`) — no Jest.

---

## Pull Request Guidelines

1. **Run type-check before opening a PR:**

   ```sh
   turbo typecheck
   ```

2. **Run tests:**

   ```sh
   bun test:smoke
   ```

3. **Keep PRs focused.** One logical change per PR. If you are adding a new
   sandbox type, the PR should contain only that change — not unrelated refactors.

4. **Update documentation.** If you add a new CLI command, API endpoint, or MCP
   tool, update the relevant `docs/` file in the same PR.

5. **Critic review.** For any change to `ISandbox`, `IStore`, or `IMessageBus`,
   include a brief rationale in the PR description explaining why the interface
   change is necessary and what downstream implementations need to update.

6. **No `any`.** PRs that introduce `any` without a comment explaining why will
   be asked to revise.

---

## Project Structure

```
baara-next/
├── packages/
│   ├── core/        # shared types and interfaces
│   ├── store/       # SQLite persistence
│   ├── orchestrator/
│   ├── agent/
│   ├── executor/    # sandboxes, checkpointing, logging
│   ├── transport/
│   ├── server/      # HTTP API
│   ├── mcp/         # MCP tools and transports
│   ├── cli/         # CLI entry point
│   └── web/         # React frontend
├── docs/            # documentation
├── tsconfig.base.json
├── turbo.json
└── package.json     # root workspace
```

---

## Getting Help

Open an issue or start a discussion on GitHub. When reporting a bug, include:

- `bun --version` output
- The full error message and stack trace
- The command you ran or the API request you made
- Whether the issue is reproducible with `bun test:smoke`

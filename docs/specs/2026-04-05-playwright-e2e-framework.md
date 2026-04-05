# Playwright E2E Test Framework — Spec

**Date:** 2026-04-05
**Status:** Draft
**Scope:** End-to-end test framework for the BAARA Next web UI

---

## Goal

Build a Playwright test framework that validates all confirmed-working web UI features from the UI evaluation report. Tests run against a live server with a fresh SQLite database per test file, measure action latency, and produce structured timing reports.

## Context

The UI evaluation (2026-04-05) tested 40+ features across layout, chat, threads, tasks, executions, queues, and footer controls. Three defects were found (one fixed: remark-gfm). This framework codifies the confirmed-working features into automated regression tests and establishes latency baselines.

---

## Architecture

```
tests/e2e/
  playwright.config.ts          # Playwright config — baseURL, timeout, reporter
  helpers/
    server.ts                   # Start/stop baara server with temp data-dir
    fixtures.ts                 # Custom Playwright fixtures (server, apiClient, timings)
    api.ts                      # Direct HTTP helpers for test preconditions
    selectors.ts                # Centralized UI selectors
    measure.ts                  # Action latency measurement
  specs/
    layout.spec.ts              # Three-zone layout, collapse/expand, header, footer
    chat.spec.ts                # Message send, SSE streaming, tool calls, markdown
    threads.spec.ts             # Create, switch, history, auto-title
    tasks.spec.ts               # CRUD via chat + ControlPanel, output routing
    executions.spec.ts          # Exec list, detail view, sub-tabs
    queues.spec.ts              # Queue cards, capacity, filter
    controls.spec.ts            # Permission mode, model selector, system instructions
  journeys/                     # Reserved — user journey tests (future)
  results/                      # Timing JSON files (gitignored)
  report-latency.ts             # Aggregates timing files into summary table
  package.json                  # @playwright/test dependency
  tsconfig.json                 # Extends root tsconfig.base.json
```

### Server Lifecycle (per test file)

1. Create temp directory via `mkdtemp()` in `os.tmpdir()`.
2. Pick random available port: bind to port 0, read assigned port, close.
3. Spawn: `bun run packages/cli/src/index.ts -- start --port {port} --data-dir {tmpDir}`.
4. Poll `GET /api/system/status` every 200ms until 200 OK (timeout: 15s).
5. Return `ServerInstance` to test.
6. On teardown: SIGTERM, then SIGKILL after 3s. Kill process group to prevent orphans. Remove temp dir in `finally` block.

### API Client

Wraps `fetch()` for test precondition setup. Direct HTTP — no UI interaction.

```typescript
interface APIClient {
  createTask(opts: {
    name: string;
    prompt: string;
    cronExpression?: string;
    executionMode?: "direct" | "queued";
    sandboxType?: "native" | "wasm";
    priority?: 0 | 1 | 2 | 3;
    targetThreadId?: string;
  }): Promise<{ id: string }>;

  runTask(taskId: string): Promise<{ executionId: string }>;
  getExecution(id: string): Promise<Execution>;
  waitForExecution(id: string, timeoutMs?: number): Promise<Execution>;
  listThreads(): Promise<Thread[]>;
  getThreadMessages(threadId: string): Promise<ThreadMessage[]>;
  getSystemStatus(): Promise<SystemStatus>;
  deleteTask(id: string): Promise<void>;
}
```

`waitForExecution()` polls every 500ms until the execution reaches a terminal state (`completed`, `failed`, `cancelled`, `dead_lettered`). Default timeout: 30s.

### UI Selectors

Centralized in `helpers/selectors.ts`. Uses `data-testid` attributes for structural elements (requires adding ~15-20 attributes to React components) and text matchers for dynamic content.

```typescript
const Selectors = {
  // Layout
  threadList: '[data-testid="thread-list"]',
  chatWindow: '[data-testid="chat-window"]',
  controlPanel: '[data-testid="control-panel"]',
  threadCollapseBtn: '[data-testid="thread-collapse"]',
  cpCollapseBtn: '[data-testid="cp-collapse"]',

  // Chat
  chatInput: 'textarea[placeholder*="Message"]',
  chatSendBtn: '[data-testid="chat-send"]',
  quickAction: (label: string) => `button:has-text("${label}")`,

  // Control Panel tabs
  cpTab: (name: string) => `button:has-text("${name}")`,
  cpNewTaskBtn: 'button:has-text("+ New")',
  cpTaskItem: (name: string) => `text="${name}"`,

  // Footer
  permissionMode: '[data-testid="permission-mode"]',
  modelSelector: '[data-testid="model-selector"]',
  sessionCost: '[data-testid="session-cost"]',
} as const;
```

---

## Data Flow

```
Test file starts
  │
  ▼
[Fixture: startServer()] → ServerInstance (temp dir, random port)
  │
  ▼
[Fixture: createAPIClient(server)] → APIClient (fetch wrapper)
  │
  ▼
[Test preconditions via APIClient]
  Direct HTTP setup (create tasks, etc.) — fast, reliable
  │
  ▼
[Test actions via Playwright page]
  page.goto(server.baseURL) → interact with UI
  │
  ▼
[Assertions — two layers]
  Layer 1: UI assertions — page.locator().toContainText()
  Layer 2: API assertions — apiClient.getExecution() → verify server state
  │
  ▼
[Output routing verification]
  1. Create task with targetThreadId via API
  2. Run task via UI or API
  3. waitForExecution() until terminal
  4. apiClient.getThreadMessages(threadId) → assert output message present
  │
  ▼
[Fixture: teardown]
  Kill server, remove temp dir, write timings to results/
```

### Two-Layer Assertion Pattern

Every mutation test asserts both layers:

- **UI layer**: The user sees the expected state (e.g., ControlPanel shows "2 tasks").
- **API layer**: The server state is correct (e.g., `getSystemStatus()` confirms the task exists).

### SSE Streaming Test Pattern

Chat tests do NOT assert on individual SSE events. They wait for final state:

- Agent message text appears in DOM
- Tool call pills show checkmarks
- Session cost updates from "$0.00"

No `page.waitForTimeout()` — all waits use Playwright's auto-retry or `waitForExecution()` polling.

---

## Action Latency Measurement

### measure() helper

```typescript
interface ActionTiming {
  action: string;        // e.g., "chat:send_message", "thread:switch"
  durationMs: number;
  threshold: 'fast' | 'acceptable' | 'slow';
}

async function measure<T>(
  name: string,
  fn: () => Promise<T>,
  thresholds?: { fast: number; acceptable: number }
): Promise<{ result: T; timing: ActionTiming }>
```

### Default Thresholds


| Category                                 | Fast    | Acceptable | Slow    |
| ---------------------------------------- | ------- | ---------- | ------- |
| UI interaction (click, toggle, collapse) | < 100ms | < 300ms    | > 300ms |
| Chat response (first token)              | < 2s    | < 5s       | > 5s    |
| Chat response (full completion)          | < 15s   | < 30s      | > 30s   |
| Task CRUD via API                        | < 200ms | < 500ms    | > 500ms |
| Thread switch (history load)             | < 300ms | < 1s       | > 1s    |
| Server startup                           | < 3s    | < 5s       | > 5s    |
| ControlPanel refresh after mutation      | < 500ms | < 1s       | > 1s    |


### Reporting

- Each test file collects timings via fixture.
- On teardown, timings written to `tests/e2e/results/timings-{testfile}-{timestamp}.json`.
- `report-latency.ts` aggregates all timing files: min/avg/max/p95 per action.
- Latency is reported, not enforced. Tests do not fail on slow thresholds. Enforcement opt-in later.

---

## Error Handling

- **Server fails to start**: Fixture throws with stderr output. Test file skipped.
- **Server crashes mid-test**: Network requests fail, fixture teardown still cleans up.
- **Port collision**: `getAvailablePort()` binds port 0. Effectively impossible.
- **Temp dir cleanup failure**: Logs warning, does not fail test. OS cleans up.
- **Slow SSE response**: `waitForExecution()` timeout (30s) produces clear error.

---

## Test File Coverage


| Spec file            | Features                                                                                   | Preconditions (API)                 | Requires ANTHROPIC_API_KEY |
| -------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------- | -------------------------- |
| `layout.spec.ts`     | Three-zone render, collapse/expand both panels, re-expand, header indicators               | None                                | No                         |
| `chat.spec.ts`       | Send message, SSE streaming, tool call pills, markdown tables, quick actions, session cost | None                                | **Yes — local only**       |
| `threads.spec.ts`    | Create thread, switch, history load, auto-title, Main pinned                               | Pre-create 2 threads with messages  | **Yes — local only**       |
| `tasks.spec.ts`      | Create/list/delete via chat, ControlPanel refresh, editor form, output routing             | Pre-create task for edit/delete/run | **Yes — local only**       |
| `executions.spec.ts` | Exec list, detail view, Overview/Events/Logs/Tools sub-tabs                                | Pre-create task + run via API       | **Yes — local only**       |
| `queues.spec.ts`     | Queue cards, all 4 queues, capacity info, filter                                           | None — seeded by migration          | No                         |
| `controls.spec.ts`   | Permission mode cycling, model selector, system instructions tag                           | None                                | No                         |


### Test Categorization

Tests are tagged with Playwright's `test.describe` annotations:

```typescript
test.describe('@local-only', () => {
  // Tests requiring ANTHROPIC_API_KEY
  // Skipped in CI via: --grep-invert "@local-only"
});
```

Tests without the tag can run in any environment (CI or local) — they only exercise UI rendering and layout, not the Claude SDK.

### Assertion Strategy Per Feature

- **Layout**: `toBeVisible()`, `toBeHidden()`, bounding box checks for collapse
- **Chat**: `toContainText()` for response, `toHaveCount()` for tool pills, `locator('table')` for remark-gfm
- **Threads**: `toContainText()` for list items, message count in loaded history
- **Tasks**: UI + API two-layer. Output routing: `apiClient.getThreadMessages()` confirms agent message
- **Executions**: Sub-tabs assert specific content (status badge, event count, log text)
- **Queues**: All 4 queue names visible, capacity matches API
- **Controls**: Text cycling: "Auto" → "Ask" → "Locked"

---

## Running Tests

### Playwright Config Key Settings

- `workers: 1` — serial execution; each test file needs its own server.
- `timeout: 60_000` — per-test timeout; generous for SDK calls.
- `retries: 0` — no retries; flaky tests should be fixed, not masked.
- `reporter: 'list'` — simple terminal output.

```bash
# All tests (local, requires ANTHROPIC_API_KEY)
bun run test:e2e

# CI-safe tests only (layout, queues, controls)
bun run test:e2e:ci

# Single spec
bun run test:e2e -- --grep "chat"

# With latency report
bun run test:e2e && bun run test:e2e:report
```

### Scripts in root package.json

```json
{
  "test:e2e": "cd tests/e2e && npx playwright test",
  "test:e2e:ci": "cd tests/e2e && npx playwright test --grep-invert @local-only",
  "test:e2e:report": "bun run tests/e2e/report-latency.ts"
}
```

---

## data-testid Additions Required

The following `data-testid` attributes need to be added to existing React components. This is a targeted change — approximately 15 attributes across 8 files:


| Component      | File               | Attributes                                          |
| -------------- | ------------------ | --------------------------------------------------- |
| `App`          | `App.tsx`          | None (layout is structural)                         |
| `ThreadList`   | `ThreadList.tsx`   | `thread-list`, `thread-collapse`, `thread-expand`   |
| `ChatWindow`   | `ChatWindow.tsx`   | `chat-window`                                       |
| `ChatInput`    | `ChatInput.tsx`    | `chat-send`                                         |
| `ChatMessage`  | `ChatMessage.tsx`  | `msg-user`, `msg-agent`                             |
| `ControlPanel` | `ControlPanel.tsx` | `control-panel`, `cp-collapse`, `cp-expand`         |
| `Header`       | `Header.tsx`       | `header-status`                                     |
| `Footer area`  | `ChatInput.tsx`    | `permission-mode`, `model-selector`, `session-cost` |


---

## Out of Scope

- CLI testing (covered separately in evaluation report)
- MCP integration testing (future phase)
- Visual regression testing (screenshot comparison)
- Performance load testing
- Mobile/responsive layout testing
- Browser compatibility (Chromium only for now)
- User journey tests (reserved `journeys/` directory for future)

---

## Acceptance Criteria

1. All 7 spec files pass against a live server.
2. Each test file starts with a fresh server + empty database.
3. Latency timings are collected for every user action and written to JSON.
4. `report-latency.ts` produces a readable summary table.
5. Tests tagged `@local-only` can be excluded for CI via `--grep-invert`.
6. No `page.waitForTimeout()` calls — all waits use Playwright auto-retry or API polling.
7. Output routing is verified: task output lands in the designated thread after execution.
8. Zero test pollution: temp directories and server processes are always cleaned up.


# SLI/SLO Definitions — BAARA Next

## Service Level Indicators (SLIs)

Measurable signals of system health. Each SLI maps to a specific user experience.

### API Performance

| SLI | What it measures | How to measure |
|-----|-----------------|----------------|
| `api.health.latency` | Time for GET /api/health to respond | Response time in ms |
| `api.task.crud.latency` | Time for task CRUD operations (create/get/list/update/delete) | p50 and p99 response time |
| `api.execution.list.latency` | Time to list executions | Response time in ms |
| `api.mcp.tools_list.latency` | Time for MCP tools/list RPC | Response time in ms |
| `api.mcp.tool_call.latency` | Time for a single MCP tool invocation | Response time in ms |
| `api.chat.ttft` | Time to first SSE token from POST /api/chat | Time from request to first `data:` line |

### Task Execution

| SLI | What it measures | How to measure |
|-----|-----------------|----------------|
| `exec.shell.latency` | Shell task end-to-end execution time (submit → completed) | Duration from submit to status=completed |
| `exec.shell.success_rate` | Percentage of shell tasks that complete successfully | completed / (completed + failed + timed_out + dead_lettered) |
| `exec.queue.pickup_latency` | Time from enqueue to agent assignment | Time from status=queued to status=assigned |
| `exec.retry.success_rate` | Percentage of retried tasks that eventually succeed | Tasks that reached completed after retry_scheduled |

### Durability

| SLI | What it measures | How to measure |
|-----|-----------------|----------------|
| `durability.checkpoint.write_rate` | Percentage of executions that have at least one checkpoint | Executions with checkpoint / total executions |
| `durability.event.completeness` | Events recorded for each execution stage | Count of events per execution (should be ≥ 4: created, queued, assigned, started) |

### Web UI

| SLI | What it measures | How to measure |
|-----|-----------------|----------------|
| `ui.load.time` | Time for initial page load (DOMContentLoaded) | Navigation timing API |
| `ui.chat.render_latency` | Time from SSE event to rendered DOM update | Timestamp comparison |
| `ui.thread.switch_latency` | Time to load thread history on click | Time from click to messages rendered |

---

## Service Level Objectives (SLOs)

Targets for each SLI. Failing an SLO means user experience is degraded.

### Tier 1 — Critical (blocks usage)

| SLO | Target | Rationale |
|-----|--------|-----------|
| `api.health.latency` | < 100ms p99 | Health check must be instant |
| `api.task.crud.latency` | < 200ms p99 | CRUD feels instant to the user |
| `exec.shell.success_rate` | ≥ 99% | Simple echo commands must not fail |
| `exec.shell.latency` | < 2s p99 | Shell tasks should complete near-instantly |
| `exec.queue.pickup_latency` | < 3s p99 | Agent must pick up queued tasks within seconds |
| `api.mcp.tools_list.latency` | < 100ms p99 | MCP handshake must be fast |

### Tier 2 — Important (degrades experience)

| SLO | Target | Rationale |
|-----|--------|-----------|
| `api.chat.ttft` | < 5s p99 | User should see streaming start within 5s |
| `api.mcp.tool_call.latency` | < 500ms p99 (non-execution tools) | List/get operations should be fast |
| `durability.event.completeness` | ≥ 4 events per completed execution | Every lifecycle stage must be logged |
| `exec.retry.success_rate` | ≥ 50% | At least half of retries should succeed |

### Tier 3 — Nice to have (polish)

| SLO | Target | Rationale |
|-----|--------|-----------|
| `ui.load.time` | < 2s | Single-page app should load quickly |
| `ui.thread.switch_latency` | < 500ms | Thread switching should feel instant |

---

## Automated SLI Test Suite

Run with: `bun test tests/sli/`

Tests measure actual latencies and assert against SLO targets.

# Plan C: Git Init + GitHub Launch

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan.

**Goal:** Initialize a git repository, make a single clean initial commit with the full Phase 6 codebase, create the public `fakoli/baara-next` GitHub repository, push, and verify it works end-to-end.

**Spec reference:** Part 3 of `docs/superpowers/specs/2026-04-04-phase6-production-launch-design.md`

**Prerequisites:** Plans A and B must be complete before running this plan. The `README.md`, all `docs/` files, `CLAUDE.md`, smoke tests in `tests/smoke/`, and the updated `package.json` must all exist and pass typecheck.

---

### Task 1: Update `.gitignore`

**Files:**
- Modify: `.gitignore`

Add `.superpowers/` to the ignore list so brainstorm artifacts and plan execution logs are never committed.

- [ ] **Step 1: Add `.superpowers/` to `.gitignore`**

The final `.gitignore` should contain:

```gitignore
# Dependencies
node_modules/

# Build output
dist/
*.tsbuildinfo

# Turbo cache
.turbo/

# Environment
.env
.env.*
!.env.example

# macOS
.DS_Store

# BAARA runtime data
~/.baara

# Superpowers brainstorm artifacts (not part of the codebase)
.superpowers/
```

---

### Task 2: Verify pre-commit state

**Files:** None (verification only)

Before committing, confirm the codebase is clean and correct.

- [ ] **Step 1: Run typecheck**

```bash
cd /path/to/baara-next
bun run typecheck
```

Expected: all 10 packages pass with zero errors.

- [ ] **Step 2: Run smoke tests (optional but recommended)**

```bash
bun run test:smoke
```

Expected: boot, CRUD, sandbox config, MCP endpoint, and logs tests pass.
Submit/execute and DLQ tests pass if `BAARA_SHELL_ENABLED=true`.
Chat/thread tests pass if `ANTHROPIC_API_KEY` is set.

- [ ] **Step 3: Confirm README and key docs exist**

```bash
ls README.md \
   docs/architecture.md \
   docs/sandbox-guide.md \
   docs/mcp-integration.md \
   docs/api-reference.md \
   docs/chat-architecture.md \
   docs/durability.md \
   docs/configuration.md \
   docs/contributing.md \
   CLAUDE.md \
   tests/smoke/helpers.ts \
   tests/smoke/01-boot.test.ts
```

Expected: all files present, no errors.

---

### Task 3: Initialize the git repository

**Files:** None (git operations)

- [ ] **Step 1: `git init`**

```bash
cd /path/to/baara-next
git init
```

Expected output:
```
Initialized empty Git repository in /path/to/baara-next/.git/
```

- [ ] **Step 2: Configure git identity if not already set**

```bash
git config user.email || git config user.email "you@example.com"
git config user.name  || git config user.name  "Your Name"
```

(Skip if already configured globally.)

---

### Task 4: Stage and commit

**Files:** None (git operations)

- [ ] **Step 1: Stage all files**

```bash
git add -A
```

- [ ] **Step 2: Verify the staging area looks correct**

```bash
git status
```

Confirm:
- `README.md` is staged
- `docs/` files are staged
- `CLAUDE.md` is staged
- `tests/smoke/` is staged
- `packages/` are staged
- `.gitignore` is staged and includes `.superpowers/`
- `.superpowers/` is NOT in the list (ignored)
- `node_modules/` is NOT in the list (ignored)
- `.env` files are NOT in the list (ignored)

If any secrets (`.env`, API keys) appear in `git status`, stop and add them
to `.gitignore` before continuing.

- [ ] **Step 3: Create the initial commit**

Use this exact commit message from the spec:

```bash
git commit -m "$(cat <<'EOF'
feat: BAARA Next — durable agentic task execution engine

10-package TypeScript/Bun monorepo:
- Orchestrator with 11-state execution machine, multi-queue, exponential backoff
- Pluggable sandbox architecture (Native, Wasm/Extism, Docker stub)
- 27-tool MCP server (HTTP + stdio transports)
- Chat-centric web UI (React/Vite/Tailwind, SSE streaming, inline cards)
- Conversation-level checkpointing with crash recovery
- JSONL logging with real-time WebSocket streaming
- Thread model linking conversations to executions
- CLI with full parity (chat REPL, mcp-server, task management)
EOF
)"
```

Expected output: something like
```
[main (root-commit) abc1234] feat: BAARA Next — durable agentic task execution engine
 143 files changed, N insertions(+)
```

- [ ] **Step 4: Verify commit**

```bash
git log --oneline
```

Expected: one commit visible.

```bash
git show --stat HEAD | head -30
```

Expected: shows the commit message and a list of changed files including
`README.md`, `packages/`, `docs/`, `tests/`, `CLAUDE.md`.

---

### Task 5: Create and push the GitHub repository

**Files:** None (GitHub operations via `gh` CLI)

Requires the GitHub CLI (`gh`) to be installed and authenticated.

- [ ] **Step 1: Confirm `gh` is authenticated**

```bash
gh auth status
```

Expected: shows authenticated account (e.g. `fakoli`). If not, run
`gh auth login` and complete the flow.

- [ ] **Step 2: Create the repo and push**

```bash
gh repo create fakoli/baara-next \
  --public \
  --description "Durable agentic task execution engine" \
  --source . \
  --push
```

Expected output:
```
✓ Created repository fakoli/baara-next on GitHub
✓ Pushed commits to https://github.com/fakoli/baara-next.git
```

- [ ] **Step 3: Verify remote is set**

```bash
git remote -v
```

Expected:
```
origin  https://github.com/fakoli/baara-next.git (fetch)
origin  https://github.com/fakoli/baara-next.git (push)
```

---

### Task 6: Verify the launch

**Files:** None (verification)

- [ ] **Step 1: Confirm the repo is publicly accessible**

```bash
gh repo view fakoli/baara-next
```

Expected: shows repo name, description, visibility (public), and default branch.

Or open in browser:
```bash
gh repo view fakoli/baara-next --web
```

- [ ] **Step 2: Confirm README renders on GitHub**

Navigate to `https://github.com/fakoli/baara-next`.

Verify:
- Hero heading "# BAARA Next" renders
- Badges render (TypeScript, Bun, MIT)
- Quick Start code block is correctly fenced
- All links in the `Documentation` table resolve to files that exist in the repo

- [ ] **Step 3: Smoke-test a fresh clone**

In a separate temporary directory:

```bash
cd /tmp
git clone https://github.com/fakoli/baara-next.git baara-next-clone
cd baara-next-clone
bun install
```

Expected: `bun install` completes successfully, no missing workspace errors.

```bash
bun run typecheck
```

Expected: all 10 packages pass.

```bash
ANTHROPIC_API_KEY=sk-ant-... bun start &
sleep 3
curl http://localhost:3000/api/health
```

Expected: `{"status":"ok","uptime":...,"version":"0.1.0"}`

```bash
# Cleanup
kill %1
cd /tmp && rm -rf baara-next-clone
```

- [ ] **Step 4: Verify `.mcp.json` example from README works**

Copy the `.mcp.json` snippet from `README.md` into a test project, update the
path to the cloned repo, and confirm Claude Code can connect:

```json
{
  "mcpServers": {
    "baara-next": {
      "command": "bun",
      "args": ["run", "/tmp/baara-next-clone/packages/cli/src/index.ts", "mcp-server"],
      "env": {
        "ANTHROPIC_API_KEY": "${ANTHROPIC_API_KEY}"
      }
    }
  }
}
```

In Claude Code, run `/mcp` and confirm `baara-next` appears with 27 tools.

---

### Rollback Procedure

If the push fails or the repository needs to be deleted and recreated:

```bash
# Delete the remote repo (requires owner permissions)
gh repo delete fakoli/baara-next --yes

# Remove the local remote and retry
git remote remove origin
gh repo create fakoli/baara-next \
  --public \
  --description "Durable agentic task execution engine" \
  --source . \
  --push
```

If the initial commit needs to be amended (e.g. a secret was accidentally
included), do NOT push.  Instead:

```bash
# Remove the secret from .gitignore first
git rm --cached path/to/secret-file
git commit --amend --no-edit
# Only then push
```

# Diagnostic Display Toggle (Dev Mode) — Spec

**Date:** 2026-04-05
**Status:** Draft
**Scope:** Client-side dev mode toggle controlling visibility of tool call diagnostics in the web UI

---

## Goal

Add a configurable dev mode toggle to the web UI that controls whether tool call details (pills, results) are shown in full or hidden behind a progress spinner. Defaults to User mode (diagnostics hidden). Persists preference in localStorage.

## Context

The BAARA Next chat interface displays tool call pills (ToolIndicator) and tool result blocks (InlineCard) for every agent interaction. This diagnostic information is valuable for developers but noisy for end users. The toggle lets users switch between a clean conversation view (User mode) and a detailed diagnostic view (Dev mode).

---

## Architecture

Three files modified:

1. **`packages/web/src/stores/chat-store.ts`** — Add `devMode: boolean` state and `toggleDevMode()` action to the existing Zustand store. Initialized from `localStorage.getItem('baara-dev-mode') === 'true'`, defaulting to `false`. Writes to localStorage on toggle with `console.warn` on storage failure.

2. **`packages/web/src/components/ChatInput.tsx`** — Add a "Dev" / "User" toggle button in the footer status bar, between session cost and the system instructions tag. Uses the same dot + label pattern as the permission mode toggle (green dot + "Dev" when on, gray dot + "User" when off). Needs `data-testid="dev-mode-toggle"`.

3. **`packages/web/src/components/ChatMessage.tsx`** — Conditional rendering based on `devMode`:
   - **Dev mode (on):** Current behavior — tool call pills (ToolIndicator) and tool result blocks (InlineCard) render normally.
   - **User mode (off):** Tool pills and InlineCard hidden. While any tool call has `output === null` (still running), show a small spinning circle with "Working..." text inline. When all tool calls complete, spinner disappears — only agent text remains.

---

## Data Model

### Zustand State Addition

```
devMode: boolean              // false = User mode (default), true = Dev mode
toggleDevMode(): void         // toggles devMode, persists to localStorage
```

### localStorage

- Key: `"baara-dev-mode"`
- Values: `"true"` or `"false"` (string)
- Missing key → `false` (User mode default)
- Invalid value → strict `=== 'true'` comparison, anything else resolves to `false`

### Rendering Matrix

| Element | Dev mode (on) | User mode (off, default) |
|---------|--------------|--------------------------|
| Tool call pills (ToolIndicator) | Visible with name + checkmark | Hidden |
| Tool result blocks (InlineCard) | Visible | Hidden |
| In-progress indicator | ToolIndicator with spinner | Small spinning circle + "Working..." |
| Agent text response | Visible | Visible (unchanged) |
| Streaming cursor | Visible | Visible (unchanged) |
| Footer toggle | Green dot + "Dev" | Gray dot + "User" |

---

## Data Flow

```
User clicks toggle in footer
  │
  ▼
useChatStore.toggleDevMode()
  │  devMode = !devMode
  │  localStorage.setItem('baara-dev-mode', String(devMode))
  │  console.warn on storage failure
  │
  ▼
React re-renders all ChatMessage components
  │
  ├── devMode === true
  │     ToolIndicator renders per tool call
  │     InlineCard renders per tool result
  │
  └── devMode === false
        ToolIndicator hidden
        InlineCard hidden
        If message.streaming && any toolCall.output === null:
          Show spinner + "Working..." inline
        Else:
          Nothing extra — just agent text
```

### Key Behaviors

- Toggling applies immediately to ALL messages (not just new ones) — it's a conditional render, no data discarded.
- Spinner appears only when tools are actively running. Disappears when all complete.
- If agent streams text while tools run, both spinner and streaming text are visible simultaneously.
- Toggle works mid-conversation — switching Dev→User hides pills, User→Dev reveals them.

---

## Error Handling

- **localStorage unavailable** (private browsing, storage full): `getItem` returns `null` → `devMode` defaults to `false`. `setItem` wrapped in try/catch, failure logs `console.warn('Dev mode preference could not be saved — localStorage unavailable')`. Toggle works for current session, won't persist.
- **localStorage quota exceeded**: Same `console.warn` with specific error. Toggle continues in-memory.
- **Invalid localStorage value** (manually edited): `=== 'true'` strict comparison — anything else resolves to `false`.
- **Toggle during streaming**: Safe — purely a rendering switch. Tool call data remains in Zustand state regardless of visibility.

---

## Testing

### E2E Tests — `tests/e2e/specs/dev-mode.spec.ts`

**CI-safe tests (no API key):**
- Default state: fresh page shows "User" in footer with gray dot
- Toggle to Dev: click toggle, shows "Dev" with green dot
- Persistence: toggle to Dev, reload page, still shows "Dev"
- Toggle back: click again, shows "User" with gray dot

**Local-only tests (@local-only, requires API key):**
- Spinner in User mode: send message, verify "Working..." spinner visible while tools run, disappears after completion. Tool pills NOT visible.
- Switch mid-conversation: send message in User mode, toggle to Dev, verify tool pills appear. Toggle back, verify they disappear.

### What is NOT tested:
- localStorage failure paths — too environment-specific
- Server-side behavior — devMode is purely client-side

---

## Out of Scope

- Server-side awareness of dev mode
- Per-message dev mode (all-or-nothing toggle)
- Granular control over which diagnostics to show
- API/SSE protocol changes

---

## Acceptance Criteria

1. Footer bar shows "User" toggle with gray dot on fresh page load (no localStorage key).
2. Clicking toggle switches to "Dev" with green dot and back to "User" on next click.
3. Dev mode preference persists in localStorage across page reloads.
4. In User mode, tool call pills (ToolIndicator) and tool result blocks (InlineCard) are hidden in all agent messages.
5. In User mode, a spinner with "Working..." text appears inline while tool calls are in progress and disappears when all complete.
6. In Dev mode, existing behavior is unchanged — tool pills and results render normally.
7. Toggling mid-conversation applies immediately to all existing messages.
8. `data-testid="dev-mode-toggle"` attribute on the toggle button.
9. `console.warn` on localStorage write failure (not silent, not user-facing).
10. `bunx tsc --noEmit` passes in `packages/web` with zero errors.
11. E2E tests for dev mode pass (CI-safe toggle tests + local-only spinner tests).

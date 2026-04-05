# UX Test Workflows — Complete Button & Interaction Map

Every interactive element mapped to a user story. Test each in order.

## Prerequisites

```bash
rm -f ~/.baara/baara.db
BAARA_SHELL_ENABLED=true bun start
cd packages/web && npx vite --port 5173
```

Open http://localhost:5173

---

## STORY 1: First-Time User Opens the App

**Goal:** Verify the initial state renders correctly.

| # | Action | Expected | Element |
|---|--------|----------|---------|
| 1.1 | Open http://localhost:5173 | Page loads, dark theme | — |
| 1.2 | Observe header | Logo "B", "BAARA Next", "v0.1.0" badge, right-aligned "0 running · 0 queued · 0 failed", SD avatar | Header.tsx |
| 1.3 | Observe left sidebar | "THREADS" label, "+ New" button, "‹" collapse button | ThreadList.tsx |
| 1.4 | Observe Main thread | Pinned at top with 📌 icon, bold text, separator line below | ThreadList.tsx MainThreadRow |
| 1.5 | Observe center | Welcome screen: BAARA Next icon + tagline + 4 quick-action buttons | ChatWindow.tsx |
| 1.6 | Observe right panel | "›" collapse button, Tasks / Execs / Queues tabs, Execs selected by default | ControlPanel.tsx |
| 1.7 | Observe chat input | Text area "Message BAARA Next...", send button, meta row: Auto toggle, 27 tools, model dropdown, System button, $0.00 | ChatInput.tsx |

---

## STORY 2: User Creates a New Thread and Sends a Message

**Goal:** Thread creation + chat interaction + tool execution.

| # | Action | Expected | Element |
|---|--------|----------|---------|
| 2.1 | Click "+ New" button in sidebar | New thread "New Thread" appears in sidebar under TODAY, selected | ThreadList.tsx handleNewThread |
| 2.2 | Verify chat area | Welcome screen shown (fresh chat, no messages) | ChatWindow.tsx |
| 2.3 | Click chat input area | Input gets focus, border turns indigo | ChatInput.tsx |
| 2.4 | Type "Show queue status" | Text appears in input | ChatInput.tsx textarea |
| 2.5 | Press Enter | Message sent, user bubble appears right-aligned in indigo | ChatInput.tsx handleSend |
| 2.6 | Observe tool indicators | "ToolSearch" and "mcp__baara__list_queues" appear with spinners | ToolIndicator.tsx |
| 2.7 | Wait for response | Tool indicators flip to ✓ checkmarks, agent text renders with markdown | ChatMessage.tsx |
| 2.8 | Observe session cost | Updates to $0.xx | ChatInput.tsx sessionCostUsd |
| 2.9 | Observe thread sidebar | Thread title shows in sidebar | ThreadList.tsx |

---

## STORY 3: User Creates a Task via Chat

**Goal:** Natural language task creation through the chat interface.

| # | Action | Expected | Element |
|---|--------|----------|---------|
| 3.1 | Type "Create a task called echo-test that runs echo hello" | Message sent | ChatInput.tsx |
| 3.2 | Observe tool calls | "mcp__baara__create_task → echo-test" indicator appears | ToolIndicator.tsx |
| 3.3 | Wait for completion | Agent confirms task created | ChatMessage.tsx |
| 3.4 | Click "Tasks" tab in right panel | Tab switches to Tasks | ControlPanel.tsx panel-tab |
| 3.5 | Verify task appears | "echo-test" shown in task list with type and mode | ControlPanel.tsx TaskItem |

---

## STORY 4: User Creates a Task via UI

**Goal:** Task creation through the right panel form.

| # | Action | Expected | Element |
|---|--------|----------|---------|
| 4.1 | Click "Tasks" tab | Tasks tab active | ControlPanel.tsx |
| 4.2 | Click "+ New" button | Create form opens inline below button | ControlPanel.tsx creatingTask |
| 4.3 | Observe form fields | Name, Prompt, Type dropdown, Mode dropdown, Priority dropdown, Cron input, Max Retries, Timeout, Output Thread dropdown, Allowed Tools, Model, Budget, Pre-request Instructions textarea | TaskEditor.tsx (create mode) |
| 4.4 | Type name "ui-task" | Name field populated | TaskEditor.tsx setName |
| 4.5 | Type prompt "echo from ui" | Prompt field populated | TaskEditor.tsx setPrompt |
| 4.6 | Observe Output Thread dropdown | Shows "Current Thread" (if in a thread), "Main Thread (default)", other threads | TaskEditor.tsx targetThreadId select |
| 4.7 | Click "Save" | Form closes, task appears in list | TaskEditor.tsx handleSave |
| 4.8 | Click "Cancel" (on a new form) | Form closes without saving | TaskEditor.tsx onClose |

---

## STORY 5: User Edits an Existing Task

**Goal:** Modify task configuration through the UI.

| # | Action | Expected | Element |
|---|--------|----------|---------|
| 5.1 | Click on a task name in Tasks tab | Edit form opens inline with current values pre-filled | ControlPanel.tsx onEdit |
| 5.2 | Change prompt text | Text updates in field | TaskEditor.tsx setPrompt |
| 5.3 | Change Output Thread to a different thread | Dropdown selection changes | TaskEditor.tsx setTargetThreadId |
| 5.4 | Type pre-request instructions | Text area fills | TaskEditor.tsx setSystemPrompt |
| 5.5 | Change budget to "5.00" | Budget field updates | TaskEditor.tsx setBudgetUsd |
| 5.6 | Click "Save" | Form closes, values persisted | TaskEditor.tsx handleSave (edit mode) |

---

## STORY 6: User Runs a Task and Monitors Execution

**Goal:** Submit task to queue, watch execution, view details.

| # | Action | Expected | Element |
|---|--------|----------|---------|
| 6.1 | Click "Run" button on a task in Tasks tab | Task submitted to queue | ControlPanel.tsx TaskItem Run button |
| 6.2 | Click "Execs" tab | Execution list shown | ControlPanel.tsx |
| 6.3 | Observe execution entry | Shows task name, status badge (queued → running → completed), duration, timestamp | ControlPanel.tsx ExecutionItem |
| 6.4 | Observe header stats | "1 running" appears during execution, returns to "0 running" after | Header.tsx StatItem |
| 6.5 | Click on the execution entry | Execution detail opens inline | ControlPanel.tsx setSelectedExecId |
| 6.6 | Observe Overview tab | Status badge, duration, attempt count, tokens (4 stat cards) | ExecutionDetail.tsx Overview |
| 6.7 | Click "Events" tab | Event timeline: created → queued → assigned → started → completed | ExecutionDetail.tsx Events |
| 6.8 | Click "Logs" tab | JSONL log entries shown (if any) with search bar | ExecutionDetail.tsx Logs |
| 6.9 | Click "Tools" tab | Tool invocations listed (if any) | ExecutionDetail.tsx Tools |
| 6.10 | Click "×" close button on detail | Detail view closes, back to execution list | ExecutionDetail.tsx onClose |

---

## STORY 7: User Manages Queues

**Goal:** View and configure queue settings.

| # | Action | Expected | Element |
|---|--------|----------|---------|
| 7.1 | Click "Queues" tab | 4 queues shown: Transfer, Timer, Visibility, DLQ | ControlPanel.tsx QueuesTab |
| 7.2 | Observe queue descriptions | Human-readable labels (e.g., "Transfer Queue — dispatches tasks to agents") | ControlPanel.tsx QueueItem |
| 7.3 | Observe queue metrics | Depth, active count, max concurrency for each | ControlPanel.tsx QueueItem |
| 7.4 | Click on a queue | Editable maxConcurrency field appears | ControlPanel.tsx QueueItem expanded |
| 7.5 | Change maxConcurrency value | Number input updates | ControlPanel.tsx setMaxConcurrency |
| 7.6 | Click "Save" | Value persisted, form collapses | ControlPanel.tsx handleSaveQueue |
| 7.7 | Click "Cancel" | Form collapses without saving | ControlPanel.tsx |

---

## STORY 8: User Collapses and Expands Panels

**Goal:** Verify responsive panel behavior.

| # | Action | Expected | Element |
|---|--------|----------|---------|
| 8.1 | Click "‹" collapse button on left sidebar | Sidebar collapses with 200ms animation, chat expands | ThreadList.tsx onCollapse |
| 8.2 | Observe left edge | Small "›" expand chevron appears | App.tsx ThreadListExpandButton |
| 8.3 | Click expand chevron | Sidebar returns with animation | App.tsx setLeftCollapsed(false) |
| 8.4 | Click "›" collapse button on right panel | Panel collapses, chat expands | ControlPanel.tsx onCollapse |
| 8.5 | Observe right edge | Small "‹" expand chevron appears | App.tsx ControlPanelExpandButton |
| 8.6 | Click expand chevron | Panel returns | App.tsx setRightCollapsed(false) |
| 8.7 | Collapse both panels | Chat fills full width | — |
| 8.8 | Expand both panels | Three-zone layout restored | — |

---

## STORY 9: User Configures Permission Mode

**Goal:** Toggle permission modes and test tool approval flow.

| # | Action | Expected | Element |
|---|--------|----------|---------|
| 9.1 | Observe permission toggle | Shows "🟢 Auto ▾" | ChatInput.tsx modeConfig |
| 9.2 | Click toggle | Changes to "🟡 Ask ▾" | ChatInput.tsx cyclePermissionMode |
| 9.3 | Click toggle again | Changes to "🔴 Locked ▾" | ChatInput.tsx |
| 9.4 | Click toggle again | Back to "🟢 Auto ▾" | ChatInput.tsx |
| 9.5 | Set to "Ask" mode, send a message | Agent calls a tool → approval buttons appear: [✓ Allow] [✓ Allow for task] [✗ Deny] | ToolIndicator.tsx permission UI |
| 9.6 | Click "Allow" | Tool executes, indicator flips to ✓ | ToolIndicator.tsx respondToPermission |
| 9.7 | Set to "Ask" mode, send another message | Same tool appears → click "Allow for task" | ToolIndicator.tsx allow_task |
| 9.8 | Send same tool-triggering message again | Tool auto-approves (was approved for task) | chat-store.ts approvedTools |
| 9.9 | Set to "Ask" mode, deny a tool | Tool shows denied error in agent response | ToolIndicator.tsx deny |

---

## STORY 10: User Selects a Different Model

**Goal:** Switch Claude models.

| # | Action | Expected | Element |
|---|--------|----------|---------|
| 10.1 | Observe model dropdown | Shows "sonnet 4.6" (default) | ChatInput.tsx model select |
| 10.2 | Click dropdown | Options: sonnet 4.6, opus 4.6, haiku 4.5 | ChatInput.tsx |
| 10.3 | Select "haiku 4.5" | Dropdown updates | ChatInput.tsx setModel |
| 10.4 | Send a message | Response uses haiku (faster, shorter responses) | chat-store.ts model |

---

## STORY 11: User Configures System Instructions

**Goal:** Customize agent behavior via system prompt.

| # | Action | Expected | Element |
|---|--------|----------|---------|
| 11.1 | Click "System" button in meta bar | Popover opens upward with presets + text area | ChatInput.tsx sysInstrOpen |
| 11.2 | Observe presets | 4 buttons: Default, Concise responses, Detailed explanations, Code-focused | ChatInput.tsx SYSTEM_PRESETS |
| 11.3 | Click "Concise responses" | Text area fills with "Be as concise as possible..." | ChatInput.tsx setDraftInstructions |
| 11.4 | Click "Save" | Popover closes, "System" button shows indigo border (active) | ChatInput.tsx setSystemInstructions |
| 11.5 | Click outside popover | Popover closes without saving | ChatInput.tsx handleClick outside |
| 11.6 | Send a message | Agent response follows concise style | chat.ts systemInstructions |
| 11.7 | Open System popover, click "Default" preset, Save | Instructions cleared, "System" button loses accent border | ChatInput.tsx |

---

## STORY 12: User Browses Thread History

**Goal:** Switch between threads, load conversation history.

| # | Action | Expected | Element |
|---|--------|----------|---------|
| 12.1 | Create 2+ threads, send messages in each | Multiple threads in sidebar | — |
| 12.2 | Click a different thread | Chat loads that thread's conversation history | ThreadList.tsx handleSelectThread |
| 12.3 | Verify messages | User messages + agent responses from that thread shown | chat-store.ts loadThread |
| 12.4 | Click Main thread | Main thread loads (may have completion summaries) | ThreadList.tsx MainThreadRow |
| 12.5 | Click back to the other thread | Previous conversation restored | — |

---

## STORY 13: User Views Task Output in Main Thread

**Goal:** Verify task output routing.

| # | Action | Expected | Element |
|---|--------|----------|---------|
| 13.1 | Create a task without targetThreadId | Task created, defaults to Main thread | — |
| 13.2 | Submit the task (Run button or via chat) | Execution starts | — |
| 13.3 | Wait for completion | Execution completes | — |
| 13.4 | Click Main thread in sidebar | Completion summary message appears: "Task X completed in Yms. Output: ..." | orchestrator-service.ts handleExecutionComplete |
| 13.5 | Observe unread badge (if applicable) | Main thread shows unread count | ThreadList.tsx mainUnreadCount |

---

## STORY 14: Quick-Action Buttons

**Goal:** Test the 4 welcome screen buttons.

| # | Action | Expected | Element |
|---|--------|----------|---------|
| 14.1 | Click "Create a health check task" | Message sent to chat, agent creates a health check task | ChatWindow.tsx quick-action |
| 14.2 | Click "List running executions" | Message sent, agent lists executions | ChatWindow.tsx |
| 14.3 | Click "What failed in the last hour?" | Message sent, agent checks for failures | ChatWindow.tsx |
| 14.4 | Click "Show queue status" | Message sent, agent shows queue info | ChatWindow.tsx |

---

## STORY 15: Inline Card Interactions

**Goal:** Test tool result cards in chat.

| # | Action | Expected | Element |
|---|--------|----------|---------|
| 15.1 | Create a task via chat | Inline task card appears with: name, type, cron, priority, prompt | InlineCard.tsx TaskCard |
| 15.2 | Click "Edit" on task card | Sends "Edit task X" to chat | InlineCard.tsx onAction |
| 15.3 | Click "Run Now" on task card | Sends "Run task X now" to chat | InlineCard.tsx |
| 15.4 | Click "Disable" on task card | Sends "Toggle task X" to chat | InlineCard.tsx |
| 15.5 | Submit task → view execution card | Inline execution card with: status, duration, attempt | InlineCard.tsx ExecutionCard |
| 15.6 | Click "View Details" on exec card | Sends "Show details for execution X" to chat | InlineCard.tsx |
| 15.7 | Click "Retry" on failed exec card | Sends "Retry execution X" to chat | InlineCard.tsx |

---

## STORY 16: Avatar Menu

**Goal:** Test the header avatar.

| # | Action | Expected | Element |
|---|--------|----------|---------|
| 16.1 | Click SD avatar | (Currently no dropdown — future: appearance, settings, sign out) | Header.tsx avatar |

---

## STORY 17: Execution Filter

**Goal:** Filter executions in the right panel.

| # | Action | Expected | Element |
|---|--------|----------|---------|
| 17.1 | Click "Execs" tab | Execution list shown with filter bar | ControlPanel.tsx |
| 17.2 | Type in "Filter execs..." search bar | List filters by text match | ControlPanel.tsx filter input |

---

## STORY 18: Task Filter

**Goal:** Filter tasks in the right panel.

| # | Action | Expected | Element |
|---|--------|----------|---------|
| 18.1 | Click "Tasks" tab | Task list shown with filter bar | ControlPanel.tsx |
| 18.2 | Type in "Filter tasks..." search bar | List filters by text match | ControlPanel.tsx filter input |

---

## Defect Tracker

| # | Story | Issue | Severity | PR |
|---|-------|-------|----------|-----|
| D1 | W5/S4 | "+ New" task crashes UI (black screen) — `task.targetThreadId` without `?.` | P0 | #4 |
| D2 | W3/S2 | Tool indicators stay spinning during long tool calls | P1 | #3 |
| D3 | W2/S2 | Thread title stays "New Thread" after first message (doesn't update) | P2 | — |
| D4 | S16 | Avatar click does nothing (no dropdown menu) | P3 | — |

// tests/e2e/helpers/selectors.ts
//
// Centralised data-testid selector map for all E2E tests.
// Every selector in this file must correspond to a data-testid attribute
// added by Wave 1 (scout) to the web components.

export const Selectors = {
  // Left sidebar — ThreadList
  threadList: '[data-testid="thread-list"]',
  threadCollapseBtn: '[data-testid="thread-collapse"]',
  threadExpandBtn: '[data-testid="thread-expand"]',

  // Main chat area — ChatWindow
  chatWindow: '[data-testid="chat-window"]',

  // Chat input bar — ChatInput
  chatSendBtn: '[data-testid="chat-send"]',
  permissionMode: '[data-testid="permission-mode"]',
  devModeToggle: '[data-testid="dev-mode-toggle"]',
  modelSelector: '[data-testid="model-selector"]',
  sessionCost: '[data-testid="session-cost"]',
  chatInput: 'textarea[placeholder*="Message"]',

  // Message bubbles — ChatMessage
  msgUser: '[data-testid="msg-user"]',
  msgAgent: '[data-testid="msg-agent"]',

  // Right panel — ControlPanel
  controlPanel: '[data-testid="control-panel"]',
  cpCollapseBtn: '[data-testid="cp-collapse"]',
  cpExpandBtn: '[data-testid="cp-expand"]',

  // Header
  headerStatus: '[data-testid="header-status"]',

  // Dynamic selectors — functions that accept a label/name argument.
  quickAction: (label: string) => `button:has-text("${label}")`,
  cpTab: (name: string) => `button:has-text("${name}")`,

  // Fixed button labels
  cpNewTaskBtn: 'button:has-text("+ New")',
  threadNewBtn: 'button:has-text("New")',
} as const;

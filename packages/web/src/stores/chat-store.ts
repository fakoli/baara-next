import { create } from 'zustand';
import type { ChatMessage, Thread } from '../types.ts';
import { streamChat } from '../lib/api.ts';
import { useThreadStore } from './thread-store.ts';

interface ChatStore {
  messages: ChatMessage[];
  sessionId: string | null;
  threadId: string | null;
  streaming: boolean;
  error: string | null;
  /** Accumulated cost for the current session in USD */
  sessionCostUsd: number;
  /** Total tool invocations this session */
  toolCallCount: number;

  sendMessage: (text: string, abortSignal?: AbortSignal) => Promise<void>;
  loadThread: (thread: Thread) => void;
  clearChat: () => void;
}

function newUserMessage(text: string): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role: 'user',
    text,
    toolCalls: [],
    streaming: false,
    createdAt: new Date().toISOString(),
  };
}

function newAgentMessage(): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role: 'agent',
    text: '',
    toolCalls: [],
    streaming: true,
    createdAt: new Date().toISOString(),
  };
}

export const useChatStore = create<ChatStore>((set, get) => ({
  messages: [],
  sessionId: null,
  threadId: null,
  streaming: false,
  error: null,
  sessionCostUsd: 0,
  toolCallCount: 0,

  sendMessage: async (text, abortSignal) => {
    if (get().streaming) return;

    const userMsg = newUserMessage(text);
    const agentMsg = newAgentMessage();

    set((s) => ({
      messages: [...s.messages, userMsg, agentMsg],
      streaming: true,
      error: null,
    }));

    try {
      const gen = streamChat(text, {
        sessionId: get().sessionId ?? undefined,
        threadId: get().threadId ?? undefined,
        signal: abortSignal,
      });

      for await (const event of gen) {
        switch (event.type) {
          case 'system': {
            set({ sessionId: event.sessionId });
            if (event.threadId && !get().threadId) {
              set({ threadId: event.threadId });
            }
            break;
          }

          case 'text_delta': {
            set((s) => ({
              messages: s.messages.map((m) =>
                m.id === agentMsg.id ? { ...m, text: m.text + event.delta } : m
              ),
            }));
            break;
          }

          case 'tool_use': {
            set((s) => ({
              toolCallCount: s.toolCallCount + 1,
              messages: s.messages.map((m) =>
                m.id === agentMsg.id
                  ? {
                      ...m,
                      toolCalls: [
                        ...m.toolCalls,
                        { name: event.name, input: event.input, output: null },
                      ],
                    }
                  : m
              ),
            }));
            break;
          }

          case 'tool_result': {
            set((s) => ({
              messages: s.messages.map((m) => {
                if (m.id !== agentMsg.id) return m;
                // Fill output for the most recent tool call with this name
                const calls = [...m.toolCalls];
                for (let i = calls.length - 1; i >= 0; i--) {
                  if (calls[i]!.name === event.name && calls[i]!.output === null) {
                    calls[i] = { ...calls[i]!, output: event.output };
                    break;
                  }
                }
                return { ...m, toolCalls: calls };
              }),
            }));
            break;
          }

          case 'result': {
            const cost = event.cost ?? 0;
            set((s) => ({
              sessionCostUsd: s.sessionCostUsd + cost,
              messages: s.messages.map((m) =>
                m.id === agentMsg.id
                  ? { ...m, usage: event.usage, cost, streaming: false }
                  : m
              ),
            }));
            break;
          }

          case 'error': {
            set((s) => ({
              error: event.message,
              messages: s.messages.map((m) =>
                m.id === agentMsg.id ? { ...m, streaming: false } : m
              ),
            }));
            break;
          }

          case 'done': {
            set((s) => ({
              messages: s.messages.map((m) =>
                m.id === agentMsg.id ? { ...m, streaming: false } : m
              ),
            }));
            break;
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      set((s) => ({
        error: err instanceof Error ? err.message : 'Chat failed',
        messages: s.messages.map((m) =>
          m.id === agentMsg.id ? { ...m, streaming: false } : m
        ),
      }));
    } finally {
      set({ streaming: false });
      // Notify thread store to refresh list so new thread appears in sidebar
      void useThreadStore.getState().fetchThreads();
    }
  },

  loadThread: (thread) => {
    // Loading a thread clears the current chat and sets the thread context.
    // Message history replay is not yet implemented — the user sees an empty
    // chat with prior context still embedded in the server-side session.
    set({
      messages: [],
      threadId: thread.id,
      sessionId: null,
      streaming: false,
      error: null,
      sessionCostUsd: 0,
      toolCallCount: 0,
    });
  },

  clearChat: () => {
    set({
      messages: [],
      sessionId: null,
      threadId: null,
      streaming: false,
      error: null,
      sessionCostUsd: 0,
      toolCallCount: 0,
    });
  },
}));

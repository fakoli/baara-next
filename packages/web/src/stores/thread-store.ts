import { create } from 'zustand';
import type { Thread } from '../types.ts';
import { fetchThreads as apiFetchThreads, renameThread as apiRenameThread } from '../lib/api.ts';

interface ThreadStore {
  threads: Thread[];
  activeThreadId: string | null;
  loading: boolean;
  error: string | null;
  fetchThreads: () => Promise<void>;
  setActiveThread: (id: string | null) => void;
  addThread: (thread: Thread) => void;
  renameThread: (id: string, title: string) => Promise<void>;
}

export const useThreadStore = create<ThreadStore>((set, get) => ({
  threads: [],
  activeThreadId: null,
  loading: false,
  error: null,

  fetchThreads: async () => {
    set({ loading: true, error: null });
    try {
      const threads = await apiFetchThreads();
      // Sort most recent first
      threads.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      set({ threads, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to fetch threads',
      });
    }
  },

  setActiveThread: (id) => set({ activeThreadId: id }),

  addThread: (thread) => {
    set((s) => ({
      threads: [thread, ...s.threads.filter((t) => t.id !== thread.id)],
    }));
  },

  renameThread: async (id, title) => {
    const updated = await apiRenameThread(id, title);
    set((s) => ({
      threads: s.threads.map((t) => (t.id === id ? updated : t)),
    }));
    // Keep activeThreadId in sync if this is the active thread
    void get().fetchThreads();
  },
}));

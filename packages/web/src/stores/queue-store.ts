import { create } from 'zustand';
import type { QueueInfo, SystemStatus } from '../types.ts';
import { fetchQueues as apiFetchQueues, fetchSystemStatus as apiFetchSystemStatus } from '../lib/api.ts';

interface QueueStore {
  queues: QueueInfo[];
  systemStatus: SystemStatus | null;
  loading: boolean;
  error: string | null;
  fetchQueues: () => Promise<void>;
  fetchSystemStatus: () => Promise<void>;
}

export const useQueueStore = create<QueueStore>((set) => ({
  queues: [],
  systemStatus: null,
  loading: false,
  error: null,

  fetchQueues: async () => {
    set({ loading: true, error: null });
    try {
      const queues = await apiFetchQueues();
      set({ queues, loading: false });
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : 'Failed to fetch queues' });
    }
  },

  fetchSystemStatus: async () => {
    set({ loading: true, error: null });
    try {
      const systemStatus = await apiFetchSystemStatus();
      set({ systemStatus, loading: false });
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : 'Failed to fetch system status' });
    }
  },
}));

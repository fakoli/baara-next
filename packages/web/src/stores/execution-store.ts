import { create } from 'zustand';
import type { Execution, ExecutionEvent, ExecutionStatus } from '../types.ts';
import {
  fetchExecutions as apiFetchExecutions,
  fetchExecution as apiFetchExecution,
  fetchExecutionEvents as apiFetchExecutionEvents,
  cancelExecution as apiCancelExecution,
  retryExecution as apiRetryExecution,
  provideInput as apiProvideInput,
} from '../lib/api.ts';

interface ExecutionFilters {
  status?: ExecutionStatus;
  taskId?: string;
}

interface ExecutionStore {
  executions: Execution[];
  selectedExecution: Execution | null;
  selectedEvents: ExecutionEvent[];
  filters: ExecutionFilters;
  loading: boolean;
  error: string | null;
  fetchExecutions: () => Promise<void>;
  fetchExecution: (id: string) => Promise<void>;
  fetchExecutionEvents: (id: string) => Promise<void>;
  cancelExecution: (id: string) => Promise<void>;
  retryExecution: (id: string) => Promise<void>;
  provideInput: (id: string, response: string) => Promise<void>;
  setFilters: (filters: ExecutionFilters) => void;
  clearSelected: () => void;
}

export const useExecutionStore = create<ExecutionStore>((set, get) => ({
  executions: [],
  selectedExecution: null,
  selectedEvents: [],
  filters: {},
  loading: false,
  error: null,

  fetchExecutions: async () => {
    set({ loading: true, error: null });
    try {
      const executions = await apiFetchExecutions(get().filters);
      set({ executions, loading: false });
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : 'Failed to fetch executions' });
    }
  },

  fetchExecution: async (id) => {
    set({ loading: true, error: null });
    try {
      const execution = await apiFetchExecution(id);
      set({ selectedExecution: execution, loading: false });
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : 'Failed to fetch execution' });
    }
  },

  fetchExecutionEvents: async (id) => {
    try {
      const events = await apiFetchExecutionEvents(id);
      set({ selectedEvents: events });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to fetch events' });
    }
  },

  cancelExecution: async (id) => {
    try {
      await apiCancelExecution(id);
      // Server returns { ok: true }, not the updated execution — refetch to get
      // the actual cancelled state rather than storing a non-Execution object.
      const updated = await apiFetchExecution(id);
      set((state) => ({
        executions: state.executions.map((e) => (e.id === id ? updated : e)),
        selectedExecution: state.selectedExecution?.id === id ? updated : state.selectedExecution,
      }));
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to cancel execution' });
      throw err;
    }
  },

  retryExecution: async (id) => {
    try {
      const updated = await apiRetryExecution(id);
      set((state) => ({
        executions: [updated, ...state.executions.filter((e) => e.id !== id)],
        selectedExecution: state.selectedExecution?.id === id ? updated : state.selectedExecution,
      }));
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to retry execution' });
      throw err;
    }
  },

  provideInput: async (id, response) => {
    try {
      await apiProvideInput(id, response);
      await get().fetchExecution(id);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to provide input' });
      throw err;
    }
  },

  setFilters: (filters) => {
    set({ filters });
  },

  clearSelected: () => {
    set({ selectedExecution: null, selectedEvents: [] });
  },
}));

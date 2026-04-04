import { create } from 'zustand';
import type { Task, CreateTaskInput } from '../types.ts';
import { fetchTasks as apiFetchTasks, createTask as apiCreateTask, deleteTask as apiDeleteTask, updateTask as apiUpdateTask, runTask as apiRunTask } from '../lib/api.ts';

interface TaskStore {
  tasks: Task[];
  loading: boolean;
  error: string | null;
  fetchTasks: () => Promise<void>;
  createTask: (input: CreateTaskInput) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  toggleTask: (id: string) => Promise<void>;
  runTask: (id: string) => Promise<void>;
}

export const useTaskStore = create<TaskStore>((set, get) => ({
  tasks: [],
  loading: false,
  error: null,

  fetchTasks: async () => {
    set({ loading: true, error: null });
    try {
      const tasks = await apiFetchTasks();
      set({ tasks, loading: false });
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : 'Failed to fetch tasks' });
    }
  },

  createTask: async (input) => {
    set({ loading: true, error: null });
    try {
      const task = await apiCreateTask(input);
      set((state) => ({ tasks: [...state.tasks, task], loading: false }));
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : 'Failed to create task' });
      throw err;
    }
  },

  deleteTask: async (id) => {
    set({ loading: true, error: null });
    try {
      await apiDeleteTask(id);
      set((state) => ({ tasks: state.tasks.filter((t) => t.id !== id), loading: false }));
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : 'Failed to delete task' });
      throw err;
    }
  },

  toggleTask: async (id) => {
    const task = get().tasks.find((t) => t.id === id);
    if (!task) return;
    try {
      const updated = await apiUpdateTask(id, { enabled: !task.enabled });
      set((state) => ({ tasks: state.tasks.map((t) => (t.id === id ? updated : t)) }));
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to toggle task' });
      throw err;
    }
  },

  runTask: async (id) => {
    try {
      await apiRunTask(id);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to run task' });
      throw err;
    }
  },
}));

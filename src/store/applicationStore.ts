import { create } from 'zustand';
import type { Application, ApplicationStatus } from '@/types';
import {
  applicationsApi,
  type CreateApplicationPayload,
  type PatchApplicationPayload,
} from '@/lib/api';

interface ApplicationStoreState {
  applications: Application[];
  isLoading: boolean;
  isLoaded: boolean;
  error: string | null;

  loadApplications: () => Promise<void>;
  createApplication: (input: CreateApplicationPayload) => Promise<Application | null>;
  updateApplication: (id: string, patch: PatchApplicationPayload) => Promise<void>;
  deleteApplication: (id: string) => Promise<void>;
  moveApplication: (
    id: string,
    toStatus: ApplicationStatus,
    trigger?: 'manual' | 'email_auto' | 'nudge',
    triggerDetail?: string,
  ) => Promise<void>;
}

export const useApplicationStore = create<ApplicationStoreState>()((set, get) => ({
  applications: [],
  isLoading: false,
  isLoaded: false,
  error: null,

  loadApplications: async () => {
    set({ isLoading: true, error: null });
    try {
      const applications = await applicationsApi.list();
      set({ applications, isLoading: false, isLoaded: true });
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : 'Failed to load applications',
      });
    }
  },

  createApplication: async (input) => {
    try {
      const created = await applicationsApi.create(input);
      set({ applications: [created, ...get().applications] });
      return created;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to create application' });
      return null;
    }
  },

  updateApplication: async (id, patch) => {
    const previous = get().applications;
    // Optimistic update
    set({
      applications: previous.map((a) =>
        a.id === id ? { ...a, ...patch, lastUpdatedAt: new Date().toISOString() } : a,
      ),
    });
    try {
      const updated = await applicationsApi.patch(id, patch);
      set({ applications: get().applications.map((a) => (a.id === id ? updated : a)) });
    } catch (err) {
      set({
        applications: previous,
        error: err instanceof Error ? err.message : 'Failed to update application',
      });
    }
  },

  deleteApplication: async (id) => {
    const previous = get().applications;
    set({ applications: previous.filter((a) => a.id !== id) });
    try {
      await applicationsApi.remove(id);
    } catch (err) {
      set({
        applications: previous,
        error: err instanceof Error ? err.message : 'Failed to delete application',
      });
    }
  },

  moveApplication: async (id, toStatus, trigger = 'manual', triggerDetail) => {
    const previous = get().applications;
    const current = previous.find((a) => a.id === id);
    if (!current || current.status === toStatus) return;

    // Optimistic: update status locally with a synthetic history entry
    const now = new Date().toISOString();
    set({
      applications: previous.map((a) =>
        a.id === id
          ? {
              ...a,
              status: toStatus,
              lastUpdatedAt: now,
              history: [
                ...a.history,
                {
                  id: `temp-${now}`,
                  fromStatus: a.status,
                  toStatus,
                  trigger,
                  triggerDetail,
                  changedAt: now,
                },
              ],
            }
          : a,
      ),
    });

    try {
      const updated = await applicationsApi.patch(id, { status: toStatus, trigger, triggerDetail });
      set({ applications: get().applications.map((a) => (a.id === id ? updated : a)) });
    } catch (err) {
      set({
        applications: previous,
        error: err instanceof Error ? err.message : 'Failed to move application',
      });
    }
  },
}));

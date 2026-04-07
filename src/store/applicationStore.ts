import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Application, ApplicationStatus, StatusHistoryEntry } from '@/types';
import { mockApplications } from '@/data/mockApplications';

const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export type NewApplicationInput = Omit<
  Application,
  'id' | 'createdAt' | 'lastUpdatedAt' | 'history' | 'tags' | 'isRemote'
> & {
  tags?: string[];
  isRemote?: boolean;
};

interface ApplicationStoreState {
  applications: Application[];
  createApplication: (input: NewApplicationInput) => Application;
  updateApplication: (id: string, patch: Partial<Application>) => void;
  deleteApplication: (id: string) => void;
  moveApplication: (id: string, toStatus: ApplicationStatus, trigger?: StatusHistoryEntry['trigger'], triggerDetail?: string) => void;
  reset: () => void;
}

export const useApplicationStore = create<ApplicationStoreState>()(
  persist(
    (set, get) => ({
      applications: mockApplications,

      createApplication: (input) => {
        const now = new Date().toISOString();
        const app: Application = {
          id: uid(),
          companyName: input.companyName,
          roleTitle: input.roleTitle,
          jobUrl: input.jobUrl,
          jdSnapshot: input.jdSnapshot,
          status: input.status,
          source: input.source,
          appliedAt: input.appliedAt,
          contactName: input.contactName,
          contactEmail: input.contactEmail,
          notes: input.notes,
          salaryRange: input.salaryRange,
          location: input.location,
          tags: input.tags ?? [],
          isRemote: input.isRemote ?? false,
          createdAt: now,
          lastUpdatedAt: now,
          history: [
            {
              id: uid(),
              fromStatus: null,
              toStatus: input.status,
              trigger: 'manual',
              changedAt: now,
            },
          ],
        };
        set({ applications: [app, ...get().applications] });
        return app;
      },

      updateApplication: (id, patch) => {
        set({
          applications: get().applications.map((a) =>
            a.id === id ? { ...a, ...patch, lastUpdatedAt: new Date().toISOString() } : a,
          ),
        });
      },

      deleteApplication: (id) => {
        set({ applications: get().applications.filter((a) => a.id !== id) });
      },

      moveApplication: (id, toStatus, trigger = 'manual', triggerDetail) => {
        const now = new Date().toISOString();
        set({
          applications: get().applications.map((a) => {
            if (a.id !== id || a.status === toStatus) return a;
            const entry: StatusHistoryEntry = {
              id: uid(),
              fromStatus: a.status,
              toStatus,
              trigger,
              triggerDetail,
              changedAt: now,
            };
            return {
              ...a,
              status: toStatus,
              lastUpdatedAt: now,
              appliedAt: a.appliedAt ?? (toStatus === 'APPLIED' ? now : a.appliedAt),
              history: [...a.history, entry],
            };
          }),
        });
      },

      reset: () => set({ applications: mockApplications }),
    }),
    {
      name: 'joblog-applications-v1',
    },
  ),
);

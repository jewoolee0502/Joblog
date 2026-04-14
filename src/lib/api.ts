import type { Application, ApplicationStatus } from '@/types';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    credentials: 'include',
  });
  if (!res.ok) {
    let detail: unknown;
    try {
      detail = await res.json();
    } catch {
      detail = await res.text();
    }
    throw new ApiError(res.status, `API ${res.status} ${res.statusText}`, detail);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public detail?: unknown) {
    super(message);
  }
}

export type CreateApplicationPayload = {
  companyName: string;
  roleTitle: string;
  jobUrl?: string;
  jdSnapshot?: string;
  status: ApplicationStatus;
  source: Application['source'];
  contactName?: string;
  contactEmail?: string;
  notes?: string;
  tags?: string[];
  salaryRange?: string;
  location?: string;
  isRemote?: boolean;
  appliedAt?: string;
};

export type PatchApplicationPayload = Partial<CreateApplicationPayload> & {
  trigger?: 'manual' | 'email_auto' | 'nudge';
  triggerDetail?: string;
};

export const applicationsApi = {
  list: () => request<Application[]>('/api/applications'),
  get: (id: string) => request<Application>(`/api/applications/${id}`),
  create: (payload: CreateApplicationPayload) =>
    request<Application>('/api/applications', { method: 'POST', body: JSON.stringify(payload) }),
  patch: (id: string, payload: PatchApplicationPayload) =>
    request<Application>(`/api/applications/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  remove: (id: string) =>
    request<void>(`/api/applications/${id}`, { method: 'DELETE' }),
};

// ---------------------------------------------------------------------------
// Auth / connection status
// ---------------------------------------------------------------------------

export interface ConnectionStatus {
  gmail: { connected: boolean; lastPolledAt: string | null };
  outlook: { connected: boolean; lastPolledAt: string | null };
}

export const authApi = {
  getConnections: () =>
    request<ConnectionStatus>('/api/auth/connections'),
  disconnectGmail: () =>
    request<{ disconnected: boolean }>('/api/auth/gmail', { method: 'DELETE' }),
  disconnectOutlook: () =>
    request<{ disconnected: boolean }>('/api/auth/outlook', { method: 'DELETE' }),
};

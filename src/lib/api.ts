import type { Application, ApplicationStatus, Nudge } from '@/types';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

let _getToken: (() => Promise<string | null>) | null = null;

export function setAuthTokenGetter(fn: () => Promise<string | null>) {
  _getToken = fn;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = _getToken ? await _getToken() : null;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string> ?? {}),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers,
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
  undo: (id: string) =>
    request<Application>(`/api/applications/${id}/undo`, { method: 'POST' }),
};

// ---------------------------------------------------------------------------
// Nudges
// ---------------------------------------------------------------------------

export const nudgesApi = {
  list: () => request<Nudge[]>('/api/nudges'),
  dismiss: (id: string) =>
    request<Nudge>(`/api/nudges/${id}/dismiss`, { method: 'PATCH' }),
};

// ---------------------------------------------------------------------------
// Auth / connection status
// ---------------------------------------------------------------------------

export interface ConnectionStatus {
  gmail: { connected: boolean; lastPolledAt: string | null };
  outlook: { connected: boolean; lastPolledAt: string | null };
}

export interface ScanStatusData {
  status: 'running' | 'completed' | 'failed';
  result?: {
    emailsScanned: number;
    statusUpdates: number;
    newApplications: number;
    flaggedForReview: number;
    errors: string[];
  };
  error?: string;
}

export const authApi = {
  getConnections: () =>
    request<ConnectionStatus>('/api/auth/connections'),
  disconnectGmail: () =>
    request<{ disconnected: boolean }>('/api/auth/gmail', { method: 'DELETE' }),
  disconnectOutlook: () =>
    request<{ disconnected: boolean }>('/api/auth/outlook', { method: 'DELETE' }),
  triggerScan: (months?: number) =>
    request<{ emailsScanned: number; matched: number; statusUpdates: number; newApplications: number; flaggedForReview: number; errors: string[] }>(
      `/api/auth/trigger-scan${months ? `?months=${months}` : ''}`,
      { method: 'POST' },
    ),
  getScanStatus: () =>
    request<{ data: ScanStatusData | null }>('/api/auth/scan-status'),
};

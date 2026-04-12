import type { Application, StatusHistory } from '@prisma/client';

export interface ApplicationDTO {
  id: string;
  companyName: string;
  roleTitle: string;
  jobUrl?: string;
  jdSnapshot?: string;
  status: string;
  source: string;
  appliedAt?: string;
  lastUpdatedAt: string;
  contactName?: string;
  contactEmail?: string;
  notes?: string;
  tags: string[];
  salaryRange?: string;
  location?: string;
  isRemote: boolean;
  createdAt: string;
  history: StatusHistoryDTO[];
}

export interface StatusHistoryDTO {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  trigger: string;
  triggerDetail?: string;
  changedAt: string;
}

export function toApplicationDTO(
  app: Application & { history?: StatusHistory[] },
): ApplicationDTO {
  return {
    id: app.id,
    companyName: app.companyName,
    roleTitle: app.roleTitle,
    jobUrl: app.jobUrl ?? undefined,
    jdSnapshot: app.jdSnapshot ?? undefined,
    status: app.status,
    source: app.source,
    appliedAt: app.appliedAt?.toISOString(),
    lastUpdatedAt: app.lastUpdatedAt.toISOString(),
    contactName: app.contactName ?? undefined,
    contactEmail: app.contactEmail ?? undefined,
    notes: app.notes ?? undefined,
    tags: app.tags,
    salaryRange: app.salaryRange ?? undefined,
    location: app.location ?? undefined,
    isRemote: app.isRemote,
    createdAt: app.createdAt.toISOString(),
    history: (app.history ?? []).map(toStatusHistoryDTO),
  };
}

export function toStatusHistoryDTO(h: StatusHistory): StatusHistoryDTO {
  return {
    id: h.id,
    fromStatus: h.fromStatus,
    toStatus: h.toStatus,
    trigger: h.trigger,
    triggerDetail: h.triggerDetail ?? undefined,
    changedAt: h.changedAt.toISOString(),
  };
}

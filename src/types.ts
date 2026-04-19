// Application domain types — see PRD §4.1, §4.2

export const APPLICATION_STATUSES = [
  'SAVED',
  'APPLIED',
  'SCREENING',
  'INTERVIEW',
  'FINAL_ROUND',
  'OFFER',
  'ACCEPTED',
  'REJECTED',
  'WITHDRAWN',
  'GHOSTED',
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const APPLICATION_SOURCES = [
  'linkedin',
  'company_site',
  'cold_email',
  'referral',
  'job_board',
  'other',
] as const;

export type ApplicationSource = (typeof APPLICATION_SOURCES)[number];

export interface StatusHistoryEntry {
  id: string;
  fromStatus: ApplicationStatus | null;
  toStatus: ApplicationStatus;
  trigger: 'manual' | 'email_auto' | 'nudge';
  triggerDetail?: string;
  changedAt: string; // ISO timestamp
}

export interface Application {
  id: string;
  companyName: string;
  roleTitle: string;
  jobUrl?: string;
  jdSnapshot?: string;
  status: ApplicationStatus;
  source: ApplicationSource;
  appliedAt?: string; // ISO
  lastUpdatedAt: string; // ISO
  contactName?: string;
  contactEmail?: string;
  emailUrl?: string;
  notes?: string;
  tags: string[];
  salaryRange?: string;
  location?: string;
  isRemote: boolean;
  createdAt: string; // ISO
  history: StatusHistoryEntry[];
}

// Stage labels for UI
export const STATUS_LABELS: Record<ApplicationStatus, string> = {
  SAVED: 'Saved',
  APPLIED: 'Applied',
  SCREENING: 'Screening',
  INTERVIEW: 'Interview',
  FINAL_ROUND: 'Final Round',
  OFFER: 'Offer',
  ACCEPTED: 'Accepted',
  REJECTED: 'Rejected',
  WITHDRAWN: 'Withdrawn',
  GHOSTED: 'Ghosted',
};

// Default columns shown on the kanban (PRD §7.2 — REJECTED collapsed by default)
export const KANBAN_COLUMNS: ApplicationStatus[] = [
  'SAVED',
  'APPLIED',
  'SCREENING',
  'INTERVIEW',
  'FINAL_ROUND',
  'OFFER',
  'ACCEPTED',
  'REJECTED',
  'WITHDRAWN',
  'GHOSTED',
];

export interface Nudge {
  id: string;
  applicationId: string;
  nudgeType: string;
  message: string;
  isDismissed: boolean;
  createdAt: string;
  application: {
    id: string;
    companyName: string;
    roleTitle: string;
    status: string;
  };
}

// Stale thresholds in days (PRD §4.5)
export const STALE_THRESHOLDS: Partial<Record<ApplicationStatus, number>> = {
  APPLIED: 7,
  SCREENING: 4,
  INTERVIEW: 3,
  FINAL_ROUND: 3,
};

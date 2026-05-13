/** Application statuses in pipeline order (PRD §4.2). */
export const STAGE_ORDER = [
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

export type ApplicationStatus = (typeof STAGE_ORDER)[number];

/** Statuses where the application is no longer active. */
export const TERMINAL_STATUSES: ApplicationStatus[] = [
  'ACCEPTED',
  'REJECTED',
  'WITHDRAWN',
  'GHOSTED',
];

/** Email classification categories — unified with kanban statuses (no mapping needed). */
export const CLASSIFICATION_CATEGORIES = [
  'APPLIED',
  'SCREENING',
  'INTERVIEW',
  'REJECTED',
  'OFFER',
  'UNCLEAR',
] as const;

export type ClassificationCategory = (typeof CLASSIFICATION_CATEGORIES)[number];

/** Minimum confidence required to auto-advance a stage. */
export const CONFIDENCE_THRESHOLDS = {
  default: 0.75,
  REJECTED: 0.85,
} as const;

/** Max emails per LLM batch for triage processing. */
export const TRIAGE_BATCH_SIZE = 50;

/** Max chars of email body sent to the classifier (PRD §4.3). */
export const EMAIL_BODY_MAX_CHARS = 1500;

/** Max chars for JD snapshots (PRD §5). */
export const JD_MAX_CHARS = 10_000;

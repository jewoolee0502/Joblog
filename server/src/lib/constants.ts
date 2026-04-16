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

/** Email classification categories produced by the Claude classifier. */
export const CLASSIFICATION_CATEGORIES = [
  'ACKNOWLEDGEMENT',
  'SCREENING_REQUEST',
  'INTERVIEW_INVITE',
  'REJECTION',
  'OFFER',
  'UNCLEAR',
] as const;

export type ClassificationCategory = (typeof CLASSIFICATION_CATEGORIES)[number];

/** Maps a classification category to the target application status. */
export const CLASSIFICATION_TO_STATUS: Record<string, ApplicationStatus> = {
  ACKNOWLEDGEMENT: 'APPLIED',
  SCREENING_REQUEST: 'SCREENING',
  INTERVIEW_INVITE: 'INTERVIEW',
  REJECTION: 'REJECTED',
  OFFER: 'OFFER',
};

/** Minimum confidence required to auto-advance a stage. */
export const CONFIDENCE_THRESHOLDS = {
  default: 0.75,
  REJECTED: 0.85,
} as const;

/** Max chars of email body sent to the classifier (PRD §4.3). */
export const EMAIL_BODY_MAX_CHARS = 500;

/** Max chars for JD snapshots (PRD §5). */
export const JD_MAX_CHARS = 10_000;

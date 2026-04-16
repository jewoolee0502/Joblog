export const STAGE_ORDER = [
  'SAVED', 'APPLIED', 'SCREENING', 'INTERVIEW',
  'FINAL_ROUND', 'OFFER', 'ACCEPTED', 'REJECTED', 'WITHDRAWN', 'GHOSTED',
] as const;

export type ApplicationStatus = (typeof STAGE_ORDER)[number];

export const TERMINAL_STATUSES: ApplicationStatus[] = ['ACCEPTED', 'REJECTED', 'WITHDRAWN', 'GHOSTED'];

export const CLASSIFICATION_CATEGORIES = [
  'ACKNOWLEDGEMENT', 'SCREENING_REQUEST', 'INTERVIEW_INVITE',
  'REJECTION', 'OFFER', 'UNCLEAR',
] as const;

export type ClassificationCategory = (typeof CLASSIFICATION_CATEGORIES)[number];

export const CLASSIFICATION_TO_STATUS: Record<string, ApplicationStatus> = {
  ACKNOWLEDGEMENT: 'APPLIED',
  SCREENING_REQUEST: 'SCREENING',
  INTERVIEW_INVITE: 'INTERVIEW',
  REJECTION: 'REJECTED',
  OFFER: 'OFFER',
};

export const CONFIDENCE_THRESHOLDS = { default: 0.75, REJECTED: 0.85 } as const;

export const EMAIL_BODY_MAX_CHARS = 500;

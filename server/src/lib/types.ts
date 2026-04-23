import type { ClassificationCategory } from './constants.js';

/** Normalized email from either Gmail or Outlook. */
export interface NormalizedEmail {
  messageId: string;
  from: string;
  fromDomain: string;
  subject: string;
  bodySnippet: string;
  receivedAt: Date;
  provider: 'gmail' | 'outlook';
}

/** Result from the Claude email classifier. */
export interface ClassificationResult {
  category: ClassificationCategory;
  confidence: number;
  reason: string;
}

/** Result from triaging an unmatched email — is it job-related? */
export interface TriageResult {
  isJobRelated: boolean;
  category: ClassificationCategory;
  confidence: number;
  reason: string;
  companyName: string | null;
  roleTitle: string | null;
  location: string | null;
  contactName: string | null;
  jobDescription: string | null;
  isRemote: boolean;
}

/** A matched application from domain lookup. */
export interface ApplicationMatch {
  id: string;
  companyName: string;
  roleTitle: string;
  status: string;
}

/** Summary returned after a full email scan. */
export interface ScanResult {
  emailsScanned: number;
  matched: number;
  statusUpdates: number;
  newApplications: number;
  flaggedForReview: number;
  errors: string[];
}

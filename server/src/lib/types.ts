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

/** Summary returned after a full email scan. */
export interface ScanResult {
  emailsScanned: number;
  matched: number;
  statusUpdates: number;
  flaggedForReview: number;
  errors: string[];
}

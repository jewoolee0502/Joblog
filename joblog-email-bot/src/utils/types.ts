import type { ClassificationCategory } from './constants';

export interface NormalizedEmail {
  messageId: string;
  from: string;
  fromDomain: string;
  subject: string;
  bodySnippet: string;
  receivedAt: Date;
  provider: 'gmail' | 'outlook';
}

export interface ClassificationResult {
  category: ClassificationCategory;
  confidence: number;
  reason: string;
}

export interface TriageResult {
  isJobRelated: boolean;
  category: ClassificationCategory;
  confidence: number;
  reason: string;
  companyName: string | null;
  roleTitle: string | null;
}

export interface ScanResult {
  emailsScanned: number;
  matched: number;
  statusUpdates: number;
  newApplications: number;
  flaggedForReview: number;
  errors: string[];
}

export interface ApplicationMatch {
  id: string;
  companyName: string;
  roleTitle: string;
  status: string;
}

export interface ApplicationRow {
  id: string;
  user_id: string;
  company_name: string;
  role_title: string;
  job_url: string | null;
  status: string;
  source: string;
  contact_email: string | null;
}

export interface UserRow {
  id: string;
  email: string;
  gmail_refresh_token: string | null;
  outlook_refresh_token: string | null;
  gmail_last_polled_at: string | null;
  outlook_last_polled_at: string | null;
}

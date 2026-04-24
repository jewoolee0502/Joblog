import { STAGE_ORDER, EMAIL_BODY_MAX_CHARS } from './constants.js';
import type { NormalizedEmail, ApplicationMatch } from './types.js';

// ---------------------------------------------------------------------------
// Email utility functions
// ---------------------------------------------------------------------------

export function extractEmailAddress(from: string): string {
  const match = from.match(/<([^>]+)>/);
  return (match ? match[1] : from).trim().toLowerCase();
}

export function extractDomain(email: string): string {
  const at = email.lastIndexOf('@');
  return at >= 0 ? email.slice(at + 1).toLowerCase() : '';
}

export function extractRootDomain(url: string): string {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname.replace(/^(careers|jobs|boards|apply|hire|recruiting|www)\./, '');
  } catch {
    return '';
  }
}

export function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(inc|llc|corp|ltd|limited|co|company|technologies|tech)\b\.?/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

export function isForwardTransition(currentStatus: string, targetStatus: string): boolean {
  if (targetStatus === 'REJECTED') return true;
  const currentIdx = STAGE_ORDER.indexOf(currentStatus as any);
  const targetIdx = STAGE_ORDER.indexOf(targetStatus as any);
  if (currentIdx === -1 || targetIdx === -1) return false;
  return targetIdx > currentIdx;
}

export function truncateBody(body: string): string {
  return body.length > EMAIL_BODY_MAX_CHARS ? body.slice(0, EMAIL_BODY_MAX_CHARS) : body;
}

// ---------------------------------------------------------------------------
// Domain matching
// ---------------------------------------------------------------------------

/** Row shape from Prisma application query */
export interface ApplicationRow {
  id: string;
  companyName: string;
  roleTitle: string;
  jobUrl: string | null;
  status: string;
  contactEmail: string | null;
}

/**
 * Build a lookup map from email domains/company names → matching applications.
 */
export function buildDomainLookup(
  applications: ApplicationRow[],
): Map<string, ApplicationMatch[]> {
  const map = new Map<string, ApplicationMatch[]>();

  for (const app of applications) {
    const match: ApplicationMatch = {
      id: app.id,
      companyName: app.companyName,
      roleTitle: app.roleTitle,
      status: app.status,
    };

    const domains: string[] = [];

    if (app.contactEmail) {
      const domain = extractDomain(app.contactEmail);
      if (domain) domains.push(domain);
    }

    if (app.jobUrl) {
      const domain = extractRootDomain(app.jobUrl);
      if (domain) domains.push(domain);
    }

    const normalized = normalizeCompanyName(app.companyName);
    if (normalized) domains.push(`__company__${normalized}`);

    for (const domain of domains) {
      const existing = map.get(domain) ?? [];
      existing.push(match);
      map.set(domain, existing);
    }
  }

  return map;
}

/**
 * Find all matching applications for an email using domain lookup.
 */
export function matchEmailToApplications(
  email: NormalizedEmail,
  domainMap: Map<string, ApplicationMatch[]>,
): ApplicationMatch[] {
  const exactMatch = domainMap.get(email.fromDomain);
  if (exactMatch && exactMatch.length > 0) return exactMatch;

  const rootDomain = email.fromDomain.replace(
    /^(mail|noreply|notifications|careers|hr|talent|recruiting)\./,
    '',
  );
  if (rootDomain !== email.fromDomain) {
    const rootMatch = domainMap.get(rootDomain);
    if (rootMatch && rootMatch.length > 0) return rootMatch;
  }

  for (const [key, apps] of domainMap) {
    if (!key.startsWith('__company__')) continue;
    const companySlug = key.replace('__company__', '');
    if (companySlug.length >= 3 && email.fromDomain.includes(companySlug)) {
      return apps;
    }
  }

  return [];
}

/**
 * Check if two role titles refer to the same position.
 */
export function fuzzyMatchRoleTitle(emailRole: string, appRole: string): boolean {
  const normalize = (s: string) =>
    s.toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

  return normalize(emailRole) === normalize(appRole);
}

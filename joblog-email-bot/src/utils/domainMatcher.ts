import { extractDomain, extractRootDomain, normalizeCompanyName } from './emailUtils';
import type { NormalizedEmail, ApplicationMatch, ApplicationRow } from './types';

export function buildDomainLookup(
  applications: ApplicationRow[],
): Map<string, ApplicationMatch[]> {
  const map = new Map<string, ApplicationMatch[]>();

  for (const app of applications) {
    const match: ApplicationMatch = {
      id: app.id,
      companyName: app.company_name,
      roleTitle: app.role_title,
      status: app.status,
    };

    const domains: string[] = [];

    if (app.contact_email) {
      const domain = extractDomain(app.contact_email);
      if (domain) domains.push(domain);
    }

    if (app.job_url) {
      const domain = extractRootDomain(app.job_url);
      if (domain) domains.push(domain);
    }

    const normalized = normalizeCompanyName(app.company_name);
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
 * Returns all candidates (may be multiple for same company, different roles).
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
 * Only exact match after normalization (case/punctuation insensitive).
 */
export function fuzzyMatchRoleTitle(emailRole: string, appRole: string): boolean {
  const normalize = (s: string) =>
    s.toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

  return normalize(emailRole) === normalize(appRole);
}

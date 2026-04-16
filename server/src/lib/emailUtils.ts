import { STAGE_ORDER, EMAIL_BODY_MAX_CHARS } from './constants.js';

/** Extract the email address from a "Name <email>" or plain email string. */
export function extractEmailAddress(from: string): string {
  const match = from.match(/<([^>]+)>/);
  return (match ? match[1] : from).trim().toLowerCase();
}

/** Extract domain from an email address. */
export function extractDomain(email: string): string {
  const at = email.lastIndexOf('@');
  return at >= 0 ? email.slice(at + 1).toLowerCase() : '';
}

/**
 * Extract the root domain from a URL, stripping common subdomains
 * like `careers.`, `jobs.`, `boards.`, `apply.`, `www.`.
 */
export function extractRootDomain(url: string): string {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    // Strip common hiring-platform subdomains
    const stripped = hostname.replace(
      /^(careers|jobs|boards|apply|hire|recruiting|www)\./,
      '',
    );
    return stripped;
  } catch {
    return '';
  }
}

/**
 * Normalize a company name for fuzzy matching:
 * lowercase, strip common suffixes and punctuation.
 */
export function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(inc|llc|corp|ltd|limited|co|company|technologies|tech)\b\.?/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

/**
 * Check whether `targetStatus` is a forward move from `currentStatus`
 * in the application pipeline. REJECTED is always allowed from any stage.
 */
export function isForwardTransition(
  currentStatus: string,
  targetStatus: string,
): boolean {
  if (targetStatus === 'REJECTED') return true;

  const currentIdx = STAGE_ORDER.indexOf(currentStatus as any);
  const targetIdx = STAGE_ORDER.indexOf(targetStatus as any);

  if (currentIdx === -1 || targetIdx === -1) return false;
  return targetIdx > currentIdx;
}

/**
 * Quick pre-filter to skip emails obviously not job application status updates.
 * Returns true if the email should be SKIPPED.
 */
export function isObviouslyNotJobRelated(email: { from: string; fromDomain: string; subject: string }): boolean {
  const domain = email.fromDomain.toLowerCase();
  const subject = email.subject.toLowerCase();
  const from = email.from.toLowerCase();

  // Only domains that are NEVER job-related (pure consumer/personal services).
  // DO NOT add companies you might apply to.
  const skipDomains = [
    'discord.com', 'quora.com', 'reddit.com', 'tiktok.com', 'instagram.com', 'facebook.com',
    'grailed.com', 'musinsa.com', 'brownsshoes.com', 'sunglasshut.com', 'floraqueen.com',
    'interac.ca', 'tossbank.com', 'tossinvest.com',
    'hydro.qc.ca', 'communauto.com', 'communauto.ca', 'buildingstack.com', 'artm.quebec',
    'sagradafamilia.org', 'bsmsa.cat', 'covermanager.com', 'lapedrera.com',
    'holafly.com', 'tremblant.ca',
    'substack.com',
    'auth.canada.ca', 'saaq.gouv.qc.ca', 'authentification.quebec.ca',
    'revenuquebec.ca', 'cra-arc.gc.ca', 'francais-enligne.quebec', 'mifi.notification.gouv.qc.ca',
    'showmojo.com', 'kw.com',
    'luma-mail.com', 'splitwise.com', 'livefootballtickets.com', 'chess.com',
  ];

  if (skipDomains.some((d) => domain === d || domain.endsWith('.' + d))) return true;

  if (domain.includes('linkedin.com')) {
    // Always keep emails about applications (rejections, updates, etc.)
    if (subject.includes('your application') || subject.includes('application to')) {
      return false;
    }
    if (from.includes('jobalerts') || from.includes('editors') ||
        from.includes('newsletters') || from.includes('jobs-noreply') ||
        from.includes('linkedin@em.linkedin.com')) {
      return true;
    }
  }

  const skipSubjectPatterns = [
    /% off/i, /promo/i, /expires soon/i, /price drop/i,
    /weekly digest/i, /newsletter/i, /top picks/i,
    /what's happening in/i, /your .* statement/i,
    /receipt from/i, /your bill/i, /invoice/i, /payment/i,
    /security alert/i, /sign-in/i, /new device login/i,
    /verify your email/i, /password/i,
    /mentioned you in/i, /sent you a message/i,
  ];

  if (skipSubjectPatterns.some((p) => p.test(subject))) return true;

  return false;
}

/**
 * Fuzzy match a role title extracted from an email against an application's role title.
 */
export function fuzzyMatchRoleTitle(emailRole: string, appRole: string): boolean {
  const normalize = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();

  const a = normalize(emailRole);
  const b = normalize(appRole);

  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;

  const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'at', 'in', 'for', 'to', 'sr', 'jr', 'i', 'ii', 'iii']);
  const wordsA = a.split(' ').filter((w) => w.length > 1 && !stopWords.has(w));
  const wordsB = b.split(' ').filter((w) => w.length > 1 && !stopWords.has(w));
  const overlap = wordsA.filter((w) => wordsB.includes(w));

  return overlap.length >= 2 || (overlap.length >= 1 && Math.min(wordsA.length, wordsB.length) <= 2);
}

/** Truncate a string to EMAIL_BODY_MAX_CHARS. */
export function truncateBody(body: string): string {
  return body.length > EMAIL_BODY_MAX_CHARS
    ? body.slice(0, EMAIL_BODY_MAX_CHARS)
    : body;
}

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

/** Truncate a string to EMAIL_BODY_MAX_CHARS. */
export function truncateBody(body: string): string {
  return body.length > EMAIL_BODY_MAX_CHARS
    ? body.slice(0, EMAIL_BODY_MAX_CHARS)
    : body;
}

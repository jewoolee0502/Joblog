import { STAGE_ORDER, EMAIL_BODY_MAX_CHARS } from './constants';

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

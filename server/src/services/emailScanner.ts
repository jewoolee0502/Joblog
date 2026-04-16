import { prisma } from '../db.js';
import {
  TERMINAL_STATUSES,
  CLASSIFICATION_TO_STATUS,
  CONFIDENCE_THRESHOLDS,
} from '../lib/constants.js';
import {
  extractDomain,
  extractRootDomain,
  normalizeCompanyName,
  isForwardTransition,
} from '../lib/emailUtils.js';
import type { NormalizedEmail, ScanResult } from '../lib/types.js';
import { fetchGmailEmails } from './gmail.js';
import { fetchOutlookEmails } from './outlook.js';
import { classifyEmail, triageEmail } from './emailClassifier.js';

interface ApplicationMatch {
  id: string;
  companyName: string;
  status: string;
}

/**
 * Get the previous calendar day window (00:00–23:59 EST).
 */
function getYesterdayWindow(): Date {
  const now = new Date();
  // Use EST/EDT-aware date by working in America/New_York
  const estNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const yesterday = new Date(estNow);
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);
  return yesterday;
}

/**
 * Run a full email scan for a user: fetch from Gmail + Outlook,
 * match to tracked applications, classify, and update statuses.
 * Unmatched job-related emails create new application cards.
 */
export async function runEmailScan(userId: string, sinceOverride?: Date): Promise<ScanResult> {
  const result: ScanResult = {
    emailsScanned: 0,
    matched: 0,
    statusUpdates: 0,
    newApplications: 0,
    flaggedForReview: 0,
    errors: [],
  };

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

  // 1. Fetch ALL applications (including terminal) for domain matching
  const applications = await prisma.application.findMany({
    where: { userId },
  });

  const domainMap = buildDomainLookup(applications);

  // 2. Determine scan window — always scan previous calendar day (sinceOverride for manual deep scans only)
  const since = sinceOverride ?? getYesterdayWindow();

  // 3. Fetch emails from connected providers (all emails, read and unread)
  const allEmails: NormalizedEmail[] = [];

  if (user.gmailRefreshToken) {
    try {
      console.log(`[scanner] Gmail scanning since ${since.toISOString()}`);
      const gmailEmails = await fetchGmailEmails(userId, since);
      allEmails.push(...gmailEmails);
    } catch (err) {
      const msg = `Gmail fetch error: ${err instanceof Error ? err.message : String(err)}`;
      console.error('[scanner]', msg);
      result.errors.push(msg);
    }
  }

  if (user.outlookRefreshToken) {
    try {
      console.log(`[scanner] Outlook scanning since ${since.toISOString()}`);
      const outlookEmails = await fetchOutlookEmails(userId, since);
      allEmails.push(...outlookEmails);
    } catch (err) {
      const msg = `Outlook fetch error: ${err instanceof Error ? err.message : String(err)}`;
      console.error('[scanner]', msg);
      result.errors.push(msg);
    }
  }

  result.emailsScanned = allEmails.length;

  if (allEmails.length === 0) {
    console.log('[scanner] No new emails found for user', userId);
    return result;
  }

  console.log(`[scanner] Found ${allEmails.length} emails for user ${userId}:`);
  for (const e of allEmails) {
    console.log(`  [${e.provider}] From: ${e.from} | Subject: ${e.subject}`);
  }

  // 4. Process each email
  for (const email of allEmails) {
    const app = matchEmailToApplication(email, domainMap);

    if (app) {
      // === MATCHED to existing application ===
      result.matched++;

      // Skip terminal applications — don't re-classify
      if (TERMINAL_STATUSES.includes(app.status as any)) continue;

      try {
        const classification = await classifyEmail(email, app.companyName);
        const targetStatus = CLASSIFICATION_TO_STATUS[classification.category];

        const threshold =
          classification.category === 'REJECTION'
            ? CONFIDENCE_THRESHOLDS.REJECTED
            : CONFIDENCE_THRESHOLDS.default;

        const meetsThreshold = classification.confidence >= threshold;
        const isValidTarget =
          targetStatus && isForwardTransition(app.status, targetStatus);

        if (meetsThreshold && isValidTarget) {
          await prisma.$transaction([
            prisma.application.update({
              where: { id: app.id },
              data: { status: targetStatus, lastUpdatedAt: new Date() },
            }),
            prisma.statusHistory.create({
              data: {
                applicationId: app.id,
                fromStatus: app.status,
                toStatus: targetStatus,
                trigger: 'email_auto',
                triggerDetail: `${classification.category} (${classification.confidence.toFixed(2)}): ${email.subject}`,
              },
            }),
          ]);
          result.statusUpdates++;
        } else if (classification.category !== 'UNCLEAR' || classification.confidence > 0) {
          await prisma.nudge.create({
            data: {
              applicationId: app.id,
              nudgeType: 'email_review',
              message: `Email from ${email.from}: "${email.subject}" — classified as ${classification.category} (${classification.confidence.toFixed(2)}). ${classification.reason}`,
            },
          });
          result.flaggedForReview++;
        }
      } catch (err) {
        const msg = `Classification error for ${email.messageId}: ${err instanceof Error ? err.message : String(err)}`;
        console.error('[scanner]', msg);
        result.errors.push(msg);
      }
    } else {
      // === UNMATCHED — triage to see if it's job-related ===
      try {
        const triage = await triageEmail(email);

        if (!triage.isJobRelated) continue;
        if (!triage.companyName) continue;

        const targetStatus = CLASSIFICATION_TO_STATUS[triage.category] ?? 'APPLIED';

        // Create a new application card
        const newApp = await prisma.application.create({
          data: {
            userId,
            companyName: triage.companyName,
            roleTitle: triage.roleTitle ?? 'Unknown Role',
            status: targetStatus,
            source: 'other',
            contactEmail: email.from,
            history: {
              create: {
                fromStatus: null,
                toStatus: targetStatus,
                trigger: 'email_auto',
                triggerDetail: `Auto-created from email: "${email.subject}" — ${triage.category} (${triage.confidence.toFixed(2)})`,
              },
            },
          },
        });

        console.log(`[scanner] Created new application for ${triage.companyName} (${newApp.id})`);
        result.newApplications++;

        // Add to domain map so subsequent emails from the same company match
        const newMatch: ApplicationMatch = {
          id: newApp.id,
          companyName: triage.companyName,
          status: targetStatus,
        };
        const domain = extractDomain(email.from);
        if (domain) {
          const existing = domainMap.get(domain) ?? [];
          existing.push(newMatch);
          domainMap.set(domain, existing);
        }
      } catch (err) {
        const msg = `Triage error for ${email.messageId}: ${err instanceof Error ? err.message : String(err)}`;
        console.error('[scanner]', msg);
        result.errors.push(msg);
      }
    }
  }

  console.log('[scanner] Scan complete for user', userId, result);
  return result;
}

/**
 * Build a map of domain → application(s) for fast email matching.
 * Uses contactEmail domain, jobUrl root domain, and normalized company name.
 */
function buildDomainLookup(
  applications: Array<{
    id: string;
    companyName: string;
    status: string;
    contactEmail: string | null;
    jobUrl: string | null;
  }>,
): Map<string, ApplicationMatch[]> {
  const map = new Map<string, ApplicationMatch[]>();

  for (const app of applications) {
    const match: ApplicationMatch = {
      id: app.id,
      companyName: app.companyName,
      status: app.status,
    };

    const domains: string[] = [];

    // Priority 1: contact email domain
    if (app.contactEmail) {
      const domain = extractDomain(app.contactEmail);
      if (domain) domains.push(domain);
    }

    // Priority 2: job URL root domain
    if (app.jobUrl) {
      const domain = extractRootDomain(app.jobUrl);
      if (domain) domains.push(domain);
    }

    // Priority 3: normalized company name as pseudo-domain (e.g., "google")
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
 * Try to match an email to a tracked application using the domain lookup.
 */
function matchEmailToApplication(
  email: NormalizedEmail,
  domainMap: Map<string, ApplicationMatch[]>,
): ApplicationMatch | null {
  // Try exact domain match first
  const exactMatch = domainMap.get(email.fromDomain);
  if (exactMatch && exactMatch.length > 0) {
    return exactMatch[0];
  }

  // Try root domain (strip subdomains from sender)
  const rootDomain = email.fromDomain.replace(
    /^(mail|noreply|notifications|careers|hr|talent|recruiting)\./,
    '',
  );
  if (rootDomain !== email.fromDomain) {
    const rootMatch = domainMap.get(rootDomain);
    if (rootMatch && rootMatch.length > 0) {
      return rootMatch[0];
    }
  }

  // Fuzzy match: check if sender domain contains a tracked company name
  for (const [key, apps] of domainMap) {
    if (!key.startsWith('__company__')) continue;
    const companySlug = key.replace('__company__', '');
    if (companySlug.length >= 3 && email.fromDomain.includes(companySlug)) {
      return apps[0];
    }
  }

  return null;
}

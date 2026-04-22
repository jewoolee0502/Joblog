import { prisma } from '../db.js';
import { createBotpressClient } from '../lib/botpress.js';
import { fetchGmailEmails } from './gmail.js';
import { fetchOutlookEmails } from './outlook.js';
import { isObviouslyNotJobRelated, getYesterdayWindow } from '../lib/emailFilter.js';
import {
  buildDomainLookup,
  matchEmailToApplications,
  fuzzyMatchRoleTitle,
  isForwardTransition,
} from '../lib/domainMatcher.js';
import {
  TERMINAL_STATUSES,
  CLASSIFICATION_TO_STATUS,
  CONFIDENCE_THRESHOLDS,
  CLASSIFICATION_CATEGORIES,
} from '../lib/constants.js';
import type { NormalizedEmail, ScanResult, ApplicationMatch } from '../lib/types.js';
import type { ClassificationCategory } from '../lib/constants.js';

const BATCH_SIZE = 50;

function buildEmailUrl(provider: string, messageId: string): string {
  if (provider === 'gmail') {
    return `https://mail.google.com/mail/u/0/#inbox/${messageId}`;
  }
  return `https://outlook.live.com/mail/0/inbox/id/${encodeURIComponent(messageId)}`;
}

/**
 * Run an email scan for a single user.
 * Fetches emails, pre-filters, classifies via Botpress LLM, and applies results to DB.
 */
export async function runEmailScan(userId: string, sinceOverride?: string): Promise<ScanResult> {
  const result: ScanResult = {
    emailsScanned: 0,
    matched: 0,
    statusUpdates: 0,
    newApplications: 0,
    flaggedForReview: 0,
    errors: [],
  };

  const since = sinceOverride ? new Date(sinceOverride) : getYesterdayWindow();
  console.log(`[emailScanner] Scanning emails since ${since.toISOString()} for user ${userId}`);

  // 1. Fetch user's applications for domain matching
  const applications = await prisma.application.findMany({
    where: { userId },
    select: { id: true, companyName: true, roleTitle: true, jobUrl: true, status: true, contactEmail: true },
  });
  const domainMap = buildDomainLookup(applications);

  // 2. Fetch emails from Gmail + Outlook
  const allEmails: NormalizedEmail[] = [];

  try {
    allEmails.push(...await fetchGmailEmails(userId, since));
  } catch (err) {
    result.errors.push(`Gmail: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    allEmails.push(...await fetchOutlookEmails(userId, since));
  } catch (err) {
    result.errors.push(`Outlook: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 3. Deduplicate by messageId
  const seen = new Set<string>();
  const deduped = allEmails.filter((e) => {
    if (seen.has(e.messageId)) return false;
    seen.add(e.messageId);
    return true;
  });

  result.emailsScanned = deduped.length;

  // 4. Pre-filter + domain match
  const matched: Array<{ email: NormalizedEmail; app: ApplicationMatch }> = [];
  const unmatched: NormalizedEmail[] = [];

  for (const email of deduped) {
    const candidates = matchEmailToApplications(email, domainMap);

    if (candidates.length > 0) {
      const activeCandidate = candidates.find((c) => !TERMINAL_STATUSES.includes(c.status as any));
      if (activeCandidate) {
        matched.push({ email, app: activeCandidate });
      }
    } else if (!isObviouslyNotJobRelated(email)) {
      unmatched.push(email);
    }
  }

  result.matched = matched.length;
  console.log(`[emailScanner] ${deduped.length} fetched, ${matched.length} matched, ${unmatched.length} unmatched`);

  const bpClient = createBotpressClient();

  // 5. Process matched emails in batches — classify via Botpress LLM
  for (let i = 0; i < matched.length; i += BATCH_SIZE) {
    const batch = matched.slice(i, i + BATCH_SIZE);

    try {
      const { output } = await bpClient.callAction({
        type: 'classifyEmails',
        input: {
          emails: batch.map((m) => ({
            from: m.email.from,
            subject: m.email.subject,
            bodySnippet: m.email.bodySnippet,
            companyName: m.app.companyName,
          })),
        },
      });

      const classifications = (output as any).results as Array<{
        category: string; confidence: number; reason: string;
      }>;

      // Apply classification results to DB
      for (let j = 0; j < batch.length; j++) {
        const { email, app } = batch[j];
        const classification = classifications[j];
        if (!classification) continue;

        const category = classification.category as ClassificationCategory;
        if (!CLASSIFICATION_CATEGORIES.includes(category)) continue;

        const targetStatus = CLASSIFICATION_TO_STATUS[category];
        const threshold = category === 'REJECTION'
          ? CONFIDENCE_THRESHOLDS.REJECTED
          : CONFIDENCE_THRESHOLDS.default;

        if (classification.confidence >= threshold && targetStatus && isForwardTransition(app.status, targetStatus)) {
          await prisma.application.update({
            where: { id: app.id },
            data: { status: targetStatus, lastUpdatedAt: new Date() },
          });

          await prisma.statusHistory.create({
            data: {
              applicationId: app.id,
              fromStatus: app.status,
              toStatus: targetStatus,
              trigger: 'email_auto',
              triggerDetail: `${category} (${classification.confidence.toFixed(2)}): ${email.subject}`,
            },
          });

          result.statusUpdates++;
          console.log(`[emailScanner] Updated ${app.companyName}: ${app.status} → ${targetStatus}`);
        } else if (category !== 'UNCLEAR' || classification.confidence > 0) {
          await prisma.nudge.create({
            data: {
              applicationId: app.id,
              nudgeType: 'email_review',
              message: `Email from ${email.from}: "${email.subject}" — ${category} (${classification.confidence.toFixed(2)}). ${classification.reason}`,
            },
          });
          result.flaggedForReview++;
        }
      }
    } catch (err) {
      result.errors.push(`Classify batch: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 6. Process unmatched emails in batches — triage via Botpress LLM
  for (let i = 0; i < unmatched.length; i += BATCH_SIZE) {
    const batch = unmatched.slice(i, i + BATCH_SIZE);

    try {
      const { output } = await bpClient.callAction({
        type: 'triageEmails',
        input: {
          emails: batch.map((e) => ({
            from: e.from,
            subject: e.subject,
            bodySnippet: e.bodySnippet,
          })),
        },
      });

      const triageResults = (output as any).results as Array<{
        isJobRelated: boolean; category: string; confidence: number; reason: string;
        companyName: string | null; roleTitle: string | null; location: string | null;
        contactName: string | null; jobDescription: string | null; isRemote: boolean;
      }>;

      for (let j = 0; j < batch.length; j++) {
        const email = batch[j];
        const triage = triageResults[j];
        if (!triage || !triage.isJobRelated || !triage.companyName) continue;

        const roleTitle = triage.roleTitle || 'Unknown Role';
        const companyName = triage.companyName;

        // Duplicate check
        const existingApps = await prisma.application.findMany({
          where: {
            userId,
            companyName: { equals: companyName, mode: 'insensitive' },
          },
          select: { id: true, roleTitle: true },
        });

        if (existingApps.some((a) => fuzzyMatchRoleTitle(roleTitle, a.roleTitle))) {
          console.log(`[emailScanner] Skipping duplicate: ${companyName} — ${roleTitle}`);
          continue;
        }

        const targetStatus = CLASSIFICATION_TO_STATUS[triage.category as ClassificationCategory] ?? 'APPLIED';
        const emailUrl = buildEmailUrl(email.provider, email.messageId);

        await prisma.application.create({
          data: {
            userId,
            companyName,
            roleTitle,
            status: targetStatus,
            source: 'other',
            contactEmail: email.from,
            emailUrl,
            location: triage.location || undefined,
            contactName: triage.contactName || undefined,
            jdSnapshot: triage.jobDescription || undefined,
            isRemote: triage.isRemote ?? false,
            history: {
              create: {
                fromStatus: null,
                toStatus: targetStatus,
                trigger: 'email_auto',
                triggerDetail: `Auto-created: "${email.subject}" — ${triage.category}`,
              },
            },
          },
        });

        result.newApplications++;
        console.log(`[emailScanner] New application: ${companyName} — ${roleTitle}`);
      }
    } catch (err) {
      result.errors.push(`Triage batch: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`[emailScanner] Scan complete: ${result.emailsScanned} scanned, ${result.statusUpdates} updates, ${result.newApplications} new apps, ${result.flaggedForReview} flagged`);

  return result;
}

/**
 * Run email scan for ALL users with connected email accounts.
 * Called by the daily cron job.
 */
export async function runFullScan(): Promise<void> {
  console.log('[emailScanner] Starting full scan for all users');

  const users = await prisma.user.findMany({
    where: {
      OR: [
        { gmailRefreshToken: { not: null } },
        { outlookRefreshToken: { not: null } },
      ],
    },
    select: { id: true },
  });

  if (users.length === 0) {
    console.log('[emailScanner] No users with connected email accounts');
    return;
  }

  for (const user of users) {
    try {
      const result = await runEmailScan(user.id);
      console.log(`[emailScanner] User ${user.id}: ${result.emailsScanned} scanned, ${result.statusUpdates} updates, ${result.newApplications} new`);
    } catch (err) {
      console.error(`[emailScanner] Error scanning user ${user.id}:`, err);
    }
  }

  console.log('[emailScanner] Full scan complete');
}

import { prisma } from '../db.js';
import { createBotpressClient } from '../lib/botpress.js';
import { fetchGmailEmails } from './gmail.js';
import { fetchOutlookEmails } from './outlook.js';
import { isObviouslyNotJobRelated, getYesterdayWindow } from '../lib/emailFilter.js';
import {
  buildDomainLookup,
  matchEmailToApplications,
  isForwardTransition,
  fuzzyMatchRoleTitle,
} from '../lib/domainMatcher.js';
import {
  TERMINAL_STATUSES,
  CONFIDENCE_THRESHOLDS,
  CLASSIFICATION_CATEGORIES,
  TRIAGE_BATCH_SIZE,
} from '../lib/constants.js';
import type { NormalizedEmail, ScanResult, ApplicationMatch } from '../lib/types.js';
import type { ClassificationCategory } from '../lib/constants.js';


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
    const gmailEmails = await fetchGmailEmails(userId, since);
    console.log(`[emailScanner] Gmail returned ${gmailEmails.length} emails`);
    allEmails.push(...gmailEmails);
  } catch (err) {
    console.error('[emailScanner] Gmail fetch error:', err);
    result.errors.push(`Gmail: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    const outlookEmails = await fetchOutlookEmails(userId, since);
    console.log(`[emailScanner] Outlook returned ${outlookEmails.length} emails`);
    allEmails.push(...outlookEmails);
  } catch (err) {
    console.error('[emailScanner] Outlook fetch error:', err);
    result.errors.push(`Outlook: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 3. Deduplicate by messageId
  const seen = new Set<string>();
  const deduped = allEmails.filter((e) => {
    if (seen.has(e.messageId)) return false;
    seen.add(e.messageId);
    return true;
  });

  // Sort oldest-first so LLM processes emails in chronological order
  deduped.sort((a, b) => new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime());

  result.emailsScanned = deduped.length;

  // 4. Pre-filter + domain match
  const matched: Array<{ email: NormalizedEmail; candidates: ApplicationMatch[] }> = [];
  const unmatched: NormalizedEmail[] = [];

  for (const email of deduped) {
    const candidates = matchEmailToApplications(email, domainMap);
    const activeCandidates = candidates.filter((c) => !TERMINAL_STATUSES.includes(c.status as any));

    if (activeCandidates.length > 0) {
      matched.push({ email, candidates: activeCandidates });
    } else if (!isObviouslyNotJobRelated(email)) {
      unmatched.push(email);
    }
  }

  result.matched = matched.length;
  console.log(`[emailScanner] ${deduped.length} fetched, ${matched.length} matched, ${unmatched.length} unmatched`);

  const bpClient = createBotpressClient();

  // 5. Group matched emails by company, merging all candidates across emails (Bug 3 fix)
  const companyGroups = new Map<string, { candidates: ApplicationMatch[]; emails: NormalizedEmail[] }>();

  for (const { email, candidates } of matched) {
    const companyKey = candidates[0].companyName.toLowerCase();
    const existing = companyGroups.get(companyKey);
    if (existing) {
      existing.emails.push(email);
      // Merge candidates from all emails, dedup by id
      for (const c of candidates) {
        if (!existing.candidates.some((ec) => ec.id === c.id)) {
          existing.candidates.push(c);
        }
      }
    } else {
      companyGroups.set(companyKey, { candidates: [...candidates], emails: [email] });
    }
  }

  // Collect UNCLEAR emails from classify to re-route to triage (Bug 1 fix)
  const unclearFromClassify: NormalizedEmail[] = [];

  for (const [, group] of companyGroups) {
    const { candidates, emails } = group;
    const companyName = candidates[0].companyName;

    try {
      console.log(`[classify] Processing ${emails.length} emails for ${companyName} (${candidates.length} roles: ${candidates.map((c) => c.roleTitle).join(', ')})`);

      const { output } = await bpClient.callAction({
        type: 'classifyEmails',
        input: {
          companyName,
          candidateRoles: candidates.map((c) => ({
            roleTitle: c.roleTitle,
            currentStatus: c.status,
          })),
          emails: emails.map((e) => ({
            from: e.from,
            subject: e.subject,
            bodySnippet: e.bodySnippet,
          })),
        },
      });

      const classifications = (output as any).results as Array<{
        category: string; confidence: number; reason: string; matchedRoleIndex: number;
      }>;

      // Apply classification results to DB
      for (let j = 0; j < emails.length; j++) {
        const email = emails[j];
        const classification = classifications[j];
        if (!classification) continue;

        const category = classification.category as ClassificationCategory;
        const roleIdx = Math.max(0, Math.min(classification.matchedRoleIndex ?? 0, candidates.length - 1));
        const app = candidates[roleIdx];

        // Log every classification decision
        console.log(`[classify] "${email.subject}" → ${category} (${classification.confidence.toFixed(2)}) | role[${roleIdx}]: "${app.roleTitle}" | ${classification.reason}`);

        if (!CLASSIFICATION_CATEGORIES.includes(category) || category === 'UNCLEAR') {
          // Bug 1 fix: re-route UNCLEAR emails to triage so they can create new applications
          // (e.g., email about a role not in candidateRoles)
          unclearFromClassify.push(email);
          console.log(`[classify]   ↳ RE-ROUTED to triage (unclear — may be a new role)`);
          continue;
        }

        // Category IS the target status (no mapping needed)
        const targetStatus = category;
        const threshold = category === 'REJECTED'
          ? CONFIDENCE_THRESHOLDS.REJECTED
          : CONFIDENCE_THRESHOLDS.default;

        // Skip if below confidence threshold
        if (classification.confidence < threshold) {
          console.log(`[classify]   ↳ FLAGGED (confidence ${classification.confidence.toFixed(2)} < threshold ${threshold})`);
          await prisma.nudge.create({
            data: {
              applicationId: app.id,
              nudgeType: 'email_review',
              message: `Email from ${email.from}: "${email.subject}" — ${category} (${classification.confidence.toFixed(2)}). ${classification.reason}`,
            },
          });
          result.flaggedForReview++;
          continue;
        }

        // Skip if not a forward transition (same stage or backward = already handled)
        if (!isForwardTransition(app.status, targetStatus)) {
          console.log(`[classify]   ↳ SKIPPED (not forward: ${app.roleTitle} is already at ${app.status}, target was ${targetStatus})`);
          continue;
        }

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
        console.log(`[classify]   ↳ UPDATED ${companyName} — ${app.roleTitle}: ${app.status} → ${targetStatus}`);
      }
    } catch (err) {
      console.error(`[emailScanner] classifyEmails failed for ${companyName}:`, err);
      result.errors.push(`Classify ${companyName}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Bug 1 fix: append UNCLEAR emails from classify to unmatched for triage
  if (unclearFromClassify.length > 0) {
    console.log(`[emailScanner] Re-routing ${unclearFromClassify.length} unclear emails from classify to triage`);
    unmatched.push(...unclearFromClassify);
  }

  // 6. Process unmatched emails in batches — triage via Botpress LLM
  for (let i = 0; i < unmatched.length; i += TRIAGE_BATCH_SIZE) {
    const batch = unmatched.slice(i, i + TRIAGE_BATCH_SIZE);

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

        if (!triage) continue;

        // Log every triage decision
        if (!triage.isJobRelated) {
          console.log(`[triage] "${email.subject}" → NOT JOB RELATED | ${triage.reason}`);
          continue;
        }

        if (!triage.companyName) {
          console.log(`[triage] "${email.subject}" → JOB RELATED but no company extracted | ${triage.reason}`);
          continue;
        }

        const roleTitle = triage.roleTitle;
        const companyName = triage.companyName;

        console.log(`[triage] "${email.subject}" → ${triage.category} (${triage.confidence.toFixed(2)}) | ${companyName} — ${roleTitle || '(no role)'} | ${triage.reason}`);

        // Bug 2 fix: skip if no meaningful role title was extracted
        if (!roleTitle || roleTitle === 'Unknown Role') {
          console.log(`[triage]   ↳ SKIPPED (no role title extracted — cannot create meaningful ticket)`);
          continue;
        }

        // Duplicate check
        const existingApps = await prisma.application.findMany({
          where: {
            userId,
            companyName: { equals: companyName, mode: 'insensitive' },
          },
          select: { id: true, roleTitle: true },
        });

        if (existingApps.some((a) => fuzzyMatchRoleTitle(roleTitle, a.roleTitle))) {
          console.log(`[triage]   ↳ SKIPPED (duplicate — "${roleTitle}" already exists at ${companyName})`);
          continue;
        }

        const targetStatus = triage.category !== 'UNCLEAR' ? triage.category : 'APPLIED';
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
        console.log(`[triage]   ↳ CREATED ${companyName} — ${roleTitle} (${targetStatus})`);
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

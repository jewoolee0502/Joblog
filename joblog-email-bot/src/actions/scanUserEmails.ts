import { Action, z } from '@botpress/runtime';
import { query } from '../utils/supabase';
import {
  TERMINAL_STATUSES,
  CLASSIFICATION_TO_STATUS,
  CONFIDENCE_THRESHOLDS,
  CLASSIFICATION_CATEGORIES,
} from '../utils/constants';
import { extractDomain, isForwardTransition } from '../utils/emailUtils';
import { buildDomainLookup, matchEmailToApplications, fuzzyMatchRoleTitle } from '../utils/domainMatcher';
import { fetchGmailEmails } from '../utils/gmailFetcher';
import { fetchOutlookEmails } from '../utils/outlookFetcher';
import type { NormalizedEmail, ApplicationRow, ApplicationMatch, ScanResult } from '../utils/types';
import type { ClassificationCategory } from '../utils/constants';

const CLASSIFY_SYSTEM_PROMPT = `You are a job application status email classifier. Given an email from a company the user applied to, classify it into exactly one category:
- ACKNOWLEDGEMENT — Company confirmed receipt of the user's job application.
- SCREENING_REQUEST — Company requesting a phone screen, initial conversation, or online assessment for the user's application.
- INTERVIEW_INVITE — Company inviting the user to an interview (technical, behavioral, onsite, etc.).
- REJECTION — Company rejecting the user's application.
- OFFER — Company extending a job offer to the user.
- UNCLEAR — The email is not about the user's application status (e.g., marketing, newsletter, general company update).

Only classify as a status update if the email is specifically about the user's application. General marketing emails from the company should be classified as UNCLEAR.
Return a JSON object with: category, confidence (0.0-1.0), reason (one sentence).`;

const TRIAGE_SYSTEM_PROMPT = `You are a job application status email triage system. Determine if the email is a STATUS UPDATE about a job application the user has ALREADY SUBMITTED.

Only these count as job-related:
- Application acknowledgement/confirmation
- Screening or phone interview request
- Interview invitation
- Rejection notice
- Job offer
- Online assessment / coding challenge invitation

NOT job-related (mark is_job_related = false):
- Job board notifications ("New jobs posted", "Companies are hiring")
- Marketing emails, newsletters, promotions
- Product updates, surveys, account notifications
- Recruiter outreach that is NOT about a specific application

Return a JSON object with:
- is_job_related (boolean)
- category (ACKNOWLEDGEMENT, SCREENING_REQUEST, INTERVIEW_INVITE, REJECTION, OFFER, or UNCLEAR)
- confidence (0.0-1.0)
- reason (one sentence)
- company_name (string or null)
- role_title (exact role title from the email, or null)
- location (city/region mentioned in the email, e.g. "Montreal, QC" or "Remote", or null)
- contact_name (recruiter/hiring manager name if mentioned, or null)
- job_description (brief 1-2 sentence summary of the role/position from the email content, or null)
- is_remote (boolean, true if remote work is mentioned)`;

async function callLLM(client: any, systemPrompt: string, userMessage: string): Promise<Record<string, unknown>> {
  const response = await client.callAction({
    type: 'anthropic:generateContent',
    input: {
      model: { id: 'claude-sonnet-4-20250514' },
      systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
      responseFormat: 'json_object',
      maxTokens: 512,
    },
  });

  // The response contains the generated content
  const output = response.output;
  let content = output?.choices?.[0]?.content ?? '';

  // Strip markdown code fences if present (```json ... ```)
  content = content.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();

  try {
    return JSON.parse(content);
  } catch {
    console.error('[llm] Failed to parse JSON response:', content);
    return {};
  }
}

async function classifyEmailWithClient(
  client: any,
  email: NormalizedEmail,
  companyName: string,
): Promise<{ category: ClassificationCategory; confidence: number; reason: string }> {
  const userMessage = `Company applied to: ${companyName}

Email from: ${email.from}
Subject: ${email.subject}
Body snippet: ${email.bodySnippet}

Classify this email. Return JSON with: category, confidence, reason.`;

  const result = await callLLM(client, CLASSIFY_SYSTEM_PROMPT, userMessage);

  const category = result.category as ClassificationCategory;
  if (!CLASSIFICATION_CATEGORIES.includes(category)) {
    return { category: 'UNCLEAR', confidence: 0, reason: `Invalid category: ${category}` };
  }

  return {
    category,
    confidence: Math.max(0, Math.min(1, (result.confidence as number) ?? 0)),
    reason: (result.reason as string) ?? '',
  };
}

async function extractRoleTitleFromEmail(
  client: any,
  email: NormalizedEmail,
): Promise<string | null> {
  const userMessage = `Email from: ${email.from}
Subject: ${email.subject}
Body snippet: ${email.bodySnippet}

Extract the job role/position title mentioned in this email. Return JSON with: role_title (string or null).`;

  const result = await callLLM(client, 'Extract the exact job role/position title from this email. Return JSON with role_title (string or null if not found).', userMessage);
  return (result.role_title as string) || null;
}

interface TriageResultExtended {
  isJobRelated: boolean;
  category: ClassificationCategory;
  confidence: number;
  reason: string;
  companyName: string | null;
  roleTitle: string | null;
  location: string | null;
  contactName: string | null;
  jobDescription: string | null;
  isRemote: boolean;
}

async function triageEmailWithClient(
  client: any,
  email: NormalizedEmail,
): Promise<TriageResultExtended> {
  const userMessage = `Email from: ${email.from}
Subject: ${email.subject}
Body snippet: ${email.bodySnippet}

Is this email a status update about a job application? Return JSON with: is_job_related, category, confidence, reason, company_name, role_title, location (city/region or null), contact_name (recruiter name or null), job_description (brief summary of the role from the email or null), is_remote (boolean).`;

  const result = await callLLM(client, TRIAGE_SYSTEM_PROMPT, userMessage);

  return {
    isJobRelated: (result.is_job_related as boolean) ?? false,
    category: (CLASSIFICATION_CATEGORIES.includes(result.category as any) ? result.category : 'UNCLEAR') as ClassificationCategory,
    confidence: Math.max(0, Math.min(1, (result.confidence as number) ?? 0)),
    reason: (result.reason as string) ?? '',
    companyName: (result.company_name as string) || null,
    roleTitle: (result.role_title as string) || null,
    location: (result.location as string) || null,
    contactName: (result.contact_name as string) || null,
    jobDescription: (result.job_description as string) || null,
    isRemote: (result.is_remote as boolean) ?? false,
  };
}

/** Construct a direct URL to the email in the user's inbox. */
function buildEmailUrl(email: NormalizedEmail): string {
  if (email.provider === 'gmail') {
    return `https://mail.google.com/mail/u/0/#inbox/${email.messageId}`;
  }
  // Outlook web — messageId is the Graph API ID, link to outlook.live.com
  return `https://outlook.live.com/mail/0/inbox/id/${encodeURIComponent(email.messageId)}`;
}

/**
 * Quick pre-filter to skip emails that are obviously not job application status updates.
 * Returns true if the email should be SKIPPED (not sent to LLM).
 */
function isObviouslyNotJobRelated(email: NormalizedEmail): boolean {
  const domain = email.fromDomain.toLowerCase();
  const subject = email.subject.toLowerCase();
  const from = email.from.toLowerCase();

  // Skip domains that are NEVER job-related (pure consumer/personal services only).
  // DO NOT add companies you might apply to (tech, airlines, banks, etc.)
  // — those are filtered by subject patterns instead.
  const skipDomains = [
    // Social / messaging
    'discord.com', 'quora.com', 'reddit.com', 'tiktok.com', 'instagram.com', 'facebook.com',
    // Shopping / fashion (unlikely employers)
    'grailed.com', 'musinsa.com', 'brownsshoes.com', 'sunglasshut.com', 'floraqueen.com',
    // Personal finance / payments
    'interac.ca', 'tossbank.com', 'tossinvest.com',
    // Utilities / bills
    'hydro.qc.ca', 'communauto.com', 'communauto.ca', 'buildingstack.com', 'artm.quebec',
    // Tourism / attractions
    'sagradafamilia.org', 'bsmsa.cat', 'covermanager.com', 'lapedrera.com',
    'holafly.com', 'tremblant.ca',
    // News / newsletters (pure content, never hiring platforms)
    'substack.com',
    // Government (immigration/auth, not job)
    'auth.canada.ca', 'saaq.gouv.qc.ca', 'authentification.quebec.ca',
    'revenuquebec.ca', 'cra-arc.gc.ca', 'francais-enligne.quebec',
    'mifi.notification.gouv.qc.ca',
    // Real estate
    'showmojo.com', 'kw.com',
    // Misc personal
    'luma-mail.com', 'splitwise.com', 'livefootballtickets.com', 'chess.com',
  ];

  if (skipDomains.some((d) => domain === d || domain.endsWith('.' + d))) {
    return true;
  }

  // Skip LinkedIn job alerts and news, but KEEP application status updates
  if (domain.includes('linkedin.com')) {
    // Always keep emails about applications (rejections, updates, etc.)
    if (subject.includes('your application') || subject.includes('application to')) {
      return false;
    }
    // Skip alerts, news, editors, newsletters
    if (from.includes('jobalerts') || from.includes('editors') ||
        from.includes('newsletters') || from.includes('jobs-noreply') ||
        from.includes('linkedin@em.linkedin.com')) {
      return true;
    }
  }

  // Skip obvious marketing/promo subject patterns
  const skipSubjectPatterns = [
    /% off/i, /promo/i, /expires soon/i, /price drop/i,
    /weekly digest/i, /newsletter/i, /top picks/i,
    /what's happening in/i, /your .* statement/i,
    /receipt from/i, /your bill/i, /invoice/i, /payment/i,
    /security alert/i, /sign-in/i, /new device login/i,
    /verify your email/i, /password/i,
    /mentioned you in/i, /sent you a message/i,
  ];

  if (skipSubjectPatterns.some((p) => p.test(subject))) {
    return true;
  }

  return false;
}

function getYesterdayWindow(): Date {
  const now = new Date();
  const estNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const yesterday = new Date(estNow);
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);
  return yesterday;
}

export const scanUserEmails = new Action({
  name: 'scanUserEmails',
  description: 'Fetch, classify, and update emails for a single user',
  input: z.object({
    userId: z.string(),
    sinceOverride: z.string().optional().describe('ISO date string to scan from (for deep scans). Defaults to yesterday 00:00 EST.'),
  }),
  output: z.object({
    emailsScanned: z.number(),
    matched: z.number(),
    statusUpdates: z.number(),
    newApplications: z.number(),
    flaggedForReview: z.number(),
    errors: z.array(z.string()),
  }),

  async handler({ input, client }) {
    const result: ScanResult = {
      emailsScanned: 0, matched: 0, statusUpdates: 0,
      newApplications: 0, flaggedForReview: 0, errors: [],
    };

    const applications = await query<ApplicationRow>(
      'SELECT id, user_id, company_name, role_title, job_url, status, source, contact_email FROM applications WHERE user_id = $1',
      [input.userId],
    );

    const domainMap = buildDomainLookup(applications);
    const since = input.sinceOverride ? new Date(input.sinceOverride) : getYesterdayWindow();

    const allEmails: NormalizedEmail[] = [];

    try {
      allEmails.push(...await fetchGmailEmails(input.userId, since));
    } catch (err) {
      const msg = `Gmail fetch error: ${err instanceof Error ? err.message : String(err)}`;
      console.error('[scanner]', msg);
      result.errors.push(msg);
    }

    try {
      allEmails.push(...await fetchOutlookEmails(input.userId, since));
    } catch (err) {
      const msg = `Outlook fetch error: ${err instanceof Error ? err.message : String(err)}`;
      console.error('[scanner]', msg);
      result.errors.push(msg);
    }

    // Deduplicate by messageId (Gmail can return duplicates across labels)
    const seen = new Set<string>();
    const deduped = allEmails.filter((e) => {
      if (seen.has(e.messageId)) return false;
      seen.add(e.messageId);
      return true;
    });
    const dupeCount = allEmails.length - deduped.length;
    if (dupeCount > 0) console.log(`[scanner] Removed ${dupeCount} duplicate messages`);
    allEmails.length = 0;
    allEmails.push(...deduped);

    result.emailsScanned = allEmails.length;
    if (allEmails.length === 0) return result;

    const preFiltered = allEmails.filter((e) => matchEmailToApplications(e, domainMap).length === 0 && isObviouslyNotJobRelated(e)).length;
    console.log(`[scanner] Found ${allEmails.length} emails for user ${input.userId} (${preFiltered} pre-filtered, ${allEmails.length - preFiltered} to process)`);
    for (const e of allEmails) {
      const skip = matchEmailToApplications(e, domainMap).length === 0 && isObviouslyNotJobRelated(e);
      console.log(`  [${e.provider}]${skip ? ' [SKIP]' : ''} From: ${e.from} | Subject: ${e.subject}`);
    }

    for (const email of allEmails) {
      const candidates = matchEmailToApplications(email, domainMap);

      if (candidates.length > 0) {
        result.matched++;

        // Resolve which application to update
        let app: ApplicationMatch | null = null;

        if (candidates.length === 1) {
          app = candidates[0];
        } else {
          // Multiple applications for the same company — use LLM to extract role title
          try {
            const emailRole = await extractRoleTitleFromEmail(client, email);
            if (emailRole) {
              app = candidates.find((c) => fuzzyMatchRoleTitle(emailRole, c.roleTitle)) ?? null;
            }
            if (!app) {
              // Can't determine which application — create nudge on the first non-terminal one
              const activeCandidate = candidates.find((c) => !TERMINAL_STATUSES.includes(c.status as any));
              if (activeCandidate) {
                await query(
                  'INSERT INTO nudges (id, application_id, nudge_type, message) VALUES (gen_random_uuid(), $1, $2, $3)',
                  [activeCandidate.id, 'email_review', `Email from ${email.from}: "${email.subject}" — multiple applications found for ${activeCandidate.companyName}. Please assign manually.`],
                );
                result.flaggedForReview++;
              }
              continue;
            }
          } catch (err) {
            console.error(`[scanner] Role extraction failed for ${email.messageId}:`, err);
            continue;
          }
        }

        if (TERMINAL_STATUSES.includes(app.status as any)) continue;

        try {
          const classification = await classifyEmailWithClient(client, email, app.companyName);

          const targetStatus = CLASSIFICATION_TO_STATUS[classification.category];
          const threshold = classification.category === 'REJECTION'
            ? CONFIDENCE_THRESHOLDS.REJECTED
            : CONFIDENCE_THRESHOLDS.default;

          const meetsThreshold = classification.confidence >= threshold;
          const isValidTarget = targetStatus && isForwardTransition(app.status, targetStatus);

          if (meetsThreshold && isValidTarget) {
            await query(
              'UPDATE applications SET status = $1, last_updated_at = NOW() WHERE id = $2',
              [targetStatus, app.id],
            );
            await query(
              'INSERT INTO status_history (id, application_id, from_status, to_status, trigger, trigger_detail) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)',
              [app.id, app.status, targetStatus, 'email_auto', `${classification.category} (${classification.confidence.toFixed(2)}): ${email.subject}`],
            );
            result.statusUpdates++;
          } else if (classification.category !== 'UNCLEAR' || classification.confidence > 0) {
            await query(
              'INSERT INTO nudges (id, application_id, nudge_type, message) VALUES (gen_random_uuid(), $1, $2, $3)',
              [app.id, 'email_review', `Email from ${email.from}: "${email.subject}" — classified as ${classification.category} (${classification.confidence.toFixed(2)}). ${classification.reason}`],
            );
            result.flaggedForReview++;
          }
        } catch (err) {
          const msg = `Classification error for ${email.messageId}: ${err instanceof Error ? err.message : String(err)}`;
          console.error('[scanner]', msg);
          result.errors.push(msg);
        }
      } else {
        // Unmatched — quick pre-filter before expensive LLM triage
        if (isObviouslyNotJobRelated(email)) {
          continue; // Skip — no LLM call needed
        }

        // Triage via LLM
        try {
          const triage = await triageEmailWithClient(client, email);

          if (!triage.isJobRelated || !triage.companyName) continue;

          // Skip if an application for this company + role already exists
          const roleTitle = triage.roleTitle ?? 'Unknown Role';
          const existing = await query<{ id: string }>(
            'SELECT id FROM applications WHERE user_id = $1 AND LOWER(company_name) = LOWER($2) AND LOWER(role_title) = LOWER($3) LIMIT 1',
            [input.userId, triage.companyName, roleTitle],
          );
          if (existing.length > 0) {
            console.log(`[scanner] Skipping duplicate: ${triage.companyName} — ${roleTitle} (already exists)`);
            continue;
          }

          const targetStatus = CLASSIFICATION_TO_STATUS[triage.category] ?? 'APPLIED';

          const emailUrl = buildEmailUrl(email);

          const newApps = await query<{ id: string }>(
            `INSERT INTO applications (id, user_id, company_name, role_title, status, source, contact_email, email_url, location, contact_name, jd_snapshot, is_remote)
             VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
            [
              input.userId,
              triage.companyName,
              triage.roleTitle ?? 'Unknown Role',
              targetStatus,
              'other',
              email.from,
              emailUrl,
              triage.location,
              triage.contactName,
              triage.jobDescription,
              triage.isRemote,
            ],
          );

          if (newApps[0]) {
            await query(
              'INSERT INTO status_history (id, application_id, from_status, to_status, trigger, trigger_detail) VALUES (gen_random_uuid(), $1, NULL, $2, $3, $4)',
              [newApps[0].id, targetStatus, 'email_auto', `Auto-created from email: "${email.subject}" — ${triage.category} (${triage.confidence.toFixed(2)})`],
            );

            const newMatch: ApplicationMatch = {
              id: newApps[0].id, companyName: triage.companyName, roleTitle: triage.roleTitle ?? 'Unknown Role', status: targetStatus,
            };
            const domain = extractDomain(email.from);
            if (domain) {
              const existing = domainMap.get(domain) ?? [];
              existing.push(newMatch);
              domainMap.set(domain, existing);
            }

            result.newApplications++;
          }
        } catch (err) {
          const msg = `Triage error for ${email.messageId}: ${err instanceof Error ? err.message : String(err)}`;
          console.error('[scanner]', msg);
          console.error('[scanner] Full error:', JSON.stringify(err, Object.getOwnPropertyNames(err as any), 2));
          result.errors.push(msg);
        }
      }
    }

    console.log('[scanner] Scan complete for user', input.userId, result);
    return result;
  },
});

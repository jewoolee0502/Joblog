import { Action, z } from '@botpress/runtime';
import { query } from '../utils/supabase';
import {
  TERMINAL_STATUSES,
  CLASSIFICATION_TO_STATUS,
  CONFIDENCE_THRESHOLDS,
  CLASSIFICATION_CATEGORIES,
} from '../utils/constants';
import { extractDomain, isForwardTransition } from '../utils/emailUtils';
import { buildDomainLookup, matchEmailToApplication } from '../utils/domainMatcher';
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

Return a JSON object with: is_job_related (boolean), category, confidence (0.0-1.0), reason, company_name (or null), role_title (or null).`;

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

async function triageEmailWithClient(
  client: any,
  email: NormalizedEmail,
): Promise<{ isJobRelated: boolean; category: ClassificationCategory; confidence: number; reason: string; companyName: string | null; roleTitle: string | null }> {
  const userMessage = `Email from: ${email.from}
Subject: ${email.subject}
Body snippet: ${email.bodySnippet}

Is this email a status update about a job application? Return JSON with: is_job_related, category, confidence, reason, company_name, role_title.`;

  const result = await callLLM(client, TRIAGE_SYSTEM_PROMPT, userMessage);

  return {
    isJobRelated: (result.is_job_related as boolean) ?? false,
    category: (CLASSIFICATION_CATEGORIES.includes(result.category as any) ? result.category : 'UNCLEAR') as ClassificationCategory,
    confidence: Math.max(0, Math.min(1, (result.confidence as number) ?? 0)),
    reason: (result.reason as string) ?? '',
    companyName: (result.company_name as string) || null,
    roleTitle: (result.role_title as string) || null,
  };
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
  input: z.object({ userId: z.string() }),
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
    const since = getYesterdayWindow();

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

    result.emailsScanned = allEmails.length;
    if (allEmails.length === 0) return result;

    console.log(`[scanner] Found ${allEmails.length} emails for user ${input.userId}:`);
    for (const e of allEmails) {
      console.log(`  [${e.provider}] From: ${e.from} | Subject: ${e.subject}`);
    }

    for (const email of allEmails) {
      const app = matchEmailToApplication(email, domainMap);

      if (app) {
        result.matched++;
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
        // Unmatched — triage
        try {
          const triage = await triageEmailWithClient(client, email);

          if (!triage.isJobRelated || !triage.companyName) continue;

          const targetStatus = CLASSIFICATION_TO_STATUS[triage.category] ?? 'APPLIED';

          const newApps = await query<{ id: string }>(
            'INSERT INTO applications (id, user_id, company_name, role_title, status, source, contact_email) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6) RETURNING id',
            [input.userId, triage.companyName, triage.roleTitle ?? 'Unknown Role', targetStatus, 'other', email.from],
          );

          if (newApps[0]) {
            await query(
              'INSERT INTO status_history (id, application_id, from_status, to_status, trigger, trigger_detail) VALUES (gen_random_uuid(), $1, NULL, $2, $3, $4)',
              [newApps[0].id, targetStatus, 'email_auto', `Auto-created from email: "${email.subject}" — ${triage.category} (${triage.confidence.toFixed(2)})`],
            );

            const newMatch: ApplicationMatch = {
              id: newApps[0].id, companyName: triage.companyName, status: targetStatus,
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

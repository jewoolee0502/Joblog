import { Action, z } from '@botpress/runtime';
import { query } from '../utils/supabase';
import {
  TERMINAL_STATUSES,
  CLASSIFICATION_TO_STATUS,
  CONFIDENCE_THRESHOLDS,
  CLASSIFICATION_CATEGORIES,
} from '../utils/constants';
import { extractDomain, isForwardTransition } from '../utils/emailUtils';
import { fuzzyMatchRoleTitle } from '../utils/domainMatcher';
import type { ApplicationMatch } from '../utils/types';
import type { ClassificationCategory } from '../utils/constants';

const CLASSIFY_SYSTEM_PROMPT = `You are a job application status email classifier. Given an email from a company the user applied to, classify it into exactly one category:
- ACKNOWLEDGEMENT — Company confirmed receipt of the user's job application. This includes emails that say "we received your application", "thank you for applying", or "your application has been submitted". Even if the email mentions next steps or that someone will contact the user later, if the PRIMARY purpose is confirming receipt, classify as ACKNOWLEDGEMENT.
- SCREENING_REQUEST — Company is ACTIVELY requesting the user to do something NOW: schedule a phone screen, take an online assessment, complete a coding test, or join a specific call. The email must contain a concrete action request, not just a promise of future contact.
- INTERVIEW_INVITE — Company is specifically inviting the user to an interview with a date/time or scheduling link.
- REJECTION — Company is rejecting the user's application ("we've decided to move forward with other candidates", "we regret to inform you").
- OFFER — Company is extending a job offer to the user.
- UNCLEAR — The email is not about the user's application status.

IMPORTANT: "We received your application and will contact you if successful" = ACKNOWLEDGEMENT (not SCREENING_REQUEST).
Return a JSON object with: category, confidence (0.0-1.0), reason (one sentence).`;

const TRIAGE_SYSTEM_PROMPT = `You are a job application status email triage system. Determine if the email is a STATUS UPDATE about a job application the user has ALREADY SUBMITTED.

Only these count as job-related:
- Application acknowledgement/confirmation ("we received your application" — even if they mention future contact)
- Screening or phone interview request (company ACTIVELY asking user to schedule/complete something NOW)
- Interview invitation (specific date/time or scheduling link)
- Rejection notice
- Job offer
- Online assessment / coding challenge invitation (with a link or deadline to complete)

NOT job-related (mark is_job_related = false):
- Job board notifications ("New jobs posted", "Companies are hiring")
- Marketing emails, newsletters, promotions
- Product updates, surveys, account notifications
- Recruiter outreach that is NOT about a specific application

CRITICAL: For role_title, extract the EXACT job title as written in the email. Do NOT paraphrase or generalize. For example:
- If the email says "Junior AI Engineer", return "Junior AI Engineer" (NOT "Software Engineer")
- If the email says "Full Stack Developer (TypeScript, React, Node.js)", return that exact string

Return a JSON object with:
- is_job_related (boolean)
- category (ACKNOWLEDGEMENT, SCREENING_REQUEST, INTERVIEW_INVITE, REJECTION, OFFER, or UNCLEAR)
- confidence (0.0-1.0)
- reason (one sentence)
- company_name (string or null)
- role_title (the EXACT role/position title as written in the email — do NOT paraphrase)
- location (city/region mentioned in the email, or null)
- contact_name (recruiter/hiring manager name if mentioned, or null)
- job_description (brief 1-2 sentence summary of the role, or null)
- is_remote (boolean)`;

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

  const output = response.output;
  let content = output?.choices?.[0]?.content ?? '';
  content = content.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();

  try {
    return JSON.parse(content);
  } catch {
    console.error('[llm] Failed to parse JSON response:', content);
    return {};
  }
}

function buildEmailUrl(provider: string, messageId: string): string {
  if (provider === 'gmail') {
    return `https://mail.google.com/mail/u/0/#inbox/${messageId}`;
  }
  return `https://outlook.live.com/mail/0/inbox/id/${encodeURIComponent(messageId)}`;
}

// Email schema matching fetchAndFilterEmails output
const emailSchema = z.object({
  messageId: z.string(),
  from: z.string(),
  fromDomain: z.string(),
  subject: z.string(),
  bodySnippet: z.string(),
  receivedAt: z.string(),
  provider: z.enum(['gmail', 'outlook']),
});

const matchedEmailSchema = z.object({
  email: emailSchema,
  appId: z.string(),
  appCompanyName: z.string(),
  appRoleTitle: z.string(),
  appStatus: z.string(),
});

export const scanUserEmails = new Action({
  name: 'scanUserEmails',
  description: 'Process a batch of pre-filtered emails: classify matched ones and triage unmatched ones',
  input: z.object({
    userId: z.string(),
    matched: z.array(matchedEmailSchema),
    unmatched: z.array(emailSchema),
  }),
  output: z.object({
    statusUpdates: z.number(),
    newApplications: z.number(),
    flaggedForReview: z.number(),
    errors: z.array(z.string()),
  }),

  async handler({ input, client }) {
    const result = { statusUpdates: 0, newApplications: 0, flaggedForReview: 0, errors: [] as string[] };

    // Process matched emails (classify against existing applications)
    for (const m of input.matched) {
      const { email, appId, appCompanyName, appStatus } = m;

      if (TERMINAL_STATUSES.includes(appStatus as any)) continue;

      try {
        const classification = await callLLM(client, CLASSIFY_SYSTEM_PROMPT,
          `Company applied to: ${appCompanyName}\n\nEmail from: ${email.from}\nSubject: ${email.subject}\nBody snippet: ${email.bodySnippet}\n\nClassify this email. Return JSON with: category, confidence, reason.`);

        const category = classification.category as ClassificationCategory;
        if (!CLASSIFICATION_CATEGORIES.includes(category)) continue;

        const targetStatus = CLASSIFICATION_TO_STATUS[category];
        const threshold = category === 'REJECTION' ? CONFIDENCE_THRESHOLDS.REJECTED : CONFIDENCE_THRESHOLDS.default;
        const confidence = Math.max(0, Math.min(1, (classification.confidence as number) ?? 0));

        if (confidence >= threshold && targetStatus && isForwardTransition(appStatus, targetStatus)) {
          await query('UPDATE applications SET status = $1, last_updated_at = NOW() WHERE id = $2', [targetStatus, appId]);
          await query(
            'INSERT INTO status_history (id, application_id, from_status, to_status, trigger, trigger_detail) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)',
            [appId, appStatus, targetStatus, 'email_auto', `${category} (${confidence.toFixed(2)}): ${email.subject}`],
          );
          result.statusUpdates++;
          console.log(`[scan] Updated ${appCompanyName}: ${appStatus} → ${targetStatus}`);
        } else if (category !== 'UNCLEAR' || confidence > 0) {
          await query(
            'INSERT INTO nudges (id, application_id, nudge_type, message) VALUES (gen_random_uuid(), $1, $2, $3)',
            [appId, 'email_review', `Email from ${email.from}: "${email.subject}" — ${category} (${confidence.toFixed(2)}). ${classification.reason ?? ''}`],
          );
          result.flaggedForReview++;
        }
      } catch (err) {
        result.errors.push(`Classify ${email.messageId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Process unmatched emails (triage for new applications)
    for (const email of input.unmatched) {
      try {
        const triageResult = await callLLM(client, TRIAGE_SYSTEM_PROMPT,
          `Email from: ${email.from}\nSubject: ${email.subject}\nBody snippet: ${email.bodySnippet}\n\nIs this email a status update about a job application?\nIMPORTANT: For role_title, copy the EXACT title from the email.\nReturn JSON with: is_job_related, category, confidence, reason, company_name, role_title, location, contact_name, job_description, is_remote.`);

        if (!triageResult.is_job_related || !triageResult.company_name) continue;

        const roleTitle = (triageResult.role_title as string) || 'Unknown Role';
        const companyName = triageResult.company_name as string;

        // Duplicate check — fuzzy match against existing apps
        const existingApps = await query<{ id: string; role_title: string }>(
          'SELECT id, role_title FROM applications WHERE user_id = $1 AND LOWER(company_name) = LOWER($2)',
          [input.userId, companyName],
        );
        if (existingApps.some((a) => fuzzyMatchRoleTitle(roleTitle, a.role_title))) {
          console.log(`[scan] Skipping duplicate: ${companyName} — ${roleTitle}`);
          continue;
        }

        const category = triageResult.category as string;
        const targetStatus = CLASSIFICATION_TO_STATUS[category] ?? 'APPLIED';
        const emailUrl = buildEmailUrl(email.provider, email.messageId);

        const newApps = await query<{ id: string }>(
          `INSERT INTO applications (id, user_id, company_name, role_title, status, source, contact_email, email_url, location, contact_name, jd_snapshot, is_remote)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
          [
            input.userId, companyName, roleTitle, targetStatus, 'other', email.from, emailUrl,
            (triageResult.location as string) || null,
            (triageResult.contact_name as string) || null,
            (triageResult.job_description as string) || null,
            (triageResult.is_remote as boolean) ?? false,
          ],
        );

        if (newApps[0]) {
          await query(
            'INSERT INTO status_history (id, application_id, from_status, to_status, trigger, trigger_detail) VALUES (gen_random_uuid(), $1, NULL, $2, $3, $4)',
            [newApps[0].id, targetStatus, 'email_auto', `Auto-created: "${email.subject}" — ${category}`],
          );
          result.newApplications++;
          console.log(`[scan] New application: ${companyName} — ${roleTitle}`);
        }
      } catch (err) {
        result.errors.push(`Triage ${email.messageId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return result;
  },
});

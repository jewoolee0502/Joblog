import { Action, z, adk } from '@botpress/runtime';

const TRIAGE_INSTRUCTIONS = `You are a job application status email triage system. Determine if the email is a STATUS UPDATE about a job application the user has ALREADY SUBMITTED.

Only these count as job-related:
- Application acknowledgement/confirmation ("we received your application" — even if they mention future contact)
- Screening or phone interview request (company ACTIVELY asking user to schedule/complete something NOW)
- Interview invitation (specific date/time or scheduling link)
- Rejection notice
- Job offer
- Online assessment / coding challenge invitation (with a link or deadline to complete)

NOT job-related (mark isJobRelated = false):
- Job board notifications ("New jobs posted", "Companies are hiring")
- Marketing emails, newsletters, promotions
- Product updates, surveys, account notifications
- Recruiter outreach that is NOT about a specific application

STATUS CATEGORIES (use these exact values):
- APPLIED — Company confirmed receipt of the application
- SCREENING — Company is requesting an assessment, phone screen, or coding test
- INTERVIEW — Company is inviting to an interview
- REJECTED — Company is rejecting the application
- OFFER — Company is extending an offer
- UNCLEAR — Not about a job application status

CRITICAL: For roleTitle, extract the EXACT job title as written in the email. Do NOT paraphrase or generalize. For example:
- If the email says "Junior AI Engineer", return "Junior AI Engineer" (NOT "Software Engineer")
- If the email says "Full Stack Developer (TypeScript, React, Node.js)", return that exact string

If the email is in a non-English language (e.g. French), translate and understand it the same way as English emails.`;

const triageSchema = z.object({
  isJobRelated: z.boolean(),
  category: z.enum(['APPLIED', 'SCREENING', 'INTERVIEW', 'REJECTED', 'OFFER', 'UNCLEAR']),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
  companyName: z.string().nullable(),
  roleTitle: z.string().nullable().describe('The EXACT role/position title as written in the email — do NOT paraphrase'),
  location: z.string().nullable(),
  contactName: z.string().nullable(),
  jobDescription: z.string().nullable().describe('Brief 1-2 sentence summary of the role'),
  isRemote: z.boolean(),
});

const emailInputSchema = z.object({
  from: z.string(),
  subject: z.string(),
  bodySnippet: z.string(),
});

const triageResultSchema = z.object({
  isJobRelated: z.boolean(),
  category: z.string(),
  confidence: z.number(),
  reason: z.string(),
  companyName: z.string().nullable(),
  roleTitle: z.string().nullable(),
  location: z.string().nullable(),
  contactName: z.string().nullable(),
  jobDescription: z.string().nullable(),
  isRemote: z.boolean(),
});

export const triageEmails = new Action({
  name: 'triageEmails',
  description: 'Triage unmatched emails to determine if they are job-related — returns triage results only, no DB writes',

  input: z.object({
    emails: z.array(emailInputSchema),
  }),

  output: z.object({
    results: z.array(triageResultSchema),
  }),

  async handler({ input }) {
    const results: Array<{
      isJobRelated: boolean; category: string; confidence: number; reason: string;
      companyName: string | null; roleTitle: string | null; location: string | null;
      contactName: string | null; jobDescription: string | null; isRemote: boolean;
    }> = [];

    for (const email of input.emails) {
      try {
        const triage = await adk.zai.extract(
          `Email from: ${email.from}\nSubject: ${email.subject}\nBody snippet: ${email.bodySnippet}`,
          triageSchema,
          { instructions: TRIAGE_INSTRUCTIONS },
        );

        results.push({
          isJobRelated: triage.isJobRelated,
          category: triage.category,
          confidence: Math.max(0, Math.min(1, triage.confidence)),
          reason: triage.reason,
          companyName: triage.companyName,
          roleTitle: triage.roleTitle,
          location: triage.location,
          contactName: triage.contactName,
          jobDescription: triage.jobDescription,
          isRemote: triage.isRemote,
        });
      } catch (err) {
        console.error(`[triageEmails] Error triaging email "${email.subject}":`, err);
        results.push({
          isJobRelated: false, category: 'UNCLEAR', confidence: 0, reason: 'Triage failed',
          companyName: null, roleTitle: null, location: null,
          contactName: null, jobDescription: null, isRemote: false,
        });
      }
    }

    return { results };
  },
});

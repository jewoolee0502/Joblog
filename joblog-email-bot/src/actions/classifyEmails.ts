import { Action, z, adk } from '@botpress/runtime';

const CLASSIFY_INSTRUCTIONS = `You are a job application status email classifier. You receive a batch of emails from a single company in CHRONOLOGICAL ORDER (oldest first), along with all the user's active job applications at that company.

YOUR TASK:
For each email, determine:
1. Which candidate role (by index) this email is about
2. What status category this email represents

PROCESSING RULES:
- Emails are in chronological order. Use earlier emails as context for later ones.
- If an earlier email established that a screening/assessment is for a specific role, later emails about that same assessment belong to the SAME role — even if they don't mention the role name.
- You MUST pick a role from the candidateRoles list by index (0-based). Do NOT invent or guess role titles that aren't in the list.
- If the email genuinely does not relate to ANY of the candidate roles (e.g., account security notifications, marketing), classify as UNCLEAR.

STATUS CATEGORIES:
- APPLIED — Company confirmed receipt of the user's job application ("we received your application", "thank you for applying"). Even if next steps are mentioned, if the PRIMARY purpose is confirming receipt, classify as APPLIED.
- SCREENING — Company is ACTIVELY requesting the user to do something NEW: schedule a phone screen, take an online assessment, complete a coding test. Must be a concrete NEW action request.
- INTERVIEW — Company is inviting the user to a NEW interview with a date/time or scheduling link not yet attended.
- REJECTED — Company is rejecting the user's application.
- OFFER — Company is extending a job offer.
- UNCLEAR — The email is NOT about any of the candidate roles' application status. This includes: account notifications, marketing emails, interview confirmations for already-booked interviews, reminders for already-triggered actions.

IMPORTANT:
- "We received your application and will contact you if successful" = APPLIED (not SCREENING).
- Interview CONFIRMATION emails (confirming already booked/completed) = UNCLEAR.
- Reminder emails for already-requested actions = UNCLEAR.
- If the email is in a non-English language (e.g. French), translate and understand it fully before classifying.`;

const classificationSchema = z.object({
  category: z.enum(['APPLIED', 'SCREENING', 'INTERVIEW', 'REJECTED', 'OFFER', 'UNCLEAR']),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
  matchedRoleIndex: z.number().describe('0-based index into the candidateRoles list. MUST be a valid index — do NOT invent roles.'),
});

const candidateRoleSchema = z.object({
  roleTitle: z.string(),
  currentStatus: z.string(),
});

const emailSchema = z.object({
  from: z.string(),
  subject: z.string(),
  bodySnippet: z.string(),
});

const classificationResultSchema = z.object({
  category: z.string(),
  confidence: z.number(),
  reason: z.string(),
  matchedRoleIndex: z.number(),
});

export const classifyEmails = new Action({
  name: 'classifyEmails',
  description: 'Classify a batch of emails from one company using LLM — returns classification results only, no DB writes',

  input: z.object({
    companyName: z.string(),
    candidateRoles: z.array(candidateRoleSchema),
    emails: z.array(emailSchema),
  }),

  output: z.object({
    results: z.array(classificationResultSchema),
  }),

  async handler({ input }) {
    const rolesContext = input.candidateRoles
      .map((r, i) => `  [${i}] "${r.roleTitle}" — current status: ${r.currentStatus}`)
      .join('\n');

    const emailsContext = input.emails
      .map((e, i) => `--- Email ${i + 1} ---\nFrom: ${e.from}\nSubject: ${e.subject}\nBody snippet: ${e.bodySnippet}`)
      .join('\n\n');

    try {
      const classifications = await adk.zai.extract(
        `Company: ${input.companyName}\n\nCandidate roles:\n${rolesContext}\n\nEmails (oldest first):\n\n${emailsContext}`,
        z.array(classificationSchema),
        { instructions: `${CLASSIFY_INSTRUCTIONS}\n\nReturn an array with exactly ${input.emails.length} classification objects, one per email, in the same order as the emails provided.` },
      );

      return {
        results: classifications.map((c) => ({
          category: c.category,
          confidence: Math.max(0, Math.min(1, c.confidence)),
          reason: c.reason,
          matchedRoleIndex: Math.max(0, Math.min(c.matchedRoleIndex, input.candidateRoles.length - 1)),
        })),
      };
    } catch (err) {
      console.error(`[classifyEmails] Error classifying batch for ${input.companyName}:`, err);
      return {
        results: input.emails.map(() => ({
          category: 'UNCLEAR',
          confidence: 0,
          reason: 'Classification failed',
          matchedRoleIndex: 0,
        })),
      };
    }
  },
});

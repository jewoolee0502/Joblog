import { Action, z, adk } from '@botpress/runtime';

const CLASSIFY_INSTRUCTIONS = `You are a job application status email classifier. Given an email from a company the user applied to, classify it into exactly one category:
- ACKNOWLEDGEMENT — Company confirmed receipt of the user's job application. This includes emails that say "we received your application", "thank you for applying", or "your application has been submitted". Even if the email mentions next steps or that someone will contact the user later, if the PRIMARY purpose is confirming receipt, classify as ACKNOWLEDGEMENT.
- SCREENING_REQUEST — Company is ACTIVELY requesting the user to do something NOW: schedule a phone screen, take an online assessment, complete a coding test, or join a specific call. The email must contain a concrete action request, not just a promise of future contact.
- INTERVIEW_INVITE — Company is specifically inviting the user to an interview with a date/time or scheduling link.
- REJECTION — Company is rejecting the user's application ("we've decided to move forward with other candidates", "we regret to inform you").
- OFFER — Company is extending a job offer to the user.
- UNCLEAR — The email is not about the user's application status.

IMPORTANT: "We received your application and will contact you if successful" = ACKNOWLEDGEMENT (not SCREENING_REQUEST).`;

const classificationSchema = z.object({
  category: z.enum(['ACKNOWLEDGEMENT', 'SCREENING_REQUEST', 'INTERVIEW_INVITE', 'REJECTION', 'OFFER', 'UNCLEAR']),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
});

const emailInputSchema = z.object({
  from: z.string(),
  subject: z.string(),
  bodySnippet: z.string(),
  companyName: z.string(),
});

const classificationResultSchema = z.object({
  category: z.string(),
  confidence: z.number(),
  reason: z.string(),
});

export const classifyEmails = new Action({
  name: 'classifyEmails',
  description: 'Classify job application emails using LLM — returns classification results only, no DB writes',

  input: z.object({
    emails: z.array(emailInputSchema),
  }),

  output: z.object({
    results: z.array(classificationResultSchema),
  }),

  async handler({ input }) {
    const results: Array<{ category: string; confidence: number; reason: string }> = [];

    for (const email of input.emails) {
      try {
        const classification = await adk.zai.extract(
          `Company applied to: ${email.companyName}\n\nEmail from: ${email.from}\nSubject: ${email.subject}\nBody snippet: ${email.bodySnippet}`,
          classificationSchema,
          { instructions: CLASSIFY_INSTRUCTIONS },
        );

        results.push({
          category: classification.category,
          confidence: Math.max(0, Math.min(1, classification.confidence)),
          reason: classification.reason,
        });
      } catch (err) {
        console.error(`[classifyEmails] Error classifying email "${email.subject}":`, err);
        results.push({ category: 'UNCLEAR', confidence: 0, reason: 'Classification failed' });
      }
    }

    return { results };
  },
});

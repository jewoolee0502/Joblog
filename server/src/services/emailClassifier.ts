import Anthropic from '@anthropic-ai/sdk';
import { CLASSIFICATION_CATEGORIES } from '../lib/constants.js';
import type { ClassificationCategory } from '../lib/constants.js';
import type { NormalizedEmail, ClassificationResult, TriageResult } from '../lib/types.js';

const client = new Anthropic();

const SYSTEM_PROMPT = `You are a job application status email classifier. Given an email from a company the user applied to, classify it into exactly one category:

- ACKNOWLEDGEMENT — Company confirmed receipt of the user's job application.
- SCREENING_REQUEST — Company requesting a phone screen, initial conversation, or online assessment for the user's application.
- INTERVIEW_INVITE — Company inviting the user to an interview (technical, behavioral, onsite, etc.).
- REJECTION — Company rejecting the user's application ("We've decided to move forward with other candidates").
- OFFER — Company extending a job offer to the user.
- UNCLEAR — The email is not about the user's application status (e.g., marketing, newsletter, general company update).

Only classify as a status update if the email is specifically about the user's application. General marketing emails from the company should be classified as UNCLEAR.
Respond with your classification, a confidence score (0.0–1.0), and a short one-sentence reason.`;

/**
 * Classify a job-related email using Claude.
 * Uses tool_use for reliable structured output.
 */
export async function classifyEmail(
  email: NormalizedEmail,
  companyName: string,
): Promise<ClassificationResult> {
  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 256,
      system: SYSTEM_PROMPT,
      tools: [
        {
          name: 'classify_email',
          description: 'Submit the email classification result.',
          input_schema: {
            type: 'object' as const,
            properties: {
              category: {
                type: 'string',
                enum: [...CLASSIFICATION_CATEGORIES],
                description: 'The classification category.',
              },
              confidence: {
                type: 'number',
                minimum: 0,
                maximum: 1,
                description: 'Confidence score between 0.0 and 1.0.',
              },
              reason: {
                type: 'string',
                description: 'One-sentence explanation for the classification.',
              },
            },
            required: ['category', 'confidence', 'reason'],
          },
        },
      ],
      tool_choice: { type: 'tool', name: 'classify_email' },
      messages: [
        {
          role: 'user',
          content: `Company applied to: ${companyName}

Email from: ${email.from}
Subject: ${email.subject}
Body snippet: ${email.bodySnippet}

Classify this email.`,
        },
      ],
    });

    // Extract the tool_use result
    const toolBlock = response.content.find((block) => block.type === 'tool_use');
    if (!toolBlock || toolBlock.type !== 'tool_use') {
      return fallback('No tool_use block in response');
    }

    const input = toolBlock.input as {
      category?: string;
      confidence?: number;
      reason?: string;
    };

    const category = input.category as ClassificationCategory;
    const confidence = input.confidence ?? 0;
    const reason = input.reason ?? '';

    // Validate category
    if (!CLASSIFICATION_CATEGORIES.includes(category)) {
      return fallback(`Invalid category: ${category}`);
    }

    // Clamp confidence
    const clampedConfidence = Math.max(0, Math.min(1, confidence));

    return { category, confidence: clampedConfidence, reason };
  } catch (err) {
    console.error('[classifier] Claude API error:', err);
    return fallback('Claude API call failed');
  }
}

function fallback(reason: string): ClassificationResult {
  return { category: 'UNCLEAR', confidence: 0, reason };
}

/**
 * Triage an unmatched email: determine if it's job-related and extract company/role.
 */
export async function triageEmail(email: NormalizedEmail): Promise<TriageResult> {
  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 256,
      system: `You are a job application status email triage system. Determine if the email is a STATUS UPDATE about a job application the user has ALREADY SUBMITTED. Only these count as job-related:

- Application acknowledgement/confirmation ("We received your application")
- Screening or phone interview request ("We'd like to schedule a call")
- Interview invitation ("You've been selected for an interview")
- Rejection ("We regret to inform you" / "We've decided to move forward with other candidates")
- Job offer ("We're pleased to offer you")
- Online assessment / coding challenge invitation

The following are NOT job-related — mark as is_job_related = false:
- Job board notifications ("New jobs posted", "Companies are hiring")
- Marketing emails, newsletters, promotions, sales
- Product updates, surveys, account notifications
- General company newsletters (even from companies the user applied to)
- Networking or recruiter outreach that is NOT about a specific application

If job-related, extract the company name and role title. For role_title, extract the EXACT job title as written in the email — do NOT paraphrase or generalize (e.g., "Junior AI Engineer" not "Software Engineer"). If NOT job-related, set is_job_related to false.`,
      tools: [
        {
          name: 'triage_email',
          description: 'Submit the triage result for an email.',
          input_schema: {
            type: 'object' as const,
            properties: {
              is_job_related: {
                type: 'boolean',
                description: 'Whether this email is related to a job application.',
              },
              category: {
                type: 'string',
                enum: [...CLASSIFICATION_CATEGORIES],
                description: 'Classification category (if job-related).',
              },
              confidence: {
                type: 'number',
                minimum: 0,
                maximum: 1,
                description: 'Confidence score.',
              },
              reason: {
                type: 'string',
                description: 'One-sentence explanation.',
              },
              company_name: {
                type: 'string',
                description: 'Company name extracted from the email (null if unknown).',
              },
              role_title: {
                type: 'string',
                description: 'Role/job title extracted from the email (null if unknown).',
              },
            },
            required: ['is_job_related', 'category', 'confidence', 'reason'],
          },
        },
      ],
      tool_choice: { type: 'tool', name: 'triage_email' },
      messages: [
        {
          role: 'user',
          content: `Email from: ${email.from}
Subject: ${email.subject}
Body snippet: ${email.bodySnippet}

Is this email related to a job application? If so, classify it and extract the company name and role title.`,
        },
      ],
    });

    const toolBlock = response.content.find((block) => block.type === 'tool_use');
    if (!toolBlock || toolBlock.type !== 'tool_use') {
      return { isJobRelated: false, category: 'UNCLEAR', confidence: 0, reason: 'No tool response', companyName: null, roleTitle: null };
    }

    const input = toolBlock.input as {
      is_job_related?: boolean;
      category?: string;
      confidence?: number;
      reason?: string;
      company_name?: string;
      role_title?: string;
    };

    return {
      isJobRelated: input.is_job_related ?? false,
      category: (CLASSIFICATION_CATEGORIES.includes(input.category as any) ? input.category : 'UNCLEAR') as ClassificationCategory,
      confidence: Math.max(0, Math.min(1, input.confidence ?? 0)),
      reason: input.reason ?? '',
      companyName: input.company_name || null,
      roleTitle: input.role_title || null,
    };
  } catch (err) {
    console.error('[classifier] Triage API error:', err);
    return { isJobRelated: false, category: 'UNCLEAR', confidence: 0, reason: 'API error', companyName: null, roleTitle: null };
  }
}

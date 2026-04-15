import Anthropic from '@anthropic-ai/sdk';
import { CLASSIFICATION_CATEGORIES } from '../lib/constants.js';
import type { ClassificationCategory } from '../lib/constants.js';
import type { NormalizedEmail, ClassificationResult, TriageResult } from '../lib/types.js';

const client = new Anthropic();

const SYSTEM_PROMPT = `You are a job application email classifier. Given an email and the company name the user applied to, classify the email into exactly one of these categories:

- ACKNOWLEDGEMENT — The company confirmed receipt of the application.
- SCREENING_REQUEST — The company is requesting a phone screen or initial conversation.
- INTERVIEW_INVITE — The company is inviting the candidate to an interview (technical, behavioral, etc.).
- REJECTION — The company is rejecting the candidate.
- OFFER — The company is extending a job offer.
- UNCLEAR — The email is ambiguous, unrelated to the application, or you cannot determine the category.

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
      system: `You are a job application email triage system. Given an email, determine if it is related to a job application (e.g., application confirmation, interview invite, rejection, offer, screening request, OA invite). Marketing emails, newsletters, and unrelated emails are NOT job-related.

If it IS job-related, extract the company name and role title if possible, and classify it.`,
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

import Anthropic from '@anthropic-ai/sdk';
import { CLASSIFICATION_CATEGORIES } from '../lib/constants.js';
import type { ClassificationCategory } from '../lib/constants.js';
import type { NormalizedEmail, ClassificationResult } from '../lib/types.js';

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

import { Workflow, z } from '@botpress/runtime';

const PARSE_JD_SYSTEM_PROMPT = `You are a job description parser. Given a web page's text content from a job posting, extract structured fields.

Return a JSON object with exactly these fields:
- companyName (string): The hiring company's name
- roleTitle (string): The exact job title as written on the page
- location (string or null): City, state/province, or region. null if not mentioned
- salaryRange (string or null): Salary/compensation info as a string (e.g., "$120k-$150k/year"). null if not mentioned
- isRemote (boolean): true if the posting mentions remote, hybrid, or work-from-home
- tags (string array): Up to 8 relevant tags — tech stack, required skills, seniority level, team name. Keep tags short (1-3 words each)

Rules:
- Extract the EXACT job title — do not paraphrase or generalize
- For companyName, use the company's proper name (not the job board name)
- If a field truly cannot be determined from the text, use null (or empty array for tags)
- Do NOT invent or hallucinate information not present in the text`;

export const ParseJobDescription = new Workflow({
  name: 'parseJobDescription',
  description: 'Extract structured job application fields from raw page text',
  timeout: '30s',

  input: z.object({
    pageText: z.string(),
    pageUrl: z.string(),
  }),

  output: z.object({
    companyName: z.string(),
    roleTitle: z.string(),
    location: z.string().nullable(),
    salaryRange: z.string().nullable(),
    isRemote: z.boolean(),
    tags: z.array(z.string()),
  }),

  async handler({ input, step, client }) {
    const parsed = await step('parse-with-llm', async () => {
      const response = await client.callAction({
        type: 'anthropic:generateContent',
        input: {
          model: { id: 'claude-sonnet-4-20250514' },
          systemPrompt: PARSE_JD_SYSTEM_PROMPT,
          messages: [
            {
              role: 'user',
              content: `Page URL: ${input.pageUrl}\n\nPage content:\n${input.pageText}`,
            },
          ],
          responseFormat: 'json_object',
          maxTokens: 1024,
        },
      });

      const output = response.output;
      let content = output?.choices?.[0]?.content ?? '{}';
      content = content
        .replace(/^```(?:json)?\s*\n?/i, '')
        .replace(/\n?```\s*$/i, '')
        .trim();

      try {
        return JSON.parse(content);
      } catch {
        console.error('[parseJD] Failed to parse LLM JSON:', content);
        return {};
      }
    });

    return {
      companyName: parsed.companyName || 'Unknown Company',
      roleTitle: parsed.roleTitle || 'Unknown Role',
      location: parsed.location || null,
      salaryRange: parsed.salaryRange || null,
      isRemote: parsed.isRemote ?? false,
      tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 8) : [],
    };
  },
});

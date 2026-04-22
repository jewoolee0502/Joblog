import { Action, z, adk } from '@botpress/runtime';

const PARSE_JD_INSTRUCTIONS = `You are a job description parser. Given a web page's text content from a job posting, extract structured fields.

Rules:
- Extract the EXACT job title — do not paraphrase or generalize
- For companyName, use the company's proper name (not the job board name)
- If a field truly cannot be determined from the text, use null (or empty array for tags)
- Do NOT invent or hallucinate information not present in the text
- For jdSnapshot, copy the relevant text verbatim from the page — do not summarize or rewrite. Include ONLY: position summary/overview, responsibilities, required qualifications/skills, preferred qualifications/skills, and compensation/benefits. Strip out all website navigation, headers, footers, cookie banners, legal disclaimers, EEOC statements, and other boilerplate. Preserve the section headings and formatting.`;

const jdSchema = z.object({
  companyName: z.string().describe('The hiring company proper name'),
  roleTitle: z.string().describe('The exact job title as written on the page'),
  location: z.string().nullable().describe('City, state/province, or region. null if not mentioned'),
  salaryRange: z.string().nullable().describe('Salary/compensation info as a string (e.g., "$120k-$150k/year"). null if not mentioned'),
  isRemote: z.boolean().describe('true if the posting mentions remote, hybrid, or work-from-home'),
  tags: z.array(z.string()).describe('Up to 8 relevant tags — tech stack, required skills, seniority level, team name. Keep tags short (1-3 words each)'),
  jdSnapshot: z.string().describe('The clean job description text — core JD sections only, copied verbatim'),
});

export const parseJobDescription = new Action({
  name: 'parseJobDescription',
  description: 'Extract structured job application fields from raw page text',

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
    jdSnapshot: z.string(),
  }),

  async handler({ input }) {
    try {
      const parsed = await adk.zai.extract(
        `Page URL: ${input.pageUrl}\n\nPage content:\n${input.pageText}`,
        jdSchema,
        { instructions: PARSE_JD_INSTRUCTIONS },
      );

      return {
        companyName: parsed.companyName || 'Unknown Company',
        roleTitle: parsed.roleTitle || 'Unknown Role',
        location: parsed.location,
        salaryRange: parsed.salaryRange,
        isRemote: parsed.isRemote ?? false,
        tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 8) : [],
        jdSnapshot: parsed.jdSnapshot || '',
      };
    } catch (err) {
      console.error('[parseJD] Zai extraction failed:', err);
      return {
        companyName: 'Unknown Company',
        roleTitle: 'Unknown Role',
        location: null,
        salaryRange: null,
        isRemote: false,
        tags: [],
        jdSnapshot: '',
      };
    }
  },
});

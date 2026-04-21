import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { toApplicationDTO } from '../lib/mappers.js';
import { JD_MAX_CHARS } from '../lib/constants.js';

const router = Router();

const extensionSchema = z.object({
  pageText: z.string().min(50, 'Page text too short — are you on a job posting page?'),
  pageUrl: z.string().url(),
  status: z.enum(['SAVED', 'APPLIED']),
});

function detectSource(url: string): string {
  const hostname = new URL(url).hostname.toLowerCase();
  if (hostname.includes('linkedin.com')) return 'linkedin';
  if (
    hostname.includes('greenhouse.io') ||
    hostname.includes('lever.co') ||
    hostname.includes('indeed.com') ||
    hostname.includes('workday.com') ||
    hostname.includes('myworkdayjobs.com') ||
    hostname.includes('smartrecruiters.com') ||
    hostname.includes('icims.com') ||
    hostname.includes('jobvite.com')
  ) {
    return 'job_board';
  }
  return 'company_site';
}

// POST /api/applications/from-extension
router.post('/from-extension', async (req, res, next) => {
  try {
    const data = extensionSchema.parse(req.body);
    const pageText = data.pageText.substring(0, JD_MAX_CHARS);

    // Call Botpress bot to extract structured fields from page text
    const { Client } = await import('@botpress/client');
    const bpClient = new Client({
      botId: process.env.BP_CHROME_BOT_ID!,
      token: process.env.BOTPRESS_TOKEN!,
    });

    const { workflow } = await bpClient.createWorkflow({
      name: 'parseJobDescription',
      status: 'pending',
      input: { pageText, pageUrl: data.pageUrl },
    });

    // Poll for completion (typically finishes in 5-15 seconds)
    const startTime = Date.now();
    const TIMEOUT = 30_000;
    let status = workflow.status;
    let output = workflow.output;

    while ((status === 'in_progress' || status === 'pending') && Date.now() - startTime < TIMEOUT) {
      await new Promise((r) => setTimeout(r, 1500));
      const { workflow: updated } = await bpClient.getWorkflow({ id: workflow.id });
      status = updated.status;
      output = updated.output;
    }

    if (status !== 'completed' || !output) {
      res.status(500).json({
        error: {
          code: 'PARSE_FAILED',
          message: status === 'failed' ? 'Failed to parse job description' : 'Parsing timed out — try again',
        },
      });
      return;
    }

    const companyName = (output.companyName as string) || 'Unknown Company';
    const roleTitle = (output.roleTitle as string) || 'Unknown Role';
    const source = detectSource(data.pageUrl);
    const now = new Date();

    const created = await prisma.application.create({
      data: {
        userId: req.userId,
        companyName,
        roleTitle,
        jobUrl: data.pageUrl,
        jdSnapshot: pageText,
        status: data.status,
        source,
        location: (output.location as string) || undefined,
        salaryRange: (output.salaryRange as string) || undefined,
        isRemote: (output.isRemote as boolean) ?? false,
        tags: Array.isArray(output.tags) ? (output.tags as string[]) : [],
        appliedAt: data.status === 'APPLIED' ? now : null,
        history: {
          create: {
            fromStatus: null,
            toStatus: data.status,
            trigger: 'manual',
            triggerDetail: 'chrome_extension',
          },
        },
      },
      include: { history: { orderBy: { changedAt: 'asc' } } },
    });

    res.status(201).json(toApplicationDTO(created));
  } catch (err) {
    next(err);
  }
});

export default router;

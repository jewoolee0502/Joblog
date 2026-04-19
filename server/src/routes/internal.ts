import { Router, type Request, type Response, type NextFunction } from 'express';
import { prisma } from '../db.js';
import { TERMINAL_STATUSES } from '../lib/constants.js';
import { runEmailScan } from '../services/emailScanner.js';

const router = Router();

// ---------------------------------------------------------------------------
// Auth: all internal routes require x-cron-secret header
// ---------------------------------------------------------------------------
router.use((req: Request, res: Response, next: NextFunction) => {
  const secret = req.headers['x-cron-secret'];
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid cron secret' } });
    return;
  }
  next();
});

// ---------------------------------------------------------------------------
// POST /api/internal/scan-emails — trigger a full email scan for a user
// ---------------------------------------------------------------------------
router.post('/scan-emails', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.body.userId as string;
    if (!userId) {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'userId is required' } });
      return;
    }

    const result = await runEmailScan(userId);
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/internal/applications — list active (non-terminal) applications
// ---------------------------------------------------------------------------
router.get('/applications', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.query.userId as string;
    if (!userId) {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'userId query param required' } });
      return;
    }

    const applications = await prisma.application.findMany({
      where: {
        userId,
        status: { notIn: TERMINAL_STATUSES },
      },
      select: {
        id: true,
        companyName: true,
        roleTitle: true,
        status: true,
        contactEmail: true,
        jobUrl: true,
      },
    });

    res.json({ data: applications });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/internal/flag-review — create a nudge for manual email review
// ---------------------------------------------------------------------------
router.post('/flag-review', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { applicationId, emailSubject, emailFrom, classificationGuess, confidence } = req.body;

    if (!applicationId) {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'applicationId is required' } });
      return;
    }

    const nudge = await prisma.nudge.create({
      data: {
        applicationId,
        nudgeType: 'email_review',
        message: `Email from ${emailFrom ?? 'unknown'}: "${emailSubject ?? ''}" — classified as ${classificationGuess ?? 'UNCLEAR'} (${(confidence ?? 0).toFixed(2)}). Needs manual review.`,
      },
    });

    res.json({ data: nudge });
  } catch (err) {
    next(err);
  }
});

export default router;

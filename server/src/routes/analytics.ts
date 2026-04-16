import { Router } from 'express';
import { prisma } from '../db.js';

const router = Router();

const RESPONDED_STATUSES = [
  'SCREENING',
  'INTERVIEW',
  'FINAL_ROUND',
  'OFFER',
  'ACCEPTED',
  'REJECTED',
];
const INTERVIEW_PLUS = ['INTERVIEW', 'FINAL_ROUND', 'OFFER', 'ACCEPTED'];
const OFFER_PLUS = ['OFFER', 'ACCEPTED'];

// GET /api/analytics/summary
router.get('/summary', async (req, res, next) => {
  try {
    const apps = await prisma.application.findMany({
      where: { userId: req.userId },
      select: { status: true, source: true },
    });

    const total = apps.length;
    const submitted = apps.filter((a) => a.status !== 'SAVED').length;
    const responded = apps.filter((a) => RESPONDED_STATUSES.includes(a.status)).length;
    const interviews = apps.filter((a) => INTERVIEW_PLUS.includes(a.status)).length;
    const offers = apps.filter((a) => OFFER_PLUS.includes(a.status)).length;

    const byStatus: Record<string, number> = {};
    apps.forEach((a) => {
      byStatus[a.status] = (byStatus[a.status] ?? 0) + 1;
    });

    const bySource: Record<string, { total: number; responded: number }> = {};
    apps.forEach((a) => {
      if (a.status === 'SAVED') return;
      if (!bySource[a.source]) bySource[a.source] = { total: 0, responded: 0 };
      bySource[a.source].total += 1;
      if (RESPONDED_STATUSES.includes(a.status)) bySource[a.source].responded += 1;
    });

    res.json({
      total,
      submitted,
      responded,
      interviews,
      offers,
      responseRate: submitted ? responded / submitted : 0,
      interviewRate: submitted ? interviews / submitted : 0,
      offerRate: submitted ? offers / submitted : 0,
      byStatus,
      bySource,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/analytics/over-time
router.get('/over-time', async (req, res, next) => {
  try {
    const apps = await prisma.application.findMany({
      where: { userId: req.userId },
      select: { appliedAt: true, history: { select: { toStatus: true, changedAt: true } } },
    });

    const weekKey = (d: Date) => {
      const copy = new Date(d);
      const day = copy.getUTCDay();
      copy.setUTCDate(copy.getUTCDate() - day);
      copy.setUTCHours(0, 0, 0, 0);
      return copy.toISOString().slice(0, 10);
    };

    const weeks: Record<string, { applied: number; responded: number }> = {};
    for (const app of apps) {
      if (app.appliedAt) {
        const k = weekKey(app.appliedAt);
        weeks[k] ??= { applied: 0, responded: 0 };
        weeks[k].applied += 1;
      }
      const firstResponse = app.history.find((h) => RESPONDED_STATUSES.includes(h.toStatus));
      if (firstResponse) {
        const k = weekKey(firstResponse.changedAt);
        weeks[k] ??= { applied: 0, responded: 0 };
        weeks[k].responded += 1;
      }
    }

    const series = Object.entries(weeks)
      .map(([week, v]) => ({ week, ...v }))
      .sort((a, b) => a.week.localeCompare(b.week));

    res.json({ series });
  } catch (err) {
    next(err);
  }
});

export default router;

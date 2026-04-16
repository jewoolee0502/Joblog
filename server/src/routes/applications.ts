import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { toApplicationDTO } from '../lib/mappers.js';

const router = Router();

const STATUSES = [
  'SAVED',
  'APPLIED',
  'SCREENING',
  'INTERVIEW',
  'FINAL_ROUND',
  'OFFER',
  'ACCEPTED',
  'REJECTED',
  'WITHDRAWN',
  'GHOSTED',
] as const;

const SOURCES = [
  'linkedin',
  'company_site',
  'cold_email',
  'referral',
  'job_board',
  'other',
] as const;

const createSchema = z.object({
  companyName: z.string().min(1),
  roleTitle: z.string().min(1),
  jobUrl: z.string().url().optional().or(z.literal('').transform(() => undefined)),
  jdSnapshot: z.string().optional(),
  status: z.enum(STATUSES).default('SAVED'),
  source: z.enum(SOURCES).default('other'),
  contactName: z.string().optional(),
  contactEmail: z.string().email().optional().or(z.literal('').transform(() => undefined)),
  notes: z.string().optional(),
  tags: z.array(z.string()).default([]),
  salaryRange: z.string().optional(),
  location: z.string().optional(),
  isRemote: z.boolean().default(false),
  appliedAt: z.string().datetime().optional(),
});

const patchSchema = createSchema.partial().extend({
  status: z.enum(STATUSES).optional(),
  trigger: z.enum(['manual', 'email_auto', 'nudge']).optional(),
  triggerDetail: z.string().optional(),
});

// POST /api/applications
router.post('/', async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    const now = new Date();
    const appliedAt =
      data.appliedAt != null
        ? new Date(data.appliedAt)
        : data.status === 'APPLIED'
          ? now
          : null;

    const created = await prisma.application.create({
      data: {
        userId: req.userId,
        companyName: data.companyName,
        roleTitle: data.roleTitle,
        jobUrl: data.jobUrl,
        jdSnapshot: data.jdSnapshot,
        status: data.status,
        source: data.source,
        contactName: data.contactName,
        contactEmail: data.contactEmail,
        notes: data.notes,
        tags: data.tags,
        salaryRange: data.salaryRange,
        location: data.location,
        isRemote: data.isRemote,
        appliedAt,
        history: {
          create: {
            fromStatus: null,
            toStatus: data.status,
            trigger: 'manual',
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

// GET /api/applications
router.get('/', async (req, res, next) => {
  try {
    const { status, source, tag } = req.query;
    const apps = await prisma.application.findMany({
      where: {
        userId: req.userId,
        ...(typeof status === 'string' ? { status } : {}),
        ...(typeof source === 'string' ? { source } : {}),
        ...(typeof tag === 'string' ? { tags: { has: tag } } : {}),
      },
      include: { history: { orderBy: { changedAt: 'asc' } } },
      orderBy: { lastUpdatedAt: 'desc' },
    });
    res.json(apps.map(toApplicationDTO));
  } catch (err) {
    next(err);
  }
});

// GET /api/applications/:id
router.get('/:id', async (req, res, next) => {
  try {
    const app = await prisma.application.findFirst({
      where: { id: req.params.id, userId: req.userId },
      include: { history: { orderBy: { changedAt: 'asc' } } },
    });
    if (!app) return res.status(404).json({ error: 'Not found' });
    res.json(toApplicationDTO(app));
  } catch (err) {
    next(err);
  }
});

// PATCH /api/applications/:id
router.patch('/:id', async (req, res, next) => {
  try {
    const data = patchSchema.parse(req.body);

    const existing = await prisma.application.findFirst({
      where: { id: req.params.id, userId: req.userId },
    });
    if (!existing) return res.status(404).json({ error: 'Not found' });

    const statusChanged = data.status != null && data.status !== existing.status;

    const updated = await prisma.application.update({
      where: { id: existing.id },
      data: {
        companyName: data.companyName,
        roleTitle: data.roleTitle,
        jobUrl: data.jobUrl,
        jdSnapshot: data.jdSnapshot,
        status: data.status,
        source: data.source,
        contactName: data.contactName,
        contactEmail: data.contactEmail,
        notes: data.notes,
        tags: data.tags,
        salaryRange: data.salaryRange,
        location: data.location,
        isRemote: data.isRemote,
        appliedAt:
          data.appliedAt != null
            ? new Date(data.appliedAt)
            : statusChanged && data.status === 'APPLIED' && existing.appliedAt == null
              ? new Date()
              : undefined,
        ...(statusChanged
          ? {
              history: {
                create: {
                  fromStatus: existing.status,
                  toStatus: data.status!,
                  trigger: data.trigger ?? 'manual',
                  triggerDetail: data.triggerDetail,
                },
              },
            }
          : {}),
      },
      include: { history: { orderBy: { changedAt: 'asc' } } },
    });

    res.json(toApplicationDTO(updated));
  } catch (err) {
    next(err);
  }
});

// POST /api/applications/:id/undo — revert the most recent status change
router.post('/:id/undo', async (req, res, next) => {
  try {
    const app = await prisma.application.findFirst({
      where: { id: req.params.id, userId: req.userId },
      include: { history: { orderBy: { changedAt: 'desc' }, take: 1 } },
    });
    if (!app) return res.status(404).json({ error: 'Not found' });

    const lastChange = app.history[0];
    if (!lastChange || lastChange.fromStatus == null) {
      return res.status(400).json({ error: { code: 'NO_UNDO', message: 'Nothing to undo' } });
    }

    const updated = await prisma.application.update({
      where: { id: app.id },
      data: {
        status: lastChange.fromStatus,
        history: {
          create: {
            fromStatus: app.status,
            toStatus: lastChange.fromStatus,
            trigger: 'manual',
            triggerDetail: 'undo',
          },
        },
      },
      include: { history: { orderBy: { changedAt: 'asc' } } },
    });

    res.json(toApplicationDTO(updated));
  } catch (err) {
    next(err);
  }
});

// DELETE /api/applications/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const existing = await prisma.application.findFirst({
      where: { id: req.params.id, userId: req.userId },
    });
    if (!existing) return res.status(404).json({ error: 'Not found' });
    await prisma.application.delete({ where: { id: existing.id } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;

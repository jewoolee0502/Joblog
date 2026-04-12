import { Router } from 'express';
import { prisma } from '../db.js';

const router = Router();

// GET /api/nudges
router.get('/', async (req, res, next) => {
  try {
    const nudges = await prisma.nudge.findMany({
      where: {
        isDismissed: false,
        application: { userId: req.userId },
      },
      include: { application: { select: { id: true, companyName: true, roleTitle: true, status: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json(nudges);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/nudges/:id/dismiss
router.patch('/:id/dismiss', async (req, res, next) => {
  try {
    const nudge = await prisma.nudge.findFirst({
      where: { id: req.params.id, application: { userId: req.userId } },
    });
    if (!nudge) return res.status(404).json({ error: 'Not found' });
    const updated = await prisma.nudge.update({
      where: { id: nudge.id },
      data: { isDismissed: true },
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

export default router;

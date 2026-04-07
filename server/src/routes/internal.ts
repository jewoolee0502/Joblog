import { Router } from 'express';

const router = Router();

// Stubs — real implementations land in Weeks 3–7 per PRD §8.

router.post('/poll-gmail', (_req, res) => {
  res.json({ ok: true, stub: true, message: 'Gmail polling not implemented yet (Week 3)' });
});

router.post('/poll-outlook', (_req, res) => {
  res.json({ ok: true, stub: true, message: 'Outlook polling not implemented yet (Week 4)' });
});

router.post('/check-nudges', (_req, res) => {
  res.json({ ok: true, stub: true, message: 'Nudge check not implemented yet (Week 7)' });
});

export default router;

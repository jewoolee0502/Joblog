import 'dotenv/config';
import express, { type ErrorRequestHandler } from 'express';
import cors from 'cors';
import { ZodError } from 'zod';
import { authMiddleware } from './auth.js';
import applicationsRouter from './routes/applications.js';
import analyticsRouter from './routes/analytics.js';
import nudgesRouter from './routes/nudges.js';
import internalRouter from './routes/internal.js';
import oauthRouter from './routes/oauth.js';
import cron from 'node-cron';
import { prisma } from './db.js';
import { runEmailScan } from './services/emailScanner.js';

const app = express();
const PORT = Number(process.env.PORT ?? 4000);
const WEB_ORIGIN = process.env.WEB_ORIGIN ?? 'http://localhost:5173';

app.use(cors({ origin: WEB_ORIGIN, credentials: true }));
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

// All /api routes are authenticated (dev stub for now)
app.use('/api', authMiddleware);
app.use('/api/auth', oauthRouter);
app.use('/api/applications', applicationsRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/nudges', nudgesRouter);
app.use('/api/internal', internalRouter);

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({ error: 'Validation failed', issues: err.issues });
    return;
  }
  // eslint-disable-next-line no-console
  console.error('[error]', err);
  res.status(500).json({ error: 'Internal server error' });
};
app.use(errorHandler);

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[joblog-server] listening on http://localhost:${PORT}`);

  // Daily email scan at 7:00 AM Eastern (handles DST automatically)
  cron.schedule(
    '0 7 * * *',
    async () => {
      console.log('[cron] Starting daily email scan...');
      try {
        const users = await prisma.user.findMany({
          where: {
            OR: [
              { gmailRefreshToken: { not: null } },
              { outlookRefreshToken: { not: null } },
            ],
          },
          select: { id: true },
        });

        for (const user of users) {
          try {
            const result = await runEmailScan(user.id);
            console.log(`[cron] Scan complete for user ${user.id}:`, result);
          } catch (err) {
            console.error(`[cron] Scan failed for user ${user.id}:`, err);
          }
        }
      } catch (err) {
        console.error('[cron] Failed to run daily scan:', err);
      }
    },
    { timezone: 'America/New_York' },
  );
  console.log('[cron] Daily email scan scheduled for 7:00 AM Eastern');
});

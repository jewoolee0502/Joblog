import 'dotenv/config';
import express, { type ErrorRequestHandler } from 'express';
import cors from 'cors';
import cron from 'node-cron';
import { ZodError } from 'zod';
import { authMiddleware } from './auth.js';
import applicationsRouter from './routes/applications.js';
import analyticsRouter from './routes/analytics.js';
import nudgesRouter from './routes/nudges.js';
import internalRouter from './routes/internal.js';
import oauthRouter, { gmailInitHandler, gmailCallbackHandler, outlookInitHandler, microsoftCallbackHandler } from './routes/oauth.js';
import extensionRouter from './routes/extension.js';
import { runFullScan } from './services/emailScanner.js';

const app = express();
const PORT = Number(process.env.PORT ?? 4000);
const WEB_ORIGIN = process.env.WEB_ORIGIN ?? 'http://localhost:5173';

console.log('[cors] WEB_ORIGIN =', JSON.stringify(WEB_ORIGIN));
app.use(cors({ origin: [WEB_ORIGIN, /^chrome-extension:\/\//], credentials: true }));
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

// Routes that bypass Supabase auth middleware:
// - Internal routes have their own x-cron-secret auth
// - OAuth callbacks are external redirects with no Bearer token (userId passed via state param)
app.use('/api/internal', internalRouter);
app.get('/api/auth/gmail', gmailInitHandler);
app.get('/api/auth/gmail/callback', gmailCallbackHandler);
app.get('/api/auth/outlook', outlookInitHandler);
app.get('/api/auth/microsoft/callback', microsoftCallbackHandler);

// All other /api routes require Supabase authentication
app.use('/api', authMiddleware);
app.use('/api/auth', oauthRouter);
app.use('/api/applications', applicationsRouter);
app.use('/api/applications', extensionRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/nudges', nudgesRouter);

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

  // Daily email scan (default: 12:00 UTC = 7:00 AM EST)
  const cronSchedule = process.env.CRON_SCAN_SCHEDULE ?? '0 12 * * *';
  cron.schedule(cronSchedule, async () => {
    console.log('[cron] Starting daily email scan');
    try {
      await runFullScan();
    } catch (err) {
      console.error('[cron] Daily email scan failed:', err);
    }
  });

  console.log(`[cron] Daily email scan scheduled (${cronSchedule})`);
});

import { Router, type Request, type Response, type NextFunction } from 'express';
import { google } from 'googleapis';
import { ConfidentialClientApplication } from '@azure/msal-node';
import { prisma } from '../db.js';
import { encrypt, decrypt } from '../lib/crypto.js';
import { setScanStatus, getScanStatus, deleteScanStatus } from '../lib/scanStatus.js';

const router = Router();

const WEB_ORIGIN = process.env.WEB_ORIGIN ?? 'http://localhost:5173';

// ---------------------------------------------------------------------------
// Google OAuth2 singleton
// ---------------------------------------------------------------------------
const googleOAuth2 = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI,
);

// ---------------------------------------------------------------------------
// Microsoft MSAL — lazy singleton (avoids crash when env vars are missing)
// ---------------------------------------------------------------------------
let _msalClient: ConfidentialClientApplication | null = null;

function getMsalClient(): ConfidentialClientApplication {
  if (!_msalClient) {
    const clientId = process.env.MICROSOFT_CLIENT_ID;
    const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error('MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET must be set to use Outlook OAuth.');
    }
    _msalClient = new ConfidentialClientApplication({
      auth: {
        clientId,
        authority: `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID ?? 'common'}`,
        clientSecret,
      },
    });
  }
  return _msalClient;
}

// ---------------------------------------------------------------------------
// Gmail OAuth
// ---------------------------------------------------------------------------

/** Step 1 — Redirect user to Google consent screen. */
router.get('/gmail', (req, res) => {
  const url = googleOAuth2.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/gmail.readonly'],
    state: req.userId,
  });
  res.redirect(url);
});

/**
 * Step 2 — Google redirects here with ?code= and ?state=userId.
 * Exported separately so it can be registered before auth middleware.
 */
export async function gmailCallbackHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const code = req.query.code as string | undefined;
    const userId = req.query.state as string | undefined;

    if (!code || !userId) {
      res.redirect(`${WEB_ORIGIN}?gmail=error&reason=missing_params`);
      return;
    }

    const { tokens } = await googleOAuth2.getToken(code);
    if (!tokens.refresh_token) {
      res.redirect(`${WEB_ORIGIN}?gmail=error&reason=no_refresh_token`);
      return;
    }

    const encryptedToken = encrypt(tokens.refresh_token);

    await prisma.user.update({
      where: { id: userId },
      data: { gmailRefreshToken: encryptedToken },
    });

    res.redirect(`${WEB_ORIGIN}?gmail=connected`);
  } catch (err) {
    next(err);
  }
}

/** Disconnect Gmail — revoke token and clear from DB. */
router.delete('/gmail', async (req, res, next) => {
  try {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.userId } });

    if (user.gmailRefreshToken) {
      try {
        const token = decrypt(user.gmailRefreshToken);
        googleOAuth2.revokeToken(token);
      } catch {
        // Token may already be invalid — continue clearing.
      }
    }

    await prisma.user.update({
      where: { id: req.userId },
      data: { gmailRefreshToken: null, gmailLastPolledAt: null },
    });

    res.json({ disconnected: true });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Outlook OAuth
// ---------------------------------------------------------------------------

/** Step 1 — Redirect user to Microsoft consent screen. */
router.get('/outlook', async (req, res, next) => {
  try {
    const url = await getMsalClient().getAuthCodeUrl({
      scopes: ['Mail.Read', 'offline_access'],
      redirectUri: process.env.MICROSOFT_REDIRECT_URI ?? '',
      state: req.userId,
    });
    res.redirect(url);
  } catch (err) {
    next(err);
  }
});

/**
 * Step 2 — Microsoft redirects here with ?code= and ?state=userId.
 * Exported separately so it can be registered before auth middleware.
 */
export async function microsoftCallbackHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const code = req.query.code as string | undefined;
    const userId = req.query.state as string | undefined;

    console.log('[outlook] Callback received, code present:', !!code, 'userId:', userId);
    if (!code || !userId) {
      console.log('[outlook] Missing params in callback, query:', req.query);
      res.redirect(`${WEB_ORIGIN}?outlook=error&reason=missing_params`);
      return;
    }

    const tokenResult = await getMsalClient().acquireTokenByCode({
      code,
      scopes: ['Mail.Read', 'offline_access'],
      redirectUri: process.env.MICROSOFT_REDIRECT_URI ?? '',
    });
    console.log('[outlook] Token acquired for account:', tokenResult?.account?.username);

    // MSAL doesn't directly expose the refresh token in acquireTokenByCode result.
    // The token cache stores it internally. We serialize the full cache so we can
    // restore it later for silent token acquisition.
    const cacheSnapshot = getMsalClient().getTokenCache().serialize();
    const encryptedCache = encrypt(cacheSnapshot);

    await prisma.user.update({
      where: { id: userId },
      data: { outlookRefreshToken: encryptedCache },
    });

    console.log('[outlook] Connection saved for user', userId);
    res.redirect(`${WEB_ORIGIN}?outlook=connected`);
  } catch (err) {
    console.error('[outlook] Callback error:', err);
    next(err);
  }
}

/** Disconnect Outlook — clear token from DB. */
router.delete('/outlook', async (req, res, next) => {
  try {
    await prisma.user.update({
      where: { id: req.userId },
      data: { outlookRefreshToken: null, outlookLastPolledAt: null },
    });

    res.json({ disconnected: true });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Connection status
// ---------------------------------------------------------------------------

router.get('/connections', async (req, res, next) => {
  try {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.userId } });

    res.json({
      gmail: {
        connected: user.gmailRefreshToken !== null,
        lastPolledAt: user.gmailLastPolledAt?.toISOString() ?? null,
      },
      outlook: {
        connected: user.outlookRefreshToken !== null,
        lastPolledAt: user.outlookLastPolledAt?.toISOString() ?? null,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Manual scan trigger
// ---------------------------------------------------------------------------

router.post('/trigger-scan', async (req, res, next) => {
  try {
    const { runEmailScan } = await import('../services/emailScanner.js');

    // Compute sinceOverride for deep scans
    const months = parseInt(req.query.months as string) || 0;
    let sinceOverride: string | undefined;
    if (months > 0) {
      const since = new Date();
      since.setMonth(since.getMonth() - months);
      since.setHours(0, 0, 0, 0);
      sinceOverride = since.toISOString();
    }

    const isDeepScan = months > 0;
    console.log(`[trigger-scan] ${isDeepScan ? 'DEEP' : 'NORMAL'} scan: months=${months}, sinceOverride=${sinceOverride ?? 'none'}, userId=${req.userId}`);

    // Deep scan: fire-and-forget (runs in background)
    if (isDeepScan) {
      setScanStatus(req.userId, { status: 'running', startedAt: Date.now() });

      runEmailScan(req.userId, sinceOverride)
        .then((scanResult) => {
          setScanStatus(req.userId, {
            status: 'completed',
            result: {
              emailsScanned: scanResult.emailsScanned,
              statusUpdates: scanResult.statusUpdates,
              newApplications: scanResult.newApplications,
              flaggedForReview: scanResult.flaggedForReview,
              errors: scanResult.errors,
            },
            startedAt: Date.now(),
          });
        })
        .catch((err) => {
          console.error('[trigger-scan] Background deep scan failed:', err);
          setScanStatus(req.userId, {
            status: 'failed',
            error: err instanceof Error ? err.message : String(err),
            startedAt: Date.now(),
          });
        });

      res.json({
        emailsScanned: 0,
        matched: 0,
        statusUpdates: 0,
        newApplications: 0,
        flaggedForReview: 0,
        errors: [],
        background: true,
        message: `Deep scan started (past ${months} months). It will run in the background and update your Kanban board automatically.`,
      });
      return;
    }

    // Normal scan: await result directly (no polling needed)
    const result = await runEmailScan(req.userId, sinceOverride);

    res.json({
      emailsScanned: result.emailsScanned,
      matched: result.matched,
      statusUpdates: result.statusUpdates,
      newApplications: result.newApplications,
      flaggedForReview: result.flaggedForReview,
      errors: result.errors,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/scan-status', (req, res) => {
  const status = getScanStatus(req.userId);
  if (!status) {
    res.json({ data: null });
    return;
  }
  if (status.status !== 'running') {
    deleteScanStatus(req.userId);
  }
  res.json({ data: status });
});

export default router;

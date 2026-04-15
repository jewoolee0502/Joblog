import { Router } from 'express';
import { google } from 'googleapis';
import { ConfidentialClientApplication } from '@azure/msal-node';
import { prisma } from '../db.js';
import { encrypt, decrypt } from '../lib/crypto.js';

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
router.get('/gmail', (_req, res) => {
  const url = googleOAuth2.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/gmail.readonly'],
  });
  res.redirect(url);
});

/** Step 2 — Google redirects here with ?code=. */
router.get('/gmail/callback', async (req, res, next) => {
  try {
    const code = req.query.code as string | undefined;
    if (!code) {
      res.redirect(`${WEB_ORIGIN}/settings?gmail=error&reason=no_code`);
      return;
    }

    const { tokens } = await googleOAuth2.getToken(code);
    if (!tokens.refresh_token) {
      res.redirect(`${WEB_ORIGIN}/settings?gmail=error&reason=no_refresh_token`);
      return;
    }

    const encryptedToken = encrypt(tokens.refresh_token);

    await prisma.user.update({
      where: { id: req.userId },
      data: { gmailRefreshToken: encryptedToken },
    });

    res.redirect(`${WEB_ORIGIN}/settings?gmail=connected`);
  } catch (err) {
    next(err);
  }
});

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
router.get('/outlook', async (_req, res, next) => {
  try {
    const url = await getMsalClient().getAuthCodeUrl({
      scopes: ['Mail.Read', 'offline_access'],
      redirectUri: process.env.MICROSOFT_REDIRECT_URI ?? '',
    });
    res.redirect(url);
  } catch (err) {
    next(err);
  }
});

/** Step 2 — Microsoft redirects here with ?code=. */
router.get('/outlook/callback', async (req, res, next) => {
  try {
    const code = req.query.code as string | undefined;
    if (!code) {
      res.redirect(`${WEB_ORIGIN}/settings?outlook=error&reason=no_code`);
      return;
    }

    await getMsalClient().acquireTokenByCode({
      code,
      scopes: ['Mail.Read', 'offline_access'],
      redirectUri: process.env.MICROSOFT_REDIRECT_URI ?? '',
    });

    // MSAL doesn't directly expose the refresh token in acquireTokenByCode result.
    // The token cache stores it internally. We serialize the full cache so we can
    // restore it later for silent token acquisition.
    const cacheSnapshot = getMsalClient().getTokenCache().serialize();
    const encryptedCache = encrypt(cacheSnapshot);

    await prisma.user.update({
      where: { id: req.userId },
      data: { outlookRefreshToken: encryptedCache },
    });

    res.redirect(`${WEB_ORIGIN}/settings?outlook=connected`);
  } catch (err) {
    next(err);
  }
});

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
    // Optional: pass sinceMonths to scan further back (e.g., ?months=6)
    const months = parseInt(req.query.months as string) || 0;
    let sinceOverride: Date | undefined;
    if (months > 0) {
      sinceOverride = new Date();
      sinceOverride.setMonth(sinceOverride.getMonth() - months);
      sinceOverride.setHours(0, 0, 0, 0);
    }
    const result = await runEmailScan(req.userId, sinceOverride);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;

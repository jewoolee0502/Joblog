import { ConfidentialClientApplication } from '@azure/msal-node';
import { Client } from '@microsoft/microsoft-graph-client';
import { prisma } from '../db.js';
import { decrypt } from '../lib/crypto.js';
import { EMAIL_BODY_MAX_CHARS } from '../lib/constants.js';
import type { NormalizedEmail } from '../lib/types.js';

function createMsalClient(): ConfidentialClientApplication {
  return new ConfidentialClientApplication({
    auth: {
      clientId: process.env.MICROSOFT_CLIENT_ID ?? '',
      authority: `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID ?? 'common'}`,
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET ?? '',
    },
  });
}

/**
 * Fetch unread Outlook messages received after `since`.
 * Returns an empty array if the user has no Outlook token or if the token is invalid.
 */
export async function fetchOutlookEmails(
  userId: string,
  since: Date,
): Promise<NormalizedEmail[]> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

  if (!user.outlookRefreshToken) return [];

  let cacheSnapshot: string;
  try {
    cacheSnapshot = decrypt(user.outlookRefreshToken);
  } catch {
    console.warn('[outlook] Failed to decrypt token cache for user', userId);
    return [];
  }

  // Restore MSAL token cache and attempt silent acquisition
  const msalClient = createMsalClient();
  msalClient.getTokenCache().deserialize(cacheSnapshot);

  let accessToken: string;
  try {
    const accounts = await msalClient.getTokenCache().getAllAccounts();
    if (accounts.length === 0) {
      console.warn('[outlook] No accounts in token cache for user', userId);
      await clearOutlookToken(userId);
      return [];
    }

    const result = await msalClient.acquireTokenSilent({
      account: accounts[0],
      scopes: ['Mail.Read'],
    });

    if (!result?.accessToken) {
      console.warn('[outlook] Silent token acquisition returned no token for user', userId);
      await clearOutlookToken(userId);
      return [];
    }

    accessToken = result.accessToken;

    // Persist updated cache (may contain refreshed tokens)
    const { encrypt } = await import('../lib/crypto.js');
    const updatedCache = msalClient.getTokenCache().serialize();
    await prisma.user.update({
      where: { id: userId },
      data: { outlookRefreshToken: encrypt(updatedCache) },
    });
  } catch (err) {
    console.warn('[outlook] Token acquisition failed for user', userId, err);
    await clearOutlookToken(userId);
    return [];
  }

  // Query Microsoft Graph for unread messages
  const graphClient = Client.init({
    authProvider: (done) => done(null, accessToken),
  });

  const sinceIso = since.toISOString();
  const filter = `receivedDateTime ge ${sinceIso}`;

  try {
    const response = await graphClient
      .api('/me/messages')
      .filter(filter)
      .select('id,from,subject,bodyPreview,receivedDateTime')
      .top(100)
      .get();

    const messages: any[] = response.value ?? [];
    const emails: NormalizedEmail[] = [];

    for (const msg of messages) {
      const fromEmail: string = msg.from?.emailAddress?.address ?? '';
      const fromDomain = fromEmail.split('@')[1] ?? '';

      emails.push({
        messageId: msg.id,
        from: fromEmail,
        fromDomain,
        subject: msg.subject ?? '',
        bodySnippet: (msg.bodyPreview ?? '').slice(0, EMAIL_BODY_MAX_CHARS),
        receivedAt: new Date(msg.receivedDateTime),
        provider: 'outlook',
      });
    }

    // Update last polled timestamp
    await prisma.user.update({
      where: { id: userId },
      data: { outlookLastPolledAt: new Date() },
    });

    return emails;
  } catch (err) {
    console.error('[outlook] Graph API error for user', userId, err);
    throw err;
  }
}

async function clearOutlookToken(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { outlookRefreshToken: null, outlookLastPolledAt: null },
  });
}

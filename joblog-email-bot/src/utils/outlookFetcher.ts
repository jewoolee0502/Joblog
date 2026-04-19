import { ConfidentialClientApplication } from '@azure/msal-node';
import { Client } from '@microsoft/microsoft-graph-client';
import { query, queryOne } from './supabase';
import { decrypt, encrypt } from './crypto';
import { EMAIL_BODY_MAX_CHARS } from './constants';
import type { NormalizedEmail } from './types';

function createMsalClient(): ConfidentialClientApplication {
  return new ConfidentialClientApplication({
    auth: {
      clientId: process.env.MICROSOFT_CLIENT_ID ?? '',
      authority: `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID ?? 'common'}`,
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET ?? '',
    },
  });
}

export async function fetchOutlookEmails(userId: string, since: Date): Promise<NormalizedEmail[]> {
  const user = await queryOne<{ outlook_refresh_token: string | null }>(
    'SELECT outlook_refresh_token FROM users WHERE id = $1',
    [userId],
  );

  if (!user?.outlook_refresh_token) return [];

  let cacheSnapshot: string;
  try {
    cacheSnapshot = decrypt(user.outlook_refresh_token);
  } catch {
    console.warn('[outlook] Failed to decrypt token cache for user', userId);
    return [];
  }

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
    const updatedCache = msalClient.getTokenCache().serialize();
    await query(
      'UPDATE users SET outlook_refresh_token = $1 WHERE id = $2',
      [encrypt(updatedCache), userId],
    );
  } catch (err) {
    console.warn('[outlook] Token acquisition failed for user', userId, err);
    await clearOutlookToken(userId);
    return [];
  }

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

    await query('UPDATE users SET outlook_last_polled_at = NOW() WHERE id = $1', [userId]);

    return emails;
  } catch (err) {
    console.error('[outlook] Graph API error for user', userId, err);
    throw err;
  }
}

async function clearOutlookToken(userId: string): Promise<void> {
  await query(
    'UPDATE users SET outlook_refresh_token = NULL, outlook_last_polled_at = NULL WHERE id = $1',
    [userId],
  );
}

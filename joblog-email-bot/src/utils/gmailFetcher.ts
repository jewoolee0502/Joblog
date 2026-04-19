import { google } from 'googleapis';
import { query, queryOne } from './supabase';
import { decrypt } from './crypto';
import { EMAIL_BODY_MAX_CHARS } from './constants';
import { extractEmailAddress } from './emailUtils';
import type { NormalizedEmail } from './types';

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
);

export async function fetchGmailEmails(userId: string, since: Date): Promise<NormalizedEmail[]> {
  const user = await queryOne<{ gmail_refresh_token: string | null }>(
    'SELECT gmail_refresh_token FROM users WHERE id = $1',
    [userId],
  );

  if (!user?.gmail_refresh_token) return [];

  let refreshToken: string;
  try {
    refreshToken = decrypt(user.gmail_refresh_token);
  } catch {
    console.warn('[gmail] Failed to decrypt refresh token for user', userId);
    return [];
  }

  oauth2Client.setCredentials({ refresh_token: refreshToken });
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  const afterDate = formatGmailDate(since);
  const q = `after:${afterDate}`;

  try {
    let pageToken: string | undefined;
    const allMessageIds: Array<{ id: string }> = [];

    do {
      const listRes = await gmail.users.messages.list({
        userId: 'me',
        q,
        maxResults: 500,
        pageToken,
      });

      const messages = listRes.data.messages ?? [];
      for (const m of messages) {
        if (m.id) allMessageIds.push({ id: m.id });
      }
      pageToken = listRes.data.nextPageToken ?? undefined;
    } while (pageToken);

    if (allMessageIds.length === 0) return [];
    console.log(`[gmail] Found ${allMessageIds.length} messages to process`);

    const emails: NormalizedEmail[] = [];

    for (const { id } of allMessageIds) {
      try {
        const msg = await gmail.users.messages.get({
          userId: 'me',
          id,
          format: 'metadata',
          metadataHeaders: ['From', 'Subject'],
        });

        const headers = msg.data.payload?.headers ?? [];
        const from = headers.find((h) => h.name === 'From')?.value ?? '';
        const subject = headers.find((h) => h.name === 'Subject')?.value ?? '';
        const snippet = (msg.data.snippet ?? '').slice(0, EMAIL_BODY_MAX_CHARS);
        const receivedAt = new Date(Number(msg.data.internalDate ?? Date.now()));

        const fromEmail = extractEmailAddress(from);
        const fromDomain = fromEmail.split('@')[1] ?? '';

        emails.push({
          messageId: id,
          from: fromEmail,
          fromDomain,
          subject,
          bodySnippet: snippet,
          receivedAt,
          provider: 'gmail',
        });
      } catch (err) {
        console.warn(`[gmail] Failed to fetch message ${id}:`, err);
      }
    }

    await query('UPDATE users SET gmail_last_polled_at = NOW() WHERE id = $1', [userId]);

    return emails;
  } catch (err: any) {
    if (err?.code === 401 || err?.code === 403) {
      console.warn('[gmail] Token invalid for user', userId, '— clearing token');
      await query(
        'UPDATE users SET gmail_refresh_token = NULL, gmail_last_polled_at = NULL WHERE id = $1',
        [userId],
      );
      return [];
    }
    throw err;
  }
}

function formatGmailDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}/${m}/${d}`;
}

import { google } from 'googleapis';
import { prisma } from '../db.js';
import { decrypt } from '../lib/crypto.js';
import { EMAIL_BODY_MAX_CHARS } from '../lib/constants.js';
import type { NormalizedEmail } from '../lib/types.js';

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI,
);

/**
 * Fetch unread Gmail messages received after `since`.
 * Returns an empty array if the user has no Gmail token or if the token is invalid.
 */
export async function fetchGmailEmails(
  userId: string,
  since: Date,
): Promise<NormalizedEmail[]> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

  if (!user.gmailRefreshToken) {
    console.log('[gmail] No refresh token for user', userId);
    return [];
  }

  let refreshToken: string;
  try {
    refreshToken = decrypt(user.gmailRefreshToken);
  } catch {
    console.warn('[gmail] Failed to decrypt refresh token for user', userId);
    return [];
  }

  oauth2Client.setCredentials({ refresh_token: refreshToken });
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  // Gmail query: all emails after a given date (read and unread)
  const afterDate = formatGmailDate(since);
  const query = `after:${afterDate}`;

  try {
    // Paginate through all matching messages
    let pageToken: string | undefined;
    const allMessageIds: Array<{ id: string }> = [];

    do {
      const listRes = await gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults: 500,
        pageToken,
      });

      const messages = listRes.data.messages ?? [];
      for (const m of messages) {
        if (m.id) allMessageIds.push({ id: m.id });
      }
      pageToken = listRes.data.nextPageToken ?? undefined;
    } while (pageToken);

    if (allMessageIds.length === 0) {
      console.log(`[gmail] No messages found after ${afterDate} for user ${userId}`);
      return [];
    }
    console.log(`[gmail] Found ${allMessageIds.length} messages after ${afterDate} for user ${userId}`);

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

    // Update last polled timestamp
    await prisma.user.update({
      where: { id: userId },
      data: { gmailLastPolledAt: new Date() },
    });

    return emails;
  } catch (err: any) {
    // If token is revoked/invalid, clear it and return empty
    if (err?.code === 400 || err?.code === 401 || err?.code === 403 || err?.response?.data?.error === 'invalid_grant') {
      console.warn('[gmail] Token invalid for user', userId, '— clearing token');
      await prisma.user.update({
        where: { id: userId },
        data: { gmailRefreshToken: null, gmailLastPolledAt: null },
      });
      return [];
    }
    throw err;
  }
}

/** Format a Date to Gmail query date format: YYYY/MM/DD */
function formatGmailDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}/${m}/${d}`;
}

/** Extract the email address from a "Name <email>" string. */
function extractEmailAddress(from: string): string {
  const match = from.match(/<([^>]+)>/);
  return match ? match[1] : from.trim();
}

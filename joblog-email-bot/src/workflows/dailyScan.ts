import { Workflow, z, actions, bot } from '@botpress/runtime';
import { query } from '../utils/supabase';

export const DailyScan = new Workflow({
  name: 'dailyScan',
  description: 'Daily email inbox scan — fetches emails, classifies them, and updates application statuses',

  // 12:00 UTC = 7:00 AM EST (8:00 AM EDT during daylight saving)
  schedule: '0 12 * * *',
  timeout: '2h',

  input: z.object({
    userId: z.string().optional().describe('Scan a specific user. If empty, scans all users with tokens.'),
    sinceOverride: z.string().optional().describe('ISO date to scan from. For deep scans (e.g., past 3 months).'),
  }),

  state: z.object({
    usersScanned: z.number().default(0),
    totalEmailsScanned: z.number().default(0),
    totalStatusUpdates: z.number().default(0),
    totalNewApplications: z.number().default(0),
    totalErrors: z.number().default(0),
  }),

  output: z.object({
    usersScanned: z.number(),
    totalEmailsScanned: z.number(),
    totalStatusUpdates: z.number(),
    totalNewApplications: z.number(),
    totalErrors: z.number(),
  }),

  async handler({ input, state, step }) {
    const users = await step('get-users', async () => {
      if (input.userId) {
        return [{ id: input.userId }];
      }
      const rows = await query<{ id: string }>(
        'SELECT id FROM users WHERE gmail_refresh_token IS NOT NULL OR outlook_refresh_token IS NOT NULL',
      );
      return rows;
    });

    if (users.length === 0) {
      console.log('[dailyScan] No users with connected email accounts');
      return { ...state };
    }

    for (const user of users) {
      const result = await step(`scan-${user.id}`, async () => {
        try {
          return await actions.scanUserEmails({
            userId: user.id,
            sinceOverride: input.sinceOverride,
          });
        } catch (err) {
          console.error(`[dailyScan] Failed for user ${user.id}:`, err);
          return {
            emailsScanned: 0,
            matched: 0,
            statusUpdates: 0,
            newApplications: 0,
            flaggedForReview: 0,
            errors: [err instanceof Error ? err.message : String(err)],
          };
        }
      });

      state.usersScanned++;
      state.totalEmailsScanned += result.emailsScanned;
      state.totalStatusUpdates += result.statusUpdates;
      state.totalNewApplications += result.newApplications;
      state.totalErrors += result.errors.length;

      console.log(
        `[dailyScan] User ${user.id}: scanned=${result.emailsScanned}, updates=${result.statusUpdates}, new=${result.newApplications}`,
      );
    }

    await step('update-bot-state', async () => {
      bot.state.lastScanTime = new Date().toISOString();
      bot.state.totalScans = (bot.state.totalScans ?? 0) + 1;
    });

    return {
      usersScanned: state.usersScanned,
      totalEmailsScanned: state.totalEmailsScanned,
      totalStatusUpdates: state.totalStatusUpdates,
      totalNewApplications: state.totalNewApplications,
      totalErrors: state.totalErrors,
    };
  },
});

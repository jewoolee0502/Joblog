import { Workflow, z, actions, bot } from '@botpress/runtime';

const BATCH_SIZE = 50;

export const DailyScan = new Workflow({
  name: 'dailyScan',
  description: 'Daily email inbox scan — fetches emails, classifies them, and updates application statuses',

  // 12:00 UTC = 7:00 AM EST
  schedule: '0 12 * * *',
  timeout: '2h',

  input: z.object({
    userId: z.string().optional(),
    sinceOverride: z.string().optional(),
  }),

  state: z.object({
    totalFetched: z.number().default(0),
    totalFiltered: z.number().default(0),
    totalBatches: z.number().default(0),
    completedBatches: z.number().default(0),
    statusUpdates: z.number().default(0),
    newApplications: z.number().default(0),
    flaggedForReview: z.number().default(0),
    errors: z.array(z.string()).default([]),
  }),

  output: z.object({
    totalFetched: z.number(),
    totalFiltered: z.number(),
    totalBatches: z.number(),
    statusUpdates: z.number(),
    newApplications: z.number(),
    flaggedForReview: z.number(),
    errors: z.array(z.string()),
  }),

  async handler({ input, state, step }) {
    // Step 1: Get users
    const users = await step('get-users', async () => {
      if (input.userId) return [{ id: input.userId }];

      const { query } = await import('../utils/supabase');
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
      // Step 2: Fetch and filter emails (cached after first run)
      const fetchResult = await step(`fetch-${user.id}`, async () => {
        return await actions.fetchAndFilterEmails({
          userId: user.id,
          sinceOverride: input.sinceOverride,
        });
      });

      state.totalFetched += fetchResult.totalFetched;
      state.totalFiltered += fetchResult.totalFiltered;
      state.errors.push(...fetchResult.errors);

      const allMatched = fetchResult.matched;
      const allUnmatched = fetchResult.unmatched;
      const totalToProcess = allMatched.length + allUnmatched.length;

      console.log(`[dailyScan] User ${user.id}: ${fetchResult.totalFetched} fetched, ${fetchResult.totalFiltered} filtered, ${totalToProcess} to process`);

      if (totalToProcess === 0) continue;

      // Step 3: Process in batches of BATCH_SIZE
      // Combine matched + unmatched into one list for batching
      const totalBatches = Math.ceil(totalToProcess / BATCH_SIZE);
      state.totalBatches += totalBatches;

      for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
        const batchStart = batchIdx * BATCH_SIZE;
        const batchEnd = Math.min(batchStart + BATCH_SIZE, totalToProcess);

        // Split the batch range across matched and unmatched
        const matchedInBatch = allMatched.slice(
          Math.max(0, batchStart),
          Math.min(allMatched.length, batchEnd),
        );
        const unmatchedStart = Math.max(0, batchStart - allMatched.length);
        const unmatchedEnd = Math.max(0, batchEnd - allMatched.length);
        const unmatchedInBatch = allUnmatched.slice(unmatchedStart, unmatchedEnd);

        const batchResult = await step(`batch-${user.id}-${batchIdx}`, async () => {
          console.log(`[dailyScan] Processing batch ${batchIdx + 1}/${totalBatches} (${matchedInBatch.length} matched, ${unmatchedInBatch.length} unmatched)`);

          return await actions.scanUserEmails({
            userId: user.id,
            matched: matchedInBatch,
            unmatched: unmatchedInBatch,
          });
        });

        state.completedBatches++;
        state.statusUpdates += batchResult.statusUpdates;
        state.newApplications += batchResult.newApplications;
        state.flaggedForReview += batchResult.flaggedForReview;
        state.errors.push(...batchResult.errors);

        console.log(
          `[dailyScan] Batch ${batchIdx + 1}/${totalBatches} complete: ` +
          `${batchResult.statusUpdates} updates, ${batchResult.newApplications} new apps, ` +
          `${batchResult.flaggedForReview} flagged, ${batchResult.errors.length} errors`
        );
      }
    }

    // Final step: update bot state
    await step('finalize', async () => {
      bot.state.lastScanTime = new Date().toISOString();
      bot.state.totalScans = (bot.state.totalScans ?? 0) + 1;
    });

    console.log(`[dailyScan] Scan complete: ${state.totalFetched} fetched, ${state.totalFiltered} filtered, ${state.statusUpdates} updates, ${state.newApplications} new apps`);

    return {
      totalFetched: state.totalFetched,
      totalFiltered: state.totalFiltered,
      totalBatches: state.totalBatches,
      statusUpdates: state.statusUpdates,
      newApplications: state.newApplications,
      flaggedForReview: state.flaggedForReview,
      errors: state.errors,
    };
  },
});

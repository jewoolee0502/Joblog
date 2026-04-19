import { defineConfig, z } from '@botpress/runtime';

export default defineConfig({
  name: 'JoblogBot',
  description: 'Scans Gmail/Outlook inboxes daily, classifies job-related emails, and updates the Kanban board',

  dependencies: {
    integrations: {
      anthropic: {
        version: 'anthropic@16.0.0',
        enabled: true,
      },
    },
  },

  defaultModels: {
    autonomous: 'anthropic:claude-3-5-sonnet',
    zai: 'anthropic:claude-3-5-sonnet',
  },

  bot: {
    state: z.object({
      lastScanTime: z.string().optional(),
      totalScans: z.number().default(0),
    }),
  },
});

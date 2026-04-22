import { defineConfig } from '@botpress/runtime';

export default defineConfig({
  name: 'JoblogBot',
  description: 'LLM gateway for Joblog — classifies emails, triages inbox, and parses job descriptions',

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
});

import { defineConfig } from '@botpress/runtime';

export default defineConfig({
  name: 'JoblogBot',
  description: 'LLM gateway for Joblog — classifies emails, triages inbox, and parses job descriptions',

  dependencies: {
    integrations: {
      anthropic: {
        version: 'anthropic@17.0.0',
        enabled: true,
      },
    },
  },

  defaultModels: {
    autonomous: 'best',
    zai: 'best',
  },
});

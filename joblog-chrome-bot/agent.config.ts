import { defineConfig, z } from '@botpress/runtime';

export default defineConfig({
    name: 'joblog-chrome-bot',
    description: 'Parses job description pages into structured application data for the Joblog Chrome extension',

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

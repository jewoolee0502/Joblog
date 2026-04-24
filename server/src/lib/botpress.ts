import { Client } from '@botpress/client';

/** Create a Botpress client pointed at the configured bot. */
export function createBotpressClient(): Client {
  const botId = process.env.BP_BOT_ID;
  const token = process.env.BOTPRESS_TOKEN;

  if (!botId || !token) {
    throw new Error('Missing required env vars: BP_BOT_ID and BOTPRESS_TOKEN must be set');
  }

  return new Client({ botId, token });
}

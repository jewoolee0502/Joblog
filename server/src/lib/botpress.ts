import { Client } from '@botpress/client';

/** Create a Botpress client pointed at the configured bot. */
export function createBotpressClient(): Client {
  return new Client({
    botId: process.env.BP_BOT_ID!,
    token: process.env.BOTPRESS_TOKEN!,
  });
}

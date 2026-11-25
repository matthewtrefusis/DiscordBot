import type { DiscordCommand } from "./types";

const infoCommand = {
  name: "info",
  description: "Show information about the bot.",
  execute: () =>
    "🤖 **Bot Status:** Online | **Runtime:** TypeScript on Cloudflare Workers",
} satisfies DiscordCommand;

export default infoCommand;

import type { DiscordCommand } from "./types";

const pingCommand = {
  name: "ping",
  description: "Check whether the bot is responding.",
  execute: () => "🏓 Pong!",
} satisfies DiscordCommand;

export default pingCommand;

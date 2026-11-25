import type { DiscordCommand } from "./types";

const helloCommand = {
  name: "hello",
  description: "Get a greeting from the bot.",
  execute: ({ username }) => `👋 Hello ${username}`,
} satisfies DiscordCommand;

export default helloCommand;

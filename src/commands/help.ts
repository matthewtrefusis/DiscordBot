import type { DiscordCommand } from "./types";

const helpCommand = {
  name: "help",
  description: "List available bot commands.",
  execute: () =>
    [
      "**General**",
      "`/help`, `/hello`, `/info`, `/ping`",
      "**User tools**",
      "`/avatar [user]`, `/userinfo [user]`, `/timestamp seconds`",
      "**Fun**",
      "`/8ball question`, `/choose choices`, `/coinflip`, `/roll [min] [max]`",
    ].join("\n"),
} satisfies DiscordCommand;

export default helpCommand;

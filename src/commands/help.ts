import type { DiscordCommand } from "./types";

const helpCommand = {
  name: "help",
  description: "List available bot commands.",
  execute: () =>
    [
      "**General**",
      "`/help`, `/hello`, `/info`, `/ping`, `/serverinfo`, `/membercount`",
      "**User tools**",
      "`/avatar [user]`, `/userinfo [user]`, `/timestamp seconds`",
      "**Fun**",
      "`/8ball question`, `/choose choices`, `/coinflip`, `/roll [min] [max]`",
      "**Feedback**",
      "`/feedback category message`",
      "`/setup-feedback channel categories` (Manage Server)",
      "`/feedback-config` (Manage Server)",
      "**Community**",
      "`/poll question options`, `/remind minutes message`",
      "**Livestream and video alerts**",
      "`/setup-stream-alerts channel`, `/stream-add channel_url`",
      "`/stream-remove channel_url`, `/stream-list` (Manage Server)",
      "**Moderation**",
      "`/kick user [reason]`, `/ban user [reason]`, `/unban user_id [reason]`",
      "`/timeout user minutes [reason]`, `/untimeout user [reason]`",
      "`/purge count [reason]` (Manage Messages; messages older than 14 days are skipped)",
    ].join("\n"),
} satisfies DiscordCommand;

export default helpCommand;

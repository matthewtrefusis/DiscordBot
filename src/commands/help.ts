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
      "`/feedback-stats` (Manage Server), `/report message [message_link]`",
      "`/setup-reports channel` (Manage Server; report includes your username)",
      "**Community**",
      "`/poll question options`, `/poll-results poll`, `/poll-close poll`",
      "`/remind minutes message`, `/remind-at local_time message`, `/timezone timezone`",
      "`/event title local_time`, `/events`, `/event-cancel event`",
      "**Livestream and video alerts**",
      "`/setup-stream-alerts channel`, `/stream-add channel_url`",
      "`/stream-remove channel_url`, `/stream-list` (Manage Server)",
      "`/stream-test`, `/stream-pause channel_url`, `/stream-resume channel_url` (Manage Server)",
      "**Moderation**",
      "`/kick user [reason]`, `/ban user [reason]`, `/unban user_id [reason]`",
      "`/timeout user minutes [reason]`, `/untimeout user [reason]`",
      "`/purge count [reason]` (Manage Messages; messages older than 14 days are skipped)",
    ].join("\n"),
} satisfies DiscordCommand;

export default helpCommand;

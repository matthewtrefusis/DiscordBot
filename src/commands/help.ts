import type { DiscordCommand } from "./types";

const helpCommand = {
  name: "help",
  description: "List available bot commands.",
  execute: () =>
    [
      "**General:** `/help` `/hello` `/info` `/ping` `/serverinfo` `/membercount`",
      "**User & fun:** `/avatar` `/userinfo` `/timestamp` `/8ball` `/choose` `/coinflip` `/roll`",
      "**Feedback & reports:** `/feedback` `/setup-feedback` `/feedback-config` `/feedback-stats` `/report` `/setup-reports` `/reports` `/report-status`",
      "**Polls & reminders:** `/poll` `/poll-results` `/poll-close` `/poll-remind` `/remind` `/remind-at` `/timezone`",
      "**Events & birthdays:** `/event` `/events` `/event-cancel` `/event-attendees` `/giveaway` `/setup-birthdays` `/birthday-set` `/birthday-remove`",
      "**Community:** `/setup-suggestions` `/suggest` `/suggestion-status` `/faq` `/faq-add` `/faq-remove` `/self-role` `/self-role-add` `/self-role-remove` `/setup-tickets` `/ticket`",
      "**Message menu:** `Quote message` (right-click a message)",
      "**Stream/video alerts:** `/setup-stream-alerts` `/stream-add` `/stream-remove` `/stream-list` `/stream-test` `/stream-pause` `/stream-resume`",
      "**Moderation:** `/kick` `/ban` `/unban` `/timeout` `/untimeout` `/purge` `/warn` `/mod-cases` `/channel-lock` `/channel-unlock` `/settings-export`",
    ].join("\n"),
} satisfies DiscordCommand;

export default helpCommand;

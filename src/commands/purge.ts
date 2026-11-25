import { getOption } from "./helpers";
import {
  getModerationContext,
  getModerationReason,
  MODERATION_PERMISSIONS,
  moderationResponse,
  purgeRecentMessages,
} from "./moderation-helpers";
import type { DiscordCommand } from "./types";

const purgeCommand = {
  name: "purge",
  description: "Delete up to 100 recent messages in this channel.",
  default_member_permissions: "8192",
  options: [
    {
      type: 4,
      name: "count",
      description: "Number of recent messages to delete (1-100).",
      required: true,
      min_value: 1,
      max_value: 100,
    },
    {
      type: 3,
      name: "reason",
      description: "Optional reason recorded in the audit log.",
      max_length: 400,
    },
  ],
  execute: (commandContext) => {
    const { env, interaction } = commandContext;
    const context = getModerationContext(
      commandContext,
      MODERATION_PERMISSIONS.manageMessages,
      "Manage Messages",
    );
    if ("error" in context) {
      return context.error;
    }

    const channelId = interaction.channel_id;
    const count = getOption(interaction, "count");
    const reason = getModerationReason(getOption(interaction, "reason"));
    if (
      typeof channelId !== "string" ||
      !/^\d{17,20}$/.test(channelId) ||
      typeof count !== "number" ||
      !Number.isInteger(count) ||
      count < 1 ||
      count > 100 ||
      reason === null
    ) {
      return {
        content: "Choose a valid message count and a reason of at most 400 characters.",
        ephemeral: true,
      };
    }

    return moderationResponse(
      purgeRecentMessages(context.botToken, channelId, count, reason),
    );
  },
} satisfies DiscordCommand;

export default purgeCommand;

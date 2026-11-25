import { getOption, getUser } from "./helpers";
import {
  getModerationContext,
  getModerationReason,
  getModerationTargetId,
  MODERATION_PERMISSIONS,
  moderationResponse,
  moderationActionWithCase,
  requestDiscord,
} from "./moderation-helpers";
import type { DiscordCommand } from "./types";

const untimeoutCommand = {
  name: "untimeout",
  description: "Remove a member's timeout.",
  default_member_permissions: "1099511627776",
  options: [
    {
      type: 6,
      name: "user",
      description: "The member to untimeout.",
      required: true,
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
      MODERATION_PERMISSIONS.moderateMembers,
      "Moderate Members",
    );
    if ("error" in context) {
      return context.error;
    }

    const userId = getModerationTargetId(getOption(interaction, "user"));
    const moderatorId = getUser(interaction)?.id;
    const reason = getModerationReason(getOption(interaction, "reason"));
    if (!userId || reason === null || typeof moderatorId !== "string") {
      return {
        content: "Choose a valid member and a reason of at most 400 characters.",
        ephemeral: true,
      };
    }

    return moderationResponse(
      moderationActionWithCase(requestDiscord({
        method: "PATCH",
        path: `/guilds/${encodeURIComponent(context.guildId)}/members/${encodeURIComponent(userId)}`,
        botToken: context.botToken,
        body: { communication_disabled_until: null },
        reason,
      }), env.FEEDBACK_CONFIG, context.guildId, userId, moderatorId, "untimeout", reason, `Removed the timeout for <@${userId}>.`),
    );
  },
} satisfies DiscordCommand;

export default untimeoutCommand;

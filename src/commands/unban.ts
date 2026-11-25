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

const unbanCommand = {
  name: "unban",
  description: "Unban a user by their Discord ID.",
  default_member_permissions: "4",
  options: [
    {
      type: 3,
      name: "user_id",
      description: "The Discord ID of the user to unban.",
      required: true,
      min_length: 17,
      max_length: 20,
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
      MODERATION_PERMISSIONS.banMembers,
      "Ban Members",
    );
    if ("error" in context) {
      return context.error;
    }

    const userId = getModerationTargetId(getOption(interaction, "user_id"));
    const moderatorId = getUser(interaction)?.id;
    const reason = getModerationReason(getOption(interaction, "reason"));
    if (!userId || reason === null || typeof moderatorId !== "string") {
      return {
        content: "Provide a valid Discord user ID and a reason of at most 400 characters.",
        ephemeral: true,
      };
    }

    return moderationResponse(
      moderationActionWithCase(requestDiscord({
        method: "DELETE",
        path: `/guilds/${encodeURIComponent(context.guildId)}/bans/${encodeURIComponent(userId)}`,
        botToken: context.botToken,
        reason,
      }), env.FEEDBACK_CONFIG, context.guildId, userId, moderatorId, "unban", reason, `Unbanned <@${userId}>.`),
    );
  },
} satisfies DiscordCommand;

export default unbanCommand;

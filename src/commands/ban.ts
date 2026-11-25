import { getOption } from "./helpers";
import {
  getModerationContext,
  getModerationReason,
  getModerationTargetId,
  MODERATION_PERMISSIONS,
  moderationResponse,
  requestDiscord,
} from "./moderation-helpers";
import type { DiscordCommand } from "./types";

const banCommand = {
  name: "ban",
  description: "Ban a member from this server.",
  default_member_permissions: "4",
  options: [
    {
      type: 6,
      name: "user",
      description: "The member to ban.",
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
      MODERATION_PERMISSIONS.banMembers,
      "Ban Members",
    );
    if ("error" in context) {
      return context.error;
    }

    const userId = getModerationTargetId(getOption(interaction, "user"));
    const reason = getModerationReason(getOption(interaction, "reason"));
    if (!userId || reason === null) {
      return {
        content: "Choose a valid member and a reason of at most 400 characters.",
        ephemeral: true,
      };
    }

    return moderationResponse(
      requestDiscord({
        method: "PUT",
        path: `/guilds/${encodeURIComponent(context.guildId)}/bans/${encodeURIComponent(userId)}`,
        botToken: context.botToken,
        reason,
      }).then((result) =>
        "error" in result ? result.error : `Banned <@${userId}>.`
      ),
    );
  },
} satisfies DiscordCommand;

export default banCommand;

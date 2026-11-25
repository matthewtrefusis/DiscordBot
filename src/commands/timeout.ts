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

const MAX_TIMEOUT_MINUTES = 28 * 24 * 60;

const timeoutCommand = {
  name: "timeout",
  description: "Temporarily prevent a member from chatting.",
  default_member_permissions: "1099511627776",
  options: [
    {
      type: 6,
      name: "user",
      description: "The member to timeout.",
      required: true,
    },
    {
      type: 4,
      name: "minutes",
      description: "Timeout duration, from 1 minute to 28 days.",
      required: true,
      min_value: 1,
      max_value: MAX_TIMEOUT_MINUTES,
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
    const minutes = getOption(interaction, "minutes");
    const reason = getModerationReason(getOption(interaction, "reason"));
    if (
      !userId ||
      typeof moderatorId !== "string" ||
      typeof minutes !== "number" ||
      !Number.isInteger(minutes) ||
      minutes < 1 ||
      minutes > MAX_TIMEOUT_MINUTES ||
      reason === null
    ) {
      return {
        content: "Choose a valid member, duration, and reason of at most 400 characters.",
        ephemeral: true,
      };
    }

    const until = new Date(Date.now() + minutes * 60_000).toISOString();
    return moderationResponse(
      moderationActionWithCase(requestDiscord({
        method: "PATCH",
        path: `/guilds/${encodeURIComponent(context.guildId)}/members/${encodeURIComponent(userId)}`,
        botToken: context.botToken,
        body: { communication_disabled_until: until },
        reason,
      }), env.FEEDBACK_CONFIG, context.guildId, userId, moderatorId, "timeout", reason, `Timed out <@${userId}> for ${minutes} minute${minutes === 1 ? "" : "s"}.`),
    );
  },
} satisfies DiscordCommand;

export default timeoutCommand;

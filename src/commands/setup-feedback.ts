import { getOption, isRecord } from "./helpers";
import type { DiscordCommand } from "./types";

const MANAGE_GUILD = 32n;
const ADMINISTRATOR = 8n;

function canManageFeedback(interaction: Record<string, unknown>): boolean {
  const member = interaction.member;
  if (!isRecord(member)) {
    return false;
  }

  const permissions = member.permissions;
  if (typeof permissions !== "string" || !/^\d+$/.test(permissions)) {
    return false;
  }

  const value = BigInt(permissions);
  return (value & (MANAGE_GUILD | ADMINISTRATOR)) !== 0n;
}

const setupFeedbackCommand = {
  name: "setup-feedback",
  description: "Choose the private channel for anonymous server feedback.",
  default_member_permissions: "32",
  options: [
    {
      type: 7,
      name: "channel",
      description: "The channel where anonymous feedback will be posted.",
      required: true,
      channel_types: [0, 5],
    },
  ],
  execute: async ({ env, interaction }) => {
    const guildId = interaction.guild_id;
    if (typeof guildId !== "string") {
      return {
        content: "This command can only be used in a server.",
        ephemeral: true,
      };
    }
    if (!canManageFeedback(interaction)) {
      return {
        content: "You need Manage Server permission to configure feedback.",
        ephemeral: true,
      };
    }
    if (!env.FEEDBACK_CONFIG) {
      console.error("FEEDBACK_CONFIG KV binding is not configured.");
      return {
        content: "Feedback setup is unavailable on this server.",
        ephemeral: true,
      };
    }

    const channelId = getOption(interaction, "channel");
    const data = interaction.data;
    const resolved = isRecord(data) ? data.resolved : undefined;
    const channels = isRecord(resolved) ? resolved.channels : undefined;
    const channel = typeof channelId === "string" && isRecord(channels)
      ? channels[channelId]
      : undefined;

    if (
      typeof channelId !== "string" ||
      !/^\d{17,20}$/.test(channelId) ||
      !isRecord(channel) ||
      (channel.type !== 0 && channel.type !== 5) ||
      (typeof channel.guild_id === "string" && channel.guild_id !== guildId)
    ) {
      return {
        content: "Choose a text or announcement channel in this server.",
        ephemeral: true,
      };
    }

    try {
      await env.FEEDBACK_CONFIG.put(`feedback-channel:${guildId}`, channelId);
    } catch (error) {
      console.error(
        "Could not save the feedback channel configuration:",
        error instanceof Error ? error.message : String(error),
      );
      return {
        content: "Could not save the feedback channel. Please try again later.",
        ephemeral: true,
      };
    }
    return {
      content: `Anonymous feedback will be sent to <#${channelId}>.`,
      ephemeral: true,
    };
  },
} satisfies DiscordCommand;

export default setupFeedbackCommand;

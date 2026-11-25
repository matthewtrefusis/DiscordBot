import { getOption, isRecord } from "./helpers";
import { canManageServer } from "./permissions";
import { birthdaySettingsKey } from "../birthdays";
import type { DiscordCommand } from "./types";

const setupBirthdaysCommand = {
  name: "setup-birthdays",
  description: "Choose the channel for opted-in birthday announcements.",
  default_member_permissions: "32",
  options: [
    {
      type: 7,
      name: "channel",
      description: "Text or announcement channel for birthdays.",
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
    if (!canManageServer(interaction)) {
      return {
        content: "You need Manage Server permission to configure birthdays.",
        ephemeral: true,
      };
    }
    if (!env.FEEDBACK_CONFIG) {
      console.error("FEEDBACK_CONFIG KV binding is not configured.");
      return {
        content: "Birthday settings are temporarily unavailable.",
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
      await env.FEEDBACK_CONFIG.put(
        birthdaySettingsKey(guildId),
        channelId,
      );
    } catch (error) {
      console.error(
        "Could not save birthday channel:",
        error instanceof Error ? error.message : String(error),
      );
      return {
        content: "Could not save the birthday channel. Please try again later.",
        ephemeral: true,
      };
    }
    return {
      content: `Opted-in birthday announcements will be sent to <#${channelId}> (UTC dates).`,
      ephemeral: true,
    };
  },
} satisfies DiscordCommand;

export default setupBirthdaysCommand;

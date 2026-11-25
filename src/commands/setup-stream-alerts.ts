import { getOption, isRecord } from "./helpers";
import { canManageServer } from "./permissions";
import {
  readStreamSettings,
  saveStreamSettings,
} from "./stream-settings";
import type { DiscordCommand } from "./types";

const setupStreamAlertsCommand = {
  name: "setup-stream-alerts",
  description: "Choose the channel for livestream and video announcements.",
  default_member_permissions: "32",
  options: [
    {
      type: 7,
      name: "channel",
      description: "The channel where livestreams will be announced.",
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
        content: "You need Manage Server permission to configure stream alerts.",
        ephemeral: true,
      };
    }
    if (!env.FEEDBACK_CONFIG || !env.DB) {
      console.error("Stream alerts are missing their KV or D1 binding.");
      return {
        content: "Stream alert setup is unavailable on this server.",
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
      const settings = await readStreamSettings(env.FEEDBACK_CONFIG, guildId);
      await saveStreamSettings(
        env.FEEDBACK_CONFIG,
        env.DB,
        guildId,
        {
          channelId,
          sources: settings?.sources ?? [],
        },
      );
    } catch (error) {
      console.error(
        "Could not save the stream alert channel:",
        error instanceof Error ? error.message : String(error),
      );
      return {
        content: "Could not save the stream alert channel. Please try again later.",
        ephemeral: true,
      };
    }

    return {
      content: `Livestream announcements will be sent to <#${channelId}>.`,
      ephemeral: true,
    };
  },
} satisfies DiscordCommand;

export default setupStreamAlertsCommand;

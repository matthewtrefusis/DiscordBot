import { getOption } from "./helpers";
import { canManageServer } from "./permissions";
import {
  parseStreamUrl,
  readStreamSettings,
  streamSettingsKey,
} from "./stream-settings";
import type { DiscordCommand } from "./types";

const streamRemoveCommand = {
  name: "stream-remove",
  description: "Remove a YouTube or Twitch channel from stream alerts.",
  default_member_permissions: "32",
  options: [
    {
      type: 3,
      name: "channel_url",
      description: "The configured YouTube or Twitch channel URL.",
      required: true,
      min_length: 10,
      max_length: 200,
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
    if (!env.FEEDBACK_CONFIG) {
      console.error("FEEDBACK_CONFIG KV binding is not configured.");
      return {
        content: "Stream alerts are unavailable on this server.",
        ephemeral: true,
      };
    }

    const parsedUrl = parseStreamUrl(getOption(interaction, "channel_url"));
    if (!parsedUrl) {
      return {
        content: "Provide the YouTube or Twitch channel URL used when adding the source.",
        ephemeral: true,
      };
    }

    try {
      const settings = await readStreamSettings(env.FEEDBACK_CONFIG, guildId);
      if (!settings) {
        return {
          content: "No stream alerts are configured for this server.",
          ephemeral: true,
        };
      }
      const index = settings.sources.findIndex(
        (source) => source.url.toLowerCase() === parsedUrl.canonicalUrl.toLowerCase(),
      );
      if (index < 0) {
        return {
          content: "That channel URL is not configured for stream alerts.",
          ephemeral: true,
        };
      }
      const [removed] = settings.sources.splice(index, 1);
      await env.FEEDBACK_CONFIG.put(
        streamSettingsKey(guildId),
        JSON.stringify(settings),
      );
      return {
        content: `Removed ${removed.displayName} from stream alerts.`,
        ephemeral: true,
      };
    } catch (error) {
      console.error(
        "Could not remove stream alert source:",
        error instanceof Error ? error.message : String(error),
      );
      return {
        content: "Could not update stream alerts. Please try again later.",
        ephemeral: true,
      };
    }
  },
} satisfies DiscordCommand;

export default streamRemoveCommand;

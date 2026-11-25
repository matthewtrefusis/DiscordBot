import { resolveStreamSource } from "../streams";
import { getOption } from "./helpers";
import { canManageServer } from "./permissions";
import {
  MAX_STREAM_SOURCES,
  parseStreamUrl,
  readStreamSettings,
  saveStreamSettings,
} from "./stream-settings";
import type { DiscordCommand } from "./types";

const streamAddCommand = {
  name: "stream-add",
  description: "Add a YouTube or Twitch channel to live and video alerts.",
  default_member_permissions: "32",
  options: [
    {
      type: 3,
      name: "channel_url",
      description: "YouTube or Twitch channel URL.",
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
        content:
          "You need Manage Server permission to configure stream alerts.",
        ephemeral: true,
      };
    }
    if (!env.FEEDBACK_CONFIG || !env.DB) {
      console.error("Stream alerts are missing their KV or D1 binding.");
      return {
        content: "Stream alerts are unavailable on this server.",
        ephemeral: true,
      };
    }

    const parsedUrl = parseStreamUrl(getOption(interaction, "channel_url"));
    if (!parsedUrl) {
      return {
        content:
          "Provide a YouTube channel URL (/channel/ID, /@handle, or /user/name) or a Twitch channel URL.",
        ephemeral: true,
      };
    }

    try {
      const settings = await readStreamSettings(env.FEEDBACK_CONFIG, guildId);
      if (!settings) {
        return {
          content:
            "Run /setup-stream-alerts first to choose an announcement channel.",
          ephemeral: true,
        };
      }
      if (
        settings.sources.some(
          (source) =>
            source.url.toLowerCase() === parsedUrl.canonicalUrl.toLowerCase(),
        )
      ) {
        return {
          content: "That channel is already configured for stream alerts.",
          ephemeral: true,
        };
      }
      if (settings.sources.length >= MAX_STREAM_SOURCES) {
        return {
          content: `This server has reached the limit of ${MAX_STREAM_SOURCES} stream sources.`,
          ephemeral: true,
        };
      }
    } catch (error) {
      console.error(
        "Could not read stream alert settings:",
        error instanceof Error ? error.message : String(error),
      );
      return {
        content:
          "Could not read stream alert settings. Please try again later.",
        ephemeral: true,
      };
    }

    const store = env.FEEDBACK_CONFIG;
    const database = env.DB;
    const addedAt = Date.now();
    const backgroundTask = resolveStreamSource(env, parsedUrl)
      .then(async (source) => {
        const settings = await readStreamSettings(store, guildId);
        if (!settings) {
          return "Stream alerts were disabled before the channel could be added.";
        }
        if (
          settings.sources.some(
            (existing) => existing.channelId === source.channelId,
          )
        ) {
          return "That channel is already configured for stream alerts.";
        }
        if (settings.sources.length >= MAX_STREAM_SOURCES) {
          return `This server has reached the limit of ${MAX_STREAM_SOURCES} stream sources.`;
        }
        settings.sources.push({ ...source, addedAt });
        await saveStreamSettings(store, database, guildId, settings);
        return `Added ${source.displayName} (${source.platform}) to stream alerts.`;
      })
      .catch((error: unknown) => {
        console.error(
          "Could not add stream alert source:",
          error instanceof Error ? error.message : String(error),
        );
        return error instanceof Error
          ? `Could not add that channel: ${error.message}`
          : "Could not add that channel. Check the URL and provider credentials.";
      });

    return {
      content: "Checking the channel URL…",
      ephemeral: true,
      backgroundTask,
    };
  },
} satisfies DiscordCommand;

export default streamAddCommand;

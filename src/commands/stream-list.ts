import { canManageServer } from "./permissions";
import { readStreamSettings } from "./stream-settings";
import type { DiscordCommand } from "./types";

const streamListCommand = {
  name: "stream-list",
  description: "List the livestream alert channel and sources.",
  default_member_permissions: "32",
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
        content: "You need Manage Server permission to view stream settings.",
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

    try {
      const settings = await readStreamSettings(env.FEEDBACK_CONFIG, guildId);
      if (!settings) {
        return {
          content: "No stream alerts are configured for this server.",
          ephemeral: true,
        };
      }
      const sources = settings.sources.length
        ? settings.sources
          .map((source) => `• ${source.displayName.slice(0, 50)} (${source.platform})${source.paused ? " — paused" : ""}: ${source.url}`)
          .join("\n")
        : "No channels added yet.";
      return {
        content: `**Announcement channel:** <#${settings.channelId}>\n**Sources:**\n${sources}`,
        ephemeral: true,
      };
    } catch (error) {
      console.error(
        "Could not read stream alert settings:",
        error instanceof Error ? error.message : String(error),
      );
      return {
        content: "Could not read stream alert settings. Please try again later.",
        ephemeral: true,
      };
    }
  },
} satisfies DiscordCommand;

export default streamListCommand;

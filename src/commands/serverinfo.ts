import { fetchGuildInfo } from "./guild-info";
import type { DiscordCommand } from "./types";

const serverinfoCommand = {
  name: "serverinfo",
  description: "Show details about this server.",
  execute: async ({ env, interaction }) => {
    const guildId = interaction.guild_id;
    if (typeof guildId !== "string" || !/^\d{17,20}$/.test(guildId)) {
      return {
        content: "This command can only be used in a server.",
        ephemeral: true,
      };
    }
    if (!env.DISCORD_BOT_TOKEN) {
      console.error("DISCORD_BOT_TOKEN is not configured.");
      return {
        content: "Server details are temporarily unavailable.",
        ephemeral: true,
      };
    }

    try {
      const guild = await fetchGuildInfo(env.DISCORD_BOT_TOKEN, guildId);
      const details = [
        `**Server:** ${guild.name}`,
        `**ID:** ${guild.id}`,
        ...(guild.ownerId ? [`**Owner:** <@${guild.ownerId}>`] : []),
        ...(guild.approximateMemberCount !== undefined
          ? [`**Members:** ~${guild.approximateMemberCount}`]
          : []),
        ...(guild.approximatePresenceCount !== undefined
          ? [`**Online:** ~${guild.approximatePresenceCount}`]
          : []),
        ...(guild.boostLevel !== undefined
          ? [`**Boost level:** ${guild.boostLevel}`]
          : []),
        ...(guild.description ? [`**Description:** ${guild.description}`] : []),
      ];
      return details.join("\n");
    } catch (error) {
      console.error(
        "Could not load server details:",
        error instanceof Error ? error.message : String(error),
      );
      return {
        content: "Server details are temporarily unavailable.",
        ephemeral: true,
      };
    }
  },
} satisfies DiscordCommand;

export default serverinfoCommand;

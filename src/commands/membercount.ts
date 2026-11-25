import { fetchGuildInfo } from "./guild-info";
import type { DiscordCommand } from "./types";

const membercountCommand = {
  name: "membercount",
  description: "Show the approximate member count for this server.",
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
        content: "The member count is temporarily unavailable.",
        ephemeral: true,
      };
    }

    try {
      const guild = await fetchGuildInfo(env.DISCORD_BOT_TOKEN, guildId);
      if (guild.approximateMemberCount === undefined) {
        return {
          content: "Discord did not provide a member count for this server.",
          ephemeral: true,
        };
      }
      return `This server has approximately **${guild.approximateMemberCount}** members.`;
    } catch (error) {
      console.error(
        "Could not load the server member count:",
        error instanceof Error ? error.message : String(error),
      );
      return {
        content: "The member count is temporarily unavailable.",
        ephemeral: true,
      };
    }
  },
} satisfies DiscordCommand;

export default membercountCommand;

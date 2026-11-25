import { isRecord } from "./helpers";
import type { DiscordCommand } from "./types";

const quoteCommand = {
  type: 3,
  name: "Quote message",
  execute: ({ env, interaction }) => {
    const data = interaction.data;
    const targetId = isRecord(data) ? data.target_id : undefined;
    const resolved = isRecord(data) ? data.resolved : undefined;
    const messages = isRecord(resolved) ? resolved.messages : undefined;
    const message = typeof targetId === "string" && isRecord(messages)
      ? messages[targetId]
      : undefined;
    const guildId = interaction.guild_id;
    const channelId = interaction.channel_id;
    if (
      !isRecord(message) ||
      typeof guildId !== "string" ||
      !/^\d{17,20}$/.test(guildId) ||
      typeof channelId !== "string" ||
      !/^\d{17,20}$/.test(channelId) ||
      (typeof message.guild_id === "string" &&
        message.guild_id !== guildId) ||
      typeof message.id !== "string" ||
      !/^\d{17,20}$/.test(message.id) ||
      typeof message.channel_id !== "string" ||
      !/^\d{17,20}$/.test(message.channel_id) ||
      !isRecord(message.author) ||
      typeof message.author.id !== "string"
    ) {
      return {
        content: "That message cannot be quoted from this server.",
        ephemeral: true,
      };
    }
    if (!env.DISCORD_BOT_TOKEN) {
      console.error("DISCORD_BOT_TOKEN is not configured.");
      return {
        content: "Quoting messages is temporarily unavailable.",
        ephemeral: true,
      };
    }

    const authorName = typeof message.author.global_name === "string"
      ? message.author.global_name
      : typeof message.author.username === "string"
        ? message.author.username
        : "Unknown user";
    const text = typeof message.content === "string" && message.content.length > 0
      ? message.content.slice(0, 1500).split("\n").map((line) => `> ${line}`).join("\n")
      : "> (No text content)";
    const content = [
      `💬 **${authorName} said:**`,
      text,
      `— <https://discord.com/channels/${guildId}/${message.channel_id}/${message.id}>`,
    ].join("\n");
    const botToken = env.DISCORD_BOT_TOKEN;
    return {
      content: "Posting the quote…",
      ephemeral: true,
      backgroundTask: fetch(
        `https://discord.com/api/v10/channels/${encodeURIComponent(channelId)}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bot ${botToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            content,
            allowed_mentions: { parse: [] },
          }),
        },
      ).then((response) => {
        if (!response.ok) {
          throw new Error(`Discord returned HTTP ${response.status}.`);
        }
        return "Quoted message posted.";
      }).catch((error: unknown) => {
        console.error(
          "Could not post quoted message:",
          error instanceof Error ? error.message : String(error),
        );
        return "The quote could not be posted. Check that the bot can send messages in this channel.";
      }),
    };
  },
} satisfies DiscordCommand;

export default quoteCommand;

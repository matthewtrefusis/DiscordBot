import { getOption } from "./helpers";
import { canManageServer } from "./permissions";
import {
  parseStreamUrl,
  readStreamSettings,
  saveStreamSettings,
} from "./stream-settings";
import type { CommandContext, CommandResponse } from "./types";

function isManagerInGuild(interaction: Record<string, unknown>): string | null {
  const guildId = interaction.guild_id;
  if (typeof guildId !== "string" || !/^\d{17,20}$/.test(guildId)) {
    return null;
  }
  return canManageServer(interaction) ? guildId : "";
}

export async function setStreamSourcePaused(
  context: CommandContext,
  paused: boolean,
): Promise<CommandResponse> {
  const guildId = isManagerInGuild(context.interaction);
  if (guildId === null) {
    return {
      content: "This command can only be used in a server.",
      ephemeral: true,
    };
  }
  if (guildId === "") {
    return {
      content: "You need Manage Server permission to configure stream alerts.",
      ephemeral: true,
    };
  }
  if (!context.env.FEEDBACK_CONFIG || !context.env.DB) {
    console.error("Stream alerts are missing their KV or D1 binding.");
    return {
      content: "Stream alerts are unavailable on this server.",
      ephemeral: true,
    };
  }
  const parsedUrl = parseStreamUrl(getOption(context.interaction, "channel_url"));
  if (!parsedUrl) {
    return {
      content: "Provide a configured YouTube or Twitch channel URL.",
      ephemeral: true,
    };
  }

  try {
    const settings = await readStreamSettings(context.env.FEEDBACK_CONFIG, guildId);
    if (!settings) {
      return {
        content: "Run `/setup-stream-alerts` first to configure stream alerts.",
        ephemeral: true,
      };
    }
    const source = settings.sources.find(
      (item) => item.url.toLowerCase() === parsedUrl.canonicalUrl.toLowerCase(),
    );
    if (!source) {
      return {
        content: "That channel is not configured for stream alerts.",
        ephemeral: true,
      };
    }
    if (source.paused === paused) {
      return {
        content: paused
          ? `Alerts for **${source.displayName}** are already paused.`
          : `Alerts for **${source.displayName}** are already active.`,
        ephemeral: true,
      };
    }
    source.paused = paused;
    source.resumePending = !paused;
    await saveStreamSettings(
      context.env.FEEDBACK_CONFIG,
      context.env.DB,
      guildId,
      settings,
    );
    return {
      content: paused
        ? `Paused alerts for **${source.displayName}**.`
        : `Resumed alerts for **${source.displayName}**. Any activity already in progress will be treated as the new baseline.`,
      ephemeral: true,
    };
  } catch (error) {
    console.error(
      "Could not update stream source state:",
      error instanceof Error ? error.message : String(error),
    );
    return {
      content: "Could not update that stream source. Please try again later.",
      ephemeral: true,
    };
  }
}

export async function sendStreamTest(
  context: CommandContext,
): Promise<CommandResponse> {
  const guildId = isManagerInGuild(context.interaction);
  if (guildId === null) {
    return {
      content: "This command can only be used in a server.",
      ephemeral: true,
    };
  }
  if (guildId === "") {
    return {
      content: "You need Manage Server permission to test stream alerts.",
      ephemeral: true,
    };
  }
  if (!context.env.FEEDBACK_CONFIG || !context.env.DISCORD_BOT_TOKEN) {
    console.error("Stream alert testing is missing its KV binding or bot token.");
    return {
      content: "Stream alerts are temporarily unavailable.",
      ephemeral: true,
    };
  }

  try {
    const settings = await readStreamSettings(context.env.FEEDBACK_CONFIG, guildId);
    if (!settings) {
      return {
        content: "Run `/setup-stream-alerts` first to configure stream alerts.",
        ephemeral: true,
      };
    }
    const botToken = context.env.DISCORD_BOT_TOKEN;
    const channelId = settings.channelId;
    const backgroundTask = (async () => {
      const response = await fetch(
        `https://discord.com/api/v10/channels/${encodeURIComponent(channelId)}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bot ${botToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            content: "✅ Stream alert test. The bot can post in this channel.",
            allowed_mentions: { parse: [] },
          }),
        },
      );
      if (!response.ok) {
        throw new Error(`Discord returned HTTP ${response.status}.`);
      }
      return `Test message sent to <#${channelId}>.`;
    })().catch((error: unknown) => {
      console.error(
        "Could not send stream alert test:",
        error instanceof Error ? error.message : String(error),
      );
      return "Could not send a test message. Check the bot's channel permissions.";
    });
    return {
      content: "Sending a stream alert test…",
      ephemeral: true,
      backgroundTask,
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
}

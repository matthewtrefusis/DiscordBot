import { getOption, isRecord } from "./helpers";
import { feedbackSettingsKey } from "./feedback-settings";
import { canManageServer } from "./permissions";
import type { DiscordCommand } from "./types";

function parseCategories(value: unknown): string[] | null {
  if (typeof value !== "string") {
    return null;
  }

  const categories = value.split(",").map((category) => category.trim());
  if (
    categories.length === 0 ||
    categories.length > 25 ||
    categories.some((category) => category.length === 0 || category.length > 100)
  ) {
    return null;
  }

  const normalizedCategories = new Set(
    categories.map((category) => category.toLowerCase()),
  );
  return normalizedCategories.size === categories.length ? categories : null;
}

const setupFeedbackCommand = {
  name: "setup-feedback",
  description: "Configure the destination and categories for anonymous feedback.",
  default_member_permissions: "32",
  options: [
    {
      type: 7,
      name: "channel",
      description: "The channel where anonymous feedback will be posted.",
      required: true,
      channel_types: [0, 5],
    },
    {
      type: 3,
      name: "categories",
      description: "Comma-separated category names (1-25 categories).",
      required: true,
      max_length: 6000,
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
    const categories = parseCategories(getOption(interaction, "categories"));
    if (!categories) {
      return {
        content: "Provide 1–25 unique category names, each 1–100 characters, separated by commas.",
        ephemeral: true,
      };
    }

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
        feedbackSettingsKey(guildId),
        JSON.stringify({ channelId, categories }),
      );
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
      content: `Anonymous feedback will be sent to <#${channelId}>. Configured ${categories.length} categories.`,
      ephemeral: true,
    };
  },
} satisfies DiscordCommand;

export default setupFeedbackCommand;

import { getOption, isRecord } from "./helpers";
import {
  readFeedbackSettings,
  type FeedbackSettings,
} from "./feedback-settings";
import type { CommandContext, DiscordCommand } from "./types";

async function deliverFeedback(
  message: string,
  category: string,
  botToken: string,
  channelId: string,
  guildId: string,
  store: NonNullable<CommandContext["env"]["FEEDBACK_CONFIG"]>,
): Promise<string> {
  try {
    const response = await fetch(
      `https://discord.com/api/v10/channels/${channelId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bot ${botToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          content: `**Anonymous feedback · ${category}**\n${message}`,
          allowed_mentions: { parse: [] },
        }),
      },
    );

    if (!response.ok) {
      console.error(`Feedback delivery failed with HTTP ${response.status}.`);
      return "Your feedback couldn't be delivered. Please try again later.";
    }

    try {
      const statsKey = `feedback-stats:${guildId}`;
      const rawStats = await store.get(statsKey);
      const counts = new Map<string, number>();
      if (rawStats !== null) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(rawStats);
        } catch (error) {
          if (error instanceof SyntaxError) {
            throw new Error("Stored feedback statistics are invalid JSON.");
          }
          throw error;
        }
        if (
          typeof parsed !== "object" ||
          parsed === null ||
          Array.isArray(parsed)
        ) {
          throw new Error("Stored feedback statistics have an invalid format.");
        }
        for (const [name, count] of Object.entries(parsed)) {
          if (
            typeof count !== "number" ||
            !Number.isSafeInteger(count) ||
            count < 0
          ) {
            throw new Error("Stored feedback statistics have an invalid count.");
          }
          counts.set(name, count);
        }
      }
      const nextCount = (counts.get(category) ?? 0) + 1;
      if (!Number.isSafeInteger(nextCount)) {
        throw new Error("Feedback category total exceeds the supported range.");
      }
      counts.set(category, nextCount);
      await store.put(statsKey, JSON.stringify(Object.fromEntries(counts)));
    } catch (error) {
      console.error(
        "Feedback was delivered but category statistics could not be updated:",
        error instanceof Error ? error.message : String(error),
      );
      return "Your feedback was submitted anonymously, but its category total could not be updated.";
    }

    return "Thank you for your feedback. It was submitted anonymously.";
  } catch (error) {
    console.error(
      "Feedback delivery failed:",
      error instanceof Error ? error.message : String(error),
    );
    return "Your feedback couldn't be delivered. Please try again later.";
  }
}

const feedbackCommand = {
  name: "feedback",
  description: "Send categorized anonymous feedback to this server.",
  options: [
    {
      type: 3,
      name: "category",
      description: "The category for your feedback.",
      required: true,
      autocomplete: true,
    },
    {
      type: 3,
      name: "message",
      description: "Your feedback (do not include personal information).",
      required: true,
      min_length: 1,
      max_length: 1000,
    },
  ],
  autocomplete: async ({ env, interaction }) => {
    const guildId = interaction.guild_id;
    if (typeof guildId !== "string" || !env.FEEDBACK_CONFIG) {
      return [];
    }

    try {
      const settings = await readFeedbackSettings(env, guildId);
      if (!settings) {
        return [];
      }

      const data = interaction.data;
      const options = isRecord(data) && Array.isArray(data.options)
        ? data.options
        : [];
      const focusedOption = options.find(
        (option) => isRecord(option) && option.focused === true,
      );
      const input = isRecord(focusedOption) &&
          typeof focusedOption.value === "string"
        ? focusedOption.value.toLowerCase()
        : "";

      return settings.categories
        .filter((category) => category.toLowerCase().includes(input))
        .slice(0, 25)
        .map((category) => ({ name: category, value: category }));
    } catch (error) {
      console.error(
        "Could not load feedback categories:",
        error instanceof Error ? error.message : String(error),
      );
      return [];
    }
  },
  execute: async ({ env, interaction }) => {
    const message = getOption(interaction, "message");
    const category = getOption(interaction, "category");
    const trimmedMessage = typeof message === "string" ? message.trim() : "";
    const guildId = interaction.guild_id;
    const botToken = env.DISCORD_BOT_TOKEN;
    if (trimmedMessage.length === 0 || trimmedMessage.length > 1000) {
      return {
        content: "Please provide feedback before submitting.",
        ephemeral: true,
      };
    }
    if (typeof guildId !== "string") {
      return {
        content: "Anonymous feedback can only be submitted from a server.",
        ephemeral: true,
      };
    }
    if (!botToken || !env.FEEDBACK_CONFIG) {
      console.error("Anonymous feedback is missing its bot token or KV binding.");
      return {
        content: "Anonymous feedback is not configured on this server.",
        ephemeral: true,
      };
    }

    if (typeof category !== "string" || category.length === 0) {
      return {
        content: "Choose a feedback category before submitting.",
        ephemeral: true,
      };
    }

    let settings: FeedbackSettings | null;
    try {
      settings = await readFeedbackSettings(env, guildId);
    } catch (error) {
      console.error(
        "Could not read the feedback channel configuration:",
        error instanceof Error ? error.message : String(error),
      );
      return {
        content: "Feedback is temporarily unavailable. Please try again later.",
        ephemeral: true,
      };
    }
    if (!settings) {
      return {
        content: "Feedback has not been set up yet. Ask a server admin to run `/setup-feedback`.",
        ephemeral: true,
      };
    }
    if (settings.categories.length === 0) {
      return {
        content: "Feedback categories have not been set up yet. Ask a server admin to run `/setup-feedback`.",
        ephemeral: true,
      };
    }

    const configuredCategory = settings.categories.find(
      (configured) => configured.toLowerCase() === category.toLowerCase(),
    );
    if (!configuredCategory) {
      return {
        content: "That feedback category is no longer available. Choose a configured category or ask an admin to run `/setup-feedback`.",
        ephemeral: true,
      };
    }

    return {
      content: "Submitting your feedback…",
      ephemeral: true,
      backgroundTask: deliverFeedback(
        trimmedMessage,
        configuredCategory,
        botToken,
        settings.channelId,
        guildId,
        env.FEEDBACK_CONFIG,
      ),
    };
  },
} satisfies DiscordCommand;

export default feedbackCommand;

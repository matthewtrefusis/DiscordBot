import { canManageServer } from "./permissions";
import { readFeedbackSettings } from "./feedback-settings";
import { isRecord } from "./helpers";
import type { DiscordCommand } from "./types";

const feedbackStatsCommand = {
  name: "feedback-stats",
  description: "Show anonymous feedback totals by configured category.",
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
        content: "You need Manage Server permission to view feedback statistics.",
        ephemeral: true,
      };
    }
    if (!env.FEEDBACK_CONFIG) {
      console.error("FEEDBACK_CONFIG KV binding is not configured.");
      return {
        content: "Feedback statistics are temporarily unavailable.",
        ephemeral: true,
      };
    }

    try {
      const settings = await readFeedbackSettings(env, guildId);
      if (!settings || settings.categories.length === 0) {
        return {
          content: "Feedback categories have not been configured.",
          ephemeral: true,
        };
      }
      const rawStats = await env.FEEDBACK_CONFIG.get(
        `feedback-stats:${guildId}`,
      );
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
        if (!isRecord(parsed)) {
          throw new Error("Stored feedback statistics have an invalid format.");
        }
        for (const [category, count] of Object.entries(parsed)) {
          if (
            typeof count !== "number" ||
            !Number.isSafeInteger(count) ||
            count < 0
          ) {
            throw new Error("Stored feedback statistics have an invalid count.");
          }
          counts.set(category, count);
        }
      }
      const categoryLines = settings.categories.map(
        (category) =>
          `• ${category.slice(0, 50)}: **${counts.get(category) ?? 0}**`,
      );
      return {
        content: [
          "**Anonymous feedback totals**",
          ...categoryLines,
        ].join("\n"),
        ephemeral: true,
      };
    } catch (error) {
      console.error(
        "Could not read feedback statistics:",
        error instanceof Error ? error.message : String(error),
      );
      return {
        content: "Could not load feedback statistics. Please try again later.",
        ephemeral: true,
      };
    }
  },
} satisfies DiscordCommand;

export default feedbackStatsCommand;

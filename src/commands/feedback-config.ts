import { readFeedbackSettings } from "./feedback-settings";
import { canManageServer } from "./permissions";
import type { DiscordCommand } from "./types";

const feedbackConfigCommand = {
  name: "feedback-config",
  description: "Show this server's feedback destination and categories.",
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
        content: "You need Manage Server permission to view feedback configuration.",
        ephemeral: true,
      };
    }
    if (!env.FEEDBACK_CONFIG) {
      console.error("FEEDBACK_CONFIG KV binding is not configured.");
      return {
        content: "Feedback configuration is temporarily unavailable.",
        ephemeral: true,
      };
    }

    try {
      const settings = await readFeedbackSettings(env, guildId);
      if (!settings) {
        return {
          content: "Feedback has not been configured. Run `/setup-feedback` to set it up.",
          ephemeral: true,
        };
      }
      const categories = settings.categories.join(", ");
      return {
        content: [
          `**Feedback channel:** <#${settings.channelId}>`,
          `**Categories:** ${
            categories.length > 0
              ? categories.length > 1500
                ? `${categories.slice(0, 1499)}…`
                : categories
              : "Not configured; run `/setup-feedback`."
          }`,
        ].join("\n"),
        ephemeral: true,
      };
    } catch (error) {
      console.error(
        "Could not read feedback configuration:",
        error instanceof Error ? error.message : String(error),
      );
      return {
        content: "Feedback configuration is temporarily unavailable.",
        ephemeral: true,
      };
    }
  },
} satisfies DiscordCommand;

export default feedbackConfigCommand;

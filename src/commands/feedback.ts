import { getOption } from "./helpers";
import type { DiscordCommand } from "./types";

async function deliverFeedback(
  message: string,
  botToken: string,
  channelId: string,
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
          content: `**Anonymous feedback**\n${message}`,
          allowed_mentions: { parse: [] },
        }),
      },
    );

    if (!response.ok) {
      console.error(`Feedback delivery failed with HTTP ${response.status}.`);
      return "Your feedback couldn't be delivered. Please try again later.";
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
  description: "Send anonymous feedback to the server's feedback channel.",
  options: [
    {
      type: 3,
      name: "message",
      description: "Your feedback (do not include personal information).",
      required: true,
      min_length: 1,
      max_length: 1000,
    },
  ],
  execute: async ({ env, interaction }) => {
    const message = getOption(interaction, "message");
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

    let channelId: string | null;
    try {
      channelId = await env.FEEDBACK_CONFIG.get(`feedback-channel:${guildId}`);
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
    if (!channelId || !/^\d{17,20}$/.test(channelId)) {
      return {
        content: "Feedback has not been set up yet. Ask a server admin to run `/setup-feedback`.",
        ephemeral: true,
      };
    }

    return {
      content: "Submitting your feedback…",
      ephemeral: true,
      backgroundTask: deliverFeedback(
        trimmedMessage,
        botToken,
        channelId,
      ),
    };
  },
} satisfies DiscordCommand;

export default feedbackCommand;

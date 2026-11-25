import { getOption, isRecord } from "./helpers";
import type { DiscordCommand } from "./types";

const MAX_REMINDER_MINUTES = 356 * 24 * 60;

const remindCommand = {
  name: "remind",
  description: "Schedule a private reminder by direct message.",
  options: [
    {
      type: 4,
      name: "minutes",
      description: "How many minutes from now (1-512640).",
      required: true,
      min_value: 1,
      max_value: MAX_REMINDER_MINUTES,
    },
    {
      type: 3,
      name: "message",
      description: "What you want to be reminded about.",
      required: true,
      min_length: 1,
      max_length: 1000,
    },
  ],
  execute: async ({ env, interaction }) => {
    const userContainer = isRecord(interaction.member)
      ? interaction.member.user
      : interaction.user;
    const userId = isRecord(userContainer) ? userContainer.id : undefined;
    const minutes = getOption(interaction, "minutes");
    const messageValue = getOption(interaction, "message");
    const message = typeof messageValue === "string" ? messageValue.trim() : "";
    if (
      typeof userId !== "string" ||
      !/^\d{17,20}$/.test(userId) ||
      typeof minutes !== "number" ||
      !Number.isInteger(minutes) ||
      minutes < 1 ||
      minutes > MAX_REMINDER_MINUTES ||
      message.length === 0 ||
      message.length > 1000
    ) {
      return {
        content: "Provide a valid reminder message and a delay between 1 minute and 356 days.",
        ephemeral: true,
      };
    }
    if (!env.FEEDBACK_CONFIG) {
      console.error("FEEDBACK_CONFIG KV binding is not configured.");
      return {
        content: "Reminders are temporarily unavailable.",
        ephemeral: true,
      };
    }

    const dueAt = Date.now() + minutes * 60_000;
    const reminderId = crypto.randomUUID();
    try {
      await env.FEEDBACK_CONFIG.put(
        `reminder:${reminderId}`,
        JSON.stringify({ userId, message, dueAt, attempts: 0 }),
      );
    } catch (error) {
      console.error(
        "Could not save reminder:",
        error instanceof Error ? error.message : String(error),
      );
      return {
        content: "Your reminder could not be saved. Please try again later.",
        ephemeral: true,
      };
    }

    return {
      content: `I'll DM you <t:${Math.floor(dueAt / 1000)}:R>.`,
      ephemeral: true,
    };
  },
} satisfies DiscordCommand;

export default remindCommand;

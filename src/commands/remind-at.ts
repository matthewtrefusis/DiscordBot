import { getOption, getUser } from "./helpers";
import { MAX_REMINDER_DELAY_MS, saveReminder } from "../reminders";
import { parseLocalDateTime, readUserTimeZone } from "../time-utils";
import type { DiscordCommand } from "./types";

const remindAtCommand = {
  name: "remind-at",
  description: "Schedule a private reminder for a local date and time.",
  options: [
    {
      type: 3,
      name: "local_time",
      description: "Local date and time, YYYY-MM-DD HH:mm (24-hour clock).",
      required: true,
      min_length: 16,
      max_length: 16,
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
    const user = getUser(interaction);
    const userId = user?.id;
    const localTime = getOption(interaction, "local_time");
    const messageValue = getOption(interaction, "message");
    const message = typeof messageValue === "string" ? messageValue.trim() : "";
    if (
      typeof userId !== "string" ||
      !/^\d{17,20}$/.test(userId) ||
      typeof localTime !== "string" ||
      message.length === 0 ||
      message.length > 1000
    ) {
      return {
        content: "Provide a valid local date and time and a reminder message.",
        ephemeral: true,
      };
    }
    if (!env.FEEDBACK_CONFIG || !env.DB) {
      console.error("Reminder scheduling is missing its KV or D1 binding.");
      return {
        content: "Reminders are temporarily unavailable.",
        ephemeral: true,
      };
    }

    let timeZone: string | null;
    try {
      timeZone = await readUserTimeZone(env.FEEDBACK_CONFIG, userId);
    } catch (error) {
      console.error(
        "Could not read timezone:",
        error instanceof Error ? error.message : String(error),
      );
      return {
        content: "Your timezone could not be loaded. Please try again later.",
        ephemeral: true,
      };
    }
    if (!timeZone) {
      return {
        content: "Set your timezone first with `/timezone timezone:Europe/London`.",
        ephemeral: true,
      };
    }

    const result = parseLocalDateTime(localTime, timeZone);
    if (result.status === "ambiguous") {
      return {
        content: "That local time occurs twice because of a daylight-saving change. Choose a different time.",
        ephemeral: true,
      };
    }
    if (result.status !== "valid") {
      return {
        content: "Use a real date and time in `YYYY-MM-DD HH:mm` format. Times skipped by daylight-saving changes are not valid.",
        ephemeral: true,
      };
    }
    const now = Date.now();
    if (
      result.timestamp < now + 60_000 ||
      result.timestamp > now + MAX_REMINDER_DELAY_MS
    ) {
      return {
        content: "Choose a time at least one minute from now and no more than 356 days away.",
        ephemeral: true,
      };
    }

    try {
      await saveReminder(
        env.DB,
        userId,
        message,
        result.timestamp,
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
      content: `I'll DM you <t:${Math.floor(result.timestamp / 1000)}:F> (${timeZone}).`,
      ephemeral: true,
    };
  },
} satisfies DiscordCommand;

export default remindAtCommand;

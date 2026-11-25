import { getOption, getUser } from "./helpers";
import {
  birthdayIndexKey,
  birthdayKey,
  parseBirthday,
} from "../birthdays";
import { saveScheduledItem } from "../scheduler";
import type { DiscordCommand } from "./types";

function isValidBirthday(month: number, day: number): boolean {
  const date = new Date(Date.UTC(2000, month - 1, day));
  return date.getUTCMonth() + 1 === month && date.getUTCDate() === day;
}

const birthdaySetCommand = {
  name: "birthday-set",
  description: "Opt in to birthday announcements using month and day only.",
  options: [
    {
      type: 4,
      name: "month",
      description: "Birth month (1-12).",
      required: true,
      min_value: 1,
      max_value: 12,
    },
    {
      type: 4,
      name: "day",
      description: "Day of the month.",
      required: true,
      min_value: 1,
      max_value: 31,
    },
  ],
  execute: async ({ env, interaction }) => {
    const guildId = interaction.guild_id;
    const user = getUser(interaction);
    const userId = user?.id;
    const month = getOption(interaction, "month");
    const day = getOption(interaction, "day");
    if (
      typeof guildId !== "string" ||
      !/^\d{17,20}$/.test(guildId) ||
      typeof userId !== "string" ||
      !/^\d{17,20}$/.test(userId)
    ) {
      return {
        content: "Birthday announcements can only be configured in a server.",
        ephemeral: true,
      };
    }
    if (
      typeof month !== "number" ||
      typeof day !== "number" ||
      !Number.isInteger(month) ||
      !Number.isInteger(day) ||
      !isValidBirthday(month, day)
    ) {
      return {
        content: "Provide a real month and day (February 29 is supported).",
        ephemeral: true,
      };
    }
    if (!env.FEEDBACK_CONFIG || !env.DB) {
      console.error("Birthday settings are missing their KV or D1 binding.");
      return {
        content: "Birthday settings are temporarily unavailable.",
        ephemeral: true,
      };
    }

    const key = birthdayKey(guildId, userId);
    let previousRaw: string | null = null;
    let saved = false;
    try {
      previousRaw = await env.FEEDBACK_CONFIG.get(key);
      let previous: ReturnType<typeof parseBirthday> = null;
      if (previousRaw) {
        previous = parseBirthday(previousRaw);
        if (!previous || previous.guildId !== guildId || previous.userId !== userId) {
          throw new Error("Stored birthday has an invalid format.");
        }
      }
      const birthday = {
        guildId,
        userId,
        month,
        day,
        ...(previous?.month === month && previous.day === day &&
            previous.lastAnnouncedYear !== undefined
          ? { lastAnnouncedYear: previous.lastAnnouncedYear }
          : {}),
      };
      await env.FEEDBACK_CONFIG.put(key, JSON.stringify(birthday));
      saved = true;
      await saveScheduledItem(env.DB, "birthday", {
        itemKey: `${guildId}:${userId}`,
        dueAt: null,
        lookupKey: `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
        referenceKey: null,
        payload: null,
      });
      if (previous && (previous.month !== month || previous.day !== day)) {
        const oldIndexKey = birthdayIndexKey(
          previous.month,
          previous.day,
          guildId,
          userId,
        );
        try {
          await env.FEEDBACK_CONFIG.delete(oldIndexKey);
        } catch (error) {
          console.error(
            `Could not remove legacy birthday index ${oldIndexKey}:`,
            error instanceof Error ? error.message : String(error),
          );
        }
      }
    } catch (error) {
      console.error(
        "Could not save birthday:",
        error instanceof Error ? error.message : String(error),
      );
      if (saved) {
        try {
          if (previousRaw === null) {
            await env.FEEDBACK_CONFIG.delete(key);
          } else {
            await env.FEEDBACK_CONFIG.put(key, previousRaw);
          }
        } catch (rollbackError) {
          console.error(
            "Could not restore the previous birthday record:",
            rollbackError instanceof Error
              ? rollbackError.message
              : String(rollbackError),
          );
        }
      }
      return {
        content: "Your birthday could not be saved. Please try again later.",
        ephemeral: true,
      };
    }
    return {
      content: "You opted in to birthday announcements. Only your month and day are stored; no birth year is collected.",
      ephemeral: true,
    };
  },
} satisfies DiscordCommand;

export default birthdaySetCommand;

import { getUser } from "./helpers";
import {
  birthdayIndexKey,
  birthdayKey,
  parseBirthday,
} from "../birthdays";
import { deleteScheduledItem } from "../scheduler";
import type { DiscordCommand } from "./types";

const birthdayRemoveCommand = {
  name: "birthday-remove",
  description: "Opt out of birthday announcements and remove your date.",
  execute: async ({ env, interaction }) => {
    const guildId = interaction.guild_id;
    const user = getUser(interaction);
    const userId = user?.id;
    if (
      typeof guildId !== "string" ||
      !/^\d{17,20}$/.test(guildId) ||
      typeof userId !== "string" ||
      !/^\d{17,20}$/.test(userId)
    ) {
      return {
        content: "This command can only be used in a server.",
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
    try {
      const key = birthdayKey(guildId, userId);
      const rawBirthday = await env.FEEDBACK_CONFIG.get(key);
      const birthday = rawBirthday ? parseBirthday(rawBirthday) : null;
      if (rawBirthday && !birthday) {
        throw new Error("Stored birthday has an invalid format.");
      }
      await env.FEEDBACK_CONFIG.delete(key);
      await deleteScheduledItem(env.DB, "birthday", `${guildId}:${userId}`);
      if (birthday) {
        await env.FEEDBACK_CONFIG.delete(
          birthdayIndexKey(
            birthday.month,
            birthday.day,
            guildId,
            userId,
          ),
        );
      }
      return {
        content: "Your birthday date was removed and you opted out.",
        ephemeral: true,
      };
    } catch (error) {
      console.error(
        "Could not remove birthday:",
        error instanceof Error ? error.message : String(error),
      );
      return {
        content: "Your birthday date could not be removed. Please try again later.",
        ephemeral: true,
      };
    }
  },
} satisfies DiscordCommand;

export default birthdayRemoveCommand;

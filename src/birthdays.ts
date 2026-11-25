import { isRecord } from "./commands/helpers";
import type { CommandEnvironment } from "./commands/types";
import {
  deleteScheduledItem,
  listScheduledItemsByLookup,
  saveScheduledItem,
} from "./scheduler";

const INDEX_PREFIX = "birthday-date:";

interface Birthday {
  guildId: string;
  userId: string;
  month: number;
  day: number;
  lastAnnouncedYear?: number;
}

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

export function birthdayKey(guildId: string, userId: string): string {
  return `birthday:${guildId}:${userId}`;
}

export function birthdaySettingsKey(guildId: string): string {
  return `birthday-settings:${guildId}`;
}

export function birthdayIndexKey(
  month: number,
  day: number,
  guildId: string,
  userId: string,
): string {
  return `${INDEX_PREFIX}${twoDigits(month)}-${twoDigits(day)}:${guildId}:${userId}`;
}

export function parseBirthday(value: string): Birthday | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return null;
    }
    throw error;
  }
  if (
    !isRecord(parsed) ||
    typeof parsed.guildId !== "string" ||
    !/^\d{17,20}$/.test(parsed.guildId) ||
    typeof parsed.userId !== "string" ||
    !/^\d{17,20}$/.test(parsed.userId) ||
    typeof parsed.month !== "number" ||
    !Number.isInteger(parsed.month) ||
    typeof parsed.day !== "number" ||
    !Number.isInteger(parsed.day) ||
    (parsed.lastAnnouncedYear !== undefined &&
      (typeof parsed.lastAnnouncedYear !== "number" ||
        !Number.isInteger(parsed.lastAnnouncedYear)))
  ) {
    return null;
  }
  const date = new Date(Date.UTC(2000, parsed.month - 1, parsed.day));
  if (
    date.getUTCMonth() + 1 !== parsed.month ||
    date.getUTCDate() !== parsed.day
  ) {
    return null;
  }
  return {
    guildId: parsed.guildId,
    userId: parsed.userId,
    month: parsed.month,
    day: parsed.day,
    ...(typeof parsed.lastAnnouncedYear === "number"
      ? { lastAnnouncedYear: parsed.lastAnnouncedYear }
      : {}),
  };
}

async function announceBirthday(
  botToken: string,
  channelId: string,
  userId: string,
): Promise<void> {
  const response = await fetch(
    `https://discord.com/api/v10/channels/${encodeURIComponent(channelId)}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bot ${botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content: `🎂 Happy birthday, <@${userId}>!`,
        allowed_mentions: { parse: [], users: [userId] },
      }),
    },
  );
  if (!response.ok) {
    throw new Error(`Discord returned HTTP ${response.status}.`);
  }
}

export async function processBirthdays(
  env: CommandEnvironment,
  now: number,
): Promise<void> {
  const store = env.FEEDBACK_CONFIG;
  const database = env.DB;
  const botToken = env.DISCORD_BOT_TOKEN;
  if (!store || !database || !botToken) {
    throw new Error("Birthday announcements are missing their KV/D1 binding or bot token.");
  }

  const date = new Date(now);
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const year = date.getUTCFullYear();
  const lookupKey = `${twoDigits(month)}-${twoDigits(day)}`;
  const birthdays = await listScheduledItemsByLookup(
    database,
    "birthday",
    lookupKey,
  );
  for (const scheduledBirthday of birthdays) {
    const [guildId, userId] = scheduledBirthday.itemKey.split(":");
    if (
      typeof guildId !== "string" ||
      !/^\d{17,20}$/.test(guildId) ||
      typeof userId !== "string" ||
      !/^\d{17,20}$/.test(userId)
    ) {
      console.error(`Discarding malformed birthday index ${scheduledBirthday.itemKey}.`);
      await deleteScheduledItem(database, "birthday", scheduledBirthday.itemKey);
      if (scheduledBirthday.referenceKey) {
        await store.delete(scheduledBirthday.referenceKey);
      }
      continue;
    }

    try {
      const rawBirthday = await store.get(birthdayKey(guildId, userId));
      const birthday = rawBirthday ? parseBirthday(rawBirthday) : null;
      if (!birthday) {
        console.error(`Discarding invalid birthday record for ${guildId}/${userId}.`);
        await deleteScheduledItem(database, "birthday", scheduledBirthday.itemKey);
        if (scheduledBirthday.referenceKey) {
          await store.delete(scheduledBirthday.referenceKey);
        }
        continue;
      }
      if (
        birthday.month !== month ||
        birthday.day !== day ||
        birthday.lastAnnouncedYear === year
      ) {
        continue;
      }
      const channelId = await store.get(birthdaySettingsKey(guildId));
      if (!channelId || !/^\d{17,20}$/.test(channelId)) {
        continue;
      }
      await announceBirthday(botToken, channelId, userId);
      await store.put(
        birthdayKey(guildId, userId),
        JSON.stringify({ ...birthday, lastAnnouncedYear: year }),
      );
    } catch (error) {
      console.error(
        `Could not announce birthday for ${guildId}/${userId}:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}

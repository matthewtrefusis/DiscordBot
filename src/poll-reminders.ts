import { isRecord } from "./commands/helpers";
import { pollKey, readPollState } from "./commands/poll";
import type { CommandEnvironment, KeyValueStore } from "./commands/types";

const REMINDER_PREFIX = "poll-reminder:";
const DUE_PREFIX = "poll-reminder-due:";
const MAX_DELIVERY_ATTEMPTS = 5;
export const POLL_REMINDER_TTL_SECONDS =
  (356 * 24 * 60 + 24 * 60) * 60;

interface PollReminder {
  id: string;
  guildId: string;
  channelId: string;
  pollId: string;
  dueAt: number;
  attempts: number;
}

export function pollReminderKey(id: string): string {
  return `${REMINDER_PREFIX}${id}`;
}

export function pollReminderDueKey(dueAt: number, id: string): string {
  return `${DUE_PREFIX}${String(Math.trunc(dueAt)).padStart(16, "0")}:${id}`;
}

function parseReminder(value: string): PollReminder | null {
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
    typeof parsed.id !== "string" ||
    !/^[0-9a-f-]{36}$/.test(parsed.id) ||
    typeof parsed.guildId !== "string" ||
    !/^\d{17,20}$/.test(parsed.guildId) ||
    typeof parsed.channelId !== "string" ||
    !/^\d{17,20}$/.test(parsed.channelId) ||
    typeof parsed.pollId !== "string" ||
    !/^[0-9a-f-]{36}$/.test(parsed.pollId) ||
    typeof parsed.dueAt !== "number" ||
    !Number.isFinite(parsed.dueAt) ||
    typeof parsed.attempts !== "number" ||
    !Number.isInteger(parsed.attempts) ||
    parsed.attempts < 0
  ) {
    return null;
  }
  return {
    id: parsed.id,
    guildId: parsed.guildId,
    channelId: parsed.channelId,
    pollId: parsed.pollId,
    dueAt: parsed.dueAt,
    attempts: parsed.attempts,
  };
}

async function dueReminderKeys(
  store: KeyValueStore,
  now: number,
): Promise<{ key: string; dueAt: number; id: string }[]> {
  const due: { key: string; dueAt: number; id: string }[] = [];
  let cursor: string | undefined;
  do {
    const page = await store.list({
      prefix: DUE_PREFIX,
      limit: 1000,
      ...(cursor ? { cursor } : {}),
    });
    let futureFound = false;
    for (const { name } of [...page.keys].sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0
    )) {
      const match = /^poll-reminder-due:(\d{16}):([0-9a-f-]{36})$/
        .exec(name);
      if (!match) {
        console.error(`Discarding malformed poll reminder index ${name}.`);
        await store.delete(name);
        continue;
      }
      const dueAt = Number(match[1]);
      if (dueAt > now) {
        futureFound = true;
        break;
      }
      due.push({ key: name, dueAt, id: match[2] });
    }
    if (page.list_complete || futureFound) {
      break;
    }
    if (!page.cursor) {
      throw new Error("Cloudflare KV did not return a poll reminder cursor.");
    }
    cursor = page.cursor;
  } while (true);
  return due;
}

async function sendPollReminder(
  botToken: string,
  reminder: PollReminder,
  question: string,
  messageId?: string,
): Promise<void> {
  const pollLink = messageId
    ? `\nhttps://discord.com/channels/${reminder.guildId}/${reminder.channelId}/${messageId}`
    : "";
  const response = await fetch(
    `https://discord.com/api/v10/channels/${encodeURIComponent(reminder.channelId)}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bot ${botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content: `⏰ Reminder to vote in **${question}**.${pollLink}`,
        allowed_mentions: { parse: [] },
      }),
    },
  );
  if (!response.ok) {
    throw new Error(`Discord returned HTTP ${response.status}.`);
  }
}

export async function processDuePollReminders(
  env: CommandEnvironment,
  now: number,
): Promise<void> {
  const store = env.FEEDBACK_CONFIG;
  const botToken = env.DISCORD_BOT_TOKEN;
  if (!store || !botToken) {
    throw new Error("Poll reminders are missing their KV binding or bot token.");
  }

  for (const dueItem of await dueReminderKeys(store, now)) {
    const key = pollReminderKey(dueItem.id);
    try {
      const rawReminder = await store.get(key);
      if (!rawReminder) {
        await store.delete(dueItem.key);
        continue;
      }
      const reminder = parseReminder(rawReminder);
      if (
        !reminder ||
        reminder.id !== dueItem.id ||
        reminder.dueAt !== dueItem.dueAt
      ) {
        console.error(`Discarding malformed poll reminder ${key}.`);
        await store.delete(key);
        await store.delete(dueItem.key);
        continue;
      }
      const rawPoll = await store.get(pollKey(reminder.pollId));
      const poll = rawPoll ? readPollState(rawPoll) : null;
      if (
        !poll ||
        poll.guildId !== reminder.guildId ||
        poll.closed
      ) {
        await store.delete(key);
        await store.delete(dueItem.key);
        continue;
      }
      try {
        await sendPollReminder(
          botToken,
          reminder,
          poll.question,
          poll.messageId,
        );
        for (const completedKey of [dueItem.key, key]) {
          try {
            await store.delete(completedKey);
          } catch (error) {
            console.error(
              `Could not remove completed poll reminder ${completedKey}:`,
              error instanceof Error ? error.message : String(error),
            );
          }
        }
      } catch (error) {
        const attempts = reminder.attempts + 1;
        if (attempts >= MAX_DELIVERY_ATTEMPTS) {
          await store.delete(key);
          await store.delete(dueItem.key);
          console.error(
            `Discarding poll reminder ${key} after ${attempts} attempts:`,
            error instanceof Error ? error.message : String(error),
          );
          continue;
        }
        await store.put(
          key,
          JSON.stringify({ ...reminder, attempts }),
          { expirationTtl: POLL_REMINDER_TTL_SECONDS },
        );
        console.error(
          `Poll reminder ${key} attempt ${attempts} failed:`,
          error instanceof Error ? error.message : String(error),
        );
      }
    } catch (error) {
      console.error(
        `Could not process poll reminder ${key}:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}

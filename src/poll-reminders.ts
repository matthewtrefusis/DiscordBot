import { isRecord } from "./commands/helpers";
import { pollKey, readPollState } from "./commands/poll";
import type { CommandEnvironment } from "./commands/types";
import {
  deleteScheduledItem,
  listDueScheduledItems,
  saveScheduledItem,
} from "./scheduler";

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
  const database = env.DB;
  const botToken = env.DISCORD_BOT_TOKEN;
  if (!store || !database || !botToken) {
    throw new Error("Poll reminders are missing their KV/D1 binding or bot token.");
  }

  const dueItems = await listDueScheduledItems(
    database,
    "poll-reminder",
    now,
  );
  for (const dueItem of dueItems) {
    const id = dueItem.itemKey;
    if (!/^[0-9a-f-]{36}$/.test(id) || dueItem.dueAt === null) {
      console.error(`Discarding malformed poll reminder index ${id}.`);
      await deleteScheduledItem(database, "poll-reminder", id);
      if (dueItem.referenceKey) {
        await store.delete(dueItem.referenceKey);
      }
      continue;
    }
    const key = pollReminderKey(id);
    try {
      const rawReminder = await store.get(key);
      if (!rawReminder) {
        await deleteScheduledItem(database, "poll-reminder", id);
        if (dueItem.referenceKey) {
          await store.delete(dueItem.referenceKey);
        }
        continue;
      }
      const reminder = parseReminder(rawReminder);
      if (
        !reminder ||
        reminder.id !== id ||
        reminder.dueAt !== dueItem.dueAt
      ) {
        console.error(`Discarding malformed poll reminder ${key}.`);
        await store.delete(key);
        await deleteScheduledItem(database, "poll-reminder", id);
        if (dueItem.referenceKey) {
          await store.delete(dueItem.referenceKey);
        }
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
        await deleteScheduledItem(database, "poll-reminder", id);
        if (dueItem.referenceKey) {
          await store.delete(dueItem.referenceKey);
        }
        continue;
      }
      try {
        await sendPollReminder(
          botToken,
          reminder,
          poll.question,
          poll.messageId,
        );
        const completedKeys = [key];
        if (dueItem.referenceKey) {
          completedKeys.push(dueItem.referenceKey);
        }
        await deleteScheduledItem(database, "poll-reminder", id);
        for (const completedKey of completedKeys) {
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
          await deleteScheduledItem(database, "poll-reminder", id);
          if (dueItem.referenceKey) {
            await store.delete(dueItem.referenceKey);
          }
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

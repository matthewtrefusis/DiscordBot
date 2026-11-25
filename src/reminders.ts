import { isRecord } from "./commands/helpers";
import type { CommandEnvironment, KeyValueStore } from "./commands/types";

const REMINDER_PREFIX = "reminder:";
const MAX_DELIVERY_ATTEMPTS = 5;

interface Reminder {
  userId: string;
  message: string;
  dueAt: number;
  attempts: number;
}

function parseReminder(value: string): Reminder | null {
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
    typeof parsed.userId !== "string" ||
    !/^\d{17,20}$/.test(parsed.userId) ||
    typeof parsed.message !== "string" ||
    parsed.message.length === 0 ||
    parsed.message.length > 1000 ||
    typeof parsed.dueAt !== "number" ||
    !Number.isFinite(parsed.dueAt) ||
    typeof parsed.attempts !== "number" ||
    !Number.isInteger(parsed.attempts) ||
    parsed.attempts < 0
  ) {
    return null;
  }
  return {
    userId: parsed.userId,
    message: parsed.message,
    dueAt: parsed.dueAt,
    attempts: parsed.attempts,
  };
}

async function listReminderKeys(
  store: KeyValueStore,
): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await store.list({
      prefix: REMINDER_PREFIX,
      limit: 1000,
      ...(cursor ? { cursor } : {}),
    });
    keys.push(...page.keys.map((key) => key.name));
    if (page.list_complete) {
      break;
    }
    if (!page.cursor) {
      throw new Error("Cloudflare KV did not return a cursor for more reminders.");
    }
    cursor = page.cursor;
  } while (true);
  return keys;
}

async function deliverReminder(
  botToken: string,
  reminder: Reminder,
): Promise<void> {
  const dmResponse = await fetch("https://discord.com/api/v10/users/@me/channels", {
    method: "POST",
    headers: {
      Authorization: `Bot ${botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ recipient_id: reminder.userId }),
  });
  if (!dmResponse.ok) {
    throw new Error(`Discord could not open a DM (HTTP ${dmResponse.status}).`);
  }
  const dm: unknown = await dmResponse.json();
  if (!isRecord(dm) || typeof dm.id !== "string" || !/^\d{17,20}$/.test(dm.id)) {
    throw new Error("Discord returned an invalid DM channel.");
  }

  const messageResponse = await fetch(
    `https://discord.com/api/v10/channels/${encodeURIComponent(dm.id)}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bot ${botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content: `⏰ Reminder: ${reminder.message}`,
        allowed_mentions: { parse: [] },
      }),
    },
  );
  if (!messageResponse.ok) {
    throw new Error(`Discord could not send the reminder (HTTP ${messageResponse.status}).`);
  }
}

async function deleteReminder(store: KeyValueStore, key: string): Promise<void> {
  await store.delete(key);
}

export async function processDueReminders(
  env: CommandEnvironment,
  now: number,
): Promise<void> {
  const store = env.FEEDBACK_CONFIG;
  const botToken = env.DISCORD_BOT_TOKEN;
  if (!store || !botToken) {
    throw new Error("Reminder delivery is missing its KV binding or bot token.");
  }

  const reminderKeys = await listReminderKeys(store);
  for (const key of reminderKeys) {
    try {
      const rawReminder = await store.get(key);
      if (!rawReminder) {
        continue;
      }
      const reminder = parseReminder(rawReminder);
      if (!reminder) {
        console.error(`Discarding malformed reminder ${key}.`);
        await deleteReminder(store, key);
        continue;
      }
      if (reminder.dueAt > now) {
        continue;
      }

      try {
        await deliverReminder(botToken, reminder);
        await deleteReminder(store, key);
      } catch (error) {
        const attempts = reminder.attempts + 1;
        if (attempts >= MAX_DELIVERY_ATTEMPTS) {
          await deleteReminder(store, key);
          console.error(
            `Discarding reminder ${key} after ${attempts} delivery attempts:`,
            error instanceof Error ? error.message : String(error),
          );
          continue;
        }

        await store.put(key, JSON.stringify({ ...reminder, attempts }));
        console.error(
          `Reminder ${key} delivery attempt ${attempts} failed:`,
          error instanceof Error ? error.message : String(error),
        );
      }
    } catch (error) {
      console.error(
        `Could not process reminder ${key}:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}

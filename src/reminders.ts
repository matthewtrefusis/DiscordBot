import { isRecord } from "./commands/helpers";
import type { CommandEnvironment, D1Database } from "./commands/types";
import {
  deleteScheduledItem,
  listDueScheduledItems,
  saveScheduledItem,
  updateScheduledPayload,
} from "./scheduler";

const MAX_DELIVERY_ATTEMPTS = 5;
export const MAX_REMINDER_DELAY_MS = 356 * 24 * 60 * 60 * 1000;

interface Reminder {
  userId: string;
  message: string;
  dueAt: number;
  attempts: number;
}

export async function saveReminder(
  database: D1Database,
  userId: string,
  message: string,
  dueAt: number,
): Promise<string> {
  const reminderId = crypto.randomUUID();
  await saveScheduledItem(database, "reminder", {
    itemKey: reminderId,
    dueAt,
    lookupKey: null,
    referenceKey: null,
    payload: JSON.stringify({ userId, message, dueAt, attempts: 0 }),
  });
  return reminderId;
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

export async function processDueReminders(
  env: CommandEnvironment,
  now: number,
): Promise<void> {
  const database = env.DB;
  const store = env.FEEDBACK_CONFIG;
  const botToken = env.DISCORD_BOT_TOKEN;
  if (!database || !botToken) {
    throw new Error("Reminder delivery is missing its D1 binding or bot token.");
  }

  const reminders = await listDueScheduledItems(database, "reminder", now);
  for (const { itemKey, payload, referenceKey } of reminders) {
    try {
      if (!payload) {
        await deleteScheduledItem(database, "reminder", itemKey);
        if (referenceKey) {
          if (!store) {
            throw new Error("Legacy reminder cleanup is missing the KV binding.");
          }
          await store.delete(referenceKey);
        }
        continue;
      }
      const reminder = parseReminder(payload);
      if (!reminder) {
        console.error(`Discarding malformed reminder ${itemKey}.`);
        await deleteScheduledItem(database, "reminder", itemKey);
        if (referenceKey) {
          if (!store) {
            throw new Error("Legacy reminder cleanup is missing the KV binding.");
          }
          await store.delete(referenceKey);
        }
        continue;
      }
      if (reminder.dueAt > now) {
        continue;
      }

      try {
        await deliverReminder(botToken, reminder);
        await deleteScheduledItem(database, "reminder", itemKey);
        if (referenceKey) {
          if (!store) {
            throw new Error("Legacy reminder cleanup is missing the KV binding.");
          }
          await store.delete(referenceKey);
        }
      } catch (error) {
        const attempts = reminder.attempts + 1;
        if (attempts >= MAX_DELIVERY_ATTEMPTS) {
          await deleteScheduledItem(database, "reminder", itemKey);
          if (referenceKey) {
            if (!store) {
              throw new Error("Legacy reminder cleanup is missing the KV binding.");
            }
            await store.delete(referenceKey);
          }
          console.error(
            `Discarding reminder ${itemKey} after ${attempts} delivery attempts:`,
            error instanceof Error ? error.message : String(error),
          );
          continue;
        }

        await updateScheduledPayload(
          database,
          "reminder",
          itemKey,
          JSON.stringify({ ...reminder, attempts }),
        );
        console.error(
          `Reminder ${itemKey} delivery attempt ${attempts} failed:`,
          error instanceof Error ? error.message : String(error),
        );
      }
    } catch (error) {
      console.error(
        `Could not process reminder ${itemKey}:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}

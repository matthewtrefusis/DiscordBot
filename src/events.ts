import { isRecord } from "./commands/helpers";
import type { CommandEnvironment, KeyValueStore } from "./commands/types";
import {
  deleteScheduledItem,
  listDueScheduledItems,
  saveScheduledItem,
} from "./scheduler";

const EVENT_PREFIX = "event:";
const EVENT_DUE_PREFIX = "event-due:";
const MAX_DELIVERY_ATTEMPTS = 5;

export interface ScheduledEvent {
  guildId: string;
  channelId: string;
  title: string;
  startsAt: number;
  createdBy: string;
  attempts: number;
  participants: string[];
}

export function eventKey(guildId: string, eventId: string): string {
  return `${EVENT_PREFIX}${guildId}:${eventId}`;
}

export function eventGuildPrefix(guildId: string): string {
  return `${EVENT_PREFIX}${guildId}:`;
}

export function eventDueKey(
  startsAt: number,
  guildId: string,
  eventId: string,
): string {
  return `${EVENT_DUE_PREFIX}${String(Math.trunc(startsAt)).padStart(16, "0")}:${guildId}:${eventId}`;
}

export function eventScheduleItemKey(guildId: string, eventId: string): string {
  return `${guildId}:${eventId}`;
}

export function parseScheduledEvent(value: string): ScheduledEvent | null {
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
    typeof parsed.channelId !== "string" ||
    !/^\d{17,20}$/.test(parsed.channelId) ||
    typeof parsed.title !== "string" ||
    parsed.title.trim().length === 0 ||
    parsed.title.length > 150 ||
    typeof parsed.startsAt !== "number" ||
    !Number.isFinite(parsed.startsAt) ||
    typeof parsed.createdBy !== "string" ||
    !/^\d{17,20}$/.test(parsed.createdBy) ||
    typeof parsed.attempts !== "number" ||
    !Number.isInteger(parsed.attempts) ||
    parsed.attempts < 0 ||
    (parsed.participants !== undefined &&
      (!Array.isArray(parsed.participants) ||
        !parsed.participants.every(
          (participant) =>
            typeof participant === "string" &&
            /^\d{17,20}$/.test(participant),
        )))
  ) {
    return null;
  }
  return {
    guildId: parsed.guildId,
    channelId: parsed.channelId,
    title: parsed.title,
    startsAt: parsed.startsAt,
    createdBy: parsed.createdBy,
    attempts: parsed.attempts,
    participants: Array.isArray(parsed.participants)
      ? parsed.participants as string[]
      : [],
  };
}

export function renderEventAnnouncement(
  eventId: string,
  scheduledEvent: ScheduledEvent,
): { content: string; components: Record<string, unknown>[] } {
  return {
    content: [
      `📅 **${scheduledEvent.title}**`,
      `Starts <t:${Math.floor(scheduledEvent.startsAt / 1000)}:F>`,
      `Going: **${scheduledEvent.participants.length}**`,
    ].join("\n"),
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 3,
            label: "Going",
            custom_id: `event:${eventId}:join`,
          },
          {
            type: 2,
            style: 2,
            label: "Can't go",
            custom_id: `event:${eventId}:leave`,
          },
        ],
      },
    ],
  };
}

async function sendEventAnnouncement(
  botToken: string,
  scheduledEvent: ScheduledEvent,
): Promise<void> {
  const response = await fetch(
    `https://discord.com/api/v10/channels/${encodeURIComponent(scheduledEvent.channelId)}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bot ${botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content: `📅 **${scheduledEvent.title}** is starting now! <t:${Math.floor(scheduledEvent.startsAt / 1000)}:F>`,
        allowed_mentions: { parse: [] },
      }),
    },
  );
  if (!response.ok) {
    throw new Error(`Discord event announcement failed with HTTP ${response.status}.`);
  }
}

export async function listGuildEvents(
  store: KeyValueStore,
  guildId: string,
): Promise<{ key: string; event: ScheduledEvent }[]> {
  const events: { key: string; event: ScheduledEvent }[] = [];
  let cursor: string | undefined;
  do {
    const page = await store.list({
      prefix: eventGuildPrefix(guildId),
      limit: 1000,
      ...(cursor ? { cursor } : {}),
    });
    for (const entry of page.keys) {
      const rawEvent = await store.get(entry.name);
      if (!rawEvent) {
        continue;
      }
      const event = parseScheduledEvent(rawEvent);
      if (event) {
        events.push({ key: entry.name, event });
      } else {
        console.error(`Discarding malformed scheduled event ${entry.name}.`);
        await store.delete(entry.name);
      }
    }
    if (page.list_complete) {
      break;
    }
    if (!page.cursor) {
      throw new Error("Cloudflare KV did not return a cursor for more events.");
    }
    cursor = page.cursor;
  } while (true);
  return events;
}

export async function processDueEvents(
  env: CommandEnvironment,
  now: number,
): Promise<void> {
  const store = env.FEEDBACK_CONFIG;
  const database = env.DB;
  const botToken = env.DISCORD_BOT_TOKEN;
  if (!store || !database || !botToken) {
    throw new Error("Scheduled events are missing their KV/D1 binding or bot token.");
  }

  const dueEvents = await listDueScheduledItems(database, "event", now);
  for (const dueEvent of dueEvents) {
    const match = /^(\d{17,20}):([0-9a-f-]{36})$/.exec(dueEvent.itemKey);
    if (!match || dueEvent.dueAt === null) {
      console.error(`Discarding malformed scheduled event index ${dueEvent.itemKey}.`);
      await deleteScheduledItem(database, "event", dueEvent.itemKey);
      continue;
    }
    const guildId = match[1];
    const eventId = match[2];
    const key = eventKey(guildId, eventId);
    try {
      const rawEvent = await store.get(key);
      if (!rawEvent) {
        await deleteScheduledItem(database, "event", dueEvent.itemKey);
        if (dueEvent.referenceKey) {
          await store.delete(dueEvent.referenceKey);
        }
        continue;
      }
      const scheduledEvent = parseScheduledEvent(rawEvent);
      if (!scheduledEvent) {
        console.error(`Discarding malformed scheduled event ${key}.`);
        await store.delete(key);
        await deleteScheduledItem(database, "event", dueEvent.itemKey);
        if (dueEvent.referenceKey) {
          await store.delete(dueEvent.referenceKey);
        }
        continue;
      }
      if (
        scheduledEvent.guildId !== guildId ||
        eventDueKey(
          scheduledEvent.startsAt,
          scheduledEvent.guildId,
          eventId,
        ) !== (dueEvent.referenceKey ?? eventDueKey(
          dueEvent.dueAt,
          guildId,
          eventId,
        ))
      ) {
        console.error(`Scheduled event index does not match ${key}.`);
        await store.delete(key);
        await deleteScheduledItem(database, "event", dueEvent.itemKey);
        if (dueEvent.referenceKey) {
          await store.delete(dueEvent.referenceKey);
        }
        continue;
      }

      try {
        await sendEventAnnouncement(botToken, scheduledEvent);
        try {
          await deleteScheduledItem(database, "event", dueEvent.itemKey);
          if (dueEvent.referenceKey) {
            await store.delete(dueEvent.referenceKey);
          }
        } catch (error) {
          console.error(
            `Could not remove completed event index ${dueEvent.itemKey}:`,
            error instanceof Error ? error.message : String(error),
          );
        }
        continue;
      } catch (error) {
        const attempts = scheduledEvent.attempts + 1;
        if (attempts >= MAX_DELIVERY_ATTEMPTS) {
          await store.delete(key);
          await deleteScheduledItem(database, "event", dueEvent.itemKey);
          if (dueEvent.referenceKey) {
            await store.delete(dueEvent.referenceKey);
          }
          console.error(
            `Discarding event ${key} after ${attempts} delivery attempts:`,
            error instanceof Error ? error.message : String(error),
          );
          continue;
        }
        await store.put(key, JSON.stringify({ ...scheduledEvent, attempts }));
        console.error(
          `Event ${key} delivery attempt ${attempts} failed:`,
          error instanceof Error ? error.message : String(error),
        );
      }
    } catch (error) {
      console.error(
        `Could not process scheduled event ${key}:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}

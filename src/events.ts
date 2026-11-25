import { isRecord } from "./commands/helpers";
import type { CommandEnvironment, KeyValueStore } from "./commands/types";

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
    parsed.attempts < 0
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
  };
}

async function listDueEventKeys(
  store: KeyValueStore,
  now: number,
): Promise<{ key: string; guildId: string; eventId: string }[]> {
  const dueEvents: { key: string; guildId: string; eventId: string }[] = [];
  let cursor: string | undefined;
  do {
    const page = await store.list({
      prefix: EVENT_DUE_PREFIX,
      limit: 1000,
      ...(cursor ? { cursor } : {}),
    });
    let foundFutureEvent = false;
    for (const { name } of [...page.keys].sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0
    )) {
      const match = /^event-due:(\d{16}):(\d{17,20}):([0-9a-f-]{36})$/
        .exec(name);
      if (!match) {
        console.error(`Discarding malformed event index ${name}.`);
        await store.delete(name);
        continue;
      }
      if (Number(match[1]) > now) {
        foundFutureEvent = true;
        break;
      }
      dueEvents.push({ key: name, guildId: match[2], eventId: match[3] });
    }
    if (page.list_complete || foundFutureEvent) {
      break;
    }
    if (!page.cursor) {
      throw new Error("Cloudflare KV did not return a cursor for more event indexes.");
    }
    cursor = page.cursor;
  } while (true);
  return dueEvents;
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
  const botToken = env.DISCORD_BOT_TOKEN;
  if (!store || !botToken) {
    throw new Error("Scheduled events are missing their KV binding or bot token.");
  }

  for (const dueEvent of await listDueEventKeys(store, now)) {
    const key = eventKey(dueEvent.guildId, dueEvent.eventId);
    try {
      const rawEvent = await store.get(key);
      if (!rawEvent) {
        await store.delete(dueEvent.key);
        continue;
      }
      const scheduledEvent = parseScheduledEvent(rawEvent);
      if (!scheduledEvent) {
        console.error(`Discarding malformed scheduled event ${key}.`);
        await store.delete(key);
        await store.delete(dueEvent.key);
        continue;
      }
      if (
        scheduledEvent.guildId !== dueEvent.guildId ||
        eventDueKey(
          scheduledEvent.startsAt,
          scheduledEvent.guildId,
          dueEvent.eventId,
        ) !== dueEvent.key
      ) {
        console.error(`Scheduled event index does not match ${key}.`);
        await store.delete(key);
        await store.delete(dueEvent.key);
        continue;
      }

      try {
        await sendEventAnnouncement(botToken, scheduledEvent);
        for (const completedKey of [dueEvent.key, key]) {
          try {
            await store.delete(completedKey);
          } catch (error) {
            console.error(
              `Could not remove completed event state ${completedKey}:`,
              error instanceof Error ? error.message : String(error),
            );
          }
        }
        continue;
      } catch (error) {
        const attempts = scheduledEvent.attempts + 1;
        if (attempts >= MAX_DELIVERY_ATTEMPTS) {
          await store.delete(key);
          await store.delete(dueEvent.key);
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

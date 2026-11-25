import { isRecord } from "./commands/helpers";
import type { CommandEnvironment, KeyValueStore } from "./commands/types";
import {
  deleteScheduledItem,
  listDueScheduledItems,
  saveScheduledItem,
} from "./scheduler";

const GIVEAWAY_PREFIX = "giveaway:";
const DUE_PREFIX = "giveaway-due:";
const MAX_DELIVERY_ATTEMPTS = 5;

export interface Giveaway {
  id: string;
  guildId: string;
  channelId: string;
  prize: string;
  endsAt: number;
  entries: string[];
  messageId?: string;
  winnerId?: string | null;
  closed?: boolean;
  attempts: number;
}

export function giveawayKey(id: string): string {
  return `${GIVEAWAY_PREFIX}${id}`;
}

export function giveawayDueKey(endsAt: number, id: string): string {
  return `${DUE_PREFIX}${String(Math.trunc(endsAt)).padStart(16, "0")}:${id}`;
}

export function parseGiveaway(value: string): Giveaway | null {
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
    typeof parsed.prize !== "string" ||
    parsed.prize.trim().length === 0 ||
    parsed.prize.length > 200 ||
    typeof parsed.endsAt !== "number" ||
    !Number.isFinite(parsed.endsAt) ||
    !Array.isArray(parsed.entries) ||
    !parsed.entries.every(
      (entry) => typeof entry === "string" && /^\d{17,20}$/.test(entry),
    ) ||
    new Set(parsed.entries).size !== parsed.entries.length ||
    (parsed.messageId !== undefined &&
      (typeof parsed.messageId !== "string" ||
        !/^\d{17,20}$/.test(parsed.messageId))) ||
    (parsed.winnerId !== undefined &&
      parsed.winnerId !== null &&
      (typeof parsed.winnerId !== "string" ||
        !/^\d{17,20}$/.test(parsed.winnerId))) ||
    (parsed.closed !== undefined && typeof parsed.closed !== "boolean") ||
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
    prize: parsed.prize,
    endsAt: parsed.endsAt,
    entries: parsed.entries,
    ...(typeof parsed.messageId === "string"
      ? { messageId: parsed.messageId }
      : {}),
    ...(typeof parsed.winnerId === "string" || parsed.winnerId === null
      ? { winnerId: parsed.winnerId }
      : {}),
    ...(parsed.closed === true ? { closed: true } : {}),
    attempts: parsed.attempts,
  };
}

export function renderGiveaway(giveaway: Giveaway): {
  content: string;
  components: Record<string, unknown>[];
} {
  const content = giveaway.closed
    ? giveaway.winnerId
      ? `🎉 Giveaway ended: **${giveaway.prize}**\nWinner: <@${giveaway.winnerId}>`
      : `Giveaway ended: **${giveaway.prize}**\nNo entries were received.`
    : `🎁 **Giveaway: ${giveaway.prize}**\nEnds <t:${Math.floor(giveaway.endsAt / 1000)}:R>\nEntries: **${giveaway.entries.length}**`;
  return {
    content,
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: giveaway.closed ? 2 : 3,
            label: giveaway.closed ? "Giveaway ended" : "Join / leave",
            custom_id: `giveaway:${giveaway.id}:toggle`,
            disabled: giveaway.closed === true,
          },
        ],
      },
    ],
  };
}

async function finishGiveaway(
  store: KeyValueStore,
  botToken: string,
  giveaway: Giveaway,
): Promise<void> {
  if (giveaway.messageId) {
    const response = await fetch(
      `https://discord.com/api/v10/channels/${encodeURIComponent(giveaway.channelId)}/messages/${encodeURIComponent(giveaway.messageId)}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bot ${botToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...renderGiveaway(giveaway),
          allowed_mentions: {
            parse: [],
            ...(giveaway.winnerId ? { users: [giveaway.winnerId] } : {}),
          },
        }),
      },
    );
    if (!response.ok) {
      throw new Error(`Discord giveaway update returned HTTP ${response.status}.`);
    }
  } else {
    const response = await fetch(
      `https://discord.com/api/v10/channels/${encodeURIComponent(giveaway.channelId)}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bot ${botToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          content: renderGiveaway(giveaway).content,
          allowed_mentions: {
            parse: [],
            ...(giveaway.winnerId ? { users: [giveaway.winnerId] } : {}),
          },
        }),
      },
    );
    if (!response.ok) {
      throw new Error(`Discord giveaway result returned HTTP ${response.status}.`);
    }
  }
}

function pickWinner(entries: string[]): string | null {
  if (entries.length === 0) return null;
  const range = 0x1_0000_0000;
  const limit = Math.floor(range / entries.length) * entries.length;
  const value = new Uint32Array(1);
  do {
    crypto.getRandomValues(value);
  } while (value[0] >= limit);
  return entries[value[0] % entries.length];
}

export async function processDueGiveaways(
  env: CommandEnvironment,
  now: number,
): Promise<void> {
  const store = env.FEEDBACK_CONFIG;
  const database = env.DB;
  const botToken = env.DISCORD_BOT_TOKEN;
  if (!store || !database || !botToken) {
    throw new Error("Giveaways are missing their KV/D1 binding or bot token.");
  }
  const dueItems = await listDueScheduledItems(database, "giveaway", now);
  for (const dueItem of dueItems) {
    const id = dueItem.itemKey;
    if (!/^[0-9a-f-]{36}$/.test(id) || dueItem.dueAt === null) {
      console.error(`Discarding malformed giveaway index ${id}.`);
      await deleteScheduledItem(database, "giveaway", id);
      if (dueItem.referenceKey) {
        await store.delete(dueItem.referenceKey);
      }
      continue;
    }
    const key = giveawayKey(id);
    try {
      const rawGiveaway = await store.get(key);
      if (!rawGiveaway) {
        await deleteScheduledItem(database, "giveaway", id);
        if (dueItem.referenceKey) {
          await store.delete(dueItem.referenceKey);
        }
        continue;
      }
      const giveaway = parseGiveaway(rawGiveaway);
      if (
        !giveaway ||
        giveaway.id !== id ||
        giveaway.endsAt !== dueItem.dueAt
      ) {
        console.error(`Discarding malformed giveaway ${key}.`);
        await store.delete(key);
        await deleteScheduledItem(database, "giveaway", id);
        if (dueItem.referenceKey) {
          await store.delete(dueItem.referenceKey);
        }
        continue;
      }
      let closingGiveaway = giveaway;
      try {
        if (!giveaway.closed) {
          const winnerId = pickWinner(giveaway.entries);
          closingGiveaway = { ...giveaway, closed: true, winnerId };
          await store.put(key, JSON.stringify(closingGiveaway), {
            expirationTtl: 30 * 24 * 60 * 60,
          });
        }
        await finishGiveaway(store, botToken, closingGiveaway);
        await deleteScheduledItem(database, "giveaway", id);
        const completedKeys = [key];
        if (dueItem.referenceKey) {
          completedKeys.push(dueItem.referenceKey);
        }
        for (const completedKey of completedKeys) {
          try {
            await store.delete(completedKey);
          } catch (error) {
            console.error(
              `Could not remove completed giveaway state ${completedKey}:`,
              error instanceof Error ? error.message : String(error),
            );
          }
        }
      } catch (error) {
        const attempts = closingGiveaway.attempts + 1;
        if (attempts >= MAX_DELIVERY_ATTEMPTS) {
          await store.delete(key);
          await deleteScheduledItem(database, "giveaway", id);
          if (dueItem.referenceKey) {
            await store.delete(dueItem.referenceKey);
          }
          console.error(
            `Discarding giveaway ${key} after ${attempts} delivery attempts:`,
            error instanceof Error ? error.message : String(error),
          );
          continue;
        }
        await store.put(key, JSON.stringify({ ...closingGiveaway, attempts }), {
          expirationTtl: 30 * 24 * 60 * 60,
        });
        console.error(
          `Giveaway ${key} attempt ${attempts} failed:`,
          error instanceof Error ? error.message : String(error),
        );
      }
    } catch (error) {
      console.error(
        `Could not process giveaway ${key}:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}

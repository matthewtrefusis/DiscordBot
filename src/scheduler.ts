import type { D1Database } from "./commands/types";

export type ScheduledItemType =
  | "reminder"
  | "event"
  | "poll-reminder"
  | "giveaway"
  | "birthday"
  | "stream";

export interface ScheduledItem {
  itemKey: string;
  dueAt: number | null;
  lookupKey: string | null;
  referenceKey: string | null;
  payload: string | null;
}

interface D1Result<T> {
  results?: T[];
  success?: boolean;
  error?: string;
}

function assertSuccess(result: D1Result<unknown>): void {
  if (result.success === false || result.error) {
    throw new Error(result.error ?? "D1 query failed.");
  }
}

async function run(
  database: D1Database,
  query: string,
  values: (string | number | null)[],
): Promise<void> {
  const result = await database.prepare(query).bind(...values).run();
  assertSuccess(result);
}

async function all<T>(
  database: D1Database,
  query: string,
  values: (string | number | null)[],
): Promise<T[]> {
  const result = await database.prepare(query).bind(...values).all<T>();
  assertSuccess(result);
  return result.results ?? [];
}

export async function saveScheduledItem(
  database: D1Database,
  itemType: ScheduledItemType,
  item: ScheduledItem,
): Promise<void> {
  await run(
    database,
    `INSERT INTO scheduled_items
      (item_type, item_key, due_at, lookup_key, reference_key, payload)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(item_type, item_key) DO UPDATE SET
        due_at = excluded.due_at,
        lookup_key = excluded.lookup_key,
        reference_key = excluded.reference_key,
        payload = excluded.payload`,
    [
      itemType,
      item.itemKey,
      item.dueAt,
      item.lookupKey,
      item.referenceKey,
      item.payload,
    ],
  );
}

export async function deleteScheduledItem(
  database: D1Database,
  itemType: ScheduledItemType,
  itemKey: string,
): Promise<void> {
  await run(
    database,
    "DELETE FROM scheduled_items WHERE item_type = ? AND item_key = ?",
    [itemType, itemKey],
  );
}

export async function updateScheduledPayload(
  database: D1Database,
  itemType: ScheduledItemType,
  itemKey: string,
  payload: string,
): Promise<void> {
  await run(
    database,
    "UPDATE scheduled_items SET payload = ? WHERE item_type = ? AND item_key = ?",
    [payload, itemType, itemKey],
  );
}

export async function listDueScheduledItems(
  database: D1Database,
  itemType: ScheduledItemType,
  now: number,
): Promise<ScheduledItem[]> {
  return all<ScheduledItem>(
    database,
    `SELECT item_key AS itemKey, due_at AS dueAt,
        lookup_key AS lookupKey, reference_key AS referenceKey, payload
      FROM scheduled_items
      WHERE item_type = ? AND due_at <= ?
      ORDER BY due_at, item_key`,
    [itemType, now],
  );
}

export async function listScheduledItemsByLookup(
  database: D1Database,
  itemType: ScheduledItemType,
  lookupKey: string,
): Promise<ScheduledItem[]> {
  return all<ScheduledItem>(
    database,
    `SELECT item_key AS itemKey, due_at AS dueAt,
        lookup_key AS lookupKey, reference_key AS referenceKey, payload
      FROM scheduled_items
      WHERE item_type = ? AND lookup_key = ?
      ORDER BY item_key`,
    [itemType, lookupKey],
  );
}

export async function listScheduledItems(
  database: D1Database,
  itemType: ScheduledItemType,
): Promise<ScheduledItem[]> {
  return all<ScheduledItem>(
    database,
    `SELECT item_key AS itemKey, due_at AS dueAt,
        lookup_key AS lookupKey, reference_key AS referenceKey, payload
      FROM scheduled_items
      WHERE item_type = ?
      ORDER BY item_key`,
    [itemType],
  );
}
